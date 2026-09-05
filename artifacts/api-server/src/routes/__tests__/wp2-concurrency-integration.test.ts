/**
 * wp2-concurrency-integration.test.ts
 * WP2 FINAL CONCURRENCY EVIDENCE — Real PostgreSQL integration test
 *
 * 검증 시나리오:
 *   X300 pool, starting active count = 299
 *   동시 2개 member increase transaction
 *   → success 1 / PLAN_MEMBER_LIMIT_REACHED 1
 *   → final count = 300
 *   → overflow = 0
 *
 * 검증 메커니즘:
 *   SELECT ... FOR UPDATE OF sp → Tx1 lock 획득 → Tx2 대기
 *   Tx1: count=299 < 300 → INSERT → COMMIT
 *   Tx2: lock 획득 후 count 재조회 = 300 = limit → MemberLimitError → ROLLBACK
 *
 * 주의:
 *   - TEST_DATABASE_URL (swimnote-staging) 만 사용
 *   - 테스트 완료 후 생성한 데이터 전량 cleanup
 *   - Production DB 접근 없음
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { assertMemberLimitInTx, MemberLimitError } from "../../lib/member-limit.js";
import { assertSafeMutationDatabase } from "../../lib/db-safety.js";

// ── Test DB 설정 ───────────────────────────────────────────────────────────

const TEST_URL = process.env.TEST_DATABASE_URL;

// TEST_DATABASE_URL 없으면 skip (CI 기본 skip)
const describeOrSkip = TEST_URL ? describe : describe.skip;

// ── 공유 상태 ──────────────────────────────────────────────────────────────

let pool: pg.Pool;
let testDb: ReturnType<typeof drizzle>;
const TEST_POOL_ID = `wp2_test_pool_${Date.now()}`;
const TEST_POOL_B_ID = `wp2_test_pool_b_${Date.now()}`;

// ── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  if (!TEST_URL) return;

  pool = new pg.Pool({
    connectionString: TEST_URL,
    ssl: { rejectUnauthorized: false },
    max: 5, // 동시 transaction을 위해 충분한 connection pool
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });

  testDb = drizzle(pool);

  // Safety guard: staging DB만 mutation 허용
  await assertSafeMutationDatabase(testDb, "wp2-concurrency");

  // ── Test Pool A 생성 (X300, starting count 0) ─────────────────────────
  await testDb.execute(sql`
    INSERT INTO swimming_pools (id, name, address, phone, owner_name, owner_email,
      approval_status, x_management_override, x_plan_key, created_at, updated_at)
    VALUES (
      ${TEST_POOL_ID}, 'WP2 Test Pool A', '서울시 테스트구', '010-0000-0000',
      '테스트 운영자', 'test@wp2.test',
      'approved', true, 'x300', NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Test Pool B 생성 (다른 pool — 독립 lock 검증용) ─────────────────────
  await testDb.execute(sql`
    INSERT INTO swimming_pools (id, name, address, phone, owner_name, owner_email,
      approval_status, x_management_override, x_plan_key, created_at, updated_at)
    VALUES (
      ${TEST_POOL_B_ID}, 'WP2 Test Pool B', '부산시 테스트구', '010-1111-1111',
      '테스트 운영자B', 'testb@wp2.test',
      'approved', true, 'x500', NOW(), NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // ── Pool A에 299명 student 삽입 (active, count 포함) ──────────────────
  await testDb.execute(sql`
    INSERT INTO students (id, swimming_pool_id, name, status, created_at, updated_at)
    SELECT
      ${TEST_POOL_ID} || '_stu_' || g,
      ${TEST_POOL_ID},
      'TestStudent' || g,
      'active',
      NOW(), NOW()
    FROM generate_series(1, 299) g
    ON CONFLICT (id) DO NOTHING
  `);

  console.log(`[wp2-concurrency] Setup complete: pool=${TEST_POOL_ID} students=299`);
}, 30000);

afterAll(async () => {
  if (!pool) return;
  // ── Cleanup: test로 생성한 데이터 전량 삭제 ───────────────────────────
  await testDb.execute(sql`DELETE FROM students WHERE swimming_pool_id = ${TEST_POOL_ID}`);
  await testDb.execute(sql`DELETE FROM students WHERE swimming_pool_id = ${TEST_POOL_B_ID}`);
  await testDb.execute(sql`DELETE FROM swimming_pools WHERE id = ${TEST_POOL_ID}`);
  await testDb.execute(sql`DELETE FROM swimming_pools WHERE id = ${TEST_POOL_B_ID}`);
  await pool.end();
  console.log("[wp2-concurrency] Cleanup complete.");
}, 15000);

// ── 테스트 ─────────────────────────────────────────────────────────────────

describeOrSkip("WP2 FINAL: Real PostgreSQL concurrency — FOR UPDATE serialization", () => {

  it("사전 검증: starting active count = 299", async () => {
    const [cnt] = (await testDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${TEST_POOL_ID}
        AND status NOT IN ('withdrawn', 'archived', 'deleted')
    `)).rows as any[];
    expect(Number(cnt.cnt)).toBe(299);
  });

  it("X300 pool: 299→concurrent 2→success 1 / reject 1 → final 300 (overflow 0)", async () => {
    // 두 transaction을 동시에 실행
    // Tx1: FOR UPDATE 획득 → count=299 → INSERT → COMMIT
    // Tx2: Tx1 commit 후 lock 획득 → count=300 → MemberLimitError → ROLLBACK
    const makeStudentId = (suffix: string) =>
      `${TEST_POOL_ID}_concurrent_${suffix}`;

    const tx1Result = testDb.transaction(async (tx) => {
      await assertMemberLimitInTx(tx, TEST_POOL_ID);
      await tx.execute(sql`
        INSERT INTO students (id, swimming_pool_id, name, status, created_at, updated_at)
        VALUES (${makeStudentId("tx1")}, ${TEST_POOL_ID}, 'ConcurrentStudent1', 'active', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);
      return "success";
    });

    const tx2Result = testDb.transaction(async (tx) => {
      await assertMemberLimitInTx(tx, TEST_POOL_ID);
      await tx.execute(sql`
        INSERT INTO students (id, swimming_pool_id, name, status, created_at, updated_at)
        VALUES (${makeStudentId("tx2")}, ${TEST_POOL_ID}, 'ConcurrentStudent2', 'active', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);
      return "success";
    });

    const [r1, r2] = await Promise.allSettled([tx1Result, tx2Result]);

    // 결과 분석
    const results = [r1, r2];
    const successes = results.filter(r => r.status === "fulfilled" && r.value === "success");
    const rejected = results.filter(r => r.status === "rejected");
    const limitErrors = rejected.filter(r =>
      r.status === "rejected" && r.reason instanceof MemberLimitError
    );

    console.log("[wp2-concurrency] Tx1:", r1.status, r1.status === "rejected" ? r1.reason?.message : "OK");
    console.log("[wp2-concurrency] Tx2:", r2.status, r2.status === "rejected" ? r2.reason?.message : "OK");
    console.log("[wp2-concurrency] successes:", successes.length, "/ rejected:", rejected.length);

    // ── 핵심 검증 ──────────────────────────────────────────────────────
    expect(successes.length).toBe(1);        // 정확히 1건 성공
    expect(limitErrors.length).toBe(1);     // 정확히 1건 PLAN_MEMBER_LIMIT_REACHED

    // Reject된 error가 정확히 MemberLimitError + limit=300
    const err = limitErrors[0];
    if (err.status === "rejected") {
      expect(err.reason).toBeInstanceOf(MemberLimitError);
      expect((err.reason as MemberLimitError).limit).toBe(300);
      expect((err.reason as MemberLimitError).planKey).toBe("x300");
    }

    // ── Final count 검증 ───────────────────────────────────────────────
    const [cntRow] = (await testDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${TEST_POOL_ID}
        AND status NOT IN ('withdrawn', 'archived', 'deleted')
    `)).rows as any[];
    const finalCount = Number(cntRow.cnt);

    console.log("[wp2-concurrency] Final count:", finalCount);
    expect(finalCount).toBe(300);            // final = 300 (overflow=0)
  }, 30000);

  it("Pool B 독립성: Pool A lock이 Pool B에 영향 없음", async () => {
    // Pool B는 별도 row lock → Pool A의 lock과 독립적으로 동작
    // Pool B에 1명 삽입: x500 한도 내이므로 성공해야 함
    let poolBResult: string | null = null;

    await testDb.transaction(async (tx) => {
      await assertMemberLimitInTx(tx, TEST_POOL_B_ID);
      await tx.execute(sql`
        INSERT INTO students (id, swimming_pool_id, name, status, created_at, updated_at)
        VALUES (
          ${TEST_POOL_B_ID + "_stu_1"}, ${TEST_POOL_B_ID},
          'PoolBStudent', 'active', NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `);
      poolBResult = "success";
    });

    expect(poolBResult).toBe("success");
  }, 15000);

  it("최종 overflow 없음: final count = limit (overflow = 0)", async () => {
    const [cntRow] = (await testDb.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${TEST_POOL_ID}
        AND status NOT IN ('withdrawn', 'archived', 'deleted')
    `)).rows as any[];
    const finalCount = Number(cntRow.cnt);
    expect(finalCount).toBe(300);
    expect(finalCount).toBeLessThanOrEqual(300); // overflow = 0
  }, 10000);

});
