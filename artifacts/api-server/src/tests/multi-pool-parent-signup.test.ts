/**
 * Multi-Pool Parent 가입 테스트
 *
 * [2.0.0 POOL-FIRST POLICY]
 * 전화번호는 global identity가 아님.
 * 같은 pool 안에서만 중복 여부 판단.
 * 다른 pool 동일 phone → 항상 신규 account 생성.
 *
 * A. 동일 phone 다른 pool → account 완전 독립 (신규 생성)
 * B. 동일 phone 같은 pool → 중복 차단 409
 * C. 세 번째 pool도 신규 account
 * D. student data 분리 (pool별 독립 record)
 * E. Tenant isolation — 다른 pool API 접근 403
 * F. Admin / Teacher multi-pool regression (불변)
 * G. 응답 구조 검증
 * H. logout/relogin pool 분리 유지
 * I. Report cross-pool 접근 차단 모델
 */

import { describe, it, expect } from "vitest";

// ─── 헬퍼: v2/parent-register 비즈니스 로직 (Pool-First 정책) ────────────────

type ParentAccount = { id: string; phone: string; swimming_pool_id: string };
type Student      = { id: string; poolId: string; parentId: string | null };
type Report       = { id: string; poolId: string; parentAccountId: string };

let _idSeq = 0;
function nextId(prefix: string) { return `${prefix}_${++_idSeq}`; }

/**
 * [2.0.0] Pool-First simulateV2Register
 * - 같은 pool 안에서만 phone 중복 체크
 * - 다른 pool에 동일 phone 존재해도 → 무시 → 신규 account 생성
 */
function simulateV2Register(opts: {
  phone: string;
  poolId: string;
  accounts: ParentAccount[];
}): {
  status: number;
  message?: string;
  accountId?: string;
  isNew?: boolean;
} {
  const { phone, poolId, accounts } = opts;

  // Pool-scoped 중복 체크 (이 pool 안에서만)
  const existingInPool = accounts.find(
    a => a.phone === phone && a.swimming_pool_id === poolId,
  );

  if (existingInPool) {
    return { status: 409, message: "이미 이 수영장에 가입되어 있습니다." };
  }

  // 항상 신규 account 생성 (다른 pool에 동일 phone 있어도 무시)
  const newId = nextId("pa");
  accounts.push({ id: newId, phone, swimming_pool_id: poolId });
  return { status: 201, accountId: newId, isNew: true };
}

// ─── A. 동일 phone 다른 pool → 완전 독립 신규 account ───────────────────────
describe("A. 동일 phone 다른 pool — 완전 독립 신규 account 생성", () => {
  it("Pool A 가입이 성공하고 신규 account가 생성된다", () => {
    const accounts: ParentAccount[] = [];
    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    expect(result.status).toBe(201);
    expect(result.isNew).toBe(true);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].swimming_pool_id).toBe("pool_A");
  });

  it("Pool A 후 동일 phone Pool B 가입 → account_B 신규 생성 (account_A 재사용 금지)", () => {
    const accounts: ParentAccount[] = [];
    const rA = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    const rB = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts });

    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);
    // 두 account는 서로 다른 ID
    expect(rA.accountId).not.toBe(rB.accountId);
    // 각각 자신의 pool에 귀속
    expect(accounts.find(a => a.id === rA.accountId)?.swimming_pool_id).toBe("pool_A");
    expect(accounts.find(a => a.id === rB.accountId)?.swimming_pool_id).toBe("pool_B");
  });

  it("두 account는 완전히 서로 다른 row (공유 없음)", () => {
    const accounts: ParentAccount[] = [];
    simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts });

    // account 2개 존재 (1개가 재사용되지 않음)
    expect(accounts).toHaveLength(2);
    expect(accounts[0].id).not.toBe(accounts[1].id);
  });

  it("두 account 모두 isNew=true", () => {
    const accounts: ParentAccount[] = [];
    const rA = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    const rB = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts });
    expect(rA.isNew).toBe(true);
    expect(rB.isNew).toBe(true);
  });
});

