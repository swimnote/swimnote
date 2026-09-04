/**
 * support-learning.ts — WP-CS24: Learning Loop API Routes
 *
 * 엔드포인트:
 *   GET  /super/support/knowledge-candidates         — 목록 (priority 정렬)
 *   GET  /super/support/knowledge-candidates/:id      — 상세
 *   POST /super/support/knowledge-candidates          — Admin-created candidate
 *   PATCH /super/support/knowledge-candidates/:id/approve-utterance  — utterance 추가
 *   PATCH /super/support/knowledge-candidates/:id/approve-canonical  — new canonical
 *   PATCH /super/support/knowledge-candidates/:id/reject             — 거부
 *   PATCH /super/support/knowledge-candidates/:id/merge              — 병합
 *   PATCH /super/support/knowledge-candidates/:id/reclassify         — 재분류
 *   GET  /super/support/learning-metrics              — 운영 메트릭
 *
 * 보안:
 *   - super_admin / platform_admin 전용
 *   - AUTO_ACTIVATE 금지 (API 레벨에서 거부)
 *   - DYNAMIC/POLICY approve → 400 거부
 */

import { Router, Request, Response } from "express";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  classifyQuery,
  getLearningMetrics,
  promoteUtteranceExtension,
  promoteNewCanonical,
  type CandidateClassification,
} from "../lib/support-candidate-engine.js";
import { normalizeQuery } from "../lib/support-resolver.js";

const router = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireSuperAdmin(req: Request, res: Response, next: Function) {
  const role = (req as any).user?.role;
  if (role !== "super_admin" && role !== "platform_admin") {
    return res.status(403).json({ error: "super_admin 전용" });
  }
  return next();
}

// Migration — lazy on first request
import("../migrations/pool-db-cs-24a.js")
  .then(async m => { const { superAdminDb } = await import("@workspace/db"); return m.runCs24aMigration(superAdminDb); })
  .catch(e => console.error("[cs24a] lazy migration 오류:", e.message));
import("../migrations/pool-db-cs-24b.js")
  .then(async m => { const { superAdminDb } = await import("@workspace/db"); return m.runCs24bMigration(superAdminDb); })
  .catch(e => console.error("[cs24b] lazy migration 오류:", e.message));

// ── GET /super/support/knowledge-candidates ────────────────────────────────

router.get("/super/support/knowledge-candidates", requireSuperAdmin, async (req, res) => {
  try {
    const status = (req.query.status as string) || "PENDING";
    const sort   = (req.query.sort as string) || "priority";
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const orderClause =
      sort === "priority"
        ? "((occurrence_count * 1) + (human_request_count * 5) + (gpt_fallback_count * 2)) DESC, last_seen_at DESC"
        : sort === "recent"
        ? "last_seen_at DESC"
        : sort === "count"
        ? "occurrence_count DESC"
        : "last_seen_at DESC";

    const rows = await superAdminDb.execute(sql.raw(`
      SELECT
        id, candidate_type, classification, source_type,
        representative_query, normalized_query,
        suggested_intent_id, suggested_knowledge_id,
        occurrence_count, gpt_fallback_count, human_request_count,
        first_seen_at, last_seen_at,
        affected_roles, affected_modes, pool_scope,
        risk, status, source_refs,
        approved_by, approved_at, rejected_by, rejected_at, reject_reason
      FROM support_knowledge_candidates
      WHERE status = '${status.replace(/'/g, "''")}'
      ORDER BY ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `)) as any;

    const countResult = await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM support_knowledge_candidates
      WHERE status = ${status}
    `) as any;

    return res.json({
      candidates: rows.rows ?? [],
      total: Number(countResult.rows?.[0]?.cnt ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    console.error("[learning] list candidates error:", err);
    return res.status(500).json({ error: "목록 조회 실패" });
  }
});

// ── GET /super/support/knowledge-candidates/:id ────────────────────────────

router.get("/super/support/knowledge-candidates/:id", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await superAdminDb.execute(sql`
      SELECT
        c.*,
        ki.title AS suggested_ki_title,
        ki.answer AS suggested_ki_answer,
        ki.affected_roles AS ki_affected_roles,
        ki.affected_modes AS ki_affected_modes
      FROM support_knowledge_candidates c
      LEFT JOIN support_knowledge_items ki ON ki.id = c.suggested_knowledge_id
      WHERE c.id = ${id}
    `) as any;

    if (!result.rows?.length) {
      return res.status(404).json({ error: "Candidate 없음" });
    }

    const cand = result.rows[0];

    // 최근 유사 utterance 예시 (최대 5개)
    const simsResult = await superAdminDb.execute(sql`
      SELECT case_id FROM support_query_log
      WHERE normalized_query = ${String(cand.normalized_query)}
      ORDER BY created_at DESC LIMIT 5
    `) as any;

    return res.json({
      candidate:      cand,
      recent_cases:   (simsResult.rows ?? []).map((r: any) => r.case_id),
    });
  } catch (err) {
    console.error("[learning] get candidate error:", err);
    return res.status(500).json({ error: "상세 조회 실패" });
  }
});

// ── POST /super/support/knowledge-candidates (Admin-created) ───────────────

router.post("/super/support/knowledge-candidates", requireSuperAdmin, async (req, res) => {
  try {
    const {
      representative_query,
      candidate_type,
      suggested_answer,
      suggested_knowledge_id,
      suggested_intent_id,
      affected_roles,
      affected_modes,
    } = req.body;

    if (!representative_query || !candidate_type) {
      return res.status(400).json({ error: "representative_query, candidate_type 필수" });
    }
    if (!["UTTERANCE_EXTENSION", "NEW_CANONICAL"].includes(candidate_type)) {
      return res.status(400).json({ error: "candidate_type 유효하지 않음" });
    }

    const normQ = normalizeQuery(String(representative_query));
    const classification = classifyQuery(normQ);

    const id = `cand_admin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    await superAdminDb.execute(sql`
      INSERT INTO support_knowledge_candidates (
        id, candidate_type, classification, source_type,
        representative_query, normalized_query,
        suggested_intent_id, suggested_knowledge_id,
        suggested_answer,
        occurrence_count, gpt_fallback_count, human_request_count,
        affected_roles, affected_modes, pool_scope,
        risk, status, source_refs
      ) VALUES (
        ${id}, ${candidate_type}, ${classification}, 'ADMIN_CREATED',
        ${String(representative_query).substring(0, 500)},
        ${normQ},
        ${suggested_intent_id ?? null},
        ${suggested_knowledge_id ?? null},
        ${suggested_answer ?? null},
        1, 0, 0,
        ${JSON.stringify(affected_roles ?? [])}::jsonb,
        ${JSON.stringify(affected_modes ?? [])}::jsonb,
        'global',
        'LOW', 'PENDING', '[]'::jsonb
      )
    `);

    return res.status(201).json({ ok: true, id, classification });
  } catch (err) {
    console.error("[learning] create admin candidate error:", err);
    return res.status(500).json({ error: "Candidate 생성 실패" });
  }
});

