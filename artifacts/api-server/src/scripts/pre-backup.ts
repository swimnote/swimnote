/**
 * pre-backup.ts — 작업 시작 전 선백업 스크립트
 *
 * 실행: pnpm --filter @workspace/api-server run pre-backup
 *
 * 동작:
 *  1. superAdminDb + poolDb 전체 테이블 덤프
 *  2. JSON 백업 파일 생성 → Replit Object Storage 업로드
 *  3. platform_backups 테이블에 기록
 */

import { superAdminDb, poolDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Client } from "@replit/object-storage";
import crypto from "crypto";

// ── 날짜 포매터 ──────────────────────────────────────────────────────────────
function fmtDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join("") +
    "_" +
    [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join("")
  );
}

// ── 테이블 목록 조회 ─────────────────────────────────────────────────────────
async function getTableNames(db: typeof superAdminDb): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return (result.rows as { tablename: string }[]).map((r) => r.tablename);
}

// ── 테이블 전체 덤프 ─────────────────────────────────────────────────────────
async function dumpTable(
  db: typeof superAdminDb,
  table: string
): Promise<Record<string, unknown>[]> {
  try {
    const result = await db.execute(sql.raw(`SELECT * FROM "${table}"`));
    return result.rows as Record<string, unknown>[];
  } catch (e) {
    console.warn(`  [WARN] 테이블 덤프 실패: ${table} —`, (e as Error).message);
    return [];
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔵 선백업 시작:", new Date().toISOString());
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // 1. 테이블 목록 수집
  console.log("\n📋 테이블 목록 수집 중...");
  const [superTables, poolTables] = await Promise.all([
    getTableNames(superAdminDb),
    getTableNames(poolDb),
  ]);
  console.log(`  Super DB: ${superTables.length}개 — [${superTables.join(", ")}]`);
  console.log(`  Pool  DB: ${poolTables.length}개 — [${poolTables.join(", ")}]`);

  // 2. 전체 테이블 덤프
  console.log("\n💾 Super DB 테이블 덤프 중...");
  const superData: Record<string, unknown[]> = {};
  let superTotal = 0;
  for (const t of superTables) {
    const rows = await dumpTable(superAdminDb, t);
    superData[t] = rows;
    superTotal += rows.length;
    console.log(`  [super] ${t}: ${rows.length}행`);
  }

  console.log("\n💾 Pool DB 테이블 덤프 중...");
  const poolData: Record<string, unknown[]> = {};
  let poolTotal = 0;
  for (const t of poolTables) {
    const rows = await dumpTable(poolDb, t);
    poolData[t] = rows;
    poolTotal += rows.length;
    console.log(`  [pool]  ${t}: ${rows.length}행`);
  }

  // 3. 백업 JSON 구성
  const now = new Date();
  const backupId = `bk_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const fileName = `swimnote_backup_manual_${fmtDatetime(now)}.json`;
  const filePath = `backups/manual/${fileName}`;

  const payload = {
    meta: {
      backup_id:       backupId,
      created_at:      now.toISOString(),
      type:            "manual",
      created_by:      "system_pre_backup",
      note:            "작업 시작 전 선백업 (자동 생성)",
      super_db_tables: superTables.length,
      pool_db_tables:  poolTables.length,
      super_db_rows:   superTotal,
      pool_db_rows:    poolTotal,
      total_tables:    superTables.length + poolTables.length,
    },
    super_db: superData,
    pool_db:  poolData,
  };

  const jsonStr   = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(jsonStr, "utf8");
  console.log(`\n📦 백업 파일 크기: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB (${sizeBytes.toLocaleString()} bytes)`);

  // 4. Object Storage 업로드
  console.log("\n☁️  Replit Object Storage 업로드 중...");
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID 환경변수 없음");
  const storageClient = new Client({ bucketId });
  const uploadResult = await storageClient.uploadFromBytes(
    filePath,
    Buffer.from(jsonStr, "utf8"),
    { contentType: "application/json" }
  );
  if (!uploadResult.ok) {
    throw new Error("Object Storage 업로드 실패: " + JSON.stringify(uploadResult.error));
  }
  console.log(`  ✅ 업로드 완료: ${filePath}`);

  // 5. platform_backups 기록
  console.log("\n📝 platform_backups 기록 중...");
  try {
    await superAdminDb.execute(sql`
      INSERT INTO platform_backups
        (id, operator_id, operator_name, backup_type, status, is_snapshot,
         note, file_path, file_name, size_bytes, completed_at, created_by)
      VALUES
        (${backupId}, NULL, '선백업(전체)', 'platform', 'done', false,
         ${"작업 시작 전 선백업 (자동 생성)"},
         ${filePath}, ${fileName}, ${sizeBytes}, NOW(), 'system_pre_backup')
    `);
    console.log("  ✅ platform_backups 기록 완료");
  } catch (e: unknown) {
    console.warn("  [WARN] 확장 INSERT 실패, 기본 INSERT 시도:", (e as Error).message);
    try {
      await superAdminDb.execute(sql`
        INSERT INTO platform_backups
          (id, operator_id, operator_name, backup_type, status, is_snapshot, note, created_by)
        VALUES
          (${backupId}, NULL, '선백업(전체)', 'platform', 'done', false,
           ${"선백업 파일: " + filePath}, 'system_pre_backup')
      `);
      console.log("  ✅ platform_backups 기본 기록 완료");
    } catch (e2) {
      console.warn("  [WARN] platform_backups 기록 실패 (무시):", (e2 as Error).message);
    }
  }

  // 6. 최종 결과
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ 선백업 완료!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  backup_id  : ${backupId}`);
  console.log(`  파일명     : ${fileName}`);
  console.log(`  저장 경로  : ${filePath}`);
  console.log(`  파일 크기  : ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Super DB   : ${superTables.length}개 테이블, ${superTotal.toLocaleString()}행`);
  console.log(`  Pool  DB   : ${poolTables.length}개 테이블, ${poolTotal.toLocaleString()}행`);
  console.log(`  생성 시각  : ${now.toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ 선백업 실패:", e);
  process.exit(1);
});
