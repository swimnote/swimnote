/**
 * super-curriculum.ts — SWIMNOTE X Curriculum APP MASTER Import API
 *
 * Routes (all: requireAuth + requireRole("super_admin")):
 *
 *   POST   /super/curriculum/pools/:poolId/upload
 *          — APP MASTER DOCX 업로드 → R2 저장 → curriculum_versions DRAFT 생성
 *
 *   GET    /super/curriculum/pools/:poolId/versions/:versionId/preview
 *          — R2에서 DOCX 읽어 파싱 → 구조화 preview 반환 (DB 쓰기 없음)
 *
 *   POST   /super/curriculum/pools/:poolId/versions/:versionId/import
 *          — transaction: curriculum_items + drills + relations 삽입
 *
 *   POST   /super/curriculum/pools/:poolId/versions/:versionId/activate
 *          — 기존 ACTIVE → ARCHIVED, 새 버전 → ACTIVE
 *
 *   POST   /super/curriculum/pools/:poolId/versions/:versionId/archive
 *          — 해당 버전 ARCHIVED
 *
 *   GET    /super/curriculum/pools/:poolId/versions
 *          — 버전 이력 목록
 *
 *   GET    /super/curriculum/pools/:poolId/versions/:versionId/nodes
 *          — 노드 목록 (paginated, level_order 필터)
 *
 * 안전:
 *   - super_admin만 접근
 *   - pool ownership: 요청 poolId가 실제 존재하는지 확인
 *   - 파일: .docx / MIME 검증, 최대 20MB
 *   - tenant isolation: 모든 쿼리에 swimming_pool_id 조건
 */

import { Router } from "express";
import multer from "multer";
import { sql } from "drizzle-orm";
import { db, superAdminDb } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { downloadFromR2, uploadToR2 } from "../lib/objectStorage.js";
import { parseAppMasterDocx } from "../lib/appMasterDocxParser.js";
import { runCurriculumAppMasterMigration } from "../migrations/curriculum-app-master-init.js";

const router = Router();

// ── 공통 미들웨어 ──────────────────────────────────────────────────────────────

const isSuperAdmin = requireRole("super_admin");

// ── Multer (메모리, 최대 20MB) ─────────────────────────────────────────────────

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const docxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === DOCX_MIME ||
      file.originalname.toLowerCase().endsWith(".docx")
    ) {
      cb(null, true);
    } else {
      cb(new Error("DOCX 파일(.docx)만 업로드 가능합니다."));
    }
  },
});

