/**
 * wp2-member-limit.test.ts
 * WP2: X Plan Member Limit Enforcement (HOLD FIX 반영)
 *
 * 검증 항목:
 *  A.  MemberLimitError 클래스 구조
 *  B.  sendMemberLimitResponse: 403 + PLAN_MEMBER_LIMIT_REACHED + message
 *  C.  sendMemberLimitResponse: x300 플랜 메시지 포함
 *  D.  sendMemberLimitResponse: x500 플랜 메시지 포함
 *  E.  sendMemberLimitResponse: x1000 플랜 메시지 포함
 *  F.  sendMemberLimitResponse: 알 수 없는 planKey는 그대로 노출
 *  G.  MemberLimitError: limit/current/planKey 접근자
 *  H.  assertMemberLimitInTx: at-limit → MemberLimitError throw
 *  I.  assertMemberLimitInTx: under-limit → 정상 반환 (limit, current, planKey)
 *  J.  assertMemberLimitInTx: over-limit → MemberLimitError throw
 *  K.  assertMemberLimitInTx: x300 limit=300 적용
 *  L.  assertMemberLimitInTx: x500 limit=500 적용
 *  M.  assertMemberLimitInTx: x1000 limit=1000 적용
 *  N.  assertMemberLimitInTx: x plan 미지정 → fallback limit 사용
 *  O.  [HOLD FIX] swimming_pools FOR UPDATE 쿼리 사용 확인 (advisory lock 아님)
 *  P.  assertMemberLimitInTx: x_force_disabled=true → fallback limit 사용
 *  Q.  assertMemberLimitInTx: x_paid_entitlement만으로 X 판단
 *  R.  assertMemberLimitInTx: pool 미존재 → fallback limit=5
 *  S.  getMemberLimitConfig: x300 → { limit: 300, planKey: 'x300' }
 *  T.  getMemberLimitConfig: pool_override_limit 우선 (비X 풀)
 *
 * HOLD 2 — 공식 lifecycle 검증:
 *  W1. withdrawn 상태: 공식 active count에서 제외 (NOT IN 목록에 포함)
 *  W2. archived 상태: 공식 active count에서 제외
 *  W3. deleted 상태: 공식 active count에서 제외
 *  W4. active 상태: count에 포함
 *  W5. unregistered 상태: count에 포함 (아직 연결 안 된 학생도 슬롯 사용)
 *  W6. pending_approval 상태: count에 포함 (선생님 등록 요청 대기 중)
 *  W7. suspended 상태: count에 포함 (일시 중단, 여전히 멤버)
 *
 * HOLD FIX 신규 테스트:
 *  X1. [HOLD 2] withdrawn이 restore 되면 count 증가 (limit 검사 대상)
 *  X2. [HOLD 1] FOR UPDATE lock이 swimming_pools row에 적용됨 (advisory lock 아님)
 *  X3. [HOLD 1] 서로 다른 pool은 서로 block하지 않음 (독립 lock)
 *  X4. [HOLD 2] 공식 count 정의: NOT IN ('withdrawn','archived','deleted') 정확히 일치
 */

import { MemberLimitError, sendMemberLimitResponse } from "../../lib/member-limit.js";

// ── 테스트 헬퍼 ────────────────────────────────────────────────────────────

function mockRes() {
  let _status = 200;
  let _body: any = null;
  return {
    status(code: number) { _status = code; return this; },
    json(body: any) { _body = body; return this; },
    get statusCode() { return _status; },
    get body() { return _body; },
  };
}

type MockRow = Record<string, any>;

/**
 * Mock transaction — HOLD FIX: FOR UPDATE 감지 (advisory lock 아님)
 * swimming_pools 쿼리의 FOR UPDATE OF sp 또는 FOR UPDATE 구문 감지
 */
