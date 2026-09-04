/**
 * WP15.5-C — Ad Creative 계약 로직 테스트 (DB mock 방식)
 *
 * 서버 side 계산 로직·계약 검증.
 * HTTP 요청 없음 — 수치/구조 로직 직접 검증.
 *
 * A — Creative ID 형식: adc_<timestamp>_<random>
 * B — 기본값 보장 (placement/creative_type/effect_type/display_order/is_active)
 * C — target_age_band: 빈 배열 기본값
 * D — target_region: 빈 배열 기본값
 * E — 활성 Creative 필터: is_active=false → 제외
 * F — 슬롯 응답: creative=null (없음) → 응답 구조 유지
 * G — AD_IMPRESSION logEvent metadata 구조 검증
 * H — headline null 허용 (선택 필드)
 * I — destination_url null 허용
 * J — display_order 낮을수록 우선
 *
 * 합계: 10 TC
 */
import { describe, it, expect } from "vitest";

// ── Creative ID 생성 로직 복제 ────────────────────────────────────────────────
function generateCreativeId(): string {
  return `adc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Creative 기본값 조립 복제 ─────────────────────────────────────────────────
interface CreativeInput {
  placement?: string;
  creative_type?: string;
  headline?: string;
  body_text?: string;
  image_url?: string;
  destination_url?: string;
  effect_type?: string;
  display_order?: number;
  is_active?: boolean;
  target_age_band?: string[];
  target_region?: string[];
}

function buildCreativeDefaults(input: CreativeInput) {
  return {
    placement:       input.placement       ?? "PARENT_HOME_BANNER",
    creative_type:   input.creative_type   ?? "IMAGE_WITH_TEXT",
    headline:        input.headline        ?? null,
    body_text:       input.body_text       ?? null,
    image_url:       input.image_url       ?? null,
    destination_url: input.destination_url ?? null,
    effect_type:     input.effect_type     ?? "NONE",
    display_order:   input.display_order   != null ? Number(input.display_order) : 0,
    is_active:       input.is_active       != null ? Boolean(input.is_active) : true,
    target_age_band: Array.isArray(input.target_age_band) ? input.target_age_band : [],
    target_region:   Array.isArray(input.target_region)   ? input.target_region   : [],
  };
}

// ── 활성 Creative 선택 로직 복제 ─────────────────────────────────────────────
interface StoredCreative extends ReturnType<typeof buildCreativeDefaults> {
  id: string;
}

function pickActiveCreative(
  rows: StoredCreative[],
  placement: string,
): StoredCreative | null {
  return rows
    .filter(r => r.placement === placement && r.is_active)
    .sort((a, b) => a.display_order - b.display_order)[0] ?? null;
}

// ── AD_IMPRESSION logEvent metadata 구조 ─────────────────────────────────────
function buildImpressionMetadata(creativeId: string, placement: string, userId: string) {
  return {
    event_type:  "AD_IMPRESSION",
    creative_id: creativeId,
    placement,
    role:        "parent_account",
    actor_id:    userId,
  };
}

// ── TC ────────────────────────────────────────────────────────────────────────

describe("WP15.5-C: Ad Creative 계약 로직", () => {

  // A ─────────────────────────────────────────────────────────────────
  it("A — Creative ID 형식: adc_<숫자>_<영숫자>", () => {
    const id = generateCreativeId();
    expect(id).toMatch(/^adc_\d+_[a-z0-9]+$/);
  });

  // B ─────────────────────────────────────────────────────────────────
  it("B — 기본값 보장 (빈 입력 → 기본 필드)", () => {
    const c = buildCreativeDefaults({});
    expect(c.placement).toBe("PARENT_HOME_BANNER");
    expect(c.creative_type).toBe("IMAGE_WITH_TEXT");
    expect(c.effect_type).toBe("NONE");
    expect(c.display_order).toBe(0);
    expect(c.is_active).toBe(true);
  });

  // C ─────────────────────────────────────────────────────────────────
  it("C — target_age_band: 빈 배열 기본값", () => {
    const c = buildCreativeDefaults({});
    expect(Array.isArray(c.target_age_band)).toBe(true);
    expect(c.target_age_band.length).toBe(0);
  });

  // D ─────────────────────────────────────────────────────────────────
  it("D — target_region: 빈 배열 기본값", () => {
    const c = buildCreativeDefaults({});
    expect(Array.isArray(c.target_region)).toBe(true);
    expect(c.target_region.length).toBe(0);
  });

  // E ─────────────────────────────────────────────────────────────────
  it("E — is_active=false Creative는 슬롯에서 제외", () => {
    const rows: StoredCreative[] = [
      { ...buildCreativeDefaults({ is_active: false }), id: "adc_1" },
      { ...buildCreativeDefaults({ is_active: true,  display_order: 1, headline: "활성" }), id: "adc_2" },
    ];
    const picked = pickActiveCreative(rows, "PARENT_HOME_BANNER");
    expect(picked?.id).toBe("adc_2");
    expect(picked?.is_active).toBe(true);
  });

  // F ─────────────────────────────────────────────────────────────────
  it("F — 슬롯: 활성 Creative 없으면 null 반환", () => {
    const rows: StoredCreative[] = [
      { ...buildCreativeDefaults({ is_active: false }), id: "adc_x" },
    ];
    const picked = pickActiveCreative(rows, "PARENT_HOME_BANNER");
    expect(picked).toBeNull();

    // 응답 구조: { creative: null }
    const response = { creative: picked };
    expect(response).toHaveProperty("creative");
    expect(response.creative).toBeNull();
  });

  // G ─────────────────────────────────────────────────────────────────
  it("G — AD_IMPRESSION logEvent metadata 필수 필드 존재", () => {
    const meta = buildImpressionMetadata("adc_123", "PARENT_HOME_BANNER", "usr_456");
    expect(meta.event_type).toBe("AD_IMPRESSION");
    expect(meta.creative_id).toBe("adc_123");
    expect(meta.placement).toBe("PARENT_HOME_BANNER");
    expect(meta.role).toBe("parent_account");
    expect(typeof meta.actor_id).toBe("string");
  });

  // H ─────────────────────────────────────────────────────────────────
  it("H — headline null 허용 (선택 필드)", () => {
    const c = buildCreativeDefaults({ headline: undefined });
    expect(c.headline).toBeNull();
    // image_url만 있어도 Creative 유효
    const c2 = buildCreativeDefaults({ image_url: "https://example.com/img.jpg" });
    expect(c2.image_url).toBe("https://example.com/img.jpg");
    expect(c2.headline).toBeNull();
  });

  // I ─────────────────────────────────────────────────────────────────
  it("I — destination_url null 허용 (랜딩 없이 표시만 가능)", () => {
    const c = buildCreativeDefaults({ destination_url: undefined });
    expect(c.destination_url).toBeNull();
  });

  // J ─────────────────────────────────────────────────────────────────
  it("J — display_order 낮을수록 우선 선택", () => {
    const rows: StoredCreative[] = [
      { ...buildCreativeDefaults({ display_order: 10, headline: "후순위" }), id: "adc_high" },
      { ...buildCreativeDefaults({ display_order: 0,  headline: "최우선" }), id: "adc_low" },
      { ...buildCreativeDefaults({ display_order: 5,  headline: "중간" }),   id: "adc_mid" },
    ];
    const picked = pickActiveCreative(rows, "PARENT_HOME_BANNER");
    expect(picked?.id).toBe("adc_low");
    expect(picked?.headline).toBe("최우선");
  });

});
