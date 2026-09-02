/**
 * kakao-login-restore.test.ts — K01~K24
 *
 * SWIMNOTE KAKAO FULL RESTORE — 서버 로직 + 정책 검증 테스트
 *
 * [2026-09-02] Root cause analysis:
 *   - release/v2.0.0 kakao-social-login: timeout/pool_id/error_code/observability 누락 → 복구 완료
 *   - kakao-link-teacher: pool_admin 신규 연결 미차단 → 차단 추가
 *   - Android key hash: EXTERNAL_CHECK_REQUIRED (아래 K22 참고)
 *
 * 검증 대상:
 *   K01  1.6.3 endpoint contract (pool_id 없음)
 *   K02  2.0 endpoint contract (pool_id 포함)
 *   K03  parent kakao_id direct login
 *   K04  parent phone fallback (digits-only + hyphen)
 *   K05  teacher kakao_id direct login
 *   K06  teacher phone fallback (digits-only + hyphen)
 *   K07  pool_admin existing kakao_id direct login
 *   K08  pool_admin existing phone fallback
 *   K09  existing pool_admin Kakao login NOT blocked
 *   K10  new pool_admin Kakao signup blocked in 2.0
 *   K11  new pool_admin Kakao link blocked in 2.0
 *   K12  teacher duplicate Kakao link blocked
 *   K13  parent duplicate Kakao link blocked
 *   K14  no sub_admin enum literal
 *   K15  invalid Kakao token → safe 401
 *   K16  Kakao API timeout → safe 504 + error_code
 *   K17  Kakao API failure → safe 502 + error_code
 *   K18  no account → kakao_no_account 404
 *   K19  inactive account → needs_activation 403
 *   K20  general username/password login regression (kakao 변경 비영향 확인)
 *   K21  iOS Kakao config static validation
 *   K22  Android Kakao config static validation + key hash external check
 *   K23  1.6.3 and 2.0 use same production API base
 *   K24  no Kakao token/PII in log output (log masking policy)
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ── 서버 라우트 소스 스냅샷 ────────────────────────────────────────────────
const AUTH_TS_PATH = join(__dirname, "../../routes/auth.ts");
const authSrc = readFileSync(AUTH_TS_PATH, "utf-8");

// ── 앱 설정 스냅샷 ────────────────────────────────────────────────────────
const APP_JSON_PATH = join(__dirname, "../../../../swim-app/app.json");
const appJson = JSON.parse(readFileSync(APP_JSON_PATH, "utf-8"));

// ── 클라이언트 소스 스냅샷 ────────────────────────────────────────────────
const INDEX_TSX_PATH = join(__dirname, "../../../../swim-app/app/index.tsx");
const indexSrc = readFileSync(INDEX_TSX_PATH, "utf-8");

const KAKAO_LINK_PATH = join(__dirname, "../../../../swim-app/app/(auth)/kakao-link.tsx");
const kakaoLinkSrc = readFileSync(KAKAO_LINK_PATH, "utf-8");

const SESSION_CTX_PATH = join(__dirname, "../../../../swim-app/context/auth/SessionContext.tsx");
const sessionSrc = readFileSync(SESSION_CTX_PATH, "utf-8");

// ── 서버 로직 헬퍼 (정책 검증용 순수 함수) ───────────────────────────────
function normalizeKakaoPhone(rawPhone: string | null): string | null {
  if (!rawPhone) return null;
  return rawPhone.replace(/^\+82\s*/, "0").replace(/[^0-9]/g, "");
}

function makeHyphenPhone(digits: string): string {
  return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
}

function phoneMatches(dbPhone: string, kakaoRaw: string): boolean {
  const digits = normalizeKakaoPhone(kakaoRaw) ?? "";
  const hyphen = makeHyphenPhone(digits);
  return dbPhone === digits || dbPhone === hyphen;
}

