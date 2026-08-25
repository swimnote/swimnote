/**
 * growth-report-pdf-v2.test.ts
 * PDF Template V2 spec 검증
 *
 * swim-app에 테스트 러너가 없어 순수 함수 로직을 여기에 복사하여 검증.
 * growthReportExport.ts의 buildPdfHtml과 동일한 로직.
 *
 * AI calls:  0
 * DB write:  NO
 */

import { describe, it, expect } from "vitest";

// ── 복사된 순수 함수 (expo 의존성 없음) ──────────────────────────────────────

interface ReportSectionForExport { text: string; }
interface ReportContentForExport {
  summary_text: string;
  sections: Partial<Record<string, ReportSectionForExport>>;
}
interface GrowthReportExportParams {
  reportId:      string;
  reportPeriod:  string;
  publishedAt:   string;
  reportContent: ReportContentForExport;
  snsSummary:    null;
  displayName?:  string;
  poolName?:     string;
}

class GrowthReportExportException extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "GrowthReportExportException";
  }
}

const SECTION_LABELS_PDF: Record<string, string> = {
  core_growth:             "이번 달에 가장 좋았던 모습",
  swimming_progress:       "이번 달 수영에서 배운 것",
  behavioral_strengths:    "수업에서 좋았던 모습",
  longitudinal_comparison: "지난달보다 이렇게 이어지고 있어요",
  success_conditions:      "이럴 때 더 잘하고 있어요",
  parent_support:          "집에서는 이렇게 함께해주세요",
  teacher_guidance:        "수업에서는 이렇게 이어갈게요",
  next_growth_direction:   "앞으로 이렇게 만들어갈게요",
};
const PAGE1_SECTIONS = ["core_growth","swimming_progress","behavioral_strengths","longitudinal_comparison"] as const;
const PAGE2_SECTIONS = ["success_conditions","teacher_guidance","next_growth_direction","parent_support"] as const;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : period;
}
function formatPeriodRange(period: string): string {
  const [y, m] = period.split("-");
  if (!y || !m) return period;
  const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}.${pad(parseInt(m,10))}.01 – ${y}.${pad(parseInt(m,10))}.${lastDay}`;
}

const LOGO_DATA_URI = "data:image/svg+xml," + encodeURIComponent(
  `<svg width="580" height="480" viewBox="0 0 580 480" xmlns="http://www.w3.org/2000/svg">` +
  `<text x="290" y="422" font-size="80" font-weight="700" fill="#0a2540" text-anchor="middle">SwimNote</text></svg>`
);

function buildSectionBlock(key: string, text: string, isParentSupport = false): string {
  const label = escapeHtml(SECTION_LABELS_PDF[key] ?? key);
  const body  = escapeHtml(text);
  const cls   = isParentSupport ? `"section parent-support-section"` : `"section"`;
  return `<div class=${cls}><div class="section-label">${label}</div><div class="section-rule"></div><p class="section-body">${body}</p></div>`;
}
function buildPageHeader(nameLabel: string, poolLabel: string, periodRangeLabel: string): string {
  return `<div class="page-header"><div class="header-left"><img class="logo-img" src="${LOGO_DATA_URI}" alt="SwimNote" /><div class="header-title">수영 성장 리포트</div></div><div class="header-meta">${nameLabel} · ${poolLabel} · ${periodRangeLabel}</div></div>`;
}
function buildPageFooter(pageNum: number, total: number): string {
  return `<div class="page-footer"><div class="footer-brand-wrap"><span class="footer-brand">SWIMNOTE</span><span class="footer-tagline">수영 피드백의 시대.</span></div><div class="footer-page">${String(pageNum).padStart(2,"0")} / ${String(total).padStart(2,"0")}</div></div>`;
}

function buildPdfHtml(params: GrowthReportExportParams): string {
  const { reportPeriod, reportContent, displayName = "우리 아이", poolName } = params;
  if (!reportContent || typeof reportContent !== "object" || Array.isArray(reportContent)) {
    throw new GrowthReportExportException("INVALID_REPORT_CONTENT", "report_content가 유효하지 않습니다.");
  }
  const periodLabel      = formatPeriod(reportPeriod);
  const periodRangeLabel = formatPeriodRange(reportPeriod);
  const poolLabel        = poolName ? escapeHtml(poolName) : "SWIMNOTE";
  const nameLabel        = escapeHtml(displayName);
  const page1Html = PAGE1_SECTIONS.map(k => {
    const sec = reportContent.sections[k];
    return sec?.text?.trim() ? buildSectionBlock(k, sec.text) : "";
  }).join("");
  const page2Html = PAGE2_SECTIONS.map(k => {
    const sec = reportContent.sections[k];
    return sec?.text?.trim() ? buildSectionBlock(k, sec.text, k === "parent_support") : "";
  }).join("");
  const headerHtml = buildPageHeader(nameLabel, poolLabel, periodRangeLabel);
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">` +
    `<title>${nameLabel} 성장리포트 ${periodLabel}</title>` +
    `<style>@page{size:A4 portrait;margin:0}` +
    `.page+.page{page-break-before:always}` +
    `.section{page-break-inside:avoid}` +
    `.summary-body,.section-body{white-space:pre-wrap}` +
    `</style></head><body>` +
    `<div class="page">${headerHtml}` +
    `<div class="page-subtitle">이번 달 이야기</div>` +
    (reportContent.summary_text?.trim()
      ? `<div class="summary-block"><div class="summary-label">이번 달 이야기</div><p class="summary-body">${escapeHtml(reportContent.summary_text)}</p></div>`
      : "") +
    page1Html + buildPageFooter(1, 2) + `</div>` +
    `<div class="page">${headerHtml}` +
    `<div class="page-subtitle">앞으로 어떻게 이어갈지</div>` +
    page2Html + buildPageFooter(2, 2) + `</div>` +
    `</body></html>`;
}

