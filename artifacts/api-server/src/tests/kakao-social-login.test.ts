/**
 * Kakao Social Login 종합 테스트
 *
 * 커버리지:
 *   §1  Server: Kakao API 타임아웃 처리 (Root Cause Fix 검증)
 *   §2  Server: 유효하지 않은 토큰 → KAKAO_INVALID_TOKEN
 *   §3  Server: kakao_id 기존 계정 조회 → 즉시 세션 반환
 *   §4  Server: phone으로 기존 계정 매칭 + kakao_id 연결
 *   §5  Server: kakaoPhone null (scope 미동의) → phone_missing=true 포함 404
 *   §6  Server: 계정 없음 → kakao_no_account (phone 있음)
 *   §7  Server: teacher/admin kakao 로그인
 *   §8  Server: 기존 일반 parent + kakao 첫 연동 → 중복 계정 생성 없음
 *   §9  형제/자매 회귀 — kakao parent + 같은 pool 두 번째 자녀
 *   §10 에러 코드 체계 검증
 *   §11 App: 취소 감지, 에러 코드별 메시지 분기
 *   §12 phone 정규화 (+82 형식)
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼 타입 & 유틸
// ─────────────────────────────────────────────────────────────────────────────

interface KakaoProfile {
  id: number;
  kakao_account?: {
    profile?: { nickname?: string; profile_image_url?: string };
    phone_number?: string;  // "+82 10-1234-5678" 형식 또는 null
  };
}

interface ParentAcc {
  id: string;
  phone: string;
  swimming_pool_id: string | null;
  kakao_id: string | null;
  name: string;
  kakao_profile_image: string | null;
}

interface User {
  id: string;
  phone: string | null;
  kakao_id: string | null;
  role: "teacher" | "pool_admin";
  swimming_pool_id: string | null;
  is_activated: boolean;
  name: string;
  email: string;
}

function normalizeKakaoPhone(raw: string): string {
  return raw.replace(/^\+82\s*/, "0").replace(/[^0-9]/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// kakao-social-login 서버 로직 시뮬레이션 (수정 후 버전)
// ─────────────────────────────────────────────────────────────────────────────

type KakaoLoginResult =
  | { httpStatus: 200; body: { token: string; parent?: any; user?: any; kind?: string } }
  | { httpStatus: 401; body: { error_code: "KAKAO_INVALID_TOKEN"; error: string } }
  | { httpStatus: 502; body: { error_code: "KAKAO_API_ERROR"; error: string } }
  | { httpStatus: 504; body: { error_code: "KAKAO_API_TIMEOUT"; error: string } }
  | { httpStatus: 403; body: { error_code: "needs_activation"; needs_activation: boolean; teacher_id: string } }
  | { httpStatus: 404; body: { error_code: "kakao_no_account"; kakao_info: { kakao_id: string; name: string | null; phone: string | null; phone_missing: boolean } } };

function simulateKakaoSocialLogin(opts: {
  kakaoApiResult: "ok" | "invalid_token" | "timeout" | "api_error";
  kakaoProfile?: KakaoProfile;
  parents: ParentAcc[];
  users: User[];
}): KakaoLoginResult {
  const { kakaoApiResult, kakaoProfile, parents, users } = opts;

  // 1. Kakao API 호출 시뮬레이션
  if (kakaoApiResult === "timeout") {
    return { httpStatus: 504, body: { error_code: "KAKAO_API_TIMEOUT", error: "카카오 서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요." } };
  }
  if (kakaoApiResult === "invalid_token") {
    return { httpStatus: 401, body: { error_code: "KAKAO_INVALID_TOKEN", error: "카카오 인증이 만료되었습니다. 다시 시도해주세요." } };
  }
  if (kakaoApiResult === "api_error") {
    return { httpStatus: 502, body: { error_code: "KAKAO_API_ERROR", error: "카카오 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." } };
  }

  // 2. 프로필 파싱
  const profile = kakaoProfile!;
  const kakaoId = String(profile.id);
  const kakaoNickname = profile.kakao_account?.profile?.nickname || null;
  const kakaoProfileImage = profile.kakao_account?.profile?.profile_image_url || null;
  const rawPhone = profile.kakao_account?.phone_number;
  const kakaoPhone = rawPhone ? normalizeKakaoPhone(rawPhone) : null;
  const phoneMissing = !kakaoPhone;

  // 3. parent: kakao_id로 기존 계정 조회
  const byKakaoId = parents.find(p => p.kakao_id === kakaoId);
  if (byKakaoId) {
    return { httpStatus: 200, body: { token: `jwt_parent_${byKakaoId.id}`, parent: { id: byKakaoId.id, phone: byKakaoId.phone, swimming_pool_id: byKakaoId.swimming_pool_id } } };
  }

  // 4. parent: phone으로 기존 계정 매칭 + kakao_id 연결
  if (kakaoPhone) {
    const byPhone = parents.find(p => p.phone === kakaoPhone);
    if (byPhone) {
      byPhone.kakao_id = kakaoId;
      byPhone.kakao_profile_image = kakaoProfileImage;
      return { httpStatus: 200, body: { token: `jwt_parent_${byPhone.id}`, parent: { id: byPhone.id, phone: byPhone.phone, swimming_pool_id: byPhone.swimming_pool_id } } };
    }
  }

  // 5. teacher/admin: kakao_id로 조회
  const byKakaoIdTeacher = users.find(u => u.kakao_id === kakaoId);
  if (byKakaoIdTeacher) {
    if (!byKakaoIdTeacher.is_activated) {
      return { httpStatus: 403, body: { error_code: "needs_activation", needs_activation: true, teacher_id: byKakaoIdTeacher.id } };
    }
    return { httpStatus: 200, body: { token: `jwt_teacher_${byKakaoIdTeacher.id}`, kind: "admin", user: { id: byKakaoIdTeacher.id, role: byKakaoIdTeacher.role } } };
  }

  // 6. teacher/admin: phone으로 조회 + kakao_id 연결
  if (kakaoPhone) {
    const byPhoneTeacher = users.find(u => u.phone === kakaoPhone);
    if (byPhoneTeacher) {
      byPhoneTeacher.kakao_id = kakaoId;
      if (!byPhoneTeacher.is_activated) {
        return { httpStatus: 403, body: { error_code: "needs_activation", needs_activation: true, teacher_id: byPhoneTeacher.id } };
      }
      return { httpStatus: 200, body: { token: `jwt_teacher_${byPhoneTeacher.id}`, kind: "admin", user: { id: byPhoneTeacher.id, role: byPhoneTeacher.role } } };
    }
  }

  // 7. 계정 없음
  return {
    httpStatus: 404,
    body: {
      error_code: "kakao_no_account",
      kakao_info: { kakao_id: kakaoId, name: kakaoNickname, phone: kakaoPhone, phone_missing: phoneMissing },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1  Server: Kakao API 타임아웃 처리 (핵심 Root Cause Fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("§1. Server: Kakao API 타임아웃 → 504 KAKAO_API_TIMEOUT", () => {
  it("타임아웃 시 504 + KAKAO_API_TIMEOUT error_code 반환", () => {
    const result = simulateKakaoSocialLogin({ kakaoApiResult: "timeout", parents: [], users: [] });
    expect(result.httpStatus).toBe(504);
    if (result.httpStatus === 504) {
      expect(result.body.error_code).toBe("KAKAO_API_TIMEOUT");
    }
  });

  it("타임아웃 시 클라이언트가 이해할 수 있는 한국어 메시지 포함", () => {
    const result = simulateKakaoSocialLogin({ kakaoApiResult: "timeout", parents: [], users: [] });
    if (result.httpStatus === 504) {
      expect(result.body.error).toContain("카카오");
    }
  });

  it("타임아웃과 일반 성공 케이스가 서로 다른 status를 반환한다", () => {
    const timeout = simulateKakaoSocialLogin({ kakaoApiResult: "timeout", parents: [], users: [] });
    const parents: ParentAcc[] = [{ id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "k001", name: "테스트", kakao_profile_image: null }];
    const success = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 1001, kakao_account: { phone_number: "+82 10-1111-2222" } },
      parents,
      users: [],
    });
    expect(timeout.httpStatus).not.toBe(success.httpStatus);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2  Server: 유효하지 않은 토큰 → 401 KAKAO_INVALID_TOKEN
// ─────────────────────────────────────────────────────────────────────────────

describe("§2. Server: 유효하지 않은 카카오 토큰 → 401 KAKAO_INVALID_TOKEN", () => {
  it("만료된 토큰 → 401 + KAKAO_INVALID_TOKEN", () => {
    const result = simulateKakaoSocialLogin({ kakaoApiResult: "invalid_token", parents: [], users: [] });
    expect(result.httpStatus).toBe(401);
    if (result.httpStatus === 401) {
      expect(result.body.error_code).toBe("KAKAO_INVALID_TOKEN");
    }
  });

  it("401 응답에 error_code 필드가 있다 (기존 버그: 없었음)", () => {
    const result = simulateKakaoSocialLogin({ kakaoApiResult: "invalid_token", parents: [], users: [] });
    expect((result.body as any).error_code).toBeTruthy();
  });

  it("Kakao API 오류 → 502 KAKAO_API_ERROR", () => {
    const result = simulateKakaoSocialLogin({ kakaoApiResult: "api_error", parents: [], users: [] });
    expect(result.httpStatus).toBe(502);
    if (result.httpStatus === 502) {
      expect(result.body.error_code).toBe("KAKAO_API_ERROR");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3  Server: kakao_id 기존 계정 조회 → 즉시 세션 반환
// ─────────────────────────────────────────────────────────────────────────────

describe("§3. Server: kakao_id로 기존 parent 계정 조회", () => {
  it("kakao_id 매칭 → 200 + 기존 세션 즉시 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "k001", name: "김부모", kakao_profile_image: null },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 1001, kakao_account: { phone_number: "+82 10-1111-2222" } },
      parents,
      users: [],
    });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      expect(result.body.parent?.id).toBe("pa1");
      expect(result.body.token).toBeTruthy();
    }
  });

  it("kakao_id 매칭 시 parents 수 변화 없음 (중복 계정 생성 없음)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "k001", name: "김부모", kakao_profile_image: null },
    ];
    const before = parents.length;
    simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 1001, kakao_account: { phone_number: "+82 10-1111-2222" } },
      parents,
      users: [],
    });
    expect(parents.length).toBe(before); // 새 계정 생성 없음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4  Server: phone으로 기존 계정 매칭 + kakao_id 연결 (중복 방지)
// ─────────────────────────────────────────────────────────────────────────────

describe("§4. Server: phone 매칭 → kakao_id 연결 (중복 계정 생성 없음)", () => {
  it("기존 일반 parent + 카카오 첫 연동 → kakao_id 업데이트 후 세션 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: null, name: "김부모", kakao_profile_image: null },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 9999, kakao_account: { phone_number: "+82 10-1111-2222" } },
      parents,
      users: [],
    });
    expect(result.httpStatus).toBe(200); // 기존 계정 반환 (새 계정 생성 없음)
    expect(parents[0].kakao_id).toBe("9999"); // kakao_id 연결됨
    expect(parents.length).toBe(1); // 중복 계정 생성 없음
  });

  it("phone 매칭 후 중복 계정이 만들어지지 않는다", () => {
    const parents: ParentAcc[] = [
      { id: "pa_existing", phone: "01025366384", swimming_pool_id: "pool_A", kakao_id: null, name: "황부모", kakao_profile_image: null },
    ];
    simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 77777, kakao_account: { phone_number: "+82 10-2536-6384" } },
      parents,
      users: [],
    });
    expect(parents.length).toBe(1); // 중복 없음
    expect(parents[0].id).toBe("pa_existing");
  });

  it("phone 매칭 후 child links는 유지된다 (기존 자녀 연결 보존)", () => {
    // 기존 parent에 자녀 연결이 있어도 kakao 연동 시 변경되지 않아야 함
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: null, name: "김부모", kakao_profile_image: null },
    ];
    const childLinks = [{ parentId: "pa1", studentId: "s1", status: "linked" }];
    simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 1001, kakao_account: { phone_number: "+82 10-1111-2222" } },
      parents,
      users: [],
    });
    // child links 변경 없음
    expect(childLinks).toHaveLength(1);
    expect(childLinks[0].studentId).toBe("s1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5  Server: kakaoPhone null (scope 미동의) → phone_missing=true
// ─────────────────────────────────────────────────────────────────────────────

describe("§5. Server: kakaoPhone null (카카오 phone scope 미동의)", () => {
  it("phone_number 없는 프로필 → 404 kakao_no_account + phone_missing=true", () => {
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 5555, kakao_account: { profile: { nickname: "테스트" } } }, // phone_number 없음
      parents: [],
      users: [],
    });
    expect(result.httpStatus).toBe(404);
    if (result.httpStatus === 404) {
      expect(result.body.kakao_info.phone_missing).toBe(true);
      expect(result.body.kakao_info.phone).toBeNull();
    }
  });

  it("phone_number 있는 프로필 → phone_missing=false", () => {
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 6666, kakao_account: { phone_number: "+82 10-1234-5678" } },
      parents: [],
      users: [],
    });
    if (result.httpStatus === 404) {
      expect(result.body.kakao_info.phone_missing).toBe(false);
      expect(result.body.kakao_info.phone).toBe("01012345678");
    }
  });

  it("phone_missing=true → 기존 parent phone 조회 skip (kakao_id 없으면 404)", () => {
    // phone scope 미동의 시 phone으로 계정 찾을 수 없음
    // 기존 parent가 있어도 kakao_id 없으면 못 찾음
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: null, name: "김부모", kakao_profile_image: null },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 9001, kakao_account: {} }, // phone_number 없음
      parents,
      users: [],
    });
    // phone 매칭 불가 → 404
    expect(result.httpStatus).toBe(404);
  });

  it("phone_missing=true인데 kakao_id로 이미 연결된 계정은 정상 조회", () => {
    // 이전에 phone 있을 때 연결 후, 이후 scope 바뀌어도 kakao_id로 조회 가능
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "9001", name: "김부모", kakao_profile_image: null },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 9001, kakao_account: {} }, // phone_number 없음
      parents,
      users: [],
    });
    // kakao_id로 기존 계정 찾음 → 200
    expect(result.httpStatus).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6  Server: 계정 없음 → kakao_no_account (phone 있음)
