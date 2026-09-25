/**
 * withdraw-student-service.ts — Canonical withdraw logic
 *
 * 퇴원은 반드시 이 함수를 통해서만 실행.
 * APP (`/students/:id/change-status {new_status:'withdrawn'}`) 과
 * WEB (`/admin/students/:id/withdraw`) 가 모두 이 함수를 호출.
 *
 * 삭제 정책 (§14 기준):
 *   DELETE  : student_photos (DB + R2), parent_students,
 *             class_diary_student_notes (해당 학생 note만), swim_diary,
 *             growth_events, growth_reports, admin_member_notes,
 *             student_curriculum_assignments, student_curriculum_progress,
 *             curriculum_progress_observations, student_levels,
 *             parent_curriculum_conversations + messages,
 *             makeup_sessions, diary_messages (student_id col),
 *             diary_reactions (student_id col),
 *             parent_student_requests, video_assets_meta, student_videos,
 *             photo_assets_meta (student-owned rows)
 *   KEEP    : attendance (정산), student_class_history (audit),
 *             member_activity_logs (audit), students row (soft)
 *
 * class_diaries 원본 (공유 일지) 삭제 금지.
 * 다른 학생 데이터 변경 금지.
 */

import { sql } from "drizzle-orm";
import { kstTodayStr, closeAllActiveClassHistory } from "../utils/historyUtils.js";
import { hashArchivePhone } from "./archive-phone-hash.js";

export interface WithdrawActor {
  userId: string;
  role: string;
  name?: string;
}

export interface WithdrawResult {
  success: true;
  studentId: string;
  r2DeletedCount: number;
  r2FailedCount: number;
  deletedTables: string[];
}

/**
 * withdrawStudent — canonical 퇴원 처리
 *
 * @param db          운영 DB (pool db)
 * @param studentId   퇴원 대상 student.id
 * @param poolId      수영장 ID (pool guard)
 * @param actor       처리자 정보 (audit log용)
 * @returns           삭제 결과 요약
 * @throws            "STUDENT_NOT_FOUND" | "ALREADY_WITHDRAWN" | "POOL_MISMATCH" | Error
 */
