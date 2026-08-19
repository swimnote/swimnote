/**
 * MediaService — Media Engine v2 + Phase 1 Photo Clone
 *
 * photo_assets_meta를 단일 Source of Truth로 사용.
 * 모든 일지 사진 조회·연결·해제는 이 서비스를 통해서만 처리한다.
 *
 * media_status 규칙:
 *   'draft'    — 업로드 완료, 일지 미연결
 *   'attached' — 일지/노트에 연결됨
 *   'detached' — 일지 삭제 후 해제됨 (파일은 유지)
 *   'archived' — 장기 미사용 / 정리 대상
 *
 * Photo Clone 규칙 (Phase 1):
 *   - R2 실제 파일은 하나 유지 (object_key 공유)
 *   - 동일 사진을 공통/여러 학생에 동시 연결 시 DB row만 복제
 *   - is_clone=false: 원본 row
 *   - is_clone=true : clone row (source_photo_id = 최상위 원본 id)
 *   - clone의 clone도 source_photo_id는 항상 최상위 원본을 가리킴
 *   - R2 삭제는 동일 object_key를 가진 row가 모두 없어진 후에만 허용
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Audit 로그 ────────────────────────────────────────────────────────────────

export interface MediaActorContext {
  userId: string;
  userName: string;
  role: string;
  poolId: string;
}

type MediaActionType = "attach" | "detach" | "detach_deleted" | "note_attach" | "cleanup" | "archive";

async function logMediaAudit({
  action,
  diaryId,
  noteId,
  photoIds,
  actor,
}: {
  action: MediaActionType;
  diaryId?: string | null;
  noteId?: string | null;
  photoIds: string[];
  actor: MediaActorContext;
}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO class_diary_audit_logs
        (diary_id, student_note_id, target_type, action_type,
         after_content, actor_id, actor_name, actor_role, swimming_pool_id)
      VALUES
        (${diaryId ?? null}, ${noteId ?? null},
         ${"media"}, ${action},
         ${JSON.stringify({ photo_ids: photoIds, count: photoIds.length })},
         ${actor.userId}, ${actor.userName}, ${actor.role}, ${actor.poolId})
    `);
  } catch (e) {
    console.warn("[MediaService] audit log 저장 실패:", e);
  }
}

export interface PhotoRecord {
  id: string;
  pool_id: string;
  student_id: string | null;
  class_id: string | null;
  journal_id: string | null;
  student_note_id: string | null;
  album_type: string;
  object_key: string;
  file_size: number | null;
  file_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  lesson_date: string | null;
  media_status: string;
  caption: string | null;
  created_at: string;
  file_url?: string;
  student_name?: string | null;
  source_photo_id?: string | null;
  is_clone?: boolean;
}

export interface DiaryPhotosResult {
  common: PhotoRecord[];
  individual: PhotoRecord[];
  total: number;
}

export interface ActorContext {
  userId: string;
  role: string;
  poolId: string;
}

/**
 * attach/note-attach 결과 — 각 photo_id별 처리 결과
 */
export interface AttachResult {
  requestedPhotoId: string;
  attachedPhotoId: string | null;
  studentNoteId?: string | null;
  action: "attached" | "cloned" | "already_attached" | "not_found" | "failed";
  error?: string;
}

function toArray(literal: string[]): string {
  return `{${literal.join(",")}}`;
}

/**
 * 최상위 원본 photo_id 조회
 * clone → source_photo_id가 NULL인 최상위 원본을 반환
 * clone의 clone도 항상 최상위 원본 ID 반환 (source_photo_id가 이미 최상위를 가리키도록 INSERT됨)
 */
function getRootId(photo: any): string {
  return photo.source_photo_id ?? photo.id;
}

/**
 * 일지에 연결된 사진 조회 (media_status='attached' + is_deleted JOIN)
 * Teacher: common + individual 전체
 * Parent:  common 전체 + 자녀 개인사진만 (myStudentIds 전달)
 */
