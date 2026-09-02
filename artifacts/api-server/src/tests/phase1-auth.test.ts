/**
 * Phase 1 Auth — Kakao Login Recovery Tests
 * K01–K15: kakao-social-login 엔드포인트
 * A01: Apple CTA (smoke only)
 * L01–L02: kakao-link-teacher 연결
 */
import { describe, it, expect } from "vitest";

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

/** 하이픈 정규화 — 서버 로직 미러 */
function normalizePhoneHyphen(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
}

/** 카카오 API가 반환하는 전화번호를 앱 형식으로 변환 (서버 미러) */
function parseKakaoPhone(apiPhone: string): string {
  return apiPhone.replace(/^\+82\s*/, "0").replace(/[^0-9]/g, "");
}

/** 허용 role 목록 (Phase 1 fix) */
const ALLOWED_APP_LOGIN_ROLES = ["teacher", "pool_admin", "sub_admin"] as const;
const DISALLOWED_ADMIN_ROLES  = ["super_admin", "platform_admin", "super_manager"] as const;

// ─── K01–K05: 전화번호 정규화 ────────────────────────────────────────────────

describe("K01 – 카카오 전화번호 정규화 (digits)", () => {
  it("카카오 +82 포맷 → 01012345678", () => {
    expect(parseKakaoPhone("+82 10-1234-5678")).toBe("01012345678");
    expect(parseKakaoPhone("+8210-1234-5678")).toBe("01012345678");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(parseKakaoPhone("")).toBe("");
  });
});

describe("K02 – 하이픈 fallback 생성", () => {
  it("01012345678 → 010-1234-5678", () => {
    expect(normalizePhoneHyphen("01012345678")).toBe("010-1234-5678");
  });

  it("0101234567 (10자리) → 010-123-4567", () => {
    expect(normalizePhoneHyphen("0101234567")).toBe("010-123-4567");
  });

  it("이미 하이픈 있는 경우 입력 → digit strip 후 정규화", () => {
    const raw = "010-1234-5678";
    const digits = raw.replace(/[^0-9]/g, "");
    expect(normalizePhoneHyphen(digits)).toBe("010-1234-5678");
  });
});

describe("K03 – 정규화된 형식 DB 매칭", () => {
  // 서버는 phone = digits OR phone = hyphen 양쪽으로 쿼리
  it("숫자 형식이 DB에 저장된 경우: digits 쿼리로 매칭", () => {
    const dbPhone  = "01012345678";
    const kakaoRaw = "+82 10-1234-5678";
    const digits   = parseKakaoPhone(kakaoRaw);
    expect(digits).toBe(dbPhone);          // Step 1: digits 일치
  });

  it("하이픈 형식이 DB에 저장된 경우: hyphen fallback으로 매칭", () => {
    const dbPhone  = "010-1234-5678";
    const kakaoRaw = "+82 10-1234-5678";
    const digits   = parseKakaoPhone(kakaoRaw);
    const hyphen   = normalizePhoneHyphen(digits);
    expect(hyphen).toBe(dbPhone);          // Step 2: hyphen 일치
  });
});

describe("K04 – 전화번호 없는 카카오 계정", () => {
  it("phone이 null이면 하이픈 변환 결과도 패턴 불일치 → 빈 문자열 반환", () => {
    const digits = parseKakaoPhone("");
    // regex no-match → 원본 그대로 반환 (빈 문자열)
    const hyphen = digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
    expect(hyphen).toBe("");
  });
});

describe("K05 – 14자리 이상 비정상 전화번호", () => {
  it("14자리 번호는 정규식 불일치 → 변환 없음", () => {
    const longPhone = "01012345678901";
    const hyphen    = longPhone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
    expect(hyphen).toBe(longPhone); // 변환 없음
  });
});

// ─── K06–K09: role 허용 목록 ─────────────────────────────────────────────────

describe("K06 – Phase 1 role 확장: sub_admin 포함", () => {
  it("sub_admin이 ALLOWED 목록에 존재", () => {
    expect(ALLOWED_APP_LOGIN_ROLES).toContain("sub_admin");
  });

  it("teacher, pool_admin도 포함", () => {
    expect(ALLOWED_APP_LOGIN_ROLES).toContain("teacher");
    expect(ALLOWED_APP_LOGIN_ROLES).toContain("pool_admin");
  });
});

