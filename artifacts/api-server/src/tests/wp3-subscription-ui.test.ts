/**
 * WP3: 구독 UI / Trial UX / Storage / DATA Pack — 로직 단위 테스트
 *
 * constants/subscriptionPlans.ts 헬퍼 함수를 자체 선언하여 검증
 * (api-server vitest 환경에서 swim-app 모듈 직접 import 불가)
 */

import { describe, it, expect } from "vitest";

// ── 테스트 대상 로직 로컬 복제 (SoT: swim-app/constants/subscriptionPlans.ts) ──

interface SubscriptionPlanDef {
  tier: string;
  plan_id: string;
  name: string;
  max_members: number;
  storage_limit_mb: number;
  display_storage: string;
  price_monthly_krw: number;
  sort_order: number;
  is_enterprise: boolean;
  tier_group: string;
  color: string;
  includes_video: boolean;
}

const SUBSCRIPTION_PLANS_DEF: SubscriptionPlanDef[] = [
  { tier:"free",       plan_id:"free_10",     name:"Free",         max_members:10,     storage_limit_mb:102,     display_storage:"100MB", price_monthly_krw:0,      sort_order:0,  is_enterprise:false, tier_group:"free",   color:"#6B7280", includes_video:false },
  { tier:"starter",    plan_id:"solo_30",     name:"Coach 30",     max_members:30,     storage_limit_mb:3072,    display_storage:"3GB",   price_monthly_krw:1900,   sort_order:1,  is_enterprise:false, tier_group:"coach",  color:"#10B981", includes_video:false },
  { tier:"basic",      plan_id:"solo_50",     name:"Coach 50",     max_members:50,     storage_limit_mb:5120,    display_storage:"5GB",   price_monthly_krw:2900,   sort_order:2,  is_enterprise:false, tier_group:"coach",  color:"#0EA5E9", includes_video:false },
  { tier:"standard",   plan_id:"solo_100",    name:"Coach 100",    max_members:100,    storage_limit_mb:10240,   display_storage:"10GB",  price_monthly_krw:5900,   sort_order:3,  is_enterprise:false, tier_group:"coach",  color:"#6366F1", includes_video:false },
  { tier:"center_200", plan_id:"center_200",  name:"Premier 200",  max_members:200,    storage_limit_mb:51200,   display_storage:"50GB",  price_monthly_krw:19000,  sort_order:4,  is_enterprise:false, tier_group:"premier",color:"#F59E0B", includes_video:true  },
  { tier:"advance",    plan_id:"center_300",  name:"Premier 300",  max_members:300,    storage_limit_mb:81920,   display_storage:"80GB",  price_monthly_krw:27000,  sort_order:5,  is_enterprise:false, tier_group:"premier",color:"#F97316", includes_video:true  },
  { tier:"pro",        plan_id:"center_500",  name:"Premier 500",  max_members:500,    storage_limit_mb:133120,  display_storage:"130GB", price_monthly_krw:43000,  sort_order:6,  is_enterprise:false, tier_group:"premier",color:"#EF4444", includes_video:true  },
  { tier:"max",        plan_id:"center_1000", name:"Premier 1000", max_members:1000,   storage_limit_mb:512000,  display_storage:"500GB", price_monthly_krw:79000,  sort_order:7,  is_enterprise:false, tier_group:"premier",color:"#7C3AED", includes_video:true  },
  { tier:"swimnote",   plan_id:"swimnote",    name:"SWIMNOTE",     max_members:999999, storage_limit_mb:10240,   display_storage:"10GB",  price_monthly_krw:9900,   sort_order:8,  is_enterprise:false, tier_group:"premier",color:"#0A2540", includes_video:true  },
  { tier:"x300",       plan_id:"x300",        name:"SWIMNOTE X300",max_members:300,    storage_limit_mb:307200,  display_storage:"300GB", price_monthly_krw:119000, sort_order:9,  is_enterprise:true,  tier_group:"premier",color:"#1E3A5F", includes_video:true  },
  { tier:"x500",       plan_id:"x500",        name:"SWIMNOTE X500",max_members:500,    storage_limit_mb:512000,  display_storage:"500GB", price_monthly_krw:189000, sort_order:10, is_enterprise:true,  tier_group:"premier",color:"#1E3A5F", includes_video:true  },
  { tier:"x1000",      plan_id:"x1000",       name:"SWIMNOTE X1000",max_members:1000,  storage_limit_mb:1024000,display_storage:"1TB",   price_monthly_krw:349000, sort_order:11, is_enterprise:true,  tier_group:"premier",color:"#1E3A5F", includes_video:true  },
];

