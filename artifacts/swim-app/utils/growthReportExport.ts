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

// ── Section title 번역 (GR8 canonical labels) ─────────────────────────────────

const SECTION_LABELS_PDF: Record<string, string> = {
  core_growth:             "이번 달에 확인된 성장",
  swimming_progress:       "수영에서 확인된 변화",
  behavioral_strengths:    "수업에서 보인 강점",
  longitudinal_comparison: "지난 기록과 이어서 보기",
  success_conditions:      "이런 상황에서 더 잘 나타났어요",
  parent_support:          "가정에서 참고할 포인트",
  teacher_guidance:        "수업에서 이어갈 포인트",
  next_growth_direction:   "다음에 관찰할 성장 방향",
};

// canonical order (GR8와 동일, spec §6)
const SECTION_ORDER_PDF = [
  "core_growth",
  "swimming_progress",
  "behavioral_strengths",
  "longitudinal_comparison",
  "success_conditions",
  "parent_support",
  "teacher_guidance",
  "next_growth_direction",
] as const;

// ── 기간 포맷 ─────────────────────────────────────────────────────────────────

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : period;
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

// ── HTML template ─────────────────────────────────────────────────────────────
// PDF is a document-quality output: Navy + Mint brand, no score/gauge/diagnostic

function buildPdfHtml(params: GrowthReportExportParams): string {
  const {
    reportPeriod, publishedAt, reportContent,
    displayName = "우리 아이", poolName,
  } = params;

  // Validate content (spec §7 equiv)
  if (!reportContent || typeof reportContent !== "object" || Array.isArray(reportContent)) {
    throw new GrowthReportExportException("INVALID_REPORT_CONTENT", "report_content가 유효하지 않습니다.");
  }

  const periodLabel    = formatPeriod(reportPeriod);
  const publishedLabel = formatPublishedDate(publishedAt);
  const poolLabel      = poolName ? escapeHtml(poolName) : "SWIMNOTE";
  const nameLabel      = escapeHtml(displayName);

  // sections — internal data 제외 (spec §10): text only
  const sectionHtml = SECTION_ORDER_PDF
    .map((key) => {
      const sec = (reportContent.sections as any)?.[key] as ReportSectionForExport | undefined;
      if (!sec?.text?.trim()) return "";
      const label = SECTION_LABELS_PDF[key] ?? key;
      return `
        <div class="section-card">
          <div class="section-header">
            <span class="section-dot"></span>
            <h2 class="section-title">${escapeHtml(label)}</h2>
          </div>
          <p class="section-text">${escapeHtml(sec.text)}</p>
        </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${nameLabel} 성장리포트 ${periodLabel}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    background: #ffffff;
    color: #2C3E50;
    padding: 40px;
    max-width: 800px;
    margin: 0 auto;
    font-size: 14px;
    line-height: 1.8;
  }
  .doc-header {
    background: linear-gradient(135deg, #0D2E5A 0%, #1a4a8a 100%);
    color: #fff;
    padding: 32px 36px;
    border-radius: 16px;
    margin-bottom: 28px;
  }
  .doc-header .brand-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }
  .doc-header .brand-dot {
    width: 8px; height: 8px;
    background: #3ECFBA;
    border-radius: 50%;
  }
  .doc-header .brand-name {
    font-size: 13px;
    font-weight: 600;
    color: #3ECFBA;
    letter-spacing: 1.5px;
    text-transform: uppercase;
  }
  .doc-header .pool-name {
    font-size: 13px;
    color: rgba(255,255,255,0.65);
    margin-left: 4px;
  }
  .doc-header .period-title {
    font-size: 26px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
  }
  .doc-header .published-meta {
    font-size: 12px;
    color: rgba(255,255,255,0.55);
  }
  .summary-card {
    background: #F7FAFD;
    border-left: 4px solid #3ECFBA;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 20px;
  }
  .summary-label {
    font-size: 11px;
    font-weight: 600;
    color: #3ECFBA;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 10px;
  }
  .summary-text {
    font-size: 14px;
    color: #2C3E50;
    line-height: 1.9;
    white-space: pre-wrap;
  }
  .section-card {
    background: #fff;
    border: 1px solid #E5EDF5;
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 16px;
    page-break-inside: avoid;
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .section-dot {
    width: 7px; height: 7px;
    background: #3ECFBA;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: #0D2E5A;
  }
  .section-text {
    font-size: 14px;
    color: #2C3E50;
    line-height: 1.9;
    white-space: pre-wrap;
  }
  .doc-footer {
    margin-top: 36px;
    padding-top: 20px;
    border-top: 1px solid #E5EDF5;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .doc-footer .footer-brand {
    font-size: 11px;
    font-weight: 700;
    color: #0D2E5A;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .doc-footer .footer-tagline {
    font-size: 10px;
    color: #8CA0B8;
    margin-top: 2px;
  }
  .doc-footer .footer-date {
    font-size: 11px;
    color: #8CA0B8;
    text-align: right;
  }
  @media print {
    .section-card { page-break-inside: avoid; }
    body { padding: 20px; }
  }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="brand-row">
      <span class="brand-dot"></span>
      <span class="brand-name">SWIMNOTE</span>
      ${poolLabel ? `<span class="pool-name">· ${poolLabel}</span>` : ""}
    </div>
    <div class="period-title">${periodLabel} 성장리포트</div>
    <div class="published-meta">${publishedLabel} 공개</div>
  </div>

  ${reportContent.summary_text ? `
  <div class="summary-card">
    <div class="summary-label">리포트 요약</div>
    <p class="summary-text">${escapeHtml(reportContent.summary_text)}</p>
  </div>` : ""}

  ${sectionHtml}

  <div class="doc-footer">
    <div>
      <div class="footer-brand">SWIMNOTE</div>
      <div class="footer-tagline">수영 피드백의 시대.</div>
    </div>
    <div class="footer-date">${publishedLabel} 공개</div>
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