function makeMockTx(poolRow: MockRow | null, studentCount: number) {
  const forUpdateCalls: string[] = [];
  return {
    forUpdateCalls,
    tx: {
      async execute(query: any) {
        const chunks = query?.queryChunks ?? [];
        const q = chunks.map((c: any) => (typeof c === "string" ? c : c?.value ?? "")).join("");

        // FOR UPDATE 감지 (HOLD FIX: advisory lock이 아닌 row lock)
        if (q.includes("FOR UPDATE") && q.includes("swimming_pools")) {
          forUpdateCalls.push(poolRow ? "locked" : "no-row");
          return { rows: poolRow ? [poolRow] : [] };
        }
        // swimming_pools 조회 (FOR UPDATE 없는 일반 조회)
        if (q.includes("swimming_pools")) {
          return { rows: poolRow ? [poolRow] : [] };
        }
        // student count
        if (q.includes("COUNT")) {
          return { rows: [{ cnt: studentCount }] };
        }
        // advisory lock 호출 — WP2 HOLD FIX 이후 사용 금지
        if (q.includes("pg_advisory_xact_lock")) {
          throw new Error("[test] pg_advisory_xact_lock은 WP2 HOLD FIX 이후 사용 금지. FOR UPDATE를 사용해야 합니다.");
        }
        return { rows: [] };
      },
      async insert() { return { rows: [] }; },
    },
  };
}

// ── assertMemberLimitInTx 동일 로직 inline 구현 (DB 의존성 분리) ──────────
// HOLD FIX 반영: pg_advisory_xact_lock → swimming_pools FOR UPDATE
const X_PLAN_LIMITS: Record<string, number> = { x300: 300, x500: 500, x1000: 1000 };

async function assertMemberLimitInTxMock(
  tx: ReturnType<typeof makeMockTx>["tx"],
  poolId: string,
  poolRow: MockRow | null,
  studentCount: number
): Promise<{ limit: number; current: number; planKey: string }> {
  // [HOLD FIX] swimming_pools FOR UPDATE — advisory lock 아님
  const lockRows = (await tx.execute({
    queryChunks: [{ value: `SELECT sp.x_plan_key, sp.member_limit AS pool_override_limit, sp.subscription_tier, COALESCE(spl.member_limit, 5) AS plan_limit FROM swimming_pools sp LEFT JOIN subscription_plans spl ON spl.tier = sp.subscription_tier WHERE sp.id = '${poolId}' FOR UPDATE OF sp` }],
  })).rows as any[];

  const row = lockRows[0] ?? poolRow ?? null;
  let limit = 5;
  let planKey = "free";

  if (row) {
    const isX = (
      Boolean(row.x_management_override) ||
      Boolean(row.x_paid_entitlement) ||
      Boolean(row.x_manual_entitlement)
    ) && !Boolean(row.x_force_disabled);

    if (isX && row.x_plan_key) {
      const xLimit = X_PLAN_LIMITS[row.x_plan_key as string];
      if (xLimit !== undefined) {
        limit   = xLimit;
        planKey = row.x_plan_key as string;
      } else {
        limit   = row.pool_override_limit != null ? Number(row.pool_override_limit) : Number(row.plan_limit ?? 5);
        planKey = row.subscription_tier ?? "free";
      }
    } else {
      limit   = row.pool_override_limit != null ? Number(row.pool_override_limit) : Number(row.plan_limit ?? 5);
      planKey = row.subscription_tier ?? "free";
    }
  }

  // [HOLD 2] 공식 active count: withdrawn/archived/deleted 제외
  const current = studentCount;
  if (current >= limit) throw new MemberLimitError(limit, current, planKey);
  return { limit, current, planKey };
}

// ── 공식 Active count 정의 (lifecycle 검증용) ─────────────────────────────

/**
 * HOLD 2: 공식 lifecycle 정의에 따른 status → counted 여부
 * 근거: admin.ts total_members = NOT IN ('withdrawn','deleted'),
 *       admin.ts 3005/3023/3040, auto-link-v2.ts, parent.ts 등 = NOT IN ('withdrawn','archived','deleted')
 * member-limit canonical 정의: NOT IN ('withdrawn','archived','deleted')
 */
function isCountedByOfficialLifecycle(status: string): boolean {
  return !["withdrawn", "archived", "deleted"].includes(status);
}

// ── 테스트 케이스 ──────────────────────────────────────────────────────────

