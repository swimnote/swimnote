/**
 * DB 서버 상태/용량 조회 API (슈퍼관리자 전용)
 *
 * GET  /api/super/db-status              — 요약 + 이벤트 현황
 * GET  /api/super/db-status/pools        — 수영장별 운영 DB 사용량
 * GET  /api/super/db-status/tables       — 테이블별 크기 상세
 * GET  /api/super/db-status/event-logs   — 이벤트 복제 로그
 * GET  /api/super/db-status/retry-queue  — 재시도 큐 현황
 * GET  /api/super/db-status/diagnostic   — 전체 DB 진단 보고서
 * GET  /api/super/db-status/verify       — 이벤트 로그 누락 검증
 * GET  /api/super/db-status/dead-letters — Dead-letter queue 조회
 * POST /api/super/db-status/dead-letters/:id/resend — DLQ 수동 재전송
 */
import { Router } from "express";
import { superAdminDb, poolDb, isDbSeparated } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requirePermission, type AuthRequest } from "../middlewares/auth.js";
import { resendDeadLetter } from "../lib/pool-event-logger.js";

const router = Router();
router.use(requireAuth, requirePermission("canViewPools"));

// ── 헬퍼: DB 전체 크기 조회 (pg_total_relation_size 기반) ────────
async function getDbSize(dbConn: typeof superAdminDb, label: string) {
  try {
    const [row] = (await dbConn.execute(sql`
      SELECT pg_database_size(current_database())::bigint AS bytes,
             current_database()                           AS db_name,
             pg_size_pretty(pg_database_size(current_database())) AS pretty
    `)).rows as any[];
    return {
      label,
      db_name:     row?.db_name   ?? "unknown",
      total_bytes: Number(row?.bytes ?? 0),
      total_mb:    Math.round(Number(row?.bytes ?? 0) / 1024 / 1024 * 10) / 10,
      pretty:      row?.pretty ?? "0 bytes",
    };
  } catch (e) {
    return { label, db_name: "error", total_bytes: 0, total_mb: 0, pretty: "0 bytes", error: String(e) };
  }
}

// ── 헬퍼: 테이블별 크기 (pg_total_relation_size 기반, 인덱스 포함) ─
async function getTableSizes(dbConn: typeof superAdminDb) {
  try {
    const rows = (await dbConn.execute(sql`
      SELECT
        tablename,
        pg_total_relation_size(quote_ident(tablename))::bigint AS bytes,
        pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS pretty,
        pg_size_pretty(pg_relation_size(quote_ident(tablename)))       AS data_size,
        pg_size_pretty(pg_total_relation_size(quote_ident(tablename))
          - pg_relation_size(quote_ident(tablename)))                  AS index_size
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY bytes DESC
      LIMIT 30
    `)).rows as any[];
    return rows.map(r => ({
      table:      r.tablename,
      bytes:      Number(r.bytes),
      pretty:     r.pretty,
      data_size:  r.data_size,
      index_size: r.index_size,
    }));
  } catch {
    return [];
  }
}

// ── 헬퍼: 수영장별 운영 데이터 집계 ─────────────────────────────
// swimming_pools, users → superAdminDb / students, attendance, class_diaries → poolDb
async function getPoolBreakdown() {
  try {
    // superAdminDb에서 풀 목록 + 교사 수 조회
    const poolRows = (await superAdminDb.execute(sql`
      SELECT p.id AS pool_id, p.name AS pool_name,
             COUNT(DISTINCT u.id)::int AS teacher_count
      FROM swimming_pools p
      LEFT JOIN users u ON u.swimming_pool_id = p.id AND u.role = 'teacher'
      GROUP BY p.id, p.name
      ORDER BY p.name
    `)).rows as any[];

    if (!poolRows.length) return [];

    // poolDb에서 수영장별 운영 통계 — 전체 집계 후 JS에서 필터 (ANY 배열 파라미터 호환성 이슈 회피)
    const opRows = (await poolDb.execute(sql`
      SELECT p_id,
             SUM(student_count)::int    AS student_count,
             SUM(attendance_count)::int AS attendance_count,
             SUM(diary_count)::int      AS diary_count
      FROM (
        SELECT swimming_pool_id AS p_id, COUNT(*)::int AS student_count,
               0 AS attendance_count, 0 AS diary_count
        FROM students WHERE status = 'active'
        GROUP BY swimming_pool_id
        UNION ALL
        SELECT swimming_pool_id, 0, COUNT(*)::int, 0
        FROM attendance
        GROUP BY swimming_pool_id
        UNION ALL
        SELECT swimming_pool_id, 0, 0, COUNT(*)::int
        FROM class_diaries WHERE is_deleted = false
        GROUP BY swimming_pool_id
      ) x
      GROUP BY p_id
    `).catch(() => ({ rows: [] }))).rows as any[];

    const opMap: Record<string, any> = {};
    for (const r of opRows) opMap[r.p_id] = r;

    return poolRows.map((p: any) => ({
      pool_id:          p.pool_id,
      pool_name:        p.pool_name,
      student_count:    opMap[p.pool_id]?.student_count    ?? 0,
      teacher_count:    p.teacher_count,
      attendance_count: opMap[p.pool_id]?.attendance_count ?? 0,
      diary_count:      opMap[p.pool_id]?.diary_count      ?? 0,
    }));
  } catch (e) {
    console.error("[getPoolBreakdown]", e);
    return [];
  }
}