export async function getDiaryPhotos(
  diaryId: string,
  poolId: string,
  myStudentIds?: Set<string>
): Promise<DiaryPhotosResult> {
  const rows = await db.execute(sql`
    SELECT pam.id, pam.pool_id, pam.student_id, pam.class_id,
           pam.journal_id, pam.student_note_id, pam.album_type,
           pam.object_key, pam.file_size, pam.file_type,
           pam.uploaded_by, pam.uploaded_by_name,
           pam.lesson_date, pam.media_status, pam.caption, pam.created_at,
           pam.source_photo_id, pam.is_clone,
           '/api/photos/' || pam.id || '/file' AS file_url,
           s.name AS student_name
    FROM photo_assets_meta pam
    JOIN class_diaries cd
      ON cd.id = pam.journal_id
     AND cd.is_deleted = false
    LEFT JOIN students s ON s.id = pam.student_id
    WHERE pam.journal_id = ${diaryId}
      AND pam.pool_id = ${poolId}
      AND pam.media_status = 'attached'
    ORDER BY pam.created_at ASC
  `);

  const photos = rows.rows as unknown as PhotoRecord[];

  const common = photos.filter(
    (p) => p.student_note_id === null && p.student_id === null
  );

  let individual: PhotoRecord[];
  if (myStudentIds) {
    individual = photos.filter(
      (p) =>
        p.student_note_id !== null &&
        p.student_id !== null &&
        myStudentIds.has(p.student_id!)
    );
  } else {
    individual = photos.filter((p) => p.student_note_id !== null);
  }

  return { common, individual, total: common.length + individual.length };
}

/**
 * draft 사진 목록 조회 — 일지 작성 화면 후보 사진
 * class_id + lesson_date + media_status='draft' + is_clone=false 기준
 */
export async function getDraftPhotosForClass(
  classId: string,
  lessonDate: string,
  poolId: string,
  uploadedBy?: string
): Promise<PhotoRecord[]> {
  const rows = await db.execute(sql`
    SELECT pam.id, pam.pool_id, pam.student_id, pam.class_id,
           pam.journal_id, pam.student_note_id, pam.album_type,
           pam.object_key, pam.file_size, pam.file_type,
           pam.uploaded_by, pam.uploaded_by_name,
           pam.lesson_date, pam.media_status, pam.caption, pam.created_at,
           pam.source_photo_id, pam.is_clone,
           '/api/photos/' || pam.id || '/file' AS file_url,
           s.name AS student_name
    FROM photo_assets_meta pam
    LEFT JOIN students s ON s.id = pam.student_id
    WHERE pam.class_id = ${classId}
      AND pam.pool_id = ${poolId}
      AND pam.media_status = 'draft'
      AND pam.journal_id IS NULL
      AND pam.is_clone = false
      AND (
        pam.lesson_date = ${lessonDate}
        OR (pam.lesson_date IS NULL AND DATE(pam.created_at AT TIME ZONE 'Asia/Seoul') = ${lessonDate}::date)
      )
      ${uploadedBy ? sql`AND pam.uploaded_by = ${uploadedBy}` : sql``}
    ORDER BY pam.created_at ASC
  `);

  return rows.rows as unknown as PhotoRecord[];
}

/**
 * 사진을 일지 공통으로 연결 (Photo Clone 방식)
 *
 * A. draft & 미연결 → 기존 row를 공통으로 UPDATE
 * B. 이미 동일 diary 공통 연결 → 멱등 성공
 * C. 다른 곳에 연결됨 → 동일 object_key로 clone row 생성 후 공통 연결
 */