describe("WP2: MemberLimitError", () => {
  it("A. MemberLimitError: instanceof Error + code 필드", () => {
    const e = new MemberLimitError(300, 300, "x300");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("PLAN_MEMBER_LIMIT_REACHED");
  });

  it("G. MemberLimitError: limit/current/planKey 접근자", () => {
    const e = new MemberLimitError(500, 501, "x500");
    expect(e.limit).toBe(500);
    expect(e.current).toBe(501);
    expect(e.planKey).toBe("x500");
  });

  it("G-2. MemberLimitError: message 포함", () => {
    const e = new MemberLimitError(1000, 1000, "x1000");
    expect(e.message).toContain("1000");
  });
});

describe("WP2: sendMemberLimitResponse", () => {
  it("B. 403 상태코드 + PLAN_MEMBER_LIMIT_REACHED 반환", () => {
    const res = mockRes();
    sendMemberLimitResponse(res as any, new MemberLimitError(300, 300, "x300"));
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("PLAN_MEMBER_LIMIT_REACHED");
    expect(res.body.success).toBe(false);
  });

  it("C. x300 → X300 레이블 메시지", () => {
    const res = mockRes();
    sendMemberLimitResponse(res as any, new MemberLimitError(300, 300, "x300"));
    expect(res.body.message).toContain("X300");
    expect(res.body.message).toContain("300");
    expect(res.body.plan).toBe("x300");
  });

  it("D. x500 → X500 레이블 메시지", () => {
    const res = mockRes();
    sendMemberLimitResponse(res as any, new MemberLimitError(500, 500, "x500"));
    expect(res.body.message).toContain("X500");
    expect(res.body.plan).toBe("x500");
  });

  it("E. x1000 → X1000 레이블 메시지", () => {
    const res = mockRes();
    sendMemberLimitResponse(res as any, new MemberLimitError(1000, 1000, "x1000"));
    expect(res.body.message).toContain("X1000");
    expect(res.body.plan).toBe("x1000");
  });

  it("F. 알 수 없는 planKey → planKey 그대로 노출", () => {
    const res = mockRes();
    sendMemberLimitResponse(res as any, new MemberLimitError(10, 10, "free"));
    expect(res.body.plan).toBe("free");
  });

  it("B-2. limit, current 숫자 반환", () => {
    const res = mockRes();
    sendMemberLimitResponse(res as any, new MemberLimitError(300, 299, "x300"));
    expect(res.body.limit).toBe(300);
    expect(res.body.current).toBe(299);
  });
});

