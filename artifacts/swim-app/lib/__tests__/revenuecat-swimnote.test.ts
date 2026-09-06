/**
 * revenuecat-swimnote.test.ts
 *
 * SWIMNOTE 기본 구독 RC 연결 검증 테스트 (WP-SWIMNOTE-RC)
 *
 * react-native / react-native-purchases는 RN bundler 전용 모듈이므로
 * Node.js Vitest 환경에서 직접 import 불가.
 * 상수와 핵심 순수 로직을 인라인으로 검증한다 (subscription.tsx와 동일 로직).
 *
 * 테스트 범위:
 *  1. Offering 상수 확인
 *  2. SWIMNOTE package 탐색 로직 (identifier / productIdentifier 양쪽)
 *  3. Product ID 정확히 com.swimnote.swimnote.monthly 검출
 *  4. SWIMNOTE 구매 시 x_mode entitlement 미부여
 *  5. X300/X500/X1000 package 탐색 로직 회귀검증
 *  6. restore flow: SWIMNOTE product가 x_mode로 오분류되지 않음
 *  7. DATA 분리 확인
 */

// ── 상수 (revenuecat.tsx와 동일 값) ─────────────────────────────────────────
const SWIMNOTE_OFFERING_ID          = "swimnote_monthly";
const X_OFFERING_ID                 = "x_monthly";
const X_ENTITLEMENT                 = "x_mode";
const REVENUECAT_SOLO_ENTITLEMENT   = "solo";
const REVENUECAT_CENTER_ENTITLEMENT = "center";

// ── package 탐색 로직 (subscription.tsx와 동일) ──────────────────────────────
function findSwimnotePackage(packages: any[]): any | null {
  return packages.find(
    (p: any) =>
      p.identifier === "swimnote" ||
      p.identifier === "swimnote:monthly" ||
      p.product?.productIdentifier === "swimnote" ||
      p.product?.productIdentifier === "swimnote:monthly" ||
      p.product?.productIdentifier === "com.swimnote.swimnote.monthly",
  ) ?? null;
}

function findXPackage(packages: any[], tier: string): any | null {
  return packages.find(
    (p: any) =>
      p.identifier === tier ||
      p.identifier === `${tier}:monthly` ||
      p.product?.productIdentifier === tier ||
      p.product?.productIdentifier === `${tier}:monthly` ||
      p.product?.productIdentifier === `com.swimnote.${tier}.monthly`,
  ) ?? null;
}

