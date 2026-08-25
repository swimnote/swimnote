/**
 * growthReportExport.ts — GR9: PDF Export + SNS Share utilities
 *
 * 원칙:
 *   - APP은 ENGINE 결과를 렌더링만 한다 (재분석/요약 재생성/GPT 호출 금지)
 *   - PDF: full report content (structured sections)
 *   - SNS: sns_summary only + share_safe=true hard gate
 *   - 학생 PII 최소: 이름 없이 "우리 아이" 기본 (보수적 방향, spec §19)
 *   - temp file cleanup on done
 *   - typed errors (log-level 구분, Parent UI에는 안전한 메시지)
 */

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Share } from "react-native";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface ReportSectionForExport {
  text: string;
}

export interface ReportContentForExport {
  summary_text: string;
  composition_version?: string;
  sections: {
    core_growth?:              ReportSectionForExport;
    swimming_progress?:        ReportSectionForExport;
    behavioral_strengths?:     ReportSectionForExport;
    longitudinal_comparison?:  ReportSectionForExport;
    success_conditions?:       ReportSectionForExport;
    parent_support?:           ReportSectionForExport;
    teacher_guidance?:         ReportSectionForExport;
    next_growth_direction?:    ReportSectionForExport;
  };
}

export interface SnsSummaryForExport {
  headline:              string;
  key_points:            string[];
  share_safe:            boolean;
  supporting_claim_ids?: string[];
}

export interface GrowthReportExportParams {
  reportId:      string;
  reportPeriod:  string;   // "YYYY-MM"
  publishedAt:   string;
  reportContent: ReportContentForExport;
  snsSummary:    SnsSummaryForExport | null;
  displayName?:  string;   // "우리 아이" if not provided
  poolName?:     string;
}

// ── 에러 코드 ─────────────────────────────────────────────────────────────────

export type PdfExportError =
  | "INVALID_REPORT_CONTENT"
  | "PDF_GENERATION_FAILED"
  | "FILE_WRITE_FAILED"
  | "SHARE_UNAVAILABLE";

export type SnsShareError =
  | "SHARE_NOT_ALLOWED"      // share_safe=false
  | "INVALID_SNS_SUMMARY"    // null or malformed
  | "CARD_RENDER_FAILED"
  | "FILE_WRITE_FAILED"
  | "SHARE_UNAVAILABLE";

export class GrowthReportExportException extends Error {
  constructor(
    public code: PdfExportError | SnsShareError,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "GrowthReportExportException";
  }
}

// ── Section labels V2 (PDF Template V2 spec) ──────────────────────────────────

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

// PAGE 1: 이번 달 이야기
const PAGE1_SECTIONS = [
  "core_growth",
  "swimming_progress",
  "behavioral_strengths",
  "longitudinal_comparison",
] as const;

// PAGE 2: 앞으로 어떻게 이어갈지
const PAGE2_SECTIONS = [
  "success_conditions",
  "teacher_guidance",
  "next_growth_direction",
  "parent_support",
] as const;

// ── 기간 포맷 ─────────────────────────────────────────────────────────────────

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : period;
}