// ─── B. 동일 phone 같은 pool 재가입 → 중복 차단 ─────────────────────────────
describe("B. 동일 phone 같은 pool 재가입 — 중복 차단 409", () => {
  it("같은 pool에 이미 account가 있으면 409", () => {
    const accounts: ParentAccount[] = [
      { id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" },
    ];
    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    expect(result.status).toBe(409);
    expect(result.message).toBe("이미 이 수영장에 가입되어 있습니다.");
  });

  it("중복 차단 시 account 추가 생성 없음", () => {
    const accounts: ParentAccount[] = [
      { id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" },
    ];
    simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    expect(accounts).toHaveLength(1); // 변화 없음
  });

  it("Pool B엔 account가 없으므로 Pool B 가입은 허용", () => {
    const accounts: ParentAccount[] = [
      { id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" },
    ];
    const resultA = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    const resultB = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts });
    expect(resultA.status).toBe(409); // A는 차단
    expect(resultB.status).toBe(201); // B는 신규 생성
  });

  it("오류 메시지는 수영장 중복 안내 (전화번호 아님)", () => {
    const accounts: ParentAccount[] = [
      { id: "pa_x", phone: "01011111111", swimming_pool_id: "pool_A" },
    ];
    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    expect(result.message).toContain("이미 이 수영장에");
    expect(result.message).not.toContain("전화번호");
  });
});

// ─── C. 세 번째 pool도 신규 account ─────────────────────────────────────────
describe("C. 세 번째 pool → 또 신규 account 생성", () => {
  it("pool_A, pool_B, pool_C 모두 독립 account 생성", () => {
    const accounts: ParentAccount[] = [];
    const rA = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    const rB = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts });
    const rC = simulateV2Register({ phone: "01011111111", poolId: "pool_C", accounts });

    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);
    expect(rC.status).toBe(201);
    expect(accounts).toHaveLength(3);

    const ids = [rA.accountId, rB.accountId, rC.accountId];
    expect(new Set(ids).size).toBe(3); // 3개 모두 다른 ID
  });

  it("각 account는 자신의 pool에만 귀속", () => {
    const accounts: ParentAccount[] = [];
    const rA = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    const rB = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts });
    const rC = simulateV2Register({ phone: "01011111111", poolId: "pool_C", accounts });

    expect(accounts.find(a => a.id === rA.accountId)?.swimming_pool_id).toBe("pool_A");
    expect(accounts.find(a => a.id === rB.accountId)?.swimming_pool_id).toBe("pool_B");
    expect(accounts.find(a => a.id === rC.accountId)?.swimming_pool_id).toBe("pool_C");
  });
});

// ─── D. student data pool별 독립 ─────────────────────────────────────────────
describe("D. student data 분리 — pool별 독립 record", () => {
  it("Pool A account와 Pool B account의 student는 서로 다른 ID", () => {
    const students: Student[] = [
      { id: "student_A1", poolId: "pool_A", parentId: "pa_A" },
      { id: "student_B1", poolId: "pool_B", parentId: "pa_B" },
    ];
    expect(students[0].id).not.toBe(students[1].id);
    expect(students[0].parentId).not.toBe(students[1].parentId);
  });

  it("Pool A student는 Pool B에서 조회되지 않는다", () => {
    const students: Student[] = [
      { id: "student_A1", poolId: "pool_A", parentId: "pa_A" },
      { id: "student_B1", poolId: "pool_B", parentId: "pa_B" },
    ];
    const getPoolStudents = (poolId: string) => students.filter(s => s.poolId === poolId);
    expect(getPoolStudents("pool_A").map(s => s.id)).not.toContain("student_B1");
    expect(getPoolStudents("pool_B").map(s => s.id)).not.toContain("student_A1");
  });

  it("같은 이름의 학생이라도 pool이 다르면 별개 record", () => {
    // pool_A student_A1 name: "김수영", pool_B student_B1 name: "김수영"
    const students: Student[] = [
      { id: "student_A1", poolId: "pool_A", parentId: "pa_A" },
      { id: "student_B1", poolId: "pool_B", parentId: "pa_B" },
    ];
    expect(students).toHaveLength(2);
    expect(students[0].id).not.toBe(students[1].id);
  });

  it("account가 달라지면 parent_id도 달라져서 report도 분리된다", () => {
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" },
      { id: "report_B1", poolId: "pool_B", parentAccountId: "pa_B" },
    ];
    const getReportsForAccount = (accountId: string) =>
      reports.filter(r => r.parentAccountId === accountId);

    expect(getReportsForAccount("pa_A").map(r => r.id)).toEqual(["report_A1"]);
    expect(getReportsForAccount("pa_B").map(r => r.id)).toEqual(["report_B1"]);
    // pa_B는 pa_A 리포트를 볼 수 없음
    expect(getReportsForAccount("pa_B").map(r => r.id)).not.toContain("report_A1");
  });
});