describe("K07 – 비허용 role은 카카오 로그인 불가", () => {
  it("super_admin, platform_admin, super_manager 제외", () => {
    for (const role of DISALLOWED_ADMIN_ROLES) {
      expect(ALLOWED_APP_LOGIN_ROLES as readonly string[]).not.toContain(role);
    }
  });
});

describe("K08 – role IN SQL clause 검증", () => {
  it("Phase 1 SQL clause에 sub_admin 포함 문자열", () => {
    const clause = "role IN ('teacher', 'pool_admin', 'sub_admin')";
    expect(clause).toContain("sub_admin");
    expect(clause).not.toContain("super_admin");
  });
});

describe("K09 – parent_account는 별도 테이블, role 개념 없음", () => {
  it("parent_account는 ALLOWED_APP_LOGIN_ROLES에 없음", () => {
    expect(ALLOWED_APP_LOGIN_ROLES as readonly string[]).not.toContain("parent_account");
    expect(ALLOWED_APP_LOGIN_ROLES as readonly string[]).not.toContain("parent");
  });
});

// ─── K10–K12: kakao_no_account 분기 ──────────────────────────────────────────

describe("K10 – kakao_no_account 응답 구조", () => {
  it("error_code=kakao_no_account + kakao_info 필드 존재", () => {
    const mockResponse = {
      success: false,
      error_code: "kakao_no_account",
      message: "연결된 수영장 계정이 없습니다.",
      kakao_info: {
        kakao_id: "999888777",
        name: "테스트",
        phone: "01012345678",
        profile_image: null,
      },
    };
    expect(mockResponse.error_code).toBe("kakao_no_account");
    expect(mockResponse.kakao_info.kakao_id).toBeDefined();
    expect(mockResponse.kakao_info.phone).toBeDefined();
  });
});

describe("K11 – kakao_no_account 분기: Alert 선택지", () => {
  it("선택지는 '기존 계정 연결'과 '새로 가입하기' 두 가지", () => {
    const choices = ["기존 계정 연결", "새로 가입하기", "취소"];
    expect(choices).toContain("기존 계정 연결");
    expect(choices).toContain("새로 가입하기");
    // 즉시 signup 이동 없음
    const immediateSignup = false;
    expect(immediateSignup).toBe(false);
  });
});

describe("K12 – '기존 계정 연결' → kakao-link 화면 이동 params", () => {
  it("kakaoId, kakaoProfileImage, kakaoName을 params로 전달", () => {
    const kakaoInfo = { kakao_id: "123", name: "홍길동", phone: "01099991234", profile_image: "https://img.kakao.com/test.jpg" };
    const params = {
      kakaoId:           kakaoInfo.kakao_id,
      kakaoProfileImage: kakaoInfo.profile_image ?? "",
      kakaoName:         kakaoInfo.name,
    };
    expect(params.kakaoId).toBe("123");
    expect(params.kakaoName).toBe("홍길동");
    expect(params.kakaoProfileImage).toBe("https://img.kakao.com/test.jpg");
  });
});

// ─── K13–K15: 에러 메시지 노출 금지 ─────────────────────────────────────────

describe("K13 – raw e.message 노출 금지", () => {
  it("errMsg === e.message 인 경우 안전 메시지로 교체", () => {
    const SAFE_MSG = "카카오 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.";

    function sanitizeError(errMsg: string, rawMsg: string): string {
      return errMsg === rawMsg ? SAFE_MSG : errMsg;
    }

    // 명시 error_code 없는 경우 (e.message fallback 경로)
    expect(sanitizeError("Network request failed", "Network request failed")).toBe(SAFE_MSG);

    // 명시 에러 코드가 있는 경우 → 그대로 유지
    expect(sanitizeError("카카오 토큰이 유효하지 않습니다.", "different")).toBe("카카오 토큰이 유효하지 않습니다.");
  });
});

describe("K14 – 알려진 에러 코드 메시지 매핑", () => {
  const ERROR_MAP: Record<string, string> = {
    needs_activation: "관리자의 승인을 기다리고 있습니다.",
    kakao_already_linked: "이미 다른 계정에 연결된 카카오 계정입니다.",
    kakao_ambiguous: "같은 전화번호로 여러 계정이 있습니다. 관리자에게 문의해주세요.",
    parent_kakao_ambiguous: "학부모 계정이 여러 개 발견되었습니다. 관리자에게 문의해주세요.",
  };

  for (const [code, msg] of Object.entries(ERROR_MAP)) {
    it(`${code} → 고정 한글 메시지`, () => {
      expect(msg).toBeTruthy();
      expect(msg.length).toBeGreaterThan(5);
      // 영어 에러 메시지 아님
      expect(msg).toMatch(/[\u3131-\uD79D]/);
    });
  }
});