function validateDocx(file: Express.Multer.File): string | null {
  if (!file.originalname.toLowerCase().endsWith(".docx"))
    return "파일 확장자가 .docx여야 합니다.";
  if (file.size > 20 * 1024 * 1024)
    return "파일 크기는 20MB를 초과할 수 없습니다.";
  if (!file.buffer || file.buffer.length < 4)
    return "파일이 비어 있거나 손상되었습니다.";
  // DOCX ZIP magic: PK (0x50 0x4B)
  if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4B)
    return "파일이 유효한 DOCX 형식이 아닙니다.";
  return null;
}

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// pool 존재 확인 (tenant isolation)
async function assertPoolExists(poolId: string): Promise<boolean> {
  const res = await superAdminDb.execute(sql`
    SELECT id FROM swimming_pools WHERE id = ${poolId} LIMIT 1
  `);
  return res.rows.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /super/curriculum/pools/:poolId/upload
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/pools/:poolId/upload",
  requireAuth, isSuperAdmin,
  docxUpload.single("file"),
  async (req: AuthRequest, res) => {
    try {
      const { poolId } = req.params;
      const file = req.file;

      if (!file) return res.status(400).json({ error: "파일을 선택해주세요." });
      const fileErr = validateDocx(file);
      if (fileErr) return res.status(422).json({ error: fileErr, code: "INVALID_DOCX" });

      if (!await assertPoolExists(poolId))
        return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      // R2에 업로드
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const r2Key = `curriculum-master/${poolId}/APP_MASTER_${Date.now()}_${safeName}`;
      const { ok, error: uploadErr } = await uploadToR2(r2Key, file.buffer, DOCX_MIME, "photo");
      if (!ok) return res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: uploadErr });

      // version_name: body 또는 파일명 기반
      const versionName =
        (req.body?.version_name as string | undefined)?.trim() ||
        `IMPORT_${new Date().toISOString().slice(0, 10)}_${Date.now()}`;

      const versionId = genId("cv");
      await db.execute(sql`
        INSERT INTO curriculum_versions
          (id, swimming_pool_id, version_name, is_active,
           import_status, source_r2_key, created_by, created_at, updated_at)
        VALUES
          (${versionId}, ${poolId}, ${versionName}, false,
           'DRAFT', ${r2Key}, ${req.user?.userId ?? null}, now(), now())
      `);

      return res.status(200).json({
        ok: true,
        version_id: versionId,
        version_name: versionName,
        r2_key: r2Key,
        import_status: "DRAFT",
        message: "파일이 업로드되었습니다. 다음 단계: /preview 로 내용을 확인하세요.",
      });
    } catch (e: any) {
      console.error("[super-curriculum/upload]", e);
      return res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /super/curriculum/pools/:poolId/versions/:versionId/preview
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/pools/:poolId/versions/:versionId/preview",
  requireAuth, isSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { poolId, versionId } = req.params;

      const verRes = await db.execute(sql`
        SELECT id, version_name, is_active, import_status, source_r2_key
        FROM curriculum_versions
        WHERE id = ${versionId} AND swimming_pool_id = ${poolId}
        LIMIT 1
      `);
      if (verRes.rows.length === 0)
        return res.status(404).json({ error: "버전을 찾을 수 없습니다." });

      const ver = verRes.rows[0] as any;
      if (!ver.source_r2_key)
        return res.status(409).json({ error: "이 버전에는 업로드된 DOCX 파일이 없습니다." });

      const { ok, data, error: dlErr } = await downloadFromR2(ver.source_r2_key, "photo");
      if (!ok || !data)
        return res.status(503).json({ error: "파일을 가져올 수 없습니다.", detail: dlErr });

      const parsed = parseAppMasterDocx(Buffer.from(data));

      return res.status(200).json({
        version_id: versionId,
        version_name: ver.version_name,
        import_status: ver.import_status,
        meta: parsed.meta,
        stats: parsed.stats,
        validation: parsed.validation,
        levels_summary: parsed.levels.map(lv => ({
          level_order: lv.level_order,
          level_name: lv.level_name,
          node_count: lv.nodes.length,
          drill_count: lv.drills.length,
          test_node_count: lv.nodes.filter(n => n.is_test_item).length,
        })),
        relations_count: parsed.relations.length,
      });
    } catch (e: any) {
      console.error("[super-curriculum/preview]", e);
      return res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /super/curriculum/pools/:poolId/versions/:versionId/import
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/pools/:poolId/versions/:versionId/import",
  requireAuth, isSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { poolId, versionId } = req.params;

      const verRes = await db.execute(sql`
        SELECT id, version_name, import_status, source_r2_key
        FROM curriculum_versions
        WHERE id = ${versionId} AND swimming_pool_id = ${poolId}
        FOR UPDATE
      `);
      if (verRes.rows.length === 0)
        return res.status(404).json({ error: "버전을 찾을 수 없습니다." });

      const ver = verRes.rows[0] as any;
      if (ver.import_status === "IMPORTED" || ver.import_status === "ACTIVE")
        return res.status(409).json({ error: `이미 ${ver.import_status} 상태입니다.` });
      if (!ver.source_r2_key)
        return res.status(409).json({ error: "업로드된 DOCX 파일이 없습니다." });

      // Parse
      const { ok, data, error: dlErr } = await downloadFromR2(ver.source_r2_key, "photo");
      if (!ok || !data)
        return res.status(503).json({ error: "파일을 가져올 수 없습니다.", detail: dlErr });

      const parsed = parseAppMasterDocx(Buffer.from(data));

      if (!parsed.validation.is_valid) {
        // Update to FAILED
        await db.execute(sql`
          UPDATE curriculum_versions
          SET import_status = 'FAILED',
              import_meta = ${JSON.stringify({ errors: parsed.validation.errors, warnings: parsed.validation.warnings, stats: parsed.stats })}::jsonb,
              updated_at = now()
          WHERE id = ${versionId}
        `);
        return res.status(422).json({
          error: "검증 오류로 Import 불가합니다.",
          validation: parsed.validation,
          stats: parsed.stats,
        });
      }

      // Transaction import
      await db.transaction(async (tx) => {
        // Build all node IDs first (for FK in drills)
        const nodeIdMap = new Map<string, string>(); // display_no → item_id

        for (const lv of parsed.levels) {
          for (const node of lv.nodes) {
            const itemId = genId("ci");
            nodeIdMap.set(node.display_no, itemId);

            await tx.execute(sql`
              INSERT INTO curriculum_items
                (id, curriculum_version_id, swimming_pool_id, sort_order,
                 title, description, is_active,
                 level_order, sequence_in_level, display_no,
                 stroke, domain, skill_group, atomic_skill,
                 node_data, is_test_item, source_trace, is_master_import,
                 created_at)
              VALUES
                (${itemId}, ${versionId}, ${poolId}, ${node.sort_order},
                 ${node.title},
                 ${node.atomic_skill ?? null},
                 true,
                 ${node.level_order}, ${node.sequence_in_level}, ${node.display_no},
                 ${node.stroke ?? null}, ${node.domain ?? null},
                 ${node.skill_group ?? null}, ${node.atomic_skill ?? null},
                 ${JSON.stringify(node.node_data)}::jsonb,
                 ${node.is_test_item}, ${node.source_trace ?? null}, true,
                 now())
            `);
          }

          // Insert drills for this level
          let drillSort = 0;
          for (const drill of lv.drills) {
            const nodeItemId = nodeIdMap.get(drill.node_display_no);
            if (!nodeItemId) continue; // already caught in validation

            const drillId = genId("cd");
            await tx.execute(sql`
              INSERT INTO curriculum_drills
                (id, curriculum_version_id, curriculum_item_id, swimming_pool_id,
                 title, target_aspect, movement_sequence, repetitions,
                 immediate_feedback, integration, sprint_validation,
                 failure_return_display_no, sort_order, created_at)
              VALUES
                (${drillId}, ${versionId}, ${nodeItemId}, ${poolId},
                 ${drill.title}, ${drill.target_aspect ?? null},
                 ${drill.movement_sequence ?? null}, ${drill.repetitions ?? null},
                 ${drill.immediate_feedback ?? null}, ${drill.integration ?? null},
                 ${drill.sprint_validation ?? null},
                 ${drill.failure_return_display_no ?? null},
                 ${drillSort++}, now())
            `);
          }
        }

        // Insert relations
        for (const rel of parsed.relations) {
          const relId = genId("cnr");
          await tx.execute(sql`
            INSERT INTO curriculum_node_relations
              (id, curriculum_version_id, swimming_pool_id,
               from_node_display_no, to_node_display_no, relation_type, created_at)
            VALUES
              (${relId}, ${versionId}, ${poolId},
               ${rel.from_node_display_no}, ${rel.to_node_display_no},
               ${rel.relation_type}, now())
            ON CONFLICT (curriculum_version_id, from_node_display_no, to_node_display_no, relation_type)
              DO NOTHING
          `);
        }

        // Update version status
        await tx.execute(sql`
          UPDATE curriculum_versions
          SET import_status = 'IMPORTED',
              import_meta = ${JSON.stringify({
                errors: parsed.validation.errors,
                warnings: parsed.validation.warnings,
                stats: parsed.stats,
                meta: parsed.meta,
              })}::jsonb,
              updated_at = now()
          WHERE id = ${versionId}
        `);
      });

      return res.status(200).json({
        ok: true,
        version_id: versionId,
        import_status: "IMPORTED",
        stats: parsed.stats,
        warnings: parsed.validation.warnings,
        message: "Import 완료. [활성화] 버튼으로 ACTIVE 전환하세요.",
      });
    } catch (e: any) {
      // Revert status to FAILED on exception
      try {
        await db.execute(sql`
          UPDATE curriculum_versions
          SET import_status = 'FAILED', updated_at = now()
          WHERE id = ${req.params.versionId}
        `);
      } catch { /* ignore */ }
      console.error("[super-curriculum/import]", e);
      return res.status(500).json({ error: "Import 중 오류가 발생했습니다.", detail: e?.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /super/curriculum/pools/:poolId/versions/:versionId/activate
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/pools/:poolId/versions/:versionId/activate",
  requireAuth, isSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { poolId, versionId } = req.params;

      const verRes = await db.execute(sql`
        SELECT id, import_status, is_active FROM curriculum_versions
        WHERE id = ${versionId} AND swimming_pool_id = ${poolId}
        FOR UPDATE
      `);
      if (verRes.rows.length === 0)
        return res.status(404).json({ error: "버전을 찾을 수 없습니다." });

      const ver = verRes.rows[0] as any;
      if (ver.is_active)
        return res.status(409).json({ error: "이미 ACTIVE 상태입니다." });
      if (ver.import_status !== "IMPORTED" && ver.import_status !== "VALIDATED")
        return res.status(409).json({
          error: `활성화하려면 먼저 Import를 완료해야 합니다. (현재: ${ver.import_status})`,
        });

      await db.transaction(async (tx) => {
        // 기존 ACTIVE → ARCHIVED
        await tx.execute(sql`
          UPDATE curriculum_versions
          SET is_active = false,
              import_status = 'ARCHIVED',
              archived_at = now(),
              updated_at = now()
          WHERE swimming_pool_id = ${poolId}
            AND is_active = true
            AND id != ${versionId}
        `);

        // 새 버전 ACTIVE
        await tx.execute(sql`
          UPDATE curriculum_versions
          SET is_active = true,
              import_status = 'ACTIVE',
              activated_at = now(),
              updated_at = now()
          WHERE id = ${versionId}
        `);
      });

      return res.status(200).json({
        ok: true,
        version_id: versionId,
        import_status: "ACTIVE",
        message: "커리큘럼이 활성화되었습니다.",
      });
    } catch (e: any) {
      console.error("[super-curriculum/activate]", e);
      return res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /super/curriculum/pools/:poolId/versions/:versionId/archive
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/pools/:poolId/versions/:versionId/archive",
  requireAuth, isSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { poolId, versionId } = req.params;

      const res2 = await db.execute(sql`
        UPDATE curriculum_versions
        SET is_active = false,
            import_status = 'ARCHIVED',
            archived_at = now(),
            updated_at = now()
        WHERE id = ${versionId}
          AND swimming_pool_id = ${poolId}
          AND import_status != 'ARCHIVED'
      `);
      if ((res2 as any).rowCount === 0)
        return res.status(409).json({ error: "이미 ARCHIVED 상태이거나 버전을 찾을 수 없습니다." });

      return res.status(200).json({ ok: true, version_id: versionId, import_status: "ARCHIVED" });
    } catch (e: any) {
      console.error("[super-curriculum/archive]", e);
      return res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /super/curriculum/pools/:poolId/versions
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/pools/:poolId/versions",
  requireAuth, isSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { poolId } = req.params;

      if (!await assertPoolExists(poolId))
        return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const versRes = await db.execute(sql`
        SELECT
          cv.id,
          cv.version_name,
          cv.is_active,
          cv.import_status,
          cv.activated_at,
          cv.archived_at,
          cv.created_at,
          cv.import_meta,
          cv.source_r2_key,
          COUNT(ci.id)::int AS node_count
        FROM curriculum_versions cv
        LEFT JOIN curriculum_items ci
          ON ci.curriculum_version_id = cv.id AND ci.is_active = true
        WHERE cv.swimming_pool_id = ${poolId}
        GROUP BY cv.id
        ORDER BY cv.created_at DESC
        LIMIT 50
      `);

      return res.status(200).json({
        pool_id: poolId,
        versions: versRes.rows,
      });
    } catch (e: any) {
      console.error("[super-curriculum/versions]", e);
      return res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /super/curriculum/pools/:poolId/versions/:versionId/nodes
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/pools/:poolId/versions/:versionId/nodes",
  requireAuth, isSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { poolId, versionId } = req.params;
      const levelOrder = req.query.level_order ? parseInt(req.query.level_order as string, 10) : null;
      const page   = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit  = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10)));
      const offset = (page - 1) * limit;

      const verRes = await db.execute(sql`
        SELECT id FROM curriculum_versions
        WHERE id = ${versionId} AND swimming_pool_id = ${poolId}
        LIMIT 1
      `);
      if (verRes.rows.length === 0)
        return res.status(404).json({ error: "버전을 찾을 수 없습니다." });

      const countRes = await db.execute(sql`
        SELECT COUNT(*)::int as total
        FROM curriculum_items
        WHERE curriculum_version_id = ${versionId}
          AND swimming_pool_id = ${poolId}
          AND is_active = true
          ${levelOrder !== null ? sql`AND level_order = ${levelOrder}` : sql``}
      `);

      const itemsRes = await db.execute(sql`
        SELECT
          id, sort_order, level_order, sequence_in_level, display_no,
          title, stroke, domain, skill_group, atomic_skill,
          is_test_item, source_trace, is_master_import, node_data
        FROM curriculum_items
        WHERE curriculum_version_id = ${versionId}
          AND swimming_pool_id = ${poolId}
          AND is_active = true
          ${levelOrder !== null ? sql`AND level_order = ${levelOrder}` : sql``}
        ORDER BY level_order ASC, sequence_in_level ASC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const total = (countRes.rows[0] as any)?.total ?? 0;

      return res.status(200).json({
        version_id: versionId,
        nodes: itemsRes.rows,
        pagination: { page, limit, total, has_more: offset + limit < total },
      });
    } catch (e: any) {
      console.error("[super-curriculum/nodes]", e);
      return res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /super/curriculum/migrate
// ═══════════════════════════════════════════════════════════════════════════════
// startup migration trigger (super_admin only)

router.post(
  "/migrate",
  requireAuth, isSuperAdmin,
  async (_req, res) => {
    try {
      await runCurriculumAppMasterMigration(db as any);
      return res.status(200).json({ ok: true, message: "Migration 완료" });
    } catch (e: any) {
      console.error("[super-curriculum/migrate]", e);
      return res.status(500).json({ error: "Migration 실패", detail: e?.message });
    }
  }
);

export default router;
