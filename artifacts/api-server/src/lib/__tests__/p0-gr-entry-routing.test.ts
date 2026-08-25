/**
 * p0-gr-entry-routing.test.ts
 * Growth Report Entry UX Fix — TC1–TC9
 *
 * AI calls:  0
 * DB write:  NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "../..");

const homeSrc   = readFileSync(join(ROOT, "artifacts/swim-app/app/(parent)/home.tsx"),  "utf-8");
const statusSrc = readFileSync(join(ROOT, "artifacts/swim-app/app/(parent)/growth-report-status.tsx"), "utf-8");
const legacyPath = join(ROOT, "artifacts/swim-app/app/(parent)/growth-report.tsx");

describe("Growth Report Entry UX Fix (TC1–TC9)", () => {

  it("TC1 Home GR button always navigates (no dead/no-op branch)", () => {
    // grReportId 있음 → detail
    expect(homeSrc).toMatch(/router\.push.*growth-report-detail.*grReportId/s);
    // grReportId 없음 → status screen (not legacy, not no-op)
    expect(homeSrc).toContain("growth-report-status?studentId=");
    // 버튼이 selectedStudent 없을 때 no-op 가능하지만, selectedStudent 있을 때는 반드시 navigate
    expect(homeSrc).not.toContain("growth-report?studentId=");
  });

  it("TC2 NOT_AVAILABLE screen visible — 전용 화면 존재 + 상태 표시", () => {
    expect(existsSync(join(ROOT, "artifacts/swim-app/app/(parent)/growth-report-status.tsx"))).toBe(true);
    expect(statusSrc).toContain("NOT_AVAILABLE");
    expect(statusSrc).toContain("수업 기록이 쌓이면");
  });

  it("TC3 NOT_AVAILABLE has action button (홈 or 수업 기록)", () => {
    // 전체 파일에서 필요한 문구 확인
    expect(statusSrc).toContain("홈으로 돌아가기");
    // 추가 설명 1줄
    expect(statusSrc).toContain("수업이 기록될수록");
    // NOT_AVAILABLE 카드 있음
    expect(statusSrc).toContain("수업 기록이 쌓이면");
  });

  it("TC4 DATA_ACCUMULATING has action button", () => {
    expect(statusSrc).toContain("DATA_ACCUMULATING");
    expect(statusSrc).toContain("수업 기록 확인하기");
    // 홈 버튼도 포함 (공통)
    expect(statusSrc).toContain("홈으로 돌아가기");
  });

  it("TC5 PUBLISHED redirects to detail (router.replace)", () => {
    expect(statusSrc).toContain("PUBLISHED");
    expect(statusSrc).toContain("growth-report-detail");
    expect(statusSrc).toContain("router.replace");
  });

  it("TC6 FAILED retry works — 재시도 버튼 있음", () => {
    expect(statusSrc).toContain("FAILED");
    expect(statusSrc).toContain("다시 시도");
    expect(statusSrc).toContain("handleRetry");
  });

  it("TC7 no legacy screen route — growth-report? path 없음", () => {
    expect(homeSrc).not.toContain("growth-report?studentId=");
    expect(statusSrc).not.toContain("growth-report?studentId=");
  });

  it("TC8 no AI call — apiRequest only calls growth-report-status endpoint (read-only)", () => {
    // apiRequest 호출이 status endpoint 조회뿐
    const apiCalls = statusSrc.match(/apiRequest\([^)]+\)/g) ?? [];
    expect(apiCalls.length).toBeGreaterThanOrEqual(1);
    apiCalls.forEach(call => {
      expect(call).not.toContain("generate");
      expect(call).not.toContain("create");
      expect(call).not.toContain("analyze");
    });
    expect(statusSrc).toContain("growth-report-status");
  });

  it("TC9 no DB write — status screen은 DB 직접 쓰기 없음", () => {
    expect(statusSrc).not.toContain("executeSql");
    expect(statusSrc).not.toContain("INSERT INTO");
    expect(statusSrc).not.toContain("UPDATE ");
    expect(statusSrc).not.toContain("DELETE FROM");
  });

});
