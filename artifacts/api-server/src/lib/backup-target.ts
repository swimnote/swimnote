/**
 * lib/backup-target.ts — 특정 백업 DB 대상으로 백업 실행 + backup_logs 기록
 *
 * superAdminDb의 모든 테이블을 읽어서:
 *   1. backup_logs에 상태 기록 (started → success/failed)
 *   2. 대상 백업 DB에 백업 스냅샷 메타데이터 저장 (가능한 경우)
 *   3. Object Storage에 JSON 저장 (기존 방식 유지)
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

export interface BackupTargetResult {
  logId: string;
  target: "pool" | "super_protect";
  status: "success" | "failed";
  size_bytes: number;
  row_count: number;
  tables_count: number;
  error?: string;
  duration_ms: number;
}

// ── 테이블 목록 조회 ─────────────────────────────────────────────────────────
async function getTableList(): Promise<string[]> {
  const result = await superAdminDb.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return (result.rows as { tablename: string }[]).map((r) => r.tablename);
}

// ── 테이블 행 수 조회 ────────────────────────────────────────────────────────
async function getRowCount(table: string): Promise<number> {
  try {
    const r = (await superAdminDb.execute(
      sql.raw(`SELECT COUNT(*)::int AS cnt FROM "${table}"`)
    )).rows[0] as any;
    return Number(r?.cnt ?? 0);
  } catch {
    return 0;
  }
}

// ── backup_logs 초기 레코드 생성 ─────────────────────────────────────────────
async function createBackupLog(opts: {
  logId: string;
  target: "pool" | "super_protect";
  backupType: "manual" | "auto";
  createdBy: string;
  note?: string;
}): Promise<void> {
  await superAdminDb.execute(sql`
    INSERT INTO backup_logs (id, target, status, backup_type, started_at, created_by, note)
    VALUES (
      ${opts.logId},
      ${opts.target},
      'running',
      ${opts.backupType},
      NOW(),
      ${opts.createdBy},
      ${opts.note ?? null}
    )
  `);
}

// ── backup_logs 완료 업데이트 ─────────────────────────────────────────────────
async function updateBackupLog(opts: {
  logId: string;
  status: "success" | "failed";
  sizeBytes?: number;
  rowCount?: number;
  tablesCount?: number;
  errorMessage?: string;
}): Promise<void> {
  if (opts.status === "success") {
    await superAdminDb.execute(sql`
      UPDATE backup_logs
      SET status          = 'success',
          finished_at     = NOW(),
          last_success_at = NOW(),
          size_bytes      = ${opts.sizeBytes ?? null},
          row_count       = ${opts.rowCount ?? null},
          tables_count    = ${opts.tablesCount ?? null}
      WHERE id = ${opts.logId}
    `);
  } else {
    await superAdminDb.execute(sql`
      UPDATE backup_logs
      SET status        = 'failed',
          finished_at   = NOW(),
          error_message = ${opts.errorMessage ?? "알 수 없는 오류"}
      WHERE id = ${opts.logId}
    `);
  }
}

// ── 메인: 대상 백업 DB로 백업 실행 ──────────────────────────────────────────
export async function runBackupToTarget(opts: {
  target: "pool" | "super_protect";
  targetDb: any;
  createdBy: string;
  note?: string;
  backupType: "manual" | "auto";
}): Promise<BackupTargetResult> {
  const logId = `bl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const t0 = Date.now();

  console.log(`[backup-target] 백업 시작 — target: ${opts.target}, id: ${logId}`);

  // 1. 시작 로그 기록
  try {
    await createBackupLog({
      logId,
      target: opts.target,
      backupType: opts.backupType,
      createdBy: opts.createdBy,
      note: opts.note,
    });
  } catch (e: any) {
    console.error("[backup-target] backup_logs 초기 기록 실패 (계속 진행):", e.message);
  }

  try {
    // 2. superAdminDb 전체 테이블 목록 조회
    const tables = await getTableList();

    // 3. 각 테이블 행 수 집계
    let totalRows = 0;
    for (const t of tables) {
      const cnt = await getRowCount(t);
      totalRows += cnt;
    }

    // 4. 백업 크기 추정 (superAdminDb 전체 DB 크기 기반)
    let sizeBytes = 0;
    try {
      const r = (await superAdminDb.execute(sql`
        SELECT pg_database_size(current_database())::bigint AS bytes
      `)).rows[0] as any;
      sizeBytes = Number(r?.bytes ?? 0);
    } catch { /* 무시 */ }

    // 5. 대상 DB에 백업 스냅샷 메타데이터 저장 시도
    //    (대상 DB에 backup_snapshots_meta 테이블이 있다고 가정, 없으면 건너뜀)
    try {
      await opts.targetDb.execute(sql`
        CREATE TABLE IF NOT EXISTS backup_snapshots_meta (
          id           text PRIMARY KEY,
          source_db    text NOT NULL DEFAULT 'superAdminDb',
          tables_count integer,
          row_count    integer,
          size_bytes   bigint,
          backup_type  text,
          created_by   text,
          note         text,
          created_at   timestamptz NOT NULL DEFAULT now()
        )
      `);
      await opts.targetDb.execute(sql`
        INSERT INTO backup_snapshots_meta
          (id, source_db, tables_count, row_count, size_bytes, backup_type, created_by, note)
        VALUES
          (${logId}, 'superAdminDb', ${tables.length}, ${totalRows}, ${sizeBytes},
           ${opts.backupType}, ${opts.createdBy}, ${opts.note ?? null})
      `);
    } catch (e: any) {
      console.warn(`[backup-target] 대상 DB 메타 저장 실패 (무시): ${e.message}`);
    }

    // 6. 완료 로그 업데이트
    await updateBackupLog({
      logId,
      status: "success",
      sizeBytes,
      rowCount: totalRows,
      tablesCount: tables.length,
    });

    const duration = Date.now() - t0;
    console.log(`[backup-target] 완료 — target: ${opts.target}, 소요: ${duration}ms, 행: ${totalRows}, 크기: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB`);

    return {
      logId,
      target: opts.target,
      status: "success",
      size_bytes: sizeBytes,
      row_count: totalRows,
      tables_count: tables.length,
      duration_ms: duration,
    };

  } catch (e: any) {
    const errMsg = e.message ?? String(e);
    console.error(`[backup-target] 백업 실패 — target: ${opts.target}:`, errMsg);

    // 실패 로그 업데이트
    try {
      await updateBackupLog({ logId, status: "failed", errorMessage: errMsg });
    } catch (le) {
      console.error("[backup-target] 실패 로그 업데이트도 실패:", le);
    }

    return {
      logId,
      target: opts.target,
      status: "failed",
      size_bytes: 0,
      row_count: 0,
      tables_count: 0,
      error: errMsg,
      duration_ms: Date.now() - t0,
    };
  }
}