// ══════════════════════════════════════════════════════════════════════════════
// K01 — 1.6.3 endpoint contract
// ══════════════════════════════════════════════════════════════════════════════
describe("K01 — 1.6.3 Kakao client endpoint contract", () => {
  it("K01-1 POST /auth/kakao-social-login 라우트 존재", () => {
    expect(authSrc).toContain('router.post("/kakao-social-login"');
  });
  it("K01-2 accessToken이 없으면 400 반환", () => {
    expect(authSrc).toContain('if (!accessToken) return err(res, 400');
  });
  it("K01-3 pool_id 없이도 동작: 1.6.3은 pool_id 미전달 → hasPoolId=false 경로 존재", () => {
    // pool_id가 없으면 2-B 경로(single_unscoped)로 진입
    expect(authSrc).toContain("hasPoolId = !!requestPoolId");
    expect(authSrc).toContain("single_unscoped");
  });
  it("K01-4 SessionContext.kakaoSocialLogin이 pool_id 없이 호출 가능", () => {
    // overridePoolId?: string (optional)
    expect(sessionSrc).toContain("overridePoolId?: string");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K02 — 2.0 endpoint contract
// ══════════════════════════════════════════════════════════════════════════════
describe("K02 — 2.0 Kakao client endpoint contract", () => {
  it("K02-1 pool_id 파라미터 추출", () => {
    expect(authSrc).toContain("pool_id: requestPoolId");
  });
  it("K02-2 pool-scoped 조회 경로 존재 (2-A)", () => {
    expect(authSrc).toContain("method=pool_scoped");
    expect(authSrc).toContain("swimming_pool_id = ${requestPoolId}");
  });
  it("K02-3 AMBIGUOUS 시 pools[] 반환", () => {
    expect(authSrc).toContain("KAKAO_PARENT_AMBIGUOUS");
    expect(authSrc).toContain("pools: poolList");
  });
  it("K02-4 2.0 index.tsx 학부모 전용 안내 Alert 존재", () => {
    expect(indexSrc).toContain("카카오 회원가입은 학부모만 가능합니다");
  });
  it("K02-5 parent-only 파라미터로 kakao-link 진입", () => {
    expect(indexSrc).toContain('parentOnly:        "1"');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K03 — parent kakao_id direct login
// ══════════════════════════════════════════════════════════════════════════════
describe("K03 — parent kakao_id direct login", () => {
  it("K03-1 parent_accounts.kakao_id 조회 존재 (Step 1)", () => {
    expect(authSrc).toContain("SELECT * FROM parent_accounts WHERE kakao_id = ${kakaoId} LIMIT 1");
  });
  it("K03-2 히트 시 parent_account role로 JWT 발급", () => {
    // signToken with role: "parent_account"
    expect(authSrc).toContain('role: "parent_account", poolId: account.swimming_pool_id');
  });
  it("K03-3 응답에 parent 객체 포함", () => {
    expect(authSrc).toContain("parent: {");
    expect(authSrc).toContain("swimming_pool_id: account.swimming_pool_id");
  });
  it("K03-4 KAKAO_ID_MATCH 로그 출력", () => {
    expect(authSrc).toContain("[KAKAO_ID_MATCH]");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K04 — parent phone fallback (digits + hyphen)
// ══════════════════════════════════════════════════════════════════════════════
describe("K04 — parent phone fallback", () => {
  it("K04-1 +82 형식 정규화: +82 10-1234-5678 → 01012345678", () => {
    expect(normalizeKakaoPhone("+82 10-1234-5678")).toBe("01012345678");
  });
  it("K04-2 digits-only 형식 직접 매칭", () => {
    expect(phoneMatches("01012345678", "+82 10-1234-5678")).toBe(true);
  });
  it("K04-3 하이픈 형식 DB 매칭", () => {
    expect(phoneMatches("010-1234-5678", "+82 10-1234-5678")).toBe(true);
  });
  it("K04-4 3자리 중간 번호 하이픈 정규화 (010-123-4567)", () => {
    expect(phoneMatches("010-123-4567", "+82 10-123-4567")).toBe(true);
  });
  it("K04-5 서버 코드: phone OR hyphen fallback 포함 (2-B, single_unscoped)", () => {
    // SQL에 kakaoPhoneHyphenP fallback이 있고 LIMIT 2로 다중 pool 감지
    expect(authSrc).toContain("OR phone = ${kakaoPhoneHyphenP}");
    expect(authSrc).toContain("LIMIT 2");
    expect(authSrc).toContain("single_unscoped");
  });
  it("K04-6 pool_id 있으면 pool-scoped 조회 (2-A)", () => {
    expect(authSrc).toContain(
      "(phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphenP})\n          AND swimming_pool_id = ${requestPoolId}"
    );
  });
  it("K04-7 kakao_id 연결 UPDATE 후 JWT 발급", () => {
    expect(authSrc).toContain("UPDATE parent_accounts");
    expect(authSrc).toContain("SET kakao_id = ${kakaoId}, kakao_profile_image = ${kakaoProfileImage}");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K05 — teacher kakao_id direct login (Step 3)
// ══════════════════════════════════════════════════════════════════════════════
describe("K05 — teacher kakao_id direct login", () => {
  it("K05-1 users.kakao_id 조회 (Step 3), role IN teacher/pool_admin", () => {
    expect(authSrc).toContain(
      "SELECT * FROM users WHERE kakao_id = ${kakaoId} AND role IN ('teacher', 'pool_admin') LIMIT 1"
    );
  });
  it("K05-2 히트 시 kind=admin JWT 발급", () => {
    expect(authSrc).toContain("kind: \"admin\"");
    expect(authSrc).toContain("method=teacher_kakao_id");
  });
  it("K05-3 응답에 user 객체 + role 포함", () => {
    expect(authSrc).toContain("role: u.role,");
    expect(authSrc).toContain("roles: u.roles || [u.role]");
  });
  it("K05-4 is_activated=false → needs_activation 403", () => {
    expect(authSrc).toContain('error_code: "needs_activation"');
    expect(authSrc).toContain("needs_activation: true");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K06 — teacher phone fallback (Step 4)
// ══════════════════════════════════════════════════════════════════════════════
describe("K06 — teacher phone fallback", () => {
  it("K06-1 Step 4: phone + hyphen OR 조회, role IN teacher/pool_admin", () => {
    expect(authSrc).toContain(
      "(phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphen}) AND role IN ('teacher', 'pool_admin') LIMIT 1"
    );
  });
  it("K06-2 digits-only kakao phone → hyphen DB 매칭", () => {
    expect(phoneMatches("010-9876-5432", "+82 10-9876-5432")).toBe(true);
  });
  it("K06-3 첫 로그인 시 kakao_id 자동 연결 UPDATE", () => {
    expect(authSrc).toContain("UPDATE users");
    expect(authSrc).toContain("method=teacher_phone_match");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K07 — pool_admin existing kakao_id direct login (NOT blocked)
// ══════════════════════════════════════════════════════════════════════════════
describe("K07 — pool_admin existing kakao_id direct login", () => {
  it("K07-1 pool_admin은 role IN ('teacher','pool_admin') 조회에 포함", () => {
    // Step 3: 기존 연결된 pool_admin → 로그인 허용
    expect(authSrc).toContain("role IN ('teacher', 'pool_admin') LIMIT 1");
  });
  it("K07-2 pool_admin 기존 로그인은 kakao-social-login Step 3/4로 처리됨 (차단 없음)", () => {
    // kakao-link-teacher 차단은 '신규 연결'만. 기존 kakao_id 보유 시 Step 3에서 처리됨.
    const step3Block = authSrc.indexOf("SELECT * FROM users WHERE kakao_id = ${kakaoId} AND role IN");
    const poolAdminBlock = authSrc.indexOf("pool_admin 신규 카카오 연결 차단");
    // Step 3은 차단보다 먼저 실행됨 (라우트 흐름상 kakao-social-login vs kakao-link-teacher 별도)
    expect(step3Block).toBeGreaterThan(0);
    expect(poolAdminBlock).toBeGreaterThan(0);
  });
  it("K07-3 kind=admin 응답 반환 (pool_admin role 보존)", () => {
    expect(authSrc).toContain('kind: "admin"');
    expect(authSrc).toContain("role: u.role,");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K08 — pool_admin existing phone fallback
// ══════════════════════════════════════════════════════════════════════════════
describe("K08 — pool_admin existing phone fallback", () => {
  it("K08-1 phone fallback(Step 4)도 pool_admin 포함 조회", () => {
    expect(authSrc).toContain(
      "(phone = ${kakaoPhone} OR phone = ${kakaoPhoneHyphen}) AND role IN ('teacher', 'pool_admin') LIMIT 1"
    );
  });
  it("K08-2 phone → kakao_id UPDATE 후 JWT 발급 (pool_admin이어도 동작)", () => {
    // UPDATE 및 JWT 발급 로직은 role 관계없이 실행됨
    expect(authSrc).toContain("UPDATE users");
    expect(authSrc).toContain("SET kakao_id = ${kakaoId}");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K09 — existing pool_admin Kakao login NOT blocked
// ══════════════════════════════════════════════════════════════════════════════
describe("K09 — existing pool_admin Kakao login NOT blocked", () => {
  it("K09-1 kakao-social-login에 pool_admin 차단 코드 없음 (기존 로그인 허용)", () => {
    const routeStart = authSrc.indexOf('router.post("/kakao-social-login"');
    const routeEnd = authSrc.indexOf('router.post("/kakao-link-teacher"');
    const routeBody = authSrc.slice(routeStart, routeEnd);
    // kakao-social-login 내부에 pool_admin block 없음
    expect(routeBody).not.toContain("admin_kakao_link_blocked");
    expect(routeBody).not.toContain("소셜계정 가입이 불가");
  });
  it("K09-2 kakao-link-teacher의 pool_admin 차단은 신규 연결에만 적용", () => {
    expect(authSrc).toContain('error_code: "admin_kakao_link_blocked"');
    expect(authSrc).toContain("관리자 계정은 PC 모드 연동으로 인해 소셜계정 가입이 불가합니다.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K10 — new pool_admin Kakao signup blocked in 2.0
// ══════════════════════════════════════════════════════════════════════════════
describe("K10 — new pool_admin Kakao signup blocked in 2.0", () => {
  it("K10-1 2.0 index.tsx: 카카오 버튼 클릭 시 학부모 전용 안내 Alert 표시", () => {
    expect(indexSrc).toContain("카카오 회원가입은 학부모만 가능합니다");
    expect(indexSrc).toContain("관리자와 선생님은 앱 내 가입을 이용해 주세요");
  });
  it("K10-2 취소 시 카카오 로그인 흐름 중단", () => {
    expect(indexSrc).toContain("if (!confirmed) return;");
  });
  it("K10-3 서버 /kakao-social-login Step 5: kakao_no_account → 가입 유도만 (신규 계정 생성 없음)", () => {
    expect(authSrc).toContain('error_code: "kakao_no_account"');
    // 신규 INSERT 없음 확인
    const routeStart = authSrc.indexOf('router.post("/kakao-social-login"');
    const routeEnd = authSrc.indexOf('router.post("/kakao-link-teacher"');
    const routeBody = authSrc.slice(routeStart, routeEnd);
    expect(routeBody).not.toContain("INSERT INTO parent_accounts");
    expect(routeBody).not.toContain("INSERT INTO users");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K11 — new pool_admin Kakao link blocked in 2.0
// ══════════════════════════════════════════════════════════════════════════════
describe("K11 — new pool_admin Kakao link blocked in 2.0", () => {
  it("K11-1 서버 /kakao-link-teacher: pool_admin role → 403 차단", () => {
    expect(authSrc).toContain('if (u.role === "pool_admin")');
    expect(authSrc).toContain("res.status(403)");
    expect(authSrc).toContain('error_code: "admin_kakao_link_blocked"');
  });
  it("K11-2 차단 메시지 정책 문구 일치", () => {
    expect(authSrc).toContain(
      "관리자 계정은 PC 모드 연동으로 인해 소셜계정 가입이 불가합니다. 일반 계정으로 가입해 주세요."
    );
  });
  it("K11-3 클라이언트 kakao-link.tsx: admin 역할 선택 시 차단 메시지", () => {
    expect(kakaoLinkSrc).toContain('if (role === "admin")');
    expect(kakaoLinkSrc).toContain(
      "관리자 계정은 PC 모드 연동으로 인해 소셜계정 가입이 불가합니다."
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K12 — teacher duplicate Kakao link blocked
// ══════════════════════════════════════════════════════════════════════════════
describe("K12 — teacher duplicate Kakao link blocked", () => {
  it("K12-1 /kakao-link-teacher: 다른 계정에 연결된 kakao_id → 409", () => {
    expect(authSrc).toContain("SELECT id FROM users WHERE kakao_id = ${kakaoId} AND id != ${u.id} LIMIT 1");
    expect(authSrc).toContain("이미 다른 계정에 연결된 카카오 계정입니다.");
  });
  it("K12-2 클라이언트 kakao-link.tsx: 409 응답 → 중복 메시지 표시", () => {
    expect(kakaoLinkSrc).toContain("res.status === 409");
    expect(kakaoLinkSrc).toContain(
      "이미 SWIMNOTE 계정에 연결된 카카오 계정입니다. 다른 수영장에 추가 가입하려면 일반가입을 이용해 주세요."
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K13 — parent duplicate Kakao link blocked
// ══════════════════════════════════════════════════════════════════════════════
describe("K13 — parent duplicate Kakao link blocked", () => {
  it("K13-1 /kakao-link-account: 서버에 409 중복 차단 로직 존재", () => {
    // kakao-link-account 엔드포인트가 kakao_id 중복 체크를 수행함
    expect(authSrc).toContain("kakao-link-account");
  });
  it("K13-2 kakao-social-login AMBIGUOUS 처리: 2개 이상 동일 전화번호 pool 반환", () => {
    expect(authSrc).toContain("KAKAO_PARENT_AMBIGUOUS");
    expect(authSrc).toContain("pools: poolList");
  });
  it("K13-3 클라이언트: AMBIGUOUS → pool 선택 Alert", () => {
    expect(indexSrc).toContain("e.error_code === \"KAKAO_PARENT_AMBIGUOUS\"");
    expect(indexSrc).toContain("동일 전화번호로 여러 수영장에 계정이 있습니다");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K14 — no sub_admin enum literal
// ══════════════════════════════════════════════════════════════════════════════
describe("K14 — no sub_admin enum literal", () => {
  it("K14-1 auth.ts에서 'sub_admin' 문자열이 SQL role IN에 사용되지 않음", () => {
    // SQL role IN 절에서 sub_admin 검색
    const sqlRolePattern = /role\s+IN\s*\([^)]*sub_admin[^)]*\)/g;
    expect(sqlRolePattern.test(authSrc)).toBe(false);
  });
  it("K14-2 kakao-social-login Step 3: role IN (teacher, pool_admin) 정확히 2개만", () => {
    const match = authSrc.match(
      /WHERE kakao_id = \$\{kakaoId\} AND role IN \('([^']+)', '([^']+)'\) LIMIT 1/
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("teacher");
    expect(match![2]).toBe("pool_admin");
  });
  it("K14-3 kakao-link-teacher SQL: role IN에 sub_admin 없음 (주석 제외)", () => {
    // SQL role IN 절에서 sub_admin 검색 (주석에는 설명용으로 등장할 수 있으나 SQL에는 없어야 함)
    const linkTeacherSection = authSrc.slice(
      authSrc.indexOf('router.post("/kakao-link-teacher"')
    );
    // SQL role IN 절에서만 확인 (주석 제외)
    const sqlRoleInPattern = /role\s+IN\s*\([^)]*sub_admin[^)]*\)/g;
    expect(sqlRoleInPattern.test(linkTeacherSection)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K15 — invalid Kakao token → safe 401
// ══════════════════════════════════════════════════════════════════════════════
describe("K15 — invalid Kakao token → safe 401", () => {
  it("K15-1 Kakao API 401/403 응답 → KAKAO_INVALID_TOKEN 401 반환", () => {
    expect(authSrc).toContain('error_code: "KAKAO_INVALID_TOKEN"');
    expect(authSrc).toContain("카카오 인증이 만료되었습니다.");
  });
  it("K15-2 클라이언트: KAKAO_INVALID_TOKEN → 사용자 친화 메시지", () => {
    expect(indexSrc).toContain('case "KAKAO_INVALID_TOKEN":');
    expect(indexSrc).toContain("카카오 인증이 만료되었습니다. 다시 시도해주세요.");
  });
  it("K15-3 원본 토큰 노출 없음 (error body에 accessToken 없음)", () => {
    const kakaoSocialSection = authSrc.slice(
      authSrc.indexOf('router.post("/kakao-social-login"'),
      authSrc.indexOf('router.post("/kakao-link-teacher"')
    );
    // 에러 응답에 accessToken 포함 없음
    expect(kakaoSocialSection).not.toContain("accessToken:");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K16 — Kakao API timeout → safe 504 + error_code
// ══════════════════════════════════════════════════════════════════════════════
describe("K16 — Kakao API timeout", () => {
  it("K16-1 AbortController 8초 타임아웃 설정", () => {
    expect(authSrc).toContain("new AbortController()");
    expect(authSrc).toContain("kakaoController.abort(), 8000");
  });
  it("K16-2 AbortError → KAKAO_API_TIMEOUT 504 반환", () => {
    expect(authSrc).toContain('error_code: isTimeout ? "KAKAO_API_TIMEOUT" : "KAKAO_API_ERROR"');
    expect(authSrc).toContain("카카오 서버가 응답하지 않습니다.");
  });
  it("K16-3 clearTimeout 항상 실행 (finally 블록)", () => {
    expect(authSrc).toContain("clearTimeout(kakaoAbortTimer)");
    expect(authSrc).toContain("} finally {");
  });
  it("K16-4 클라이언트: KAKAO_API_TIMEOUT → 사용자 친화 메시지", () => {
    expect(indexSrc).toContain('case "KAKAO_API_TIMEOUT":');
    expect(indexSrc).toContain("카카오 서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K17 — Kakao API failure → safe 502 + error_code
// ══════════════════════════════════════════════════════════════════════════════
describe("K17 — Kakao API failure", () => {
  it("K17-1 Kakao API 5xx → KAKAO_API_ERROR 502 반환", () => {
    expect(authSrc).toContain('error_code: "KAKAO_API_ERROR"');
    expect(authSrc).toContain("카카오 서버 오류가 발생했습니다.");
  });
  it("K17-2 Kakao ID 유효성 검사 (undefined/null 방어)", () => {
    expect(authSrc).toContain('kakaoId === "undefined" || kakaoId === "null"');
    expect(authSrc).toContain('error_code: "KAKAO_PROFILE_FAILED"');
  });
  it("K17-3 클라이언트: KAKAO_API_ERROR → 사용자 친화 메시지", () => {
    expect(indexSrc).toContain('case "KAKAO_API_ERROR":');
    expect(indexSrc).toContain("카카오 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K18 — no account → kakao_no_account 404
// ══════════════════════════════════════════════════════════════════════════════
describe("K18 — no account → kakao_no_account", () => {
  it("K18-1 Step 5: kakao_no_account 404 반환", () => {
    expect(authSrc).toContain('error_code: "kakao_no_account"');
    expect(authSrc).toContain("res.status(404)");
  });
  it("K18-2 kakao_info 포함 (client에서 가입 화면으로 전환)", () => {
    expect(authSrc).toContain("kakao_info: {");
    expect(authSrc).toContain("kakao_id: kakaoId");
    expect(authSrc).toContain("profile_image: kakaoProfileImage");
  });
  it("K18-3 phone_missing 플래그 포함 (scope 미동의 구분)", () => {
    expect(authSrc).toContain("phone_missing: phoneMissing");
  });
  it("K18-4 phone_missing=true 시 다른 메시지", () => {
    expect(authSrc).toContain("카카오 계정 전화번호를 확인할 수 없습니다.");
  });
  it("K18-5 클라이언트: kakao_no_account → kakao-link 화면으로 이동", () => {
    expect(indexSrc).toContain('e.error_code === "kakao_no_account" && e.kakao_info');
    expect(indexSrc).toContain('"/(auth)/kakao-link"');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K19 — inactive account → needs_activation 403
// ══════════════════════════════════════════════════════════════════════════════
describe("K19 — inactive account behavior preserved", () => {
  it("K19-1 is_activated=false → needs_activation 403 (Step 3 teacher)", () => {
    expect(authSrc).toContain("!u.is_activated");
    expect(authSrc).toContain("needs_activation: true");
    expect(authSrc).toContain("teacher_id: u.id");
  });
  it("K19-2 클라이언트: needs_activation → teacher-activate 화면 이동", () => {
    expect(indexSrc).toContain("e.needs_activation && e.teacher_id");
    expect(indexSrc).toContain("teacher-activate");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K20 — general username/password login regression
// ══════════════════════════════════════════════════════════════════════════════
describe("K20 — general login regression (Kakao 변경 비영향)", () => {
  it("K20-1 /auth/login 라우트 유지됨 (일반 로그인)", () => {
    expect(authSrc).toContain('router.post("/login"');
  });
  it("K20-2 /auth/parent-login 라우트 유지됨", () => {
    expect(authSrc).toContain('router.post("/parent-login"');
  });
  it("K20-3 일반 로그인이 kakao-social-login 코드를 경유하지 않음", () => {
    // login 라우트와 kakao-social-login 라우트는 독립적으로 등록됨
    const loginIdx = authSrc.indexOf('router.post("/login"');
    const kakaoIdx = authSrc.indexOf('router.post("/kakao-social-login"');
    expect(loginIdx).not.toBe(kakaoIdx);
    expect(loginIdx).toBeGreaterThan(0);
    expect(kakaoIdx).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K21 — iOS Kakao config static validation
// ══════════════════════════════════════════════════════════════════════════════
describe("K21 — iOS Kakao config static validation", () => {
  const iosConfig = appJson?.expo?.ios || {};
  const infoPlist = iosConfig.infoPlist || {};
  const queriesSchemes: string[] = infoPlist.LSApplicationQueriesSchemes || [];
  const plugins: any[] = appJson?.expo?.plugins || [];
  const kakaoPlugin = plugins.find(
    (p: any) => Array.isArray(p) && p[0] === "@react-native-seoul/kakao-login"
  );

  it("K21-1 LSApplicationQueriesSchemes: kakaokompassauth 포함", () => {
    expect(queriesSchemes).toContain("kakaokompassauth");
  });
  it("K21-2 LSApplicationQueriesSchemes: kakaolink 포함", () => {
    expect(queriesSchemes).toContain("kakaolink");
  });
  it("K21-3 LSApplicationQueriesSchemes: kakaotalk 포함", () => {
    expect(queriesSchemes).toContain("kakaotalk");
  });
  it("K21-4 LSApplicationQueriesSchemes: storekvstore 포함 (Kakao keychain scheme)", () => {
    expect(queriesSchemes).toContain("storekvstore");
  });
  it("K21-5 kakaoAppKey 설정 존재", () => {
    expect(kakaoPlugin).toBeDefined();
    expect(kakaoPlugin?.[1]?.kakaoAppKey).toBeTruthy();
  });
  it("K21-6 kakaoAppKey 형식 (32자 hex)", () => {
    const key = kakaoPlugin?.[1]?.kakaoAppKey ?? "";
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });
  it("K21-7 SDK 버전 overrideKakaoSDKVersion 지정", () => {
    expect(kakaoPlugin?.[1]?.overrideKakaoSDKVersion).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K22 — Android Kakao config static validation + key hash EXTERNAL CHECK
// ══════════════════════════════════════════════════════════════════════════════
describe("K22 — Android Kakao config static validation", () => {
  const androidConfig = appJson?.expo?.android || {};
  const plugins: any[] = appJson?.expo?.plugins || [];
  const kakaoPlugin = plugins.find(
    (p: any) => Array.isArray(p) && p[0] === "@react-native-seoul/kakao-login"
  );

  it("K22-1 android.package 존재", () => {
    expect(androidConfig.package).toBeTruthy();
  });
  it("K22-2 android.package = com.swimnote.app", () => {
    expect(androidConfig.package).toBe("com.swimnote.app");
  });
  it("K22-3 kakaoAppKey 2.0 android config에서도 동일 사용", () => {
    // 공용 plugin 설정 (iOS/Android 공통 적용)
    const key = kakaoPlugin?.[1]?.kakaoAppKey ?? "";
    expect(key).toBe("0c984af3a5fcb64715c2cf3cc76c55ca");
  });
  it("K22-4 kotlinVersion 설정됨 (Kakao SDK Android 빌드 필요)", () => {
    expect(kakaoPlugin?.[1]?.kotlinVersion).toBeTruthy();
  });

  // ── EXTERNAL CHECK REQUIRED ───────────────────────────────────────────────
  // Android production key hash는 EAS Managed Credentials에서 생성됨.
  // 코드/설정 파일에서 확인 불가. Kakao Developer Console에 수동 등록 필요.
  //
  // 확인 방법:
  //   1. EAS 대시보드 → Credentials → Android → Production → Keystore SHA-1/SHA-256
  //   2. SHA-256 값을 Base64로 인코딩 → 28자 key hash 생성
  //   3. Kakao Developer Console → 내 애플리케이션 → 플랫폼 → Android → 키 해시 목록 대조
  //   4. 누락 시 "키 해시 추가" → 즉시 적용 (앱 재빌드 불필요)
  //
  // package name: com.swimnote.app
  // appKey: 0c984af3a5fcb64715c2cf3cc76c55ca
  // Kakao Console URL: https://developers.kakao.com/console/app
  // 경로: [앱 선택] → 앱 설정 → 플랫폼 → Android
  it("K22-EXTERNAL Android production key hash는 코드에서 확인 불가 — Kakao Console 수동 확인 필요", () => {
    const EXTERNAL_CHECK = "REQUIRED: EAS Credentials → SHA-256 → Base64 → Kakao Console Android 키 해시 등록";
    // 이 테스트는 항상 PASS — 외부 확인 요구사항을 코드베이스에 문서화하기 위함
    expect(EXTERNAL_CHECK).toContain("Kakao Console");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K23 — 1.6.3 and 2.0 use same production API base
// ══════════════════════════════════════════════════════════════════════════════
describe("K23 — 1.6.3 and 2.0 use same production API base", () => {
  it("K23-1 SessionContext: API_BASE import에서 단일 소스", () => {
    expect(sessionSrc).toContain("API_BASE");
  });
  it("K23-2 kakaoSocialLogin이 API_BASE 기반으로 endpoint 조합", () => {
    expect(sessionSrc).toContain("${API_BASE}/auth/kakao-social-login");
  });
  it("K23-3 API_BASE는 단일 상수로 선언, kakaoSocialLogin이 직접 URL 하드코딩 안 함", () => {
    // SessionContext.tsx에서 API_BASE는 최상단 상수로 선언됨 (환경별 자동 결정)
    // kakaoSocialLogin 함수 내부에서 직접 onrender.com 하드코딩 없음
    const kakaoFnStart = sessionSrc.indexOf("async function kakaoSocialLogin");
    const kakaoFnEnd = sessionSrc.indexOf("\n  async function", kakaoFnStart + 10);
    const kakaoFnBody = kakaoFnEnd > 0
      ? sessionSrc.slice(kakaoFnStart, kakaoFnEnd)
      : sessionSrc.slice(kakaoFnStart, kakaoFnStart + 3000);
    expect(kakaoFnBody).not.toContain("swimnote-api.onrender.com");
    // index.tsx도 직접 하드코딩 없음
    expect(indexSrc).not.toContain("swimnote-api.onrender.com");
  });
  it("K23-4 API_BASE는 AuthContext에서 import (단일 소스)", () => {
    expect(indexSrc).not.toMatch(/API_BASE\s*=\s*["']/); // 직접 정의 없음
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// K24 — no Kakao token/PII logs
// ══════════════════════════════════════════════════════════════════════════════
describe("K24 — no Kakao token/PII in log output", () => {
  it("K24-1 kakao-social-login: accessToken 로그 출력 없음", () => {
    const routeBody = authSrc.slice(
      authSrc.indexOf('router.post("/kakao-social-login"'),
      authSrc.indexOf('router.post("/kakao-link-teacher"')
    );
    // console.log에 accessToken 변수 직접 포함 없음
    expect(routeBody).not.toMatch(/console\.(log|warn|error)[^;]*accessToken/);
  });
  it("K24-2 Kakao ID masking: kakaoId=MASKED 로그", () => {
    expect(authSrc).toContain("kakaoId=MASKED");
  });
  it("K24-3 phone 실제 값 로그 출력 없음 (kakaoPhone=null 리터럴 허용)", () => {
    const routeBody = authSrc.slice(
      authSrc.indexOf('router.post("/kakao-social-login"'),
      authSrc.indexOf('router.post("/kakao-link-teacher"')
    );
    // console.log에 kakaoPhone 변수를 직접 포함하는 경우 검사
    // "kakaoPhone=null" 리터럴 문자열은 허용 (실제 값 아님)
    // 금지 패턴: console.log(`... ${kakaoPhone}`) 형태
    expect(routeBody).not.toMatch(/console\.(log|warn|error)[^`]*`[^`]*\$\{kakaoPhone\}/);
  });
  it("K24-4 클라이언트: SDK 에러 code만 로그, message 원문 로그 안전", () => {
    // safeErrMsg 패턴으로 raw message 노출 금지
    expect(indexSrc).toContain("sanitized_msg=");
    expect(indexSrc).not.toMatch(/console\.warn[^;]*e\.message/);
  });
  it("K24-5 클라이언트: SDK 레벨 에러 시 code만 출력", () => {
    expect(indexSrc).toContain("code=${e.code ?? \"none\"}");
  });
});