function getPlanByTier(tier: string) { return SUBSCRIPTION_PLANS_DEF.find(p => p.tier === tier); }

function formatMemberLimit(max_members: number): string {
  return max_members >= 999999 ? "무제한" : `최대 ${max_members.toLocaleString()}명`;
}

const LEGACY_TIERS = new Set(["free","starter","basic","standard","center_200","advance","pro","max"]);
function isLegacyTier(tier: string): boolean { return LEGACY_TIERS.has(tier); }

function storageWarningLevel(usedMb: number, limitMb: number): "normal"|"warning"|"critical"|"full" {
  if (limitMb <= 0) return "normal";
  const pct = (usedMb / limitMb) * 100;
  if (pct >= 100) return "full";
  if (pct >= 90)  return "critical";
  if (pct >= 80)  return "warning";
  return "normal";
}

function recommendXPlanTier(activeMembers: number): "x300"|"x500"|"x1000"|"enterprise" {
  if (activeMembers <= 300)  return "x300";
  if (activeMembers <= 500)  return "x500";
  if (activeMembers <= 1000) return "x1000";
  return "enterprise";
}

const DATA_PACKS = [
  { id:"data100", name:"DATA100", plus_gb:100, price_monthly_krw:7900  },
  { id:"data300", name:"DATA300", plus_gb:300, price_monthly_krw:22900 },
];

