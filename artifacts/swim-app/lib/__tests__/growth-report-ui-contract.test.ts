import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const mobileHub = read("artifacts/swim-app/app/(admin)/report-hub.tsx");
const webPending = read("artifacts/swimnote-dashboard/src/pages/growth-reports/PendingPage.tsx");
const webPublish = read("artifacts/swimnote-dashboard/src/pages/growth-reports/PublishPage.tsx");
const webPublished = read("artifacts/swimnote-dashboard/src/pages/growth-reports/PublishedPage.tsx");
const readinessHelper = read("artifacts/api-server/src/jobs/growth-report-monthly-readiness.ts");
const productionRoutes = read("artifacts/api-server/src/routes/admin-growth-report-production.ts");

describe("monthly growth-report frontend contract (no DB/network)", () => {
  it("mobile hub uses official monthly endpoints and actual readiness response fields", () => {
    expect(mobileHub).toContain("/admin/growth-reports/monthly-summary?year=");
    expect(mobileHub).toContain("/admin/growth-reports/monthly-list?");
    expect(mobileHub).toContain("/admin/growth-reports/batch-status?year=");
    expect(mobileHub).not.toContain("/admin/reports/summary?");
    expect(mobileHub).toContain("for (let offset = limit; offset < rowTotal; offset += limit)");
    expect(productionRoutes).toContain("admin_readiness: readiness");
    expect(productionRoutes).toContain("readiness_status: monthlyReadinessStatus(item)");
    for (const field of [
      "analysis_ready",
      "excluded",
      "data_accumulating",
      "retrying",
      "pending_analysis",
      "terminal_failed",
      "published",
      "other",
      "total",
    ]) {
      expect(readinessHelper).toContain(`${field}: number`);
      expect(mobileHub).toContain(`${field}?: number`);
    }
    for (const status of [
      "ANALYSIS_READY",
      "EXCLUDED",
      "DATA_ACCUMULATING",
      "RETRYING",
      "PENDING_ANALYSIS",
      "TERMINAL_FAILED",
      "PUBLISHED",
      "OTHER",
    ]) {
      expect(readinessHelper).toContain(`"${status}"`);
      expect(mobileHub).toContain(status);
    }
    expect(mobileHub).toContain("admin_readiness?:");
    expect(mobileHub).not.toContain("ready_count?:");
    expect(mobileHub).not.toContain("summary?.readiness");
  });

  it("keeps review-open, guard-ready, excluded, terminal failure, accumulation, processing, and published distinct", () => {
    for (const status of [
      "DATA_ACCUMULATING",
      "TERMINAL_FAILED",
      "PENDING_ANALYSIS",
      "EXCLUDED",
      "ANALYSIS_READY",
      "PUBLISHED",
    ]) {
      expect(mobileHub).toContain(status);
    }
    expect(mobileHub).toContain("function isReviewOpen");
    expect(mobileHub).toContain("product_status === \"REVIEW_REQUIRED\"");
    expect(mobileHub).toContain("item.readiness_status === \"ANALYSIS_READY\"");
    expect(mobileHub).toContain('label="관리자 검수 대기"');
    expect(mobileHub).toContain('label="검증 통과 · 검수 별도"');
    expect(mobileHub).toContain('label="데이터 축적 중"');
    expect(mobileHub).toContain('label="처리·재시도 중"');
    expect(mobileHub).toContain('label="최종 실패"');
    expect(mobileHub).not.toContain('["REVIEW_REQUIRED","APPROVED","READY_TO_SEND"].includes');
  });

  it("web consumers use actual monthly-list IDs and exact discard/send contracts", () => {
    for (const source of [webPending, webPublish, webPublished]) {
      expect(source).toContain("/admin/growth-reports/monthly-list?");
      expect(source).toContain("report_id");
      expect(source).toContain("readiness_status");
    }
    expect(webPending).toContain('api.put(`/admin/growth-reports/${reportId}/discard`');
    expect(webPending).toContain("reason: discardReason");
    expect(webPending).toContain("DISCARD_REASONS.map");
    expect(webPending).not.toContain("api.patch(`/admin/growth-reports/${reportId}/discard`");
    expect(webPublish).toContain("/admin/growth-reports/${ids[0]}/send");
    expect(webPublish).toContain('"/admin/growth-reports/bulk-send"');
    expect(webPublish).toContain("already_published_count");
    expect(webPublish).toContain("published_count");
    expect(webPublish).toContain('report.readiness_status === "ANALYSIS_READY"');
    expect(webPublish).toContain('["READY_TO_SEND", "APPROVED"].includes(report.product_status)');
    expect(webPublish).not.toContain('"REVIEW_REQUIRED", "APPROVED", "READY_TO_SEND"');
    expect(webPending).toContain("ReadinessBadge status={r.readiness_status}");
  });

  it("published reports do not offer a misleading resend action", () => {
    expect(webPublished).toContain("학부모 공개 완료 · 재발송 없음");
    expect(webPublished).not.toContain("재발행");
    expect(webPublished).not.toContain("/send");
  });
});