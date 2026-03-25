/**
 * routes/restore.ts — 전체 복구 / 수영장별 복구 API (슈퍼관리자 전용)
 *
 * GET  /super/pools/search?q=     — 수영장 검색 (복구 팝업용)
 * POST /super/restore/full        — 전체 DB 복구
 * POST /super/restore/pool        — 수영장별 복구
 * GET  /super/restore/logs        — 복구 이력 조회
 *
 * 복구 흐름:
 *   1. 확인 문구 검증
 *   2. 선백업 (runRealBackup)
 *   3. backup_id로 platform_backups에서 JSON 로드
 *   4. 테이블 복구
 *   5. 복구 대상 테이블 누락 감지 (WARNING)
 *   6. 데이터 무결성 검사 (WARNING)
 *   7. restore_logs 기록 (warning_count, warning_details 포함)
 */
import { Router } from "express";
import crypto from "crypto";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { runRealBackup } from "../lib/backup.js";
import { Client as ObjectStorageClient } from "@replit/object-storage";

const router = Router();

// ── pool_id 기반 직접 복구 대상 테이블 (swimming_pool_id 컬럼 실제 존재 확인됨) ──
// 표준 필터 컬럼: swimming_pool_id (DB 실제 컬럼명)
// pool_id 컬럼 사용 테이블(class_change_logs 등)은 별도 처리 불가 → 제외
const POOL_RESTORE_TABLES = [
  // 핵심 운영 테이블
  "students",
  "class_groups",
  "classes",
  "attendance",
  "class_diaries",
  "class_diary_audit_logs",
  "makeup_sessions",
  "notices",
  "teacher_daily_memos",
  "teacher_schedule_notes",
  "student_photos",
  "student_videos",
  "diary_templates",
  "payment_logs",
  "member_activity_logs",
  "members",
  // 학부모 관련 (정책 확정: pool_id 다르면 별도 계정 → 수영장별 복구 대상)
  "parent_accounts",
  "parent_students",
  "parent_pool_requests",
  // 등록 요청 / 수영 일지 / 인수인계 보강 (swimming_pool_id 확인됨 → 복구 포함)
  "student_registration_requests",
  "swim_diary",
  "manual_handover_makeups",
];

// 플랫폼 전역 테이블: swimming_pool_id 컬럼이 있어도 복구 대상 아님 → 경고 무시
const GLOBAL_TABLES_IGNORE = new Set([
  "users",         // 플랫폼 전역 사용자 계정
  "subscriptions", // 플랫폼 구독 레코드
]);

// 절대 복구하지 않는 테이블 (플랫폼 전역 / 메타 테이블)
const EXCLUDE_FROM_FULL_RESTORE = new Set([
  "platform_backups",
  "backup_logs",
  "restore_logs",
  "backup_snapshots",
  "db_server_snapshots",
  "dead_letter_queue",
  "event_retry_queue",
  "push_tokens",
  "push_logs",
  "push_scheduled_sent",
]);

