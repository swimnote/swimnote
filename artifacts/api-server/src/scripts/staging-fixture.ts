/**
 * staging-fixture.ts — §14 Synthetic Fixture 생성
 *
 * stg_ prefix로 staging 전용 데이터 생성:
 *   - Pool A (stg_pool_a): 일반 normal 모드
 *   - Pool B (stg_pool_b): X 모드 활성화
 *   - super_admin 1명, pool_admin 2명, teacher 2명, parent 1명
 *   - students 4명 (Pool A 2명, Pool B 2명)
 *   - class_groups 2개 (각 Pool 1개씩)
 *
 * 실행:
 *   ALLOW_TEST_DB_MUTATIONS=true npx tsx src/scripts/staging-fixture.ts
 *
 * 멱등: stg_ prefix ID 기준 ON CONFLICT DO NOTHING
 */

import pg from "pg";
import bcrypt from "bcryptjs";

const url = process.env.TEST_DATABASE_URL;
const allow = process.env.ALLOW_TEST_DB_MUTATIONS;

if (!url)           { console.error("🚫 TEST_DATABASE_URL not set"); process.exit(1); }
if (allow !== "true") { console.error("🚫 ALLOW_TEST_DB_MUTATIONS must be true"); process.exit(1); }

const ref = new URL(url).username.replace(/^postgres\./, "");
const STAGING_REFS = new Set(["lspmacdbyvpzysnrjsww"]);
if (!STAGING_REFS.has(ref)) { console.error(`🚫 Not a known staging ref: ${ref}`); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
const q = (sql: string, params?: any[]) => pool.query(sql, params);

async function ins(label: string, sql: string, params?: any[]) {
  try {
    const r = await q(sql, params);
    console.log(`  ✅ ${label}: ${r.rowCount} row(s)`);
  } catch (e: any) {
    if (e.message?.includes("duplicate") || e.code === "23505") {
      console.log(`  ⏩ ${label}: already exists`);
    } else {
      console.error(`  ❌ ${label}: ${e.message}`);
    }
  }
}

async function main() {
  console.log("═".repeat(60));
  console.log("§14 STAGING SYNTHETIC FIXTURE");
  console.log("═".repeat(60));

  const pw = await bcrypt.hash("Stg@swimnote2026!", 10);

  // ── 1. Swimming Pools ─────────────────────────────────────────────────────
  console.log("\n[1] Swimming Pools");
  await ins("Pool A (normal)", `
    INSERT INTO swimming_pools (id, name, address, phone, owner_name, owner_email,
      approval_status, subscription_status, subscription_tier, default_capacity)
    VALUES ('stg_pool_a', 'STG 수영장 A (Normal)', '서울시 강남구 테스트로 1', '02-0000-0001',
      'A 원장', 'pool-a@stg.test', 'approved', 'active', 'standard', 50)
    ON CONFLICT (id) DO NOTHING
  `);
  await ins("Pool B (X mode)", `
    INSERT INTO swimming_pools (id, name, address, phone, owner_name, owner_email,
      approval_status, subscription_status, subscription_tier, default_capacity,
      xmode_entitlement, xmode_config_status)
    VALUES ('stg_pool_b', 'STG 수영장 B (X Mode)', '서울시 강남구 테스트로 2', '02-0000-0002',
      'B 원장', 'pool-b@stg.test', 'approved', 'active', 'x300', 100,
      true, 'READY')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 2. Users ──────────────────────────────────────────────────────────────
  console.log("\n[2] Users");
  await ins("super_admin", `
    INSERT INTO users (id, email, password_hash, name, phone, role, is_activated)
    VALUES ('stg_user_super', 'super@stg.test', $1, 'STG 최고관리자', '010-0000-0001', 'super_admin', true)
    ON CONFLICT (email) DO NOTHING
  `, [pw]);
  await ins("pool_admin_a", `
    INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated)
    VALUES ('stg_user_admin_a', 'admin-a@stg.test', $1, 'STG 관리자A', '010-0000-0002', 'pool_admin', 'stg_pool_a', true)
    ON CONFLICT (email) DO NOTHING
  `, [pw]);
  await ins("pool_admin_b", `
    INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated)
    VALUES ('stg_user_admin_b', 'admin-b@stg.test', $1, 'STG 관리자B', '010-0000-0003', 'pool_admin', 'stg_pool_b', true)
    ON CONFLICT (email) DO NOTHING
  `, [pw]);
  await ins("teacher_a", `
    INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated)
    VALUES ('stg_user_teacher_a', 'teacher-a@stg.test', $1, 'STG 코치A', '010-0000-0004', 'teacher', 'stg_pool_a', true)
    ON CONFLICT (email) DO NOTHING
  `, [pw]);
  await ins("teacher_b", `
    INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated)
    VALUES ('stg_user_teacher_b', 'teacher-b@stg.test', $1, 'STG 코치B', '010-0000-0005', 'teacher', 'stg_pool_b', true)
    ON CONFLICT (email) DO NOTHING
  `, [pw]);

  // ── 3. Class Groups ────────────────────────────────────────────────────────
  console.log("\n[3] Class Groups");
  await ins("class_group_a", `
    INSERT INTO class_groups (id, swimming_pool_id, name, capacity, day_of_week, start_time, end_time, active)
    VALUES ('stg_class_a', 'stg_pool_a', 'STG 초급반A', 20, '{1,3,5}', '09:00', '10:00', true)
    ON CONFLICT (id) DO NOTHING
  `);
  await ins("class_group_b", `
    INSERT INTO class_groups (id, swimming_pool_id, name, capacity, day_of_week, start_time, end_time, active)
    VALUES ('stg_class_b', 'stg_pool_b', 'STG X반B', 30, '{2,4}', '10:00', '11:00', true)
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 4. Students ────────────────────────────────────────────────────────────
  console.log("\n[4] Students");
  await ins("student_a1", `
    INSERT INTO students (id, swimming_pool_id, name, gender, birth_date, status)
    VALUES ('stg_student_a1', 'stg_pool_a', 'STG 학생A1', 'male', '2010-01-15', 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  await ins("student_a2", `
    INSERT INTO students (id, swimming_pool_id, name, gender, birth_date, status)
    VALUES ('stg_student_a2', 'stg_pool_a', 'STG 학생A2', 'female', '2011-03-20', 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  await ins("student_b1", `
    INSERT INTO students (id, swimming_pool_id, name, gender, birth_date, status)
    VALUES ('stg_student_b1', 'stg_pool_b', 'STG 학생B1', 'male', '2009-07-10', 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  await ins("student_b2", `
    INSERT INTO students (id, swimming_pool_id, name, gender, birth_date, status)
    VALUES ('stg_student_b2', 'stg_pool_b', 'STG 학생B2', 'female', '2012-11-05', 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 5. Class-Group-Student links ───────────────────────────────────────────
  console.log("\n[5] Class Group Student links");
  await ins("cgs_a1", `INSERT INTO class_group_students (class_group_id, student_id) VALUES ('stg_class_a','stg_student_a1') ON CONFLICT DO NOTHING`);
  await ins("cgs_a2", `INSERT INTO class_group_students (class_group_id, student_id) VALUES ('stg_class_a','stg_student_a2') ON CONFLICT DO NOTHING`);
  await ins("cgs_b1", `INSERT INTO class_group_students (class_group_id, student_id) VALUES ('stg_class_b','stg_student_b1') ON CONFLICT DO NOTHING`);
  await ins("cgs_b2", `INSERT INTO class_group_students (class_group_id, student_id) VALUES ('stg_class_b','stg_student_b2') ON CONFLICT DO NOTHING`);

  // ── 6. WP8 seed: support_case + note ──────────────────────────────────────
  console.log("\n[6] WP8 seed data");
  await ins("support_case_stg", `
    INSERT INTO support_cases (id, pool_id, actor_role, state, title, category, ops_status)
    VALUES ('stg_case_001', 'stg_pool_a', 'pool_admin', 'NEW', 'STG 테스트 케이스', 'GENERAL', 'OPEN')
    ON CONFLICT (id) DO NOTHING
  `);
  await ins("support_case_note_stg", `
    INSERT INTO support_case_notes (id, case_id, note, event_type)
    VALUES ('stg_note_001', 'stg_case_001', 'STG 초기 메모', 'NOTE_ADDED')
    ON CONFLICT (id) DO NOTHING
  `);
  await ins("audit_log_stg", `
    INSERT INTO audit_logs (id, entity_type, entity_id, entity_version, action, actor_type, actor_id, pool_id)
    VALUES ('stg_audit_001', 'support_case', 'stg_case_001', 1, 'create', 'pool_admin', 'stg_user_admin_a', 'stg_pool_a')
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n── Fixture summary ──");
  const pools = (await q(`SELECT COUNT(*) FROM swimming_pools WHERE id LIKE 'stg_%'`)).rows[0].count;
  const users = (await q(`SELECT COUNT(*) FROM users WHERE id LIKE 'stg_%'`)).rows[0].count;
  const students = (await q(`SELECT COUNT(*) FROM students WHERE id LIKE 'stg_%'`)).rows[0].count;
  const classes = (await q(`SELECT COUNT(*) FROM class_groups WHERE id LIKE 'stg_%'`)).rows[0].count;
  const cases = (await q(`SELECT COUNT(*) FROM support_cases WHERE id LIKE 'stg_%'`)).rows[0].count;
  console.log(`  Pools: ${pools}, Users: ${users}, Students: ${students}, Classes: ${classes}, Cases: ${cases}`);
  console.log("\n✅ §14 Fixture complete");

  await pool.end();
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
