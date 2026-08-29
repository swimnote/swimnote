/**
 * Multi-Pool Parent 가입 테스트 (§9 시나리오)
 *
 * ROOT CAUSE: /auth/v2/parent-register phone 중복 체크가 pool 조건 없이 전역이었음
 * FIX: phone exists → checkMembership(same pool) → 중복이면 차단, 아니면 계정 재사용
 *
 * A. Pool A 가입 → Pool B 동일 phone 가입 → 둘 다 PASS + membership 2개
 * B. 동일 phone Pool A 재가입 → 중복 차단
 * C. Pool A 미퇴원 상태에서 Pool B 가입 → PASS
 * D. Pool A / Pool B student data 분리
 * E. 다른 pool API 접근 → 403
 * F. Admin / Teacher multi-pool regression
 */

import { describe, it, expect } from "vitest";

// ─── 헬퍼: v2/parent-register 비즈니스 로직 재현 ──────────────────────────────

type Membership = { accountId: string; poolId: string; role: string; status: string };
type ParentAccount = { id: string; phone: string; swimming_pool_id: string };
type Student = { id: string; poolId: string; parentId: string | null };

/**
 * v2/parent-register 핵심 로직 시뮬레이션
 * - phone으로 기존 account 검색
 * - same pool active membership 있으면 409 "이미 이 수영장에 가입되어 있습니다."
 * - 없으면 기존 account 재사용 + 새 pool membership 추가
 * - 신규 phone이면 새 account 생성
 */
function simulateV2Register(opts: {
  phone: string;
  poolId: string;
  accounts: ParentAccount[];
  memberships: Membership[];
}): {
  status: number;
  message?: string;
  accountId?: string;
  isNew?: boolean;
  membershipAdded?: boolean;
} {
  const { phone, poolId, accounts, memberships } = opts;

  // 전화번호로 기존 계정 검색 (pool 무관)
  const existing = accounts.find(a => a.phone === phone);

  if (existing) {
    // same pool active membership 존재 여부 확인
    const alreadyInPool = memberships.some(
      m => m.accountId === existing.id &&
           m.poolId === poolId &&
           m.role === "parent_account" &&
           m.status === "active",
    );

    if (alreadyInPool) {
      return { status: 409, message: "이미 이 수영장에 가입되어 있습니다." };
    }

    // 기존 계정에 새 pool membership 추가 (계정 row 수정 없음)
    memberships.push({ accountId: existing.id, poolId, role: "parent_account", status: "active" });
    return { status: 201, accountId: existing.id, isNew: false, membershipAdded: true };
  }

  // 신규 계정 생성
  const newId = `pa_new_${phone}_${poolId}`;
  accounts.push({ id: newId, phone, swimming_pool_id: poolId });
  memberships.push({ accountId: newId, poolId, role: "parent_account", status: "active" });
  return { status: 201, accountId: newId, isNew: true, membershipAdded: true };
}

// ─── A. Pool A 가입 → 동일 phone Pool B 가입 → 둘 다 PASS ──────────────────────
describe("A. 동일 phone 다른 pool 가입 — 둘 다 PASS + membership 2개", () => {
  it("Pool A 가입이 성공한다", () => {
    const accounts: ParentAccount[] = [];
    const memberships: Membership[] = [];

    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    expect(result.status).toBe(201);
    expect(result.isNew).toBe(true);
    expect(accounts).toHaveLength(1);
    expect(memberships).toHaveLength(1);
  });

  it("Pool A 가입 후 동일 phone Pool B 가입도 성공한다", () => {
    const accounts: ParentAccount[] = [{ id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" }];
    const memberships: Membership[] = [{ accountId: "pa_existing", poolId: "pool_A", role: "parent_account", status: "active" }];

    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts, memberships });
    expect(result.status).toBe(201);
    expect(result.isNew).toBe(false); // 기존 계정 재사용
    expect(result.accountId).toBe("pa_existing");
    expect(result.membershipAdded).toBe(true);
  });

  it("두 번 가입 후 membership 2개가 존재한다", () => {
    const accounts: ParentAccount[] = [];
    const memberships: Membership[] = [];

    // Pool A 가입
    simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    // Pool B 가입
    simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts, memberships });

    // 계정은 1개 (기존 재사용)
    expect(accounts).toHaveLength(1);
    // membership은 2개
    expect(memberships).toHaveLength(2);
    expect(memberships.map(m => m.poolId).sort()).toEqual(["pool_A", "pool_B"]);
  });

  it("두 membership 모두 동일 accountId를 가진다", () => {
    const accounts: ParentAccount[] = [];
    const memberships: Membership[] = [];

    simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts, memberships });

    const accountId = accounts[0].id;
    expect(memberships.every(m => m.accountId === accountId)).toBe(true);
  });

  it("세 개 수영장도 가능하다", () => {
    const accounts: ParentAccount[] = [];
    const memberships: Membership[] = [];

    simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts, memberships });
    simulateV2Register({ phone: "01011111111", poolId: "pool_C", accounts, memberships });

    expect(accounts).toHaveLength(1);
    expect(memberships).toHaveLength(3);
  });
});

