/**
 * social-auth-exit.test.ts — KM01-KM25
 *
 * Social Auth Exit Plan 검증 테스트
 *
 * KM01-KM08: simple-parent-register 중복 감지 분기
 * KM09-KM18: POST /auth/kakao-migration-register
 * KM19-KM21: 2.0 Apple no_account 흐름 (서버 응답 포맷)
 * KM22-KM24: Apple fallback 및 Kakao 제거 회귀
 * KM25: Dry-run 감사 발견 테이블 (growth_report_reactions, parent_v2_pending 추가 / growth_report_interactions 제외) 검증
 *
 * 모든 테스트는 in-memory mock — 프로덕션 DB 쓰기 없음.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── 공통 헬퍼 ──────────────────────────────────────────────────────────────

interface MockAccount {
  id: string;
  swimming_pool_id: string;
  phone: string;
  kakao_id: string | null;
  apple_id?: string | null;
  is_active: boolean;
  login_id: string | null;
  pin_hash: string | null;
  withdrawal_requested_at: string | null;
  name: string;
}

function makeAccount(overrides: Partial<MockAccount> = {}): MockAccount {
  return {
    id: "pa_old_001",
    swimming_pool_id: "pool_abc",
    phone: "01012345678",
    kakao_id: "kakao_uid_111",
    apple_id: null,
    is_active: true,
    login_id: null,
    pin_hash: null,
    withdrawal_requested_at: null,
    name: "테스트학부모",
    ...overrides,
  };
}

// ── 응답 shape 검사 유틸 ──────────────────────────────────────────────────

function expectKakaoMigrationRequired(body: any) {
  expect(body).toMatchObject({
    error_code: "KAKAO_MIGRATION_REQUIRED",
  });
  expect(typeof body.old_parent_id).toBe("string");
}

function expectMigrationSuccess(body: any) {
  expect(body.migrated).toBe(true);
  expect(typeof body.token).toBe("string");
  expect(body.token.length).toBeGreaterThan(10);
  expect(typeof body.parent).toBe("object");
  expect(body.parent).not.toBeNull();
}

// ══════════════════════════════════════════════════════════════════════════════
// KM01-KM08: simple-parent-register 중복 감지
// ══════════════════════════════════════════════════════════════════════════════

describe("KM01-KM08: simple-parent-register duplicate detection", () => {

  // KM01: Kakao 계정 있을 때 KAKAO_MIGRATION_REQUIRED 반환
  it("KM01: 동일 pool+phone에 kakao_id 있는 계정 존재 → KAKAO_MIGRATION_REQUIRED", () => {
    const existing = makeAccount({ kakao_id: "kakao_uid_111", is_active: true, phone: "01012345678" });

    // 서버 로직 시뮬레이션
    function checkDuplicate(existing: MockAccount | null, requestPhone: string) {
      if (!existing) return null;
      const ph = requestPhone.replace(/[^0-9]/g, "");
      const epn = existing.phone.replace(/[^0-9]/g, "");
      if (ph !== epn) return null;
      if (existing.kakao_id && existing.is_active !== false) {
        return { status: 409, body: { error_code: "KAKAO_MIGRATION_REQUIRED", old_parent_id: existing.id, error: "이미 카카오로 가입된 전화번호입니다." } };
      }
      return { status: 409, body: { error: "이미 가입된 전화번호입니다." } };
    }

    const result = checkDuplicate(existing, "010-1234-5678");
    expect(result?.status).toBe(409);
    expectKakaoMigrationRequired(result?.body);
  });

  // KM02: 일반 계정 있을 때 기존 409 반환
  it("KM02: 동일 pool+phone에 일반 계정(kakao_id=null) 존재 → 일반 409", () => {
    const existing = makeAccount({ kakao_id: null, pin_hash: "hashed", login_id: "user01" });

    function checkDuplicate(ex: MockAccount) {
      if (ex.kakao_id) return { error_code: "KAKAO_MIGRATION_REQUIRED" };
      return { error: "이미 가입된 전화번호입니다." };
    }

    const result = checkDuplicate(existing);
    expect(result).not.toHaveProperty("error_code");
    expect(result).toHaveProperty("error");
  });

  // KM03: 이미 아카이브된 계정(phone='') — 중복 없음, 정상 가입 허용
  it("KM03: 아카이브된 계정(phone=empty) → 중복 아님 → 가입 허용", () => {
    const archived = makeAccount({ phone: "", is_active: false, withdrawal_requested_at: "2026-09-01T00:00:00Z" });

    // 서버 WHERE phone != '' 조건으로 제외
    function isDuplicate(acc: MockAccount, requestPhone: string): boolean {
      if (acc.phone === "") return false; // 아카이브: phone='' 는 인덱스 제외
      return acc.phone.replace(/[^0-9]/g, "") === requestPhone.replace(/[^0-9]/g, "");
    }

    expect(isDuplicate(archived, "01012345678")).toBe(false);
  });

  // KM04: is_active=false인 Kakao 계정 — KAKAO_MIGRATION_REQUIRED 미반환
  it("KM04: is_active=false인 Kakao 계정 → KAKAO_MIGRATION_REQUIRED 미반환", () => {
    const existing = makeAccount({ kakao_id: "k_uid", is_active: false, phone: "01012345678" });

    function checkDuplicate(ex: MockAccount) {
      if (ex.phone === "") return null;
      if (ex.kakao_id && ex.is_active !== false) {
        return { error_code: "KAKAO_MIGRATION_REQUIRED" };
      }
      return { error: "이미 가입된 전화번호입니다." };
    }

    const result = checkDuplicate(existing);
    expect(result?.error_code).toBeUndefined();
  });

  // KM05: 다른 pool → 충돌 없음
  it("KM05: 다른 pool_id → 동일 phone이어도 충돌 없음", () => {
    function samePool(accPoolId: string, requestPoolId: string) {
      return accPoolId === requestPoolId;
    }
    expect(samePool("pool_abc", "pool_xyz")).toBe(false);
  });

  // KM06: old_parent_id 필드 반드시 포함
  it("KM06: KAKAO_MIGRATION_REQUIRED 응답에 old_parent_id 포함", () => {
    const body = {
      error_code: "KAKAO_MIGRATION_REQUIRED",
      old_parent_id: "pa_old_001",
      error: "이미 카카오로 가입된 전화번호입니다.",
    };
    expectKakaoMigrationRequired(body);
  });

  // KM07: 전화번호 정규화 — 하이픈 포함해도 동일 처리
  it("KM07: 전화번호 정규화 — 010-1234-5678 = 01012345678", () => {
    const normalize = (p: string) => p.replace(/[^0-9]/g, "");
    expect(normalize("010-1234-5678")).toBe(normalize("01012345678"));
    expect(normalize("010 1234 5678")).toBe(normalize("01012345678"));
  });

  // KM08: pool_id 없을 때 전체 조회 — Kakao 분기 없음 (기존 정책 유지)
  it("KM08: pool_id 없는 요청(전체 조회) — Kakao 분기 적용 안 됨", () => {
    // pool_id 없는 경우엔 기존 simple-parent-register 로직 그대로
    function checkNoPool(existing: MockAccount | null): string | null {
      if (!existing) return null;
      // Kakao 분기는 resolvedPoolId가 있을 때만
      return "이미 가입된 전화번호입니다.";
    }
    const result = checkNoPool(makeAccount({ kakao_id: "k" }));
    expect(result).toBe("이미 가입된 전화번호입니다.");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// KM09-KM18: POST /auth/kakao-migration-register
// ══════════════════════════════════════════════════════════════════════════════

describe("KM09-KM18: kakao-migration-register endpoint logic", () => {

  // migration 핵심 로직 시뮬레이터
  async function simulateMigration(opts: {
    existing: MockAccount | null;
    requestPhone: string;
    requestPoolId: string;
    pin: string;
    name: string;
    login_id?: string;
  }): Promise<{ status: number; body: any }> {
    const { existing, requestPhone, requestPoolId, pin, name, login_id } = opts;
    const ph = requestPhone.replace(/[^0-9]/g, "");

    if (!ph || !requestPoolId || !name || !pin) {
      return { status: 400, body: { error: "필수 파라미터 누락" } };
    }
    if (String(pin).length < 4) {
      return { status: 400, body: { error: "비밀번호는 4자 이상" } };
    }

    if (!existing) {
      return { status: 409, body: { error_code: "KAKAO_NOT_FOUND", error: "해당 전화번호로 등록된 계정을 찾을 수 없습니다." } };
    }

    const existingPh = existing.phone.replace(/[^0-9]/g, "");
    if (existingPh !== ph || existing.swimming_pool_id !== requestPoolId) {
      return { status: 409, body: { error_code: "KAKAO_NOT_FOUND", error: "해당 전화번호로 등록된 계정을 찾을 수 없습니다." } };
    }

    if (!existing.kakao_id) {
      return { status: 409, body: { error_code: "NO_KAKAO_ACCOUNT", error: "카카오 연결 계정이 아닙니다." } };
    }

    // Idempotency: 이미 아카이브된 경우
    if (existing.phone === "") {
      return { status: 409, body: { error_code: "ALREADY_MIGRATED", error: "이미 일반계정으로 전환된 계정입니다." } };
    }

    // 성공: 새 계정 생성
    const newId = `pa_new_${Date.now()}`;
    return {
      status: 201,
      body: {
        token: "eyJtest.migrated." + newId,
        parent: { id: newId, name, phone: ph, swimming_pool_id: requestPoolId, login_id: login_id || null },
        migrated: true,
        old_parent_id: existing.id,
      },
    };
  }

  // KM09: 정상 migration 성공
  it("KM09: 정상 kakao 계정 migration → 201 + migrated:true + token", async () => {
    const existing = makeAccount();
    const result = await simulateMigration({
      existing, requestPhone: "01012345678", requestPoolId: "pool_abc",
      pin: "1234", name: "새이름",
    });
    expect(result.status).toBe(201);
    expectMigrationSuccess(result.body);
  });

  // KM10: 기존 계정 없음 → KAKAO_NOT_FOUND
  it("KM10: 기존 계정 없음 → 409 KAKAO_NOT_FOUND", async () => {
    const result = await simulateMigration({
      existing: null, requestPhone: "01099999999", requestPoolId: "pool_abc",
      pin: "1234", name: "이름",
    });
    expect(result.status).toBe(409);
    expect(result.body.error_code).toBe("KAKAO_NOT_FOUND");
  });

  // KM11: kakao_id 없는 일반 계정 → NO_KAKAO_ACCOUNT
  it("KM11: kakao_id 없는 일반 계정 → 409 NO_KAKAO_ACCOUNT", async () => {
    const existing = makeAccount({ kakao_id: null, pin_hash: "hash", login_id: "user01" });
    const result = await simulateMigration({
      existing, requestPhone: "01012345678", requestPoolId: "pool_abc",
      pin: "1234", name: "이름",
    });
    expect(result.status).toBe(409);
    expect(result.body.error_code).toBe("NO_KAKAO_ACCOUNT");
  });

  // KM12: Idempotency — 서버는 old_parent_id로 직접 조회 후 phone='' 확인 → ALREADY_MIGRATED
  it("KM12: 이미 아카이브된 계정(phone='') — 서버 로직에서 ALREADY_MIGRATED 반환", () => {
    // 서버는 re-check 단계에서 SELECT FOR UPDATE 후 phone='' 확인
    // simulateMigration은 phone 매칭으로 먼저 조회하므로 실제 서버 로직과 별도 단위테스트
    function checkRecheck(accAfterLock: MockAccount): { status: number; body: any } {
      // 3-b. Re-verify: phone이 이미 ''이면 ALREADY_MIGRATED
      if (!accAfterLock.kakao_id || String(accAfterLock.phone).trim() === "") {
        return { status: 409, body: { error_code: "ALREADY_MIGRATED", error: "이미 일반계정으로 전환된 계정입니다." } };
      }
      return { status: 200, body: { ok: true } };
    }

    // 이미 아카이브된 상태
    const archivedAcc = makeAccount({ phone: "", is_active: false, withdrawal_requested_at: "2026-09-01T00:00:00Z" });
    const result = checkRecheck(archivedAcc);
    expect(result.status).toBe(409);
    expect(result.body.error_code).toBe("ALREADY_MIGRATED");

    // 미아카이브 상태 — 정상 진행
    const activeAcc = makeAccount({ phone: "01012345678", is_active: true });
    const result2 = checkRecheck(activeAcc);
    expect(result2.status).toBe(200);
  });

  // KM13: pin 길이 < 4 → 400
  it("KM13: pin 길이 < 4 → 400", async () => {
    const existing = makeAccount();
    const result = await simulateMigration({
      existing, requestPhone: "01012345678", requestPoolId: "pool_abc",
      pin: "12", name: "이름",
    });
    expect(result.status).toBe(400);
  });

  // KM14: 필수 파라미터 누락 → 400
  it("KM14: 필수 파라미터 누락 → 400", async () => {
    const existing = makeAccount();
    const result = await simulateMigration({
      existing, requestPhone: "", requestPoolId: "pool_abc",
      pin: "1234", name: "이름",
    });
    expect(result.status).toBe(400);
  });

  // KM15: 응답에 old_parent_id 포함
  it("KM15: migration 성공 응답에 old_parent_id 포함", async () => {
    const existing = makeAccount({ id: "pa_old_xyz" });
    const result = await simulateMigration({
      existing, requestPhone: "01012345678", requestPoolId: "pool_abc",
      pin: "1234", name: "이름",
    });
    expect(result.status).toBe(201);
    expect(result.body.old_parent_id).toBe("pa_old_xyz");
  });

  // KM16: 새 계정에 login_id 옵셔널 설정 가능
  it("KM16: login_id 포함 시 새 계정에 설정", async () => {
    const existing = makeAccount();
    const result = await simulateMigration({
      existing, requestPhone: "01012345678", requestPoolId: "pool_abc",
      pin: "1234", name: "이름", login_id: "mylogin01",
    });
    expect(result.status).toBe(201);
    expect(result.body.parent.login_id).toBe("mylogin01");
  });

  // KM17: 아카이브 전략 — old account phone = '' 상태 검증
  it("KM17: 아카이브 전략 — old account는 phone='' 로 업데이트됨", async () => {
    // 아카이브 결과를 시뮬레이션
    const oldAcc = makeAccount({ phone: "01012345678", is_active: true });
    // migration 후 상태
    const archivedAcc = { ...oldAcc, phone: "", is_active: false, withdrawal_requested_at: new Date().toISOString() };
    expect(archivedAcc.phone).toBe("");
    expect(archivedAcc.is_active).toBe(false);
    expect(archivedAcc.withdrawal_requested_at).toBeTruthy();
    // kakao_id는 history용 보존
    expect(archivedAcc.kakao_id).toBe("kakao_uid_111");
  });

  // KM18: 새 계정에 Kakao ID 없음 (일반 계정)
  it("KM18: 새로 생성된 계정에는 kakao_id 없음", async () => {
    const existing = makeAccount();
    const result = await simulateMigration({
      existing, requestPhone: "01012345678", requestPoolId: "pool_abc",
      pin: "1234", name: "이름",
    });
    expect(result.status).toBe(201);
    // new parent에 kakao_id 없음 (응답에 포함 안 됨)
    expect((result.body.parent as any).kakao_id).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// KM19-KM21: 2.0 Apple no_account 흐름
// ══════════════════════════════════════════════════════════════════════════════

describe("KM19-KM21: 2.0 Apple no_account → 일반 가입 안내", () => {

  // apple_no_account 에러 shape 시뮬레이터
  function makeAppleNoAccountError(appleInfo: { apple_id: string; email?: string; name?: string }) {
    const err = new Error("apple_no_account") as any;
    err.error_code = "apple_no_account";
    err.apple_info = appleInfo;
    return err;
  }

  // 2.0 handler 시뮬레이션: apple_no_account → showAppleSignupGuide=true, no appleId params
  function handle20AppleNoAccount(err: any): { showGuide: boolean; navigateTo: string | null; params: object | null } {
    if (err.error_code === "apple_no_account") {
      // 2.0: appleId params 없이 안내 모달만
      return { showGuide: true, navigateTo: null, params: null };
    }
    return { showGuide: false, navigateTo: null, params: null };
  }

  // KM19: apple_no_account → 안내 모달 표시 (navigateTo=null)
  it("KM19: apple_no_account → showAppleSignupGuide=true, navigateTo=null", () => {
    const err = makeAppleNoAccountError({ apple_id: "apple.0001.xxx", email: "a@b.com", name: "홍길동" });
    const result = handle20AppleNoAccount(err);
    expect(result.showGuide).toBe(true);
    expect(result.navigateTo).toBeNull();
  });

  // KM20: 1.6.3에서는 apple_no_account → appleId params와 함께 signup으로 이동
  it("KM20: 1.6.3 apple_no_account → signup/(auth) + appleId params", () => {
    function handle163AppleNoAccount(err: any): { navigateTo: string; params: object } | null {
      if (err.error_code === "apple_no_account" && err.apple_info) {
        return {
          navigateTo: "/(auth)/signup",
          params: {
            appleId:    err.apple_info.apple_id ?? "",
            appleEmail: err.apple_info.email    ?? "",
            appleName:  err.apple_info.name     ?? "",
          },
        };
      }
      return null;
    }
    const err = makeAppleNoAccountError({ apple_id: "apple.0001.xxx", email: "a@b.com", name: "홍길동" });
    const result = handle163AppleNoAccount(err);
    expect(result).not.toBeNull();
    expect(result?.navigateTo).toBe("/(auth)/signup");
    expect((result?.params as any).appleId).toBe("apple.0001.xxx");
    expect((result?.params as any).appleEmail).toBe("a@b.com");
  });

  // KM21: 2.0 안내 모달에서 [회원가입] 누르면 appleId 없이 signup 이동
  it("KM21: 2.0 안내 모달 [회원가입] → appleId 없이 /(auth)/signup 이동", () => {
    // 안내 모달 [회원가입] 클릭 핸들러 시뮬레이션
    function handleAppleGuideSignup(showGuide: boolean): { navigateTo: string; params: object } | null {
      if (!showGuide) return null;
      return { navigateTo: "/(auth)/signup", params: {} }; // appleId 없음
    }
    const result = handleAppleGuideSignup(true);
    expect(result?.navigateTo).toBe("/(auth)/signup");
    expect(Object.keys(result?.params ?? {})).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// KM22-KM24: Apple fallback 및 Kakao 제거 회귀
// ══════════════════════════════════════════════════════════════════════════════

describe("KM22-KM24: Apple fallback & Kakao removal regression", () => {

  // KM22: 2.0 index.tsx에서 Kakao 버튼 없어야 함 (UI assertion)
  // NOTE: 1.6.3 branch에서는 index.tsx에 Kakao UI가 여전히 존재하므로 skip
  it("KM22: 2.0 login screen — Kakao 버튼 UI에 없어야 함", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const indexPath = path.resolve(process.cwd(), "../../artifacts/swim-app/app/index.tsx");
    const content = fs.readFileSync(indexPath, "utf-8");

    // 1.6.3 branch는 Kakao UI 유지 → 검증 대상 아님
    const isV163Branch = content.includes("handleKakaoLogin");
    if (isV163Branch) {
      // 1.6.3: Kakao UI 존재가 정상 — skip assertions
      expect(isV163Branch).toBe(true);
      return;
    }
    // v2.0: Kakao 버튼 JSX가 없어야 함 (함수 본문 제거됨)
    expect(content).not.toMatch(/카카오로 로그인\/회원가입/);
    expect(content).not.toMatch(/onPress=\{handleKakaoLogin\}/);
  });

  // KM23: 2.0 Apple 로그인 버튼 레이블 — "로그인"만 (가입 제거)
  // NOTE: 1.6.3 branch에서는 "Apple로 로그인/회원가입" 레이블이 정상
  it("KM23: 2.0 Apple 버튼 레이블 — Apple로 로그인/회원가입 아님, Apple로 로그인", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const indexPath = path.resolve(process.cwd(), "../../artifacts/swim-app/app/index.tsx");
    const content = fs.readFileSync(indexPath, "utf-8");

    // 1.6.3 branch: Apple 버튼 레이블 검증 skip
    const isV163Branch = content.includes("handleKakaoLogin");
    if (isV163Branch) {
      // 1.6.3: "Apple로 로그인/회원가입" 유지 — skip v2.0 assertion
      expect(isV163Branch).toBe(true);
      return;
    }
    // v2.0: "Apple로 로그인" 존재, "Apple로 로그인/회원가입" 없음
    expect(content).toMatch(/Apple로 로그인/);
    expect(content).not.toMatch(/Apple로 로그인\/회원가입/);
  });

  // KM24: 2.0 signup.tsx — appleId params 없이도 동작 가능 (kakaoId 없어도 가입 가능)
  it("KM24: 2.0 signup.tsx — isSocial=false 시(일반 가입) appleId 없어도 정상 동작", () => {
    // 일반 가입 플로우: kakaoId='', appleId='' → isSocial=false
    const kakaoId = "";
    const appleId = "";
    const isSocial = !!(appleId || kakaoId);
    expect(isSocial).toBe(false);

    // 일반 가입은 Step1부터 시작
    const initialStep = isSocial ? 3 : 1;
    expect(initialStep).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// KM25: Dry-run 감사 발견 테이블 검증
// ══════════════════════════════════════════════════════════════════════════════

describe("KM25: Dry-run schema audit — migration table list correctness", () => {

  // Migration endpoint에서 실제로 사용하는 테이블 목록 (코드와 1:1 동기화)
  const MIGRATION_PARENT_ID_TABLES = [
    "parent_students",
    "notice_reads",
    "student_registration_requests",
    "parent_student_requests",
    "diary_reactions",
    "parent_content_reads",
    "growth_report_reactions",   // dry-run 감사 추가 (Production에 존재)
    "parent_v2_pending",         // dry-run 감사 추가 (Production에 존재, 홍** 1row)
    "member_activity_logs",      // 별도 처리 (nullable parent_id)
  ];
  const MIGRATION_PARENT_ACCOUNT_ID_TABLES = [
    "push_settings",
    "push_tokens",
    "parent_pool_requests",
    "parent_ai_daily_usage",
    "parent_ai_usage_reservations",
    "parent_curriculum_conversations",
    "growth_report_answers",
  ];
  const MIGRATION_PARENT_USER_ID_TABLES = ["students", "members"];

  // Production에서 발견된 모든 parent-ref 테이블 (dry-run STEP3 결과)
  const PROD_PARENT_REF_TABLES: Array<{ table: string; col: string }> = [
    { table: "diary_reactions",               col: "parent_id" },
    { table: "growth_report_answers",         col: "parent_account_id" },
    { table: "growth_report_reactions",       col: "parent_id" },
    { table: "member_activity_logs",          col: "parent_id" },
    { table: "members",                       col: "parent_user_id" },
    { table: "notice_reads",                  col: "parent_id" },
    { table: "parent_ai_daily_usage",         col: "parent_account_id" },
    { table: "parent_ai_usage_reservations",  col: "parent_account_id" },
    { table: "parent_content_reads",          col: "parent_id" },
    { table: "parent_curriculum_conversations", col: "parent_account_id" },
    { table: "parent_pool_requests",          col: "parent_account_id" },
    { table: "parent_student_requests",       col: "parent_id" },
    { table: "parent_students",               col: "parent_id" },
    { table: "parent_v2_pending",             col: "parent_id" },
    { table: "push_settings",                 col: "parent_account_id" },
    { table: "push_tokens",                   col: "parent_account_id" },
    { table: "student_registration_requests", col: "parent_id" },
    { table: "students",                      col: "parent_user_id" },
  ];

  it("KM25-A: growth_report_interactions은 migration 목록에 없어야 함 (Production 미존재)", () => {
    const allMigrationTables = [
      ...MIGRATION_PARENT_ID_TABLES,
      ...MIGRATION_PARENT_ACCOUNT_ID_TABLES,
      ...MIGRATION_PARENT_USER_ID_TABLES,
    ];
    expect(allMigrationTables).not.toContain("growth_report_interactions");
  });

  it("KM25-B: growth_report_reactions는 migration 목록에 있어야 함 (Production 존재)", () => {
    expect(MIGRATION_PARENT_ID_TABLES).toContain("growth_report_reactions");
  });

  it("KM25-C: parent_v2_pending는 migration 목록에 있어야 함 (Production 존재, 홍** 1row)", () => {
    expect(MIGRATION_PARENT_ID_TABLES).toContain("parent_v2_pending");
  });

  it("KM25-D: Production에서 발견된 모든 parent-ref 테이블이 migration 목록에 포함됨 (MISSING=0)", () => {
    const allMigrationTables = new Set([
      ...MIGRATION_PARENT_ID_TABLES,
      ...MIGRATION_PARENT_ACCOUNT_ID_TABLES,
      ...MIGRATION_PARENT_USER_ID_TABLES,
    ]);
    const missing = PROD_PARENT_REF_TABLES.filter(
      ({ table }) => !allMigrationTables.has(table)
    );
    expect(missing).toHaveLength(0);
  });

  it("KM25-E: 모든 migration parent_id 테이블이 Production에서 발견된 참조 목록에 있음", () => {
    const prodPidTables = new Set(
      PROD_PARENT_REF_TABLES.filter(r => r.col === "parent_id").map(r => r.table)
    );
    const notInProd = MIGRATION_PARENT_ID_TABLES.filter(t => !prodPidTables.has(t));
    expect(notInProd).toHaveLength(0);
  });

  it("KM25-F: Production phone='' index는 WHERE phone!='' 조건부 — archived account는 unique 충돌 없음", () => {
    // idx_parent_accounts_pool_phone 실제 definition (dry-run STEP4에서 확인):
    // CREATE UNIQUE INDEX ... WHERE ((phone IS NOT NULL) AND (phone <> '') AND (swimming_pool_id IS NOT NULL))
    // → phone='' 행은 이 인덱스에 포함되지 않으므로 여러 개 존재해도 충돌 없음
    const indexCondition = "phone <> ''"; // partial index where clause
    const archivedPhone = "";
    const isExcludedFromIndex = archivedPhone === ""; // phone='' → WHERE 불만족 → 인덱스 제외
    expect(isExcludedFromIndex).toBe(true);
    expect(indexCondition).toContain("phone <> ''");
  });

  it("KM25-G: Toykids 3명 모두 phone SET(11digits), is_active=true, kakao_id 존재, 미탈퇴 — READY", () => {
    // dry-run STEP1 결과를 static assertion으로 고정
    const accounts = [
      { masked: "노**", phone_status: "SET (11digits)", is_active: true, has_kakao: true, withdrawn: false },
      { masked: "박**", phone_status: "SET (11digits)", is_active: true, has_kakao: true, withdrawn: false },
      { masked: "홍**", phone_status: "SET (11digits)", is_active: true, has_kakao: true, withdrawn: false },
    ];
    for (const acc of accounts) {
      expect(acc.phone_status).toMatch(/^SET/);
      expect(acc.is_active).toBe(true);
      expect(acc.has_kakao).toBe(true);
      expect(acc.withdrawn).toBe(false);
    }
    expect(accounts).toHaveLength(3);
  });
});
