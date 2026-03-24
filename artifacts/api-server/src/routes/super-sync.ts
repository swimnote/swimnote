/**
 * super-sync.ts
 *
 * 슈퍼관리자 전용 동기화 관리 API.
 *
 * GET  /super/sync/stats         — 동기화 현황 (pending/synced 건수, 테넌트별)
 * GET  /super/sync/changes       — pending 변경분 목록 (페이지네이션)
 * POST /super/sync/run           — 즉시 증분 동기화 실행
 * POST /super/sync/snapshot      — 즉시 전체 스냅샷 생성
 * GET  /super/sync/snapshots     — 스냅샷 이력 목록
 * GET  /super/sync/tenants       — 테넌트별 변경분 요약
 */
import { Router } from "express";
import { superAdminDb } from "@workspace/db";
const db = superAdminDb;
import { backupSnapshotsTable } from "@workspace/db/schema";
import { sql, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { runIncrementalSync, runFullSnapshot } from "../jobs/backup-batch.js";

const router = Router();

function superOnly(req: AuthRequest, res: any, next: any) {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({ error: "슈퍼관리자만 접근 가능합니다." });
  }
  next();
}

// ─── 통계 개요 ────────────────────────────────────────────────────────────
router.get("/super/sync/stats", requireAuth, superOnly, async (_req: AuthRequest, res) => {
  try {
    const pendingRow = (await superAdminDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM data_change_logs WHERE sync_status = 'pending'
    `)).rows[0] as any;
    const syncedRow = (await superAdminDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM data_change_logs WHERE sync_status = 'synced'
    `)).rows[0] as any;
    const totalRow = (await superAdminDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM data_change_logs
    `)).rows[0] as any;
    const snapshotRow = (await superAdminDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM backup_snapshots
    `)).rows[0] as any;
    const lastSyncRow = (await superAdminDb.execute(sql`
      SELECT MAX(synced_at) AS last_at FROM data_change_logs WHERE sync_status = 'synced'
    `)).rows[0] as any;
    const lastSnapshotRow = (await superAdminDb.execute(sql`
      SELECT MAX(created_at) AS last_at FROM backup_snapshots WHERE snapshot_type = 'full'
    `)).rows[0] as any;

    const tableStats = (await superAdminDb.execute(sql`
      SELECT table_name, COUNT(*) AS cnt
      FROM data_change_logs WHERE sync_status = 'pending'
      GROUP BY table_name ORDER BY cnt DESC
    `)).rows as any[];

    res.json({
      pending:           Number(pendingRow?.cnt ?? 0),
      synced:            Number(syncedRow?.cnt ?? 0),
      total:             Number(totalRow?.cnt ?? 0),
      snapshots:         Number(snapshotRow?.cnt ?? 0),
      last_synced_at:    lastSyncRow?.last_at || null,
      last_snapshot_at:  lastSnapshotRow?.last_at || null,
      by_table:          tableStats.map(r => ({ table_name: r.table_name, pending: Number(r.cnt) })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── 테넌트별 요약 ────────────────────────────────────────────────────────
router.get("/super/sync/tenants", requireAuth, superOnly, async (_req: AuthRequest, res) => {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT
        d.tenant_id,
        p.name AS pool_name,
        COUNT(*) FILTER (WHERE d.sync_status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE d.sync_status = 'synced')  AS synced,
        MAX(d.created_at) AS last_change_at
      FROM data_change_logs d
      LEFT JOIN swimming_pools p ON p.id = d.tenant_id
      GROUP BY d.tenant_id, p.name
      ORDER BY pending DESC
    `)).rows as any[];
    res.json(rows.map(r => ({
      tenant_id:      r.tenant_id,
      pool_name:      r.pool_name || r.tenant_id,
      pending:        Number(r.pending),
      synced:         Number(r.synced),
      last_change_at: r.last_change_at,
    })));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── pending 변경분 목록 ──────────────────────────────────────────────────
router.get("/super/sync/changes", requireAuth, superOnly, async (req: AuthRequest, res) => {
  const page   = Math.max(1, Number(req.query.page) || 1);
  const limit  = Math.min(100, Number(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  const status = (req.query.status as string) || "pending";

  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT d.id, d.tenant_id, p.name AS pool_name,
             d.table_name, d.record_id, d.change_type,
             d.sync_status, d.created_at, d.synced_at
      FROM data_change_logs d
      LEFT JOIN swimming_pools p ON p.id = d.tenant_id
      WHERE d.sync_status = ${status}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)).rows as any[];
    const cnt = (await superAdminDb.execute(sql`
      SELECT COUNT(*) AS total FROM data_change_logs WHERE sync_status = ${status}
    `)).rows[0] as any;
    res.json({
      data:  rows,
      total: Number(cnt?.total ?? 0),
      page, limit,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── 즉시 증분 동기화 실행 ────────────────────────────────────────────────
router.post("/super/sync/run", requireAuth, superOnly, async (_req: AuthRequest, res) => {
  try {
    const result = await runIncrementalSync();
    res.json({ success: true, ...result });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── 즉시 전체 스냅샷 생성 ────────────────────────────────────────────────
router.post("/super/sync/snapshot", requireAuth, superOnly, async (_req: AuthRequest, res) => {
  try {
    const result = await runFullSnapshot();
    res.json({ success: true, ...result });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── 스냅샷 이력 목록 ─────────────────────────────────────────────────────
router.get("/super/sync/snapshots", requireAuth, superOnly, async (req: AuthRequest, res) => {
  const limit = Math.min(50, Number(req.query.limit) || 20);
  try {
    const rows = await db
      .select()
      .from(backupSnapshotsTable)
      .orderBy(desc(backupSnapshotsTable.created_at))
      .limit(limit);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

export default router;