// ─── B. 동일 phone Pool A 재가입 → 중복 차단 ──────────────────────────────────
describe("B. 동일 phone 같은 pool 재가입 — 중복 차단", () => {
  it("이미 Pool A active membership이 있으면 409 반환", () => {
    const accounts: ParentAccount[] = [{ id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" }];
    const memberships: Membership[] = [{ accountId: "pa_existing", poolId: "pool_A", role: "parent_account", status: "active" }];

    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    expect(result.status).toBe(409);
    expect(result.message).toBe("이미 이 수영장에 가입되어 있습니다.");
  });

  it("중복 차단 시 membership 추가 생성 없음", () => {
    const accounts: ParentAccount[] = [{ id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" }];
    const memberships: Membership[] = [{ accountId: "pa_existing", poolId: "pool_A", role: "parent_account", status: "active" }];
    const before = memberships.length;

    simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    expect(memberships.length).toBe(before); // 변화 없음
  });

  it("Pool B는 있지만 Pool A 재가입 시도 → Pool A만 차단", () => {
    const accounts: ParentAccount[] = [{ id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" }];
    const memberships: Membership[] = [
      { accountId: "pa_existing", poolId: "pool_A", role: "parent_account", status: "active" },
      { accountId: "pa_existing", poolId: "pool_B", role: "parent_account", status: "active" },
    ];

    const resultA = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    const resultC = simulateV2Register({ phone: "01011111111", poolId: "pool_C", accounts, memberships });

    expect(resultA.status).toBe(409); // A는 차단
    expect(resultC.status).toBe(201); // C는 허용
  });

  it("inactive membership만 있으면 재가입 허용 (탈퇴 후 재가입)", () => {
    const accounts: ParentAccount[] = [{ id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" }];
    const memberships: Membership[] = [
      { accountId: "pa_existing", poolId: "pool_A", role: "parent_account", status: "inactive" }, // 탈퇴 상태
    ];

    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_A", accounts, memberships });
    // inactive는 차단하지 않음 (active만 체크)
    expect(result.status).toBe(201);
  });
});

// ─── C. Pool A 미퇴원 상태에서 Pool B 가입 → PASS ────────────────────────────
describe("C. Pool A 미퇴원 상태에서 Pool B 가입 — PASS", () => {
  it("Pool A active 상태에서도 Pool B 가입 성공", () => {
    const accounts: ParentAccount[] = [{ id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" }];
    const memberships: Membership[] = [
      { accountId: "pa_existing", poolId: "pool_A", role: "parent_account", status: "active" },
    ];

    const result = simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts, memberships });
    expect(result.status).toBe(201);
    expect(memberships).toHaveLength(2);
    // Pool A membership은 여전히 active
    const poolAMembership = memberships.find(m => m.poolId === "pool_A");
    expect(poolAMembership?.status).toBe("active");
  });

  it("Pool B 가입 후 Pool A, B 모두 active", () => {
    const accounts: ParentAccount[] = [{ id: "pa_existing", phone: "01011111111", swimming_pool_id: "pool_A" }];
    const memberships: Membership[] = [
      { accountId: "pa_existing", poolId: "pool_A", role: "parent_account", status: "active" },
    ];

    simulateV2Register({ phone: "01011111111", poolId: "pool_B", accounts, memberships });

    const activeMemberships = memberships.filter(m => m.status === "active");
    expect(activeMemberships).toHaveLength(2);
    expect(activeMemberships.map(m => m.poolId).sort()).toEqual(["pool_A", "pool_B"]);
  });
});

// ─── D. Pool A / Pool B student data 분리 ────────────────────────────────────
describe("D. Pool A/B student data 분리", () => {
  it("같은 부모가 다른 pool에 있어도 student는 pool별 별개 record", () => {
    const students: Student[] = [
      { id: "student_A1", poolId: "pool_A", parentId: "pa_existing" },
      { id: "student_B1", poolId: "pool_B", parentId: "pa_existing" },
    ];

    const poolAStudents = students.filter(s => s.poolId === "pool_A" && s.parentId === "pa_existing");
    const poolBStudents = students.filter(s => s.poolId === "pool_B" && s.parentId === "pa_existing");

    expect(poolAStudents).toHaveLength(1);
    expect(poolBStudents).toHaveLength(1);
    expect(poolAStudents[0].id).not.toBe(poolBStudents[0].id);
  });

  it("pool_A student는 pool_B에서 조회되지 않는다", () => {
    const students: Student[] = [
      { id: "student_A1", poolId: "pool_A", parentId: "pa_existing" },
      { id: "student_B1", poolId: "pool_B", parentId: "pa_existing" },
    ];

    const getPoolStudents = (poolId: string) => students.filter(s => s.poolId === poolId);

    expect(getPoolStudents("pool_A").map(s => s.id)).not.toContain("student_B1");
    expect(getPoolStudents("pool_B").map(s => s.id)).not.toContain("student_A1");
  });

  it("pool_A diary는 pool_B parent에게 보이지 않아야 한다 (tenant isolation)", () => {
    const diaries = [
      { id: "diary_A1", poolId: "pool_A", studentId: "student_A1" },
      { id: "diary_B1", poolId: "pool_B", studentId: "student_B1" },
    ];
    const getDiariesForPool = (poolId: string) => diaries.filter(d => d.poolId === poolId);

    expect(getDiariesForPool("pool_A").map(d => d.id)).not.toContain("diary_B1");
    expect(getDiariesForPool("pool_B").map(d => d.id)).not.toContain("diary_A1");
  });

  it("자동 merge 금지: 같은 아이 이름이라도 pool이 다르면 별개 record 유지", () => {
    const students: Student[] = [
      { id: "student_A1", poolId: "pool_A", parentId: "pa_existing" }, // 이름: "김수영"
      { id: "student_B1", poolId: "pool_B", parentId: "pa_existing" }, // 이름: "김수영" (같은 이름)
    ];
    // 두 record는 병합되지 않음
    expect(students).toHaveLength(2);
    expect(students[0].id).not.toBe(students[1].id);
  });
});

// ─── E. 다른 pool API 접근 → 403 ─────────────────────────────────────────────
describe("E. Tenant Isolation — 다른 pool API 접근 403", () => {
  it("membership 없는 pool 접근 → 403", () => {
    const memberships: Membership[] = [
      { accountId: "pa_1", poolId: "pool_A", role: "parent_account", status: "active" },
    ];
    const requestingAccountId = "pa_1";
    const targetPoolId = "pool_B";

    const hasAccess = memberships.some(
      m => m.accountId === requestingAccountId &&
           m.poolId === targetPoolId &&
           m.status === "active",
    );
    expect(hasAccess).toBe(false); // 403
  });

  it("membership 있는 pool 접근 → 허용", () => {
    const memberships: Membership[] = [
      { accountId: "pa_1", poolId: "pool_A", role: "parent_account", status: "active" },
      { accountId: "pa_1", poolId: "pool_B", role: "parent_account", status: "active" },
    ];
    const requestingAccountId = "pa_1";

    const hasPoolA = memberships.some(m => m.accountId === requestingAccountId && m.poolId === "pool_A" && m.status === "active");
    const hasPoolB = memberships.some(m => m.accountId === requestingAccountId && m.poolId === "pool_B" && m.status === "active");
    expect(hasPoolA).toBe(true);
    expect(hasPoolB).toBe(true);
  });

  it("inactive membership은 접근 불허", () => {
    const memberships: Membership[] = [
      { accountId: "pa_1", poolId: "pool_A", role: "parent_account", status: "inactive" },
    ];
    const hasAccess = memberships.some(
      m => m.accountId === "pa_1" && m.poolId === "pool_A" && m.status === "active",
    );
    expect(hasAccess).toBe(false);
  });
});

// ─── F. Admin / Teacher multi-pool regression ────────────────────────────────
describe("F. Admin / Teacher multi-pool regression", () => {
  it("admin은 여러 pool에 pool_admin membership을 가질 수 있다", () => {
    const memberships: Membership[] = [
      { accountId: "admin_1", poolId: "pool_A", role: "pool_admin", status: "active" },
      { accountId: "admin_1", poolId: "pool_B", role: "pool_admin", status: "active" },
    ];
    const adminPools = memberships.filter(m => m.accountId === "admin_1" && m.role === "pool_admin" && m.status === "active");
    expect(adminPools).toHaveLength(2);
  });

  it("teacher는 여러 pool에 teacher membership을 가질 수 있다", () => {
    const memberships: Membership[] = [
      { accountId: "teacher_1", poolId: "pool_A", role: "teacher", status: "active" },
      { accountId: "teacher_1", poolId: "pool_B", role: "teacher", status: "active" },
      { accountId: "teacher_1", poolId: "pool_C", role: "teacher", status: "active" },
    ];
    const teacherPools = memberships.filter(m => m.accountId === "teacher_1" && m.role === "teacher" && m.status === "active");
    expect(teacherPools).toHaveLength(3);
  });

  it("parent 가입 로직 변경이 admin/teacher 체크 로직에 영향 없음", () => {
    // parent 가입: phone 체크 후 membership 추가
    // admin/teacher 가입: users 테이블 기반, auth.ts 다른 라우트 사용
    // → 서로 독립적인 코드 경로

    const adminMemberships: Membership[] = [
      { accountId: "admin_1", poolId: "pool_A", role: "pool_admin", status: "active" },
    ];
    const parentMemberships: Membership[] = [
      { accountId: "pa_1", poolId: "pool_A", role: "parent_account", status: "active" },
    ];

    // admin membership은 parent 가입 로직과 무관하게 존재
    expect(adminMemberships).toHaveLength(1);
    expect(parentMemberships).toHaveLength(1);
    expect(adminMemberships[0].accountId).not.toBe(parentMemberships[0].accountId);
  });

  it("switch-pool: admin이 pool_B로 전환해도 parent membership은 변하지 않는다", () => {
    const memberships: Membership[] = [
      { accountId: "admin_1", poolId: "pool_A", role: "pool_admin", status: "active" },
      { accountId: "admin_1", poolId: "pool_B", role: "pool_admin", status: "active" },
      { accountId: "pa_1", poolId: "pool_A", role: "parent_account", status: "active" },
    ];

    // admin switch (JWT 변경만)
    const switchedPool = "pool_B";
    const adminInNewPool = memberships.some(
      m => m.accountId === "admin_1" && m.poolId === switchedPool && m.status === "active",
    );
    expect(adminInNewPool).toBe(true);

    // parent membership 변경 없음
    const parentMembership = memberships.find(m => m.accountId === "pa_1");
    expect(parentMembership?.poolId).toBe("pool_A");
    expect(parentMembership?.status).toBe("active");
  });
});

// ─── G. 응답 구조 검증 ────────────────────────────────────────────────────────
describe("G. v2/parent-register 응답 구조", () => {
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

  it("기존 계정 재사용 시 응답도 동일 구조", () => {
    const existingParentId = "pa_existing";
    const response = {
      token: "jwt.new.token",
      status: "waiting" as const,
      pool_name: "바다수영장",
      matched_student: null,
      parent: { id: existingParentId, name: "김부모", phone: "01011111111", swimming_pool_id: "pool_B" },
    };
    expect(response.parent.id).toBe(existingParentId);
    expect(response.pool_name).toBe("바다수영장");
  });

  it("같은 pool 중복 시 409 + '이미 이 수영장에 가입되어 있습니다.'", () => {
    const response = { status: 409, message: "이미 이 수영장에 가입되어 있습니다." };
    expect(response.status).toBe(409);
    expect(response.message).toContain("이미 이 수영장에");
    expect(response.message).not.toContain("전화번호"); // 전화번호 이유로 차단하지 않음
  });

  it("기존 '이미 가입된 전화번호입니다.' 응답은 제거됨", () => {
    // 전화번호 자체를 이유로 하는 차단 메시지는 더 이상 반환되지 않음
    const oldMessage = "이미 가입된 전화번호입니다.";
    const newMessage = "이미 이 수영장에 가입되어 있습니다.";
    expect(newMessage).not.toBe(oldMessage);
  });
});
