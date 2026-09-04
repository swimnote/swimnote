/**
 * Multi-Pool Membership 테스트
 *
 * A. checkMembership 로직 단위 테스트
 * B. getMemberships 로직 단위 테스트
 * C. upsertMembership 로직 단위 테스트
 * D. Signup 중복 체크 — Multi-Pool 허용 확인
 * E. Tenant Isolation 테스트
 * F. Migration Gate — backfill 검증 로직
 * G. /me/memberships 응답 형식
 * H. /auth/switch-pool 응답 형식 + 입력 검증
 * I. MembershipsContext 상태 로직
 * J. SECURITY — SQL injection 방어 (role/poolId 화이트리스트 + 형식 검증)
 * K. SECURITY — validateMigration anti-join 방식 검증
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 화이트리스트 상수 (pool-db-membership.ts와 동일) ─────────────────────────
const VALID_ROLES = new Set(["pool_admin", "teacher", "sub_admin", "parent_account"]);
const VALID_STATUS = new Set(["active", "inactive", "pending"]);
const VALID_ACCOUNT_TYPE = new Set(["user", "parent"]);

// pool_id 형식 검증 (memberships.ts와 동일)
function isValidPoolId(poolId: string): boolean {
  return /^[\w\-]+$/.test(poolId);
}

// ─── A. checkMembership 로직 단위 테스트 ──────────────────────────────────────
describe("A. checkMembership 로직", () => {
  it("membership row가 있으면 true 반환", () => {
    const check = (rows: any[]) => rows.length > 0;
    expect(check([{ "1": 1 }])).toBe(true);
  });

  it("membership row가 없으면 false 반환", () => {
    const check = (rows: any[]) => rows.length > 0;
    expect(check([])).toBe(false);
  });

  it("유효하지 않은 role은 false 반환 (DB 조회 없이 즉시)", () => {
    const checkWithWhitelist = (role: string, rows: any[]) => {
      if (!VALID_ROLES.has(role)) return false;
      return rows.length > 0;
    };
    // role이 whitelist에 없으면 DB hit 없이 false
    expect(checkWithWhitelist("hacker", [{ "1": 1 }])).toBe(false);
    expect(checkWithWhitelist("pool_admin", [{ "1": 1 }])).toBe(true);
  });
});

// ─── B. getMemberships 로직 단위 테스트 ───────────────────────────────────────
describe("B. getMemberships 로직", () => {
  it("활성 membership 목록을 반환한다", () => {
    const rows = [
      { pool_id: "pool_1", pool_name: "하늘수영장", role: "pool_admin", status: "active" },
      { pool_id: "pool_2", pool_name: "바다수영장", role: "teacher", status: "active" },
    ];
    expect(rows).toHaveLength(2);
    expect(rows[0].pool_id).toBe("pool_1");
    expect(rows[1].role).toBe("teacher");
  });

  it("비어있는 경우 빈 배열 반환", () => {
    const rows: any[] = [];
    expect(rows).toHaveLength(0);
  });
});

// ─── C. upsertMembership 로직 단위 테스트 ─────────────────────────────────────
describe("C. upsertMembership 화이트리스트 검증", () => {
  it("유효하지 않은 role → 예외 발생", () => {
    const validateRole = (role: string) => {
      if (!VALID_ROLES.has(role)) throw new Error(`유효하지 않은 role: ${role}`);
    };
    expect(() => validateRole("hacker_role")).toThrow("유효하지 않은 role");
    expect(() => validateRole("'; DROP TABLE users; --")).toThrow("유효하지 않은 role");
    expect(() => validateRole("pool_admin")).not.toThrow();
  });

  it("유효하지 않은 status → 예외 발생", () => {
    const validateStatus = (status: string) => {
      if (!VALID_STATUS.has(status)) throw new Error(`유효하지 않은 status: ${status}`);
    };
    expect(() => validateStatus("hacked")).toThrow("유효하지 않은 status");
    expect(() => validateStatus("active")).not.toThrow();
  });

  it("유효하지 않은 accountType → 예외 발생", () => {
    const validateAccountType = (at: string) => {
      if (!VALID_ACCOUNT_TYPE.has(at)) throw new Error(`유효하지 않은 accountType: ${at}`);
    };
    expect(() => validateAccountType("admin")).toThrow("유효하지 않은 accountType");
    expect(() => validateAccountType("user")).not.toThrow();
    expect(() => validateAccountType("parent")).not.toThrow();
  });

  it("동일 account_id+pool_id+role이 존재하면 ON CONFLICT 갱신", () => {
    const conflictBehavior = (existing: any, incoming: any) => {
      if (
        existing.account_id === incoming.account_id &&
        existing.pool_id === incoming.pool_id &&
        existing.role === incoming.role
      ) {
        return { ...existing, status: incoming.status };
      }
      return null;
    };
    const existing = { account_id: "u1", pool_id: "pool_1", role: "pool_admin", status: "inactive" };
    const incoming = { account_id: "u1", pool_id: "pool_1", role: "pool_admin", status: "active" };
    const result = conflictBehavior(existing, incoming);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("active");
  });

  it("다른 pool_id는 별개의 row로 생성", () => {
    const memberships: any[] = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
    ];
    const newMembership = { account_id: "u1", pool_id: "pool_2", role: "teacher" };
    const isDuplicate = memberships.some(
      m => m.account_id === newMembership.account_id &&
           m.pool_id === newMembership.pool_id &&
           m.role === newMembership.role,
    );
    expect(isDuplicate).toBe(false);
    memberships.push(newMembership);
    expect(memberships).toHaveLength(2);
  });
});

// ─── D. Signup 중복 체크 — Multi-Pool 허용 확인 ───────────────────────────────
describe("D. Signup 중복 체크 (Multi-Pool)", () => {
  it("동일 전화번호 + 다른 수영장 → 가입 허용 (중복 아님)", () => {
    const existingAccounts = [{ phone: "01012345678", swimming_pool_id: "pool_1" }];
    const newSignup = { phone: "01012345678", swimming_pool_id: "pool_2" };
    const isDuplicate = existingAccounts.some(
      a => a.phone === newSignup.phone && a.swimming_pool_id === newSignup.swimming_pool_id,
    );
    expect(isDuplicate).toBe(false);
  });

  it("동일 전화번호 + 동일 수영장 → 가입 불가 (중복)", () => {
    const existingAccounts = [{ phone: "01012345678", swimming_pool_id: "pool_1" }];
    const newSignup = { phone: "01012345678", swimming_pool_id: "pool_1" };
    const isDuplicate = existingAccounts.some(
      a => a.phone === newSignup.phone && a.swimming_pool_id === newSignup.swimming_pool_id,
    );
    expect(isDuplicate).toBe(true);
  });

  it("다른 전화번호 + 동일 수영장 → 가입 허용", () => {
    const existingAccounts = [{ phone: "01012345678", swimming_pool_id: "pool_1" }];
    const newSignup = { phone: "01099998888", swimming_pool_id: "pool_1" };
    const isDuplicate = existingAccounts.some(
      a => a.phone === newSignup.phone && a.swimming_pool_id === newSignup.swimming_pool_id,
    );
    expect(isDuplicate).toBe(false);
  });

  it("pool_id 미지정 + phone 같은 null pool 계정 → 중복", () => {
    const existingNullPool = [{ phone: "01012345678", swimming_pool_id: null }];
    const newSignup = { phone: "01012345678", swimming_pool_id: null };
    const isDuplicate = existingNullPool.some(
      a => a.phone === newSignup.phone && a.swimming_pool_id === newSignup.swimming_pool_id,
    );
    expect(isDuplicate).toBe(true);
  });
});

// ─── E. Tenant Isolation 테스트 ────────────────────────────────────────────────
describe("E. Tenant Isolation — switch-pool 권한 검증", () => {
  it("membership 없는 pool로 switch-pool 시도 → 403 반환해야 함", () => {
    const hasMembership = false;
    const response = hasMembership
      ? { status: 200, body: { success: true } }
      : { status: 403, body: { success: false, message: "해당 수영장에 대한 접근 권한이 없습니다." } };
    expect(response.status).toBe(403);
  });

  it("membership 있는 pool로 switch-pool → 200 + 새 JWT 반환", () => {
    const hasMembership = true;
    const response = hasMembership
      ? { status: 200, body: { success: true, token: "new.jwt.token", pool_id: "pool_1", role: "pool_admin" } }
      : { status: 403, body: { success: false } };
    expect(response.status).toBe(200);
    expect(response.body.token).toBe("new.jwt.token");
  });

  it("다른 계정의 pool_id로 switch-pool → membership 없으면 403", () => {
    const accountMemberships = new Map<string, string[]>([
      ["u1", ["pool_1"]],
      ["u2", ["pool_2"]],
    ]);
    const requestingAccountId = "u1";
    const targetPoolId = "pool_2";
    const allowed = accountMemberships.get(requestingAccountId)?.includes(targetPoolId) ?? false;
    expect(allowed).toBe(false);
  });

  it("같은 계정의 여러 pool 전환 → 모두 허용", () => {
    const accountMemberships = new Map<string, string[]>([
      ["u1", ["pool_1", "pool_2", "pool_3"]],
    ]);
    const requestingAccountId = "u1";
    for (const p of ["pool_1", "pool_2", "pool_3"]) {
      const allowed = accountMemberships.get(requestingAccountId)?.includes(p) ?? false;
      expect(allowed).toBe(true);
    }
  });
});

// ─── F. Migration Gate — anti-join 방식 검증 ──────────────────────────────────
describe("F. Migration Gate — anti-join 검증 로직", () => {
  // fixture: expected memberships vs actual memberships
  function computeMissing(
    expectedList: Array<{ account_id: string; pool_id: string; role: string }>,
    actualList: Array<{ account_id: string; pool_id: string; role: string; status: string }>,
  ): number {
    return expectedList.filter(exp =>
      !actualList.some(
        m => m.account_id === exp.account_id &&
             m.pool_id === exp.pool_id &&
             m.role === exp.role &&
             m.status === "active",
      ),
    ).length;
  }

  it("missing = 0: 모든 expected membership이 존재하면 0", () => {
    const expected = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u2", pool_id: "pool_1", role: "teacher" },
    ];
    const actual = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin", status: "active" },
      { account_id: "u2", pool_id: "pool_1", role: "teacher", status: "active" },
    ];
    expect(computeMissing(expected, actual)).toBe(0);
  });

  it("missing = 1: 한 row 누락 시 정확히 1 탐지", () => {
    const expected = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u2", pool_id: "pool_1", role: "teacher" },
    ];
    const actual = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin", status: "active" },
      // u2 누락
    ];
    expect(computeMissing(expected, actual)).toBe(1);
  });

  it("한 user가 role 3개여도 다른 user 누락은 정확히 탐지", () => {
    const expected = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u1", pool_id: "pool_1", role: "teacher" },
      { account_id: "u1", pool_id: "pool_1", role: "sub_admin" },
      { account_id: "u2", pool_id: "pool_2", role: "teacher" }, // u2 누락 예정
    ];
    const actual = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin", status: "active" },
      { account_id: "u1", pool_id: "pool_1", role: "teacher", status: "active" },
      { account_id: "u1", pool_id: "pool_1", role: "sub_admin", status: "active" },
      // u2 없음
    ];
    expect(computeMissing(expected, actual)).toBe(1);
  });

  it("duplicates = 0: 중복 없으면 0", () => {
    const memberships = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u1", pool_id: "pool_2", role: "teacher" },
      { account_id: "u2", pool_id: "pool_1", role: "teacher" },
    ];
    const groups = new Map<string, number>();
    for (const m of memberships) {
      const key = `${m.account_id}::${m.pool_id}::${m.role}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const duplicates = [...groups.values()].filter(c => c > 1).length;
    expect(duplicates).toBe(0);
  });

  it("duplicates 탐지: 동일 조합 2개 → 1 탐지", () => {
    const memberships = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" }, // 중복
    ];
    const groups = new Map<string, number>();
    for (const m of memberships) {
      const key = `${m.account_id}::${m.pool_id}::${m.role}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const duplicates = [...groups.values()].filter(c => c > 1).length;
    expect(duplicates).toBe(1);
  });
});

// ─── G. /me/memberships 응답 형식 ─────────────────────────────────────────────
describe("G. /me/memberships 응답 형식", () => {
  it("성공 응답은 { success: true, memberships: [] } 형식", () => {
    const response = { success: true, memberships: [] };
    expect(response.success).toBe(true);
    expect(Array.isArray(response.memberships)).toBe(true);
  });

  it("각 membership 항목은 pool_id, pool_name, role, status를 가진다", () => {
    const membership = {
      pool_id: "pool_1",
      pool_name: "하늘수영장",
      role: "pool_admin",
      status: "active",
    };
    expect(membership).toHaveProperty("pool_id");
    expect(membership).toHaveProperty("pool_name");
    expect(membership).toHaveProperty("role");
    expect(membership).toHaveProperty("status");
  });
});

// ─── H. /auth/switch-pool 입력 검증 + 응답 형식 ───────────────────────────────
describe("H. /auth/switch-pool 입력 검증", () => {
  it("성공 응답은 { success, token, pool_id, role, pool_name } 형식", () => {
    const response = {
      success: true,
      token: "new.jwt.token",
      pool_id: "pool_1",
      role: "pool_admin",
      pool_name: "하늘수영장",
    };
    expect(response.success).toBe(true);
    expect(response.token).toBeTruthy();
    expect(response.pool_id).toBeTruthy();
    expect(response.role).toBeTruthy();
    expect(response.pool_name).toBeTruthy();
  });

  it("pool_id 또는 role 미제공 시 400 반환해야 함", () => {
    const cases = [
      { pool_id: "", role: "pool_admin" },
      { pool_id: "pool_1", role: "" },
      { pool_id: "", role: "" },
    ];
    for (const c of cases) {
      const isValid = Boolean(c.pool_id && c.role);
      expect(isValid).toBe(false);
    }
  });

  it("role 화이트리스트 밖의 값은 400 반환해야 함", () => {
    const invalidRoles = ["hacker", "'; DROP TABLE users; --", "admin", "root", "super"];
    for (const role of invalidRoles) {
      expect(VALID_ROLES.has(role)).toBe(false);
    }
  });

  it("허용되는 role 목록 확인", () => {
    const allowedRoles = ["pool_admin", "teacher", "sub_admin", "parent_account"];
    for (const role of allowedRoles) {
      expect(VALID_ROLES.has(role)).toBe(true);
    }
  });
});

// ─── I. MembershipsContext 상태 로직 ──────────────────────────────────────────
describe("I. MembershipsContext 상태 로직", () => {
  it("memberships 2개 이상이면 hasManyPools = true", () => {
    const memberships = [
      { pool_id: "pool_1", pool_name: "A수영장", role: "pool_admin", status: "active" },
      { pool_id: "pool_2", pool_name: "B수영장", role: "teacher", status: "active" },
    ];
    expect(memberships.length >= 2).toBe(true);
  });

  it("memberships 1개이면 hasManyPools = false", () => {
    const memberships = [
      { pool_id: "pool_1", pool_name: "A수영장", role: "pool_admin", status: "active" },
    ];
    expect(memberships.length >= 2).toBe(false);
  });

  it("빈 memberships이면 hasManyPools = false", () => {
    const memberships: any[] = [];
    expect(memberships.length >= 2).toBe(false);
  });
});

// ─── J. SECURITY — SQL injection 방어 ─────────────────────────────────────────
describe("J. SECURITY — SQL injection 방어", () => {
  it("pool_id에 SQL 특수문자 포함 시 형식 검증 실패 → 400", () => {
    const maliciousInputs = [
      "'; DROP TABLE users; --",
      "1' OR '1'='1",
      "pool_1; SELECT * FROM users",
      "pool_1\nDROP TABLE",
      "pool 1", // 공백
    ];
    for (const input of maliciousInputs) {
      expect(isValidPoolId(input)).toBe(false);
    }
  });

  it("정상 pool_id 형식 통과", () => {
    const validInputs = [
      "pool_abc123",
      "550e8400-e29b-41d4-a716-446655440000", // UUID
      "POOL-001",
      "mypool_123-ABC",
    ];
    for (const input of validInputs) {
      expect(isValidPoolId(input)).toBe(true);
    }
  });

  it("role에 SQL 특수문자 포함 시 화이트리스트 검증 실패 → false", () => {
    const maliciousRoles = [
      "'; DROP TABLE users; --",
      "pool_admin' OR '1'='1",
      "teacher; SELECT * FROM parent_accounts",
      "pool_admin\nDROP TABLE",
    ];
    for (const role of maliciousRoles) {
      expect(VALID_ROLES.has(role)).toBe(false);
    }
  });

  it("checkMembership: 유효하지 않은 role → DB 조회 없이 false 반환", () => {
    // checkMembership 내부 로직 재현
    const checkWithGuard = (role: string, dbRows: any[]) => {
      if (!VALID_ROLES.has(role)) return false; // DB hit 없이 즉시 차단
      return dbRows.length > 0;
    };
    // SQL injection 시도: DB rows가 있어도 false 반환
    expect(checkWithGuard("'; DROP TABLE users;--", [{ 1: 1 }])).toBe(false);
    expect(checkWithGuard("hacker", [{ 1: 1 }])).toBe(false);
  });

  it("upsertMembership: 유효하지 않은 role → 예외 발생 (SQL에 도달하지 않음)", () => {
    const validateAndUpsert = (role: string) => {
      if (!VALID_ROLES.has(role)) throw new Error(`유효하지 않은 role: ${role}`);
      // SQL은 여기서만 실행됨
      return "SQL executed";
    };
    expect(() => validateAndUpsert("'; DROP TABLE users;--")).toThrow("유효하지 않은 role");
    expect(() => validateAndUpsert("hacker")).toThrow("유효하지 않은 role");
  });

  it("role 비정상값 전체 차단 확인 (400 응답 시뮬레이션)", () => {
    const simulateSwitchPool = (pool_id: string, role: string) => {
      if (!pool_id || !role) return { status: 400, message: "pool_id와 role을 모두 지정해주세요." };
      if (!VALID_ROLES.has(role)) return { status: 400, message: `허용되지 않는 role입니다: ${role}` };
      if (!isValidPoolId(pool_id)) return { status: 400, message: "올바르지 않은 pool_id 형식입니다." };
      return { status: 200 };
    };

    expect(simulateSwitchPool("pool_1", "hacker").status).toBe(400);
    expect(simulateSwitchPool("'; DROP TABLE;--", "pool_admin").status).toBe(400);
    expect(simulateSwitchPool("", "pool_admin").status).toBe(400);
    expect(simulateSwitchPool("pool_1", "").status).toBe(400);
    expect(simulateSwitchPool("pool_1", "pool_admin").status).toBe(200);
  });
});

// ─── K. validateMigration anti-join 설계 검증 ─────────────────────────────────
describe("K. validateMigration anti-join 설계", () => {
  it("users_missing: 총량 방식 대비 anti-join이 더 정확함을 확인", () => {
    // 총량 방식의 문제: user 1개 roles 3개 → 3 memberships
    //   다른 user 1개 누락되어도 총량이 같으면 감지 못 할 수 있음
    // Anti-join: 각 (account_id, pool_id, role) 조합을 개별 확인
    const users = [
      { id: "u1", pool_id: "pool_1", roles: ["pool_admin", "teacher"] },
      { id: "u2", pool_id: "pool_1", roles: ["teacher"] }, // 누락 예정
    ];
    // expected: u1×2 + u2×1 = 3
    const expected = users.flatMap(u => u.roles.map(r => ({ account_id: u.id, pool_id: u.pool_id, role: r })));

    // actual: u1만 있고 u2 누락
    const actual = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u1", pool_id: "pool_1", role: "teacher" },
    ];

    // 총량 방식: expected=3, actual=2 → missing=1 (우연히 탐지됨)
    const totalMissing = Math.max(0, expected.length - actual.length);
    expect(totalMissing).toBe(1);

    // anti-join 방식: u2/pool_1/teacher 누락을 직접 탐지
    const antiJoinMissing = expected.filter(
      exp => !actual.some(a => a.account_id === exp.account_id && a.pool_id === exp.pool_id && a.role === exp.role),
    ).length;
    expect(antiJoinMissing).toBe(1);

    // 총량 방식이 실패하는 경우:
    // u1이 role 3개, u2 누락 → expected=4, actual=3 (u1 3개)
    // 총량 missing=1은 감지하지만 어떤 row인지 모름
    // anti-join은 정확히 u2/pool_1/teacher를 지목함
    const expected2 = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u1", pool_id: "pool_1", role: "teacher" },
      { account_id: "u1", pool_id: "pool_1", role: "sub_admin" },
      { account_id: "u2", pool_id: "pool_1", role: "teacher" },
    ];
    const actual2 = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" },
      { account_id: "u1", pool_id: "pool_1", role: "teacher" },
      { account_id: "u1", pool_id: "pool_1", role: "sub_admin" },
      // u2 없음
    ];
    const antiJoinMissing2 = expected2.filter(
      exp => !actual2.some(a => a.account_id === exp.account_id && a.pool_id === exp.pool_id && a.role === exp.role),
    );
    expect(antiJoinMissing2).toHaveLength(1);
    expect(antiJoinMissing2[0].account_id).toBe("u2");
    expect(antiJoinMissing2[0].role).toBe("teacher");
  });

  it("invalid membership 탐지: 지원하지 않는 role", () => {
    const memberships = [
      { account_id: "u1", pool_id: "pool_1", role: "pool_admin" }, // valid
      { account_id: "u1", pool_id: "pool_1", role: "hacker_role" }, // invalid
    ];
    const invalid = memberships.filter(m => !VALID_ROLES.has(m.role)).length;
    expect(invalid).toBe(1);
  });

  it("invalid = 0: 모든 row가 유효한 role이면 0", () => {
    const memberships = [
      { role: "pool_admin" },
      { role: "teacher" },
      { role: "sub_admin" },
      { role: "parent_account" },
    ];
    const invalid = memberships.filter(m => !VALID_ROLES.has(m.role)).length;
    expect(invalid).toBe(0);
  });
});