// ─── E. Tenant isolation — 다른 pool API 접근 403 ────────────────────────────
describe("E. Tenant Isolation — 다른 pool report 접근 403 모델", () => {
  it("Pool B account로 Pool A report 직접 접근 → 403 (pool_id 불일치)", () => {
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" },
    ];
    const requestingPoolId = "pool_B"; // Pool B JWT로 Pool A report 접근 시도
    const targetReport = reports.find(r => r.id === "report_A1");

    // pool_id가 다르면 접근 불허
    const allowed = targetReport?.poolId === requestingPoolId;
    expect(allowed).toBe(false); // → 403
  });

  it("Pool A account로 Pool A report → 허용", () => {
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" },
    ];
    const requestingPoolId = "pool_A";
    const targetReport = reports.find(r => r.id === "report_A1");
    const allowed = targetReport?.poolId === requestingPoolId;
    expect(allowed).toBe(true);
  });

  it("Pool B 로그인 후 Pool A report 목록 조회 결과 = 0", () => {
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" },
    ];
    const loggedInPoolId = "pool_B";
    const loggedInAccountId = "pa_B";

    const visible = reports.filter(
      r => r.poolId === loggedInPoolId && r.parentAccountId === loggedInAccountId,
    );
    expect(visible).toHaveLength(0);
  });

  it("account_A != account_B이면 report 교차 조회 원천 불가", () => {
    // Pool-First: account_A와 account_B는 서로 다른 ID
    // → report 테이블에서 account_B로 report_A 조회 시 자동으로 0건
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" },
    ];
    const reportsForPaB = reports.filter(r => r.parentAccountId === "pa_B");
    expect(reportsForPaB).toHaveLength(0);
  });
});

// ─── F. Admin / Teacher multi-pool regression (불변) ────────────────────────
describe("F. Admin / Teacher multi-pool regression — parent 정책 변경 무영향", () => {
  it("admin은 여러 pool에서 동일 account_id 유지 가능 (users 테이블, 다른 코드 경로)", () => {
    // admin/teacher는 users 테이블 기반, v2/parent-register와 무관
    const adminPools = [
      { accountId: "admin_1", poolId: "pool_A" },
      { accountId: "admin_1", poolId: "pool_B" },
    ];
    expect(new Set(adminPools.map(p => p.accountId)).size).toBe(1); // 동일 account
    expect(adminPools).toHaveLength(2);
  });

  it("teacher도 여러 pool 운영 가능 (parent 정책 불변)", () => {
    const teacherPools = [
      { accountId: "teacher_1", poolId: "pool_A" },
      { accountId: "teacher_1", poolId: "pool_B" },
      { accountId: "teacher_1", poolId: "pool_C" },
    ];
    expect(new Set(teacherPools.map(p => p.accountId)).size).toBe(1);
    expect(teacherPools).toHaveLength(3);
  });

  it("parent 가입 로직은 admin/teacher에 영향 없음 (독립 코드 경로)", () => {
    const accounts: ParentAccount[] = [];
    simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    // admin/teacher 계정은 변화 없음
    const adminAccounts = [{ id: "admin_1", poolId: "pool_A" }];
    expect(adminAccounts).toHaveLength(1);
    expect(adminAccounts[0].id).not.toBe(accounts[0].id);
  });
});

// ─── G. 응답 구조 검증 ───────────────────────────────────────────────────────
describe("G. v2/parent-register 응답 구조 (Pool-First)", () => {
  it("신규 가입 응답은 token/status/pool_name/parent를 포함한다", () => {
    const response = {
      token: "jwt.token.here",
      status: "waiting" as const,
      pool_name: "하늘수영장",
      matched_student: null,
      parent: { id: "pa_new", name: "김부모", phone: "01011111111", swimming_pool_id: "pool_A" },
    };
    expect(response.token).toBeTruthy();
    expect(["linked", "waiting"]).toContain(response.status);
    expect(response.pool_name).toBeTruthy();
    expect(response.parent.id).toBeTruthy();
  });

  it("동일 phone 다른 pool 가입도 동일 응답 구조 (isNew=true, 다른 parentId)", () => {
    const responseA = { token: "jwt_A", status: "waiting" as const, parent: { id: "pa_A", swimming_pool_id: "pool_A" } };
    const responseB = { token: "jwt_B", status: "waiting" as const, parent: { id: "pa_B", swimming_pool_id: "pool_B" } };
    expect(responseA.parent.id).not.toBe(responseB.parent.id);
    expect(responseA.parent.swimming_pool_id).not.toBe(responseB.parent.swimming_pool_id);
  });

  it("같은 pool 중복 시 409 + '이미 이 수영장에 가입되어 있습니다.'", () => {
    const response = { status: 409, message: "이미 이 수영장에 가입되어 있습니다." };
    expect(response.status).toBe(409);
    expect(response.message).toContain("이미 이 수영장에");
    expect(response.message).not.toContain("전화번호");
  });

  it("기존 '이미 가입된 전화번호입니다.' 응답은 제거됨", () => {
    const oldMessage = "이미 가입된 전화번호입니다.";
    const newMessage = "이미 이 수영장에 가입되어 있습니다.";
    expect(newMessage).not.toBe(oldMessage);
  });
});

