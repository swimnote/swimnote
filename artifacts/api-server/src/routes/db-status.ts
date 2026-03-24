/**
 * DB 서버 상태/용량 조회 API (슈퍼관리자 전용)
 *
 * GET /api/super/db-status        — 슈퍼관리자 DB + 수영장 운영 DB 용량 요약
 * GET /api/super/db-status/pools  — 수영장별 운영 DB 사용량
 * GET /api/super/db-status/tables — 테이블별 크기 상세
 * GET /api/super/event-logs       — 수영장 운영 이벤트 복제 로그
 * GET /api/super/retry-queue      — 재시도 큐 현황
 */
import { Router } from "express";
import { superAdminDb, poolDb, isDbSeparated } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requirePermission, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
router.use(requireAuth, requirePermission("canViewPools"));

// ── 헬퍼: DB 전체 크기 조회 ──────────────────────────────────
async function getDbSize(db: typeof superAdminDb, label: string) {
  try {
    const [row] = (await db.execute(sql`
      SELECT pg_database_size(current_database())::bigint AS bytes,
             current_database()                           AS db_name
    `)).rows as any[];

    return {
      label,
      db_name:     row?.db_name   ?? "unknown",
      total_bytes: Number(row?.bytes ?? 0),
      total_mb:    Math.round(Number(row?.bytes ?? 0) / 1024 / 1024 * 10) / 10,
    };
  } catch (e) {
    return { label, db_name: "error", total_bytes: 0, total_mb: 0, error: String(e) };
  }
}

// ── 헬퍼: 테이블별 크기 ──────────────────────────────────────
async function getTableSizes(db: typeof superAdminDb) {
  try {
    const rows = (await db.execute(sql`
      SELECT
        schemaname,
        tablename,
        pg_total_relation_size(schemaname || '.' || tablename)::bigint AS bytes,
        pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS pretty
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY bytes DESC
      LIMIT 30
    `)).rows as any[];
    return rows.map(r => ({
      table:  r.tablename,
      bytes:  Number(r.bytes),
      pretty: r.pretty,
    }));
  } catch (e) {
    return [];
  }
}

// ── 헬퍼: 수영장별 운영 데이터 집계 ─────────────────────────
async function getPoolBreakdown(db: typeof poolDb) {
  try {
    const rows = (await db.execute(sql`
      SELECT
        p.id                         AS pool_id,
        p.name                       AS pool_name,
        COUNT(DISTINCT s.id)::int    AS student_count,
        COUNT(DISTINCT u.id)::int    AS teacher_count,
        COUNT(DISTINCT a.id)::int    AS attendance_count,
        COUNT(DISTINCT cd.id)::int   AS diary_count
      FROM swimming_pools p
      LEFT JOIN students    s  ON s.swimming_pool_id = p.id AND s.status = 'active'
      LEFT JOIN users       u  ON u.swimming_pool_id = p.id AND 'teacher' = ANY(u.roles)
      LEFT JOIN attendance  a  ON a.swimming_pool_id = p.id
      LEFT JOIN class_diaries cd ON cd.swimming_pool_id = p.id AND cd.is_deleted = false
      GROUP BY p.id, p.name
      ORDER BY student_count DESC
    `)).rows as any[];
    return rows;
  } catch (e) {
    return [];
  }
}

// ── GET /super/db-status ─────────────────────────────────────
router.get("/", async (_req: AuthRequest, res) => {
  try {
    const [superInfo, poolInfo] = await Promise.all([
      getDbSize(superAdminDb, "슈퍼관리자 DB"),
      isDbSeparated ? getDbSize(poolDb, "수영장 운영 DB") : Promise.resolve(null),
    ]);

    const superTables = await getTableSizes(superAdminDb);

    // 이벤트 로그 요약
    const [logSummary] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(DISTINCT pool_id)::int AS pools_with_events,
        MAX(created_at) AS last_event_at
      FROM pool_event_logs
    `)).rows as any[];

    // 재시도 큐 요약
    const [retrySummary] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*)::int FILTER (WHERE resolved = false) AS pending,
        COUNT(*)::int FILTER (WHERE resolved = true)  AS resolved,
        COUNT(*)::int FILTER (WHERE retry_count >= max_retries AND resolved = false) AS failed
      FROM event_retry_queue
    `)).rows as any[];

    res.json({
      is_separated:   isDbSeparated,
      checked_at:     new Date().toISOString(),
      super_admin_db: {
        ...superInfo,
        top_tables: superTables.slice(0, 10),
      },
      pool_ops_db: isDbSeparated ? poolInfo : {
        label:       "수영장 운영 DB",
        note:        "슈퍼관리자 DB와 동일 (POOL_DATABASE_URL 미설정)",
        total_bytes: superInfo.total_bytes,
        total_mb:    superInfo.total_mb,
      },
      event_logs: {
        total_events:       Number(logSummary?.total_events ?? 0),
        pools_with_events:  Number(logSummary?.pools_with_events ?? 0),
        last_event_at:      logSummary?.last_event_at ?? null,
      },
      retry_queue: {
        pending:  Number(retrySummary?.pending ?? 0),
        resolved: Number(retrySummary?.resolved ?? 0),
        failed:   Number(retrySummary?.failed ?? 0),
      },
    });
  } catch (err) {
    console.error("[db-status] 오류:", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /super/db-status/pools ───────────────────────────────
router.get("/pools", async (_req: AuthRequest, res) => {
  try {
    const breakdown = await getPoolBreakdown(poolDb);
    res.json({ pools: breakdown, checked_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /super/db-status/tables ──────────────────────────────
router.get("/tables", async (_req: AuthRequest, res) => {
  try {
    const [superTables, poolTables] = await Promise.all([
      getTableSizes(superAdminDb),
      isDbSeparated ? getTableSizes(poolDb) : Promise.resolve([]),
    ]);
    res.json({
      super_admin_tables: superTables,
      pool_ops_tables:    isDbSeparated ? poolTables : superTables,
      is_separated:       isDbSeparated,
      checked_at:         new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /super/event-logs ────────────────────────────────────
router.get("/event-logs", async (req: AuthRequest, res) => {
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);
  const pool_id = req.query.pool_id as string | undefined;
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT * FROM pool_event_logs
      ${pool_id ? sql`WHERE pool_id = ${pool_id}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)).rows;

    const [cnt] = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS total FROM pool_event_logs
      ${pool_id ? sql`WHERE pool_id = ${pool_id}` : sql``}
    `)).rows as any[];

    res.json({ logs: rows, total: Number(cnt?.total ?? 0), limit, offset });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ── GET /super/retry-queue ───────────────────────────────────
router.get("/retry-queue", async (_req: AuthRequest, res) => {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT * FROM event_retry_queue
      WHERE resolved = false
      ORDER BY next_retry_at ASC
      LIMIT 100
    `)).rows;
    res.json({ queue: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
