/**
 * growth-report-gr5-review-init.ts — GR5: Teacher Review + Approval Workflow
 *
 * 실행 정책:
 *   - 멱등성: ADD COLUMN IF NOT EXISTS
 *   - Additive only: 기존 컬럼 삭제·rename 금지
 *   - Production migration 실행 금지 (별도 승인 후)
 *
 * Migration Group:
 *   GR5-A: growth_reports에 Teacher Review 컬럼 추가
 *     - teacher_review_action         text (APPROVE | REQUEST_REANALYSIS)
 *     - teacher_review_reason_code    text (spec §7 reason codes)
 *     - teacher_review_note           text (optional free text)
 *     - teacher_reanalysis_count      integer DEFAULT 0 (loop protection)
 *
 * 전제:
 *   - growth-report-gr1-init.ts가 먼저 실행되어야 함.
 */

import { sql } from "drizzle-orm";
import { superAdminDb as db } from "@workspace/db";

// ─── Group GR5-A: Teacher Review 컬럼 ─────────────────────────────────────────

async function runGroupA_TeacherReviewColumns(): Promise<void> {
  const addCols: { col: string; definition: string }[] = [
    // Review action: APPROVE | REQUEST_REANALYSIS (결과 보존)
    { col: "teacher_review_action",      definition: "text" },
    // Structured reason code for REQUEST_REANALYSIS (spec §7)
    { col: "teacher_review_reason_code", definition: "text" },
    // Optional free-text note from teacher
    { col: "teacher_review_note",        definition: "text" },
    // Loop protection: # of times teacher requested reanalysis on this report
    { col: "teacher_reanalysis_count",   definition: "integer NOT NULL DEFAULT 0" },
  ];

  for (const { col, definition } of addCols) {
    await db.execute(sql.raw(`
      ALTER TABLE growth_reports
        ADD COLUMN IF NOT EXISTS ${col} ${definition};
    `));
  }
  console.log(`[GR5-init] GR5-A: teacher review 컬럼 ${addCols.length}개 추가 OK`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function initGrowthReportGR5Schema(): Promise<void> {
  console.log("[GR5-init] Starting GR5 Teacher Review schema migration…");

  const groups: { name: string; fn: () => Promise<void> }[] = [
    { name: "GR5-A: teacher review 컬럼", fn: runGroupA_TeacherReviewColumns },
  ];

  for (const g of groups) {
    try {
      await g.fn();
      console.log(`[GR5-init] ✅ ${g.name} 완료`);
    } catch (err: any) {
      console.error(`[GR5-init] ❌ ${g.name} 실패:`, err.message);
      throw err;
    }
  }

  console.log("[GR5-init] ✅ GR5 Migration 전체 완료");
}

// Allow direct execution
if (process.argv[1]?.endsWith("growth-report-gr5-review-init.ts")) {
  initGrowthReportGR5Schema()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