export async function attachPhotosToDiary(
  diaryId: string,
  photoIds: string[],
  poolId: string,
  actor?: MediaActorContext
): Promise<AttachResult[]> {
  if (!photoIds.length) return [];

  const uniqueIds = [...new Set(photoIds)];

  const diaryRow = await db.execute(sql`
    SELECT id, class_group_id, is_deleted FROM class_diaries
    WHERE id = ${diaryId} AND swimming_pool_id = ${poolId}
    LIMIT 1
  `);
  const diary = diaryRow.rows[0] as any;
  if (!diary) throw new Error("일지를 찾을 수 없습니다.");
  if (diary.is_deleted) throw new Error("삭제된 일지에는 사진을 연결할 수 없습니다.");

  const results: AttachResult[] = [];

  for (const photoId of uniqueIds) {
    try {
      // 해당 사진 조회
      const photoRow = await db.execute(sql`
        SELECT * FROM photo_assets_meta
        WHERE id = ${photoId} AND pool_id = ${poolId}
          AND media_status <> 'uploading'
        LIMIT 1
      `);
      const photo = photoRow.rows[0] as any;

      if (!photo) {
        results.push({ requestedPhotoId: photoId, attachedPhotoId: null, action: "not_found", error: "사진을 찾을 수 없습니다." });
        continue;
      }

      // Case B: 이미 동일 diary 공통으로 연결된 경우 — 멱등 성공
      if (photo.media_status === "attached" && photo.journal_id === diaryId && photo.student_note_id === null && photo.student_id === null) {
        results.push({ requestedPhotoId: photoId, attachedPhotoId: photoId, action: "already_attached" });
        continue;
      }

      // 멱등성 체크: 같은 원본 계열이 이 diary에 공통 연결로 이미 있는지 확인
      const rootId = getRootId(photo);
      const existingCommon = await db.execute(sql`
        SELECT id FROM photo_assets_meta
        WHERE (id = ${rootId} OR source_photo_id = ${rootId})
          AND journal_id = ${diaryId}
          AND student_note_id IS NULL
          AND student_id IS NULL
          AND media_status = 'attached'
          AND pool_id = ${poolId}
        LIMIT 1
      `);
      if ((existingCommon.rows as any[]).length > 0) {
        const existingId = (existingCommon.rows[0] as any).id;
        results.push({ requestedPhotoId: photoId, attachedPhotoId: existingId, action: "already_attached" });
        continue;
      }

      // Case A: draft이고 어디에도 연결 안 됨 → 기존 row UPDATE
      if (photo.media_status === "draft" && !photo.journal_id && !photo.student_note_id) {
        await db.execute(sql`
          UPDATE photo_assets_meta
          SET journal_id = ${diaryId},
              class_id = COALESCE(class_id, ${diary.class_group_id}),
              media_status = 'attached'
          WHERE id = ${photoId} AND pool_id = ${poolId}
        `);
        results.push({ requestedPhotoId: photoId, attachedPhotoId: photoId, action: "attached" });
        continue;
      }

      // Case C: 이미 다른 곳에 연결됨 (개별 일지 or 다른 diary) → clone row 생성
      const cloneId = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO photo_assets_meta
          (id, pool_id, album_type, class_id, student_id, student_note_id, journal_id,
           object_key, file_size, uploaded_by, uploaded_by_name, lesson_date,
           media_status, caption, source_photo_id, is_clone)
        VALUES
          (${cloneId}, ${poolId}, ${photo.album_type}, ${diary.class_group_id},
           NULL, NULL, ${diaryId},
           ${photo.object_key}, ${photo.file_size}, ${photo.uploaded_by},
           ${photo.uploaded_by_name}, ${photo.lesson_date},
           'attached', ${photo.caption}, ${rootId}, true)
        ON CONFLICT (source_photo_id, journal_id)
          WHERE is_clone = true AND student_note_id IS NULL AND journal_id IS NOT NULL AND source_photo_id IS NOT NULL
        DO NOTHING
      `);

      // ON CONFLICT DO NOTHING 후 실제로 삽입됐는지 확인
      const insertedCheck = await db.execute(sql`
        SELECT id FROM photo_assets_meta
        WHERE (id = ${cloneId} OR (source_photo_id = ${rootId} AND journal_id = ${diaryId} AND student_note_id IS NULL AND is_clone = true))
          AND pool_id = ${poolId}
        LIMIT 1
      `);
      const finalId = (insertedCheck.rows[0] as any)?.id ?? cloneId;
      results.push({ requestedPhotoId: photoId, attachedPhotoId: finalId, action: "cloned" });

    } catch (e: any) {
      console.error(`[attachPhotosToDiary] photo_id=${photoId} error:`, e.message);
      results.push({ requestedPhotoId: photoId, attachedPhotoId: null, action: "failed", error: e.message });
    }
  }

  if (actor) {
    const attachedIds = results.filter(r => r.attachedPhotoId).map(r => r.attachedPhotoId!);
    if (attachedIds.length > 0) {
      logMediaAudit({ action: "attach", diaryId, photoIds: attachedIds, actor }).catch(() => {});
    }
  }

  return results;
}

/**
 * 사진을 학생 노트에 연결 (Photo Clone 방식)
 *
 * A. draft & 미연결 → 기존 row를 해당 학생 note에 UPDATE
 * B. 이미 동일 noteId에 연결 → 멱등 성공
 * C. 공통 일지에 연결됨 → clone row 생성 후 학생 note에 연결
 * D. 다른 학생 note에 연결됨 → clone row 생성 후 현재 학생 note에 연결
 */
export async function attachPhotosToStudentNote(
  diaryId: string,
  noteId: string,
  studentId: string,
  photoIds: string[],
  poolId: string,
  actor?: MediaActorContext
): Promise<AttachResult[]> {
  if (!photoIds.length) return [];

  const noteRow = await db.execute(sql`
    SELECT sn.id, sn.student_id, sn.diary_id
    FROM class_diary_student_notes sn
    JOIN class_diaries cd ON cd.id = sn.diary_id AND cd.is_deleted = false
    WHERE sn.id = ${noteId} AND sn.diary_id = ${diaryId} AND sn.student_id = ${studentId}
      AND sn.is_deleted = false
    LIMIT 1
  `);
  if (!noteRow.rows.length) throw new Error("학생 노트를 찾을 수 없습니다.");

  const diaryRow = await db.execute(sql`
    SELECT class_group_id FROM class_diaries WHERE id = ${diaryId} AND swimming_pool_id = ${poolId} LIMIT 1
  `);
  const classId = (diaryRow.rows[0] as any)?.class_group_id ?? null;

  const results: AttachResult[] = [];

  for (const photoId of [...new Set(photoIds)]) {
    try {
      const photoRow = await db.execute(sql`
        SELECT * FROM photo_assets_meta
        WHERE id = ${photoId} AND pool_id = ${poolId}
          AND media_status <> 'uploading'
        LIMIT 1
      `);
      const photo = photoRow.rows[0] as any;

      if (!photo) {
        results.push({ requestedPhotoId: photoId, attachedPhotoId: null, action: "not_found", error: "사진을 찾을 수 없습니다." });
        continue;
      }

      // Case B: 이미 동일 noteId에 연결 → 멱등 성공
      if (photo.media_status === "attached" && photo.student_note_id === noteId) {
        results.push({ requestedPhotoId: photoId, attachedPhotoId: photoId, studentNoteId: noteId, action: "already_attached" });
        continue;
      }

      // 멱등성 체크: 같은 원본 계열이 이 noteId에 이미 연결됐는지 확인
      const rootId = getRootId(photo);
      const existingForNote = await db.execute(sql`
        SELECT id FROM photo_assets_meta
        WHERE (id = ${rootId} OR source_photo_id = ${rootId})
          AND student_note_id = ${noteId}
          AND media_status = 'attached'
          AND pool_id = ${poolId}
        LIMIT 1
      `);
      if ((existingForNote.rows as any[]).length > 0) {
        const existingId = (existingForNote.rows[0] as any).id;
        results.push({ requestedPhotoId: photoId, attachedPhotoId: existingId, studentNoteId: noteId, action: "already_attached" });
        continue;
      }

      // Case A: draft이고 미연결 → 기존 row UPDATE
      if (photo.media_status === "draft" && !photo.journal_id && !photo.student_note_id) {
        await db.execute(sql`
          UPDATE photo_assets_meta
          SET student_note_id = ${noteId},
              student_id = ${studentId},
              journal_id = ${diaryId},
              class_id = COALESCE(class_id, ${classId}),
              media_status = 'attached'
          WHERE id = ${photoId} AND pool_id = ${poolId}
        `);
        results.push({ requestedPhotoId: photoId, attachedPhotoId: photoId, studentNoteId: noteId, action: "attached" });
        continue;
      }

      // Cases C & D: 이미 공통 또는 다른 note에 연결 → clone row 생성
      const cloneId = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO photo_assets_meta
          (id, pool_id, album_type, class_id, student_id, student_note_id, journal_id,
           object_key, file_size, uploaded_by, uploaded_by_name, lesson_date,
           media_status, caption, source_photo_id, is_clone)
        VALUES
          (${cloneId}, ${poolId}, 'private', ${classId},
           ${studentId}, ${noteId}, ${diaryId},
           ${photo.object_key}, ${photo.file_size}, ${photo.uploaded_by},
           ${photo.uploaded_by_name}, ${photo.lesson_date},
           'attached', ${photo.caption}, ${rootId}, true)
        ON CONFLICT (source_photo_id, student_note_id)
          WHERE is_clone = true AND student_note_id IS NOT NULL AND source_photo_id IS NOT NULL
        DO NOTHING
      `);

      // ON CONFLICT 후 실제 row 확인
      const insertedCheck = await db.execute(sql`
        SELECT id FROM photo_assets_meta
        WHERE (id = ${cloneId} OR (source_photo_id = ${rootId} AND student_note_id = ${noteId} AND is_clone = true))
          AND pool_id = ${poolId}
        LIMIT 1
      `);
      const finalId = (insertedCheck.rows[0] as any)?.id ?? cloneId;
      results.push({ requestedPhotoId: photoId, attachedPhotoId: finalId, studentNoteId: noteId, action: "cloned" });

    } catch (e: any) {
      console.error(`[attachPhotosToStudentNote] photo_id=${photoId} error:`, e.message);
      results.push({ requestedPhotoId: photoId, attachedPhotoId: null, action: "failed", error: e.message });
    }
  }

  if (actor) {
    const attachedIds = results.filter(r => r.attachedPhotoId).map(r => r.attachedPhotoId!);
    if (attachedIds.length > 0) {
      logMediaAudit({ action: "note_attach", diaryId, noteId, photoIds: attachedIds, actor }).catch(() => {});
    }
  }

  return results;
}

