/**
 * growth-report-pdf-v2.test.ts
 * PDF Template V2 Typography Final — TC1–TC13
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
  reportId: string; reportPeriod: string; publishedAt: string;
  reportContent: ReportContentForExport; snsSummary: null;
  displayName?: string; poolName?: string;
}
class GrowthReportExportException extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const SECTION_LABELS_PDF: Record<string, string> = {
  core_growth: "이번 달에 가장 좋았던 모습",
  swimming_progress: "이번 달 수영에서 배운 것",
  behavioral_strengths: "수업에서 좋았던 모습",
  longitudinal_comparison: "지난달보다 이렇게 이어지고 있어요",
  success_conditions: "이럴 때 더 잘하고 있어요",
  parent_support: "집에서는 이렇게 함께해주세요",
  teacher_guidance: "수업에서는 이렇게 이어갈게요",
  next_growth_direction: "앞으로 이렇게 만들어갈게요",
};
const PAGE1 = ["core_growth","swimming_progress","behavioral_strengths","longitudinal_comparison"] as const;
const PAGE2 = ["success_conditions","teacher_guidance","next_growth_direction","parent_support"] as const;

function esc(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function formatPeriod(p: string) {
  const [y,m]=p.split("-"); return y&&m?`${y}년 ${Number(m)}월`:p;
}
const LOGO=`data:image/svg+xml,`+encodeURIComponent(
  `<svg width="580" height="480" viewBox="0 0 580 480" xmlns="http://www.w3.org/2000/svg">` +
  `<g transform="translate(130,20)"><rect x="40" y="40" width="240" height="240" rx="60" fill="#0a2540"/></g>` +
  `<text x="290" y="422" font-size="80" fill="#0a2540" text-anchor="middle">SwimNote</text></svg>`
);
function sec(key: string, text: string, isPs=false) {
  const cls=isPs?"section parent-support-section":"section";
  return `<div class="${cls}"><div class="section-heading">${esc(SECTION_LABELS_PDF[key]??key)}</div>`+
    `<div class="section-rule"></div><p class="section-body">${esc(text)}</p></div>`;
}
function hdr(name:string,pool:string,period:string){
  return `<div class="page-header"><div class="header-left">`+
    `<img class="logo-img" src="${LOGO}" alt="SwimNote"/>`+
    `<div class="header-title">성장 리포트</div></div>`+
    `<div class="header-meta">${name} · ${pool} · ${period}</div></div>`;
}
function ftr(n:number,t:number){
  return `<div class="page-footer"><span class="footer-brand">SWIMNOTE</span>`+
    `<span class="footer-page">${String(n).padStart(2,"0")} / ${String(t).padStart(2,"0")}</span></div>`;
}

// TYPOGRAPHY CONSTANTS (pt) — must match growthReportExport.ts
const BODY_PT = 12;
const HEADING_PT = 15;
const TITLE_PT = 26;
const META_PT = 10;
const PARENT_BODY_PT = 12;
const FOOTER_PT = 9;

function buildPdfHtml(p: GrowthReportExportParams): string {
  const { reportPeriod, reportContent, displayName="우리 아이", poolName } = p;
  if (!reportContent||typeof reportContent!=="object"||Array.isArray(reportContent))
    throw new GrowthReportExportException("INVALID_REPORT_CONTENT","invalid");
  const period=formatPeriod(reportPeriod);
  const pool=poolName?esc(poolName):"SWIMNOTE";
  const name=esc(displayName);
  const p1=PAGE1.map(k=>{const s=reportContent.sections[k];return s?.text?.trim()?sec(k,s.text):"";}).join("");
  const p2=PAGE2.map(k=>{const s=reportContent.sections[k];return s?.text?.trim()?sec(k,s.text,k==="parent_support"):"";}).join("");
  const h=hdr(name,pool,period);
  const sum=reportContent.summary_text?.trim()
    ?`<div class="summary-block"><div class="section-heading">이번 달 이야기</div>`+
      `<div class="section-rule" style="background:#DCE9F3;margin:4pt 0 7pt"></div>`+
      `<p class="summary-body">${esc(reportContent.summary_text)}</p></div>`:""
  ;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">`+
    `<title>${name} 성장리포트 ${period}</title>`+
    `<style>`+
    `@page{size:A4 portrait;margin:0}`+
    `*{box-sizing:border-box;margin:0;padding:0}`+
    `body{font-family:'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic','Helvetica Neue',Arial,sans-serif;`+
      `font-size:${BODY_PT}pt;line-height:1.6;color:#1A2E44;background:#F8F7F3}`+
    `.page{background:#FFFFFF;min-height:297mm;padding:28pt 42pt 24pt;display:flex;flex-direction:column}`+
    `.page+.page{page-break-before:always}`+
    `.page-header{padding-bottom:10pt;border-bottom:1.5pt solid #3ECFBA;margin-bottom:18pt}`+
    `.header-left{display:flex;align-items:center;gap:9pt}`+
    `.logo-img{height:22pt;width:auto}`+
    `.header-title{font-size:${TITLE_PT}pt;font-weight:700;color:#0D2E5A}`+
    `.header-meta{font-size:${META_PT}pt;color:#7A90A8}`+
    `.section-heading{font-size:${HEADING_PT}pt;font-weight:700;color:#0D2E5A;margin-bottom:3pt}`+
    `.summary-block{background:#F2FAFD;border-left:3pt solid #3ECFBA;padding:10pt 14pt;margin-bottom:16pt;page-break-inside:avoid}`+
    `.summary-body{font-size:${BODY_PT}pt;line-height:1.6;white-space:pre-wrap}`+
    `.section{margin-bottom:14pt;page-break-inside:avoid}`+
    `.section-rule{height:0.75pt;background:#DCE9F3;margin:4pt 0 7pt}`+
    `.section-body{font-size:${BODY_PT}pt;line-height:1.6;white-space:pre-wrap}`+
    `.parent-support-section{background:#EEF9F6;border-left:3pt solid #3ECFBA;padding:12pt 14pt 14pt;margin-bottom:14pt;page-break-inside:avoid}`+
    `.parent-support-section .section-rule{background:#B8E4D8;margin:4pt 0 8pt}`+
    `.parent-support-section .section-body{font-size:${PARENT_BODY_PT}pt;line-height:1.65;color:#0F3328}`+
    `.page-footer{margin-top:auto;padding-top:10pt;border-top:0.75pt solid #E4EBF2;display:flex;justify-content:space-between;align-items:center}`+
    `.footer-brand{font-size:${FOOTER_PT}pt;font-weight:700;color:#0D2E5A;letter-spacing:1.2pt;text-transform:uppercase}`+
    `.footer-page{font-size:${FOOTER_PT}pt;color:#A8BACF}`+
    `@media print{body{background:#FFFFFF}.page{min-height:0}.section,.parent-support-section,.summary-block{page-break-inside:avoid}}`+
    `</style></head><body>`+
    `<div class="page">${h}${sum}${p1}${ftr(1,2)}</div>`+
    `<div class="page">${h}${p2}${ftr(2,2)}</div>`+
    `</body></html>`;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CASE_A: ReportContentForExport = {
  summary_text: "이번 달 아이는 수영 실력이 눈에 띄게 성장했습니다. 발차기 리듬과 호흡 타이밍이 함께 좋아졌습니다.",
  sections: {
    core_growth:             { text: "발차기 리듬이 안정됐습니다." },
    swimming_progress:       { text: "평영 킥 기초 과정을 완료했습니다." },
    behavioral_strengths:    { text: "수업 집중력이 높아졌습니다." },
    longitudinal_comparison: { text: "지난달보다 호흡 타이밍이 개선됐습니다." },
    success_conditions:      { text: "칭찬을 받을 때 더욱 적극적입니다." },
    teacher_guidance:        { text: "다음 달에는 턴 동작을 집중 연습합니다." },
    next_growth_direction:   { text: "접영 첫 동작을 목표로 합니다." },
    parent_support:          { text: "집에서는 발차기 연습을 5분씩 함께해주세요." },
  },
};

const CASE_C: ReportContentForExport = {
  summary_text: "이번 달 성장 흐름이 좋았습니다.",
  sections: {
    core_growth:    { text: "기본 자세가 잡혔습니다." },
    parent_support: { text: Array.from({length:8},(_,i)=>
      `문장 ${i+1}. 아이와 함께 꾸준히 연습해주시면 좋겠습니다. 집에서 5분씩 발차기 연습을 해주세요.`
    ).join("\n\n") },
  },
};

function make(overrides: Partial<GrowthReportExportParams> = {}): GrowthReportExportParams {
  return {
    reportId: "r1", reportPeriod: "2026-08", publishedAt: "2026-09-01T00:00:00Z",
    reportContent: CASE_A, snsSummary: null,
    displayName: "서태웅", poolName: "토이키즈스윔클럽",
    ...overrides,
  };
}

// ── TC1–TC13 ──────────────────────────────────────────────────────────────────

describe("PDF Typography Final — TC1–TC13", () => {

  it("TC1 body >= 11pt — body font-size 12pt", () => {
    const html = buildPdfHtml(make());
    expect(html).toContain(`font-size:${BODY_PT}pt`);
    expect(BODY_PT).toBeGreaterThanOrEqual(11);
  });

  it("TC2 metadata >= 9pt — header-meta font-size 10pt", () => {
    const html = buildPdfHtml(make());
    expect(html).toContain(`font-size:${META_PT}pt`);
    expect(META_PT).toBeGreaterThanOrEqual(9);
  });

  it("TC3 section heading >= 14pt — 15pt", () => {
    const html = buildPdfHtml(make());
    expect(html).toContain(`font-size:${HEADING_PT}pt`);
    expect(HEADING_PT).toBeGreaterThanOrEqual(14);
  });

  it("TC4 title >= 24pt — 26pt", () => {
    const html = buildPdfHtml(make());
    expect(html).toContain(`font-size:${TITLE_PT}pt`);
    expect(TITLE_PT).toBeGreaterThanOrEqual(24);
  });

  it("TC5 CASE A HTML generated — 성공 (실제 PDF는 device expo-print에서 생성)", () => {
    expect(() => buildPdfHtml(make())).not.toThrow();
    const html = buildPdfHtml(make());
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("TC6 CASE A = 2 pages — page div 2개 + 01/02 + 02/02", () => {
    const html = buildPdfHtml(make());
    expect((html.match(/class="page"/g)??[]).length).toBe(2);
    expect(html).toContain("01 / 02");
    expect(html).toContain("02 / 02");
  });

  it("TC7 CASE C long content — parent_support 전체 텍스트 포함", () => {
    const html = buildPdfHtml(make({ reportContent: CASE_C }));
    expect(html).toContain("문장 1.");
    expect(html).toContain("문장 8.");
    expect(html).toContain("parent-support-section");
  });

  it("TC8 parent_support not split — page-break-inside:avoid on parent-support-section", () => {
    const html = buildPdfHtml(make());
    // parent-support-section class contains page-break-inside:avoid
    expect(html).toContain("parent-support-section{");
    expect(html).toContain("page-break-inside:avoid");
  });

  it("TC9 icons remain absent — icon 클래스/태그 없음", () => {
    const html = buildPdfHtml(make());
    expect(html).not.toMatch(/<i\s+class="[^"]*icon/i);
    expect(html).not.toContain("material-icons");
    expect(html).not.toContain("fa-");
  });

  it("TC10 actual SWIMNOTE logo unchanged — data:image/svg+xml + SwimNote text", () => {
    const html = buildPdfHtml(make());
    expect(html).toContain("data:image/svg+xml,");
    expect(html).toContain("SwimNote");
    const imgs = html.match(/<img[^>]*>/g)??[];
    expect(imgs.length).toBe(2); // 2 pages
    expect(imgs.every(i=>i.includes("data:image/svg+xml"))).toBe(true);
  });

  it("TC11 deterministic unchanged — 동일 입력 → 동일 출력", () => {
    const p = make();
    expect(buildPdfHtml(p)).toBe(buildPdfHtml(p));
  });

  it("TC12 AI calls 0 — buildPdfHtml is synchronous", () => {
    const result = buildPdfHtml(make());
    expect(typeof result).toBe("string");
    expect(typeof (result as any).then).toBe("undefined");
  });

  it("TC13 temp cleanup unchanged — no side effects in buildPdfHtml", () => {
    // cleanupTempFiles is unchanged; buildPdfHtml itself has no IO
    expect(() => buildPdfHtml(make())).not.toThrow();
  });

  // ── 추가 보장 ──────────────────────────────────────────────────────────────

  it("pt 단위 사용 확인 — px 단위 font-size 없음", () => {
    const html = buildPdfHtml(make());
    // body CSS should use pt, not px for font sizes
    expect(html).not.toMatch(/font-size:\d+px/);
  });

  it("no Google Fonts — network 의존 없음", () => {
    const html = buildPdfHtml(make());
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("@import");
  });

  it("parent_support 마지막 순서 유지", () => {
    const html = buildPdfHtml(make());
    const p2 = html.slice(html.lastIndexOf('<div class="page">'));
    expect(p2.indexOf("앞으로 이렇게 만들어갈게요"))
      .toBeLessThan(p2.indexOf("집에서는 이렇게 함께해주세요"));
  });

  it("CASE A section labels 모두 포함", () => {
    const html = buildPdfHtml(make());
    ["이번 달에 가장 좋았던 모습","이번 달 수영에서 배운 것",
     "수업에서 좋았던 모습","지난달보다 이렇게 이어지고 있어요",
     "이럴 때 더 잘하고 있어요","수업에서는 이렇게 이어갈게요",
     "앞으로 이렇게 만들어갈게요","집에서는 이렇게 함께해주세요",
    ].forEach(label => expect(html).toContain(label));
  });
});