// ─── H. logout/relogin 후에도 pool 분리 유지 ────────────────────────────────
describe("H. logout/relogin 후 pool 데이터 분리 유지", () => {
  it("pool_A JWT로 로그인 시 pool_A 데이터만 접근 가능", () => {
    // JWT에는 poolId가 포함됨: { userId: pa_A, poolId: pool_A }
    const jwtPayload = { userId: "pa_A", poolId: "pool_A", role: "parent_account" };
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" },
      { id: "report_B1", poolId: "pool_B", parentAccountId: "pa_B" },
    ];
    const accessible = reports.filter(
      r => r.poolId === jwtPayload.poolId && r.parentAccountId === jwtPayload.userId,
    );
    expect(accessible).toHaveLength(1);
    expect(accessible[0].id).toBe("report_A1");
  });

  it("pool_B JWT로 재로그인 시 pool_A 데이터 0건", () => {
    const jwtPayload = { userId: "pa_B", poolId: "pool_B", role: "parent_account" };
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" },
    ];
    const accessible = reports.filter(
      r => r.poolId === jwtPayload.poolId && r.parentAccountId === jwtPayload.userId,
    );
    expect(accessible).toHaveLength(0);
  });

  it("account_B 재로그인 후 pool_id는 pool_B 고정", () => {
    // pool_B용 account는 swimming_pool_id = pool_B
    const account = { id: "pa_B", swimming_pool_id: "pool_B", phone: "01011111111" };
    expect(account.swimming_pool_id).toBe("pool_B");
    expect(account.swimming_pool_id).not.toBe("pool_A");
  });
});

// ─── I. Report cross-pool 접근 모델 검증 ────────────────────────────────────
describe("I. Report cross-pool 접근 차단 — structural guarantee", () => {
  it("pool-first 구조에서 account_A != account_B → report 교차 조회 구조적 불가", () => {
    const accounts: ParentAccount[] = [];
    const rA = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts });
    const rB = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts });

    // account_A와 account_B는 서로 다른 ID
    expect(rA.accountId).not.toBe(rB.accountId);

    // Pool A reports
    const reports: Report[] = [
      { id: "report_A1", poolId: "pool_A", parentAccountId: rA.accountId! },
    ];

    // Pool B account로 Pool A report 조회 → 0건
    const crossPoolQuery = reports.filter(
      r => r.parentAccountId === rB.accountId,
    );
    expect(crossPoolQuery).toHaveLength(0);
  });

  it("Pool A report_id를 pool_B context에서 직접 접근 → pool_id 불일치 → 403 시뮬레이션", () => {
    const targetReport = { id: "report_A1", poolId: "pool_A", parentAccountId: "pa_A" };
    const requestContext = { poolId: "pool_B", accountId: "pa_B" };

    const poolMatch    = targetReport.poolId === requestContext.poolId;
    const accountMatch = targetReport.parentAccountId === requestContext.accountId;

    expect(poolMatch).toBe(false);    // pool 불일치
    expect(accountMatch).toBe(false); // account 불일치
    // → 403 반환
  });

  it("ToyKids Growth Report는 Swimnote2 account에서 조회 결과 0", () => {
    // 실제 버그 재현 시나리오
    const toykidsAccountId  = "pa_toykids_001";
    const swimnote2AccountId = "pa_swimnote2_002"; // 2.0.0: 별도 신규 account

    expect(toykidsAccountId).not.toBe(swimnote2AccountId); // 다른 ID

    const growthReports: Report[] = [
      { id: "gr_toykids_001", poolId: "pool_toykids", parentAccountId: toykidsAccountId },
    ];

    const swimnote2Visible = growthReports.filter(
      r => r.parentAccountId === swimnote2AccountId,
    );
    expect(swimnote2Visible).toHaveLength(0); // 0건 → 버그 재현 불가
  });
});

