/**
 * MediaService — Media Engine v2
 *
 * photo_assets_meta를 단일 Source of Truth로 사용.
 * 모든 일지 사진 조회·연결·해제는 이 서비스를 통해서만 처리한다.
 *
 * media_status 규칙:
 *   'draft'    — 업로드 완료, 일지 미연결
 *   'attached' — 일지/노트에 연결됨
 *   'detached' — 일지 삭제 후 해제됨 (파일은 유지)
 *   'archived' — 장기 미사용 / 정리 대상
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

function toArray(literal: string[]): string {
  return `{${literal.join(",")}}`;
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
 * class_id + lesson_date + media_status='draft' 기준
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
           '/api/photos/' || pam.id || '/file' AS file_url,
           s.name AS student_name
    FROM photo_assets_meta pam
    LEFT JOIN students s ON s.id = pam.student_id
    WHERE pam.class_id = ${classId}
      AND pam.pool_id = ${poolId}
      AND pam.media_status = 'draft'
      AND pam.journal_id IS NULL
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
 * 사진을 일지에 연결 (media_status: draft→attached)
 * photo_ids 소속·중복·상태 검증 포함
 */
export async function attachPhotosToDiary(
  diaryId: string,
  photoIds: string[],
  poolId: string,
  actor?: MediaActorContext
): Promise<void> {
  if (!photoIds.length) return;

  // 중복 ID 제거
  const uniqueIds = [...new Set(photoIds)];

  const diaryRow = await db.execute(sql`
    SELECT id, class_group_id, is_deleted FROM class_diaries
    WHERE id = ${diaryId} AND swimming_pool_id = ${poolId}
    LIMIT 1
  `);
  const diary = diaryRow.rows[0] as any;
  if (!diary) throw new Error("일지를 찾을 수 없습니다.");
  if (diary.is_deleted) throw new Error("삭제된 일지에는 사진을 연결할 수 없습니다.");

  const literal = toArray(uniqueIds);

  const checkRow = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM photo_assets_meta
    WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
  `);
  const found = Number((checkRow.rows[0] as any)?.cnt ?? 0);
  if (found !== uniqueIds.length) {
    throw new Error("일부 사진에 대한 접근 권한이 없습니다.");
  }

  // 이미 attached 상태 사진 중복 연결 방지 (TEST F)
  const alreadyAttached = await db.execute(sql`
    SELECT id FROM photo_assets_meta
    WHERE id = ANY(${literal}::text[]) AND media_status = 'attached'
  `);
  if ((alreadyAttached.rows as any[]).length > 0) {
    const ids = (alreadyAttached.rows as any[]).map((r: any) => r.id).join(", ");
    throw new Error(`이미 다른 일지에 연결된 사진이 포함되어 있습니다: ${ids}`);
  }

  await db.execute(sql`
    UPDATE photo_assets_meta
    SET journal_id = ${diaryId},
        class_id = COALESCE(class_id, ${diary.class_group_id}),
        media_status = 'attached'
    WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
  `);

  if (actor) {
    logMediaAudit({ action: "attach", diaryId, photoIds: uniqueIds, actor }).catch(() => {});
  }
}

/**
 * 사진을 학생 노트에 연결 (student_id, student_note_id, journal_id 동시 설정)
 * 버그 3 수정: student_id 동시 설정
 */
export async function attachPhotosToStudentNote(
  diaryId: string,
  noteId: string,
  studentId: string,
  photoIds: string[],
  poolId: string,
  actor?: MediaActorContext
): Promise<void> {
  if (!photoIds.length) return;

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

  const literal = toArray(photoIds);

  const checkRow = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM photo_assets_meta
    WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
  `);
  if (Number((checkRow.rows[0] as any)?.cnt ?? 0) !== photoIds.length) {
    throw new Error("일부 사진에 대한 접근 권한이 없습니다.");
  }

  // 이미 attached 상태 사진 중복 연결 방지
  const alreadyAttached = await db.execute(sql`
    SELECT id FROM photo_assets_meta
    WHERE id = ANY(${literal}::text[]) AND media_status = 'attached'
  `);
  if ((alreadyAttached.rows as any[]).length > 0) {
    const ids = (alreadyAttached.rows as any[]).map((r: any) => r.id).join(", ");
    throw new Error(`이미 다른 일지에 연결된 사진이 포함되어 있습니다: ${ids}`);
  }

  await db.execute(sql`
    UPDATE photo_assets_meta
    SET student_note_id = ${noteId},
        student_id = ${studentId},
        journal_id = COALESCE(journal_id, ${diaryId}),
        class_id = COALESCE(class_id, ${classId}),
        media_status = 'attached'
    WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
  `);

  if (actor) {
    logMediaAudit({ action: "note_attach", diaryId, noteId, photoIds, actor }).catch(() => {});
  }
}

/**
 * 사진을 일지에서 분리 (일지 수정 시 선택 해제)
 * media_status: attached→draft (재선택 가능)
 */
export async function detachPhotosFromDiary(
  photoIds: string[],
  poolId: string,
  actor?: MediaActorContext,
  diaryId?: string
): Promise<void> {
  if (!photoIds.length) return;
  const literal = toArray(photoIds);
  await db.execute(sql`
    UPDATE photo_assets_meta
    SET journal_id = NULL,
        student_note_id = NULL,
        media_status = 'draft'
    WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
  `);

  if (actor) {
    logMediaAudit({ action: "detach", diaryId, photoIds, actor }).catch(() => {});
  }
}

/**
 * 일지 삭제 시 연결된 사진 처리
 * journal_id 해제 + media_status='detached'
 * class_diaries soft delete와 동일 transaction에서 호출
 */
export async function handleDiaryDeleted(
  diaryId: string,
  poolId: string,
  actor?: MediaActorContext
): Promise<void> {
  // 삭제 전 영향받을 사진 ID 목록 수집 (audit용)
  let affectedIds: string[] = [];
  if (actor) {
    const ids = await db.execute(sql`
      SELECT id FROM photo_assets_meta WHERE journal_id = ${diaryId} AND pool_id = ${poolId}
    `);
    affectedIds = (ids.rows as any[]).map((r: any) => r.id);
  }

  await db.execute(sql`
    UPDATE photo_assets_meta
    SET journal_id = NULL,
        student_note_id = NULL,
        media_status = 'detached'
    WHERE journal_id = ${diaryId}
      AND pool_id = ${poolId}
  `);

  if (actor && affectedIds.length > 0) {
    logMediaAudit({ action: "detach_deleted", diaryId, photoIds: affectedIds, actor }).catch(() => {});
  }
}

/**
 * 사진 보관 처리 (장기 미사용 정리용)
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
    WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
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
 */
export async function runDataCleanupPreview(poolId: string): Promise<{
  orphanedByDeletedDiary: number;
  noteMissingStudentId: number;
  noteDiaryMismatch: number;
  total: number;
}> {
  const [r1, r2, r3] = await Promise.all([
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
  ]);

  const a = Number((r1.rows[0] as any)?.cnt ?? 0);
  const b = Number((r2.rows[0] as any)?.cnt ?? 0);
  const c = Number((r3.rows[0] as any)?.cnt ?? 0);
  return { orphanedByDeletedDiary: a, noteMissingStudentId: b, noteDiaryMismatch: c, total: a + b + c };
}