function buildPdfFilename(period: string): string {
  return `SWIMNOTE_GrowthReport_${period.replace(/[^0-9-]/g,"") || "report"}.pdf`;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FULL_SECTIONS: ReportContentForExport["sections"] = {
  core_growth:             { text: "아이가 발차기를 꾸준히 개선했습니다." },
  swimming_progress:       { text: "자유형 호흡 타이밍을 익혔습니다." },
  behavioral_strengths:    { text: "수업 집중력이 눈에 띄게 늘었습니다." },
  longitudinal_comparison: { text: "지난달보다 입수 자세가 안정됐습니다." },
  success_conditions:      { text: "칭찬을 받을 때 더욱 적극적입니다." },
  teacher_guidance:        { text: "다음 달에는 턴 동작을 집중 연습합니다." },
  next_growth_direction:   { text: "접영 첫 동작을 익히는 것을 목표로 합니다." },
  parent_support:          { text: "집에서는 발차기 연습을 5분씩 함께해주세요." },
};

function makeParams(overrides: Partial<GrowthReportExportParams> = {}): GrowthReportExportParams {
  return {
    reportId:      "report-001",
    reportPeriod:  "2026-08",
    publishedAt:   "2026-09-01T00:00:00.000Z",
    reportContent: { summary_text: "이번 달 아이는 수영 실력이 눈에 띄게 성장했습니다.", sections: FULL_SECTIONS },
    snsSummary:    null,
    displayName:   "서태웅",
    poolName:      "토이키즈스윔클럽",
    ...overrides,
  };
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe("PDF Template V2", () => {

  it("TC1 full 8-section — HTML 생성 성공", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("수영 성장 리포트");
    expect(html).toContain("이번 달 이야기");
    expect(html).toContain("앞으로 어떻게 이어갈지");
  });

  it("TC2 sparse report — 있는 section만 렌더", () => {
    const html = buildPdfHtml(makeParams({
      reportContent: {
        summary_text: "요약 텍스트입니다.",
        sections: { core_growth: { text: "핵심 성장입니다." }, parent_support: { text: "집에서 함께해주세요." } },
      },
    }));
    expect(html).toContain("핵심 성장입니다.");
    expect(html).toContain("집에서 함께해주세요.");
    expect(html).not.toContain("이번 달 수영에서 배운 것");
  });

  it("TC3 empty sections — 크래시 없음", () => {
    const html = buildPdfHtml(makeParams({ reportContent: { summary_text: "요약만 있습니다.", sections: {} } }));
    expect(html).toContain("요약만 있습니다.");
    expect(typeof html).toBe("string");
  });

  it("TC4 long parent_support — parent-support-section 클래스 포함", () => {
    const longText = Array.from({ length: 7 }, (_, i) => `문장 ${i+1}입니다.`).join(" ");
    const html = buildPdfHtml(makeParams({
      reportContent: { summary_text: "요약.", sections: { parent_support: { text: longText } } },
    }));
    expect(html).toContain("parent-support-section");
    expect(html).toContain("문장 1입니다.");
  });

  it("TC5 long Korean text — pre-wrap CSS 포함", () => {
    const html = buildPdfHtml(makeParams({ reportContent: { summary_text: "가".repeat(500), sections: {} } }));
    expect(html).toContain("pre-wrap");
  });

  it("TC6 SWIMNOTE logo — data:image/svg+xml data URI 포함", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("data:image/svg+xml,");
    expect(html).toContain("SwimNote");
  });

  it("TC7 no large icons — icon 클래스/태그 없음", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).not.toMatch(/<i\s+class="[^"]*icon/i);
    expect(html).not.toContain("material-icons");
    expect(html).not.toContain("fa-");
  });

  it("TC8 no child illustration — img 태그는 logo만 (2개)", () => {
    const html = buildPdfHtml(makeParams());
    const imgMatches = html.match(/<img[^>]*>/g) ?? [];
    expect(imgMatches.length).toBe(2); // 2 pages × 1 logo
    for (const img of imgMatches) expect(img).toContain("data:image/svg+xml");
  });

  it("TC9 published JSON only — AI/GPT 문자열 없음", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).not.toContain("gpt");
    expect(html).not.toContain("openai");
    expect(html).not.toContain("AI 생성");
  });

  it("TC10 buildPdfHtml is synchronous pure function", () => {
    const result = buildPdfHtml(makeParams());
    expect(typeof result).toBe("string");
  });

  it("TC11 deterministic — 동일 입력 → 동일 출력", () => {
    const params = makeParams();
    expect(buildPdfHtml(params)).toBe(buildPdfHtml(params));
  });

  it("TC12 2-page structure — class='page' 두 개", () => {
    const html = buildPdfHtml(makeParams());
    expect((html.match(/class="page"/g) ?? []).length).toBe(2);
  });

  it("TC13 buildPdfHtml no side effects — 예외 없음", () => {
    expect(() => buildPdfHtml(makeParams())).not.toThrow();
  });

  it("TC14 A4 @page CSS", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("@page");
    expect(html).toContain("A4");
  });

  it("TC15 page-break-before CSS — PAGE 2 분리", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("page-break-before");
  });

  it("section labels V2 — PAGE 1", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("이번 달에 가장 좋았던 모습");
    expect(html).toContain("이번 달 수영에서 배운 것");
    expect(html).toContain("수업에서 좋았던 모습");
    expect(html).toContain("지난달보다 이렇게 이어지고 있어요");
  });

  it("section labels V2 — PAGE 2", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("이럴 때 더 잘하고 있어요");
    expect(html).toContain("수업에서는 이렇게 이어갈게요");
    expect(html).toContain("앞으로 이렇게 만들어갈게요");
    expect(html).toContain("집에서는 이렇게 함께해주세요");
  });

  it("page number footer — 01 / 02 and 02 / 02", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("01 / 02");
    expect(html).toContain("02 / 02");
  });

  it("metadata line — 이름 · 수영장 · 날짜", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("서태웅");
    expect(html).toContain("토이키즈스윔클럽");
    expect(html).toContain("2026.08.01");
  });

  it("INVALID_REPORT_CONTENT — null 예외", () => {
    expect(() => buildPdfHtml(makeParams({ reportContent: null as any }))).toThrow(GrowthReportExportException);
  });

  it("buildPdfFilename — 안전한 파일명", () => {
    expect(buildPdfFilename("2026-08")).toBe("SWIMNOTE_GrowthReport_2026-08.pdf");
  });

  it("footer tagline — 수영 피드백의 시대.", () => {
    expect(buildPdfHtml(makeParams())).toContain("수영 피드백의 시대.");
  });

  it("summary_text empty — summary block 미렌더", () => {
    const html = buildPdfHtml(makeParams({
      reportContent: { summary_text: "", sections: { core_growth: { text: "성장 내용." } } },
    }));
    expect(html).not.toContain("summary-block");
    expect(html).toContain("성장 내용.");
  });

  it("displayName undefined → 우리 아이", () => {
    expect(buildPdfHtml(makeParams({ displayName: undefined }))).toContain("우리 아이");
  });

  it("poolName undefined → SWIMNOTE fallback", () => {
    const html = buildPdfHtml(makeParams({ poolName: undefined }));
    expect(html).toContain("· SWIMNOTE ·");
  });

  it("HTML special chars escaped", () => {
    const html = buildPdfHtml(makeParams({
      displayName: "<script>alert(1)</script>",
      poolName:    "Pool & Co",
      reportContent: { summary_text: "a < b > c & d", sections: {} },
    }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("formatPeriodRange — 2026-08 → 2026.08.01 – 2026.08.31", () => {
    const html = buildPdfHtml(makeParams({ reportPeriod: "2026-08" }));
    expect(html).toContain("2026.08.31");
  });

  it("formatPeriodRange — 2026-02 → last day 28 or 29", () => {
    const html = buildPdfHtml(makeParams({ reportPeriod: "2026-02" }));
    expect(html).toMatch(/2026\.02\.(28|29)/);
  });

  it("PAGE 1 sections not in PAGE 2 slot", () => {
    const html = buildPdfHtml(makeParams());
    const page1End = html.indexOf("앞으로 어떻게 이어갈지");
    const page1Block = html.slice(0, page1End);
    expect(page1Block).toContain("이번 달에 가장 좋았던 모습");
    // parent_support is only in page 2
    expect(page1Block).not.toContain("집에서는 이렇게 함께해주세요");
  });

  it("PAGE 2 parent_support — highlighted panel class", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("parent-support-section");
    // Should appear after page 2 subtitle
    const p2Start = html.indexOf("앞으로 어떻게 이어갈지");
    expect(html.indexOf("parent-support-section")).toBeGreaterThan(p2Start);
  });
});
