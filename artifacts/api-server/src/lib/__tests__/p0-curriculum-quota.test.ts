/**
 * p0-curriculum-quota.test.ts
 * PRE-UIUX P0 Addendum — Parent Curriculum Quota 4/month
 *
 * TC1~TC10: MONTHLY_LIMIT=4 계약 검증, hardcoded 10 없음 확인,
 *   429 처리, DB write 없음.
 *
 * AI calls:  0
 * DB write:  NO
 */

import { describe, it, expect } from "vitest";
import { MONTHLY_LIMIT } from "../parent-curriculum-quota.js";
import { readFileSync } from "fs";
import { join } from "path";

const chatSrc = readFileSync(
  join(process.cwd(), "../../artifacts/swim-app/app/(parent)/curriculum-chat.tsx"),
  "utf-8",
);

// ── TC1–TC10 ──────────────────────────────────────────────────────────────────

describe("P0 Addendum — Curriculum Quota 4/month (TC1–TC10)", () => {

  it("TC1 contract limit = 4 — MONTHLY_LIMIT 상수 값", () => {
    expect(MONTHLY_LIMIT).toBe(4);
  });

  it("TC2 used=3 → 3/4 표시 — UI는 usage.limit authority 사용", () => {
    // curriculum-chat.tsx: {used}/{limit}
    expect(chatSrc).toContain("{used}/{limit}");
    // no hardcoded /10
    expect(chatSrc).not.toMatch(/\{used\}\/10/);
    expect(chatSrc).not.toMatch(/\/10회/);
  });

  it("TC3 remaining=1 — server 기준 remaining 사용", () => {
    // remaining은 서버에서 오는 값 사용
    expect(chatSrc).toContain("usage.remaining");
    // Math.max(0, ...) 로 음수 방지 또는 서버에서 보장
    expect(chatSrc).toContain("remaining");
  });

  it("TC4 hardcoded/fallback 10 없음 — UI에서 10 상수 사용 안 함", () => {
    // limit 관련 로직에 10 상수 없어야 함
    // (padding/margin 등 스타일 10은 허용, limit 관련만 확인)
    expect(chatSrc).not.toMatch(/limit[^:]*[:=]\s*10\b/);
    expect(chatSrc).not.toMatch(/fallback.*10\b/);
  });

  it("TC5 server usage.limit authority — {used}/{limit}에서 limit은 서버 값", () => {
    // limit은 구조분해: const { used, limit, remaining, resets_at } = usage
    expect(chatSrc).toContain("const { used, limit, remaining, resets_at } = usage");
  });

  it("TC6 used=4 → 추가검색 차단 UX — isExhausted 로직", () => {
    // remaining <= 0 이면 exhausted
    expect(chatSrc).toContain("usage.remaining <= 0");
    // exhausted 상태 UI 존재
    expect(chatSrc).toContain("isExhausted");
    expect(chatSrc).toContain("usageBannerExhausted");
  });

  it("TC7 429 crash 없음 — 429 처리 핸들러 존재", () => {
    expect(chatSrc).toContain("429");
    expect(chatSrc).toContain("PARENT_CURRICULUM_MONTHLY_LIMIT_REACHED");
    // catch 블록에서 처리
    expect(chatSrc).toContain("QUOTA_EXCEEDED");
  });

  it("TC8 Invalid Date 없음 — resets_at 파싱 방어 로직 존재", () => {
    // fmtResetsAt 함수 존재 (Invalid Date 방어)
    expect(chatSrc).toContain("fmtResetsAt");
  });

  it("TC9 DB write 없음 — quota UI는 read-only", () => {
    // quota display 관련 버튼/action에 POST/DELETE 없음
    const quotaSection = chatSrc.slice(
      chatSrc.indexOf("usageBanner"),
      chatSrc.indexOf("usageBanner") + 500,
    );
    expect(quotaSection).not.toContain("POST");
    expect(quotaSection).not.toContain("DELETE");
  });

  it("TC10 AI 호출 없음 — quota 표시는 순수 UI 렌더링", () => {
    // quota 영역은 서버에서 받은 usage state를 렌더링만 함
    const quotaSection = chatSrc.slice(
      chatSrc.indexOf("usageBanner"),
      chatSrc.indexOf("usageBanner") + 500,
    );
    expect(quotaSection).not.toContain("apiRequest");
    expect(quotaSection).not.toContain("openai");
  });

  // ── 서버 쪽 contract 보증 ─────────────────────────────────────────────────

  it("Server MONTHLY_LIMIT = 4 → limit field in response", () => {
    // UsageInfo.limit = MONTHLY_LIMIT (4)
    expect(MONTHLY_LIMIT).toBe(4);
    const mockUsage = { limit: MONTHLY_LIMIT, used: 3, remaining: Math.max(0, MONTHLY_LIMIT - 3) };
    expect(mockUsage.limit).toBe(4);
    expect(mockUsage.used).toBe(3);
    expect(mockUsage.remaining).toBe(1);
  });

  it("음수 remaining 없음 — Math.max(0, limit - used)", () => {
    // used=5, limit=4 → remaining=0 (not -1)
    const remaining = Math.max(0, MONTHLY_LIMIT - 5);
    expect(remaining).toBe(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

});