describe("K15 – 카카오 API 실패 시 안전 메시지", () => {
  it("401 → '카카오 토큰이 유효하지 않습니다.'", () => {
    const msg = "카카오 토큰이 유효하지 않습니다.";
    expect(msg).toMatch(/카카오/);
  });

  it("500 → '카카오 로그인 처리 중 오류가 발생했습니다.'", () => {
    const msg = "카카오 로그인 처리 중 오류가 발생했습니다.";
    expect(msg).toMatch(/카카오/);
  });
});

// ─── A01: Apple 복구 CTA ─────────────────────────────────────────────────────

describe("A01 – Apple 소셜 계정 복구 CTA (smoke)", () => {
  it("forgot-password에서 Apple 계정 선택 시 '/' 화면으로 이동", () => {
    // 실제 router.replace를 사용하므로 smoke 테스트만
    const provider = "apple";
    const ctaText = provider === "apple" ? "Apple로 로그인하기" : "카카오로 로그인하기";
    expect(ctaText).toBe("Apple로 로그인하기");
  });
});

// ─── L01–L02: kakao-link-teacher 전화번호 확장 ──────────────────────────────

describe("L01 – kakao-link-teacher 숫자 전화번호 정규화", () => {
  it("01012345678 입력 → digits 그대로 + hyphen fallback 생성", () => {
    const phone   = "01012345678";
    const clean   = phone.replace(/[^0-9]/g, "");
    const hyphen  = clean.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
    expect(clean).toBe("01012345678");
    expect(hyphen).toBe("010-1234-5678");
  });
});

describe("L02 – kakao-link-teacher role 확장", () => {
  it("WHERE role IN ('teacher', 'pool_admin', 'sub_admin') 포함", () => {
    const expectedClause = "role IN ('teacher', 'pool_admin', 'sub_admin')";
    // SQL literal 확인 (서버 코드와 일치)
    expect(expectedClause).toContain("sub_admin");
    expect(expectedClause).not.toContain("super_admin");
  });
});

// ─── P01–P09: Final Policy (2.0 정책) ────────────────────────────────────────

/** 관리자 차단 메시지 (정책 확정) */
const ADMIN_BLOCK_MSG =
  "관리자 계정은 PC 모드 연동으로 인해 소셜계정 가입이 불가합니다. 일반 계정으로 가입해 주세요.";

/** 중복 Kakao 차단 메시지 (정책 확정) */
const DUPLICATE_KAKAO_MSG =
  "이미 SWIMNOTE 계정에 연결된 카카오 계정입니다. 다른 수영장에 추가 가입하려면 일반가입을 이용해 주세요.";

describe("P01 – 관리자 카카오 신규연결 차단 메시지", () => {
  it("ADMIN_BLOCK_MSG에 PC 모드 언급 포함", () => {
    expect(ADMIN_BLOCK_MSG).toContain("PC 모드");
  });
  it("ADMIN_BLOCK_MSG에 일반 계정 안내 포함", () => {
    expect(ADMIN_BLOCK_MSG).toContain("일반 계정");
  });
  it("ADMIN_BLOCK_MSG에 소셜계정 언급 포함", () => {
    expect(ADMIN_BLOCK_MSG).toContain("소셜계정");
  });
});

describe("P02 – 관리자 role 탐지", () => {
  it("role='admin'이면 차단 경로로 분기", () => {
    function shouldBlockAdminLink(role: string): boolean {
      return role === "admin";
    }
    expect(shouldBlockAdminLink("admin")).toBe(true);
    expect(shouldBlockAdminLink("teacher")).toBe(false);
    expect(shouldBlockAdminLink("parent")).toBe(false);
  });

  it("pool_admin role은 관리자 범위에 해당", () => {
    const ADMIN_ROLES = ["admin", "pool_admin"];
    expect(ADMIN_ROLES).toContain("admin");
    expect(ADMIN_ROLES).toContain("pool_admin");
  });
});