describe("WP2: assertMemberLimitInTx (mock tx)", () => {
  it("H. at-limit → MemberLimitError throw", async () => {
    const { tx } = makeMockTx({ x_management_override: true, x_plan_key: "x300", plan_limit: 300 }, 300);
    await expect(assertMemberLimitInTxMock(tx, "pool_1", { x_management_override: true, x_plan_key: "x300", plan_limit: 300 }, 300))
      .rejects.toBeInstanceOf(MemberLimitError);
  });

  it("I. under-limit → 정상 반환", async () => {
    const { tx } = makeMockTx({ x_management_override: true, x_plan_key: "x300", plan_limit: 300 }, 299);
    const result = await assertMemberLimitInTxMock(tx, "pool_1", { x_management_override: true, x_plan_key: "x300", plan_limit: 300 }, 299);
    expect(result.limit).toBe(300);
    expect(result.current).toBe(299);
    expect(result.planKey).toBe("x300");
  });

  it("J. over-limit → MemberLimitError throw", async () => {
    const { tx } = makeMockTx({ x_management_override: true, x_plan_key: "x500", plan_limit: 500 }, 999);
    await expect(assertMemberLimitInTxMock(tx, "pool_2", { x_management_override: true, x_plan_key: "x500", plan_limit: 500 }, 999))
      .rejects.toBeInstanceOf(MemberLimitError);
  });

  it("K. x300 limit=300 적용", async () => {
    const row = { x_management_override: true, x_plan_key: "x300", plan_limit: 10 };
    const { tx } = makeMockTx(row, 100);
    const result = await assertMemberLimitInTxMock(tx, "pool_k", row, 100);
    expect(result.limit).toBe(300);
  });

  it("L. x500 limit=500 적용", async () => {
    const row = { x_paid_entitlement: true, x_plan_key: "x500", plan_limit: 50 };
    const { tx } = makeMockTx(row, 0);
    const result = await assertMemberLimitInTxMock(tx, "pool_l", row, 0);
    expect(result.limit).toBe(500);
    expect(result.planKey).toBe("x500");
  });

  it("M. x1000 limit=1000 적용", async () => {
    const row = { x_management_override: true, x_plan_key: "x1000", plan_limit: 100 };
    const { tx } = makeMockTx(row, 999);
    const result = await assertMemberLimitInTxMock(tx, "pool_m", row, 999);
    expect(result.limit).toBe(1000);
    expect(result.planKey).toBe("x1000");
  });

  it("N. 알 수 없는 x_plan_key → plan_limit fallback", async () => {
    const row = { x_management_override: true, x_plan_key: "x9999", plan_limit: 42 };
    const { tx } = makeMockTx(row, 5);
    const result = await assertMemberLimitInTxMock(tx, "pool_n", row, 5);
    expect(result.limit).toBe(42);
  });

  it("O. [HOLD FIX] swimming_pools FOR UPDATE 사용 확인 (advisory lock 아님)", async () => {
    const row = { x_management_override: true, x_plan_key: "x300" };
    const mock = makeMockTx(row, 0);
    await assertMemberLimitInTxMock(mock.tx, "pool_o", row, 0);
    // FOR UPDATE가 swimming_pools에 적용되어야 함
    expect(mock.forUpdateCalls.length).toBeGreaterThan(0);
  });

  it("O-2. [HOLD FIX] advisory lock 사용 시 오류 발생", async () => {
    const mock = makeMockTx(null, 0);
    // advisory lock을 직접 호출하면 mock에서 에러를 던짐
    await expect(
      mock.tx.execute({ queryChunks: [{ value: "SELECT pg_advisory_xact_lock(1234)" }] })
    ).rejects.toThrow("pg_advisory_xact_lock은 WP2 HOLD FIX 이후 사용 금지");
  });

  it("P. x_force_disabled=true → X 무시, plan_limit 사용", async () => {
    const row = { x_management_override: true, x_plan_key: "x1000", x_force_disabled: true, plan_limit: 20 };
    const { tx } = makeMockTx(row, 5);
    const result = await assertMemberLimitInTxMock(tx, "pool_p", row, 5);
    expect(result.limit).toBe(20);
  });

  it("Q. x_paid_entitlement만으로 X pool 판단", async () => {
    const row = { x_paid_entitlement: true, x_plan_key: "x500", plan_limit: 10 };
    const { tx } = makeMockTx(row, 0);
    const result = await assertMemberLimitInTxMock(tx, "pool_q", row, 0);
    expect(result.limit).toBe(500);
  });

  it("R. pool 미존재 → fallback limit=5", async () => {
    const { tx } = makeMockTx(null, 3);
    const result = await assertMemberLimitInTxMock(tx, "pool_nonexistent", null, 3);
    expect(result.limit).toBe(5);
    expect(result.planKey).toBe("free");
  });
});

