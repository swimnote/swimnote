/**
 * growth-report-analysis-helper.ts
 *
 * ★ 외부 API ↔ 내부 DB 계약 변환 단일 소스 (①)
 *
 * report_month (발행월, API 외부 계약)
 *   = 관리자가 탭에서 보는 월 (예: 9월 탭 → report_month=9)
 *   = 학부모에게 "9월 리포트"로 표시
 *
 * analysis_period (분석월, DB 내부 계약)
 *   = 실제 데이터가 속한 달 (예: 8월 데이터)
 *   = growth_reports.report_period 컬럼 ("YYYY-MM")
 *   = growth_reports.period_start 컬럼 ("YYYY-MM-01")
 *
 * 변환 규칙:
 *   analysis_month = report_month - 1
 *   예) report_month=2026-09 → analysis_period_start=2026-08-01, analysis_period_end_exclusive=2026-09-01
 *
 * ★ 이 파일의 함수를 통해서만 변환하고, 각 라우트에서 직접 month-1 계산 금지.
 */

export interface AnalysisPeriod {
  /** DB report_period 컬럼 값: "YYYY-MM" */
  reportPeriod:           string;
  /** period_start 컬럼 값 / SQL 조건: "YYYY-MM-01" */
  periodStart:            string;
  /** 마지막 날 (inclusive): "YYYY-MM-DD" */
  periodEnd:              string;
  /** 상한 exclusive (= report_month 1일): "YYYY-MM-01" */
  periodEndExclusive:     string;
}

/**
 * computeAnalysisPeriod
 *
 * report_month(발행월) → analysis_period(분석월) 변환.
 *
 * @param reportYear  발행 연도 (예: 2026)
 * @param reportMonth 발행 월  (1-based, 예: 9)
 *
 * 예시:
 *   computeAnalysisPeriod(2026, 9)
 *   → { reportPeriod: "2026-08", periodStart: "2026-08-01",
 *        periodEnd: "2026-08-31", periodEndExclusive: "2026-09-01" }
 *
 *   computeAnalysisPeriod(2026, 1)
 *   → { reportPeriod: "2025-12", periodStart: "2025-12-01",
 *        periodEnd: "2025-12-31", periodEndExclusive: "2026-01-01" }
 */
export function computeAnalysisPeriod(
  reportYear:  number,
  reportMonth: number,
): AnalysisPeriod {
  // 분석월 = 발행월 - 1
  const analysisMonth = reportMonth === 1 ? 12 : reportMonth - 1;
  const analysisYear  = reportMonth === 1 ? reportYear - 1 : reportYear;

  const mm = String(analysisMonth).padStart(2, "0");
  const reportPeriod = `${analysisYear}-${mm}`;
  const periodStart  = `${analysisYear}-${mm}-01`;

  // 마지막 날: Date.UTC(analysisYear, analysisMonth, 0) = analysisMonth의 마지막 날
  const lastDay = new Date(Date.UTC(analysisYear, analysisMonth, 0)).getUTCDate();
  const periodEnd = `${analysisYear}-${mm}-${String(lastDay).padStart(2, "0")}`;

  // 상한 exclusive = report_month 1일 (= analysis_month 다음 달 1일)
  const rmMM = String(reportMonth).padStart(2, "0");
  const periodEndExclusive = `${reportYear}-${rmMM}-01`;

  return { reportPeriod, periodStart, periodEnd, periodEndExclusive };
}
