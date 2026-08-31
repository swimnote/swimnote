/**
 * Kakao Social Login — Multi-Pool / Ambiguous Parent 추가 테스트
 *
 * 기존 44 TC (kakao-social-login.test.ts) 유지하고 아래 11개 케이스 추가:
 *
 * §M1  kakao_id exact match (빠른 경로, ambiguous 검사 없음)
 * §M2  phone single parent + no pool_id → 자동 연결 허용
 * §M3  phone multiple parents + no pool_id → KAKAO_PARENT_AMBIGUOUS (임의 LIMIT 1 금지)
 * §M4  phone multiple parents + pool_id → 정확한 pool parent 선택
 * §M5  same kakao_id → 다른 parent에 충돌 방지
 * §M6  phone_missing → manual phone 입력 → existing parent 연결 (pool_id 필수)
 * §M7  phone_missing → 신규 parent (no match)
 * §M8  existing parent + sibling second child (multi-pool fix 회귀 방지)
 * §M9  existing parent in two pools → ambiguous
 * §M10 1.6.3 legacy request compatibility (pool_id 없음)
 * §M11 2.0.0 pool_id request (pool_id 포함)
 */

import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

interface ParentAcc {
  id: string;
  phone: string;
  swimming_pool_id: string;
  kakao_id: string | null;
  name: string;
}

type LoginResult =
  | { httpStatus: 200; body: { token: string; parent?: { id: string; swimming_pool_id: string }; kind?: string } }
  | { httpStatus: 403; body: { error_code: "needs_activation" } }
  | { httpStatus: 404; body: { error_code: "kakao_no_account"; kakao_info: { phone_missing: boolean } } }
  | { httpStatus: 409; body: { error_code: "KAKAO_PARENT_AMBIGUOUS"; pools: { id: string; name: string }[] } };

// ─────────────────────────────────────────────────────────────────────────────
// 서버 로직 시뮬레이션 (수정 후: pool_id 인식 + ambiguous 처리)
// ─────────────────────────────────────────────────────────────────────────────