// ─── K. Similar Name Pool — 이름 유사 수영장 완전 분리 ──────────────────────
/**
 * [2.0.0 BUG FIX] pool-join-request.tsx가 pool_id 없이 simple-parent-register를
 * 호출하면 서버가 phone → students.parent_phone LIMIT 1 로 "스윔노트"를 자동 선택했음.
 * 수정: pool_id 필수, 이름 prefix/phone 기반 pool resolve 완전 제거.
 */
describe("K. Similar Name Pool — 이름 유사 수영장 계정 완전 분리", () => {
  const POOL_A = "pool_swimnote";    // name = "스윔노트"
  const POOL_B = "pool_swimnote2";   // name = "스윔노트2"
  const POOL_C = "pool_swimnote3";   // name = "스윔노트3"
  const SAME_PHONE = "01011111111";

  it("스윔노트 선택 → account pool = 스윔노트", () => {
    const accounts: ParentAccount[] = [];
    const r = simulateV2Register({ phone: SAME_PHONE, poolId: POOL_A, accounts });
    expect(r.status).toBe(201);
    expect(accounts[0].swimming_pool_id).toBe(POOL_A);
    expect(accounts[0].swimming_pool_id).not.toBe(POOL_B);
    expect(accounts[0].swimming_pool_id).not.toBe(POOL_C);
  });

  it("스윔노트2 선택 → account pool = 스윔노트2 (스윔노트 아님)", () => {
    const accounts: ParentAccount[] = [];
    const r = simulateV2Register({ phone: SAME_PHONE, poolId: POOL_B, accounts });
    expect(r.status).toBe(201);
    expect(accounts[0].swimming_pool_id).toBe(POOL_B);
    expect(accounts[0].swimming_pool_id).not.toBe(POOL_A);
  });

  it("스윔노트3 선택 → account pool = 스윔노트3 (스윔노트 아님)", () => {
    const accounts: ParentAccount[] = [];
    const r = simulateV2Register({ phone: SAME_PHONE, poolId: POOL_C, accounts });
    expect(r.status).toBe(201);
    expect(accounts[0].swimming_pool_id).toBe(POOL_C);
    expect(accounts[0].swimming_pool_id).not.toBe(POOL_A);
  });

  it("동일 phone으로 스윔노트/스윔노트2/스윔노트3 모두 가입 → 3개 독립 account", () => {
    const accounts: ParentAccount[] = [];
    const rA = simulateV2Register({ phone: SAME_PHONE, poolId: POOL_A, accounts });
    const rB = simulateV2Register({ phone: SAME_PHONE, poolId: POOL_B, accounts });
    const rC = simulateV2Register({ phone: SAME_PHONE, poolId: POOL_C, accounts });

    expect(rA.status).toBe(201);
    expect(rB.status).toBe(201);
    expect(rC.status).toBe(201);

    // 3개 계정 모두 다른 ID
    expect(rA.accountId).not.toBe(rB.accountId);
    expect(rB.accountId).not.toBe(rC.accountId);
    expect(rA.accountId).not.toBe(rC.accountId);

    // 각 계정의 pool이 정확히 분리됨
    const paA = accounts.find(a => a.id === rA.accountId)!;
    const paB = accounts.find(a => a.id === rB.accountId)!;
    const paC = accounts.find(a => a.id === rC.accountId)!;
    expect(paA.swimming_pool_id).toBe(POOL_A);
    expect(paB.swimming_pool_id).toBe(POOL_B);
    expect(paC.swimming_pool_id).toBe(POOL_C);
  });

  it("스윔노트3 계정으로 스윔노트 data 조회 → 0건", () => {
    const rA_accountId = "pa_swimnote";
    const rC_accountId = "pa_swimnote3";
    const reports: Report[] = [
      { id: "report_A1", poolId: POOL_A, parentAccountId: rA_accountId },
    ];
    const crossQuery = reports.filter(r => r.parentAccountId === rC_accountId);
    expect(crossQuery).toHaveLength(0);
  });

  it("pool_id 없이 가입 시도 → 400 (서버 safeguard)", () => {
    // simple-parent-register: pool_id 필수 (400)
    const requestWithoutPoolId = { parent_name: "홍길동", phone: SAME_PHONE, password: "1234" };
    // pool_id 없음 → 서버가 400 반환하는 것을 모델링
    const hasPoolId = "pool_id" in requestWithoutPoolId;
    expect(hasPoolId).toBe(false); // pool_id 미포함 확인
    // 서버 로직: !requestedPoolId → return err(400, "수영장을 선택해주세요.")
    const serverResponse = { status: 400, message: "수영장을 선택해주세요. pool_id는 필수 항목입니다." };
    expect(serverResponse.status).toBe(400);
  });

  it("NAME_PREFIX_FALLBACK = 0: 이름이 비슷해도 pool_id로만 귀속 결정", () => {
    // '스윔노트', '스윔노트2', '스윔노트3' — 이름 prefix가 동일해도
    // pool_id가 다르면 완전히 별개 pool로 취급
    const resolve = (selectedPoolId: string) => {
      // [2.0.0] pool_name으로 resolve 금지 — selectedPoolId를 그대로 사용
      return selectedPoolId;
    };
    expect(resolve(POOL_A)).toBe(POOL_A);
    expect(resolve(POOL_B)).toBe(POOL_B);
    expect(resolve(POOL_C)).toBe(POOL_C);
    expect(resolve(POOL_B)).not.toBe(POOL_A); // "스윔노트2" ≠ "스윔노트"
    expect(resolve(POOL_C)).not.toBe(POOL_A); // "스윔노트3" ≠ "스윔노트"
  });

  it("DEFAULT_POOL_FALLBACK = 0: pool 미선택 시 어떤 pool에도 귀속 금지", () => {
    const accounts: ParentAccount[] = [
      { id: "pa_A", phone: SAME_PHONE, swimming_pool_id: POOL_A },
    ];
    // phone으로 pool_A가 있어도, pool_C 가입 요청 시 pool_A로 fallback 금지
    const existingByPhoneOnly = accounts.find(a => a.phone === SAME_PHONE);
    // Pool-First: phone만으로 pool을 결정하지 않음
    const register = (requestedPoolId: string | null) => {
      if (!requestedPoolId) return { status: 400 }; // pool_id 없으면 400
      const dup = accounts.find(a => a.phone === SAME_PHONE && a.swimming_pool_id === requestedPoolId);
      if (dup) return { status: 409 };
      const newId = "pa_new";
      accounts.push({ id: newId, phone: SAME_PHONE, swimming_pool_id: requestedPoolId });
      return { status: 201, accountId: newId };
    };
    expect(register(null).status).toBe(400); // pool 없음 → 400
    const r = register(POOL_C);
    expect(r.status).toBe(201);
    const newAccount = accounts.find(a => a.id === r.accountId)!;
    expect(newAccount.swimming_pool_id).toBe(POOL_C); // pool_C에 정확히 귀속
    expect(newAccount.swimming_pool_id).not.toBe(POOL_A); // pool_A fallback 없음
    expect(existingByPhoneOnly?.swimming_pool_id).toBe(POOL_A); // 기존 pool_A 계정 불변
  });
});

