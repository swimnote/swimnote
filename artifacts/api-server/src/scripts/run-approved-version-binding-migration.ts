/**
 * APPROVED VERSION BINDING 마이그레이션
 * - curriculum_versions.approved_at TIMESTAMPTZ
 * - x_curriculum_profiles.curriculum_version_id TEXT
 */
import pg from "pg";

async function main() {
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) { console.error("SUPABASE_DATABASE_URL 없음"); process.exit(1); }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("=== APPROVED VERSION BINDING migration 시작 ===");

  await client.query(`ALTER TABLE curriculum_versions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`)
    .catch((e: any) => console.log("approved_at skip:", e.message));
  console.log("✓ curriculum_versions.approved_at");

  await client.query(`ALTER TABLE x_curriculum_profiles ADD COLUMN IF NOT EXISTS curriculum_version_id TEXT`)
    .catch((e: any) => console.log("curriculum_version_id skip:", e.message));
  console.log("✓ x_curriculum_profiles.curriculum_version_id");

  // INDEX: approved_at 기반 activate-local 최신 승인 version 조회 최적화
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_curriculum_versions_approved_at
      ON curriculum_versions (swimming_pool_id, approved_at DESC)
      WHERE is_global_reference = false AND approved_at IS NOT NULL AND is_active = false
  `).catch((e: any) => console.log("idx_approved_at skip:", e.message));
  console.log("✓ idx_curriculum_versions_approved_at");

  // 검증
  const r1 = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='curriculum_versions' AND column_name='approved_at'`);
  const r2 = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='x_curriculum_profiles' AND column_name='curriculum_version_id'`);
  const r3 = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename='curriculum_versions' AND indexname='idx_curriculum_versions_approved_at'`);
  console.log("\n=== 검증 결과 ===");
  console.log(`  curriculum_versions.approved_at: ${r1.rows.length > 0 ? "✓" : "✗"}`);
  console.log(`  x_curriculum_profiles.curriculum_version_id: ${r2.rows.length > 0 ? "✓" : "✗"}`);
  console.log(`  idx_curriculum_versions_approved_at: ${r3.rows.length > 0 ? "✓" : "✗"}`);

  // Toykids 보존 확인
  const t = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM curriculum_versions WHERE is_global_reference=true) AS global_versions,
      (SELECT COUNT(*) FROM student_curriculum_assignments) AS sca_count,
      (SELECT COUNT(*) FROM growth_events WHERE source='teacher_manual') AS growth_manual
  `);
  const row = t.rows[0] as any;
  console.log(`\n=== Toykids 보존 ===`);
  console.log(`  Global versions: ${row.global_versions}`);
  console.log(`  SCA: ${row.sca_count}`);
  console.log(`  growth_events(manual): ${row.growth_manual}`);

  await client.end();
  console.log("\n=== migration 완료 ===");
}
main().catch(e => { console.error(e.message); process.exit(1); });