// ── SQL 값 안전 직렬화 ────────────────────────────────────────────────────────
function escapeSql(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return isFinite(v) ? String(v) : "NULL";
  if (typeof v === "object") {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── 테이블 단건 삽입 ─────────────────────────────────────────────────────────
async function insertRow(tableName: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const colList = cols.map(c => `"${c}"`).join(", ");
  const vals    = cols.map(c => escapeSql(row[c])).join(", ");
  await superAdminDb.execute(
    sql.raw(`INSERT INTO "${tableName}" (${colList}) VALUES (${vals}) ON CONFLICT DO NOTHING`)
  );
}

// ── 백업 JSON 로드 ────────────────────────────────────────────────────────────
async function loadBackupJson(backupId: string): Promise<Record<string, unknown[]>> {
  const rows = (await superAdminDb.execute(sql`
    SELECT storage_type, backup_data, file_path
    FROM platform_backups WHERE id = ${backupId}
  `)).rows as any[];

  const backup = rows[0];
  if (!backup) throw new Error("백업 레코드를 찾을 수 없습니다.");

  let jsonStr: string | null = null;

  if (backup.storage_type === "database") {
    jsonStr = backup.backup_data;
  } else if (backup.storage_type === "object_storage") {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) throw new Error("Object Storage 버킷이 설정되지 않았습니다.");
    const client = new ObjectStorageClient({ bucketId });
    const result = await client.downloadAsText(backup.file_path);
    if (!result.ok) throw new Error(`Object Storage 다운로드 실패: ${JSON.stringify(result.error)}`);
    jsonStr = result.value;
  }

  if (!jsonStr) throw new Error("백업 데이터가 비어 있습니다.");

  const parsed = JSON.parse(jsonStr);
  // 신규 포맷: { meta, tables } / 구 포맷: { meta, super_db, pool_db }
  if (parsed.tables) return parsed.tables as Record<string, unknown[]>;
  const merged: Record<string, unknown[]> = {};
  if (parsed.super_db) Object.assign(merged, parsed.super_db);
  if (parsed.pool_db)  Object.assign(merged, parsed.pool_db);
  return merged;
}

// ════════════════════════════════════════════════════════════════
// 복구 대상 테이블 누락 감지
// DB에서 swimming_pool_id 컬럼을 가진 테이블 목록을 조회하고
// A: 실제 누락(경고), B: 전역(무시), C: 검토필요(review 태그) 3분류
// ════════════════════════════════════════════════════════════════
interface MissingTableResult {
  missing:       string[]; // A: 복구 대상인데 POOL_RESTORE_TABLES 미포함
  ignored:       string[]; // B: 전역 테이블 → 경고 제외
  reviewRequired: string[]; // C: 검토 필요 (현재는 모두 확정됨 → 빈 배열)
}

async function detectMissingTables(): Promise<MissingTableResult> {
  const empty: MissingTableResult = { missing: [], ignored: [], reviewRequired: [] };
  try {
    const rows = (await superAdminDb.execute(sql.raw(`
      SELECT table_name
      FROM information_schema.columns
      WHERE column_name = 'swimming_pool_id'
        AND table_schema = 'public'
      ORDER BY table_name
    `))).rows as { table_name: string }[];

    const dbTables = rows.map(r => r.table_name);
    const poolSet  = new Set(POOL_RESTORE_TABLES);
    const result: MissingTableResult = { missing: [], ignored: [], reviewRequired: [] };

    for (const t of dbTables) {
      if (poolSet.has(t) || EXCLUDE_FROM_FULL_RESTORE.has(t)) continue;
      if (GLOBAL_TABLES_IGNORE.has(t)) {
        result.ignored.push(t);
        console.log(`[restore] 전역 테이블 무시 (경고 제외): ${t}`);
      } else {
        result.missing.push(t);
        console.warn(`[restore] WARNING: 복구 대상 누락 테이블 발견 - ${t}`);
      }
    }
    return result;
  } catch (e: any) {
    console.warn("[restore] 누락 테이블 감지 실패:", e.message);
    return empty;
  }
}

// ════════════════════════════════════════════════════════════════
// 복구 후 데이터 무결성 검사
// poolId 지정 시 해당 수영장 범위만 검사, 없으면 전체 검사
// 반환: 깨진 관계 목록 (빈 배열이면 이상 없음)
// ════════════════════════════════════════════════════════════════
async function checkDataIntegrity(poolId?: string): Promise<string[]> {
  const broken: string[] = [];
  const pf = poolId ? `'${poolId.replace(/'/g, "''")}'` : null;

  // ① 출결 → 학생 연결
  try {
    const where = pf ? `AND a.swimming_pool_id = ${pf}` : "";
    const r = (await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM attendance a
      LEFT JOIN students s ON s.id = a.student_id
      WHERE s.id IS NULL ${where}
    `))).rows[0] as any;
    const cnt = Number(r.cnt);
    if (cnt > 0) {
      const msg = `attendance_without_student: ${cnt}건`;
      broken.push(msg);
      console.warn(`[restore/integrity] ⚠️ 출결→학생 연결 깨짐: ${cnt}건`);
    }
  } catch (e: any) {
    console.warn("[restore/integrity] 출결→학생 검사 실패:", e.message);
  }

  // ② 반 멤버 → 멤버 연결 (class_members.member_id → members)
  try {
    // classes 테이블에 swimming_pool_id 직접 존재
    const poolJoin = pf
      ? `JOIN classes cl ON cl.id = cm.class_id AND cl.swimming_pool_id = ${pf}`
      : "";
    const r = (await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM class_members cm
      ${poolJoin}
      LEFT JOIN members m ON m.id = cm.member_id
      WHERE m.id IS NULL
    `))).rows[0] as any;
    const cnt = Number(r.cnt);
    if (cnt > 0) {
      const msg = `class_member_without_member: ${cnt}건`;
      broken.push(msg);
      console.warn(`[restore/integrity] ⚠️ 반 멤버→멤버 연결 깨짐: ${cnt}건`);
    }
  } catch (e: any) {
    console.warn("[restore/integrity] 반 멤버→멤버 검사 실패:", e.message);
  }

  // ③ 보강 → 출결 연결 (absence_attendance_id → attendance)
  try {
    const where = pf ? `AND ms.swimming_pool_id = ${pf}` : "";
    const r = (await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM makeup_sessions ms
      LEFT JOIN attendance a ON a.id = ms.absence_attendance_id
      WHERE ms.absence_attendance_id IS NOT NULL AND a.id IS NULL ${where}
    `))).rows[0] as any;
    const cnt = Number(r.cnt);
    if (cnt > 0) {
      const msg = `makeup_without_attendance: ${cnt}건`;
      broken.push(msg);
      console.warn(`[restore/integrity] ⚠️ 보강→출결 연결 깨짐: ${cnt}건`);
    }
  } catch (e: any) {
    console.warn("[restore/integrity] 보강→출결 검사 실패 (건너뜀):", e.message);
  }

  // ④ 일지 → 반 연결
  try {
    const where = pf ? `AND cd.swimming_pool_id = ${pf}` : "";
    const r = (await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM class_diaries cd
      LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
      WHERE cg.id IS NULL ${where}
    `))).rows[0] as any;
    const cnt = Number(r.cnt);
    if (cnt > 0) {
      const msg = `diary_without_class_group: ${cnt}건`;
      broken.push(msg);
      console.warn(`[restore/integrity] ⚠️ 일지→반 연결 깨짐: ${cnt}건`);
    }
  } catch (e: any) {
    console.warn("[restore/integrity] 일지→반 검사 실패:", e.message);
  }

  // ⑤a 일지 학생 노트 → 일지 연결 (diary_id → class_diaries)
  // 목적: 일지가 삭제되었는데 노트가 남아 있는 고아 레코드 검사
  try {
    const where = pf
      ? `AND cd.swimming_pool_id = ${pf}`
      : "";
    const r = (await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM class_diary_student_notes cdsn
      LEFT JOIN class_diaries cd ON cd.id = cdsn.diary_id
      WHERE cd.id IS NULL ${where}
    `))).rows[0] as any;
    const cnt = Number(r.cnt);
    if (cnt > 0) {
      const msg = `diary_note_without_diary: ${cnt}건`;
      broken.push(msg);
      console.warn(`[restore/integrity] ⚠️ 일지 학생 노트→일지 연결 깨짐: ${cnt}건`);
    }
  } catch (e: any) {
    console.warn("[restore/integrity] 일지 노트→일지 검사 실패:", e.message);
  }

  // ⑤b 일지 학생 노트 → 학생 연결 (student_id → students)
  // 목적: 학생이 삭제되었는데 노트가 남아 있는 고아 레코드 검사
  try {
    const poolJoin = pf
      ? `JOIN class_diaries cd ON cd.id = cdsn.diary_id AND cd.swimming_pool_id = ${pf}`
      : "";
    const r = (await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM class_diary_student_notes cdsn
      ${poolJoin}
      LEFT JOIN students s ON s.id = cdsn.student_id
      WHERE s.id IS NULL
    `))).rows[0] as any;
    const cnt = Number(r.cnt);
    if (cnt > 0) {
      const msg = `diary_note_without_student: ${cnt}건`;
      broken.push(msg);
      console.warn(`[restore/integrity] ⚠️ 일지 학생 노트→학생 연결 깨짐: ${cnt}건`);
    }
  } catch (e: any) {
    console.warn("[restore/integrity] 일지 학생 노트→학생 검사 실패:", e.message);
  }

  if (broken.length === 0) {
    console.log("[restore/integrity] ✅ 무결성 검사 통과 — 깨진 연결 없음");
  }
  return broken;
}