/** "YYYY-MM" → "YYYY.MM.01 – YYYY.MM.DD" */
function formatPeriodRange(period: string): string {
  const [y, m] = period.split("-");
  if (!y || !m) return period;
  const year  = parseInt(y, 10);
  const month = parseInt(m, 10);
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}.${pad(month)}.01 – ${y}.${pad(month)}.${lastDay}`;
}

function formatPublishedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── safe filename (spec §11) ──────────────────────────────────────────────────

export function buildPdfFilename(reportPeriod: string): string {
  const safe = reportPeriod.replace(/[^0-9-]/g, "");
  return `SWIMNOTE_GrowthReport_${safe || "report"}.pdf`;
}

// ── HTML template V2 ──────────────────────────────────────────────────────────
// PDF TEMPLATE V2: 2-page editorial design
// Page 1: 이번 달 이야기 (summary + 4 sections)
// Page 2: 앞으로 어떻게 이어갈지 (4 sections, parent_support highlighted)
// Design: ivory/white bg, deep navy text, thin aqua accents, no big icon boxes

// SWIMNOTE logo SVG — inlined as data URI (no network dependency)
const SWIMNOTE_LOGO_SVG_DATA_URI =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg width="580" height="480" viewBox="0 0 580 480" fill="none" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="g1" x1="160" y1="40" x2="160" y2="280" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="#154a6d"/><stop offset="100%" stop-color="#0a2540"/></linearGradient></defs>` +
    `<g transform="translate(130,20)">` +
    `<rect x="40" y="40" width="240" height="240" rx="60" fill="url(#g1)"/>` +
    `<rect x="70" y="70" width="180" height="180" rx="16" fill="#6ef5ea"/>` +
    `<rect x="95" y="105" width="60" height="10" rx="5" fill="#0a2540"/>` +
    `<rect x="95" y="130" width="80" height="10" rx="5" fill="#0a2540"/>` +
    `<path d="M200 85 L220 105 L250 75" stroke="#0a2540" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `<path d="M70 175 Q100 168 125 175 T180 175 T235 175 L250 175 L250 234 Q250 250 234 250 L86 250 Q70 250 70 234Z" fill="#0ea5e9"/>` +
    `</g>` +
    `<text x="290" y="422" font-family="'Helvetica Neue',Helvetica,sans-serif" font-size="80" font-weight="700" fill="#0a2540" text-anchor="middle">SwimNote</text>` +
    `</svg>`,
  );

/** Build one section block (editorial style: heading + thin rule + body text) */
function buildSectionBlock(key: string, text: string, isParentSupport = false): string {
  const label = escapeHtml(SECTION_LABELS_PDF[key] ?? key);
  const body  = escapeHtml(text);
  const wrapClass = isParentSupport ? "section parent-support-section" : "section";
  return `
    <div class="${wrapClass}">
      <div class="section-heading">${label}</div>
      <div class="section-rule"></div>
      <p class="section-body">${body}</p>
    </div>`;
}

/** Shared page header HTML (logo + title + metadata line) */
function buildPageHeader(
  nameLabel: string,
  poolLabel: string,
  periodLabel: string,
): string {
  return `
  <div class="page-header">
    <div class="header-left">
      <img class="logo-img" src="${SWIMNOTE_LOGO_SVG_DATA_URI}" alt="SwimNote" />
      <div class="header-title">성장 리포트</div>
    </div>
    <div class="header-meta">${nameLabel} · ${poolLabel} · ${periodLabel}</div>
  </div>`;
}

/** Shared page footer HTML */
function buildPageFooter(pageNum: number, totalPages: number): string {
  const num = String(pageNum).padStart(2, "0");
  const tot = String(totalPages).padStart(2, "0");
  return `
  <div class="page-footer">
    <span class="footer-brand">SWIMNOTE</span>
    <span class="footer-page">${num} / ${tot}</span>
  </div>`;
}

export function buildPdfHtml(params: GrowthReportExportParams): string {
  const {
    reportPeriod, publishedAt, reportContent,
    displayName = "우리 아이", poolName,
  } = params;

  // Validate content
  if (!reportContent || typeof reportContent !== "object" || Array.isArray(reportContent)) {
    throw new GrowthReportExportException("INVALID_REPORT_CONTENT", "report_content가 유효하지 않습니다.");
  }

  const periodLabel      = formatPeriod(reportPeriod);
  const periodRangeLabel = formatPeriodRange(reportPeriod);
  const poolLabel        = poolName ? escapeHtml(poolName) : "SWIMNOTE";
  const nameLabel        = escapeHtml(displayName);

  // ── PAGE 1 sections ────────────────────────────────────────────────────────
  const page1SectionsHtml = PAGE1_SECTIONS
    .map((key) => {
      const sec = (reportContent.sections as Record<string, ReportSectionForExport | undefined>)?.[key];
      if (!sec?.text?.trim()) return "";
      return buildSectionBlock(key, sec.text);
    })
    .join("");

  // ── PAGE 2 sections ────────────────────────────────────────────────────────
  const page2SectionsHtml = PAGE2_SECTIONS
    .map((key) => {
      const sec = (reportContent.sections as Record<string, ReportSectionForExport | undefined>)?.[key];
      if (!sec?.text?.trim()) return "";
      return buildSectionBlock(key, sec.text, key === "parent_support");
    })
    .join("");

  const headerHtml = buildPageHeader(nameLabel, poolLabel, periodRangeLabel);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${nameLabel} 성장리포트 ${periodLabel}</title>
<style>
  /* 시스템 한국어 폰트 — 네트워크 의존 없음 (spec §3) */
  @page { size: A4 portrait; margin: 0; }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* pt 단위 직접 사용 — 모바일 PDF viewer 가독성 목표 (spec §1) */
  body {
    font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic',
                 'Helvetica Neue', Arial, sans-serif;
    background: #F8F7F3;
    color: #1A2E44;
    font-size: 12pt;
    line-height: 1.6;
  }

  /* ── PAGE ── */
  .page {
    background: #FFFFFF;
    min-height: 297mm;
    padding: 28pt 42pt 24pt;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .page + .page {
    page-break-before: always;
    border-top: none;
  }

  /* ── PAGE HEADER ── */
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 5pt;
    padding-bottom: 10pt;
    border-bottom: 1.5pt solid #3ECFBA;
    margin-bottom: 18pt;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 9pt;
  }
  .logo-img {
    height: 22pt;
    width: auto;
  }
  .header-title {
    font-size: 26pt;
    font-weight: 700;
    color: #0D2E5A;
    letter-spacing: -0.3pt;
  }
  .header-meta {
    font-size: 10pt;
    color: #7A90A8;
  }

  /* ── SECTION HEADING ── */
  .section-heading {
    font-size: 15pt;
    font-weight: 700;
    color: #0D2E5A;
    margin-bottom: 3pt;
  }

  /* ── SUMMARY (PAGE 1) ── */
  .summary-block {
    background: #F2FAFD;
    border-left: 3pt solid #3ECFBA;
    padding: 10pt 14pt;
    margin-bottom: 16pt;
    page-break-inside: avoid;
  }
  .summary-body {
    font-size: 12pt;
    color: #1A2E44;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  /* ── SECTION ── */
  .section {
    margin-bottom: 14pt;
    page-break-inside: avoid;
  }
  .section-rule {
    height: 0.75pt;
    background: #DCE9F3;
    margin: 4pt 0 7pt;
  }
  .section-body {
    font-size: 12pt;
    color: #1A2E44;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  /* ── PARENT SUPPORT (highlighted) ── */
  .parent-support-section {
    background: #EEF9F6;
    border-left: 3pt solid #3ECFBA;
    padding: 12pt 14pt 14pt;
    margin-bottom: 14pt;
    page-break-inside: avoid;
  }
  .parent-support-section .section-rule {
    background: #B8E4D8;
    margin: 4pt 0 8pt;
  }
  .parent-support-section .section-body {
    font-size: 12pt;
    line-height: 1.65;
    color: #0F3328;
  }

  /* ── PAGE FOOTER ── */
  .page-footer {
    margin-top: auto;
    padding-top: 10pt;
    border-top: 0.75pt solid #E4EBF2;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-brand {
    font-size: 9pt;
    font-weight: 700;
    color: #0D2E5A;
    letter-spacing: 1.2pt;
    text-transform: uppercase;
  }
  .footer-page {
    font-size: 9pt;
    color: #A8BACF;
  }

  @media print {
    body { background: #FFFFFF; }
    .page { min-height: 0; }
    .section, .parent-support-section, .summary-block { page-break-inside: avoid; }
  }
</style>
</head>
<body>

  <!-- ═══════════════════════════ PAGE 1 ═══════════════════════════ -->
  <div class="page">
    ${headerHtml}

    ${reportContent.summary_text?.trim() ? `
    <div class="summary-block">
      <div class="section-heading">이번 달 이야기</div>
      <div class="section-rule" style="background:#DCE9F3;margin:6px 0 10px"></div>
      <p class="summary-body">${escapeHtml(reportContent.summary_text)}</p>
    </div>` : ""}

    ${page1SectionsHtml}

    ${buildPageFooter(1, 2)}
  </div>

  <!-- ═══════════════════════════ PAGE 2 ═══════════════════════════ -->
  <div class="page">
    ${headerHtml}

    ${page2SectionsHtml}

    ${buildPageFooter(2, 2)}
  </div>

</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Temp file cleanup ─────────────────────────────────────────────────────────

export async function cleanupTempFiles(uris: string[]): Promise<void> {
  for (const uri of uris) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    } catch (e) {
      console.warn("[GrowthReportExport] cleanup failed:", uri, e);
    }
  }
}

// ── PDF EXPORT ────────────────────────────────────────────────────────────────

/**
 * generateGrowthReportPdf
 *
 * 1. HTML template 생성
 * 2. expo-print → temp PDF file
 * 3. expo-sharing shareAsync 호출
 * 4. temp file cleanup
 *
 * Throws GrowthReportExportException on failure.
 */
export async function generateGrowthReportPdf(params: GrowthReportExportParams): Promise<void> {
  // Validate source (spec §7 / §33)
  if (!params.reportContent || typeof params.reportContent !== "object") {
    throw new GrowthReportExportException(
      "INVALID_REPORT_CONTENT",
      "report_content가 유효하지 않습니다.",
    );
  }

  let tempUri: string | null = null;

  try {
    const html = buildPdfHtml(params);

    // expo-print: client-side deterministic PDF (spec §39)
    let result: { uri: string };
    try {
      result = await Print.printToFileAsync({ html, base64: false });
      tempUri = result.uri;
    } catch (e) {
      throw new GrowthReportExportException("PDF_GENERATION_FAILED", "PDF 생성에 실패했습니다.", e);
    }

    // expo-sharing
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new GrowthReportExportException("SHARE_UNAVAILABLE", "이 기기에서 공유 기능을 사용할 수 없습니다.");
    }

    const filename = buildPdfFilename(params.reportPeriod);
    try {
      await Sharing.shareAsync(tempUri, {
        mimeType: "application/pdf",
        dialogTitle: "성장리포트 PDF",
        UTI: "com.adobe.pdf",
      });
    } catch (e) {
      throw new GrowthReportExportException("SHARE_UNAVAILABLE", "PDF 공유에 실패했습니다.", e);
    }
  } finally {
    // temp file cleanup (spec §32)
    if (tempUri) {
      await cleanupTempFiles([tempUri]).catch(() => {});
    }
  }
}

// ── SNS SHARE CARD ────────────────────────────────────────────────────────────

export interface SnsShareCardParams {
  reportPeriod: string;
  snsSummary:   SnsSummaryForExport | null;
  poolName?:    string;
  /** base64 or file URI from react-native-view-shot captureRef */
  cardImageUri: string;
}

/**
 * shareGrowthReportSnsCard
 *
 * share_safe hard gate (spec §15):
 *   snsSummary.share_safe !== true → throws SHARE_NOT_ALLOWED
 *
 * Calls OS native Share sheet (spec §24).
 * User can choose Instagram, KakaoTalk, etc. from the sheet.
 */
export async function shareGrowthReportSnsCard(params: SnsShareCardParams): Promise<void> {
  const { snsSummary, cardImageUri } = params;

  // share_safe hard gate (spec §15) — APP이 false→true로 변경 금지
  if (!snsSummary) {
    throw new GrowthReportExportException("INVALID_SNS_SUMMARY", "SNS 요약 데이터가 없습니다.");
  }
  if (snsSummary.share_safe !== true) {
    throw new GrowthReportExportException(
      "SHARE_NOT_ALLOWED",
      "이 리포트는 SNS 공유가 허용되지 않습니다.",
    );
  }
  if (!snsSummary.headline || !Array.isArray(snsSummary.key_points)) {
    throw new GrowthReportExportException("INVALID_SNS_SUMMARY", "SNS 요약 데이터 형식이 올바르지 않습니다.");
  }
  if (!cardImageUri) {
    throw new GrowthReportExportException("CARD_RENDER_FAILED", "카드 이미지를 생성할 수 없습니다.");
  }

  // expo-sharing for image file (spec §24)
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    // fallback: native Share (for sharing URI string)
    try {
      const period = formatPeriod(params.reportPeriod);
      await Share.share({
        message: `우리 아이 ${period} 성장리포트\n\n${snsSummary.headline}`,
      });
    } catch (e) {
      throw new GrowthReportExportException("SHARE_UNAVAILABLE", "공유 기능을 사용할 수 없습니다.", e);
    }
    return;
  }

  try {
    await Sharing.shareAsync(cardImageUri, {
      mimeType: "image/png",
      dialogTitle: "성장리포트 공유",
      UTI: "public.png",
    });
  } catch (e) {
    throw new GrowthReportExportException("SHARE_UNAVAILABLE", "공유에 실패했습니다.", e);
  }
}

// ── parent-facing error messages ──────────────────────────────────────────────

export function getPdfErrorMessage(code: PdfExportError): string {
  switch (code) {
    case "INVALID_REPORT_CONTENT": return "리포트 데이터가 올바르지 않습니다.";
    case "PDF_GENERATION_FAILED":  return "PDF를 생성할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    case "FILE_WRITE_FAILED":      return "파일 저장에 실패했습니다.";
    case "SHARE_UNAVAILABLE":      return "공유 기능을 사용할 수 없습니다.";
  }
}

export function getSnsErrorMessage(code: SnsShareError): string {
  switch (code) {
    case "SHARE_NOT_ALLOWED":   return "이 리포트는 SNS 공유가 허용되지 않습니다.";
    case "INVALID_SNS_SUMMARY": return "공유 데이터를 준비할 수 없습니다.";
    case "CARD_RENDER_FAILED":  return "공유 카드를 만들 수 없습니다. 잠시 후 다시 시도해 주세요.";
    case "FILE_WRITE_FAILED":   return "파일 저장에 실패했습니다.";
    case "SHARE_UNAVAILABLE":   return "공유 기능을 사용할 수 없습니다.";
  }
}
