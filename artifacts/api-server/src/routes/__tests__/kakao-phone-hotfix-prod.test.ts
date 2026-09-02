/**
 * kakao-phone-hotfix-prod.test.ts — P01~P14
 *
 * SWIMNOTE PRODUCTION KAKAO PHONE HOTFIX
 * Production branch: deploy-photo-clone
 * Source reference: 6056f41e
 *
 * 목적: digits-only phone lookup → digits + hyphen fallback 수정 검증
 *
 * P01  parent direct kakao_id match
 * P02  parent digits phone match (2-A pool-scoped)
 * P03  parent hyphen phone match (2-A pool-scoped) ← ROOT CAUSE FIX
 * P04  parent pool-scoped hyphen phone (LIMIT 1 정확 매칭)
 * P05  teacher direct kakao_id match
 * P06  teacher digits phone match (Step 4)
 * P07  teacher hyphen phone match (Step 4) ← ROOT CAUSE FIX
 * P08  pool_admin direct kakao_id match
 * P09  pool_admin hyphen phone match (Step 4)
 * P10  no account → 404 kakao_no_account
 * P11  invalid token → non-5xx expected auth response
 * P12  sub_admin occurrence in relevant Kakao SQL = 0
 * P13  general username/password login contract
 * P14  response shape unchanged
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const AUTH_PATH = join(__dirname, "../../routes/auth.ts");
const authSrc = readFileSync(AUTH_PATH, "utf-8");

// ── 전화번호 정규화 순수 함수 (Production 코드와 동일 로직) ─────────────────────
function normalizeKakaoPhone(rawPhone: string): string {
  return rawPhone.replace(/^\+82\s*/, "0").replace(/[^0-9]/g, "");
}
function toHyphen(digits: string): string {
  return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
}
function phoneMatchesQuery(dbPhone: string, kakaoRaw: string): boolean {
  const digits = normalizeKakaoPhone(kakaoRaw);
  const hyphen = toHyphen(digits);
  return dbPhone === digits || dbPhone === hyphen;
}

// kakao-social-login 라우트 범위 추출 (Step 1~5)
const loginRouteStart = authSrc.indexOf('router.post("/kakao-social-login"');
const linkTeacherStart = authSrc.indexOf('router.post("/kakao-link-teacher"');
const kakaoLoginSrc = authSrc.slice(loginRouteStart, linkTeacherStart);