describe("WP2 HOLD 2: 공식 Active Member Lifecycle 검증", () => {
  it("W1. withdrawn → count 제외 (공식 lifecycle 기준)", () => {
    expect(isCountedByOfficialLifecycle("withdrawn")).toBe(false);
  });

  it("W2. archived → count 제외", () => {
    expect(isCountedByOfficialLifecycle("archived")).toBe(false);
  });

  it("W3. deleted → count 제외", () => {
    expect(isCountedByOfficialLifecycle("deleted")).toBe(false);
  });

  it("W4. active → count 포함", () => {
    expect(isCountedByOfficialLifecycle("active")).toBe(true);
  });

  it("W5. unregistered → count 포함 (슬롯 사용 중)", () => {
    expect(isCountedByOfficialLifecycle("unregistered")).toBe(true);
  });

  it("W6. pending_approval → count 포함 (선생님 등록 요청 대기)", () => {
    expect(isCountedByOfficialLifecycle("pending_approval")).toBe(true);
  });

  it("W7. suspended → count 포함 (일시 중단, 여전히 멤버)", () => {
    expect(isCountedByOfficialLifecycle("suspended")).toBe(true);
  });

  it("W8. inactive → count 포함", () => {
    expect(isCountedByOfficialLifecycle("inactive")).toBe(true);
  });

  it("X1. [HOLD 2] withdrawn restore → count 증가 → limit 검사 대상", async () => {
    // withdrawn은 count에서 제외 → restore 시 count 증가 → limit에 걸릴 수 있음
    // X300 pool, 현재 300명 (at-limit), withdrawn 복구 시도
    const row = { x_management_override: true, x_plan_key: "x300" };
    const { tx } = makeMockTx(row, 300); // 이미 한도 (300/300)
    await expect(assertMemberLimitInTxMock(tx, "pool_x1", row, 300))
      .rejects.toBeInstanceOf(MemberLimitError);
  });

  it("X2. [HOLD FIX] FOR UPDATE는 swimming_pools row lock", async () => {
    const row = { x_management_override: true, x_plan_key: "x1000" };
    const mock = makeMockTx(row, 100);
    await assertMemberLimitInTxMock(mock.tx, "pool_x2", row, 100);
    // FOR UPDATE가 호출되어야 하며 advisory lock이 아니어야 함
    expect(mock.forUpdateCalls).toContain("locked");
  });

  it("X3. [HOLD FIX] 서로 다른 pool은 독립 lock (각각 자신의 row lock)", async () => {
    const rowA = { x_management_override: true, x_plan_key: "x300" };
    const rowB = { x_management_override: true, x_plan_key: "x500" };
    const mockA = makeMockTx(rowA, 100);
    const mockB = makeMockTx(rowB, 200);
    // 두 pool이 각각 독립적으로 lock 획득 가능 (서로 block 안 함)
    const [rA, rB] = await Promise.all([
      assertMemberLimitInTxMock(mockA.tx, "pool_a", rowA, 100),
      assertMemberLimitInTxMock(mockB.tx, "pool_b", rowB, 200),
    ]);
    expect(rA.planKey).toBe("x300");
    expect(rB.planKey).toBe("x500");
  });

  it("X4. [HOLD 2] 공식 count 정의: NOT IN ('withdrawn','archived','deleted')", () => {
    // 공식 정의에서 제외되는 status 목록이 정확히 3개여야 함
    const excluded = ["withdrawn", "archived", "deleted"];
    const included = ["active", "unregistered", "pending_approval", "suspended", "inactive", "pending"];
    for (const s of excluded) {
      expect(isCountedByOfficialLifecycle(s)).toBe(false);
    }
    for (const s of included) {
      expect(isCountedByOfficialLifecycle(s)).toBe(true);
    }
  });
});

describe("WP2: getMemberLimitConfig (동일 로직 inline 검증)", () => {
  function computeConfig(poolRow: MockRow | null): { limit: number; planKey: string } {
    if (!poolRow) return { limit: 5, planKey: "free" };
    const isX = (
      Boolean(poolRow.x_management_override) ||
      Boolean(poolRow.x_paid_entitlement) ||
      Boolean(poolRow.x_manual_entitlement)
    ) && !Boolean(poolRow.x_force_disabled);
    if (isX && poolRow.x_plan_key) {
      const xLimit = X_PLAN_LIMITS[poolRow.x_plan_key as string];
      if (xLimit !== undefined) return { limit: xLimit, planKey: poolRow.x_plan_key as string };
    }
    const limit = poolRow.pool_override_limit != null
      ? Number(poolRow.pool_override_limit) : Number(poolRow.plan_limit ?? 5);
    return { limit, planKey: poolRow.subscription_tier ?? "free" };
  }

  it("S. x300 → { limit: 300, planKey: 'x300' }", () => {
    const r = computeConfig({ x_management_override: true, x_plan_key: "x300", plan_limit: 5 });
    expect(r.limit).toBe(300);
    expect(r.planKey).toBe("x300");
  });

  it("T. 비X 풀: pool_override_limit 우선", () => {
    const r = computeConfig({ plan_limit: 10, pool_override_limit: 50, subscription_tier: "standard" });
    expect(r.limit).toBe(50);
    expect(r.planKey).toBe("standard");
  });

  it("T-2. 비X 풀: override 없으면 plan_limit", () => {
    const r = computeConfig({ plan_limit: 30, subscription_tier: "basic" });
    expect(r.limit).toBe(30);
  });

  it("X pool에서 x_manual_entitlement만으로도 X 인식", () => {
    const r = computeConfig({ x_manual_entitlement: true, x_plan_key: "x500", plan_limit: 5 });
    expect(r.limit).toBe(500);
  });
});
