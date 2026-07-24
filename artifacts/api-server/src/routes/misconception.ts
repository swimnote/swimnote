/**
 * misconception.ts — 오개념 헌터 API
 * Misconception Hunter CRUD endpoints
 */
import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── helpers ─────────────────────────────────────────────────────────────────

function apiOk(res: any, data: any) {
  res.json({ success: true, ...data });
}
function apiErr(res: any, status: number, message: string) {
  res.status(status).json({ success: false, message });
}
function newId(prefix = "mc") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── GET /misconception/candidates ─────────────────────────────────────────
router.get("/misconception/candidates",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const {
        stroke, technique, claim_type, status, priority,
        review_needed, search, limit = "50", offset = "0"
      } = req.query as Record<string, string>;

      let where = "WHERE 1=1";
      const params: any[] = [];
      let idx = 1;

      if (stroke)        { where += ` AND stroke = $${idx++}`; params.push(stroke); }
      if (technique)     { where += ` AND technique = $${idx++}`; params.push(technique); }
      if (claim_type)    { where += ` AND claim_type = $${idx++}`; params.push(claim_type); }
      if (status)        { where += ` AND status = $${idx++}`; params.push(status); }
      if (priority)      { where += ` AND priority = $${idx++}`; params.push(priority); }
      if (review_needed === "true") { where += ` AND review_needed = TRUE`; }
      if (search) {
        where += ` AND (core_claim ILIKE $${idx} OR original_expression ILIKE $${idx})`;
        params.push(`%${search}%`); idx++;
      }

      const rows = await superAdminDb.execute(
        sql.raw(`SELECT * FROM misconception_candidates ${where} ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`, params)
      );
      const countRow = await superAdminDb.execute(
        sql.raw(`SELECT COUNT(*) AS total FROM misconception_candidates ${where}`, params)
      );
      apiOk(res, {
        items: rows.rows,
        total: parseInt((countRow.rows[0] as any)?.total ?? "0"),
      });
    } catch (e) {
      console.error("[misconception] list error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── GET /misconception/candidates/stats ────────────────────────────────────
router.get("/misconception/candidates/stats",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const rows = await superAdminDb.execute(sql.raw(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'new')          AS new_count,
          COUNT(*) FILTER (WHERE repeat_count >= 3)       AS repeated,
          COUNT(*) FILTER (WHERE review_needed = TRUE)    AS review_needed,
          COUNT(*) FILTER (WHERE status = 'rejected')     AS rejected,
          COUNT(*) FILTER (WHERE status = 'verified' OR status = 'supported') AS verified,
          COUNT(*) FILTER (WHERE status = 'new' AND created_at > NOW() - INTERVAL '7 days') AS recent_new
        FROM misconception_candidates
      `));
      apiOk(res, { stats: rows.rows[0] });
    } catch (e) {
      console.error("[misconception] stats error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── GET /misconception/candidates/:id ─────────────────────────────────────
router.get("/misconception/candidates/:id",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const rows = await superAdminDb.execute(
        sql`SELECT * FROM misconception_candidates WHERE id = ${req.params.id}`
      );
      if (!rows.rows.length) return apiErr(res, 404, "주장을 찾을 수 없습니다.");
      apiOk(res, { item: rows.rows[0] });
    } catch (e) {
      console.error("[misconception] get error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── POST /misconception/candidates ────────────────────────────────────────
router.post("/misconception/candidates",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const {
        core_claim, original_expression, stroke, technique, claim_type,
        status = "new", priority = "medium", confidence_score = 50,
        repeat_count = 1, review_needed = false,
        admin_memo, tags, sources_json, verification_memo,
        swimnote_position, diagnosis_json, dta_json, hunter_settings_json
      } = req.body;

      if (!core_claim) return apiErr(res, 400, "core_claim 필드 필요");

      const id = newId("mc");
      await superAdminDb.execute(sql`
        INSERT INTO misconception_candidates (
          id, core_claim, original_expression, stroke, technique, claim_type,
          status, priority, confidence_score, repeat_count, review_needed,
          admin_memo, tags, sources_json, verification_memo,
          swimnote_position, diagnosis_json, dta_json, hunter_settings_json,
          created_by, created_at, updated_at
        ) VALUES (
          ${id}, ${core_claim}, ${original_expression ?? null},
          ${stroke ?? null}, ${technique ?? null}, ${claim_type ?? "MISCONCEPTION"},
          ${status}, ${priority}, ${confidence_score}, ${repeat_count}, ${review_needed},
          ${admin_memo ?? null}, ${tags ?? null},
          ${sources_json ? JSON.stringify(sources_json) : null},
          ${verification_memo ?? null},
          ${swimnote_position ? JSON.stringify(swimnote_position) : null},
          ${diagnosis_json ? JSON.stringify(diagnosis_json) : null},
          ${dta_json ? JSON.stringify(dta_json) : null},
          ${hunter_settings_json ? JSON.stringify(hunter_settings_json) : null},
          ${req.user!.userId}, NOW(), NOW()
        )
      `);
      const newRow = await superAdminDb.execute(
        sql`SELECT * FROM misconception_candidates WHERE id = ${id}`
      );
      apiOk(res, { item: newRow.rows[0] });
    } catch (e) {
      console.error("[misconception] create error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── PATCH /misconception/candidates/:id ───────────────────────────────────
router.patch("/misconception/candidates/:id",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const fields = req.body as Record<string, any>;
      const id = req.params.id;

      // check exists
      const existing = await superAdminDb.execute(
        sql`SELECT id FROM misconception_candidates WHERE id = ${id}`
      );
      if (!existing.rows.length) return apiErr(res, 404, "주장을 찾을 수 없습니다.");

      const allowedFields = [
        "core_claim", "original_expression", "stroke", "technique", "claim_type",
        "status", "priority", "confidence_score", "repeat_count", "review_needed",
        "admin_memo", "tags", "sources_json", "verification_memo",
        "swimnote_position", "diagnosis_json", "dta_json", "hunter_settings_json",
        "verified_by", "verified_at", "final_verdict", "knowledge_db_synced"
      ];

      const setClauses: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      for (const field of allowedFields) {
        if (field in fields) {
          const val = typeof fields[field] === "object" && fields[field] !== null
            ? JSON.stringify(fields[field])
            : fields[field];
          setClauses.push(`${field} = $${idx++}`);
          vals.push(val);
        }
      }
      if (!setClauses.length) return apiErr(res, 400, "변경할 필드 없음");

      setClauses.push(`updated_at = NOW()`);
      await superAdminDb.execute(
        sql.raw(`UPDATE misconception_candidates SET ${setClauses.join(", ")} WHERE id = $${idx}`, [...vals, id])
      );

      const updated = await superAdminDb.execute(
        sql`SELECT * FROM misconception_candidates WHERE id = ${id}`
      );
      apiOk(res, { item: updated.rows[0] });
    } catch (e) {
      console.error("[misconception] update error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── DELETE /misconception/candidates/:id ──────────────────────────────────
router.delete("/misconception/candidates/:id",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await superAdminDb.execute(
        sql`DELETE FROM misconception_candidates WHERE id = ${req.params.id}`
      );
      apiOk(res, { deleted: true });
    } catch (e) {
      console.error("[misconception] delete error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── GET /misconception/hunter-settings ────────────────────────────────────
router.get("/misconception/hunter-settings",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const rows = await superAdminDb.execute(
        sql`SELECT * FROM misconception_hunter_settings LIMIT 1`
      );
      apiOk(res, { settings: rows.rows[0] ?? null });
    } catch (e) {
      console.error("[misconception] settings get error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── PUT /misconception/hunter-settings ────────────────────────────────────
router.put("/misconception/hunter-settings",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const {
        target_sources, target_languages, target_strokes,
        run_schedule, collection_criteria, approval_policy
      } = req.body;

      const existing = await superAdminDb.execute(
        sql`SELECT id FROM misconception_hunter_settings LIMIT 1`
      );

      if (existing.rows.length > 0) {
        await superAdminDb.execute(sql`
          UPDATE misconception_hunter_settings SET
            target_sources    = ${target_sources ? JSON.stringify(target_sources) : null},
            target_languages  = ${target_languages ? JSON.stringify(target_languages) : null},
            target_strokes    = ${target_strokes ? JSON.stringify(target_strokes) : null},
            run_schedule      = ${run_schedule ?? 'manual'},
            collection_criteria = ${collection_criteria ? JSON.stringify(collection_criteria) : null},
            approval_policy   = ${approval_policy ?? 'require_admin'},
            updated_at        = NOW(),
            updated_by        = ${req.user!.userId}
          WHERE id = ${(existing.rows[0] as any).id}
        `);
      } else {
        const settingsId = newId("hs");
        await superAdminDb.execute(sql`
          INSERT INTO misconception_hunter_settings (
            id, target_sources, target_languages, target_strokes,
            run_schedule, collection_criteria, approval_policy,
            created_at, updated_at, updated_by
          ) VALUES (
            ${settingsId},
            ${target_sources ? JSON.stringify(target_sources) : null},
            ${target_languages ? JSON.stringify(target_languages) : null},
            ${target_strokes ? JSON.stringify(target_strokes) : null},
            ${run_schedule ?? 'manual'},
            ${collection_criteria ? JSON.stringify(collection_criteria) : null},
            ${approval_policy ?? 'require_admin'},
            NOW(), NOW(), ${req.user!.userId}
          )
        `);
      }

      const updated = await superAdminDb.execute(
        sql`SELECT * FROM misconception_hunter_settings LIMIT 1`
      );
      apiOk(res, { settings: updated.rows[0] });
    } catch (e) {
      console.error("[misconception] settings put error:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

export default router;