/**
 * 사진을 일지에서 분리 (일지 수정 시 선택 해제)
 * - clone row → DELETE (독립적 존재 없음)
 * - 원본 row → media_status='draft'로 복원
 */
export async function detachPhotosFromDiary(
  photoIds: string[],
  poolId: string,
  actor?: MediaActorContext,
  diaryId?: string
): Promise<void> {
  if (!photoIds.length) return;

  for (const photoId of photoIds) {
    const photoRow = await db.execute(sql`
      SELECT id, is_clone FROM photo_assets_meta
      WHERE id = ${photoId} AND pool_id = ${poolId}
        AND media_status <> 'uploading'
      LIMIT 1
    `);
    const photo = photoRow.rows[0] as any;
    if (!photo) continue;

    if (photo.is_clone) {
      // clone row는 삭제 (원본 파일은 건드리지 않음)
      await db.execute(sql`
        DELETE FROM photo_assets_meta
        WHERE id = ${photoId} AND pool_id = ${poolId} AND is_clone = true
      `);
    } else {
      // 원본 row는 draft로 복원
      await db.execute(sql`
        UPDATE photo_assets_meta
        SET journal_id = NULL,
            student_note_id = NULL,
            student_id = NULL,
            media_status = 'draft'
        WHERE id = ${photoId} AND pool_id = ${poolId}
      `);
    }
  }

  if (actor) {
    logMediaAudit({ action: "detach", diaryId, photoIds, actor }).catch(() => {});
  }
}

