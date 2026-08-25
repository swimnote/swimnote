/**
 * p0-gr-entry-routing.test.ts
 * PRE-UIUX P0 Hard Fix — Growth Report Entry Routing
 *
 * TC1~TC8: home.tsx의 "AI 성장 리포트" 버튼이
 *   legacy growth-report.tsx가 아닌
 *   NEW FREE Growth Report 화면으로 연결되는지 검증.
 *
 * AI calls:  0
 * DB write:  NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "../..");

const homeSrc = readFileSync(
  join(ROOT, "artifacts/swim-app/app/(parent)/home.tsx"),
  "utf-8",
);

const statusScreenPath = join(ROOT, "artifacts/swim-app/app/(parent)/growth-report-status.tsx");
const legacyScreenPath = join(ROOT, "artifacts/swim-app/app/(parent)/growth-report.tsx");

describe("P0 Hard Fix — Growth Report Entry Routing (TC1–TC8)", () => {

  it("TC1 AI Growth Report entry가 legacy growth-report.tsx를 열지 않음", () => {
    // legacy fallback path (growth-report?studentId=) 코드가 home.tsx에 없어야 함
    expect(homeSrc).not.toContain("growth-report?studentId");
    // P0 Hard Fix 주석이 있어야 함
    expect(homeSrc).toContain("legacy growth-report.tsx");
    expect(homeSrc).toContain("금지");
  });

  it("TC2 PUBLISHED → new growth-report-detail 화면", () => {
    expect(homeSrc).toMatch(/router\.push.*growth-report-detail.*grReportId/s);
  });

  it("TC3 DATA_ACCUMULATING / NOT_AVAILABLE → growth-report-status 전용 화면 (legacy 아님)", () => {
    // 버튼 onPress에서 growth-report-status 사용
    expect(homeSrc).toContain("growth-report-status?studentId=");
    // legacy growth-report? path 없음
    expect(homeSrc).not.toContain("growth-report?studentId=");
  });

  it("TC4 growth-report-status.tsx 파일 존재", () => {
    expect(existsSync(statusScreenPath)).toBe(true);
  });

  it("TC5 growth-report-status.tsx — studentId param + status API 사용", () => {
    const src = readFileSync(statusScreenPath, "utf-8");
    expect(src).toContain("studentId");
    expect(src).toContain("useLocalSearchParams");
    expect(src).toContain("growth-report-status");
    // API 호출 (apiRequest)
    expect(src).toContain("apiRequest");
  });

  it("TC6 growth-report-status.tsx — PUBLISHED 시 detail 화면으로 redirect", () => {
    const src = readFileSync(statusScreenPath, "utf-8");
    expect(src).toContain("PUBLISHED");
    expect(src).toContain("growth-report-detail");
    expect(src).toContain("router.replace");
  });

  it("TC7 growth-report-status.tsx — NOT_AVAILABLE 안내 문구 포함", () => {
    const src = readFileSync(statusScreenPath, "utf-8");
    expect(src).toContain("NOT_AVAILABLE");
    expect(src).toContain("수업 기록이 쌓이면");
  });

  it("TC8 legacy 출석 통계 화면 보존 — growth-report.tsx 파일 삭제되지 않음", () => {
    expect(existsSync(legacyScreenPath)).toBe(true);
  });

});
