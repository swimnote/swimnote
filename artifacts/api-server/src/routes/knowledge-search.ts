/**
 * WP-CS-05R — Support Knowledge Search + Super Admin Knowledge CRUD Extension
 *
 * Public (authenticated) endpoints:
 *   GET  /support/knowledge/search
 *   GET  /support/knowledge/:id
 *
 * Super Admin only:
 *   GET  /super/support/knowledge/extended   (extended fields incl. new cols)
 *   PATCH /super/support/knowledge/:id/approve
 *   PATCH /super/support/knowledge/:id/deactivate
 *   PATCH /super/support/knowledge/:id/archive
 *   POST  /super/support/knowledge/x04-import  (X04 → PENDING candidate)
 *
 * Security:
 *   - Pool isolation: client pool_id param 무시, JWT 기반 pool_id 사용
 *   - GLOBAL items: 모든 인증 사용자
 *   - POOL   items: 해당 pool 사용자만 (super_admin은 임의 pool 검색 가능)
 *   - ACTIVE items만 support search에 포함
 *
 * Search: deterministic only — OpenAI/embedding = 0
 *
 * Analytics: KNOWLEDGE_HIT / FAQ_HIT / NO_KNOWLEDGE_MATCH 이벤트 기록
 *   raw query 전체 저장 금지; category/feature/screen_id/role/mode/knowledge_id/match_type만.
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import {
  isApprovalAllowed,
  isGlobalApprovalAllowed,
  isAiReviewerAttempt,
  validateApprovalChecklist,
  type CandidateRow,
} from "../lib/knowledge-approval.js";
import { detectConflicts } from "../lib/knowledge-governance.js";
import { SCREEN_BY_ID } from "../config/support/frontend-map.v1.js";

const router = Router();

// ── Migration boot ────────────────────────────────────────────────────────────
import("../migrations/pool-db-cs-05r.js")
  .then(async ({ runCs05rMigration }) => {
    const { superAdminDb } = await import("@workspace/db");
    return runCs05rMigration(superAdminDb);
  })
  .catch((e: any) => console.error("[cs-05r-init]", e?.message));

import("../migrations/pool-db-cs-12.js")
  .then(async ({ runCs12Migration }) => {
    const { superAdminDb } = await import("@workspace/db");
    return runCs12Migration(superAdminDb);
  })
  .catch((e: any) => console.error("[cs-12-init]", e?.message));

import("../migrations/pool-db-cs-15.js")
  .then(async ({ runCs15Migration }) => {
    const { superAdminDb } = await import("@workspace/db");
    return runCs15Migration(superAdminDb);
  })
  .catch((e: any) => console.error("[cs-15-init]", e?.message));

// ── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeRow {
  id: string;
  item_type: string;
  scope: string;
  pool_id: string | null;
  category: string | null;
  feature: string | null;
  affected_role: string | null;
  affected_mode: string | null;
  affected_roles: string[] | null;
  affected_modes: string[] | null;
  title: string;
  content: string;
  question: string | null;
  answer: string | null;
  deep_link: string | null;
  frontend_screen_id: string | null;
  source_type: string | null;
  source_ref: string | null;
  status: string;
  revision: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  usage_count: number;
  success_count: number;
  created_at: string;
  updated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** 역할 배열 검사: affected_roles[] 우선, fallback to affected_role 단수 */
function roleMatches(row: KnowledgeRow, role: string): boolean {
  if (row.affected_roles?.length) {
    return row.affected_roles.includes(role);
  }
  if (!row.affected_role || row.affected_role === "all") return true;
  return row.affected_role === role;
}

/** 모드 배열 검사: affected_modes[] 우선, fallback to affected_mode 단수 */
function modeMatches(row: KnowledgeRow, mode: string): boolean {
  if (row.affected_modes?.length) {
    return row.affected_modes.includes(mode);
  }
  if (!row.affected_mode || row.affected_mode === "all") return true;
  return row.affected_mode === mode;
}

