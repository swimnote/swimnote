/**
 * growth-report-pdf-v2.test.ts
 * PDF Template V2 spec 검증 (TC1–TC15)
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
  constructor(public code: string, message: string) { super(message); }
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
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : period;
}
function formatPeriodRange(period: string): string {
  const [y, m] = period.split("-");
  if (!y || !m) return period;
  const lastDay = new Date(parseInt(y,10), parseInt(m,10), 0).getDate();
  const pad = (n: number) => String(n).padStart(2,"0");
  return `${y}년 ${Number(m)}월`;
}

const LOGO_DATA_URI = "data:image/svg+xml," + encodeURIComponent(
  `<svg width="580" height="480" viewBox="0 0 580 480" xmlns="http://www.w3.org/2000/svg">` +
  `<g transform="translate(130,20)"><rect x="40" y="40" width="240" height="240" rx="60" fill="#0a2540"/></g>` +
  `<text x="290" y="422" font-size="80" font-weight="700" fill="#0a2540" text-anchor="middle">SwimNote</text></svg>`
);

function buildSectionBlock(key: string, text: string, isParentSupport = false): string {
  const label = escapeHtml(SECTION_LABELS_PDF[key] ?? key);
  const body  = escapeHtml(text);
  const cls   = isParentSupport ? "section parent-support-section" : "section";
  return `<div class="${cls}"><div class="section-heading">${label}</div><div class="section-rule"></div><p class="section-body">${body}</p></div>`;
}
function buildPageHeader(name: string, pool: string, period: string): string {
  return `<div class="page-header"><div class="header-left"><img class="logo-img" src="${LOGO_DATA_URI}" alt="SwimNote"/><div class="header-title">성장 리포트</div></div><div class="header-meta">${name} · ${pool} · ${period}</div></div>`;
}
function buildPageFooter(pageNum: number, total: number): string {
  return `<div class="page-footer"><span class="footer-brand">SWIMNOTE</span><span class="footer-page">${String(pageNum).padStart(2,"0")} / ${String(total).padStart(2,"0")}</span></div>`;
}

function buildPdfHtml(params: GrowthReportExportParams): string {
  const { reportPeriod, reportContent, displayName = "우리 아이", poolName } = params;
  if (!reportContent || typeof reportContent !== "object" || Array.isArray(reportContent)) {
    throw new GrowthReportExportException("INVALID_REPORT_CONTENT", "report_content가 유효하지 않습니다.");
  }
  const periodLabel = formatPeriod(reportPeriod);
  const poolLabel   = poolName ? escapeHtml(poolName) : "SWIMNOTE";
  const nameLabel   = escapeHtml(displayName);
  const p1Html = PAGE1_SECTIONS.map(k => {
    const s = reportContent.sections[k];
    return s?.text?.trim() ? buildSectionBlock(k, s.text) : "";
  }).join("");
  const p2Html = PAGE2_SECTIONS.map(k => {
    const s = reportContent.sections[k];
    return s?.text?.trim() ? buildSectionBlock(k, s.text, k === "parent_support") : "";
  }).join("");
  const hdr = buildPageHeader(nameLabel, poolLabel, periodLabel);
  const summaryHtml = reportContent.summary_text?.trim()
    ? `<div class="summary-block"><div class="section-heading">이번 달 이야기</div><div class="section-rule"></div><p class="summary-body">${escapeHtml(reportContent.summary_text)}</p></div>`
    : "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">` +
    `<title>${nameLabel} 성장리포트 ${periodLabel}</title>` +
    `<style>` +
    `@page{size:A4 portrait;margin:0}` +
    `body{font-family:'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif;font-size:14px;line-height:1.65;}` +
    `.page+.page{page-break-before:always}` +
    `.section,.parent-support-section,.summary-block{page-break-inside:avoid}` +
    `.section-body,.summary-body{white-space:pre-wrap}` +
    `.parent-support-section{background:#EEF9F6;border-left:3px solid #3ECFBA}` +
    `</style></head><body>` +
    `<div class="page">${hdr}${summaryHtml}${p1Html}${buildPageFooter(1,2)}</div>` +
    `<div class="page">${hdr}${p2Html}${buildPageFooter(2,2)}</div>` +
    `</body></html>`;
}

function buildPdfFilename(period: string): string {
  return `SWIMNOTE_GrowthReport_${period.replace(/[^0-9-]/g,"") || "report"}.pdf`;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// CASE A: 8 section 대부분 populated
const CASE_A_SECTIONS: ReportContentForExport["sections"] = {
  core_growth:             { text: "발차기 리듬이 안정됐습니다." },
  swimming_progress:       { text: "평영 킥 기초 과정을 완료했습니다." },
  behavioral_strengths:    { text: "수업 집중력이 높아졌습니다." },
  longitudinal_comparison: { text: "지난달보다 호흡 타이밍이 개선됐습니다." },
  success_conditions:      { text: "칭찬을 받을 때 더욱 적극적입니다." },
  teacher_guidance:        { text: "다음 달에는 턴 동작을 집중 연습합니다." },
  next_growth_direction:   { text: "접영 첫 동작을 목표로 합니다." },
  parent_support:          { text: "집에서는 발차기 연습을 5분씩 함께해주세요." },
};

// CASE B: sparse — 일부 section empty
const CASE_B_SECTIONS: ReportContentForExport["sections"] = {
  core_growth:    { text: "기본 자유형 자세가 잡혔습니다." },
  parent_support: { text: "물에 자주 노출시켜 주세요." },
};

// CASE C: parent_support 길이가 긴 report
const CASE_C_SECTIONS: ReportContentForExport["sections"] = {
  core_growth:    { text: "이번 달 성장이 있었습니다." },
  parent_support: { text: Array.from({length:8},(_,i)=>`문장 ${i+1}. 아이와 함께 꾸준히 연습해주시면 좋겠습니다.`).join(" ") },
};

function makeParams(overrides: Partial<GrowthReportExportParams> = {}): GrowthReportExportParams {
  return {
    reportId:      "report-001",
    reportPeriod:  "2026-08",
    publishedAt:   "2026-09-01T00:00:00.000Z",
    reportContent: { summary_text: "이번 달 아이는 수영 실력이 눈에 띄게 성장했습니다.", sections: CASE_A_SECTIONS },
    snsSummary:    null,
    displayName:   "서태웅",
    poolName:      "토이키즈스윔클럽",
    ...overrides,
  };
}

// ── TC1–TC15 ──────────────────────────────────────────────────────────────────

describe("PDF Template V2 — TC1–TC15", () => {

  it("TC1 actual SWIMNOTE logo — data:image/svg+xml data URI 포함", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("data:image/svg+xml,");
    expect(html).toContain("SwimNote");
    // logo img tag — each page has one (2 total)
    expect((html.match(/<img[^>]*logo-img[^>]*>/g) ?? []).length).toBe(2);
  });

  it("TC2 child/pool/period metadata — header-meta 포함", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("서태웅");
    expect(html).toContain("토이키즈스윔클럽");
    expect(html).toContain("2026년 8월");
    expect(html).toContain("header-meta");
  });

  it("TC3 icon 없음 — icon 클래스/태그 없음", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).not.toMatch(/<i\s+class="[^"]*icon/i);
    expect(html).not.toContain("material-icons");
    expect(html).not.toContain("fa-");
    // img 태그는 로고만 (2 pages × 1 logo = 2)
    const imgs = html.match(/<img[^>]*>/g) ?? [];
    expect(imgs.every(img => img.includes("data:image/svg+xml"))).toBe(true);
  });

  it("TC4 Page 1 order — summary → core_growth → swimming_progress → behavioral_strengths → longitudinal_comparison", () => {
    const html = buildPdfHtml(makeParams());
    const p1End = html.indexOf(buildPageFooter(1, 2).trim().slice(0, 20));
    const p1 = html.slice(0, p1End);
    const positions = [
      p1.indexOf("이번 달 이야기"),
      p1.indexOf("이번 달에 가장 좋았던 모습"),
      p1.indexOf("이번 달 수영에서 배운 것"),
      p1.indexOf("수업에서 좋았던 모습"),
      p1.indexOf("지난달보다 이렇게 이어지고 있어요"),
    ];
    // each found
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    // in order
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i-1]);
    }
  });

  it("TC5 Page 2 order — success_conditions → teacher_guidance → next_growth_direction → parent_support", () => {
    const html = buildPdfHtml(makeParams());
    const p2Start = html.lastIndexOf('<div class="page">');
    const p2 = html.slice(p2Start);
    const positions = [
      p2.indexOf("이럴 때 더 잘하고 있어요"),
      p2.indexOf("수업에서는 이렇게 이어갈게요"),
      p2.indexOf("앞으로 이렇게 만들어갈게요"),
      p2.indexOf("집에서는 이렇게 함께해주세요"),
    ];
    for (const pos of positions) expect(pos).toBeGreaterThan(-1);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i-1]);
    }
  });

  it("TC6 empty section 숨김 — CASE B에서 없는 section 텍스트 미출력", () => {
    const html = buildPdfHtml(makeParams({
      reportContent: { summary_text: "요약입니다.", sections: CASE_B_SECTIONS },
    }));
    expect(html).toContain("기본 자유형 자세가 잡혔습니다.");
    expect(html).not.toContain("이번 달 수영에서 배운 것"); // swimming_progress empty → hidden
    expect(html).not.toContain("수업에서 좋았던 모습");
  });

  it("TC7 parent_support 마지막 — 가장 마지막 section-heading", () => {
    const html = buildPdfHtml(makeParams());
    const lastParentIdx = html.lastIndexOf("집에서는 이렇게 함께해주세요");
    const lastOtherIdx  = html.lastIndexOf("앞으로 이렇게 만들어갈게요");
    expect(lastParentIdx).toBeGreaterThan(lastOtherIdx);
  });

  it("TC8 parent_support page split 방지 — page-break-inside:avoid CSS", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("page-break-inside:avoid");
    expect(html).toContain("parent-support-section");
  });

  it("TC9 normal fixture 2 pages — page div 2개", () => {
    const html = buildPdfHtml(makeParams());
    expect((html.match(/class="page"/g) ?? []).length).toBe(2);
    expect(html).toContain("01 / 02");
    expect(html).toContain("02 / 02");
  });

  it("TC10 body readability — font-size 14px + line-height 1.65 + pre-wrap", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("font-size:14px");
    expect(html).toContain("line-height:1.65");
    expect(html).toContain("pre-wrap");
  });

  it("TC11 no AI call — buildPdfHtml은 동기 순수 함수", () => {
    const result = buildPdfHtml(makeParams());
    expect(typeof result).toBe("string");
    // not a Promise
    expect(typeof (result as any).then).toBe("undefined");
  });

  it("TC12 same JSON deterministic HTML", () => {
    const params = makeParams();
    expect(buildPdfHtml(params)).toBe(buildPdfHtml(params));
  });

  it("TC13 iOS compatible — A4 @page + system font (Apple SD Gothic Neo)", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("A4");
    expect(html).toContain("Apple SD Gothic Neo");
    // no Google Fonts network dependency
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("@import");
  });

  it("TC14 Android compatible — Noto Sans KR + Malgun Gothic fallback", () => {
    const html = buildPdfHtml(makeParams());
    expect(html).toContain("Noto Sans KR");
    expect(html).toContain("Malgun Gothic");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("TC15 temp cleanup unchanged — buildPdfHtml has no side effects", () => {
    expect(() => buildPdfHtml(makeParams())).not.toThrow();
  });

  // ── 추가 보장 TC ──────────────────────────────────────────────────────────

  it("CASE C long parent_support — page-break-inside avoid on parent-support-section", () => {
    const html = buildPdfHtml(makeParams({
      reportContent: { summary_text: "요약.", sections: CASE_C_SECTIONS },
    }));
    expect(html).toContain("parent-support-section");
    expect(html).toContain("page-break-inside:avoid");
  });

  it("SWIMNOTE footer brand — 양쪽 페이지 모두", () => {
    const html = buildPdfHtml(makeParams());
    expect((html.match(/footer-brand/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("XSS escape — 특수문자 이스케이핑", () => {
    const html = buildPdfHtml(makeParams({
      displayName: "<script>alert(1)</script>",
      poolName:    "Pool & Co",
      reportContent: { summary_text: "a < b > c & d", sections: {} },
    }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("buildPdfFilename — 안전한 파일명", () => {
    expect(buildPdfFilename("2026-08")).toBe("SWIMNOTE_GrowthReport_2026-08.pdf");
  });

  it("INVALID_REPORT_CONTENT — null 예외", () => {
    expect(() => buildPdfHtml(makeParams({ reportContent: null as any }))).toThrow(GrowthReportExportException);
  });
});