// ── PATCH .../approve-utterance ────────────────────────────────────────────

router.patch("/super/support/knowledge-candidates/:id/approve-utterance", requireSuperAdmin, async (req, res) => {
  try {
    const { id }                   = req.params;
    const { knowledge_id, utterance } = req.body;
    const approvedBy               = (req as any).user?.userId ?? "super_admin";

    if (!knowledge_id || !utterance) {
      return res.status(400).json({ error: "knowledge_id, utterance 필수" });
    }

    const result = await promoteUtteranceExtension({
      candidateId:  id,
      knowledgeId:  knowledge_id,
      utterance:    String(utterance),
      approvedBy,
    });

    if (!result.ok) {
      const status =
        result.error === "DYNAMIC_DATA_APPROVE_BLOCKED" || result.error === "POLICY_APPROVE_BLOCKED"
          ? 403
          : result.error === "CANDIDATE_NOT_FOUND" || result.error === "KNOWLEDGE_NOT_FOUND"
          ? 404
          : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.json({ ok: true, utterance_id: result.utteranceId });
  } catch (err) {
    console.error("[learning] approve-utterance error:", err);
    return res.status(500).json({ error: "Utterance 추가 실패" });
  }
});

// ── PATCH .../approve-canonical ────────────────────────────────────────────

router.patch("/super/support/knowledge-candidates/:id/approve-canonical", requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      item_type = "FAQ",
      scope     = "global",
      answer, question, title,
      roles, modes,
    } = req.body;
    const approvedBy = (req as any).user?.userId ?? "super_admin";

    if (!answer || !question || !title) {
      return res.status(400).json({ error: "answer, question, title 필수" });
    }

    const result = await promoteNewCanonical({
      candidateId: id,
      itemType:    String(item_type),
      scope:       String(scope),
      answer:      String(answer),
      question:    String(question),
      title:       String(title),
      roles:       Array.isArray(roles) ? roles : ["pool_admin", "teacher", "parent_account"],
      modes:       Array.isArray(modes) ? modes : ["normal", "x"],
      approvedBy,
    });

    if (!result.ok) {
      const status =
        result.error === "DYNAMIC_DATA_APPROVE_BLOCKED" || result.error === "POLICY_APPROVE_BLOCKED"
          ? 403
          : result.error === "PII_DETECTED_IN_ANSWER"
          ? 422
          : result.error === "CANDIDATE_NOT_FOUND"
          ? 404
          : 400;
      return res.status(status).json({ error: result.error });
    }

    return res.json({
      ok:           true,
      knowledge_id: result.knowledgeId,
      note:         "status=pending — CS16 governance 검토 후 active 전환 필요",
    });
  } catch (err) {
    console.error("[learning] approve-canonical error:", err);
    return res.status(500).json({ error: "Canonical 생성 실패" });
  }
});

// ── PATCH .../reject ───────────────────────────────────────────────────────

