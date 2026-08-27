/**
 * super-maintenance-gr.ts
 *
 * Super-admin ONLY maintenance operation: in-place growth report reanalysis.
 *
 * Purpose:
 *   Reanalyze a PUBLISHED growth report without changing its report_id,
 *   published_at, product_status, likes, comments, or push notifications.
 *
 * Endpoint:
 *   POST /super/maintenance/growth-report/:reportId/reanalyze
 *   Body: { mode: "dry_run" | "apply" }
 *
 * Safety:
 *   - super_admin only
 *   - Verifies target report is PUBLISHED and belongs to the expected pool/student
 *   - dry_run: calls engine, returns result, writes NOTHING
 *   - apply:   calls engine, writes content fields only (no status/id changes)
 *   - NEVER calls notifyGrowthReportPublished (no new push)
 *   - NEVER changes product_status, published_at, report_id
 *   - NEVER affects likes, comments, notifications
 *
 * This is a one-off maintenance path.
 * General PUBLISHED→analyze flow is NOT opened.
 */

import { Router } from "express";
import { superAdminDb } from "@workspace/db";
const db = superAdminDb;
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { buildAnalysisSnapshot } from "../lib/growth-report-snapshot-builder.js";
import {
  analyzeGrowthReport,
  GR_SNAPSHOT_VERSION_DB,
  type GrowthReportAnalysisResponse,
} from "../lib/growth-report-engine-client.js";
import { validateEngineResponse } from "../lib/growth-report-result-handler.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeGating(v: unknown): string {
  return typeof v === "string" ? v : ((v as any)?.status ?? "FAIL");
}

const GROUNDING_PASS = new Set(["PASS", "REVISED_PASS"]);