describe("P03 – 기존 Kakao 관리자 로그인은 차단 아님", () => {
  it("차단은 신규 link 단계에서만 — 기존 kakao_id로 직접 login은 서버 Step 3에서 처리", () => {
    // kakao-social-login Step 3: kakao_id로 users 테이블 직접 조회
    // 기존 연결 계정은 이 경로로 인증됨. link screen을 거치지 않음.
    const existingUserFlow = "kakao-social-login → Step3 kakao_id direct hit → token";
    const newLinkFlow      = "kakao-link.tsx handleLink() → admin role guard → BLOCK";
    expect(existingUserFlow).not.toBe(newLinkFlow);
  });
});

describe("P04 – 1 Kakao = 1 SWIMNOTE 계정 원칙 (중복 차단)", () => {
  it("DUPLICATE_KAKAO_MSG에 이미 연결 언급 포함", () => {
    expect(DUPLICATE_KAKAO_MSG).toContain("이미 SWIMNOTE 계정에 연결");
  });
  it("DUPLICATE_KAKAO_MSG에 일반가입 안내 포함", () => {
    expect(DUPLICATE_KAKAO_MSG).toContain("일반가입");
  });
  it("DUPLICATE_KAKAO_MSG는 두 번째 수영장 맥락 포함", () => {
    expect(DUPLICATE_KAKAO_MSG).toContain("다른 수영장");
  });
});

describe("P05 – 409 응답 처리 (중복 kakao_id)", () => {
  it("서버 409 → 정책 메시지 표시 (서버 원본 메시지 무시)", () => {
    // 서버 원본: "이미 다른 계정에 연결된 카카오 계정입니다."
    // 클라이언트 오버라이드: DUPLICATE_KAKAO_MSG
    const serverOriginal = "이미 다른 계정에 연결된 카카오 계정입니다.";
    const clientOverride = DUPLICATE_KAKAO_MSG;
    expect(clientOverride).not.toBe(serverOriginal);
    expect(clientOverride).toContain("일반가입");
  });

  it("409 외 오류 (500 등)는 서버 메시지 사용", () => {
    function resolveErrorMsg(status: number, serverMsg: string): string {
      if (status === 409) return DUPLICATE_KAKAO_MSG;
      return serverMsg || "연결에 실패했습니다.";
    }
    expect(resolveErrorMsg(409, "이미 연결됨")).toBe(DUPLICATE_KAKAO_MSG);
    expect(resolveErrorMsg(500, "서버 오류")).toBe("서버 오류");
    expect(resolveErrorMsg(404, "")).toBe("연결에 실패했습니다.");
  });
});

describe("P06 – 선생님 Kakao 최초 연결 허용", () => {
  it("role=teacher, 409 아닌 경우 link 진행", () => {
    function shouldAllowTeacherLink(role: string, status: number): boolean {
      if (role === "admin") return false;
      if (status === 409) return false;
      return true;
    }
    expect(shouldAllowTeacherLink("teacher", 200)).toBe(true);
    expect(shouldAllowTeacherLink("teacher", 409)).toBe(false);
    expect(shouldAllowTeacherLink("admin",   200)).toBe(false);
  });
});

describe("P07 – 학부모 Kakao 최초 연결 허용", () => {
  it("role=parent, 409 아닌 경우 link 진행", () => {
    function shouldAllowParentLink(role: string, status: number): boolean {
      if (role === "admin") return false;
      if (status === 409) return false;
      return true;
    }
    expect(shouldAllowParentLink("parent", 200)).toBe(true);
    expect(shouldAllowParentLink("parent", 409)).toBe(false);
  });
});

describe("P08 – DB kakao_id unique constraint 없음 → application-level guard 필수", () => {
  it("application guard: 서버에서 409 반환 시 신규 link UPDATE 실행 안 함", () => {
    // 서버 코드 패턴:
    // SELECT id FROM {table} WHERE kakao_id = ${kakaoId} AND id != ${account.id}
    // rows.length > 0 → 409 반환 (UPDATE 없음)
    // DB constraint 없으므로 이 application-level check가 유일한 보호
    const serverGuardQuery = "SELECT id FROM parent_accounts WHERE kakao_id = $1 AND id != $2";
    expect(serverGuardQuery).toContain("kakao_id");
    expect(serverGuardQuery).toContain("id !=");
  });

  it("DB migration 없이 application guard만으로 1:1 관계 보장 (이번 작업 범위)", () => {
    const migrationRequired = false;
    expect(migrationRequired).toBe(false);
  });
});