function sim(opts: {
  kakaoId: string;
  kakaoPhone: string | null;
  pool_id?: string;          // 요청에 pool_id 포함 여부 (2.0.0 = 있음, 1.6.3 = 없음)
  parents: ParentAcc[];
}): LoginResult {
  const { kakaoId, kakaoPhone, pool_id, parents } = opts;
  const phoneMissing = !kakaoPhone;
  const hasPoolId = !!pool_id;

  // 1) kakao_id exact match
  const exactKakao = parents.find(p => p.kakao_id === kakaoId);
  if (exactKakao) {
    return { httpStatus: 200, body: { token: `jwt_${exactKakao.id}`, parent: { id: exactKakao.id, swimming_pool_id: exactKakao.swimming_pool_id } } };
  }

  // 2) phone fallback
  if (kakaoPhone) {
    if (hasPoolId) {
      // 2-A) pool_id 있음 → phone + pool_id 정확 매칭
      const poolMatch = parents.find(p => p.phone === kakaoPhone && p.swimming_pool_id === pool_id);
      if (poolMatch) {
        poolMatch.kakao_id = kakaoId;
        return { httpStatus: 200, body: { token: `jwt_${poolMatch.id}`, parent: { id: poolMatch.id, swimming_pool_id: poolMatch.swimming_pool_id } } };
      }
      // pool_id로 지정한 pool에 계정 없음 → 신규 가입 유도
    } else {
      // 2-B) pool_id 없음 → count 기반
      const phoneMatches = parents.filter(p => p.phone === kakaoPhone);
      if (phoneMatches.length === 1) {
        phoneMatches[0].kakao_id = kakaoId;
        return { httpStatus: 200, body: { token: `jwt_${phoneMatches[0].id}`, parent: { id: phoneMatches[0].id, swimming_pool_id: phoneMatches[0].swimming_pool_id } } };
      }
      if (phoneMatches.length >= 2) {
        // 임의 LIMIT 1 선택 금지 → KAKAO_PARENT_AMBIGUOUS + pools[] 반환 (앱 재시도용)
        const pools = phoneMatches.map(p => ({ id: p.swimming_pool_id, name: `Pool_${p.swimming_pool_id}` }));
        return { httpStatus: 409, body: { error_code: "KAKAO_PARENT_AMBIGUOUS", pools } };
      }
    }
  }

  return { httpStatus: 404, body: { error_code: "kakao_no_account", kakao_info: { phone_missing: phoneMissing } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// §M1  kakao_id exact match
// ─────────────────────────────────────────────────────────────────────────────

describe("§M1. kakao_id exact match — 빠른 경로, 중복 여부와 무관", () => {
  it("kakao_id로 단일 매칭 → 200 즉시 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "k001", name: "A" },
    ];
    const result = sim({ kakaoId: "k001", kakaoPhone: "01011112222", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) expect(result.body.parent?.id).toBe("pa1");
  });

  it("kakao_id가 여러 pool 중 특정 account에 연결된 경우에도 정확히 그 계정 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "k001", name: "A" },
      { id: "pa2", phone: "01011112222", swimming_pool_id: "pool_B", kakao_id: null, name: "A_B" },
    ];
    // pa1에만 kakao_id 연결 → pa1 반환
    const result = sim({ kakaoId: "k001", kakaoPhone: "01011112222", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      expect(result.body.parent?.id).toBe("pa1");
      expect(result.body.parent?.swimming_pool_id).toBe("pool_A");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M2  phone single parent + no pool_id → 자동 연결 허용 (1.6.3 기존 동작 유지)
// ─────────────────────────────────────────────────────────────────────────────

describe("§M2. phone 1개 매칭 + pool_id 없음 → 자동 연결 (1.6.3 backward-compatible)", () => {
  it("phone 1개 → 자동 kakao_id 연결 + 200", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01022223333", swimming_pool_id: "pool_A", kakao_id: null, name: "B" },
    ];
    const result = sim({ kakaoId: "k002", kakaoPhone: "01022223333", parents });
    expect(result.httpStatus).toBe(200);
    expect(parents[0].kakao_id).toBe("k002"); // 자동 연결됨
  });

  it("자동 연결 후 재로그인 → kakao_id 경로로 즉시 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01022223333", swimming_pool_id: "pool_A", kakao_id: "k002", name: "B" },
    ];
    const result = sim({ kakaoId: "k002", kakaoPhone: "01022223333", parents });
    expect(result.httpStatus).toBe(200); // kakao_id exact match 경로
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M3  phone multiple parents + no pool_id → KAKAO_PARENT_AMBIGUOUS
// ─────────────────────────────────────────────────────────────────────────────

describe("§M3. phone 다수 매칭 + pool_id 없음 → KAKAO_PARENT_AMBIGUOUS (임의 LIMIT 1 금지)", () => {
  it("동일 phone + 2개 pool → 409 KAKAO_PARENT_AMBIGUOUS + pools[] 포함 (앱 재시도용)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01033334444", swimming_pool_id: "pool_A", kakao_id: null, name: "C" },
      { id: "pa2", phone: "01033334444", swimming_pool_id: "pool_B", kakao_id: null, name: "C" },
    ];
    const result = sim({ kakaoId: "k003", kakaoPhone: "01033334444", parents });
    expect(result.httpStatus).toBe(409);
    if (result.httpStatus === 409) {
      expect(result.body.error_code).toBe("KAKAO_PARENT_AMBIGUOUS");
      // 앱이 pool 선택 Alert 표시 후 overridePoolId로 재시도할 수 있도록 pools[] 포함
      expect(Array.isArray(result.body.pools)).toBe(true);
      expect(result.body.pools.length).toBe(2);
      expect(result.body.pools.map(p => p.id)).toContain("pool_A");
      expect(result.body.pools.map(p => p.id)).toContain("pool_B");
    }
  });

  it("ambiguous 시 어느 parent에도 kakao_id가 연결되지 않는다 (잘못된 연결 금지)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01033334444", swimming_pool_id: "pool_A", kakao_id: null, name: "C" },
      { id: "pa2", phone: "01033334444", swimming_pool_id: "pool_B", kakao_id: null, name: "C" },
    ];
    sim({ kakaoId: "k003", kakaoPhone: "01033334444", parents });
    // 두 parent 모두 kakao_id null 유지
    expect(parents[0].kakao_id).toBeNull();
    expect(parents[1].kakao_id).toBeNull();
  });

  it("동일 phone + 3개 pool → 마찬가지로 KAKAO_PARENT_AMBIGUOUS", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01044445555", swimming_pool_id: "pool_A", kakao_id: null, name: "D" },
      { id: "pa2", phone: "01044445555", swimming_pool_id: "pool_B", kakao_id: null, name: "D" },
      { id: "pa3", phone: "01044445555", swimming_pool_id: "pool_C", kakao_id: null, name: "D" },
    ];
    const result = sim({ kakaoId: "k004", kakaoPhone: "01044445555", parents });
    expect(result.httpStatus).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M4  phone multiple parents + pool_id → 정확한 pool parent 선택
// ─────────────────────────────────────────────────────────────────────────────

describe("§M4. phone 다수 매칭 + pool_id 포함 → 정확한 pool 계정 선택", () => {
  it("pool_id 제공 → 해당 pool의 정확한 parent 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01033334444", swimming_pool_id: "pool_A", kakao_id: null, name: "C" },
      { id: "pa2", phone: "01033334444", swimming_pool_id: "pool_B", kakao_id: null, name: "C" },
    ];
    const result = sim({ kakaoId: "k003", kakaoPhone: "01033334444", pool_id: "pool_B", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      expect(result.body.parent?.id).toBe("pa2");
      expect(result.body.parent?.swimming_pool_id).toBe("pool_B");
    }
  });

  it("pool_id 제공 → 대상 pool에만 kakao_id 연결, 다른 pool은 null 유지", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01033334444", swimming_pool_id: "pool_A", kakao_id: null, name: "C" },
      { id: "pa2", phone: "01033334444", swimming_pool_id: "pool_B", kakao_id: null, name: "C" },
    ];
    sim({ kakaoId: "k003", kakaoPhone: "01033334444", pool_id: "pool_A", parents });
    expect(parents[0].kakao_id).toBe("k003"); // pool_A 연결
    expect(parents[1].kakao_id).toBeNull();    // pool_B 미연결
  });

  it("pool_id가 일치하는 pool 계정 없음 → 404 kakao_no_account (신규 가입 유도)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01033334444", swimming_pool_id: "pool_A", kakao_id: null, name: "C" },
    ];
    const result = sim({ kakaoId: "k999", kakaoPhone: "01033334444", pool_id: "pool_Z", parents });
    expect(result.httpStatus).toBe(404); // pool_Z에 계정 없음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M5  same kakao_id → 다른 parent 충돌 방지