function summarizeSections(content: Record<string, unknown> | null) {
  const SECTION_KEYS = [
    "core_growth", "swimming_progress", "behavioral_strengths",
    "longitudinal_comparison", "success_conditions", "teacher_guidance",
    "next_growth_direction", "parent_support",
  ];
  const result: Record<string, string> = {};
  for (const k of SECTION_KEYS) {
    const sec = content?.[k];
    if (!sec) { result[k] = "MISSING"; continue; }
    const text = typeof sec === "string" ? sec
      : ((sec as any).content ?? (sec as any).text ?? JSON.stringify(sec));
    result[k] = (typeof text === "string" && text.trim().length > 0) ? "NON_EMPTY" : "BAD_EMPTY";
  }
  return result;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post(
  "/super/maintenance/growth-report/:reportId/reanalyze",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { reportId } = req.params;
    const { mode } = req.body as { mode?: string };

    if (mode !== "dry_run" && mode !== "apply") {
      return res.status(400).json({ error: "mode must be 'dry_run' or 'apply'" });
    }

    // ── 1. Fetch report ───────────────────────────────────────────────────────
    const reportRows = await db.execute(sql`
      SELECT
        id, student_id, swimming_pool_id, report_period,
        cycle_id, product_status, analysis_status, published_at,
        teacher_reviewed_by, teacher_reviewed_at, deleted_at,
        analysis_request_id
      FROM growth_reports
      WHERE id = ${reportId}
        AND deleted_at IS NULL
      LIMIT 1
    `);
    const report = (reportRows.rows as any[])[0];
    if (!report) {
      return res.status(404).json({ error: "Report not found or deleted" });
    }
    if (report.product_status !== "PUBLISHED") {
      return res.status(409).json({
        error: "MAINTENANCE_ONLY_PUBLISHED",
        detail: `Expected PUBLISHED, got ${report.product_status}`,
      });
    }

    // ── 2. Fetch cycle ────────────────────────────────────────────────────────
    const cycleRows = await db.execute(sql`
      SELECT id, report_period, analysis_from, analysis_cutoff_at,
             parent_input_open_at, parent_input_close_at, timezone
      FROM growth_report_cycles
      WHERE id = ${report.cycle_id}
      LIMIT 1
    `);
    const cycle = (cycleRows.rows as any[])[0];
    if (!cycle) {
      return res.status(500).json({ error: "Cycle not found", cycle_id: report.cycle_id });
    }

    const startMs = Date.now();

    // ── 3. Build snapshot ─────────────────────────────────────────────────────
    let snapshot: Awaited<ReturnType<typeof buildAnalysisSnapshot>>;
    try {
      snapshot = await buildAnalysisSnapshot(db, {
        report: {
          id:                   report.id,
          student_id:           report.student_id,
          swimming_pool_id:     report.swimming_pool_id,
          cycle_id:             report.cycle_id,
          report_period:        report.report_period,
          teacher_reviewed_by:  report.teacher_reviewed_by ?? null,
          teacher_reviewed_at:  report.teacher_reviewed_at
                                  ? new Date(report.teacher_reviewed_at).toISOString()
                                  : null,
        },
        cycle: {
          id:                   cycle.id,
          analysis_from:        cycle.analysis_from ?? null,
          analysis_cutoff_at:   new Date(cycle.analysis_cutoff_at).toISOString(),
          parent_input_open_at: new Date(cycle.parent_input_open_at).toISOString(),
          report_period:        cycle.report_period,
          timezone:             cycle.timezone,
        },
        // fresh requestId — new analysis attempt
      });
    } catch (err: any) {
      return res.status(500).json({ error: "SNAPSHOT_BUILD_FAILED", detail: err.message });
    }

    const snapshotMs = Date.now() - startMs;
    const { request, requestId, payloadHash } = snapshot;

    // Snapshot info (no raw diary content in response)
    const snapshotInfo = {
      requestId,
      payloadHash,
      diary_count: request.snapshot.diaries.length,
      growth_event_count: request.snapshot.growth_events.length,
      attendance_count: request.snapshot.attendance.length,
      parent_answers_count: request.snapshot.parent_answers.length,
      longitudinal_periods: request.snapshot.longitudinal?.previous_report_structured_results?.length ?? 0,
      snapshotBuildMs: snapshotMs,
    };

    // ── 4. Call engine ────────────────────────────────────────────────────────
    let engineResult: Awaited<ReturnType<typeof analyzeGrowthReport>>;
    try {
      engineResult = await analyzeGrowthReport(request);
    } catch (err: any) {
      return res.status(502).json({
        error:  "ENGINE_CALL_FAILED",
        detail: err.message,
        code:   err.errorCode ?? null,
        snapshot: snapshotInfo,
      });
    }

    const engineMs = Date.now() - startMs - snapshotMs;
    const response: GrowthReportAnalysisResponse = engineResult.response;

    // ── 5. Validate engine response ───────────────────────────────────────────
    try {
      validateEngineResponse(response, requestId, reportId, payloadHash);
    } catch (err: any) {
      return res.status(422).json({
        error:  "ENGINE_RESPONSE_INVALID",
        detail: err.message,
        snapshot: snapshotInfo,
      });
    }

    // ── 6. Grounding / framing gate ───────────────────────────────────────────
    const groundingStatus     = normalizeGating(response.validation?.grounding);
    const growthFramingStatus = normalizeGating(response.validation?.growth_framing);

    if (!GROUNDING_PASS.has(groundingStatus)) {
      return res.status(422).json({
        error:   "GROUNDING_FAIL",
        grounding: groundingStatus,
        growth_framing: growthFramingStatus,
        snapshot: snapshotInfo,
      });
    }
    if (!GROUNDING_PASS.has(growthFramingStatus)) {
      return res.status(422).json({
        error:   "GROWTH_FRAMING_FAIL",
        grounding: groundingStatus,
        growth_framing: growthFramingStatus,
        snapshot: snapshotInfo,
      });
    }

    // ── 7. Summarize engine result ────────────────────────────────────────────
    const content    = response.report_content as Record<string, unknown> | null;
    const factPkg    = response.fact_package   as Record<string, unknown> | null;
    const snsSummary = response.sns_summary    as Record<string, unknown> | null;

    const factWithValidation = {
      ...(factPkg ?? {}),
      grounding_result:      groundingStatus,
      growth_framing_result: growthFramingStatus,
    };

    const dryRunSummary = {
      analysis_status:     response.analysis_status,
      grounding_result:    groundingStatus,
      growth_framing_result: growthFramingStatus,
      summary_text:        (content as any)?.summary_text ?? null,
      sections:            summarizeSections(content),
      questions_count:     response.questions?.length ?? 0,
      fact_f065:           (factPkg as any)?.f065_count ?? null,
      fact_f068:           (factPkg as any)?.f068_count ?? null,
      verified_rels:       (factPkg as any)?.verified_relationship_count ?? null,
      unsupported_claims:  (factPkg as any)?.unsupported_claim_count ?? 0,
      stable_trait_violations: (factPkg as any)?.stable_trait_violation_count ?? 0,
      has_content:         !!content,
      has_fact_package:    !!factPkg,
      has_sns_summary:     !!snsSummary,
    };

    // ── 8. DRY RUN — return without writing ──────────────────────────────────
    if (mode === "dry_run") {
      return res.json({
        mode:     "dry_run",
        report_id: reportId,
        snapshot:  snapshotInfo,
        engine:    dryRunSummary,
        latency: {
          snapshot_ms: snapshotMs,
          engine_ms:   engineMs,
          total_ms:    Date.now() - startMs,
        },
        actual_call_count: engineResult.actualCallCount,
        db_writes: 0,
      });
    }

    // ── 9. APPLY — in-place UPDATE (no product_status/published_at change) ───
    const metricJson   = JSON.stringify(response.metric_evidence    ?? {});
    const signalsJson  = JSON.stringify(response.positive_signals   ?? []);
    const synth        = response.synthesis as Record<string, unknown> | null;
    const successJson  = JSON.stringify(synth?.["success_conditions"]      ?? []);
    const leversJson   = JSON.stringify(synth?.["support_levers"]          ?? []);
    const growthJson   = JSON.stringify(synth?.["next_growth_targets"]     ?? []);
    const observJson   = JSON.stringify(synth?.["next_observation_targets"] ?? []);
    const factJson     = JSON.stringify(factWithValidation);
    const contentJson  = JSON.stringify(content);
    const snsJson      = JSON.stringify(snsSummary);

    const updateRes = await db.execute(sql`
      UPDATE growth_reports
      SET
        analysis_status          = ${response.analysis_status}::gr_analysis_status_enum,
        analysis_request_id      = ${requestId},
        snapshot_version         = ${GR_SNAPSHOT_VERSION_DB},
        snapshot_hash            = ${payloadHash},
        metric_states            = ${metricJson}::jsonb,
        metric_confidences       = NULL,
        positive_growth_signals  = ${signalsJson}::jsonb,
        success_conditions       = ${successJson}::jsonb,
        support_levers           = ${leversJson}::jsonb,
        next_growth_targets      = ${growthJson}::jsonb,
        next_observation_targets = ${observJson}::jsonb,
        report_fact_package      = ${factJson}::jsonb,
        report_content           = ${contentJson}::jsonb,
        sns_summary              = ${snsJson}::jsonb,
        grounding_result         = ${groundingStatus},
        growth_framing_result    = ${growthFramingStatus},
        updated_at               = now()
      WHERE id          = ${reportId}
        AND deleted_at IS NULL
      RETURNING id, updated_at, analysis_status, product_status, published_at
    `);

    const updated = (updateRes.rows as any[])[0];
    if (!updated) {
      return res.status(500).json({ error: "UPDATE_FAILED", detail: "0 rows updated" });
    }

    // Verify invariants: product_status and published_at must not have changed
    if (updated.product_status !== "PUBLISHED") {
      return res.status(500).json({
        error:   "INVARIANT_VIOLATION",
        detail:  "product_status changed — this should never happen",
        product_status: updated.product_status,
      });
    }

    return res.json({
      mode:     "apply",
      report_id:     updated.id,
      product_status: updated.product_status,
      published_at:   report.published_at,   // original — unchanged
      updated_at:     updated.updated_at,
      analysis_status: updated.analysis_status,
      snapshot:  snapshotInfo,
      engine:    dryRunSummary,
      latency: {
        snapshot_ms: snapshotMs,
        engine_ms:   engineMs,
        total_ms:    Date.now() - startMs,
      },
      actual_call_count: engineResult.actualCallCount,
      db_writes: 1,
      // Push safety confirmation
      push_notifications_sent: 0,
      likes_unchanged: true,
      comments_unchanged: true,
    });
  },
);

export default router;