// ── restore_logs CRUD ─────────────────────────────────────────────────────────
async function insertRestoreLog(opts: {
  id: string;
  restoreType: "full" | "pool";
  poolId?: string;
  backupId: string;
  restorePoint: string;
  triggeredBy: string;
  preBackupId?: string;
}) {
  await superAdminDb.execute(sql`
    INSERT INTO restore_logs
      (id, restore_type, pool_id, backup_id, restore_point,
       triggered_by, pre_backup_id, status, started_at)
    VALUES
      (${opts.id}, ${opts.restoreType}, ${opts.poolId ?? null},
       ${opts.backupId}, ${opts.restorePoint},
       ${opts.triggeredBy}, ${opts.preBackupId ?? null},
       'running', NOW())
  `);
}

async function finishRestoreLog(
  id: string,
  status: "success" | "failed",
  opts?: {
    errorMsg?: string;
    warnings?: { count: number; details: Record<string, unknown> };
  }
) {
  const warningCount   = opts?.warnings?.count ?? 0;
  const warningDetails = opts?.warnings?.details ?? null;
  const detailsJson    = warningDetails ? JSON.stringify(warningDetails) : null;

  if (status === "success") {
    await superAdminDb.execute(sql.raw(`
      UPDATE restore_logs
      SET status = 'success',
          finished_at = NOW(),
          warning_count = ${warningCount},
          warning_details = ${detailsJson ? `'${detailsJson.replace(/'/g, "''")}'::jsonb` : "NULL"}
      WHERE id = '${id}'
    `));
  } else {
    const errMsg = (opts?.errorMsg ?? "알 수 없는 오류").replace(/'/g, "''");
    await superAdminDb.execute(sql.raw(`
      UPDATE restore_logs
      SET status = 'failed',
          finished_at = NOW(),
          error_message = '${errMsg}',
          warning_count = ${warningCount},
          warning_details = ${detailsJson ? `'${detailsJson.replace(/'/g, "''")}'::jsonb` : "NULL"}
      WHERE id = '${id}'
    `));
  }
}

// ════════════════════════════════════════════════════════════════
// GET /super/pools/search?q=
// 수영장 검색 (복구 팝업용)
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/pools/search",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const q = String(req.query.q ?? "").trim();
    try {
      const rows = (await superAdminDb.execute(sql`
        SELECT id, name, owner_name, approval_status, subscription_status
        FROM swimming_pools
        WHERE name ILIKE ${"%" + q + "%"}
           OR owner_name ILIKE ${"%" + q + "%"}
        ORDER BY name
        LIMIT 20
      `)).rows;
      res.json({ pools: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/restore/full
// 전체 DB 복구
// body: { backup_id, confirmed_text: "전체 복구" }
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/restore/full",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { backup_id, confirmed_text } = req.body ?? {};

    if (!backup_id)                           return res.status(400).json({ error: "backup_id가 필요합니다." });
    if (confirmed_text !== "전체 복구")        return res.status(400).json({ error: "확인 문구 오류: '전체 복구'를 정확히 입력하세요." });

    const triggeredBy = req.user?.name ?? req.user?.id ?? "super_admin";
    const logId = `rl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    let preBackupId: string | undefined;

    try {
      // 1. 선백업
      console.log("[restore/full] 선백업 실행 중...");
      const pre = await runRealBackup({ type: "manual", createdBy: triggeredBy, note: "전체 복구 전 자동 선백업" });
      preBackupId = pre.backupId;
      console.log(`[restore/full] 선백업 완료: ${preBackupId}`);

      // 2. 복구 대상 백업 확인
      const bkRows = (await superAdminDb.execute(sql`
        SELECT created_at, total_tables FROM platform_backups WHERE id = ${backup_id}
      `)).rows as any[];
      if (!bkRows[0]) return res.status(404).json({ error: "지정한 백업을 찾을 수 없습니다." });
      const restorePoint = bkRows[0].created_at;

      // 3. restore_log 시작 기록
      await insertRestoreLog({ id: logId, restoreType: "full", backupId: backup_id, restorePoint, triggeredBy, preBackupId });

      // 4. 백업 JSON 로드
      console.log(`[restore/full] 백업 JSON 로드 중: ${backup_id}`);
      const tableData = await loadBackupJson(backup_id);
      const tableNames = Object.keys(tableData).filter(t => !EXCLUDE_FROM_FULL_RESTORE.has(t));
      console.log(`[restore/full] 복구 대상 테이블: ${tableNames.length}개`);

      // 5. 테이블 복구 (DELETE all → INSERT)
      let totalRows = 0;
      const errors: string[] = [];

      for (const tableName of tableNames) {
        const rows = tableData[tableName];
        if (!Array.isArray(rows)) continue;
        try {
          await superAdminDb.execute(sql.raw(`DELETE FROM "${tableName}"`));
          let inserted = 0;
          for (const row of rows) {
            try {
              await insertRow(tableName, row as Record<string, unknown>);
              inserted++;
            } catch { /* 행 단위 오류 건너뜀 */ }
          }
          totalRows += inserted;
          console.log(`[restore/full] ${tableName}: ${inserted}/${rows.length}행 복구`);
        } catch (e: any) {
          const msg = `${tableName}: ${e.message}`;
          errors.push(msg);
          console.warn(`[restore/full] 테이블 복구 실패 (건너뜀): ${msg}`);
        }
      }

      // 6. 복구 대상 테이블 누락 감지
      console.log("[restore/full] 누락 테이블 감지 중...");
      const tableResult = await detectMissingTables();

      // 7. 데이터 무결성 검사
      console.log("[restore/full] 데이터 무결성 검사 중...");
      const brokenRelations = await checkDataIntegrity();

      // 8. warning 집계 (4분류 구조로 항상 기록)
      const warningDetails = {
        missing_restore_tables:  tableResult.missing,
        ignored_global_tables:   tableResult.ignored,
        review_required_tables:  tableResult.reviewRequired,
        broken_relations:        brokenRelations,
      };
      const warningCount = tableResult.missing.length + tableResult.reviewRequired.length + brokenRelations.length;

      if (warningCount > 0) {
        console.warn(`[restore/full] ⚠️ 경고 ${warningCount}건 발생 — ${JSON.stringify(warningDetails)}`);
      } else {
        console.log(`[restore/full] ✅ 경고 없음. 전역 무시: ${tableResult.ignored.join(", ") || "없음"}`);
      }

      // 9. restore_logs 완료 기록 (warning_details 항상 저장)
      // rows_restored=0 + warning=0 → 정상이지만 복구 대상 없음 안내
      const reasonMessage =
        totalRows === 0 && warningCount === 0
          ? "해당 백업 시점에 변경된 데이터가 없습니다."
          : undefined;

      await finishRestoreLog(logId, "success", {
        warnings: { count: warningCount, details: warningDetails },
      });
      console.log(`[restore/full] 완료 — 총 ${totalRows}행 복구, 오류: ${errors.length}개, 경고: ${warningCount}건${reasonMessage ? " (복구 대상 없음)" : ""}`);

      res.json({
        ok: true,
        log_id: logId,
        pre_backup_id: preBackupId,
        tables_restored: tableNames.length - errors.length,
        rows_restored: totalRows,
        restore_point: restorePoint,
        warning_count: warningCount,
        warning_details: warningDetails,
        reason_message: reasonMessage,
        errors: errors.length > 0 ? errors : undefined,
      });

    } catch (e: any) {
      console.error("[restore/full] 실패:", e.message);
      await finishRestoreLog(logId, "failed", { errorMsg: e.message }).catch(() => {});
      res.status(500).json({ error: "전체 복구 실패", detail: e.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/restore/pool
// 수영장별 복구
// body: { pool_id, backup_id, confirmed_pool_name }
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/restore/pool",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { pool_id, backup_id, confirmed_pool_name } = req.body ?? {};

    if (!pool_id)             return res.status(400).json({ error: "pool_id가 필요합니다." });
    if (!backup_id)           return res.status(400).json({ error: "backup_id가 필요합니다." });
    if (!confirmed_pool_name) return res.status(400).json({ error: "수영장명 확인 입력이 필요합니다." });

    // 수영장 확인
    const poolRows = (await superAdminDb.execute(sql`
      SELECT id, name FROM swimming_pools WHERE id = ${pool_id}
    `)).rows as any[];
    if (!poolRows[0]) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });
    const poolName = poolRows[0].name as string;

    if (confirmed_pool_name.trim() !== poolName) {
      return res.status(400).json({
        error: `수영장명이 맞지 않습니다. '${poolName}'을 정확히 입력하세요.`,
      });
    }

    const triggeredBy = req.user?.name ?? req.user?.id ?? "super_admin";
    const logId = `rl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    let preBackupId: string | undefined;

    try {
      // 1. 선백업
      console.log(`[restore/pool] 선백업 실행 중 (pool: ${pool_id})...`);
      const pre = await runRealBackup({
        type: "manual",
        createdBy: triggeredBy,
        note: `수영장별 복구 전 선백업 (${poolName})`,
      });
      preBackupId = pre.backupId;

      // 2. 대상 백업 확인
      const bkRows = (await superAdminDb.execute(sql`
        SELECT created_at FROM platform_backups WHERE id = ${backup_id}
      `)).rows as any[];
      if (!bkRows[0]) return res.status(404).json({ error: "지정한 백업을 찾을 수 없습니다." });
      const restorePoint = bkRows[0].created_at;

      // 3. restore_log 시작 기록
      await insertRestoreLog({ id: logId, restoreType: "pool", poolId: pool_id, backupId: backup_id, restorePoint, triggeredBy, preBackupId });

      // 4. 백업 JSON 로드
      const tableData = await loadBackupJson(backup_id);

      // 5. pool 테이블 복구 (DELETE WHERE swimming_pool_id = ? → INSERT filtered)
      let totalRows = 0;
      const errors: string[] = [];
      const safePoolId = pool_id.replace(/'/g, "''");

      for (const tableName of POOL_RESTORE_TABLES) {
        const allRows = tableData[tableName];
        if (!Array.isArray(allRows)) continue;

        const poolRows2 = allRows.filter((r: any) => r.swimming_pool_id === pool_id);

        try {
          await superAdminDb.execute(
            sql.raw(`DELETE FROM "${tableName}" WHERE swimming_pool_id = '${safePoolId}'`)
          );
          let inserted = 0;
          for (const row of poolRows2) {
            try {
              await insertRow(tableName, row as Record<string, unknown>);
              inserted++;
            } catch { /* 행 단위 오류 건너뜀 */ }
          }
          totalRows += inserted;
          if (poolRows2.length > 0) {
            console.log(`[restore/pool] ${tableName}: ${inserted}/${poolRows2.length}행 복구`);
          }
        } catch (e: any) {
          const msg = `${tableName}: ${e.message}`;
          errors.push(msg);
          console.warn(`[restore/pool] 테이블 복구 실패 (건너뜀): ${msg}`);
        }
      }

      // 6. 복구 대상 테이블 누락 감지
      console.log("[restore/pool] 누락 테이블 감지 중...");
      const tableResult = await detectMissingTables();

      // 7. 데이터 무결성 검사 (해당 수영장 범위만)
      console.log(`[restore/pool] 데이터 무결성 검사 중 (pool: ${pool_id})...`);
      const brokenRelations = await checkDataIntegrity(pool_id);

      // 8. warning 집계 (4분류 구조로 항상 기록)
      const warningDetails = {
        missing_restore_tables:  tableResult.missing,
        ignored_global_tables:   tableResult.ignored,
        review_required_tables:  tableResult.reviewRequired,
        broken_relations:        brokenRelations,
      };
      const warningCount = tableResult.missing.length + tableResult.reviewRequired.length + brokenRelations.length;

      if (warningCount > 0) {
        console.warn(`[restore/pool] ⚠️ 경고 ${warningCount}건 — ${JSON.stringify(warningDetails)}`);
      } else {
        console.log(`[restore/pool] ✅ 경고 없음. 전역 무시: ${tableResult.ignored.join(", ") || "없음"}`);
      }

      // 9. restore_logs 완료 기록 (warning_details 항상 저장)
      // rows_restored=0 + warning=0 → 정상이지만 복구 대상 없음 안내
      const reasonMessage =
        totalRows === 0 && warningCount === 0
          ? "해당 백업 시점에 변경된 데이터가 없습니다."
          : undefined;

      await finishRestoreLog(logId, "success", {
        warnings: { count: warningCount, details: warningDetails },
      });
      console.log(`[restore/pool] 완료 — pool: ${pool_id}, 총 ${totalRows}행 복구, 경고: ${warningCount}건${reasonMessage ? " (복구 대상 없음)" : ""}`);

      res.json({
        ok: true,
        log_id: logId,
        pre_backup_id: preBackupId,
        pool_id,
        pool_name: poolName,
        rows_restored: totalRows,
        restore_point: restorePoint,
        warning_count: warningCount,
        warning_details: warningDetails,
        reason_message: reasonMessage,
        errors: errors.length > 0 ? errors : undefined,
      });

    } catch (e: any) {
      console.error("[restore/pool] 실패:", e.message);
      await finishRestoreLog(logId, "failed", { errorMsg: e.message }).catch(() => {});
      res.status(500).json({ error: "수영장별 복구 실패", detail: e.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/restore/logs
// 복구 이력 (최근 50건)
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/restore/logs",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const rows = (await superAdminDb.execute(sql`
        SELECT rl.*, sp.name AS pool_name
        FROM restore_logs rl
        LEFT JOIN swimming_pools sp ON sp.id = rl.pool_id
        ORDER BY rl.started_at DESC
        LIMIT 50
      `)).rows;
      res.json({ logs: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

export default router;