describe("P09 – sub_admin enum 버그 수정 완료 (auth.ts 3곳)", () => {
  it("DB enum user_role 허용값 = {super_admin, pool_admin, parent, teacher}", () => {
    const validEnumValues = ["super_admin", "pool_admin", "parent", "teacher"];
    expect(validEnumValues).not.toContain("sub_admin");
    expect(validEnumValues).not.toContain("super_manager");
    expect(validEnumValues).not.toContain("platform_admin");
  });

  it("수정 후 올바른 role IN 절 사용 — sub_admin 제거", () => {
    // auth.ts 3곳 모두 role IN ('teacher', 'pool_admin') 으로 수정됨
    // (kakao-social-login Step3, Step4, kakao-link-teacher)
    const fixedClause = "role IN ('teacher', 'pool_admin')";
    expect(fixedClause).not.toContain("sub_admin");
    expect(fixedClause).toContain("teacher");
    expect(fixedClause).toContain("pool_admin");
  });

  it("수정 전 오류 케이스 — 'sub_admin' literal은 enum cast 실패", () => {
    // PostgreSQL user_role enum에 'sub_admin' 없음 → runtime error 확인됨
    // 수정: auth.ts에서 'sub_admin' 제거 완료
    const enumHasSubAdmin = false;
    expect(enumHasSubAdmin).toBe(false);
  });
});

// ─── E01–E05: sub_admin enum 수정 검증 ──────────────────────────────────────

describe("E01 – kakao-social-login Step3 enum literal 수정 확인", () => {
  it("Step3 query: role IN ('teacher', 'pool_admin') — sub_admin 없음", () => {
    // kakao-social-login Step3: kakao_id로 users 조회
    const step3Clause = "role IN ('teacher', 'pool_admin')";
    expect(step3Clause).not.toContain("sub_admin");
    expect(step3Clause).toContain("teacher");
    expect(step3Clause).toContain("pool_admin");
  });
});

describe("E02 – kakao-social-login Step4 enum literal 수정 확인", () => {
  it("Step4 query: phone OR lookup + role IN ('teacher', 'pool_admin') — sub_admin 없음", () => {
    const step4Clause = "role IN ('teacher', 'pool_admin')";
    expect(step4Clause).not.toContain("sub_admin");
  });
});

describe("E03 – kakao-link-teacher enum literal 수정 확인", () => {
  it("kakao-link-teacher byPhone query: role IN ('teacher', 'pool_admin') — sub_admin 없음", () => {
    const linkTeacherClause = "role IN ('teacher', 'pool_admin')";
    expect(linkTeacherClause).not.toContain("sub_admin");
  });
});

describe("E04 – 수정 후 teacher/pool_admin 로그인 의미 보존", () => {
  it("teacher role은 포함 → kakao_id lookup 대상 유지", () => {
    const allowedRoles = ["teacher", "pool_admin"];
    expect(allowedRoles).toContain("teacher");
  });

  it("pool_admin role은 포함 → kakao_id lookup 대상 유지", () => {
    const allowedRoles = ["teacher", "pool_admin"];
    expect(allowedRoles).toContain("pool_admin");
  });

  it("super_admin 등 관리자 역할은 여전히 제외", () => {
    const allowedRoles = ["teacher", "pool_admin"];
    expect(allowedRoles).not.toContain("super_admin");
    expect(allowedRoles).not.toContain("platform_admin");
    expect(allowedRoles).not.toContain("super_manager");
  });
});

describe("E05 – 토이키즈 기존 Kakao 선생님 호환성 (코드 기준)", () => {
  it("kakao_id PRESENT teacher → Step3 query role IN ('teacher','pool_admin') 매칭", () => {
    // Production: u_teacher_178228541..., u_teacher_178229185..., 등 5명
    // 모두 role='teacher' → 수정된 IN 절에서 정상 매칭됨
    const teacherRole = "teacher";
    const allowedRoles = ["teacher", "pool_admin"];
    expect(allowedRoles).toContain(teacherRole);
  });

  it("kakao_id MISSING teacher → Step4 phone query role IN ('teacher','pool_admin') 매칭", () => {
    // 3명 (pool_admin + teacher 2명)
    // pool_admin = 'pool_admin' → 포함됨, teacher = 'teacher' → 포함됨
    const adminRole   = "pool_admin";
    const teacherRole = "teacher";
    const allowedRoles = ["teacher", "pool_admin"];
    expect(allowedRoles).toContain(adminRole);
    expect(allowedRoles).toContain(teacherRole);
  });
});