// ─────────────────────────────────────────────────────────────────────────────

describe("§M5. 동일 kakao_id 중복 연결 방지", () => {
  it("이미 A에 연결된 kakao_id로 로그인 → A 반환 (B에 중복 연결 금지)", () => {
    const parents: ParentAcc[] = [
      { id: "pa_A", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "k_shared", name: "A" },
      { id: "pa_B", phone: "01011112222", swimming_pool_id: "pool_B", kakao_id: null, name: "A_B" },
    ];
    const result = sim({ kakaoId: "k_shared", kakaoPhone: "01011112222", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) expect(result.body.parent?.id).toBe("pa_A");
    // pa_B는 여전히 null
    expect(parents[1].kakao_id).toBeNull();
  });

  it("kakao_id exact match 경로에서 중복 UPDATE 없음 (parents 수 동일)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011112222", swimming_pool_id: "pool_A", kakao_id: "k001", name: "A" },
    ];
    const before = parents.length;
    sim({ kakaoId: "k001", kakaoPhone: "01011112222", parents });
    expect(parents.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M6  phone_missing → manual phone 입력 → existing parent 연결 (pool_id 필수)
// ─────────────────────────────────────────────────────────────────────────────

describe("§M6. phone_missing 후 수동 입력 → existing parent 연결", () => {
  it("phone_missing=true → 404 반환 → 앱이 phone 입력 → pool_id 포함 재요청 → 기존 계정 연결", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01055556666", swimming_pool_id: "pool_A", kakao_id: null, name: "E" },
    ];

    // 1차: phone_missing → 404
    const step1 = sim({ kakaoId: "k005", kakaoPhone: null, parents });
    expect(step1.httpStatus).toBe(404);
    if (step1.httpStatus === 404) expect(step1.body.kakao_info.phone_missing).toBe(true);

    // 2차: 앱에서 phone 입력 후 pool_id 포함 재요청 (서버 POST /auth/kakao-link-parent 경로)
    // 이 경우 simulated는 pool_id + phone으로 매칭
    const step2 = sim({ kakaoId: "k005", kakaoPhone: "01055556666", pool_id: "pool_A", parents });
    expect(step2.httpStatus).toBe(200);
    if (step2.httpStatus === 200) expect(step2.body.parent?.id).toBe("pa1");
    expect(parents[0].kakao_id).toBe("k005");
  });

  it("phone_missing + 기존 계정 없음 → 404 유지 (신규 가입 경로)", () => {
    const parents: ParentAcc[] = [];
    const result = sim({ kakaoId: "k006", kakaoPhone: null, parents });
    expect(result.httpStatus).toBe(404);
    if (result.httpStatus === 404) expect(result.body.kakao_info.phone_missing).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M7  phone_missing → 신규 parent (no match)
// ─────────────────────────────────────────────────────────────────────────────

describe("§M7. phone_missing + 신규 사용자 → 신규 가입 유도", () => {
  it("phone scope 미동의 + 기존 계정 없음 → 404 phone_missing=true", () => {
    const result = sim({ kakaoId: "k_new", kakaoPhone: null, parents: [] });
    expect(result.httpStatus).toBe(404);
    if (result.httpStatus === 404) {
      expect(result.body.error_code).toBe("kakao_no_account");
      expect(result.body.kakao_info.phone_missing).toBe(true);
    }
  });

  it("phone scope 동의 + 기존 계정 없음 → 404 phone_missing=false", () => {
    const result = sim({ kakaoId: "k_new2", kakaoPhone: "01099998888", parents: [] });
    expect(result.httpStatus).toBe(404);
    if (result.httpStatus === 404) {
      expect(result.body.kakao_info.phone_missing).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M8  existing parent + sibling second child (multi-pool fix 회귀 방지)
// ─────────────────────────────────────────────────────────────────────────────

describe("§M8. 기존 kakao parent + 형제자매 (multi-pool 수정 회귀 방지)", () => {
  it("kakao parent가 이미 pool_A에 있고 두 번째 자녀 추가 → 카카오 연결 유지", () => {
    const parents: ParentAcc[] = [
      { id: "pa_kakao", phone: "01025366384", swimming_pool_id: "pool_A", kakao_id: "k_parent", name: "황" },
    ];
    // pool_id=pool_A로 재로그인 → kakao_id exact match → 200
    const result = sim({ kakaoId: "k_parent", kakaoPhone: "01025366384", pool_id: "pool_A", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      expect(result.body.parent?.id).toBe("pa_kakao"); // 동일 계정 반환
      expect(result.body.parent?.swimming_pool_id).toBe("pool_A");
    }
  });

  it("kakao_id 재연결 없음 — 형제 추가 후에도 kakao_id 원본 유지", () => {
    const parents: ParentAcc[] = [
      { id: "pa_kakao", phone: "01025366384", swimming_pool_id: "pool_A", kakao_id: "k_parent", name: "황" },
    ];
    const before = parents[0].kakao_id;
    sim({ kakaoId: "k_parent", kakaoPhone: "01025366384", pool_id: "pool_A", parents });
    expect(parents[0].kakao_id).toBe(before); // 변경 없음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M9  existing parent in two pools → ambiguous (no pool_id)
// ─────────────────────────────────────────────────────────────────────────────

describe("§M9. 동일 사용자가 두 pool에 등록 — pool_id 없으면 ambiguous", () => {
  it("pool_id 없음 + 2개 pool → KAKAO_PARENT_AMBIGUOUS (기존 LIMIT 1 금지)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01077778888", swimming_pool_id: "pool_A", kakao_id: null, name: "F" },
      { id: "pa2", phone: "01077778888", swimming_pool_id: "pool_B", kakao_id: null, name: "F" },
    ];
    const result = sim({ kakaoId: "k007", kakaoPhone: "01077778888", parents });
    expect(result.httpStatus).toBe(409);
    if (result.httpStatus === 409) expect(result.body.error_code).toBe("KAKAO_PARENT_AMBIGUOUS");
  });

  it("pool_id_A 포함 → pool_A 정확 선택", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01077778888", swimming_pool_id: "pool_A", kakao_id: null, name: "F" },
      { id: "pa2", phone: "01077778888", swimming_pool_id: "pool_B", kakao_id: null, name: "F" },
    ];
    const result = sim({ kakaoId: "k007", kakaoPhone: "01077778888", pool_id: "pool_A", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) expect(result.body.parent?.id).toBe("pa1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M10 1.6.3 legacy request — pool_id 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("§M10. 1.6.3 레거시 요청 (pool_id 없음) 호환성", () => {
  it("1.6.3: pool_id 없음 + phone 1개 match → 기존처럼 정상 로그인", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01011111111", swimming_pool_id: "pool_A", kakao_id: null, name: "G" },
    ];
    // 1.6.3 요청: pool_id 없음
    const result = sim({ kakaoId: "k_163", kakaoPhone: "01011111111", parents });
    expect(result.httpStatus).toBe(200);
  });

  it("1.6.3: pool_id 없음 + phone 0개 → kakao_no_account", () => {
    const result = sim({ kakaoId: "k_163_new", kakaoPhone: "01099990000", parents: [] });
    expect(result.httpStatus).toBe(404);
  });

  it("1.6.3: pool_id 없음 + phone 2개 (다중 풀) → KAKAO_PARENT_AMBIGUOUS (안전 실패)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01088889999", swimming_pool_id: "pool_A", kakao_id: null, name: "H" },
      { id: "pa2", phone: "01088889999", swimming_pool_id: "pool_B", kakao_id: null, name: "H" },
    ];
    // 1.6.3에서는 pool_id 없음 → 잘못 연결하는 것보다 실패가 낫다
    const result = sim({ kakaoId: "k_163_multi", kakaoPhone: "01088889999", parents });
    expect(result.httpStatus).toBe(409); // 안전 실패
    // 두 계정 모두 null 유지
    expect(parents[0].kakao_id).toBeNull();
    expect(parents[1].kakao_id).toBeNull();
  });

  it("1.6.3: kakao_id already linked → 정상 로그인 (pool_id 무관)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01088889999", swimming_pool_id: "pool_A", kakao_id: "k_linked", name: "H" },
      { id: "pa2", phone: "01088889999", swimming_pool_id: "pool_B", kakao_id: null, name: "H" },
    ];
    // kakao_id exact match → 안전하게 pa1 반환 (pool_id 없어도)
    const result = sim({ kakaoId: "k_linked", kakaoPhone: "01088889999", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) expect(result.body.parent?.id).toBe("pa1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §M11 2.0.0 pool_id request
// ─────────────────────────────────────────────────────────────────────────────

describe("§M11. 2.0.0 pool_id 포함 요청", () => {
  it("2.0.0: pool_id + phone → 정확한 pool 계정 반환", () => {
    const parents: ParentAcc[] = [
      { id: "pa_pool_a", phone: "01055556666", swimming_pool_id: "pool_A", kakao_id: null, name: "I" },
      { id: "pa_pool_b", phone: "01055556666", swimming_pool_id: "pool_B", kakao_id: null, name: "I" },
    ];
    const result = sim({ kakaoId: "k_200", kakaoPhone: "01055556666", pool_id: "pool_A", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      expect(result.body.parent?.id).toBe("pa_pool_a");
      expect(result.body.parent?.swimming_pool_id).toBe("pool_A");
    }
  });

  it("2.0.0: pool_id 포함 + kakao_id 이미 연결 → kakao_id exact match 경로 사용 (pool_id 무시)", () => {
    // kakao_id exact match는 항상 pool_id보다 우선
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01055556666", swimming_pool_id: "pool_A", kakao_id: "k_exact", name: "I" },
    ];
    const result = sim({ kakaoId: "k_exact", kakaoPhone: "01055556666", pool_id: "pool_B", parents });
    expect(result.httpStatus).toBe(200);
    if (result.httpStatus === 200) {
      // pool_id=pool_B를 요청했지만 kakao_id로 pool_A 계정 반환 (exact match 우선)
      expect(result.body.parent?.id).toBe("pa1");
    }
  });

  it("2.0.0: pool_id 포함 + phone 없음 (phone_missing) → 404 phone_missing=true", () => {
    const result = sim({ kakaoId: "k_pm", kakaoPhone: null, pool_id: "pool_A", parents: [] });
    expect(result.httpStatus).toBe(404);
    if (result.httpStatus === 404) expect(result.body.kakao_info.phone_missing).toBe(true);
  });

  it("2.0.0: pool_id 포함 + 동일 phone 다수지만 해당 pool 계정 없음 → 404 (신규 가입)", () => {
    const parents: ParentAcc[] = [
      { id: "pa1", phone: "01055556666", swimming_pool_id: "pool_A", kakao_id: null, name: "I" },
      { id: "pa2", phone: "01055556666", swimming_pool_id: "pool_B", kakao_id: null, name: "I" },
    ];
    // pool_C 요청 → pool_C에 계정 없음
    const result = sim({ kakaoId: "k_new_pool", kakaoPhone: "01055556666", pool_id: "pool_C", parents });
    expect(result.httpStatus).toBe(404);
  });
});
