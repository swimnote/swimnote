import { signToken } from "../src/lib/auth.js";
import { db, superAdminDb } from "@workspace/db";
import { parentAccountsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

const API = "http://localhost:8080/api";

async function callMe(label: string, token: string | null) {
  if (!token) { console.log(`[SKIP] ${label}: 토큰 없음`); return; }
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    const preview = JSON.stringify(body).substring(0, 150);
    console.log(`[${res.status}] ${label}`);
    console.log(`       ${preview}`);
    return { status: res.status, body };
  } catch (e: any) {
    console.log(`[ERROR] ${label}: ${e.message}`);
  }
}

async function run() {
  console.log("=== /auth/me 검증 시작 ===\n");

  // 탈퇴되지 않은 pool_admin 찾기
  const adminRows = await superAdminDb.execute(sql`
    SELECT id, role, swimming_pool_id
    FROM users
    WHERE role = 'pool_admin'
      AND (withdrawal_requested_at IS NULL)
      AND is_activated = true
    LIMIT 1
  `);
  const admin = adminRows.rows[0] as any;

  // 탈퇴되지 않은 teacher 찾기
  const teacherRows = await superAdminDb.execute(sql`
    SELECT id, role, swimming_pool_id
    FROM users
    WHERE role = 'teacher'
      AND (withdrawal_requested_at IS NULL)
      AND is_activated = true
    LIMIT 1
  `);
  const teacher = teacherRows.rows[0] as any;

  // 실제 학부모 계정
  const [parent] = await db
    .select({ id: parentAccountsTable.id, swimming_pool_id: parentAccountsTable.swimming_pool_id })
    .from(parentAccountsTable)
    .limit(1);

  console.log(`조회된 계정:`);
  console.log(`  관리자: ${admin?.id?.substring(0, 20) ?? "없음"} (${admin?.role})`);
  console.log(`  선생님: ${teacher?.id?.substring(0, 20) ?? "없음"} (${teacher?.role})`);
  console.log(`  학부모: ${parent?.id?.substring(0, 20) ?? "없음"}\n`);

  const adminToken   = admin   ? signToken({ userId: admin.id,   role: admin.role,   poolId: admin.swimming_pool_id   ?? null }) : null;
  const teacherToken = teacher ? signToken({ userId: teacher.id, role: teacher.role, poolId: teacher.swimming_pool_id ?? null }) : null;
  const parentToken  = parent  ? signToken({ userId: parent.id,  role: "parent_account", poolId: parent.swimming_pool_id ?? null }) : null;
  const fakeParentToken = signToken({ userId: "pa_v2_nonexistent_fake_000", role: "parent_account", poolId: null });
  const badSigToken = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4IiwicGFzc3dvcmQiOiJ4Iiwicm9sZSI6InBvb2xfYWRtaW4iLCJ0diI6MX0.badsignature";

  console.log("=== 검증 케이스 ===\n");
  const r1 = await callMe("1. 관리자 JWT  → 200 기대", adminToken);
  const r2 = await callMe("2. 선생님 JWT  → 200 기대", teacherToken);
  const r3 = await callMe("3. 학부모 JWT  → 200 기대", parentToken);
  const r4 = await callMe("4. 없는 학부모 ID → 404 기대", fakeParentToken);
  const r5 = await callMe("5. 잘못된 JWT  → 401 기대", badSigToken);

  console.log("\n=== 결과 요약 ===");
  console.log(`1. 관리자:         ${r1?.status === 200 ? "✅ PASS" : "❌ FAIL"} (HTTP ${r1?.status})`);
  console.log(`2. 선생님:         ${r2?.status === 200 ? "✅ PASS" : "❌ FAIL"} (HTTP ${r2?.status})`);
  console.log(`3. 학부모:         ${r3?.status === 200 ? "✅ PASS" : "❌ FAIL"} (HTTP ${r3?.status})`);
  console.log(`4. 없는 학부모 ID: ${r4?.status === 404 ? "✅ PASS" : "❌ FAIL"} (HTTP ${r4?.status})`);
  console.log(`5. 잘못된 JWT:     ${r5?.status === 401 ? "✅ PASS" : "❌ FAIL"} (HTTP ${r5?.status})`);

  if (r3?.status === 200) {
    console.log("\n=== 학부모 /auth/me 응답 JSON (전체) ===");
    console.log(JSON.stringify(r3.body, null, 2));
  }

  if (r1?.status === 200) {
    console.log("\n=== 관리자 /auth/me 응답 JSON (주요 필드) ===");
    const { id, name, role, email, swimming_pool_id, roles } = r1.body as any;
    console.log(JSON.stringify({ id: id?.substring(0,20), name, role, email, swimming_pool_id, roles }, null, 2));
  }

  process.exit(0);
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