// ── 헬퍼: 연결 상태 ping ─────────────────────────────────────────
async function pingDb(dbConn: typeof superAdminDb, label: string) {
  const t0 = Date.now();
  try {
    await dbConn.execute(sql`SELECT 1`);
    return { label, ok: true, latency_ms: Date.now() - t0 };
  } catch (e) {
    return { label, ok: false, latency_ms: Date.now() - t0, error: String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status
// ═══════════════════════════════════════════════════════════════
router.get("/", async (_req: AuthRequest, res) => {
  try {
    const [superInfo, poolInfo, superPing, poolPing] = await Promise.all([
      getDbSize(superAdminDb, "슈퍼관리자 DB"),
      isDbSeparated ? getDbSize(poolDb, "수영장 운영 DB") : Promise.resolve(null),
      pingDb(superAdminDb, "슈퍼관리자 DB"),
      isDbSeparated ? pingDb(poolDb, "수영장 운영 DB") : Promise.resolve(null),
    ]);

    const superTables = await getTableSizes(superAdminDb);

    const [logSummary] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*)::int                    AS total_events,
        COUNT(DISTINCT pool_id)::int     AS pools_with_events,
        MAX(created_at)                  AS last_event_at
      FROM pool_event_logs
    `)).rows as any[];

    const [retrySummary] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE resolved = false)                               AS pending,
        COUNT(*) FILTER (WHERE resolved = true)                                AS resolved,
        COUNT(*) FILTER (WHERE retry_count >= max_retries AND resolved = false) AS exhausted
      FROM event_retry_queue
    `)).rows as any[];

    const [dlqSummary] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE resolved = false) AS pending,
        COUNT(*) FILTER (WHERE resolved = true)  AS resolved
      FROM dead_letter_queue
    `)).rows as any[];

    res.json({
      is_separated:   isDbSeparated,
      checked_at:     new Date().toISOString(),
      connections: {
        super_admin_db: superPing,
        pool_ops_db:    isDbSeparated ? poolPing : { label: "수영장 운영 DB", ok: true, note: "동일 DB 사용" },
      },
      super_admin_db: { ...superInfo, top_tables: superTables.slice(0, 10) },
      pool_ops_db: isDbSeparated ? poolInfo : {
        label:       "수영장 운영 DB",
        note:        "슈퍼관리자 DB와 동일 (POOL_DATABASE_URL 미설정)",
        total_bytes: superInfo.total_bytes,
        total_mb:    superInfo.total_mb,
      },
      event_logs: {
        total_events:      Number(logSummary?.total_events ?? 0),
        pools_with_events: Number(logSummary?.pools_with_events ?? 0),
        last_event_at:     logSummary?.last_event_at ?? null,
      },
      retry_queue: {
        pending:   Number(retrySummary?.pending ?? 0),
        resolved:  Number(retrySummary?.resolved ?? 0),
        exhausted: Number(retrySummary?.exhausted ?? 0),
      },
      dead_letter_queue: {
        pending:  Number(dlqSummary?.pending ?? 0),
        resolved: Number(dlqSummary?.resolved ?? 0),
      },
    });
  } catch (err) {
    console.error("[db-status] 오류:", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status/pools
// ═══════════════════════════════════════════════════════════════
router.get("/pools", async (_req: AuthRequest, res) => {
  try {
    const breakdown = await getPoolBreakdown();
    res.json({ pools: breakdown, checked_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status/tables
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status/event-logs
// ═══════════════════════════════════════════════════════════════
router.get("/event-logs", async (req: AuthRequest, res) => {
  const limit   = Math.min(Number(req.query.limit  ?? 50), 200);
  const offset  = Number(req.query.offset ?? 0);
  const pool_id = req.query.pool_id as string | undefined;
  const event_type = req.query.event_type as string | undefined;
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT * FROM pool_event_logs
      WHERE 1=1
        ${pool_id    ? sql`AND pool_id    = ${pool_id}`    : sql``}
        ${event_type ? sql`AND event_type = ${event_type}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)).rows;
    const [cnt] = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS total FROM pool_event_logs
      WHERE 1=1
        ${pool_id    ? sql`AND pool_id    = ${pool_id}`    : sql``}
        ${event_type ? sql`AND event_type = ${event_type}` : sql``}
    `)).rows as any[];
    res.json({ logs: rows, total: Number(cnt?.total ?? 0), limit, offset });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status/retry-queue
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status/diagnostic — 전체 진단 보고서
// ═══════════════════════════════════════════════════════════════
router.get("/diagnostic", async (_req: AuthRequest, res) => {
  const t0 = Date.now();
  try {
    const [superPing, poolPing] = await Promise.all([
      pingDb(superAdminDb, "슈퍼관리자 DB"),
      isDbSeparated ? pingDb(poolDb, "수영장 운영 DB") : Promise.resolve({ label: "수영장 운영 DB", ok: true, latency_ms: 0, note: "동일 DB" }),
    ]);

    const [superSize, poolSize] = await Promise.all([
      getDbSize(superAdminDb, "슈퍼관리자 DB"),
      isDbSeparated ? getDbSize(poolDb, "수영장 운영 DB") : Promise.resolve(null),
    ]);

    // 이벤트 타입별 집계
    const eventByType = (await superAdminDb.execute(sql`
      SELECT event_type, COUNT(*)::int AS cnt, MAX(created_at) AS last_at
      FROM pool_event_logs
      GROUP BY event_type
      ORDER BY cnt DESC
    `)).rows as any[];

    // 최근 24h 이벤트 수
    const [recentEvents] = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM pool_event_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `)).rows as any[];

    // DLQ + 재시도 요약
    const [retryStats] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE resolved = false)                               AS pending,
        COUNT(*) FILTER (WHERE resolved = false AND retry_count >= max_retries) AS exhausted,
        AVG(retry_count) FILTER (WHERE resolved = false)                        AS avg_retries
      FROM event_retry_queue
    `)).rows as any[];
    const [dlqStats] = (await superAdminDb.execute(sql`
      SELECT COUNT(*) FILTER (WHERE resolved = false) AS unresolved
      FROM dead_letter_queue
    `)).rows as any[];

    // pool_change_logs 기록수 (poolDb)
    let poolChangeLogs = { count: 0, error: null as string | null };
    try {
      const [pcl] = (await poolDb.execute(sql`SELECT COUNT(*)::int AS cnt FROM pool_change_logs`)).rows as any[];
      poolChangeLogs.count = Number(pcl?.cnt ?? 0);
    } catch (e) { poolChangeLogs.error = String(e); }

    const status: "healthy" | "degraded" | "critical" =
      !superPing.ok ? "critical" :
      (isDbSeparated && !poolPing?.ok) ? "degraded" :
      Number(dlqStats?.unresolved ?? 0) > 10 ? "degraded" : "healthy";

    res.json({
      status,
      duration_ms:    Date.now() - t0,
      checked_at:     new Date().toISOString(),
      is_separated:   isDbSeparated,
      connections:    { super_admin_db: superPing, pool_ops_db: poolPing },
      db_sizes:       { super_admin: superSize, pool_ops: isDbSeparated ? poolSize : null },
      events: {
        by_type:         eventByType,
        last_24h:        Number(recentEvents?.cnt ?? 0),
      },
      retry_queue:    { pending: Number(retryStats?.pending ?? 0), exhausted: Number(retryStats?.exhausted ?? 0), avg_retries: Math.round(Number(retryStats?.avg_retries ?? 0) * 10) / 10 },
      dead_letter_queue: { unresolved: Number(dlqStats?.unresolved ?? 0) },
      pool_change_logs: poolChangeLogs,
      recommendations: [
        ...(Number(dlqStats?.unresolved ?? 0) > 0 ? [`Dead-letter queue에 ${dlqStats?.unresolved}건 미해결 이벤트가 있습니다. 수동 재전송을 검토하세요.`] : []),
        ...(Number(retryStats?.pending ?? 0) > 20 ? ["재시도 큐 대기 건수가 높습니다. super admin DB 연결을 확인하세요."] : []),
        ...(isDbSeparated && !poolPing?.ok ? ["수영장 운영 DB 연결 실패. POOL_DATABASE_URL 및 네트워크를 확인하세요."] : []),
      ],
    });
  } catch (err) {
    console.error("[db-status/diagnostic]", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status/verify — 이벤트 로그 누락 검증
// ═══════════════════════════════════════════════════════════════
router.get("/verify", async (req: AuthRequest, res) => {
  const hours = Math.min(Number(req.query.hours ?? 24), 168); // 최대 7일
  try {
    // 최근 N시간 pool_change_logs 대비 pool_event_logs 누락 비교
    let verifyResults: any[] = [];
    try {
      verifyResults = (await poolDb.execute(sql`
        SELECT
          pool_id,
          event_type,
          COUNT(*)::int AS pool_change_count
        FROM pool_change_logs
        WHERE created_at >= NOW() - INTERVAL '1 hour' * ${hours}
        GROUP BY pool_id, event_type
      `)).rows as any[];
    } catch { /* poolDb 미분리 시 skip */ }

    // super_admin_db pool_event_logs 집계
    const superLogs = (await superAdminDb.execute(sql`
      SELECT
        pool_id,
        event_type,
        COUNT(*)::int AS super_event_count
      FROM pool_event_logs
      WHERE created_at >= NOW() - INTERVAL '1 hour' * ${hours}
      GROUP BY pool_id, event_type
    `)).rows as any[];

    const superMap: Record<string, number> = {};
    for (const r of superLogs as any[]) {
      superMap[`${r.pool_id}::${r.event_type}`] = Number(r.super_event_count);
    }

    const mismatches = verifyResults.map((r: any) => {
      const key = `${r.pool_id}::${r.event_type}`;
      const superCount = superMap[key] ?? 0;
      const diff = Number(r.pool_change_count) - superCount;
      return {
        pool_id:          r.pool_id,
        event_type:       r.event_type,
        pool_change_logs: Number(r.pool_change_count),
        super_event_logs: superCount,
        missing:          diff > 0 ? diff : 0,
        status:           diff > 0 ? "missing" : "ok",
      };
    }).filter((r: any) => r.status === "missing");

    const [retryPending] = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM event_retry_queue
      WHERE resolved = false AND created_at >= NOW() - INTERVAL '1 hour' * ${hours}
    `)).rows as any[];

    res.json({
      verified_at:         new Date().toISOString(),
      window_hours:        hours,
      is_separated:        isDbSeparated,
      mismatches,
      total_missing:       mismatches.reduce((s: number, r: any) => s + r.missing, 0),
      retry_queue_pending: Number(retryPending?.cnt ?? 0),
      status:              mismatches.length === 0 ? "ok" : "has_gaps",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /super/db-status/dead-letters — DLQ 조회
// ═══════════════════════════════════════════════════════════════
router.get("/dead-letters", async (req: AuthRequest, res) => {
  const limit     = Math.min(Number(req.query.limit ?? 50), 200);
  const offset    = Number(req.query.offset ?? 0);
  const resolved  = req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : null;
  const pool_id   = req.query.pool_id as string | undefined;
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT * FROM dead_letter_queue
      WHERE 1=1
        ${resolved !== null ? (resolved ? sql`AND resolved = true` : sql`AND resolved = false`) : sql``}
        ${pool_id ? sql`AND pool_id = ${pool_id}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)).rows;
    const [cnt] = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS total FROM dead_letter_queue
      WHERE 1=1
        ${resolved !== null ? (resolved ? sql`AND resolved = true` : sql`AND resolved = false`) : sql``}
        ${pool_id ? sql`AND pool_id = ${pool_id}` : sql``}
    `)).rows as any[];
    res.json({ items: rows, total: Number(cnt?.total ?? 0), limit, offset });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /super/db-status/dead-letters/:id/resend — DLQ 수동 재전송
// ═══════════════════════════════════════════════════════════════
router.post("/dead-letters/:id/resend", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const resolvedBy = req.user!.name ?? req.user!.userId;
    const ok = await resendDeadLetter(id, resolvedBy);
    if (!ok) {
      return res.status(404).json({ success: false, error: "해당 DLQ 항목을 찾을 수 없거나 이미 처리되었습니다." });
    }
    res.json({ success: true, message: "재전송 성공" });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