function toPublicResult(row: KnowledgeRow, score: number, matchType: string) {
  // Frontend Map lookup로 deep_link 보강
  let deepLink = row.deep_link ?? null;
  if (!deepLink && row.frontend_screen_id) {
    const screen = SCREEN_BY_ID.get(row.frontend_screen_id);
    deepLink = screen?.deep_link ?? null;
  }

  return {
    knowledge_id:       row.id,
    item_type:          row.item_type,
    category:           row.category,
    feature:            row.feature,
    title:              row.title,
    content:            row.item_type === "FAQ" && row.answer ? undefined : row.content,
    question:           row.question ?? null,
    answer:             row.answer   ?? null,
    scope:              row.scope,
    screen_id:          row.frontend_screen_id ?? null,
    deep_link:          deepLink,
    source:             row.source_type ?? null,
    version:            row.revision ?? 1,
    score,
    match_type:         matchType,
    llm_required:       false,
  };
}

async function logSearchEvent(
  eventType: "FAQ_HIT" | "KNOWLEDGE_HIT" | "NO_KNOWLEDGE_MATCH",
  meta: {
    category?: string | null;
    feature?: string | null;
    screen_id?: string | null;
    role?: string;
    mode?: string;
    knowledge_id?: string;
    match_type?: string;
    pool_id?: string | null;
  }
) {
  try {
    const id = `ev_cs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await superAdminDb.execute(sql`
      INSERT INTO event_logs (id, category, action, metadata, created_at)
      VALUES (
        ${id},
        'SUPPORT',
        ${eventType},
        ${JSON.stringify({
          category:     meta.category   ?? null,
          feature:      meta.feature    ?? null,
          screen_id:    meta.screen_id  ?? null,
          role:         meta.role       ?? null,
          mode:         meta.mode       ?? null,
          knowledge_id: meta.knowledge_id ?? null,
          match_type:   meta.match_type  ?? null,
          pool_id:      meta.pool_id    ?? null,
        })}::jsonb,
        NOW()
      )
    `);
  } catch { /* best-effort */ }
}

async function logKnowledgeAudit(
  action: string,
  itemId: string,
  actorId: string,
  poolId: string | null,
  extra?: Record<string, unknown>
) {
  try {
    const id = `al_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action,
        actor_type, actor_id, pool_id, after_data, created_at
      ) VALUES (
        ${id}, 'support_knowledge', ${itemId}, ${action},
        'super_admin', ${actorId}, ${poolId},
        ${JSON.stringify({ ...extra })}::jsonb,
        NOW()
      )
    `);
  } catch { /* best-effort */ }
}

// ── GET /support/knowledge/search ─────────────────────────────────────────────

router.get(
  "/support/knowledge/search",
  requireAuth,
  async (req: Request, res: Response) => {
    const user    = (req as any).user;
    const role    = (user?.role  as string) ?? "";
    const mode    = ((req.query.mode as string) || "normal").toLowerCase();
    const category = (req.query.category  as string) ?? "";
    const feature  = (req.query.feature   as string) ?? "";
    const screenId = (req.query.screen_id as string) ?? "";
    const q        = ((req.query.q as string) ?? "").trim();

    // Pool isolation: JWT 기준, client query param 무시 (super_admin만 예외)
    const userPoolId = user?.poolId ?? null;
    const isSuperAdmin = role === "super_admin";
    const queryPoolId = isSuperAdmin
      ? ((req.query.pool_id as string) ?? null)
      : userPoolId;

    try {
      // ACTIVE items만. Pool isolation 포함.
      const rows = (await superAdminDb.execute(sql`
        SELECT id, item_type, scope, pool_id, category, feature,
               affected_role, affected_mode, affected_roles, affected_modes,
               title, content, question, answer, deep_link,
               frontend_screen_id, source_type, source_ref,
               status, revision, usage_count, success_count,
               reviewed_by, reviewed_at::text, created_at::text, updated_at::text
        FROM support_knowledge_items
        WHERE status = 'active'
          AND (
            scope = 'global'
            OR (scope = 'pool' AND pool_id = ${queryPoolId})
          )
        ORDER BY usage_count DESC
        LIMIT 500
      `)) as any;

      const allRows: KnowledgeRow[] = rows.rows ?? [];

      // role / mode 필터
      const eligible = allRows.filter((row) => {
        if (role && !isSuperAdmin) {
          if (!roleMatches(row, role)) return false;
        }
        if (mode) {
          if (!modeMatches(row, mode)) return false;
        }
        return true;
      });

      // screen_id 정확 매칭
      if (screenId) {
        const exact = eligible.filter((r) => r.frontend_screen_id === screenId);
        if (exact.length > 0) {
          const top = exact.slice(0, 5).map((r) => toPublicResult(r, 95, "exact_screen_id"));
          await logSearchEvent("KNOWLEDGE_HIT", {
            screen_id: screenId, role, mode,
            knowledge_id: top[0].knowledge_id, match_type: "exact_screen_id",
            pool_id: queryPoolId, category: top[0].category, feature: top[0].feature,
          });
          return res.json({ matched: true, results: top, total: exact.length, llm_required: false });
        }
      }

      // category / feature 필터 (query param)
      let filtered = eligible;
      if (category) filtered = filtered.filter((r) => r.category === category);
      if (feature)  filtered = filtered.filter((r) => r.feature  === feature);

      if (!q) {
        // q 없으면 필터된 전체 반환 (최대 20)
        const slice = filtered.slice(0, 20).map((r) => toPublicResult(r, 0, "filter_only"));
        return res.json({ matched: slice.length > 0, results: slice, total: filtered.length, llm_required: false });
      }

      // Deterministic scoring
      const qLower  = q.toLowerCase();
      const tokens  = tokenize(q);

      interface Scored { row: KnowledgeRow; score: number; matchType: string; }
      const scored: Scored[] = [];

      for (const row of filtered) {
        let score = 0;
        let matchType = "";

        // 1. exact FAQ question (90)
        if (row.question && row.question.toLowerCase() === qLower) {
          score = 90; matchType = "exact_faq_question";
        }
        // 2. exact title (85)
        else if (row.title.toLowerCase() === qLower) {
          score = 85; matchType = "exact_title";
        }
        // 3. FAQ question partial (80)
        else if (score < 80 && row.question && row.question.toLowerCase().includes(qLower)) {
          score = 80; matchType = "faq_question_partial";
        }
        // 4. title partial (75)
        if (score < 75 && row.title.toLowerCase().includes(qLower)) {
          score = 75; matchType = "title_partial";
        }
        // 5. feature exact (65)
        if (score < 65 && row.feature && row.feature.toLowerCase() === qLower) {
          score = 65; matchType = "feature_exact";
        }
        // 6. screen_id token (60)
        if (score < 60 && row.frontend_screen_id && row.frontend_screen_id.toLowerCase().includes(qLower.replace(/\s+/g, "_"))) {
          score = 60; matchType = "screen_id_match";
        }
        // 7. content partial (50)
        if (score < 50 && row.content.toLowerCase().includes(qLower)) {
          score = 50; matchType = "content_partial";
        }
        // 8. answer partial (48)
        if (score < 48 && row.answer && row.answer.toLowerCase().includes(qLower)) {
          score = 48; matchType = "answer_partial";
        }
        // 9. token match in content (35)
        if (score < 35) {
          const contentLower = row.content.toLowerCase();
          const qLowerFull   = (row.question ?? "").toLowerCase() + " " + (row.answer ?? "").toLowerCase();
          const hitCount = tokens.filter((t) => contentLower.includes(t) || qLowerFull.includes(t)).length;
          if (hitCount > 0) {
            score = 30 + Math.min(hitCount * 5, 25);
            matchType = "token_match";
          }
        }

        if (score > 0) scored.push({ row, score, matchType });
      }

      if (scored.length === 0) {
        await logSearchEvent("NO_KNOWLEDGE_MATCH", { role, mode, category: category || null, feature: feature || null, pool_id: queryPoolId });
        return res.json({ matched: false, results: [], total: 0, llm_required: true, reason: "NO_MATCH" });
      }

      scored.sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title));
      const top = scored.slice(0, 10);

      const eventType = top[0].row.item_type === "FAQ" ? "FAQ_HIT" : "KNOWLEDGE_HIT";
      await logSearchEvent(eventType, {
        category: top[0].row.category, feature: top[0].row.feature,
        screen_id: top[0].row.frontend_screen_id, role, mode,
        knowledge_id: top[0].row.id, match_type: top[0].matchType,
        pool_id: queryPoolId,
      });

      // Bump usage_count (best-effort, fire-and-forget)
      const hitId = top[0].row.id;
      superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET usage_count = usage_count + 1, updated_at = NOW()
        WHERE id = ${hitId}
      `).catch(() => {});

      return res.json({
        matched: true,
        results: top.map(({ row, score, matchType }) => toPublicResult(row, score, matchType)),
        total: scored.length,
        llm_required: false,
      });
    } catch (err) {
      console.error("[support/knowledge/search]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /support/knowledge/:id ────────────────────────────────────────────────

router.get(
  "/support/knowledge/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const user     = (req as any).user;
    const role     = user?.role as string;
    const poolId   = user?.poolId ?? null;
    const isSA     = role === "super_admin";
    const { id }   = req.params;

    try {
      const r = await superAdminDb.execute(sql`
        SELECT id, item_type, scope, pool_id, category, feature,
               affected_role, affected_mode, affected_roles, affected_modes,
               title, content, question, answer, deep_link,
               frontend_screen_id, source_type, status, revision,
               usage_count, created_at::text, updated_at::text
        FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row: KnowledgeRow | undefined = (r.rows ?? [])[0];
      if (!row) return res.status(404).json({ error: "항목을 찾을 수 없습니다." });

      // Pool isolation
      if (row.scope === "pool" && !isSA && row.pool_id !== poolId) {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
      // Active only (super_admin bypass)
      if (row.status !== "active" && !isSA) {
        return res.status(404).json({ error: "항목을 찾을 수 없습니다." });
      }

      return res.json({ matched: true, item: toPublicResult(row, 100, "direct_id"), llm_required: false });
    } catch (err) {
      console.error("[support/knowledge/:id]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/support/knowledge/list ─────────────────────────────────────────
// extended fields 포함 (super_admin 전용)

router.get(
  "/super/support/knowledge/list",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { item_type, status, category, feature, scope, pool_id, screen_id } =
      req.query as Record<string, string>;

    try {
      const conds: string[] = ["1=1"];
      const params: any[]   = [];
      if (item_type)  { params.push(item_type);  conds.push(`item_type = $${params.length}`);  }
      if (status)     { params.push(status);     conds.push(`status = $${params.length}`);     }
      if (category)   { params.push(category);   conds.push(`category = $${params.length}`);   }
      if (feature)    { params.push(feature);    conds.push(`feature = $${params.length}`);    }
      if (scope)      { params.push(scope);      conds.push(`scope = $${params.length}`);      }
      if (pool_id)    { params.push(pool_id);    conds.push(`pool_id = $${params.length}`);    }
      if (screen_id)  { params.push(screen_id);  conds.push(`frontend_screen_id = $${params.length}`); }

      const where = conds.join(" AND ");
      const r = await superAdminDb.execute(sql.raw(`
        SELECT id, item_type, scope, pool_id, category, feature,
               affected_role, affected_mode, affected_roles, affected_modes,
               title, content, question, answer, deep_link,
               frontend_screen_id, source_type, source_ref,
               status, revision, reviewed_by, reviewed_at::text,
               usage_count, success_count, created_at::text, updated_at::text
        FROM support_knowledge_items
        WHERE ${where}
        ORDER BY
          CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
          updated_at DESC
        LIMIT 300
      `, params)) as any;

      res.json({ items: r.rows ?? [] });
    } catch (err) {
      console.error("[super/support/knowledge/list]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── PATCH /super/support/knowledge/:id/approve ────────────────────────────────
// §CS16: Canonical governance — delegates to the same domain functions as
// knowledge-approval.ts to ensure APPROVAL_GOVERNANCE_BYPASS_PATHS = 0.

function requireApprovalRoleForSearch(req: Request, res: Response, next: () => void) {
  const user = (req as any).user;
  if (!user) { res.status(401).json({ ok: false, error: "인증이 필요합니다." }); return; }
  if (!isApprovalAllowed(user.role)) {
    res.status(403).json({
      ok: false,
      error: "승인권한 없음 — super_admin 또는 platform_admin만 접근 가능합니다.",
      code: "APPROVAL_FORBIDDEN",
    });
    return;
  }
  next();
}

router.patch(
  "/super/support/knowledge/:id/approve",
  requireAuth,
  requireApprovalRoleForSearch,
  async (req: Request, res: Response) => {
    const user    = (req as any).user;
    const { id }  = req.params;
    const actorId   = user?.id ?? user?.userId ?? "unknown";
    const actorRole = user?.role;
    const requestId = randomUUID(); // §CS15 traceability

    // §CS16 §9: AI reviewer 시도 감지 — client role forging 방지
    if (isAiReviewerAttempt(actorId, actorRole)) {
      return res.status(403).json({
        ok: false, error: "AI는 reviewer로 기록될 수 없습니다.", code: "AI_REVIEWER_FORBIDDEN",
      });
    }

    // §CS16 §5: global 승인권한 재확인 (pool_admin 우회 불가)
    if (!isGlobalApprovalAllowed(actorRole)) {
      return res.status(403).json({
        ok: false, error: "global Knowledge 승인권한 없음", code: "GLOBAL_APPROVAL_FORBIDDEN",
      });
    }

    try {
      const existing = await superAdminDb.execute(sql`
        SELECT id, item_type, status, pool_id, revision,
               source_ref, source_type, affected_roles, affected_modes,
               feature, category, content, answer, solution_steps, updated_at
        FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row = (existing.rows ?? [])[0];
      if (!row) return res.status(404).json({ ok: false, error: "항목을 찾을 수 없습니다." });

      // §CS16 §6: status gate — PENDING / EDIT_REQUIRED만 승인 가능
      if (row.status !== "pending" && row.status !== "edit_required") {
        return res.status(409).json({
          ok: false,
          error: `현재 상태(${row.status})에서는 승인 불가. PENDING 또는 EDIT_REQUIRED 상태만 승인 가능.`,
          code: "INVALID_STATUS_TRANSITION",
          current_status: row.status,
        });
      }

      // §CS16 §6: source / scope / role / mode 서버 검증 (canonical checklist)
      const candidate: CandidateRow = {
        id:             row.id,
        item_type:      row.item_type,
        status:         row.status,
        scope:          row.scope ?? null,
        source_ref:     row.source_ref ?? null,
        source_type:    row.source_type ?? null,
        affected_roles: Array.isArray(row.affected_roles) ? row.affected_roles : null,
        affected_modes: Array.isArray(row.affected_modes) ? row.affected_modes : null,
        feature:        row.feature ?? null,
        category:       row.category ?? null,
        pool_id:        row.pool_id ?? null,
        content:        row.content ?? null,
        answer:         row.answer ?? null,
        solution_steps: row.solution_steps ?? null,
        updated_at:     row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
      const checklist = validateApprovalChecklist(candidate);
      if (checklist.blockers.length > 0) {
        return res.status(422).json({
          ok: false, error: "Approval checklist 검증 실패", code: "CHECKLIST_BLOCKED",
          blockers: checklist.blockers,
        });
      }

      // §CS16 §12: ACTIVE Knowledge HARD_CONFLICT 검사 (같은 feature의 ACTIVE 항목)
      if (row.feature) {
        const activeResult = await superAdminDb.execute(sql`
          SELECT id, item_type, feature, category, status, revision, updated_at, source_type
          FROM support_knowledge_items
          WHERE feature = ${row.feature} AND status = 'active' AND id != ${id}
          LIMIT 10
        `) as any;
        const activeItems = (activeResult.rows ?? []).map((r: any) => ({
          id: r.id, item_type: r.item_type, feature: r.feature,
          category: r.category, status: r.status, revision: r.revision ?? 1,
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
          source_type: r.source_type, title: "", answer: "", score: 0,
          freshness_state: undefined,
        }));
        const conflicts = detectConflicts([...activeItems, {
          id: row.id, item_type: row.item_type, feature: row.feature,
          category: row.category, status: "active",
          revision: row.revision ?? 1,
          updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
          source_type: row.source_type, title: "", answer: "", score: 0,
          freshness_state: undefined,
        }]);
        const unresolved = conflicts.filter((c: any) => c.resolution === "UNRESOLVED");
        if (unresolved.length > 0) {
          return res.status(422).json({
            ok: false,
            error: "HARD_CONFLICT 또는 CONTEXT_CONFLICT 미해소 — 승인 불가 (§12)",
            code: "UNRESOLVED_CONFLICT",
            conflicts: unresolved.map((c: any) => ({ type: c.type, item_a: c.item_a_id, item_b: c.item_b_id })),
          });
        }
      }

      // §CS16 §7: 동시 승인 방지 — revision guard
      const currentRevision = row.revision ?? 1;
      const updateResult = await superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET status      = 'active',
            reviewed_by = ${actorId}, reviewed_at = NOW(),
            approved_by = ${actorId}, approved_at = NOW(),
            revision    = revision + 1, updated_at  = NOW()
        WHERE id = ${id}
          AND status IN ('pending', 'edit_required')
          AND revision = ${currentRevision}
        RETURNING id, revision
      `) as any;

      if (!(updateResult?.rows ?? [])[0]) {
        return res.status(409).json({
          ok: false,
          error: "동시 상태 변경 감지 — 최신 상태를 다시 조회하세요",
          code:  "CONCURRENT_APPROVAL_CONFLICT",
        });
      }

      await logKnowledgeAudit("KNOWLEDGE_ACTIVATED", id, actorId, row.pool_id, {
        request_id: requestId, actor_role: actorRole,
        resulting_knowledge_id: id, source_version: row.source_ref ?? undefined,
      });
      res.json({ ok: true, id, status: "active", request_id: requestId });
    } catch (err) {
      console.error("[knowledge/approve]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── PATCH /super/support/knowledge/:id/deactivate ────────────────────────────

router.patch(
  "/super/support/knowledge/:id/deactivate",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const actorId = (req as any).user?.id ?? "unknown";
    const { id }  = req.params;

    try {
      const existing = await superAdminDb.execute(sql`
        SELECT id, status, pool_id FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row = (existing.rows ?? [])[0];
      if (!row) return res.status(404).json({ error: "항목을 찾을 수 없습니다." });

      await superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET status = 'inactive', updated_at = NOW(), revision = revision + 1
        WHERE id = ${id}
      `);

      await logKnowledgeAudit("KNOWLEDGE_DEACTIVATED", id, actorId, row.pool_id);
      res.json({ ok: true, id, status: "inactive" });
    } catch (err) {
      console.error("[knowledge/deactivate]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── PATCH /super/support/knowledge/:id/archive ───────────────────────────────

router.patch(
  "/super/support/knowledge/:id/archive",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const actorId = (req as any).user?.id ?? "unknown";
    const { id }  = req.params;

    try {
      const existing = await superAdminDb.execute(sql`
        SELECT id, status, pool_id FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row = (existing.rows ?? [])[0];
      if (!row) return res.status(404).json({ error: "항목을 찾을 수 없습니다." });

      await superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET status = 'archived', updated_at = NOW(), revision = revision + 1
        WHERE id = ${id}
      `);

      await logKnowledgeAudit("KNOWLEDGE_ARCHIVED", id, actorId, row.pool_id);
      res.json({ ok: true, id, status: "archived" });
    } catch (err) {
      console.error("[knowledge/archive]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/support/knowledge ─────────────────────────────────────────────
// Super Admin 전용 생성 (기존 cs-pa0 POST 보완: question/answer/new fields 지원)

router.post(
  "/super/support/knowledge/create",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const actorId = (req as any).user?.id ?? "unknown";
    const {
      item_type, title, content, question, answer,
      category, feature,
      affected_role, affected_mode, affected_roles, affected_modes,
      scope, pool_id,
      frontend_screen_id, source_type, source_ref, deep_link,
    } = req.body;

    if (!item_type || !title || !content) {
      return res.status(400).json({ error: "item_type, title, content 필수" });
    }
    const VALID_TYPES = ["FAQ", "RULE", "KNOWN_ISSUE", "SOLUTION"];
    if (!VALID_TYPES.includes(item_type)) {
      return res.status(400).json({ error: "item_type: FAQ/RULE/KNOWN_ISSUE/SOLUTION" });
    }
    if (scope === "pool" && !pool_id) {
      return res.status(400).json({ error: "scope=pool 이면 pool_id 필수" });
    }
    if (item_type === "FAQ" && (!question || !answer)) {
      return res.status(400).json({ error: "FAQ 항목은 question과 answer 필수" });
    }

    try {
      const id = `ki_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const rolesArr = Array.isArray(affected_roles) ? affected_roles : null;
      const modesArr = Array.isArray(affected_modes) ? affected_modes : null;

      await superAdminDb.execute(sql`
        INSERT INTO support_knowledge_items (
          id, item_type, scope, pool_id, category, feature,
          affected_role, affected_mode, affected_roles, affected_modes,
          title, content, question, answer,
          frontend_screen_id, source_type, source_ref, deep_link,
          status, revision, created_at, updated_at
        ) VALUES (
          ${id}, ${item_type}, ${scope ?? "global"}, ${pool_id ?? null},
          ${category ?? null}, ${feature ?? null},
          ${affected_role ?? null}, ${affected_mode ?? null},
          ${rolesArr}, ${modesArr},
          ${title}, ${content}, ${question ?? null}, ${answer ?? null},
          ${frontend_screen_id ?? null}, ${source_type ?? "MANUAL_ADMIN"}, ${source_ref ?? null},
          ${deep_link ?? null},
          'pending', 1, NOW(), NOW()
        )
      `);

      await logKnowledgeAudit("KNOWLEDGE_CREATED", id, actorId, pool_id ?? null, { item_type, title });
      res.json({ ok: true, id, status: "pending" });
    } catch (err) {
      console.error("[super/support/knowledge/create]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── PATCH /super/support/knowledge/:id ───────────────────────────────────────
// 기존 cs-pa0 PATCH 보완 (question/answer/new fields + audit)

router.patch(
  "/super/support/knowledge/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const actorId  = (req as any).user?.id ?? "unknown";
    const { id }   = req.params;
    const {
      title, content, question, answer,
      category, feature,
      frontend_screen_id, source_type, source_ref, deep_link,
      affected_roles, affected_modes,
    } = req.body;

    try {
      const existing = await superAdminDb.execute(sql`
        SELECT id, pool_id, status FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row = (existing.rows ?? [])[0];
      if (!row) return res.status(404).json({ error: "항목을 찾을 수 없습니다." });

      const sets: string[] = ["updated_at = NOW()", "revision = revision + 1"];
      if (title)              sets.push(`title = '${esc(title)}'`);
      if (content)            sets.push(`content = '${esc(content)}'`);
      if (question !== undefined) sets.push(`question = ${question ? `'${esc(question)}'` : "NULL"}`);
      if (answer   !== undefined) sets.push(`answer   = ${answer   ? `'${esc(answer)}'`   : "NULL"}`);
      if (category !== undefined) sets.push(`category = ${category ? `'${esc(category)}'` : "NULL"}`);
      if (feature  !== undefined) sets.push(`feature  = ${feature  ? `'${esc(feature)}'`  : "NULL"}`);
      if (frontend_screen_id !== undefined) sets.push(`frontend_screen_id = ${frontend_screen_id ? `'${esc(frontend_screen_id)}'` : "NULL"}`);
      if (source_type !== undefined) sets.push(`source_type = ${source_type ? `'${esc(source_type)}'` : "NULL"}`);
      if (source_ref  !== undefined) sets.push(`source_ref  = ${source_ref  ? `'${esc(source_ref)}'`  : "NULL"}`);
      if (deep_link   !== undefined) sets.push(`deep_link   = ${deep_link   ? `'${esc(deep_link)}'`   : "NULL"}`);
      if (Array.isArray(affected_roles)) {
        sets.push(`affected_roles = ARRAY[${affected_roles.map((r) => `'${r}'`).join(",")}]::text[]`);
      }
      if (Array.isArray(affected_modes)) {
        sets.push(`affected_modes = ARRAY[${affected_modes.map((m) => `'${m}'`).join(",")}]::text[]`);
      }

      await superAdminDb.execute(sql.raw(
        `UPDATE support_knowledge_items SET ${sets.join(", ")} WHERE id = $1`,
        [id]
      ));

      await logKnowledgeAudit("KNOWLEDGE_UPDATED", id, actorId, row.pool_id);
      res.json({ ok: true, updated: sets.length - 2 }); // -2 for updated_at + revision
    } catch (err) {
      console.error("[super/support/knowledge/patch]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/support/knowledge/x04-import ─────────────────────────────────
// X04 website FAQ → PENDING Knowledge candidate (POOL scope 필수)

router.post(
  "/super/support/knowledge/x04-import",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const actorId = (req as any).user?.id ?? "unknown";
    const { pool_id, faq_items } = req.body;

    if (!pool_id) return res.status(400).json({ error: "pool_id 필수" });
    if (!Array.isArray(faq_items) || faq_items.length === 0) {
      return res.status(400).json({ error: "faq_items[] 필수" });
    }

    const MAX_IMPORT = 50;
    if (faq_items.length > MAX_IMPORT) {
      return res.status(400).json({ error: `한 번에 최대 ${MAX_IMPORT}개까지 가능합니다.` });
    }

    const created: string[] = [];
    const skipped: string[] = [];

    for (const item of faq_items) {
      if (!item.question || !item.answer) { skipped.push(item.question ?? "?"); continue; }

      try {
        const id = `ki_x04_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await superAdminDb.execute(sql`
          INSERT INTO support_knowledge_items (
            id, item_type, scope, pool_id, category,
            title, content, question, answer,
            source_type, status, revision, created_at, updated_at
          ) VALUES (
            ${id}, 'FAQ', 'pool', ${pool_id}, 'POOL_INFO',
            ${item.question}, ${item.answer ?? item.question}, ${item.question}, ${item.answer},
            'X_SETUP', 'pending', 1, NOW(), NOW()
          )
        `);
        await logKnowledgeAudit("KNOWLEDGE_CREATED", id, actorId, pool_id, {
          source: "x04_import", question_preview: item.question.slice(0, 80)
        });
        created.push(id);
      } catch (e: any) {
        skipped.push(item.question ?? "?");
      }
    }

    res.json({ ok: true, created: created.length, skipped: skipped.length, status: "pending" });
  }
);

// ── helpers ────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

export default router;
