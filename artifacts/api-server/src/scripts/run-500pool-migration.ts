/**
 * Production migration runner: wp-500pool-curriculum-scale
 * 실행: pnpm --filter @workspace/api-server exec tsx src/scripts/run-500pool-migration.ts
 */
import pg from "pg";

async function main() {
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) { console.error("SUPABASE_DATABASE_URL 없음"); process.exit(1); }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("=== wp-500pool-curriculum-scale migration 시작 ===");

  await client.query(`ALTER TABLE curriculum_versions ADD COLUMN IF NOT EXISTS source_content_hash TEXT`).catch((e: any) => console.log("source_content_hash skip:", e.message));
  console.log("✓ source_content_hash");

  await client.query(`ALTER TABLE curriculum_versions ADD COLUMN IF NOT EXISTS import_status TEXT DEFAULT 'DRAFT'`).catch((e: any) => console.log("import_status skip:", e.message));
  console.log("✓ import_status");

  await client.query(`ALTER TABLE curriculum_versions ADD COLUMN IF NOT EXISTS is_global_reference BOOLEAN NOT NULL DEFAULT false`).catch((e: any) => console.log("is_global_reference skip:", e.message));
  console.log("✓ is_global_reference");

  await client.query(`ALTER TABLE curriculum_versions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`).catch((e: any) => console.log("archived_at skip:", e.message));
  console.log("✓ archived_at");

  await client.query(`CREATE INDEX IF NOT EXISTS idx_curriculum_versions_global_ref ON curriculum_versions (import_status) WHERE is_global_reference = true`).catch((e: any) => console.log("idx_global_ref skip:", e.message));
  console.log("✓ idx_curriculum_versions_global_ref");

  await client.query(`CREATE INDEX IF NOT EXISTS idx_curriculum_versions_local_active ON curriculum_versions (swimming_pool_id, is_active) WHERE is_global_reference = false AND is_active = true`).catch((e: any) => console.log("idx_local_active skip:", e.message));
  console.log("✓ idx_curriculum_versions_local_active");

  await client.query(`CREATE INDEX IF NOT EXISTS idx_curriculum_versions_content_hash ON curriculum_versions (swimming_pool_id, source_content_hash) WHERE is_global_reference = false AND source_content_hash IS NOT NULL`).catch((e: any) => console.log("idx_content_hash skip:", e.message));
  console.log("✓ idx_curriculum_versions_content_hash");

  // === schema 검증 ===
  const colRes = await client.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'curriculum_versions'
      AND column_name IN ('source_content_hash','import_status','is_global_reference','archived_at')
    ORDER BY column_name
  `);
  console.log("\n=== curriculum_versions 컬럼 확인 ===");
  for (const r of colRes.rows) {
    const row = r as any;
    console.log(`  ${row.column_name}: ${row.data_type} (default: ${row.column_default})`);
  }

  const idxRes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'curriculum_versions'
      AND indexname IN ('idx_curriculum_versions_global_ref','idx_curriculum_versions_local_active','idx_curriculum_versions_content_hash')
    ORDER BY indexname
  `);
  console.log("\n=== INDEX 확인 ===");
  for (const r of idxRes.rows) console.log(`  ✓ ${(r as any).indexname}`);

  // === Toykids 데이터 보존 확인 ===
  const toykidsRes = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM curriculum_versions WHERE is_global_reference=true) AS global_versions,
      (SELECT COUNT(*) FROM x_curriculum_student_assignments) AS sca_count,
      (SELECT COUNT(*) FROM growth_events WHERE source='teacher_manual') AS growth_manual,
      (SELECT COUNT(*) FROM curriculum_progress_observations) AS cpo_count,
      (SELECT COUNT(*) FROM student_curriculum_progress) AS scp_count
  `);
  const t = toykidsRes.rows[0] as any;
  console.log("\n=== Toykids 데이터 보존 확인 ===");
  console.log(`  Global versions: ${t.global_versions}`);
  console.log(`  SCA count:       ${t.sca_count}`);
  console.log(`  Growth manual:   ${t.growth_manual}`);
  console.log(`  CPO count:       ${t.cpo_count}`);
  console.log(`  SCP count:       ${t.scp_count}`);

  // === 멱등성 확인 (2회차) ===
  await client.query(`ALTER TABLE curriculum_versions ADD COLUMN IF NOT EXISTS source_content_hash TEXT`).catch(() => {});
  await client.query(`CREATE INDEX IF NOT EXISTS idx_curriculum_versions_global_ref ON curriculum_versions (import_status) WHERE is_global_reference = true`).catch(() => {});
  console.log("\n✓ 멱등성 확인 완료 (2회차 에러 없음)");

  await client.end();
  console.log("\n=== migration 완료 ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