// ── entitlement 라우팅 로직 (syncRcToServer 내 로직과 동일) ─────────────────
function resolveEntitlementId(productId: string): string | null {
  const X_TIERS        = ["x300", "x500", "x1000"];
  const SWIMNOTE_TIERS = ["swimnote"];

  const normalize = (id: string) =>
    id.replace(/:monthly$/, "").replace(/^com\.swimnote\./, "").replace(/\.monthly$/, "");

  const isX        = (id: string) => { const b = normalize(id); return X_TIERS.includes(b) || X_TIERS.includes(id); };
  const isSwim     = (id: string) => { const b = normalize(id); return SWIMNOTE_TIERS.includes(b) || SWIMNOTE_TIERS.includes(id); };
  const centerIds  = ["center_200", "center_300", "center_500", "center_1000"];

  if (isX(productId))    return X_ENTITLEMENT;
  if (isSwim(productId)) return null;  // RC entitlement 없음 — DB tier authoritative
  return centerIds.includes(productId) ? REVENUECAT_CENTER_ENTITLEMENT : REVENUECAT_SOLO_ENTITLEMENT;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("테스트 1 · Offering 상수", () => {
  test("SWIMNOTE_OFFERING_ID = swimnote_monthly", () => {
    expect(SWIMNOTE_OFFERING_ID).toBe("swimnote_monthly");
  });
  test("X_OFFERING_ID = x_monthly", () => {
    expect(X_OFFERING_ID).toBe("x_monthly");
  });
  test("X_ENTITLEMENT = x_mode", () => {
    expect(X_ENTITLEMENT).toBe("x_mode");
  });
  test("SWIMNOTE와 X offering은 분리", () => {
    expect(SWIMNOTE_OFFERING_ID).not.toBe(X_OFFERING_ID);
  });
});

describe("테스트 2 · SWIMNOTE package 탐색 로직", () => {
  const officialPkg = {
    identifier: "swimnote",
    product: { productIdentifier: "com.swimnote.swimnote.monthly", priceString: "₩9,900" },
  };

  test("identifier='swimnote'로 탐색 성공", () => {
    expect(findSwimnotePackage([officialPkg])).toBe(officialPkg);
  });
  test("identifier='swimnote:monthly' 변형도 탐색", () => {
    const p = { identifier: "swimnote:monthly", product: { productIdentifier: "com.swimnote.swimnote.monthly" } };
    expect(findSwimnotePackage([p])).toBe(p);
  });
  test("productIdentifier='com.swimnote.swimnote.monthly'로 탐색", () => {
    const p = { identifier: "pkg-unknown", product: { productIdentifier: "com.swimnote.swimnote.monthly" } };
    expect(findSwimnotePackage([p])).toBe(p);
  });
  test("빈 배열 → null (safe disabled)", () => {
    expect(findSwimnotePackage([])).toBeNull();
  });
  test("X 패키지는 SWIMNOTE 탐색에서 매칭 안 됨", () => {
    const xPkg = { identifier: "x300", product: { productIdentifier: "com.swimnote.x300.monthly" } };
    expect(findSwimnotePackage([xPkg])).toBeNull();
  });
});

describe("테스트 3 · Product ID exact match", () => {
  const pkg = {
    identifier: "swimnote",
    product: { productIdentifier: "com.swimnote.swimnote.monthly" },
  };
  test("SWIMNOTE package productIdentifier = com.swimnote.swimnote.monthly", () => {
    const found = findSwimnotePackage([pkg]);
    expect(found?.product?.productIdentifier).toBe("com.swimnote.swimnote.monthly");
  });
});

describe("테스트 4 · SWIMNOTE 구매 → x_mode 미부여", () => {
  test("'com.swimnote.swimnote.monthly' → entitlementId = null", () => {
    expect(resolveEntitlementId("com.swimnote.swimnote.monthly")).toBeNull();
  });
  test("'swimnote' RC identifier → entitlementId = null", () => {
    expect(resolveEntitlementId("swimnote")).toBeNull();
  });
  test("'swimnote:monthly' 변형 → entitlementId = null", () => {
    expect(resolveEntitlementId("swimnote:monthly")).toBeNull();
  });
  test("SWIMNOTE entitlementId ≠ x_mode", () => {
    expect(resolveEntitlementId("com.swimnote.swimnote.monthly")).not.toBe(X_ENTITLEMENT);
  });
});

describe("테스트 5 · X300/X500/X1000 package 탐색 회귀검증", () => {
  const xPackages = [
    { identifier: "x300",  product: { productIdentifier: "com.swimnote.x300.monthly"  } },
    { identifier: "x500",  product: { productIdentifier: "com.swimnote.x500.monthly"  } },
    { identifier: "x1000", product: { productIdentifier: "com.swimnote.x1000.monthly" } },
  ];

  ["x300", "x500", "x1000"].forEach((tier) => {
    test(`${tier} package 탐색 성공`, () => {
      expect(findXPackage(xPackages, tier)).not.toBeNull();
    });
    test(`${tier} productIdentifier = com.swimnote.${tier}.monthly`, () => {
      expect(findXPackage(xPackages, tier)?.product?.productIdentifier).toBe(`com.swimnote.${tier}.monthly`);
    });
    test(`${tier} → entitlementId = x_mode`, () => {
      expect(resolveEntitlementId(`com.swimnote.${tier}.monthly`)).toBe(X_ENTITLEMENT);
    });
  });
});

describe("테스트 6 · restore flow 회귀검증", () => {
  test("SWIMNOTE productId restore 시 x_mode 미부여", () => {
    expect(resolveEntitlementId("com.swimnote.swimnote.monthly")).not.toBe(X_ENTITLEMENT);
    expect(resolveEntitlementId("com.swimnote.swimnote.monthly")).toBeNull();
  });
  test("x300 productId restore 시 x_mode 부여", () => {
    expect(resolveEntitlementId("com.swimnote.x300.monthly")).toBe(X_ENTITLEMENT);
  });
});

describe("테스트 7 · DATA 분리 — 이번 작업에서 연결 안 됨", () => {
  test("DATA product는 SWIMNOTE/X 탐색 로직에서 null 반환 (swimnote 탐색)", () => {
    const dataPkg = { identifier: "data100", product: { productIdentifier: "com.swimnote.data100.monthly" } };
    expect(findSwimnotePackage([dataPkg])).toBeNull();
  });
  test("DATA product는 X 탐색 로직에서도 null 반환", () => {
    const dataPkg = { identifier: "data100", product: { productIdentifier: "com.swimnote.data100.monthly" } };
    expect(findXPackage([dataPkg], "x300")).toBeNull();
  });
  test("DATA entitlementId ≠ x_mode (solo fallback)", () => {
    expect(resolveEntitlementId("com.swimnote.data100.monthly")).not.toBe(X_ENTITLEMENT);
  });
});