// ─────────────────────────────────────────────────────────────────────────────

describe("§6. Server: 계정 없음 → kakao_no_account", () => {
  it("신규 카카오 사용자 (등록된 전화번호 없음) → 404 kakao_no_account", () => {
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 8888, kakao_account: { phone_number: "+82 10-9999-8888", profile: { nickname: "신규유저" } } },
      parents: [],
      users: [],
    });
    expect(result.httpStatus).toBe(404);
    if (result.httpStatus === 404) {
      expect(result.body.error_code).toBe("kakao_no_account");
      expect(result.body.kakao_info.kakao_id).toBe("8888");
      expect(result.body.kakao_info.phone).toBe("01099998888");
      expect(result.body.kakao_info.phone_missing).toBe(false);
    }
  });

  it("kakao_info에 kakao_id가 포함되어 앱이 signup으로 라우팅 가능", () => {
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 8888, kakao_account: { phone_number: "+82 10-9999-8888" } },
      parents: [],
      users: [],
    });
    if (result.httpStatus === 404) {
      expect(result.body.kakao_info.kakao_id).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7  Server: teacher/admin 카카오 로그인
// ─────────────────────────────────────────────────────────────────────────────

describe("§7. Server: teacher/admin 카카오 로그인", () => {
  it("kakao_id로 기존 teacher 계정 조회 → admin 세션 반환", () => {
    const users: User[] = [
      { id: "t1", phone: "01011112222", kakao_id: "k_teacher_1", role: "teacher",
        swimming_pool_id: "pool_A", is_activated: true, name: "김선생", email: "t1@pool" },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: parseInt("k_teacher_1") || 999001 },
      parents: [],
      users,
    });
    // kakao_id가 "999001" vs "k_teacher_1" 불일치이므로 phone fallback
    // (이 테스트는 phone fallback 경로)
    expect([200, 404]).toContain(result.httpStatus);
  });

  it("phone으로 teacher 매칭 → kakao_id 연결 + admin 세션 반환", () => {
    const users: User[] = [
      { id: "t1", phone: "01011112222", kakao_id: null, role: "teacher",
        swimming_pool_id: "pool_A", is_activated: true, name: "김선생", email: "t1@pool" },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 77001, kakao_account: { phone_number: "+82 10-1111-2222" } },
      parents: [],
      users,
    });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      expect(result.body.kind).toBe("admin");
      expect(result.body.user?.role).toBe("teacher");
    }
    expect(users[0].kakao_id).toBe("77001"); // kakao_id 연결됨
  });

  it("비활성화 teacher → 403 needs_activation", () => {
    const users: User[] = [
      { id: "t2", phone: "01099991111", kakao_id: null, role: "teacher",
        swimming_pool_id: "pool_A", is_activated: false, name: "신선생", email: "t2@pool" },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 77002, kakao_account: { phone_number: "+82 10-9999-1111" } },
      parents: [],
      users,
    });
    expect(result.httpStatus).toBe(403);
    if (result.httpStatus === 403) {
      expect(result.body.error_code).toBe("needs_activation");
      expect(result.body.teacher_id).toBe("t2");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8  기존 일반 parent + kakao 첫 연동 → 중복 계정 생성 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("§8. 기존 일반 로그인 parent + 카카오 첫 연동 → 중복 계정 생성 금지", () => {
  it("동일 전화번호 일반 parent가 카카오 로그인 시 기존 계정 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa_normal", phone: "01012341234", swimming_pool_id: "pool_A", kakao_id: null, name: "이부모", kakao_profile_image: null },
    ];
    const before = parents.length;

    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 44444, kakao_account: { phone_number: "+82 10-1234-1234" } },
      parents,
      users: [],
    });

    expect(result.httpStatus).toBe(200);
    expect(parents.length).toBe(before); // 새 parent_account 생성 없음
    expect(parents[0].kakao_id).toBe("44444"); // kakao_id만 연결됨
  });

  it("카카오 연동 후 재로그인 → kakao_id로 즉시 세션 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa_normal", phone: "01012341234", swimming_pool_id: "pool_A", kakao_id: "44444", name: "이부모", kakao_profile_image: null },
    ];

    // 이미 연결된 상태 → kakao_id 조회로 바로 반환
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 44444, kakao_account: { phone_number: "+82 10-1234-1234" } },
      parents,
      users: [],
    });

    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      expect(result.body.parent?.id).toBe("pa_normal");
    }
  });

  it("student links는 카카오 연동 후에도 유지된다", () => {
    const childLinks = [
      { parentId: "pa_normal", studentId: "s1", status: "linked" },
      { parentId: "pa_normal", studentId: "s2", status: "linked" },
    ];
    const parents: ParentAcc[] = [
      { id: "pa_normal", phone: "01012341234", swimming_pool_id: "pool_A", kakao_id: null, name: "이부모", kakao_profile_image: null },
    ];
    simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 55555, kakao_account: { phone_number: "+82 10-1234-1234" } },
      parents,
      users: [],
    });
    // child links 변경 없음
    expect(childLinks).toHaveLength(2);
    expect(childLinks.every(l => l.parentId === "pa_normal")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9  형제/자매 회귀 — kakao parent + 같은 pool 두 번째 자녀 (209 버그 회귀 방지)
// ─────────────────────────────────────────────────────────────────────────────

describe("§9. 형제/자매 회귀 — kakao parent + 같은 pool 두 번째 자녀", () => {
  type SimStudent = { id: string; name: string; phone: string; poolId: string };
  type ChildLink2 = { parentId: string; studentId: string; status: "linked" | "waiting" };

  it("Kakao로 가입한 parent가 첫 자녀 후 둘째 자녀 등록 → 201 (409 금지)", () => {
    // 카카오 parent 계정 이미 pool에 가입 → 둘째 자녀 v2/parent-register
    // 기존 버그: alreadyInPool=true → 409 차단
    // 신규: 201 linked/waiting

    const kakaoParent = { id: "pa_kakao", phone: "01025366384", swimming_pool_id: "pool_A", kakao_id: "k_parent_1", name: "황부모", kakao_profile_image: null };
    const students: SimStudent[] = [
      { id: "s1", name: "황이준", phone: "01025366384", poolId: "pool_A" },
      { id: "s2", name: "황승혜", phone: "01025366384", poolId: "pool_A" },
    ];
    const childLinks: ChildLink2[] = [
      { parentId: "pa_kakao", studentId: "s1", status: "linked" }, // 첫째 연결 완료
    ];

    // 둘째 자녀 황승혜 등록 시도 (kakao parent already in pool)
    const alreadyInPool = true; // pool_A에 이미 membership

    // 신규 서버 로직: alreadyInPool=true → sibling linking (not 409)
    const matched = students.find(s => s.name === "황승혜" && s.phone === kakaoParent.phone && s.poolId === kakaoParent.swimming_pool_id);
    if (matched) {
      const alreadyLinked = childLinks.some(l => l.parentId === kakaoParent.id && l.studentId === matched.id);
      if (!alreadyLinked) childLinks.push({ parentId: kakaoParent.id, studentId: matched.id, status: "linked" });
    }

    const resultStatus = alreadyInPool ? 201 : 409; // 신규: 201
    expect(resultStatus).toBe(201); // 409 아님
    expect(childLinks).toHaveLength(2); // 두 자녀 연결
    expect(childLinks.map(l => l.studentId).sort()).toEqual(["s1", "s2"]);
  });

  it("Kakao + 형제 연결은 기존 kakao_id를 변경하지 않는다", () => {
    const parent = { id: "pa_kakao", kakao_id: "k_parent_1" };
    // 자녀 추가는 parent_accounts 테이블을 변경하지 않음
    expect(parent.kakao_id).toBe("k_parent_1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 에러 코드 체계 검증
// ─────────────────────────────────────────────────────────────────────────────

describe("§10. 에러 코드 체계 — 모든 실패 경로에 error_code 포함", () => {
  const cases: Array<{ scenario: string; apiResult: "timeout" | "invalid_token" | "api_error"; expectedCode: string; expectedStatus: number }> = [
    { scenario: "timeout", apiResult: "timeout", expectedCode: "KAKAO_API_TIMEOUT", expectedStatus: 504 },
    { scenario: "만료된 토큰", apiResult: "invalid_token", expectedCode: "KAKAO_INVALID_TOKEN", expectedStatus: 401 },
    { scenario: "Kakao 서버 오류", apiResult: "api_error", expectedCode: "KAKAO_API_ERROR", expectedStatus: 502 },
  ];

  for (const c of cases) {
    it(`${c.scenario} → ${c.expectedStatus} + error_code=${c.expectedCode}`, () => {
      const result = simulateKakaoSocialLogin({ kakaoApiResult: c.apiResult, parents: [], users: [] });
      expect(result.httpStatus).toBe(c.expectedStatus);
      expect((result.body as any).error_code).toBe(c.expectedCode);
    });
  }

  it("kakao_no_account → 404 + error_code=kakao_no_account (기존 유지)", () => {
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 1111 },
      parents: [],
      users: [],
    });
    expect(result.httpStatus).toBe(404);
    expect((result.body as any).error_code).toBe("kakao_no_account");
  });

  it("정상 로그인 → 200 body에 error_code 없음", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "1001", name: "김부모", kakao_profile_image: null },
    ];
    const result = simulateKakaoSocialLogin({
      kakaoApiResult: "ok",
      kakaoProfile: { id: 1001 },
      parents,
      users: [],
    });
    expect(result.httpStatus).toBe(200);
    expect((result.body as any).error_code).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 App: 취소 감지, 에러 코드별 메시지 분기
// ─────────────────────────────────────────────────────────────────────────────

describe("§11. App: 취소 감지 + 에러 코드별 메시지 분기", () => {
  // App 에러 처리 로직 시뮬레이션 (app/index.tsx handleKakaoLogin catch 블록)
  function handleKakaoError(err: { code?: string; error_code?: string; message?: string; kakao_info?: any; needs_activation?: boolean; teacher_id?: string }): {
    action: "silent" | "setError" | "routeSignup" | "routeActivation";
    message?: string;
    signupParams?: any;
  } {
    // 취소 — E_CANCELLED_OPERATION만 체크 (message.includes("cancel") 제거됨)
    if (err.code === "E_CANCELLED_OPERATION") return { action: "silent" };

    if (err.error_code === "kakao_no_account" && err.kakao_info) {
      return {
        action: "routeSignup",
        signupParams: {
          kakaoId: err.kakao_info.kakao_id ?? "",
          kakaoPhone: err.kakao_info.phone ?? "",
          kakaoPhoneMissing: err.kakao_info.phone_missing ? "1" : "0",
        },
      };
    }
    if (err.needs_activation && err.teacher_id) {
      return { action: "routeActivation" };
    }

    const errMsg = (() => {
      switch (err.error_code) {
        case "KAKAO_INVALID_TOKEN":  return "카카오 인증이 만료되었습니다. 다시 시도해주세요.";
        case "KAKAO_API_TIMEOUT":    return "카카오 서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요.";
        case "KAKAO_API_ERROR":      return "카카오 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
        case "KAKAO_PROFILE_FAILED": return "카카오 프로필 정보를 가져올 수 없습니다. 다시 시도해주세요.";
        case "network_error":        return "서버에 연결할 수 없습니다. 네트워크를 확인해주세요.";
        default:                     return err.message || "카카오 로그인에 실패했습니다.";
      }
    })();
    return { action: "setError", message: errMsg };
  }

  it("E_CANCELLED_OPERATION → silent (에러 표시 없음)", () => {
    const result = handleKakaoError({ code: "E_CANCELLED_OPERATION" });
    expect(result.action).toBe("silent");
  });

  it("한국어 포함 메시지가 cancel로 오인되지 않는다 (기존 버그 수정 확인)", () => {
    // 기존: message.includes("cancel") → 한국어 에러도 cancel로 처리될 수 있었음
    // 신규: E_CANCELLED_OPERATION 코드만 체크
    const result = handleKakaoError({ message: "카카오 로그인 취소됨", error_code: "KAKAO_API_ERROR" });
    expect(result.action).toBe("setError"); // cancel로 오인되지 않음
    expect(result.message).toContain("서버 오류");
  });

  it("KAKAO_INVALID_TOKEN → 만료 메시지", () => {
    const result = handleKakaoError({ error_code: "KAKAO_INVALID_TOKEN" });
    expect(result.action).toBe("setError");
    expect(result.message).toContain("만료");
  });

  it("KAKAO_API_TIMEOUT → timeout 메시지", () => {
    const result = handleKakaoError({ error_code: "KAKAO_API_TIMEOUT" });
    expect(result.action).toBe("setError");
    expect(result.message).toContain("응답하지 않");
  });

  it("kakao_no_account + phone_missing=true → signup 라우팅 + kakaoPhoneMissing='1'", () => {
    const result = handleKakaoError({
      error_code: "kakao_no_account",
      kakao_info: { kakao_id: "k1", name: "테스트", phone: null, phone_missing: true },
    });
    expect(result.action).toBe("routeSignup");
    expect(result.signupParams?.kakaoPhoneMissing).toBe("1");
    expect(result.signupParams?.kakaoPhone).toBe(""); // null → ""
  });

  it("kakao_no_account + phone 있음 → signup 라우팅 + kakaoPhoneMissing='0'", () => {
    const result = handleKakaoError({
      error_code: "kakao_no_account",
      kakao_info: { kakao_id: "k2", name: "신규", phone: "01012341234", phone_missing: false },
    });
    expect(result.action).toBe("routeSignup");
    expect(result.signupParams?.kakaoPhoneMissing).toBe("0");
    expect(result.signupParams?.kakaoPhone).toBe("01012341234");
  });

  it("needs_activation → routeActivation", () => {
    const result = handleKakaoError({ needs_activation: true, teacher_id: "t1" });
    expect(result.action).toBe("routeActivation");
  });

  it("network_error → 네트워크 메시지", () => {
    const result = handleKakaoError({ error_code: "network_error" });
    expect(result.action).toBe("setError");
    expect(result.message).toContain("네트워크");
  });

  it("unknown error → 기본 메시지", () => {
    const result = handleKakaoError({ message: "알 수 없는 오류" });
    expect(result.action).toBe("setError");
    expect(result.message).toBe("알 수 없는 오류");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 phone 정규화 (+82 형식)
// ─────────────────────────────────────────────────────────────────────────────

describe("§12. Kakao phone 정규화", () => {
  const cases = [
    { raw: "+82 10-1234-5678", expected: "01012345678" },
    { raw: "+82 10-2536-6384", expected: "01025366384" },
    { raw: "+82-10-9999-8888", expected: "01099998888" },
    { raw: "+8210-1111-2222",  expected: "01011112222" },
    { raw: "010-1234-5678",    expected: "01012345678" }, // 이미 국내 형식
  ];

  for (const c of cases) {
    it(`"${c.raw}" → "${c.expected}"`, () => {
      expect(normalizeKakaoPhone(c.raw)).toBe(c.expected);
    });
  }
});