router.patch("/super/support/knowledge-candidates/:id/reject", requireSuperAdmin, async (req, res) => {
  try {
    const { id }         = req.params;
    const { reason }     = req.body;
    const rejectedBy     = (req as any).user?.userId ?? "super_admin";

    const existing = await superAdminDb.execute(sql`
      SELECT id, status FROM support_knowledge_candidates WHERE id = ${id}
    `) as any;
    if (!existing.rows?.length) return res.status(404).json({ error: "Candidate 없음" });
    if (existing.rows[0].status !== "PENDING") {
      return res.status(400).json({ error: "PENDING 상태가 아님" });
    }

    await superAdminDb.execute(sql`
      UPDATE support_knowledge_candidates
      SET status      = 'REJECTED',
          rejected_by = ${rejectedBy},
          rejected_at = NOW(),
          reject_reason = ${reason ?? null},
          updated_at  = NOW()
      WHERE id = ${id}
    `);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[learning] reject candidate error:", err);
    return res.status(500).json({ error: "Reject 실패" });
  }
});

// ── PATCH .../merge ────────────────────────────────────────────────────────

router.patch("/super/support/knowledge-candidates/:id/merge", requireSuperAdmin, async (req, res) => {
  try {
    const { id }        = req.params;
    const { target_id } = req.body;
    if (!target_id) return res.status(400).json({ error: "target_id 필수" });

    const [srcRes, tgtRes] = await Promise.all([
      superAdminDb.execute(sql`SELECT * FROM support_knowledge_candidates WHERE id = ${id}`) as any,
      superAdminDb.execute(sql`SELECT * FROM support_knowledge_candidates WHERE id = ${target_id}`) as any,
    ]);
    const src = srcRes.rows?.[0];
    const tgt = tgtRes.rows?.[0];
    if (!src || !tgt) return res.status(404).json({ error: "Candidate 없음" });
    if (src.status !== "PENDING" || tgt.status !== "PENDING") {
      return res.status(400).json({ error: "둘 다 PENDING 상태여야 함" });
    }

    // target에 count 합산
    const newOccurrence    = Number(src.occurrence_count) + Number(tgt.occurrence_count);
    const newGptCount      = Number(src.gpt_fallback_count) + Number(tgt.gpt_fallback_count);
    const newHumanCount    = Number(src.human_request_count) + Number(tgt.human_request_count);
    const srcRefs: string[] = Array.isArray(src.source_refs)
      ? src.source_refs
      : JSON.parse(src.source_refs ?? "[]");
    const tgtRefs: string[] = Array.isArray(tgt.source_refs)
      ? tgt.source_refs
      : JSON.parse(tgt.source_refs ?? "[]");
    const mergedRefs = [...new Set([...tgtRefs, ...srcRefs])].slice(-10);

    await superAdminDb.execute(sql`
      UPDATE support_knowledge_candidates
      SET occurrence_count   = ${newOccurrence},
          gpt_fallback_count = ${newGptCount},
          human_request_count = ${newHumanCount},
          source_refs        = ${JSON.stringify(mergedRefs)}::jsonb,
          updated_at         = NOW()
      WHERE id = ${target_id}
    `);

    await superAdminDb.execute(sql`
      UPDATE support_knowledge_candidates
      SET status     = 'MERGED',
          updated_at = NOW()
      WHERE id = ${id}
    `);

    return res.json({ ok: true, merged_into: target_id, new_occurrence_count: newOccurrence });
  } catch (err) {
    console.error("[learning] merge candidate error:", err);
    return res.status(500).json({ error: "Merge 실패" });
  }
});

// ── PATCH .../reclassify ───────────────────────────────────────────────────

router.patch("/super/support/knowledge-candidates/:id/reclassify", requireSuperAdmin, async (req, res) => {
  try {
    const { id }             = req.params;
    const { classification } = req.body;
    const validClassifications: CandidateClassification[] = [
      "NORMAL", "DYNAMIC_DATA_REQUIRED", "POLICY_REQUIRED", "AMBIGUOUS", "HUMAN_JUDGMENT_REQUIRED"
    ];
    if (!validClassifications.includes(classification)) {
      return res.status(400).json({ error: "classification 유효하지 않음" });
    }

    await superAdminDb.execute(sql`
      UPDATE support_knowledge_candidates
      SET classification = ${classification}, updated_at = NOW()
      WHERE id = ${id} AND status = 'PENDING'
    `);

    return res.json({ ok: true });
  } catch (err) {
    console.error("[learning] reclassify error:", err);
    return res.status(500).json({ error: "재분류 실패" });
  }
});

// ── GET /super/support/learning-metrics ───────────────────────────────────

router.get("/super/support/learning-metrics", requireSuperAdmin, async (req, res) => {
  try {
    const metrics = await getLearningMetrics();
    return res.json(metrics);
  } catch (err) {
    console.error("[learning] metrics error:", err);
    return res.status(500).json({ error: "메트릭 조회 실패" });
  }
});

export default router;