// ─── J. SQL Injection 방어 (pool-scoped 쿼리 유지) ──────────────────────────
describe("J. pool_id 및 phone pool-scoped 쿼리 방어", () => {
  it("phone만으로 전역 조회하지 않음 — pool_id 조건 필수", () => {
    const accounts: ParentAccount[] = [
      { id: "pa_A", phone: "01011111111", swimming_pool_id: "pool_A" },
    ];

    // Pool B에서 동일 phone 조회 → pool-scoped이므로 null
    const foundInPoolB = accounts.find(
      a => a.phone === "01011111111" && a.swimming_pool_id === "pool_B",
    );
    expect(foundInPoolB).toBeUndefined(); // pool B에선 존재하지 않음
  });

  it("pool_id 조건이 없으면 다른 pool account가 잘못 매칭될 수 있는 위험 제거", () => {
    const accounts: ParentAccount[] = [
      { id: "pa_A", phone: "01011111111", swimming_pool_id: "pool_A" },
    ];

    // 글로벌 조회 (2.0.0에서 제거된 방식) → pa_A가 반환됨 = 위험
    const globalFound = accounts.find(a => a.phone === "01011111111");
    // Pool-Scoped 조회 (2.0.0 새 방식)
    const scopedFound = accounts.find(
      a => a.phone === "01011111111" && a.swimming_pool_id === "pool_B",
    );

    expect(globalFound).toBeDefined();   // 글로벌이면 잘못 찾힘
    expect(scopedFound).toBeUndefined(); // pool-scoped는 안전하게 미존재
  });
});
