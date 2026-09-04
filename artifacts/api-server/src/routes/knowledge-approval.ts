/**
 * knowledge-approval.ts — WP-CS16: Human Review / Knowledge Approval Governance
 *
 * Routes:
 *   GET  /super/support/candidates            — PENDING/EDIT_REQUIRED 목록
 *   GET  /super/support/candidates/:id        — 단건 상세 + checklist
 *   POST /super/support/candidates/:id/approve       — human approve
 *   POST /super/support/candidates/:id/reject        — human reject
 *   POST /super/support/candidates/:id/request-edit  — 수정 요청
 *   POST /super/support/knowledge/:id/rollback       — ACTIVE → ARCHIVED
 *
 * §2: 승인권한 = super_admin | platform_admin (JWT req.user.role 기준)
 * §9: client body reviewer_id/role 무시
 * §6: APPROVE 전 서버-측 재검증 (conflict check 포함)
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/auth.js";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { detectConflicts, hasUnresolvedConflict } from "../lib/knowledge-governance.js";
import {
  isApprovalAllowed,
  isGlobalApprovalAllowed,
  isTransitionAllowed,
  isValidRejectReason,
  isRollbackAllowed,
  isAiReviewerAttempt,
  validateApprovalChecklist,
  buildApprovalAuditRecord,
  buildPublicApprovalTrace,
  CS12_CANDIDATE_READINESS,
  getP0CoverageReadiness,
  NO_AUTO_PROMOTION_GUARANTEE,
  type CandidateRow,
  type AuditDecision,
} from "../lib/knowledge-approval.js";
import { assessFreshness } from "../lib/knowledge-governance.js";

const router = Router();

// ── §2: 승인 Role Guard ───────────────────────────────────────────────────────
// requireRole("super_admin") 대신 isApprovalAllowed() 직접 확인 사용.
// platform_admin도 포함해야 하므로 requirePlatformRole 패턴과 동일.

function requireApprovalRole(req: Request, res: Response, next: () => void) {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ ok: false, error: "인증이 필요합니다." });
    return;
  }
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

// ── Helper: DB row → CandidateRow ─────────────────────────────────────────────

function toCandidate(row: any): CandidateRow {
  return {
    id:              row.id,
    item_type:       row.item_type,
    status:          row.status,
    scope:           row.scope,
    source_ref:      row.source_ref,
    source_type:     row.source_type,
    affected_roles:  Array.isArray(row.affected_roles) ? row.affected_roles : null,
    affected_modes:  Array.isArray(row.affected_modes) ? row.affected_modes : null,
    feature:         row.feature,
    category:        row.category,
    pool_id:         row.pool_id,
    content:         row.content,
    answer:          row.answer,
    solution_steps:  row.solution_steps,
    revision:        row.revision ?? 1,
    updated_at:      row.updated_at ? new Date(row.updated_at).toISOString() : null,
    reviewed_by:     row.reviewed_by,
  };
}

// ── Helper: persist audit log ─────────────────────────────────────────────────

async function persistAuditLog(record: ReturnType<typeof buildApprovalAuditRecord>): Promise<void> {
  const logId = randomUUID();
  await superAdminDb.execute(sql`
    INSERT INTO knowledge_approval_log (
      id, candidate_id, previous_status, new_status,
      reviewer_id, reviewer_role, reviewed_at, decision,
      review_notes, reject_reason, request_id,
      candidate_revision, resulting_knowledge_id, source_version
    ) VALUES (
      ${logId},
      ${record.candidate_id},
      ${record.previous_status},
      ${record.new_status},
      ${record.reviewer_id},
      ${record.reviewer_role},
      ${record.reviewed_at},
      ${record.decision},
      ${record.review_notes ?? null},
      ${record.reject_reason ?? null},
      ${record.request_id},
      ${record.candidate_revision},
      ${record.resulting_knowledge_id ?? null},
      ${record.source_version ?? null}
    )
  `);
}

// ── Migration boot ────────────────────────────────────────────────────────────

import("../migrations/pool-db-cs-16.js")
  .then(async ({ runCs16Migration }) => {
    const { superAdminDb } = await import("@workspace/db");
    return runCs16Migration(superAdminDb);
  })
  .catch((e: any) => console.error("[cs-16-init]", e?.message));

// ── GET /super/support/candidates ─────────────────────────────────────────────
// §1: PENDING/EDIT_REQUIRED candidate 목록 + CS12 readiness 요약

router.get(
  "/super/support/candidates",
  requireAuth,
  requireApprovalRole,
  async (req: Request, res: Response) => {
    try {
      const statusFilter = (req.query.status as string) || "pending";
      const result = await superAdminDb.execute(sql`
        SELECT
          id, item_type, scope, category, feature,
          title, content, question, answer,
          affected_roles, affected_modes,
          frontend_screen_id, source_type, source_ref,
          status, revision, pool_id,
          reviewed_by, reviewed_at, reject_reason, edit_note,
          created_at, updated_at
        FROM support_knowledge_items
        WHERE status = ${statusFilter}
        ORDER BY created_at ASC
        LIMIT 200
      `) as any;

      const rows: any[] = result.rows ?? [];
      const candidates = rows.map(row => {
        const c = toCandidate(row);
        const checklist = validateApprovalChecklist(c);
        return {
          id:          c.id,
          item_type:   c.item_type,
          title:       row.title,
          feature:     c.feature,
          scope:       c.scope,
          pool_id:     c.pool_id,
          status:      c.status,
          revision:    c.revision,
          source_ref:  c.source_ref,
          reject_reason: row.reject_reason,
          edit_note:   row.edit_note,
          readiness:   checklist.readiness,
          blockers:    checklist.blockers.length,
          created_at:  row.created_at,
        };
      });

      res.json({
        ok:    true,
        total: candidates.length,
        status_filter: statusFilter,
        candidates,
        cs12_readiness_summary: {
          total:                    CS12_CANDIDATE_READINESS.length,
          ready_for_human_review:   CS12_CANDIDATE_READINESS.filter(c => c.readiness === "READY_FOR_HUMAN_REVIEW").length,
          review_required:          CS12_CANDIDATE_READINESS.filter(c => c.readiness === "REVIEW_REQUIRED").length,
          blocked:                  CS12_CANDIDATE_READINESS.filter(c => c.readiness === "BLOCKED").length,
        },
        p0_coverage: getP0CoverageReadiness(),
        no_auto_promotion_guarantee: NO_AUTO_PROMOTION_GUARANTEE,
      });
    } catch (err: any) {
      console.error("[candidates/list]", err?.message);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  }
);

// ── GET /super/support/candidates/:id ────────────────────────────────────────
// §1: 단건 상세 + approval checklist

router.get(
  "/super/support/candidates/:id",
  requireAuth,
  requireApprovalRole,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    // §19 IDOR 방지: id는 경로 파라미터; pool-specific이라도 super/platform_admin은 전체 접근 가능
    try {
      const result = await superAdminDb.execute(sql`
        SELECT
          id, item_type, scope, category, feature,
          title, content, question, answer,
          affected_roles, affected_modes,
          frontend_screen_id, source_type, source_ref,
          status, revision, pool_id,
          reviewed_by, reviewed_at, reject_reason, edit_note,
          supersedes_id, superseded_by_id,
          created_at, updated_at
        FROM support_knowledge_items
        WHERE id = ${id}
        LIMIT 1
      `) as any;

      const row = (result.rows ?? [])[0];
      if (!row) return res.status(404).json({ ok: false, error: "Candidate를 찾을 수 없습니다." });

      const candidate = toCandidate(row);
      const checklist = validateApprovalChecklist(candidate);

      // CS12 정적 readiness 정보
      const cs12AuditEntry = CS12_CANDIDATE_READINESS.find(c => c.id === id);

      // freshness
      const freshness = assessFreshness(
        row.updated_at ? new Date(row.updated_at) : null,
        candidate.revision ?? 1,
        row.superseded_by_id
      );

      res.json({
        ok:       true,
        candidate: {
          id:             row.id,
          item_type:      row.item_type,
          title:          row.title,
          content:        row.content,
          question:       row.question,
          answer:         row.answer,
          solution_steps: row.solution_steps,
          scope:          row.scope,
          category:       row.category,
          feature:        row.feature,
          pool_id:        row.pool_id,
          affected_roles: row.affected_roles,
          affected_modes: row.affected_modes,
          source_type:    row.source_type,
          source_ref:     row.source_ref,
          status:         row.status,
          revision:       row.revision,
          reject_reason:  row.reject_reason,
          edit_note:      row.edit_note,
          freshness_state: freshness,
          created_at:     row.created_at,
          updated_at:     row.updated_at,
        },
        checklist,
        cs12_audit: cs12AuditEntry ?? null,
        approval_trace: buildPublicApprovalTrace({
          id:          row.id,
          status:      row.status,
          revision:    row.revision ?? 1,
          reviewed_by: row.reviewed_by,
          reviewed_at: row.reviewed_at,
        }),
      });
    } catch (err: any) {
      console.error("[candidates/detail]", err?.message);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  }
);

// ── POST /super/support/candidates/:id/approve ────────────────────────────────
// §6: 서버 측 재검증 포함
// §7: 동시 승인 방지 (WHERE status = 'pending' 조건 + revision 동시성 가드)
// §9: reviewer = JWT actor (client body 무시)
// §13: supersede 검사 포함

router.post(
  "/super/support/candidates/:id/approve",
  requireAuth,
  requireApprovalRole,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const requestId = randomUUID(); // CS15 traceability

    // §9: client body reviewer_id 무시; JWT actor만 사용
    const actorId   = user.id ?? user.userId ?? "unknown";
    const actorRole = user.role;

    const reviewNotes: string | undefined = req.body?.review_notes;
    const supersededId: string | undefined = req.body?.supersedes_id; // 기존 ACTIVE를 대체할 ID

    // §5 CLIENT_ROLE guard: pool_admin은 global 승인 불가
    if (!isGlobalApprovalAllowed(actorRole)) {
      return res.status(403).json({
        ok: false,
        error: "global Knowledge 승인권한 없음",
        code: "GLOBAL_APPROVAL_FORBIDDEN",
      });
    }

    // §9: AI reviewer 시도 감지
    if (isAiReviewerAttempt(actorId, actorRole)) {
      return res.status(403).json({
        ok: false,
        error: "AI는 reviewer로 기록될 수 없습니다.",
        code: "AI_REVIEWER_FORBIDDEN",
      });
    }

    try {
      // §6: candidate 조회
      const result = await superAdminDb.execute(sql`
        SELECT id, item_type, status, revision, scope, pool_id,
               source_ref, affected_roles, affected_modes, feature,
               category, content, answer, solution_steps, updated_at
        FROM support_knowledge_items
        WHERE id = ${id}
        LIMIT 1
      `) as any;
      const row = (result.rows ?? [])[0];

      if (!row) {
        return res.status(404).json({ ok: false, error: "Candidate를 찾을 수 없습니다." });
      }

      // §6: status 검증 — PENDING 또는 EDIT_REQUIRED만 승인 가능
      if (row.status !== "pending" && row.status !== "edit_required") {
        return res.status(409).json({
          ok: false,
          error: `현재 상태(${row.status})에서는 승인 불가. PENDING 또는 EDIT_REQUIRED 상태만 승인 가능.`,
          code: "INVALID_STATUS_FOR_APPROVAL",
          current_status: row.status,
        });
      }

      // §6: rejected/archived 재활성화 방지
      if (["rejected", "archived", "superseded"].includes(row.status)) {
        return res.status(409).json({
          ok: false,
          error: "REJECTED/ARCHIVED/SUPERSEDED 상태는 승인 불가.",
          code: "CANNOT_APPROVE_TERMINAL_STATUS",
        });
      }

      // §6: checklist 서버-측 재검증
      const candidate = toCandidate(row);
      const checklist = validateApprovalChecklist(candidate);
      if (checklist.blockers.length > 0) {
        return res.status(422).json({
          ok:       false,
          error:    "Approval checklist 검증 실패 — 승인 불가 항목 존재",
          code:     "CHECKLIST_BLOCKED",
          blockers: checklist.blockers,
        });
      }

      // §12: ACTIVE Knowledge conflict 검사
      // 같은 feature 의 ACTIVE 항목을 조회하여 HARD_CONFLICT 검사
      if (row.feature) {
        const activeResult = await superAdminDb.execute(sql`
          SELECT id, item_type, feature, category, status, revision, updated_at, source_type
          FROM support_knowledge_items
          WHERE feature = ${row.feature}
            AND status = 'active'
            AND id != ${id}
          LIMIT 10
        `) as any;
        const activeItems = (activeResult.rows ?? []).map((r: any) => ({
          id:          r.id,
          item_type:   r.item_type,
          feature:     r.feature,
          category:    r.category,
          status:      r.status,
          revision:    r.revision ?? 1,
          updated_at:  r.updated_at ? new Date(r.updated_at).toISOString() : null,
          source_type: r.source_type,
          title:       "",
          answer:      "",
          score:       0,
          freshness_state: undefined,
        }));
        // §12: candidate를 'active' 상태로 매핑하여 conflict 검사
        // (detectPairConflict은 NONE authority = pending/draft 항목을 NO_CONFLICT 처리하므로
        //  "approval 시 active가 될 경우"를 시뮬레이션해야 함)
        const conflicts = detectConflicts([...activeItems, {
          id:          row.id,
          item_type:   row.item_type,
          feature:     row.feature,
          category:    row.category,
          status:      "active", // approval 후 상태 시뮬레이션
          revision:    row.revision ?? 1,
          updated_at:  row.updated_at ? new Date(row.updated_at).toISOString() : null,
          source_type: row.source_type,
          title:       "",
          answer:      "",
          score:       0,
          freshness_state: undefined,
        }]);
        const unresolvedConflicts = conflicts.filter(c => c.resolution === "UNRESOLVED");
        if (unresolvedConflicts.length > 0) {
          return res.status(422).json({
            ok:       false,
            error:    "HARD_CONFLICT 또는 CONTEXT_CONFLICT 미해소 — 승인 불가 (§12)",
            code:     "UNRESOLVED_CONFLICT",
            conflicts: unresolvedConflicts.map(c => ({
              type:    c.type,
              item_a:  c.item_a_id,
              item_b:  c.item_b_id,
            })),
          });
        }
      }

      // §7: 동시 승인 방지 — WHERE status='pending' AND revision=<current> 조건으로 UPDATE
      // 다른 admin이 먼저 승인하면 UPDATE rows=0
      const currentRevision = row.revision ?? 1;
      const updateResult = await superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET
          status      = 'active',
          reviewed_by = ${actorId},
          reviewed_at = NOW(),
          approved_by = ${actorId},
          approved_at = NOW(),
          revision    = revision + 1,
          updated_at  = NOW()
        WHERE id = ${id}
          AND status IN ('pending', 'edit_required')
          AND revision = ${currentRevision}
        RETURNING id, revision, status
      `) as any;

      const updated = (updateResult.rows ?? [])[0];
      if (!updated) {
        // §7: 동시 승인 중복 방지
        return res.status(409).json({
          ok:    false,
          error: "동시 승인 충돌 또는 상태 변경 — 다시 조회 후 확인하세요.",
          code:  "CONCURRENT_APPROVAL_CONFLICT",
        });
      }

      // §13: supersede 처리 (요청된 경우만)
      if (supersededId) {
        await superAdminDb.execute(sql`
          UPDATE support_knowledge_items
          SET
            status         = 'superseded',
            superseded_by_id = ${id},
            updated_at     = NOW(),
            revision       = revision + 1
          WHERE id = ${supersededId}
            AND status = 'active'
        `);
      }

      // §8: 감사 로그 저장
      const auditRecord = buildApprovalAuditRecord(
        { id: row.id, status: row.status, revision: currentRevision },
        { id: actorId, role: actorRole },
        "APPROVE",
        "active",
        requestId,
        {
          review_notes:            reviewNotes,
          resulting_knowledge_id:  id,
          source_version:          row.source_ref ?? undefined,
        }
      );

      await persistAuditLog(auditRecord).catch(e => {
        console.error("[approval/log]", e?.message);
      });

      res.json({
        ok:          true,
        id,
        status:      "active",
        new_revision: updated.revision,
        superseded_id: supersededId ?? null,
        approval_trace: {
          request_id:  requestId,
          reviewer_id: actorId,   // 내부 audit용 — §20 HTTP에는 reviewer 노출 최소화
          reviewer_role: actorRole,
          approved_at: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      console.error("[candidates/approve]", err?.message);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  }
);

// ── POST /super/support/candidates/:id/reject ─────────────────────────────────
// §11: REJECT_REASONS 검증, 감사 로그 저장

router.post(
  "/super/support/candidates/:id/reject",
  requireAuth,
  requireApprovalRole,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const requestId = randomUUID();
    const actorId   = user.id ?? user.userId ?? "unknown";
    const actorRole = user.role;

    const reason: string | undefined = req.body?.reason;
    const notes:  string | undefined = req.body?.notes;

    if (!reason || !isValidRejectReason(reason)) {
      return res.status(400).json({
        ok:    false,
        error: "유효한 reject reason 필요",
        code:  "INVALID_REJECT_REASON",
        valid_reasons: ["UNSUPPORTED_SOURCE","NOT_IMPLEMENTED","WRONG_ROLE","WRONG_MODE",
                        "POLICY_UNVERIFIED","DUPLICATE","CONFLICT","OUTDATED","SECURITY_RISK","OTHER"],
      });
    }

    try {
      const result = await superAdminDb.execute(sql`
        SELECT id, status, revision FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row = (result.rows ?? [])[0];
      if (!row) return res.status(404).json({ ok: false, error: "Candidate를 찾을 수 없습니다." });

      if (!isTransitionAllowed(row.status, "rejected")) {
        return res.status(409).json({
          ok:    false,
          error: `${row.status} → rejected 전환 불허`,
          code:  "INVALID_TRANSITION",
          current_status: row.status,
        });
      }

      const currentRevision = row.revision ?? 1;
      const updateResult = await superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET
          status      = 'rejected',
          reviewed_by = ${actorId},
          reviewed_at = NOW(),
          rejected_by = ${actorId},
          rejected_at = NOW(),
          reject_reason = ${reason},
          revision    = revision + 1,
          updated_at  = NOW()
        WHERE id = ${id}
          AND revision = ${currentRevision}
        RETURNING id, revision
      `) as any;

      if (!(updateResult.rows ?? [])[0]) {
        return res.status(409).json({ ok: false, error: "동시 상태 변경 감지", code: "CONCURRENT_CONFLICT" });
      }

      await persistAuditLog(buildApprovalAuditRecord(
        { id, status: row.status, revision: currentRevision },
        { id: actorId, role: actorRole },
        "REJECT",
        "rejected",
        requestId,
        { review_notes: notes, reject_reason: reason }
      )).catch(e => console.error("[reject/log]", e?.message));

      res.json({ ok: true, id, status: "rejected", reason });
    } catch (err: any) {
      console.error("[candidates/reject]", err?.message);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  }
);

// ── POST /super/support/candidates/:id/request-edit ──────────────────────────
// §10: EDIT_REQUIRED 설정 — 수정 후 재검토 필요

router.post(
  "/super/support/candidates/:id/request-edit",
  requireAuth,
  requireApprovalRole,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const requestId = randomUUID();
    const actorId   = user.id ?? user.userId ?? "unknown";
    const actorRole = user.role;
    const editNote: string | undefined = req.body?.edit_note;

    try {
      const result = await superAdminDb.execute(sql`
        SELECT id, status, revision FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row = (result.rows ?? [])[0];
      if (!row) return res.status(404).json({ ok: false, error: "Candidate를 찾을 수 없습니다." });

      if (!isTransitionAllowed(row.status, "edit_required")) {
        return res.status(409).json({
          ok:    false,
          error: `${row.status} → edit_required 전환 불허`,
          code:  "INVALID_TRANSITION",
          current_status: row.status,
        });
      }

      const currentRevision = row.revision ?? 1;
      const updateResult = await superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET
          status      = 'edit_required',
          reviewed_by = ${actorId},
          reviewed_at = NOW(),
          edit_note   = ${editNote ?? null},
          revision    = revision + 1,
          updated_at  = NOW()
        WHERE id = ${id}
          AND revision = ${currentRevision}
        RETURNING id, revision
      `) as any;

      if (!(updateResult.rows ?? [])[0]) {
        return res.status(409).json({ ok: false, error: "동시 상태 변경 감지", code: "CONCURRENT_CONFLICT" });
      }

      await persistAuditLog(buildApprovalAuditRecord(
        { id, status: row.status, revision: currentRevision },
        { id: actorId, role: actorRole },
        "REQUEST_EDIT",
        "edit_required",
        requestId,
        { review_notes: editNote }
      )).catch(e => console.error("[request-edit/log]", e?.message));

      res.json({ ok: true, id, status: "edit_required", edit_note: editNote ?? null });
    } catch (err: any) {
      console.error("[candidates/request-edit]", err?.message);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  }
);

// ── POST /super/support/knowledge/:id/rollback ────────────────────────────────
// §19: 잘못 승인된 Knowledge rollback — ACTIVE → ARCHIVED
// 일반 user/teacher/pool_admin 불가; rollback도 audit log 남김

router.post(
  "/super/support/knowledge/:id/rollback",
  requireAuth,
  requireApprovalRole,
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const requestId = randomUUID();
    const actorId   = user.id ?? user.userId ?? "unknown";
    const actorRole = user.role;
    const rollbackNote: string | undefined = req.body?.notes;

    try {
      const result = await superAdminDb.execute(sql`
        SELECT id, status, revision FROM support_knowledge_items WHERE id = ${id} LIMIT 1
      `) as any;
      const row = (result.rows ?? [])[0];
      if (!row) return res.status(404).json({ ok: false, error: "Knowledge를 찾을 수 없습니다." });

      const check = isRollbackAllowed(actorRole, row.status);
      if (!check.allowed) {
        return res.status(409).json({
          ok: false,
          error: check.reason,
          code: "ROLLBACK_NOT_ALLOWED",
          current_status: row.status,
        });
      }

      const currentRevision = row.revision ?? 1;
      const updateResult = await superAdminDb.execute(sql`
        UPDATE support_knowledge_items
        SET
          status     = 'archived',
          reviewed_by = ${actorId},
          reviewed_at = NOW(),
          revision   = revision + 1,
          updated_at = NOW()
        WHERE id = ${id}
          AND status = 'active'
          AND revision = ${currentRevision}
        RETURNING id, revision
      `) as any;

      if (!(updateResult.rows ?? [])[0]) {
        return res.status(409).json({
          ok:    false,
          error: "Knowledge가 이미 활성 상태가 아니거나 동시 변경 감지",
          code:  "ROLLBACK_CONFLICT",
        });
      }

      await persistAuditLog(buildApprovalAuditRecord(
        { id, status: "active", revision: currentRevision },
        { id: actorId, role: actorRole },
        "ROLLBACK",
        "archived",
        requestId,
        { review_notes: rollbackNote }
      )).catch(e => console.error("[rollback/log]", e?.message));

      res.json({
        ok:     true,
        id,
        status: "archived",
        note:   "retrieval에서 즉시 제외 — WHERE status='active' 가드 적용",
      });
    } catch (err: any) {
      console.error("[knowledge/rollback]", err?.message);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  }
);

// ── GET /super/support/approval-audit ─────────────────────────────────────────
// 감사 로그 조회 (super_admin/platform_admin 전용)

router.get(
  "/super/support/approval-audit",
  requireAuth,
  requireApprovalRole,
  async (req: Request, res: Response) => {
    try {
      const candidateId = req.query.candidate_id as string | undefined;
      const result = await superAdminDb.execute(sql`
        SELECT
          id, candidate_id, previous_status, new_status,
          reviewer_id, reviewer_role, reviewed_at, decision,
          review_notes, reject_reason, request_id,
          candidate_revision, resulting_knowledge_id, source_version,
          created_at
        FROM knowledge_approval_log
        ${candidateId ? sql`WHERE candidate_id = ${candidateId}` : sql``}
        ORDER BY reviewed_at DESC
        LIMIT 100
      `) as any;

      res.json({
        ok:      true,
        total:   (result.rows ?? []).length,
        records: result.rows ?? [],
      });
    } catch (err: any) {
      console.error("[approval-audit]", err?.message);
      res.status(500).json({ ok: false, error: "서버 오류" });
    }
  }
);

// ── GET /super/support/cs12-readiness ─────────────────────────────────────────
// §14/15: CS12 21개 Candidate 정적 readiness 감사 결과

router.get(
  "/super/support/cs12-readiness",
  requireAuth,
  requireApprovalRole,
  async (_req: Request, res: Response) => {
    res.json({
      ok:         true,
      total:      CS12_CANDIDATE_READINESS.length,
      readiness:  CS12_CANDIDATE_READINESS,
      p0_coverage: getP0CoverageReadiness(),
      summary: {
        ready_for_human_review: CS12_CANDIDATE_READINESS.filter(c => c.readiness === "READY_FOR_HUMAN_REVIEW").length,
        review_required:        CS12_CANDIDATE_READINESS.filter(c => c.readiness === "REVIEW_REQUIRED").length,
        blocked:                CS12_CANDIDATE_READINESS.filter(c => c.readiness === "BLOCKED").length,
      },
      auto_activation_this_request: false,
      no_auto_promotion_guarantee:  NO_AUTO_PROMOTION_GUARANTEE,
    });
  }
);

export default router;
