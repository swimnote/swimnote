/**
 * backup-status.ts — DB 백업 상태 및 수동 백업 API (슈퍼관리자 전용)
 *
 * GET  /super/backup-status           — 4개 상태 카드 데이터 조회
 * POST /super/backup/run              — 수동 백업 실행 (full | pool_only)
 *
 * 상태 카드:
 *   1. 운영 DB (superAdminDb) — 연결 상태, 응답속도, 오류 여부
 *   2. pool 백업 — 마지막 백업 시각, 상태 (정상/실패)
 *   3. 보호백업  — 마지막 백업 시각, 상태 (정상/실패)
 *   4. 전체 요약 — 최근 백업 성공 여부, 실패 횟수
 */
import { Router } from "express";
import { superAdminDb, poolDb, backupProtectDb, isDbSeparated, isProtectDbConfigured } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { runBackupToTarget } from "../lib/backup-target.js";

const router = Router();

// ── 헬퍼: 운영 DB ping ──────────────────────────────────────────────────────
async function pingSuperDb() {
  const t0 = Date.now();
  try {
    await superAdminDb.execute(sql`SELECT 1`);
    return { ok: true, latency_ms: Date.now() - t0, error: null };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, error: String(e) };
  }
}

// ── 헬퍼: 마지막 백업 로그 조회 ─────────────────────────────────────────────
async function getLastBackupLog(target: "pool" | "super_protect") {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT id, status, started_at, finished_at, last_success_at,
             error_message, size_bytes, row_count, backup_type
      FROM backup_logs
      WHERE target = ${target}
      ORDER BY started_at DESC
      LIMIT 1
    `)).rows as any[];
    const row = rows[0];
    if (!row) return null;
    // bigint 컬럼은 pg driver가 string으로 반환 → Number() 변환
    return {
      ...row,
      size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
      row_count:  row.row_count  != null ? Number(row.row_count)  : null,
    };
  } catch {
    return null;
  }
}

// ── 헬퍼: 최근 24시간 실패 횟수 ────────────────────────────────────────────
async function getRecentFailureCount() {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM backup_logs
      WHERE status = 'failed'
        AND started_at >= NOW() - INTERVAL '24 hours'
    `)).rows as any[];
    return Number(rows[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

// ── 헬퍼: 상태 판단 ─────────────────────────────────────────────────────────
function calcBackupCardStatus(log: any, configured: boolean): "normal" | "warning" | "error" | "not_configured" {
  if (!configured) return "not_configured";
  if (!log) return "warning";                          // 한 번도 백업 안 됨
  if (log.status === "failed") return "error";
  if (log.status === "running") return "warning";

  // 마지막 성공 시각 기준 — 24시간 초과 시 warning
  const successAt = log.last_success_at ?? log.finished_at;
  if (!successAt) return "warning";
  const hoursSince = (Date.now() - new Date(successAt).getTime()) / 3600000;
  if (hoursSince > 48) return "error";
  if (hoursSince > 24) return "warning";
  return "normal";
}

// ════════════════════════════════════════════════════════════════
// GET /super/backup-status
// 4개 상태 카드 데이터
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/backup-status",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const [superPing, poolLog, protectLog, failCount] = await Promise.all([
        pingSuperDb(),
        getLastBackupLog("pool"),
        getLastBackupLog("super_protect"),
        getRecentFailureCount(),
      ]);

      const poolStatus    = calcBackupCardStatus(poolLog, isDbSeparated);
      const protectStatus = calcBackupCardStatus(protectLog, isProtectDbConfigured);

      const recentSuccess =
        (poolLog?.status === "success" || !isDbSeparated) &&
        (protectLog?.status === "success" || !isProtectDbConfigured);

      res.json({
        checked_at: new Date().toISOString(),
        cards: {
          // 카드 1: 운영 DB (superAdminDb)
          operational_db: {
            label:        "운영 DB (superAdminDb)",
            connected:    superPing.ok,
            latency_ms:   superPing.latency_ms,
            error:        superPing.error,
            status:       superPing.ok ? (superPing.latency_ms > 500 ? "warning" : "normal") : "error",
            status_label: superPing.ok ? (superPing.latency_ms > 500 ? "응답 지연" : "정상") : "연결 실패",
          },
          // 카드 2: pool 백업
          pool_backup: {
            label:           "pool 백업 DB",
            configured:      isDbSeparated,
            status:          poolStatus,
            status_label:    poolStatus === "normal" ? "정상" : poolStatus === "warning" ? "주의" : poolStatus === "error" ? "실패" : "미설정",
            last_backup_at:  poolLog?.finished_at ?? null,
            last_success_at: poolLog?.last_success_at ?? null,
            last_status:     poolLog?.status ?? null,
            error_message:   poolLog?.status === "failed" ? poolLog.error_message : null,
            size_bytes:      poolLog?.size_bytes ?? null,
          },
          // 카드 3: 보호백업
          protect_backup: {
            label:           "super 보호백업 DB",
            configured:      isProtectDbConfigured,
            status:          protectStatus,
            status_label:    protectStatus === "normal" ? "정상" : protectStatus === "warning" ? "주의" : protectStatus === "error" ? "실패" : "미설정",
            last_backup_at:  protectLog?.finished_at ?? null,
            last_success_at: protectLog?.last_success_at ?? null,
            last_status:     protectLog?.status ?? null,
            error_message:   protectLog?.status === "failed" ? protectLog.error_message : null,
            size_bytes:      protectLog?.size_bytes ?? null,
          },
          // 카드 4: 전체 요약
          summary: {
            label:                "전체 백업 요약",
            status:               failCount > 0 ? "warning" : recentSuccess ? "normal" : "warning",
            status_label:         failCount > 0 ? `최근 실패 ${failCount}건` : recentSuccess ? "최근 백업 정상" : "백업 필요",
            recent_success:       recentSuccess,
            failure_count_24h:    failCount,
            pool_configured:      isDbSeparated,
            protect_configured:   isProtectDbConfigured,
          },
        },
      });
    } catch (e: any) {
      console.error("[backup-status] 조회 오류:", e.message);
      res.status(500).json({ error: "백업 상태 조회 실패", detail: e.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/backup/run
// 수동 백업 실행
// body: { type: "full" | "pool_only", note?: string }
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/backup/run",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { type = "full", note } = req.body ?? {};
    const createdBy = req.user?.name ?? req.user?.id ?? "super_admin";

    const results: Record<string, any> = {};

    try {
      // pool 백업
      if (isDbSeparated) {
        results.pool = await runBackupToTarget({
          target: "pool",
          targetDb: poolDb,
          createdBy,
          note: note ?? `수동 백업 (${type})`,
          backupType: "manual",
        });
      } else {
        results.pool = { skipped: true, reason: "POOL_DATABASE_URL 미설정" };
      }

      // 보호백업 (full 타입일 때만)
      if (type === "full") {
        if (backupProtectDb) {
          results.protect = await runBackupToTarget({
            target: "super_protect",
            targetDb: backupProtectDb,
            createdBy,
            note: note ?? "수동 보호백업",
            backupType: "manual",
          });
        } else {
          results.protect = { skipped: true, reason: "SUPER_PROTECT_DATABASE_URL 미설정" };
        }
      }

      res.json({
        ok: true,
        type,
        results,
        completed_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[backup/run] 백업 실패:", e.message);
      res.status(500).json({ error: "백업 실행 실패", detail: e.message });
    }
  }
);

export default router;