/**
 * 일지 삭제 시 연결된 사진 처리
 * - clone row → DELETE (더 이상 필요 없음)
 * - 원본 row → journal_id 해제 + media_status='detached'
 */
export async function handleDiaryDeleted(
  diaryId: string,
  poolId: string,
  actor?: MediaActorContext
): Promise<void> {
  // audit용 영향 photo_id 수집
  let affectedIds: string[] = [];
  if (actor) {
    const ids = await db.execute(sql`
      SELECT id FROM photo_assets_meta WHERE journal_id = ${diaryId} AND pool_id = ${poolId}
    `);
    affectedIds = (ids.rows as any[]).map((r: any) => r.id);
  }

  // clone row 삭제
  await db.execute(sql`
    DELETE FROM photo_assets_meta
    WHERE journal_id = ${diaryId}
      AND pool_id = ${poolId}
      AND is_clone = true
  `);

  // 원본 row detach
  await db.execute(sql`
    UPDATE photo_assets_meta
    SET journal_id = NULL,
        student_note_id = NULL,
        media_status = 'detached'
    WHERE journal_id = ${diaryId}
      AND pool_id = ${poolId}
      AND is_clone = false
  `);

  if (actor && affectedIds.length > 0) {
    logMediaAudit({ action: "detach_deleted", diaryId, photoIds: affectedIds, actor }).catch(() => {});
  }
}

