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

    // 반 이력 종료
    await closeAllActiveClassHistory(tx, studentId, effDate);

    // students row soft delete (데이터 보존 필요 — 재등록 감지 등)
    await tx.execute(sql`
      UPDATE students SET
        status               = 'withdrawn',
        class_group_id       = NULL,
        assigned_class_ids   = '[]'::jsonb,
        schedule_labels      = NULL,
        withdrawn_at         = NOW(),
        suspended_at         = NULL,
        education_started_at = NULL,
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
  });

  // ── 4. R2 object 삭제 (transaction 완료 후 best-effort) ───────────────────
  let r2DeletedCount = 0;
  let r2FailedCount  = 0;

  if (allR2Keys.length > 0) {
    try {
      const { Client } = await import("@replit/object-storage");
      const client = new Client();
      const results = await Promise.allSettled(
        allR2Keys.map(key => client.delete(key).catch(() => {})),
      );
      for (const r of results) {
        if (r.status === "fulfilled") r2DeletedCount++;
        else r2FailedCount++;
      }
    } catch (e) {
      console.error(`[withdraw-student] R2 삭제 오류 (student: ${studentId}):`, e);
      r2FailedCount = allR2Keys.length;
    }
  }

  console.log(
    `[withdraw-student] ✅ student=${studentId} pool=${poolId} actor=${actor.userId}(${actor.role}) ` +
    `tables=[${deletedTables.join(", ")}] r2=${r2DeletedCount}/${allR2Keys.length}`,
  );

  return {
    success: true,
    studentId,
    r2DeletedCount,
    r2FailedCount,
    deletedTables,
  };
}
