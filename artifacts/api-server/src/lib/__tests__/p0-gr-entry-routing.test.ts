/**
 * p0-gr-entry-routing.test.ts
 * PRE-UIUX P0 Fix — Growth Report Entry Routing
 *
 * TC1~TC8: home.tsx의 "AI 성장 리포트" 버튼이
 *   구형 소개 모달 대신 실제 growth-report-detail 화면으로 연결되는지 검증.
 *
 * AI calls:  0
 * DB write:  NO
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const homeSrc = readFileSync(
  join(process.cwd(), "../../artifacts/swim-app/app/(parent)/home.tsx"),
  "utf-8",
);

describe("P0 Fix — Growth Report Entry Routing (TC1–TC8)", () => {

  it("TC1 Growth Report 버튼 onPress — growth-report-detail 라우팅 포함", () => {
    expect(homeSrc).toContain("growth-report-detail");
    expect(homeSrc).toContain("grReportId");
    // onPress가 growth-report-detail로 push하는 로직
    expect(homeSrc).toMatch(/router\.push.*growth-report-detail.*grReportId/s);
  });

  it("TC2 구형 소개 모달 미노출 — AI 성장 리포트 버튼이 setAiModalType('report') 호출 안 함", () => {
    // P0 fix: 버튼 onPress에서 setAiModalType("report") 제거됨
    // AI 성장 리포트 버튼 근처에서 setAiModalType("report") 가 없어야 함
    // (curriculum 버튼은 여전히 setAiModalType("curriculum") 사용 가능)
    const btnBlock = homeSrc.slice(
      homeSrc.indexOf("AI 성장 리포트"),
      homeSrc.indexOf("AI 성장 리포트") + 300,
    );
    expect(btnBlock).not.toContain('setAiModalType("report")');
  });

  it("TC3 selectedStudent.id 사용 — grReportId는 selectedStudent 기반 status 응답에서 세팅", () => {
    // loadReportStatus가 selectedStudent.id를 사용
    expect(homeSrc).toContain("loadReportStatus(selectedStudent.id)");
    // grReportId가 data.report_id에서 세팅됨
    expect(homeSrc).toContain("setGrReportId");
    expect(homeSrc).toContain("data.report_id");
  });

  it("TC4 PUBLISHED → detail route — grReportId 존재 시 growth-report-detail로 push", () => {
    expect(homeSrc).toMatch(/if\s*\(grReportId\)/);
    expect(homeSrc).toMatch(/router\.push.*growth-report-detail\?reportId/);
  });

  it("TC5 non-PUBLISHED → existing status path — grReportId null이면 네비게이션 없음", () => {
    // grReportId가 null이면 router.push 호출 안 함 (if 조건으로 보호)
    // 인라인 status 카드가 home 화면에 이미 존재
    expect(homeSrc).toContain("grStatus === \"DATA_ACCUMULATING\"");
    expect(homeSrc).toContain("grStatus === \"GENERATING\"");
  });

  it("TC6 새 AI call 없음 — 버튼 onPress에 AI 호출 코드 없음", () => {
    const btnRegion = homeSrc.slice(
      homeSrc.lastIndexOf("AI 성장 리포트") - 400,
      homeSrc.lastIndexOf("AI 성장 리포트") + 400,
    );
    expect(btnRegion).not.toContain("apiRequest(");
    expect(btnRegion).not.toContain("fetch(");
    expect(btnRegion).not.toContain("openai");
  });

  it("TC7 새 DB write 없음 — 버튼 routing은 read-only 네비게이션", () => {
    const btnRegion = homeSrc.slice(
      homeSrc.lastIndexOf("AI 성장 리포트") - 400,
      homeSrc.lastIndexOf("AI 성장 리포트") + 400,
    );
    expect(btnRegion).not.toContain("POST");
    expect(btnRegion).not.toContain("PUT");
    expect(btnRegion).not.toContain("DELETE");
  });

  it("TC8 Curriculum Search 버튼 영향 없음 — curriculum-chat 라우팅 유지", () => {
    // curriculum 버튼은 curriculum-chat으로 push
    expect(homeSrc).toContain("curriculum-chat");
    // curriculum 버튼은 여전히 selectedStudent 기반
    expect(homeSrc).toMatch(/pathname.*curriculum-chat/);
  });

});