export async function withdrawStudent(
  db: any,
  studentId: string,
  poolId: string,
  actor: WithdrawActor,
): Promise<WithdrawResult> {
  // ── 1. 학생 조회 ────────────────────────────────────────────────────────────
  const [student] = (await db.execute(sql`
    SELECT id, name, status, swimming_pool_id, class_group_id
    FROM students WHERE id = ${studentId} LIMIT 1
  `)).rows as any[];

  if (!student) throw new Error("STUDENT_NOT_FOUND");
  if (student.swimming_pool_id !== poolId) throw new Error("POOL_MISMATCH");
  if (student.status === "withdrawn") throw new Error("ALREADY_WITHDRAWN");

  // ── 2. R2 삭제 대상 미리 수집 (transaction 전 — 조회만) ────────────────────
  const photoRows = (await db.execute(sql`
    SELECT id, storage_key FROM student_photos
    WHERE student_id = ${studentId} AND storage_key IS NOT NULL
  `)).rows as { id: string; storage_key: string }[];

  const videoRows = (await db.execute(sql`
    SELECT id, storage_key FROM student_videos
    WHERE student_id = ${studentId} AND storage_key IS NOT NULL
  `)).rows as { id: string; storage_key: string }[];

  const photoAssetRows = (await db.execute(sql`
    SELECT id, storage_key FROM photo_assets_meta
    WHERE student_id = ${studentId} AND storage_key IS NOT NULL
  `)).rows as { id: string; storage_key: string }[];

  const videoAssetRows = (await db.execute(sql`
    SELECT id, storage_key FROM video_assets_meta
    WHERE student_id = ${studentId} AND storage_key IS NOT NULL
  `)).rows as { id: string; storage_key: string }[];

  const allR2Keys = [
    ...photoRows.map(r => r.storage_key),
    ...videoRows.map(r => r.storage_key),
    ...photoAssetRows.map(r => r.storage_key),
    ...videoAssetRows.map(r => r.storage_key),
  ].filter(Boolean);

  // ── 3. DB transaction — 순서 중요 (자식 → 부모) ────────────────────────────
  const deletedTables: string[] = [];
  const effDate = kstTodayStr();

  await db.transaction(async (tx: any) => {
    // SELECT FOR UPDATE — 동시 퇴원 직렬화
    const locked = (await tx.execute(sql`
      SELECT id FROM students WHERE id = ${studentId} LIMIT 1 FOR UPDATE
    `)).rows[0];
    if (!locked) throw new Error("STUDENT_NOT_FOUND");

    // ── [ARCHIVE] SELECT FOR UPDATE 직후, 교육데이터 DELETE 전 ──────────────
    // Archive 실패 시 throw → transaction rollback → withdraw 취소
    const { randomUUID } = await import("crypto");

    // Archive member 기본 정보 수집
    const [studentFull] = (await tx.execute(sql`
      SELECT s.name, s.birth_year, s.parent_phone, s.withdrawn_at,
             cg.name AS class_name
      FROM students s
      LEFT JOIN class_groups cg ON cg.id = s.class_group_id
      WHERE s.id = ${studentId} LIMIT 1
    `)).rows as any[];

    const [lastLevel] = (await tx.execute(sql`
      SELECT level_order FROM student_levels
      WHERE student_id = ${studentId}
      ORDER BY level_order DESC LIMIT 1
    `)).rows as any[];

    const phoneHash = (await import("./archive-phone-hash.js")).hashArchivePhone(
      studentFull?.parent_phone ?? null,
    );

    const archiveMemberId = randomUUID();
    await tx.execute(sql`
      INSERT INTO withdrawn_member_archives
        (id, pool_id, original_student_id, student_name, birth_year,
         last_class_name, last_level_order, withdrawn_at,
         withdrawn_by_id, withdrawn_by_name, parent_phone_hash, created_at)
      VALUES (
        ${archiveMemberId}, ${poolId}, ${studentId},
        ${studentFull?.name ?? student.name},
        ${studentFull?.birth_year ?? null},
        ${studentFull?.class_name ?? null},
        ${lastLevel?.level_order ?? null},
        NOW(),
        ${actor.userId}, ${actor.name ?? actor.role},
        ${phoneHash},
        NOW()
      )
      ON CONFLICT (original_student_id) DO NOTHING
    `);

    // Archive diary snapshot — historical scope (education_started_at 미적용)
    // 해당 학생이 실제로 귀속됐던 모든 반의 수업일지 (재원기간 기준, 결석 제외, 보강 포함)
    const studentIdSafe = studentId.replace(/'/g, "''");
    const histRows = (await tx.execute(sql.raw(`
      SELECT DISTINCT class_group_id FROM (
        SELECT class_group_id FROM student_class_history
        WHERE student_id = '${studentIdSafe}' AND class_group_id IS NOT NULL
        UNION
        SELECT class_group_id FROM students
        WHERE id = '${studentIdSafe}' AND class_group_id IS NOT NULL
        UNION
        SELECT assigned_class_group_id AS class_group_id FROM makeup_sessions
        WHERE student_id = '${studentIdSafe}' AND status = 'completed'
          AND assigned_class_group_id IS NOT NULL
      ) t
    `))).rows as any[];
    const allClassIds = (histRows as any[]).map((r: any) => r.class_group_id);

    if (allClassIds.length > 0) {
      const idsLiteral = allClassIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(",");
      const diaryRows = (await tx.execute(sql.raw(`
        SELECT sub.id AS diary_id, sub.lesson_date, sub.common_content,
               sub.teacher_name, sub.class_group_name, sub.is_makeup_diary,
               sub.original_created_at,
               csn.note_content AS student_note
        FROM (
          SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.created_at AS original_created_at,
                 cg.name AS class_group_name,
                 (ms.id IS NOT NULL) AS is_makeup_diary,
                 ROW_NUMBER() OVER (PARTITION BY cd.id ORDER BY ms.id NULLS LAST) AS rn
          FROM class_diaries cd
          LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
          LEFT JOIN student_class_history sch
            ON sch.class_group_id = cd.class_group_id
            AND sch.student_id = '${studentIdSafe}'
            AND sch.enrolled_at <= cd.lesson_date::date
            AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
          LEFT JOIN makeup_sessions ms
            ON ms.assigned_class_group_id = cd.class_group_id
            AND ms.student_id = '${studentIdSafe}'
            AND ms.assigned_date = cd.lesson_date
            AND ms.status = 'completed'
          WHERE cd.is_deleted = false
            AND cd.lesson_date::date >= (
              SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
              FROM students WHERE id = '${studentIdSafe}' LIMIT 1
            )
            AND cd.class_group_id IN (${idsLiteral})
            AND (
              (
                (
                  sch.id IS NOT NULL
                  OR EXISTS (
                    SELECT 1 FROM students s2
                    WHERE s2.id = '${studentIdSafe}'
                      AND s2.class_group_id = cd.class_group_id
                  )
                )
                AND NOT EXISTS (
                  SELECT 1 FROM attendance a
                  WHERE a.student_id = '${studentIdSafe}'
                    AND a.class_group_id = cd.class_group_id
                    AND a.date = cd.lesson_date
                    AND a.status = 'absent'
                )
              )
              OR ms.id IS NOT NULL
            )
        ) sub
        LEFT JOIN class_diary_student_notes csn
          ON csn.diary_id = sub.id
          AND csn.student_id = '${studentIdSafe}'
          AND csn.is_deleted = false
        WHERE sub.rn = 1
        ORDER BY sub.lesson_date DESC
      `))).rows as any[];

      // bulk INSERT — ON CONFLICT DO NOTHING (중복 방지)
      for (const diary of diaryRows) {
        const did = randomUUID();
        await tx.execute(sql`
          INSERT INTO withdrawn_diary_archives
            (id, archive_member_id, original_diary_id, lesson_date,
             former_class_name, former_teacher_name, common_content,
             student_note, is_makeup_diary, original_created_at,
             source_type, archived_at)
          VALUES (
            ${did}, ${archiveMemberId}, ${diary.diary_id}, ${diary.lesson_date},
            ${diary.class_group_name ?? null}, ${diary.teacher_name ?? null},
            ${diary.common_content ?? null}, ${diary.student_note ?? null},
            ${!!diary.is_makeup_diary}, ${diary.original_created_at ?? null},
            'class_diary', NOW()
          )
          ON CONFLICT (archive_member_id, original_diary_id, source_type) DO NOTHING
        `);
      }
      deletedTables.push(`archive_diaries(${diaryRows.length})`);
    }

    console.log(`[withdraw-student] Archive snapshot created: archiveMemberId=${archiveMemberId} pool=${poolId} student=${studentId}`);
    // ── [/ARCHIVE] ─────────────────────────────────────────────────────────

    // 반 이력 종료
    await closeAllActiveClassHistory(tx, studentId, effDate);

    // students row soft delete + 개인정보 익명화
    // KEEP: id, swimming_pool_id, status='withdrawn', name(audit), withdrawn_at, created_at
    // CLEAR: 연락처/생년/메모 — 재등록 대상에서 영구 제외, 서비스용 개인정보 제거
    await tx.execute(sql`
      UPDATE students SET
        status               = 'withdrawn',
        class_group_id       = NULL,
        assigned_class_ids   = '[]'::jsonb,
        schedule_labels      = NULL,
        withdrawn_at         = NOW(),
        suspended_at         = NULL,
        education_started_at = NULL,
        pending_status_change   = NULL,
        pending_effective_mode  = NULL,
        pending_effective_month = NULL,
        phone                = NULL,
        parent_name          = NULL,
        parent_phone         = NULL,
        parent_phone2        = NULL,
        parent_phone3        = NULL,
        parent_phone4        = NULL,
        parent_user_id       = NULL,
        birth_date           = NULL,
        birth_year           = NULL,
        memo                 = NULL,
        notes                = NULL,
        name_korean          = NULL,
        invite_code          = NULL,
        invite_status        = 'none',
        updated_at           = NOW()
      WHERE id = ${studentId}
    `);

    // ── 교육 데이터 삭제 ──────────────────────────────────────────────────────

    // 학생 개인 일지 노트 (공유 class_diary row는 건드리지 않음)
    const cdsnResult = await tx.execute(sql`
      DELETE FROM class_diary_student_notes WHERE student_id = ${studentId}
    `);
    if (cdsnResult.rowCount > 0) deletedTables.push(`class_diary_student_notes(${cdsnResult.rowCount})`);

    // 개인 swim_diary
    const swimResult = await tx.execute(sql`
      DELETE FROM swim_diary WHERE student_id = ${studentId}
    `);
    if (swimResult.rowCount > 0) deletedTables.push(`swim_diary(${swimResult.rowCount})`);

    // 성장 이벤트
    const geResult = await tx.execute(sql`
      DELETE FROM growth_events WHERE student_id = ${studentId}
    `);
    if (geResult.rowCount > 0) deletedTables.push(`growth_events(${geResult.rowCount})`);

    // 성장 리포트 (전체 — PUBLISHED 포함 삭제, 퇴원은 종료 행위)
    const grResult = await tx.execute(sql`
      DELETE FROM growth_reports WHERE student_id = ${studentId}
    `);
    if (grResult.rowCount > 0) deletedTables.push(`growth_reports(${grResult.rowCount})`);

    // 관리자 노트
    const amnResult = await tx.execute(sql`
      DELETE FROM admin_member_notes WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((amnResult as any).rowCount > 0) deletedTables.push(`admin_member_notes(${(amnResult as any).rowCount})`);

    // curriculum 진도
    const scaResult = await tx.execute(sql`
      DELETE FROM student_curriculum_assignments WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((scaResult as any).rowCount > 0) deletedTables.push(`student_curriculum_assignments(${(scaResult as any).rowCount})`);

    const scpResult = await tx.execute(sql`
      DELETE FROM student_curriculum_progress WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((scpResult as any).rowCount > 0) deletedTables.push(`student_curriculum_progress(${(scpResult as any).rowCount})`);

    const cpoResult = await tx.execute(sql`
      DELETE FROM curriculum_progress_observations WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((cpoResult as any).rowCount > 0) deletedTables.push(`curriculum_progress_observations(${(cpoResult as any).rowCount})`);

    const slResult = await tx.execute(sql`
      DELETE FROM student_levels WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((slResult as any).rowCount > 0) deletedTables.push(`student_levels(${(slResult as any).rowCount})`);

    // 학부모 curriculum 대화 (메시지 먼저 삭제 후 대화 삭제)
    await tx.execute(sql`
      DELETE FROM parent_curriculum_messages
      WHERE conversation_id IN (
        SELECT id FROM parent_curriculum_conversations WHERE student_id = ${studentId}
      )
    `).catch(() => {});
    const pccResult = await tx.execute(sql`
      DELETE FROM parent_curriculum_conversations WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((pccResult as any).rowCount > 0) deletedTables.push(`parent_curriculum_conversations(${(pccResult as any).rowCount})`);

    // 보강 세션
    const msResult = await tx.execute(sql`
      DELETE FROM makeup_sessions WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((msResult as any).rowCount > 0) deletedTables.push(`makeup_sessions(${(msResult as any).rowCount})`);

    // diary_messages (student_id 컬럼 존재 시)
    await tx.execute(sql`
      DELETE FROM diary_messages WHERE student_id = ${studentId}
    `).catch(() => {});

    // diary_reactions (student_id 컬럼 존재 시)
    await tx.execute(sql`
      DELETE FROM diary_reactions WHERE student_id = ${studentId}
    `).catch(() => {});

    // parent_student_requests
    const psrResult = await tx.execute(sql`
      DELETE FROM parent_student_requests WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((psrResult as any).rowCount > 0) deletedTables.push(`parent_student_requests(${(psrResult as any).rowCount})`);

    // ── 미디어 DB rows ────────────────────────────────────────────────────────
    const spResult = await tx.execute(sql`
      DELETE FROM student_photos WHERE student_id = ${studentId}
    `);
    if (spResult.rowCount > 0) deletedTables.push(`student_photos(${spResult.rowCount})`);

    const svResult = await tx.execute(sql`
      DELETE FROM student_videos WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((svResult as any).rowCount > 0) deletedTables.push(`student_videos(${(svResult as any).rowCount})`);

    const pamResult = await tx.execute(sql`
      DELETE FROM photo_assets_meta WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((pamResult as any).rowCount > 0) deletedTables.push(`photo_assets_meta(${(pamResult as any).rowCount})`);

    const vamResult = await tx.execute(sql`
      DELETE FROM video_assets_meta WHERE student_id = ${studentId}
    `).catch(() => ({ rowCount: 0 }));
    if ((vamResult as any).rowCount > 0) deletedTables.push(`video_assets_meta(${(vamResult as any).rowCount})`);

    // ── 학부모-학생 연결 해제 ────────────────────────────────────────────────
    const psResult = await tx.execute(sql`
      DELETE FROM parent_students WHERE student_id = ${studentId}
    `);
    if (psResult.rowCount > 0) deletedTables.push(`parent_students(${psResult.rowCount})`);

    // ── diary_push_queue: 대기 중인 큐에서 퇴원 student_id 제거 ──────────────
    // 다른 학생 ID가 존재하면 해당 row는 유지하면서 student_id만 제거
    await tx.execute(sql`
      UPDATE diary_push_queue
      SET student_ids = (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(student_ids) elem
        WHERE elem::text != ${JSON.stringify(studentId)}
      )
      WHERE sent_at IS NULL
        AND student_ids @> ${JSON.stringify([studentId])}::jsonb
    `);
    // student_ids가 비어진 row 삭제 (or NULL이 된 경우 포함)
    await tx.execute(sql`
      DELETE FROM diary_push_queue
      WHERE sent_at IS NULL
        AND (student_ids IS NULL OR jsonb_array_length(student_ids) = 0)
    `);
    deletedTables.push("diary_push_queue(student_id removed)");
  });

  // ── 4. R2 object 삭제 (transaction 완료 후) ──────────────────────────────
  // 실패 key는 member_activity_logs에 기록 → 수동 재시도 추적 가능 (Option B)
  let r2DeletedCount = 0;
  const r2FailedKeys: string[] = [];

  if (allR2Keys.length > 0) {
    try {
      const { Client } = await import("@replit/object-storage");
      const r2Client = new Client();
      const results = await Promise.allSettled(
        allR2Keys.map(async (key) => {
          await r2Client.delete(key);
          return key;
        }),
      );
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === "fulfilled") {
          r2DeletedCount++;
        } else {
          r2FailedKeys.push(allR2Keys[i]);
        }
      }
    } catch (e) {
      console.error(`[withdraw-student] R2 클라이언트 초기화 오류 (student: ${studentId}):`, e);
      r2FailedKeys.push(...allR2Keys);
    }
  }

  // R2 실패 key를 member_activity_logs에 기록 (재시도 추적)
  if (r2FailedKeys.length > 0) {
    try {
      await db.execute(sql`
        INSERT INTO member_activity_logs
          (id, swimming_pool_id, student_id, action_type, target_type, after_value, actor_id, actor_name, actor_role, note, created_at)
        VALUES
          (gen_random_uuid()::text, ${poolId}, ${studentId}, 'withdraw_r2_failed', 'student',
           ${JSON.stringify({ keys: r2FailedKeys })},
           ${actor.userId}, ${actor.name ?? actor.role}, ${actor.role},
           ${"R2 삭제 실패 " + r2FailedKeys.length + "건 — 수동 재시도 필요"},
           NOW())
      `);
      console.warn(
        `[withdraw-student] ⚠️ R2 삭제 실패 ${r2FailedKeys.length}건 → member_activity_logs 기록 완료. student=${studentId}`,
        r2FailedKeys,
      );
    } catch (logErr) {
      // 로그 INSERT 자체가 실패해도 퇴원 완료는 유지, 단 console.error로 반드시 남김
      console.error(
        `[withdraw-student] ❌ R2 실패 로그 INSERT 오류 (student: ${studentId}):`,
        logErr,
        "failed_keys:", r2FailedKeys,
      );
    }
  }

  console.log(
    `[withdraw-student] ✅ student=${studentId} pool=${poolId} actor=${actor.userId}(${actor.role}) ` +
    `tables=[${deletedTables.join(", ")}] r2=${r2DeletedCount}/${allR2Keys.length} failed=${r2FailedKeys.length}`,
  );

  return {
    success: true,
    studentId,
    r2DeletedCount,
    r2FailedCount: r2FailedKeys.length,
    deletedTables,
  };
}
