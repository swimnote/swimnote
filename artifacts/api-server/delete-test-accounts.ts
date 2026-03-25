/**
 * 테스트 계정 일괄 삭제 스크립트
 * 실행: cd artifacts/api-server && pnpm tsx delete-test-accounts.ts
 */
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── 삭제 대상 ID ───────────────────────────────────────────
const POOL_ID    = "pool_test2222_1774413178496";
const ADMIN_ID   = "user_test2222_1774413178496";
const TEACHER_ID = "user_test3333_1774413178496";
// 학부모 login_id 기준 삭제 (poolDb)
const PARENT_LOGIN_ID = "4444";

// 이전 학부모 test 계정 (superAdminDb에 잘못 생성된 것)
const OLD_PARENT_ID   = "pa_test4444_1774413178496";
// ──────────────────────────────────────────────────────────

async function main() {
  console.log("🗑️ 테스트 계정 삭제 시작...\n");

  // 학생 등록 요청 삭제
  await superAdminDb.execute(sql`DELETE FROM student_registration_requests WHERE swimming_pool_id = ${POOL_ID}`);
  await db.execute(sql`DELETE FROM student_registration_requests WHERE swimming_pool_id = ${POOL_ID}`).catch(() => {});
  console.log("✅ student_registration_requests 삭제");

  // 학부모 삭제 (poolDb)
  await db.execute(sql`DELETE FROM parent_accounts WHERE login_id = ${PARENT_LOGIN_ID}`);
  await superAdminDb.execute(sql`DELETE FROM parent_accounts WHERE id = ${OLD_PARENT_ID}`).catch(() => {});
  console.log("✅ 학부모 4444 삭제");

  // 선생님 삭제
  await superAdminDb.execute(sql`DELETE FROM users WHERE id = ${TEACHER_ID}`);
  console.log("✅ 선생님 3333 삭제");

  // 관리자 삭제
  await superAdminDb.execute(sql`DELETE FROM users WHERE id = ${ADMIN_ID}`);
  console.log("✅ 관리자 2222 삭제");

  // 수영장 삭제
  await superAdminDb.execute(sql`DELETE FROM swimming_pools WHERE id = ${POOL_ID}`);
  console.log("✅ 수영장 2222수영장 삭제");

  console.log("\n✅ 테스트 계정 전체 삭제 완료!");
}

main().then(() => process.exit(0)).catch((e) => { console.error("❌", e.message); process.exit(1); });