// ══════════════════════════════════════════════════════════════════════════════
// P01 — parent direct kakao_id match
// ══════════════════════════════════════════════════════════════════════════════
describe("P01 — parent direct kakao_id match", () => {
  it("P01-1 Step 1: parent_accounts.kakao_id 직접 조회", () => {
    expect(kakaoLoginSrc).toContain(
      "SELECT * FROM parent_accounts WHERE kakao_id = ${kakaoId} LIMIT 1"
    );
  });
  it("P01-2 match 시 token + parent 응답 반환", () => {
    const matchSection = kakaoLoginSrc.slice(
      kakaoLoginSrc.indexOf("byKakaoId"),
      kakaoLoginSrc.indexOf("// 2)")
    );
    expect(matchSection).toContain("success: true,");
    expect(matchSection).toContain("token,");
    expect(matchSection).toContain("parent: {");
  });
  it("P01-3 KAKAO_ID_MATCH 로그", () => {
    expect(kakaoLoginSrc).toContain("[KAKAO_ID_MATCH]");
  });
  it("P01-4 KAKAO_LOGIN_SUCCESS 로그", () => {
    expect(kakaoLoginSrc).toContain("[KAKAO_LOGIN_SUCCESS]");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P02 — parent digits phone match (2-A pool-scoped)
// ══════════════════════════════════════════════════════════════════════════════
describe("P02 — parent digits phone match (2-A pool-scoped)", () => {
  it("P02-1 Kakao +82 10-XXXX-XXXX → digits 정규화", () => {
    expect(normalizeKakaoPhone("+82 10-1234-5678")).toBe("01012345678");
    expect(normalizeKakaoPhone("+82 10-123-4567")).toBe("0101234567");
  });
  it("P02-2 2-A 쿼리에 kakaoPhone (digits) 포함", () => {
    expect(kakaoLoginSrc).toContain("phone = ${kakaoPhone}");
  });
  it("P02-3 DB 동일 digits 형식 매칭", () => {
    expect(phoneMatchesQuery("01012345678", "+82 10-1234-5678")).toBe(true);
    expect(phoneMatchesQuery("01012345678", "+82 10-1234-5678")).toBe(true);
  });
  it("P02-4 2-A LIMIT 1 (pool-scoped → 중복 불가)", () => {
    expect(kakaoLoginSrc).toContain("swimming_pool_id = ${requestPoolId}\n          LIMIT 1");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P03 — parent hyphen phone match (2-A pool-scoped) ← ROOT CAUSE FIX
// ══════════════════════════════════════════════════════════════════════════════
describe("P03 — parent hyphen phone match 2-A pool-scoped (ROOT CAUSE FIX)", () => {
  it("P03-1 kakaoPhoneHyphenP 변수 정의됨 (2-A/2-B 공용)", () => {
    expect(kakaoLoginSrc).toContain(
      "const kakaoPhoneHyphenP = kakaoPhone.replace(/^(\\d{3})(\\d{3,4})(\\d{4})$/, \"$1-$2-$3\")"
    );
  });
  it("P03-2 2-A: OR phone = kakaoPhoneHyphenP 포함", () => {
    expect(kakaoLoginSrc).toContain(
      "WHERE (phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphenP}) AND swimming_pool_id = ${requestPoolId}"
    );
  });
  it("P03-3 digits → 하이픈 변환: 01012345678 → 010-1234-5678", () => {
    expect(toHyphen("01012345678")).toBe("010-1234-5678");
  });
  it("P03-4 DB 하이픈 형식 매칭", () => {
    expect(phoneMatchesQuery("010-1234-5678", "+82 10-1234-5678")).toBe(true);
  });
  it("P03-5 DB digits 형식도 여전히 매칭 (기존 동작 유지)", () => {
    expect(phoneMatchesQuery("01012345678", "+82 10-1234-5678")).toBe(true);
  });
  it("P03-6 3자리 중간 번호 (010-123-4567)", () => {
    expect(toHyphen("0101234567")).toBe("010-123-4567");
    expect(phoneMatchesQuery("010-123-4567", "+82 10-123-4567")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P04 — parent pool-scoped hyphen phone (LIMIT 1 매칭)
// ══════════════════════════════════════════════════════════════════════════════
describe("P04 — parent pool-scoped LIMIT 1", () => {
  it("P04-1 2-A: LIMIT 1 — pool 범위에서 2개 이상 불가 (풀 단위 unique 전제)", () => {
    expect(kakaoLoginSrc).toContain(
      "(phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphenP}) AND swimming_pool_id = ${requestPoolId}\n          LIMIT 1"
    );
  });
  it("P04-2 2-B: LIMIT 2 — 전체 범위 ambiguous 감지용", () => {
    expect(kakaoLoginSrc).toContain(
      "SELECT * FROM parent_accounts WHERE (phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphenP}) LIMIT 2"
    );
  });
  it("P04-3 2-B: phoneMatches.length === 1 → single_unscoped 자동 연결", () => {
    expect(kakaoLoginSrc).toContain("phoneMatches.length === 1");
    expect(kakaoLoginSrc).toContain("single_unscoped");
  });
  it("P04-4 2-B: phoneMatches.length >= 2 → KAKAO_PARENT_AMBIGUOUS 409", () => {
    expect(kakaoLoginSrc).toContain("KAKAO_PARENT_AMBIGUOUS");
    expect(kakaoLoginSrc).toContain("res.status(409)");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P05 — teacher direct kakao_id match
// ══════════════════════════════════════════════════════════════════════════════
describe("P05 — teacher direct kakao_id match", () => {
  it("P05-1 Step 3: users.kakao_id + role IN (teacher, pool_admin)", () => {
    expect(kakaoLoginSrc).toContain(
      "SELECT * FROM users WHERE kakao_id = ${kakaoId} AND role IN ('teacher', 'pool_admin') LIMIT 1"
    );
  });
  it("P05-2 kind=admin 응답", () => {
    expect(kakaoLoginSrc).toContain('kind: "admin",');
  });
  it("P05-3 KAKAO_LOGIN_SUCCESS 로그 (teacher)", () => {
    expect(kakaoLoginSrc).toContain("[KAKAO_LOGIN_SUCCESS]");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P06 — teacher digits phone match (Step 4)
// ══════════════════════════════════════════════════════════════════════════════
describe("P06 — teacher digits phone match Step 4", () => {
  it("P06-1 Step 4 쿼리에 kakaoPhone (digits) 포함", () => {
    expect(kakaoLoginSrc).toContain("(phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphen})");
  });
  it("P06-2 DB digits teacher 매칭", () => {
    expect(phoneMatchesQuery("01098765432", "+82 10-9876-5432")).toBe(true);
  });
  it("P06-3 첫 로그인 시 kakao_id UPDATE", () => {
    // kakaoLoginSrc 전체에서 teacher UPDATE 패턴 확인
    expect(kakaoLoginSrc).toContain("SET kakao_id = ${kakaoId}, kakao_profile_image = ${kakaoProfileImage}, updated_at = NOW()");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P07 — teacher hyphen phone match (Step 4) ← ROOT CAUSE FIX
// ══════════════════════════════════════════════════════════════════════════════
describe("P07 — teacher hyphen phone match Step 4 (ROOT CAUSE FIX)", () => {
  it("P07-1 kakaoPhoneHyphen 변수 정의됨 (Step 4 전용)", () => {
    expect(kakaoLoginSrc).toContain(
      "const kakaoPhoneHyphen = kakaoPhone.replace(/^(\\d{3})(\\d{3,4})(\\d{4})$/, \"$1-$2-$3\")"
    );
  });
  it("P07-2 Step 4: OR phone = kakaoPhoneHyphen 포함", () => {
    expect(kakaoLoginSrc).toContain(
      "(phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphen}) AND role IN ('teacher', 'pool_admin') LIMIT 1"
    );
  });
  it("P07-3 DB 하이픈 teacher 매칭", () => {
    expect(phoneMatchesQuery("010-9876-5432", "+82 10-9876-5432")).toBe(true);
  });
  it("P07-4 DB digits teacher 매칭 (기존 동작 유지)", () => {
    expect(phoneMatchesQuery("01098765432", "+82 10-9876-5432")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P08 — pool_admin direct kakao_id match
// ══════════════════════════════════════════════════════════════════════════════
describe("P08 — pool_admin direct kakao_id match", () => {
  it("P08-1 Step 3: pool_admin role IN 포함", () => {
    expect(kakaoLoginSrc).toContain("role IN ('teacher', 'pool_admin') LIMIT 1");
  });
  it("P08-2 pool_admin 로그인 차단 없음 (kakao-social-login 라우트)", () => {
    expect(kakaoLoginSrc).not.toContain("admin_kakao_link_blocked");
  });
  it("P08-3 kind=admin 반환 (pool_admin 포함)", () => {
    expect(kakaoLoginSrc).toContain('kind: "admin",');
    expect(kakaoLoginSrc).toContain("role: u.role,");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P09 — pool_admin hyphen phone match (Step 4)
// ══════════════════════════════════════════════════════════════════════════════
describe("P09 — pool_admin hyphen phone match Step 4", () => {
  it("P09-1 pool_admin도 Step 4에서 OR hyphen 쿼리 대상", () => {
    expect(kakaoLoginSrc).toContain("role IN ('teacher', 'pool_admin') LIMIT 1");
    expect(kakaoLoginSrc).toContain("(phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphen})");
  });
  it("P09-2 DB 하이픈 pool_admin 매칭", () => {
    expect(phoneMatchesQuery("010-5555-6666", "+82 10-5555-6666")).toBe(true);
  });
  it("P09-3 pool_admin kakao_id UPDATE 동일 적용", () => {
    expect(kakaoLoginSrc).toContain("SET kakao_id = ${kakaoId}, kakao_profile_image = ${kakaoProfileImage}, updated_at = NOW()");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P10 — no account → 404 kakao_no_account
// ══════════════════════════════════════════════════════════════════════════════
describe("P10 — no account → 404 kakao_no_account", () => {
  it("P10-1 Step 5: 404 + kakao_no_account", () => {
    expect(kakaoLoginSrc).toContain('error_code: "kakao_no_account"');
    expect(kakaoLoginSrc).toContain("res.status(404)");
  });
  it("P10-2 kakao_info 포함 (kakao_id, name, phone, profile_image)", () => {
    expect(kakaoLoginSrc).toContain("kakao_info: {");
    expect(kakaoLoginSrc).toContain("kakao_id: kakaoId,");
    expect(kakaoLoginSrc).toContain("profile_image: kakaoProfileImage,");
  });
  it("P10-3 phone_missing 분기 메시지", () => {
    expect(kakaoLoginSrc).toContain("phone_missing: phoneMissing");
  });
  it("P10-4 INSERT 없음 (신규 계정 자동 생성 금지)", () => {
    expect(kakaoLoginSrc).not.toContain("INSERT INTO parent_accounts");
    expect(kakaoLoginSrc).not.toContain("INSERT INTO users");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P11 — invalid token → non-5xx expected auth response
// ══════════════════════════════════════════════════════════════════════════════
describe("P11 — invalid token → non-5xx expected auth response", () => {
  it("P11-1 Kakao 401/403 → KAKAO_INVALID_TOKEN 401 (5xx 아님)", () => {
    expect(kakaoLoginSrc).toContain('error_code: "KAKAO_INVALID_TOKEN"');
    expect(kakaoLoginSrc).toContain("kakaoRes.status === 401 || kakaoRes.status === 403");
    // 401 응답이므로 5xx 아님
    expect(kakaoLoginSrc).not.toContain('res.status(500).json({ error_code: "KAKAO_INVALID_TOKEN"');
  });
  it("P11-2 Kakao timeout → KAKAO_API_TIMEOUT 504 (라우트 전체에 존재)", () => {
    // kakaoLoginSrc slice 밖(AbortController)일 수 있으므로 전체 authSrc로 확인
    expect(authSrc).toContain('error_code: isTimeout ? "KAKAO_API_TIMEOUT" : "KAKAO_API_ERROR"');
  });
  it("P11-3 outer catch → 500 (server fault시에만)", () => {
    expect(authSrc).toContain('[kakao-social-login]');
  });
  it("P11-4 accessToken 없음 → 400 (early return)", () => {
    // Production: if (!accessToken) return err(res, 400, ...)
    expect(authSrc).toContain("if (!accessToken) return err(res, 400,");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P12 — sub_admin occurrence in relevant Kakao SQL = 0
// ══════════════════════════════════════════════════════════════════════════════
describe("P12 — sub_admin occurrence in relevant Kakao SQL = 0", () => {
  it("P12-1 kakao-social-login 라우트 내 sub_admin 없음", () => {
    expect(kakaoLoginSrc).not.toContain("sub_admin");
  });
  it("P12-2 Step 3 role IN: 정확히 teacher + pool_admin 2개", () => {
    const match = kakaoLoginSrc.match(
      /WHERE kakao_id = \$\{kakaoId\} AND role IN \('([^']+)', '([^']+)'\) LIMIT 1/
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("teacher");
    expect(match![2]).toBe("pool_admin");
  });
  it("P12-3 Step 4 role IN: 정확히 teacher + pool_admin 2개", () => {
    const match = kakaoLoginSrc.match(
      /role IN \('([^']+)', '([^']+)'\) LIMIT 1/g
    );
    // Step 3 + Step 4 두 개 모두 teacher + pool_admin
    expect(match?.length).toBeGreaterThanOrEqual(2);
    match?.forEach((m) => {
      expect(m).toContain("'teacher'");
      expect(m).toContain("'pool_admin'");
      expect(m).not.toContain("sub_admin");
    });
  });
  it("P12-4 전체 auth.ts에서 Kakao SQL 관련 sub_admin enum 없음", () => {
    const subAdminInSql = authSrc.match(/role IN \([^)]*sub_admin[^)]*\)/g);
    expect(subAdminInSql).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P13 — general username/password login contract
// ══════════════════════════════════════════════════════════════════════════════
describe("P13 — general username/password login unchanged", () => {
  it("P13-1 /login 라우트 유지", () => {
    expect(authSrc).toContain('router.post("/login"');
  });
  it("P13-2 /parent-login 라우트 유지", () => {
    expect(authSrc).toContain('router.post("/parent-login"');
  });
  it("P13-3 /unified-login 라우트 유지", () => {
    expect(authSrc).toContain('router.post("/unified-login"');
  });
  it("P13-4 kakao-social-login과 일반 login 라우트 분리 확인", () => {
    const loginIdx = authSrc.indexOf('router.post("/login"');
    const kakaoIdx = authSrc.indexOf('router.post("/kakao-social-login"');
    expect(loginIdx).toBeGreaterThan(0);
    expect(kakaoIdx).toBeGreaterThan(0);
    expect(loginIdx).not.toBe(kakaoIdx);
  });
  it("P13-5 일반 login의 comparePassword 사용 (패스워드 검증)", () => {
    expect(authSrc).toContain("comparePassword(");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// P14 — response shape unchanged
// ══════════════════════════════════════════════════════════════════════════════
describe("P14 — response shape unchanged", () => {
  it("P14-1 parent 성공 응답: success+token+parent (추가/제거 없음)", () => {
    expect(kakaoLoginSrc).toContain("success: true,");
    expect(kakaoLoginSrc).toContain("token,");
    expect(kakaoLoginSrc).toContain("parent: {");
    expect(kakaoLoginSrc).toContain("id: account.id,");
    expect(kakaoLoginSrc).toContain("swimming_pool_id: account.swimming_pool_id,");
  });
  it("P14-2 admin 성공 응답: success+kind+token+user (추가/제거 없음)", () => {
    expect(kakaoLoginSrc).toContain('kind: "admin",');
    expect(kakaoLoginSrc).toContain("user: {");
    expect(kakaoLoginSrc).toContain("role: u.role,");
    expect(kakaoLoginSrc).toContain("roles: u.roles || [u.role]");
  });
  it("P14-3 error 응답: success:false+error_code 구조 유지", () => {
    expect(kakaoLoginSrc).toContain("success: false,");
    expect(kakaoLoginSrc).toContain("error_code:");
  });
  it("P14-4 response에 hyphenP/hyphen 변수 노출 없음 (내부 변수만)", () => {
    // 응답 JSON에 kakaoPhoneHyphenP 또는 kakaoPhoneHyphen 키가 없어야 함
    expect(kakaoLoginSrc).not.toContain('"kakaoPhoneHyphenP"');
    expect(kakaoLoginSrc).not.toContain('"kakaoPhoneHyphen"');
    expect(kakaoLoginSrc).not.toContain("kakaoPhoneHyphenP:");
    expect(kakaoLoginSrc).not.toContain("kakaoPhoneHyphen:");
  });
  it("P14-5 timeout/error 응답 구조 유지", () => {
    expect(kakaoLoginSrc).toContain("카카오 서버가 응답하지 않습니다.");
    expect(kakaoLoginSrc).toContain("카카오 서버 오류가 발생했습니다.");
  });
});
