/**
 * lib/backup.ts — 실제 DB 전체 백업 생성 공유 모듈
 *
 * super.ts (수동 백업 API) 및 backup-batch.ts (자동 스케줄러) 양쪽에서 사용.
 */

import { superAdminDb, poolDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Client as ObjectStorageClient } from "@replit/object-storage";
import crypto from "crypto";

// ── 날짜 포매터 ─────────────────────────────────────────────────────────────
export function fmtBackupDatetime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())].join("") +
    "_" +
    [p(d.getHours()), p(d.getMinutes()), p(d.getSeconds())].join("")
  );
}

// ── 테이블 목록 조회 ─────────────────────────────────────────────────────────
async function getTableList(db: typeof superAdminDb): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return (result.rows as { tablename: string }[]).map((r) => r.tablename);
}

// ── 테이블 전체 덤프 ─────────────────────────────────────────────────────────
async function dumpOneTable(
  db: typeof superAdminDb,
  table: string
): Promise<Record<string, unknown>[]> {
  try {
    const result = await db.execute(sql.raw(`SELECT * FROM "${table}"`));
    return result.rows as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export interface BackupResult {
  backupId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  superTables: number;
  poolTables: number;
  storageType: "object_storage" | "database";
}

// ── 실제 DB 전체 백업 생성 ────────────────────────────────────────────────────
export async function runRealBackup(opts: {
  type: "manual" | "auto";
  createdBy: string;
  note?: string;
}): Promise<BackupResult> {
  const now = new Date();
  const backupId = `bk_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const prefix = opts.type === "manual" ? "manual" : "auto";
  const fileName = `swimnote_backup_${prefix}_${fmtBackupDatetime(now)}.json`;
  const filePath = `backups/${prefix}/${fileName}`;

  // 1. 테이블 목록 수집 (backup_data 컬럼 자체는 백업에서 제외 - 재귀 방지)
  const [superTablesFull, poolTables] = await Promise.all([
    getTableList(superAdminDb),
    getTableList(poolDb),
  ]);
  // backup_data 컬럼만 제외 (테이블은 포함, 단 backup_data 값은 null로 처리)
  const superTables = superTablesFull;

  // 2. 전체 데이터 덤프
  const superData: Record<string, unknown[]> = {};
  for (const t of superTables) {
    if (t === "platform_backups") {
      // backup_data 컬럼 제외하고 덤프
      try {
        const result = await superAdminDb.execute(sql.raw(
          `SELECT id, operator_id, operator_name, backup_type, backup_type_v2, status,
                  is_snapshot, size_bytes, note, file_path, file_name, storage_type,
                  super_db_tables, pool_db_tables, total_tables, created_by, created_at, completed_at
           FROM "platform_backups"`
        ));
        superData[t] = result.rows as Record<string, unknown>[];
      } catch {
        superData[t] = [];
      }
    } else {
      superData[t] = await dumpOneTable(superAdminDb, t);
    }
  }
  const poolData: Record<string, unknown[]> = {};
  for (const t of poolTables) {
    poolData[t] = await dumpOneTable(poolDb, t);
  }

  // 3. JSON 생성
  const superTotal = Object.values(superData).reduce((s, r) => s + r.length, 0);
  const poolTotal  = Object.values(poolData).reduce((s, r) => s + r.length, 0);

  const payload = {
    meta: {
      backup_id:       backupId,
      created_at:      now.toISOString(),
      type:            opts.type,
      created_by:      opts.createdBy,
      note:            opts.note ?? null,
      super_db_tables: superTables.length,
      pool_db_tables:  poolTables.length,
      super_db_rows:   superTotal,
      pool_db_rows:    poolTotal,
      total_tables:    superTables.length + poolTables.length,
    },
    super_db: superData,
    pool_db:  poolData,
  };

  const jsonBuf   = Buffer.from(JSON.stringify(payload), "utf8");
  const sizeBytes = jsonBuf.length;

  // 4. Object Storage 업로드 시도 → 실패 시 DB 저장 fallback
  let storageType: "object_storage" | "database" = "database";
  let storedFilePath = filePath;

  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID 미설정");
    const storageClient = new ObjectStorageClient({ bucketId });
    const uploadRes = await storageClient.uploadFromBytes(filePath, jsonBuf, {
      contentType: "application/json",
    });
    if (!uploadRes.ok) throw new Error(`업로드 실패: ${JSON.stringify(uploadRes.error)}`);
    storageType = "object_storage";
    console.log(`[backup] Object Storage 업로드 완료: ${filePath}`);
  } catch (e) {
    console.warn(`[backup] Object Storage 실패 (DB fallback): ${(e as Error).message}`);
    storageType = "database";
    storedFilePath = `db://${filePath}`;
  }

  // 5. platform_backups 기록
  const jsonStr = jsonBuf.toString("utf8");
  await superAdminDb.execute(sql`
    INSERT INTO platform_backups
      (id, operator_id, operator_name, backup_type, backup_type_v2, status, is_snapshot,
       note, file_path, file_name, size_bytes, storage_type, backup_data,
       super_db_tables, pool_db_tables, total_tables, completed_at, created_by)
    VALUES
      (${backupId}, NULL, ${"전체 통합 백업"}, ${"platform"}, ${opts.type}, ${"done"}, false,
       ${opts.note ?? null}, ${storedFilePath}, ${fileName}, ${sizeBytes},
       ${storageType},
       ${storageType === "database" ? jsonStr : null},
       ${superTables.length}, ${poolTables.length},
       ${superTables.length + poolTables.length},
       NOW(), ${opts.createdBy})
  `);
  console.log(`[backup] 기록 완료 — id: ${backupId}, storage: ${storageType}`);

  return {
    backupId,
    fileName,
    filePath: storedFilePath,
    sizeBytes,
    superTables: superTables.length,
    poolTables: poolTables.length,
    storageType,
  };
}

// ── 오래된 자동 백업 정리 ─────────────────────────────────────────────────────
export async function cleanupOldAutoBackups(retentionDays: number): Promise<number> {
  console.log(`[backup] 자동 백업 정리 — ${retentionDays}일 초과 삭제`);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // 삭제 대상 목록 조회
  const toDelete = (await superAdminDb.execute(sql`
    SELECT id, file_path, storage_type FROM platform_backups
    WHERE backup_type_v2 = 'auto' AND created_at < ${cutoff}
  `)).rows as { id: string; file_path: string | null; storage_type: string | null }[];

  if (toDelete.length === 0) {
    console.log("[backup] 정리할 자동 백업 없음");
    return 0;
  }

  for (const row of toDelete) {
    // Object Storage 파일 삭제 시도
    if (row.storage_type === "object_storage" && row.file_path) {
      try {
        const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
        const client = bucketId ? new ObjectStorageClient({ bucketId }) : new ObjectStorageClient();
        await client.delete(row.file_path);
        console.log(`[backup] Object Storage 파일 삭제: ${row.file_path}`);
      } catch (e) {
        console.warn(`[backup] Object Storage 파일 삭제 실패: ${(e as Error).message}`);
      }
    }
    // DB 레코드 삭제
    await superAdminDb.execute(sql`DELETE FROM platform_backups WHERE id = ${row.id}`).catch(() => {});
  }

  console.log(`[backup] 자동 백업 ${toDelete.length}개 삭제 완료`);
  return toDelete.length;
}
