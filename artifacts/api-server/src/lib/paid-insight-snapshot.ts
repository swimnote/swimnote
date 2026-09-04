/**
 * paid-insight-snapshot.ts
 *
 * GrowthDataSnapshot assembler for Paid Insight.
 *
 * - APP server assembles snapshot from existing DB data
 * - AI Engine does NOT query APP DB directly
 * - Only pool/student ownership-verified data is included
 * - Cross-pool joins: 0
 * - PII included: none beyond opaque IDs
 *
 * AI calls: 0
 * DB write: NO
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { GrowthDataSnapshot } from "./paid-insight-engine-client.js";

type Db = typeof superAdminDb;

export interface SnapshotInput {
  studentId: string;
  poolId:    string;
}

/**
 * assemblePaidInsightSnapshot
 *
 * Builds GrowthDataSnapshot for the given student.
 * Each data source is best-effort; missing optional sources → null/[].
 * Pool isolation: every query is gated on swimming_pool_id = poolId.
 */
export async function assemblePaidInsightSnapshot(
  db: Db,
  { studentId, poolId }: SnapshotInput,
): Promise<GrowthDataSnapshot> {
  const now = new Date().toISOString();

  // ── Student basic ──────────────────────────────────────────────────────────
  let studentBasic: {
    birth_date?:   string | null;
    current_level?: string | null;
  } = {};
  try {
    const sr = await db.execute(sql`
      SELECT birth_date, current_level
      FROM students
      WHERE id = ${studentId}
        AND swimming_pool_id = ${poolId}
        AND deleted_at IS NULL
      LIMIT 1
    `);
    if (sr.rows.length > 0) {
      const r = sr.rows[0] as any;
      studentBasic = {
        birth_date:    r.birth_date ? String(r.birth_date) : null,
        current_level: r.current_level ? String(r.current_level) : null,
      };
    }
  } catch (err) {
    console.warn("[paid-insight-snapshot] student basic fetch failed:", (err as any)?.message);
  }

  // ── Lesson / diary records (last 90 days) ────────────────────────────────
  let lessonRecords: GrowthDataSnapshot["lesson_records"] = [];
  try {
    const lr = await db.execute(sql`
      SELECT
        d.diary_date  AS date,
        d.note_summary AS note,
        d.teacher_user_id AS teacher_id
      FROM diary_notes d
      WHERE d.student_id        = ${studentId}
        AND d.swimming_pool_id  = ${poolId}
        AND d.deleted_at IS NULL
        AND d.diary_date >= (CURRENT_DATE - INTERVAL '90 days')
      ORDER BY d.diary_date DESC
      LIMIT 200
    `);
    lessonRecords = (lr.rows as any[]).map(r => ({
      date:       String(r.date),
      note:       r.note ?? null,
      teacher_id: r.teacher_id ?? null,
    }));
  } catch (err) {
    console.warn("[paid-insight-snapshot] lesson records fetch failed:", (err as any)?.message);
  }

  // ── Level history ─────────────────────────────────────────────────────────
  let levelHistory: GrowthDataSnapshot["level_history"] = [];
  try {
    const lhr = await db.execute(sql`
      SELECT level_name, confirmed_at
      FROM student_level_history
      WHERE student_id       = ${studentId}
        AND swimming_pool_id = ${poolId}
      ORDER BY confirmed_at DESC
      LIMIT 20
    `);
    levelHistory = (lhr.rows as any[]).map(r => ({
      level_name:   String(r.level_name ?? ""),
      confirmed_at: String(r.confirmed_at ?? ""),
    }));
  } catch (err) {
    // table may not exist in all environments
    console.warn("[paid-insight-snapshot] level history fetch failed (may be missing):", (err as any)?.message);
  }

  // ── Curriculum progress ───────────────────────────────────────────────────
  let curriculumProgress: GrowthDataSnapshot["curriculum_progress"] = null;
  try {
    const cpr = await db.execute(sql`
      SELECT
        scp.current_curriculum_id,
        scp.display_confirmed_pct  AS confirmed_progress_pct,
        scp.active_progress_pct
      FROM student_curriculum_progress scp
      WHERE scp.student_id       = ${studentId}
        AND scp.swimming_pool_id = ${poolId}
      LIMIT 1
    `);
    if (cpr.rows.length > 0) {
      const r = cpr.rows[0] as any;
      curriculumProgress = {
        current_curriculum_id:  r.current_curriculum_id ?? null,
        confirmed_progress_pct: typeof r.confirmed_progress_pct === "number"
          ? r.confirmed_progress_pct : null,
        active_progress_pct:    typeof r.active_progress_pct === "number"
          ? r.active_progress_pct : null,
      };
    }
  } catch (err) {
    console.warn("[paid-insight-snapshot] curriculum progress fetch failed:", (err as any)?.message);
  }

  // ── Growth events (non-invalidated) ──────────────────────────────────────
  let growthEvents: GrowthDataSnapshot["growth_events"] = [];
  try {
    const ger = await db.execute(sql`
      SELECT
        curriculum_item_id,
        growth_match_status,
        created_at
      FROM growth_events
      WHERE student_id       = ${studentId}
        AND swimming_pool_id = ${poolId}
        AND is_invalidated   = false
      ORDER BY created_at DESC
      LIMIT 100
    `);
    growthEvents = (ger.rows as any[]).map(r => ({
      curriculum_item_id: r.curriculum_item_id ?? null,
      growth_match_status: String(r.growth_match_status ?? ""),
      created_at:          String(r.created_at ?? ""),
    }));
  } catch (err) {
    console.warn("[paid-insight-snapshot] growth events fetch failed:", (err as any)?.message);
  }

  // ── Previous FREE growth reports ──────────────────────────────────────────
  let previousReports: GrowthDataSnapshot["previous_reports"] = [];
  try {
    const prr = await db.execute(sql`
      SELECT id, report_type, report_period, published_at, summary_text
      FROM growth_reports
      WHERE student_id       = ${studentId}
        AND swimming_pool_id = ${poolId}
        AND report_type      = 'monthly'
        AND product_status   = 'PUBLISHED'
        AND deleted_at IS NULL
      ORDER BY published_at DESC
      LIMIT 6
    `);
    previousReports = (prr.rows as any[]).map(r => ({
      report_id:     String(r.id),
      report_type:   String(r.report_type),
      report_period: r.report_period ?? null,
      published_at:  r.published_at ? String(r.published_at) : null,
      summary_text:  r.summary_text ?? null,
    }));
  } catch (err) {
    console.warn("[paid-insight-snapshot] previous reports fetch failed:", (err as any)?.message);
  }

  // ── Previous PAID insight reports ─────────────────────────────────────────
  let previousPaidInsights: GrowthDataSnapshot["previous_paid_insights"] = [];
  try {
    const ppir = await db.execute(sql`
      SELECT id, report_type, report_period, published_at, summary_text
      FROM growth_reports
      WHERE student_id       = ${studentId}
        AND swimming_pool_id = ${poolId}
        AND report_type      = 'custom'
        AND content->>'pipeline' = 'paid_insight'
        AND product_status   = 'PUBLISHED'
        AND deleted_at IS NULL
      ORDER BY published_at DESC
      LIMIT 4
    `);
    previousPaidInsights = (ppir.rows as any[]).map(r => ({
      report_id:     String(r.id),
      report_type:   "paid_insight",
      report_period: r.report_period ?? null,
      published_at:  r.published_at ? String(r.published_at) : null,
      summary_text:  r.summary_text ?? null,
    }));
  } catch (err) {
    console.warn("[paid-insight-snapshot] previous paid insight reports fetch failed:", (err as any)?.message);
  }

  return {
    schema_version:     "1.0",
    assembled_at:       now,
    pool_id:            poolId,
    student: {
      student_id:    studentId,
      birth_date:    studentBasic.birth_date   ?? null,
      current_level: studentBasic.current_level ?? null,
    },
    lesson_records:  lessonRecords,
    lesson_count:    lessonRecords.length,
    level_history:   levelHistory,
    curriculum_progress: curriculumProgress,
    growth_events:   growthEvents,
    previous_reports: previousReports,
    previous_paid_insights: previousPaidInsights,
    video_metadata:  null,
  };
}