/**
 * 특정 photo_assets_meta row 삭제 전 R2 파일 삭제 가능 여부 확인
 * 같은 object_key를 공유하는 다른 row가 있으면 R2 삭제 금지
 */
export async function canDeleteR2Object(photoId: string, objectKey: string, poolId: string): Promise<boolean> {
  const siblingRow = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM photo_assets_meta
    WHERE object_key = ${objectKey}
      AND id != ${photoId}
  `);
  const cnt = Number((siblingRow.rows[0] as any)?.cnt ?? 0);
  return cnt === 0;
}

/**
 * 사진 보관 처리 (장기 미사용 정리용)
 * clone row는 보관 대상에서 제외 (원본 처리 시 같이 정리됨)
 */
export async function archiveMedia(
  photoIds: string[],
  poolId: string,
  actor?: MediaActorContext
): Promise<void> {
  if (!photoIds.length) return;
  const literal = toArray(photoIds);
  await db.execute(sql`
    UPDATE photo_assets_meta
    SET media_status = 'archived'
    WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId} AND is_clone = false
  `);

  if (actor) {
    logMediaAudit({ action: "archive", photoIds, actor }).catch(() => {});
  }
}

/**
 * Dry-run: 데이터 정합성 점검
 * - 삭제 일지 참조 사진
 * - student_note_id O + student_id NULL
 * - journal_id/note diary 불일치
 * - clone 관련 정합성
 */
export async function runDataCleanupPreview(poolId: string): Promise<{
  orphanedByDeletedDiary: number;
  noteMissingStudentId: number;
  noteDiaryMismatch: number;
  orphanedClones: number;
  total: number;
}> {
  const [r1, r2, r3, r4] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM photo_assets_meta pam
      JOIN class_diaries cd ON cd.id = pam.journal_id
      WHERE pam.pool_id = ${poolId}
        AND pam.journal_id IS NOT NULL
        AND cd.is_deleted = true
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM photo_assets_meta
      WHERE pool_id = ${poolId}
        AND student_note_id IS NOT NULL
        AND student_id IS NULL
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM photo_assets_meta pam
      JOIN class_diary_student_notes csn ON csn.id = pam.student_note_id
      WHERE pam.pool_id = ${poolId}
        AND pam.student_note_id IS NOT NULL
        AND pam.journal_id IS NOT NULL
        AND csn.diary_id != pam.journal_id
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM photo_assets_meta pam
      WHERE pam.pool_id = ${poolId}
        AND pam.is_clone = true
        AND pam.source_photo_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM photo_assets_meta src
          WHERE src.id = pam.source_photo_id
        )
    `),
  ]);

  const a = Number((r1.rows[0] as any)?.cnt ?? 0);
  const b = Number((r2.rows[0] as any)?.cnt ?? 0);
  const c = Number((r3.rows[0] as any)?.cnt ?? 0);
  const d = Number((r4.rows[0] as any)?.cnt ?? 0);
  return { orphanedByDeletedDiary: a, noteMissingStudentId: b, noteDiaryMismatch: c, orphanedClones: d, total: a + b + c + d };
}