function trialErrorMessage(code: string): string {
  switch (code) {
    case "TRIAL_ALREADY_USED":                       return "이 센터는 무료체험을 이미 사용했습니다.";
    case "TRIAL_ALREADY_ACTIVE":                     return "체험이 이미 진행 중입니다.";
    case "TRIAL_NOT_AVAILABLE_FOR_PAID_X":           return "이미 SWIMNOTE X를 이용 중입니다.";
    case "TRIAL_NOT_AVAILABLE_FOR_PREVIOUS_X_BUYER": return "이전 X 구독 이력이 있는 센터는 체험을 이용할 수 없습니다.";
    case "TRIAL_FORCE_DISABLED":                     return "현재 X 체험을 이용할 수 없습니다.";
    default:                                         return "체험 시작에 실패했습니다. 잠시 후 다시 시도해주세요.";
  }
}

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 formatMemberLimit", () => {
  it("999999 → 무제한",   () => expect(formatMemberLimit(999999)).toBe("무제한"));
  it("1000000 → 무제한",  () => expect(formatMemberLimit(1000000)).toBe("무제한"));
  it("300 → 최대 300명",  () => expect(formatMemberLimit(300)).toBe("최대 300명"));
  it("500 → 최대 500명",  () => expect(formatMemberLimit(500)).toBe("최대 500명"));
  it("1000 → 최대 1,000명",() => expect(formatMemberLimit(1000)).toBe("최대 1,000명"));
  it("10 → 최대 10명",    () => expect(formatMemberLimit(10)).toBe("최대 10명"));
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 isLegacyTier", () => {
  it.each(["free","starter","basic","standard"])(
    "coach %s → legacy true", (t) => expect(isLegacyTier(t)).toBe(true),
  );
  it.each(["center_200","advance","pro","max"])(
    "premier %s → legacy true", (t) => expect(isLegacyTier(t)).toBe(true),
  );
  it.each(["swimnote","x300","x500","x1000"])(
    "new %s → legacy false", (t) => expect(isLegacyTier(t)).toBe(false),
  );
  it("data100 → legacy false", () => expect(isLegacyTier("data100")).toBe(false));
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 storageWarningLevel", () => {
  const limit = 10240;
  it("50% → normal",   () => expect(storageWarningLevel(5120,  limit)).toBe("normal"));
  it("79% → normal",   () => expect(storageWarningLevel(8090,  limit)).toBe("normal"));
  it("80% → warning",  () => expect(storageWarningLevel(8192,  limit)).toBe("warning"));
  it("89% → warning",  () => expect(storageWarningLevel(9114,  limit)).toBe("warning"));
  it("90% → critical", () => expect(storageWarningLevel(9216,  limit)).toBe("critical"));
  it("99% → critical", () => expect(storageWarningLevel(10138, limit)).toBe("critical"));
  it("100% → full",    () => expect(storageWarningLevel(10240, limit)).toBe("full"));
  it("105% → full",    () => expect(storageWarningLevel(10752, limit)).toBe("full"));
  it("limitMb=0 → normal", () => expect(storageWarningLevel(100, 0)).toBe("normal"));
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 recommendXPlanTier", () => {
  it("0명 → x300",     () => expect(recommendXPlanTier(0)).toBe("x300"));
  it("300명 → x300",   () => expect(recommendXPlanTier(300)).toBe("x300"));
  it("301명 → x500",   () => expect(recommendXPlanTier(301)).toBe("x500"));
  it("500명 → x500",   () => expect(recommendXPlanTier(500)).toBe("x500"));
  it("501명 → x1000",  () => expect(recommendXPlanTier(501)).toBe("x1000"));
  it("1000명 → x1000", () => expect(recommendXPlanTier(1000)).toBe("x1000"));
  it("1001명 → enterprise", () => expect(recommendXPlanTier(1001)).toBe("enterprise"));
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 SWIMNOTE 플랜 스펙", () => {
  const plan = getPlanByTier("swimnote")!;
  it("exists",              () => expect(plan).toBeDefined());
  it("max_members=999999",  () => expect(plan.max_members).toBe(999999));
  it("storage 10GB",        () => expect(plan.display_storage).toBe("10GB"));
  it("price ₩9,900",        () => expect(plan.price_monthly_krw).toBe(9900));
  it("includes_video=true", () => expect(plan.includes_video).toBe(true));
  it("is_enterprise=false", () => expect(plan.is_enterprise).toBe(false));
  it("formatMemberLimit → 무제한", () => expect(formatMemberLimit(plan.max_members)).toBe("무제한"));
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 X 플랜 스펙", () => {
  const cases: Array<[string, number, string, number]> = [
    ["x300",  300,  "300GB", 119000],
    ["x500",  500,  "500GB", 189000],
    ["x1000", 1000, "1TB",   349000],
  ];
  it.each(cases)("%s: members=%i storage=%s price=%i", (tier, members, storage, price) => {
    const p = getPlanByTier(tier)!;
    expect(p).toBeDefined();
    expect(p.max_members).toBe(members);
    expect(p.display_storage).toBe(storage);
    expect(p.price_monthly_krw).toBe(price);
    expect(p.is_enterprise).toBe(true);
  });
  it("x1000 → 최대 1,000명 (무제한 아님)", () => {
    expect(formatMemberLimit(1000)).toBe("최대 1,000명");
  });
  it("x 플랜 가격 오름차순", () => {
    const prices = ["x300","x500","x1000"].map(t => getPlanByTier(t)!.price_monthly_krw);
    expect(prices[0]).toBeLessThan(prices[1]);
    expect(prices[1]).toBeLessThan(prices[2]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 DATA Pack 스펙", () => {
  it("2개 존재",  () => expect(DATA_PACKS).toHaveLength(2));
  it("DATA100 스펙", () => {
    const d = DATA_PACKS.find(p => p.id === "data100")!;
    expect(d.name).toBe("DATA100");
    expect(d.plus_gb).toBe(100);
    expect(d.price_monthly_krw).toBe(7900);
  });
  it("DATA300 스펙", () => {
    const d = DATA_PACKS.find(p => p.id === "data300")!;
    expect(d.name).toBe("DATA300");
    expect(d.plus_gb).toBe(300);
    expect(d.price_monthly_krw).toBe(22900);
  });
  it("DATA300 가격 > DATA100", () => {
    const d100 = DATA_PACKS.find(p => p.id === "data100")!;
    const d300 = DATA_PACKS.find(p => p.id === "data300")!;
    expect(d300.price_monthly_krw).toBeGreaterThan(d100.price_monthly_krw);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 Trial 오류 메시지 5코드", () => {
  const EXPECTED_ERRORS = [
    "TRIAL_ALREADY_USED",
    "TRIAL_ALREADY_ACTIVE",
    "TRIAL_NOT_AVAILABLE_FOR_PAID_X",
    "TRIAL_NOT_AVAILABLE_FOR_PREVIOUS_X_BUYER",
    "TRIAL_FORCE_DISABLED",
  ];
  it.each(EXPECTED_ERRORS)("%s → 전용 메시지 반환", (code) => {
    const msg = trialErrorMessage(code);
    expect(msg).not.toBe("체험 시작에 실패했습니다. 잠시 후 다시 시도해주세요.");
    expect(msg.length).toBeGreaterThan(5);
  });
  it("TRIAL_ALREADY_USED → '이미 사용'",    () => expect(trialErrorMessage("TRIAL_ALREADY_USED")).toContain("이미 사용"));
  it("TRIAL_ALREADY_ACTIVE → '진행 중'",    () => expect(trialErrorMessage("TRIAL_ALREADY_ACTIVE")).toContain("진행 중"));
  it("TRIAL_FORCE_DISABLED → '이용할 수'", () => expect(trialErrorMessage("TRIAL_FORCE_DISABLED")).toContain("이용할 수 없습니다"));
  it("unknown → fallback",                  () => expect(trialErrorMessage("UNEXPECTED")).toBe("체험 시작에 실패했습니다. 잠시 후 다시 시도해주세요."));
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 SUBSCRIPTION_PLANS_DEF 완전성", () => {
  const tiers = SUBSCRIPTION_PLANS_DEF.map(p => p.tier);
  it.each(["free","starter","basic","standard","center_200","advance","pro","max"])(
    "legacy %s 존재", (t) => expect(tiers).toContain(t),
  );
  it.each(["swimnote","x300","x500","x1000"])(
    "2.0 %s 존재", (t) => expect(tiers).toContain(t),
  );
  it("sort_order 오름차순", () => {
    const orders = SUBSCRIPTION_PLANS_DEF.map(p => p.sort_order);
    const sorted = [...orders].sort((a,b) => a - b);
    expect(orders).toEqual(sorted);
  });
  it("plan_id 중복 없음", () => {
    const ids = SUBSCRIPTION_PLANS_DEF.map(p => p.plan_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("전체 12개 플랜", () => expect(SUBSCRIPTION_PLANS_DEF).toHaveLength(12));
});

// ════════════════════════════════════════════════════════════════════════════
describe("WP3 XModeGuard trialAllowed 분류 정책", () => {
  /**
   * Growth 관련 XModeGuard 화면 전체: trialAllowed = false
   * 이유: Trial 수영장은 AI ENGINE 성장분석 데이터 없음
   */
  const SCREENS = [
    { path: "(admin)/x-growth",              trialAllowed: false },
    { path: "(parent)/x-growth",             trialAllowed: false },
    { path: "(parent)/growth-report-detail", trialAllowed: false },
    { path: "(teacher)/x-growth",            trialAllowed: false },
  ];
  it("총 4개 XModeGuard 화면", () => expect(SCREENS).toHaveLength(4));
  it.each(SCREENS)(
    "$path trialAllowed=false", ({ trialAllowed }) => expect(trialAllowed).toBe(false),
  );
});
