/**
 * WP-X04 — X Setup Document Structuring / Website Build Package
 *
 * Routes:
 *   POST   /super/x-setup/:poolId/structure           — trigger structuring
 *   GET    /super/x-setup/:poolId/structured           — view structured data
 *   PATCH  /super/x-setup/:poolId/curriculum/structured — edit curriculum
 *   PATCH  /super/x-setup/:poolId/website/structured   — edit website
 *   POST   /super/x-setup/:poolId/structured/approve   — approve structured data
 *   POST   /super/x-setup/:poolId/package              — generate website package
 *   GET    /super/x-setup/:poolId/packages             — list package history
 *   GET    /super/x-setup/:poolId/packages/:pkgId/download — download package
 *
 * All routes: super_admin only
 * ORIGINAL files (x_setup_files): read-only, never mutated here
 */
import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { downloadFromR2, uploadToR2, getPresignedUrl } from "../lib/objectStorage.js";
import { parseCurriculumDocx, parseWebsiteDocx } from "../lib/docxParser.js";
import { generateWebsitePackage } from "../lib/websitePackager.js";
import type { PackageFile } from "../lib/websitePackager.js";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getPoolRow(poolId: string | string[]): Promise<any | null> {
  const id = String(poolId);
  const res = await superAdminDb.execute(
    sql`SELECT id, name FROM swimming_pools WHERE id = ${id} LIMIT 1`
  );
  return (res as any).rows?.[0] ?? null;
}

async function getSubmissionAndFiles(poolId: string): Promise<{ submission: any; files: any[] }> {
  const subRes = await superAdminDb.execute(
    sql`SELECT * FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1`
  );
  const submission = (subRes as any).rows?.[0] ?? null;

  let files: any[] = [];
  if (submission) {
    const filesRes = await superAdminDb.execute(
      sql`SELECT * FROM x_setup_files
          WHERE pool_id = ${poolId} AND is_current = true AND deleted_at IS NULL
          ORDER BY file_type, submission_version DESC, photo_order ASC`
    );
    files = (filesRes as any).rows ?? [];
  }
  return { submission, files };
}

async function insertAuditLog(
  action: string,
  actorId: string | number,
  poolId: string,
  details: Record<string, any>
): Promise<void> {
  try {
    const verRes = await superAdminDb.execute(
      sql`SELECT next_audit_version('x_structuring', ${poolId}) AS v`
    );
    const version = (verRes as any).rows?.[0]?.v ?? 1;
    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (entity_type, entity_id, entity_version, action, actor_type, actor_id, pool_id, before_data, after_data, reason)
      VALUES ('x_structuring', ${poolId}, ${version}, ${action}, 'super_admin', ${String(actorId)}, ${poolId},
              ${"{}"}::jsonb, ${JSON.stringify(details)}::jsonb, ${action})
    `);
  } catch (e) {
    // audit failure is non-fatal
    console.error("[x04 audit] failed:", e);
  }
}

// ── POST /super/x-setup/:poolId/structure ─────────────────────────────────────
// Trigger DOCX structuring (or re-structure) for both curriculum and website

router.post(
  "/super/x-setup/:poolId/structure",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    const actorId = (req as any).user?.userId;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const { submission, files } = await getSubmissionAndFiles(pool.id);
      if (!submission) return res.status(404).json({ error: "제출 자료가 없습니다." });

      const curriculumFile = files.find((f: any) => f.file_type === "curriculum");
      const websiteFile    = files.find((f: any) => f.file_type === "website");

      const results: { curriculum?: string; website?: string } = {};

      // ── Structure curriculum ─────────────────────────────────────────────────
      if (curriculumFile) {
        // Mark PROCESSING
        await superAdminDb.execute(sql`
          INSERT INTO x_curriculum_profiles (pool_id, submission_id, source_version, status, updated_at)
          VALUES (${pool.id}, ${submission.id}, ${curriculumFile.submission_version}, 'PROCESSING', NOW())
          ON CONFLICT (pool_id) DO UPDATE SET
            submission_id = EXCLUDED.submission_id,
            source_version = EXCLUDED.source_version,
            status = 'PROCESSING', parse_error = NULL, updated_at = NOW()
        `);

        try {
          const dlRes = await downloadFromR2(curriculumFile.r2_key, "photo");
          if (!dlRes.ok || !dlRes.data) throw new Error("R2 download failed");

          const structured = parseCurriculumDocx(dlRes.data);

          // Upsert profile
          await superAdminDb.execute(sql`
            UPDATE x_curriculum_profiles SET
              status = 'STRUCTURED',
              basic_info = ${JSON.stringify(structured.basic_info)}::jsonb,
              teaching_summary = ${JSON.stringify(structured.teaching_summary)}::jsonb,
              total_declared_levels = ${structured.total_declared_levels},
              template_version = ${structured.template_version},
              structured_at = NOW(),
              updated_at = NOW()
            WHERE pool_id = ${pool.id}
          `);

          // Delete old levels and re-insert
          const profileRes = await superAdminDb.execute(
            sql`SELECT id FROM x_curriculum_profiles WHERE pool_id = ${pool.id} LIMIT 1`
          );
          const profileId = (profileRes as any).rows?.[0]?.id;
          if (profileId) {
            await superAdminDb.execute(
              sql`DELETE FROM x_curriculum_levels WHERE profile_id = ${profileId}`
            );
            for (const level of structured.levels) {
              await superAdminDb.execute(sql`
                INSERT INTO x_curriculum_levels (
                  profile_id, level_order, level_name, level_color, target_students,
                  strokes, skills, learning_contents, objectives, promotion_criteria,
                  test_method, detailed_skills, common_errors, correction_methods,
                  drills, age_notes, teaching_focus, notes
                ) VALUES (
                  ${profileId}, ${level.level_order}, ${level.level_name ?? null},
                  ${level.level_color ?? null}, ${level.target_students ?? null},
                  ${level.strokes ?? null}, ${level.skills ?? null},
                  ${level.learning_contents ?? null}, ${level.objectives ?? null},
                  ${level.promotion_criteria ?? null}, ${level.test_method ?? null},
                  ${level.detailed_skills ?? null}, ${level.common_errors ?? null},
                  ${level.correction_methods ?? null}, ${level.drills ?? null},
                  ${level.age_notes ?? null}, ${level.teaching_focus ?? null},
                  ${level.notes ?? null}
                )
                ON CONFLICT (profile_id, level_order) DO UPDATE SET
                  level_name = EXCLUDED.level_name, level_color = EXCLUDED.level_color,
                  target_students = EXCLUDED.target_students, strokes = EXCLUDED.strokes,
                  skills = EXCLUDED.skills, learning_contents = EXCLUDED.learning_contents,
                  objectives = EXCLUDED.objectives, promotion_criteria = EXCLUDED.promotion_criteria,
                  test_method = EXCLUDED.test_method, detailed_skills = EXCLUDED.detailed_skills,
                  common_errors = EXCLUDED.common_errors, correction_methods = EXCLUDED.correction_methods,
                  drills = EXCLUDED.drills, age_notes = EXCLUDED.age_notes,
                  teaching_focus = EXCLUDED.teaching_focus, notes = EXCLUDED.notes,
                  updated_at = NOW()
              `);
            }
          }

          // ── PRE-WP-X: curriculum_versions 생성 + curriculum_items 생성 ──
          //
          // 원칙 (500 Pool Standard):
          //   - 신규 업로드마다 새 Local curriculum_version 생성 (UPSERT 덮어쓰기 금지)
          //   - version_name = 'x-local-{content_hash[:12]}' (hash 기반 고유 이름)
          //   - content_hash = SHA-256(DOCX buffer) — idempotency source of truth
          //   - 동일 content_hash이 이미 이 pool에 존재하면 → 기존 version 재사용 (duplicate skip)
          //   - 새 version은 is_active=false, import_status='DRAFT' 로 생성
          //   - activate-local TX에서만 is_active=true, import_status='ACTIVE' 로 전환
          //   - 기존 items DELETE 금지 — 과거 version/items 보존
          //   - is_global_reference=true row는 절대 생성/변경 불가
          //
          if (structured.searchable_items.length > 0) {
            // 1. DOCX 버퍼 content_hash 계산 (SHA-256)
            const contentHash = crypto
              .createHash("sha256")
              .update(dlRes.data)
              .digest("hex");
            const versionName = `x-local-${contentHash.slice(0, 12)}`;

            // 2. 동일 content_hash가 이 pool에 이미 존재하면 → duplicate skip
            const existingCheck = await superAdminDb.execute(sql`
              SELECT id FROM curriculum_versions
              WHERE swimming_pool_id     = ${pool.id}
                AND source_content_hash  = ${contentHash}
                AND is_global_reference  = false
              LIMIT 1
            `);
            const existingVersionId = (existingCheck as any).rows?.[0]?.id as string | undefined;

            if (existingVersionId) {
              console.log(
                `[x04-structuring] duplicate content_hash → 기존 version 재사용 (pool=${pool.id}, version=${existingVersionId})`
              );
              // items 이미 존재 — 재생성 불필요
            } else {
              // 3. 새 Local version 생성 (is_active=false — activate-local TX에서만 활성화)
              //    Global overwrite 방지: version_name 충돌 시 타임스탬프 suffix
              let finalVersionName = versionName;
              const globalOverwriteCheck = await superAdminDb.execute(sql`
                SELECT id FROM curriculum_versions
                WHERE swimming_pool_id   = ${pool.id}
                  AND version_name       = ${finalVersionName}
                  AND is_global_reference = true
                LIMIT 1
              `);
              if ((globalOverwriteCheck as any).rows?.length > 0) {
                finalVersionName = `x-local-${contentHash.slice(0, 8)}-${Date.now()}`;
                console.warn(
                  `[x04-structuring] Global overwrite 방지: version_name 충돌 → ${finalVersionName} (pool=${pool.id})`
                );
              }

              await superAdminDb.execute(sql`
                INSERT INTO curriculum_versions
                  (swimming_pool_id, version_name, is_active, import_status, source_content_hash)
                VALUES
                  (${pool.id}, ${finalVersionName}, false, 'DRAFT', ${contentHash})
                ON CONFLICT (swimming_pool_id, version_name)
                  DO UPDATE SET
                    source_content_hash = EXCLUDED.source_content_hash,
                    updated_at = NOW()
                  WHERE curriculum_versions.is_global_reference = false
              `);

              const newVersionRes = await superAdminDb.execute(sql`
                SELECT id FROM curriculum_versions
                WHERE swimming_pool_id = ${pool.id} AND version_name = ${finalVersionName}
                LIMIT 1
              `);
              const newVersionId = (newVersionRes as any).rows?.[0]?.id as string | undefined;

              if (newVersionId) {
                // 4. searchable_items → curriculum_items INSERT
                //    (기존 version의 items는 절대 변경하지 않음)
                for (const item of structured.searchable_items) {
                  await superAdminDb.execute(sql`
                    INSERT INTO curriculum_items
                      (curriculum_version_id, swimming_pool_id, sort_order, title, description, is_active)
                    VALUES
                      (${newVersionId}, ${pool.id}, ${item.sort_order},
                       ${item.title}, ${item.description}, true)
                    ON CONFLICT (curriculum_version_id, sort_order) DO NOTHING
                  `);
                }
                console.log(
                  `[x04-structuring] 새 Local version 생성 (is_active=false): pool=${pool.id}, version=${newVersionId}, items=${structured.searchable_items.length}개`
                );
              }
            }
          }

          results.curriculum = "STRUCTURED";
        } catch (parseErr: any) {
          await superAdminDb.execute(sql`
            UPDATE x_curriculum_profiles SET
              status = 'FAILED', parse_error = ${String(parseErr?.message ?? parseErr)}, updated_at = NOW()
            WHERE pool_id = ${pool.id}
          `);
          results.curriculum = "FAILED";
        }
      }

      // ── Structure website ────────────────────────────────────────────────────
      if (websiteFile) {
        await superAdminDb.execute(sql`
          INSERT INTO x_website_profiles (pool_id, submission_id, source_version, status, updated_at)
          VALUES (${pool.id}, ${submission.id}, ${websiteFile.submission_version}, 'PROCESSING', NOW())
          ON CONFLICT (pool_id) DO UPDATE SET
            submission_id = EXCLUDED.submission_id,
            source_version = EXCLUDED.source_version,
            status = 'PROCESSING', parse_error = NULL, updated_at = NOW()
        `);

        try {
          const dlRes = await downloadFromR2(websiteFile.r2_key, "photo");
          if (!dlRes.ok || !dlRes.data) throw new Error("R2 download failed");

          const structured = parseWebsiteDocx(dlRes.data);

          await superAdminDb.execute(sql`
            UPDATE x_website_profiles SET
              status = 'STRUCTURED',
              template_version = ${structured.template_version},
              basic_info = ${JSON.stringify(structured.basic_info)}::jsonb,
              brand = ${JSON.stringify(structured.brand)}::jsonb,
              strengths = ${JSON.stringify(structured.strengths)}::jsonb,
              differentiation = ${JSON.stringify(structured.differentiation)}::jsonb,
              philosophy = ${JSON.stringify(structured.philosophy)}::jsonb,
              programs = ${JSON.stringify(structured.programs)}::jsonb,
              level_system = ${JSON.stringify(structured.level_system)}::jsonb,
              education_process = ${JSON.stringify(structured.education_process)}::jsonb,
              facilities = ${JSON.stringify(structured.facilities)}::jsonb,
              safety = ${JSON.stringify(structured.safety)}::jsonb,
              vehicle_location = ${JSON.stringify(structured.vehicle_location)}::jsonb,
              usage_information = ${JSON.stringify(structured.usage_information)}::jsonb,
              coaches = ${JSON.stringify(structured.coaches)}::jsonb,
              trust_credentials = ${JSON.stringify(structured.trust_credentials)}::jsonb,
              faq = ${JSON.stringify(structured.faq)}::jsonb,
              website_preferences = ${JSON.stringify(structured.website_preferences)}::jsonb,
              restricted_information = ${structured.restricted_information ?? null},
              free_notes = ${structured.free_notes ?? null},
              structured_at = NOW(),
              updated_at = NOW()
            WHERE pool_id = ${pool.id}
          `);
          results.website = "STRUCTURED";
        } catch (parseErr: any) {
          await superAdminDb.execute(sql`
            UPDATE x_website_profiles SET
              status = 'FAILED', parse_error = ${String(parseErr?.message ?? parseErr)}, updated_at = NOW()
            WHERE pool_id = ${pool.id}
          `);
          results.website = "FAILED";
        }
      }

      await insertAuditLog("STRUCTURE_COMPLETE", actorId, pool.id, results);
      res.json({ ok: true, results });
    } catch (err) {
      console.error("[super/x-setup/structure]", err);
      res.status(500).json({ error: "구조화 처리 중 오류" });
    }
  }
);

// ── GET /super/x-setup/:poolId/structured ─────────────────────────────────────

router.get(
  "/super/x-setup/:poolId/structured",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const curriculumRes = await superAdminDb.execute(
        sql`SELECT * FROM x_curriculum_profiles WHERE pool_id = ${pool.id} LIMIT 1`
      );
      const curriculumProfile = (curriculumRes as any).rows?.[0] ?? null;

      let levels: any[] = [];
      if (curriculumProfile) {
        const levelsRes = await superAdminDb.execute(
          sql`SELECT * FROM x_curriculum_levels WHERE profile_id = ${curriculumProfile.id} ORDER BY level_order`
        );
        levels = (levelsRes as any).rows ?? [];
      }

      const websiteRes = await superAdminDb.execute(
        sql`SELECT * FROM x_website_profiles WHERE pool_id = ${pool.id} LIMIT 1`
      );
      const websiteProfile = (websiteRes as any).rows?.[0] ?? null;

      const packagesRes = await superAdminDb.execute(
        sql`SELECT id, package_version, package_name, generated_at, source_submission_version
            FROM x_website_packages WHERE pool_id = ${pool.id}
            ORDER BY generated_at DESC LIMIT 10`
      );
      const packages = (packagesRes as any).rows ?? [];

      res.json({
        curriculum: curriculumProfile ? { ...curriculumProfile, levels } : null,
        website: websiteProfile,
        packages,
      });
    } catch (err) {
      console.error("[super/x-setup/structured GET]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── PATCH /super/x-setup/:poolId/curriculum/structured ────────────────────────

router.patch(
  "/super/x-setup/:poolId/curriculum/structured",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    const actorId = (req as any).user?.userId;
    const { basic_info, teaching_summary, levels } = req.body;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const profileRes = await superAdminDb.execute(
        sql`SELECT id, status FROM x_curriculum_profiles WHERE pool_id = ${pool.id} LIMIT 1`
      );
      const profile = (profileRes as any).rows?.[0];
      if (!profile) return res.status(404).json({ error: "구조화 데이터가 없습니다." });
      if (profile.status === "APPROVED") {
        return res.status(409).json({ error: "이미 승인된 데이터는 수정할 수 없습니다." });
      }

      const updates: string[] = [];
      if (basic_info !== undefined) {
        await superAdminDb.execute(sql`
          UPDATE x_curriculum_profiles SET
            basic_info = ${JSON.stringify(basic_info)}::jsonb,
            status = 'REVIEW_REQUIRED',
            edited_by = ${actorId}, edited_at = NOW(), updated_at = NOW()
          WHERE pool_id = ${pool.id}
        `);
        updates.push("basic_info");
      }
      if (teaching_summary !== undefined) {
        await superAdminDb.execute(sql`
          UPDATE x_curriculum_profiles SET
            teaching_summary = ${JSON.stringify(teaching_summary)}::jsonb,
            status = 'REVIEW_REQUIRED',
            edited_by = ${actorId}, edited_at = NOW(), updated_at = NOW()
          WHERE pool_id = ${pool.id}
        `);
        updates.push("teaching_summary");
      }
      if (Array.isArray(levels)) {
        for (const level of levels) {
          if (!level.level_order) continue;
          await superAdminDb.execute(sql`
            UPDATE x_curriculum_levels SET
              level_name = ${level.level_name ?? null},
              level_color = ${level.level_color ?? null},
              target_students = ${level.target_students ?? null},
              strokes = ${level.strokes ?? null},
              skills = ${level.skills ?? null},
              learning_contents = ${level.learning_contents ?? null},
              objectives = ${level.objectives ?? null},
              promotion_criteria = ${level.promotion_criteria ?? null},
              test_method = ${level.test_method ?? null},
              detailed_skills = ${level.detailed_skills ?? null},
              common_errors = ${level.common_errors ?? null},
              correction_methods = ${level.correction_methods ?? null},
              drills = ${level.drills ?? null},
              age_notes = ${level.age_notes ?? null},
              teaching_focus = ${level.teaching_focus ?? null},
              notes = ${level.notes ?? null},
              updated_at = NOW()
            WHERE profile_id = ${profile.id} AND level_order = ${level.level_order}
          `);
        }
        updates.push("levels");
      }

      await insertAuditLog("STRUCTURED_EDITED", actorId, pool.id, { updated: updates, type: "curriculum" });
      res.json({ ok: true, updated: updates });
    } catch (err) {
      console.error("[super/x-setup/curriculum/structured PATCH]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── PATCH /super/x-setup/:poolId/website/structured ──────────────────────────

router.patch(
  "/super/x-setup/:poolId/website/structured",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    const actorId = (req as any).user?.userId;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const profileRes = await superAdminDb.execute(
        sql`SELECT id, status FROM x_website_profiles WHERE pool_id = ${pool.id} LIMIT 1`
      );
      const profile = (profileRes as any).rows?.[0];
      if (!profile) return res.status(404).json({ error: "구조화 데이터가 없습니다." });
      if (profile.status === "APPROVED") {
        return res.status(409).json({ error: "이미 승인된 데이터는 수정할 수 없습니다." });
      }

      // Allow partial update of any JSONB section
      const ALLOWED_JSONB_FIELDS = [
        "basic_info","brand","strengths","differentiation","philosophy",
        "programs","level_system","education_process","facilities","safety",
        "vehicle_location","usage_information","coaches","trust_credentials",
        "faq","website_preferences",
      ] as const;
      const ALLOWED_TEXT_FIELDS = ["restricted_information","free_notes"] as const;

      const updates: string[] = [];

      for (const field of ALLOWED_JSONB_FIELDS) {
        if (req.body[field] !== undefined) {
          await superAdminDb.execute(sql`
            UPDATE x_website_profiles SET
              ${sql.raw(field)} = ${JSON.stringify(req.body[field])}::jsonb,
              status = 'REVIEW_REQUIRED',
              edited_by = ${actorId}, edited_at = NOW(), updated_at = NOW()
            WHERE pool_id = ${pool.id}
          `);
          updates.push(field);
        }
      }
      for (const field of ALLOWED_TEXT_FIELDS) {
        if (req.body[field] !== undefined) {
          await superAdminDb.execute(sql`
            UPDATE x_website_profiles SET
              ${sql.raw(field)} = ${String(req.body[field])},
              status = 'REVIEW_REQUIRED',
              edited_by = ${actorId}, edited_at = NOW(), updated_at = NOW()
            WHERE pool_id = ${pool.id}
          `);
          updates.push(field);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "수정할 필드가 없습니다." });
      }

      await insertAuditLog("STRUCTURED_EDITED", actorId, pool.id, { updated: updates, type: "website" });
      res.json({ ok: true, updated: updates });
    } catch (err) {
      console.error("[super/x-setup/website/structured PATCH]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/x-setup/:poolId/activate-local ───────────────────────────────
// Canonical activation TX:
//   1. 해당 pool의 APPROVED Local curriculum version 확인
//   2. 기존 active Local → deactivate/archive (TX)
//   3. 새 version → is_active=true, import_status='ACTIVE' (TX)
//   4. xmode_config_status = 'READY' (TX)
//   5. 전체 실패 시 atomic rollback (부분 activation 금지)
//
// 운영자 DB 직접 조작 불필요:
//   - version id 수동 입력 불필요 (pool의 최신 APPROVED + DRAFT version 자동 선택)
//   - SCA 자동 생성 없음 (pool active version fallback으로 정상 작동)
//   - Global system health (global_template_sets / diary_templates) 체크는
//     pool setup state와 분리 → SYSTEM_CURRICULUM_NOT_READY 별도 경고만 반환

router.post(
  "/super/x-setup/:poolId/activate-local",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    const actorId = (req as any).user?.userId;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      // ── Step 1: APPROVED Local curriculum profile + 연결된 version 확인 ──
      // x_curriculum_profiles.status = 'APPROVED' AND
      // 해당 pool에 is_active=false AND is_global_reference=false AND import_status='DRAFT' 인
      // Local version이 존재해야 함 (structure 단계에서 생성, approve 후 미활성 상태)
      const approvedVersionRes = await superAdminDb.execute(sql`
        SELECT cv.id AS version_id, cv.version_name, xcp.id AS profile_id
        FROM curriculum_versions cv
        JOIN x_curriculum_profiles xcp
          ON xcp.pool_id = cv.swimming_pool_id
          AND xcp.status = 'APPROVED'
        WHERE cv.swimming_pool_id    = ${pool.id}
          AND cv.is_global_reference = false
          AND cv.is_active           = false
          AND cv.import_status       IN ('DRAFT', 'VALIDATED')
          AND cv.archived_at         IS NULL
        ORDER BY cv.created_at DESC, xcp.created_at DESC
        LIMIT 1
      `);
      const targetRow = (approvedVersionRes as any).rows?.[0];
      if (!targetRow) {
        return res.status(409).json({
          error: "활성화 가능한 APPROVED Local curriculum version이 없습니다.",
          hint: "structure → approve 단계를 먼저 완료하세요.",
        });
      }
      const targetVersionId: string = targetRow.version_id;

      // ── Step 2: 기존 active Local version 조회 (deactivate 대상) ──
      const oldActiveRes = await superAdminDb.execute(sql`
        SELECT id FROM curriculum_versions
        WHERE swimming_pool_id   = ${pool.id}
          AND is_global_reference = false
          AND is_active           = true
          AND archived_at         IS NULL
        LIMIT 1
      `);
      const oldVersionId: string | null = (oldActiveRes as any).rows?.[0]?.id ?? null;

      // ── Step 3: Atomic TX — deactivate old / activate new / set READY ──
      // superAdminDb는 drizzle-orm 기반 — raw BEGIN/COMMIT으로 transaction 처리
      await superAdminDb.execute(sql`BEGIN`);
      try {
        // 3-a: 기존 active Local deactivate + archive
        if (oldVersionId) {
          await superAdminDb.execute(sql`
            UPDATE curriculum_versions SET
              is_active   = false,
              archived_at = NOW(),
              updated_at  = NOW()
            WHERE id = ${oldVersionId}
          `);
        }

        // 3-b: 새 version activate
        await superAdminDb.execute(sql`
          UPDATE curriculum_versions SET
            is_active      = true,
            import_status  = 'ACTIVE',
            activated_at   = NOW(),
            updated_at     = NOW()
          WHERE id = ${targetVersionId}
        `);

        // 3-c: pool xmode_config_status = 'READY'
        await superAdminDb.execute(sql`
          UPDATE swimming_pools SET
            xmode_config_status = 'READY',
            updated_at          = NOW()
          WHERE id = ${pool.id}
        `);

        // 3-d: curriculum profile status 업데이트
        await superAdminDb.execute(sql`
          UPDATE x_curriculum_profiles SET
            status     = 'ACTIVATED',
            updated_at = NOW()
          WHERE pool_id = ${pool.id}
        `);

        await superAdminDb.execute(sql`COMMIT`);
      } catch (txErr) {
        await superAdminDb.execute(sql`ROLLBACK`).catch(() => {});
        throw txErr;
      }

      // ── Step 4: Audit 기록 ──
      await insertAuditLog("LOCAL_CURRICULUM_ACTIVATED", actorId, pool.id, {
        activated_version_id: targetVersionId,
        deactivated_version_id: oldVersionId,
        xmode_config_status: "READY",
      });

      res.json({
        ok: true,
        activated_version_id: targetVersionId,
        deactivated_version_id: oldVersionId,
        xmode_config_status: "READY",
      });
    } catch (err) {
      console.error("[super/x-setup/activate-local POST]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/x-setup/:poolId/structured/approve ───────────────────────────

router.post(
  "/super/x-setup/:poolId/structured/approve",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    const actorId = (req as any).user?.userId;
    const { type } = req.body; // "curriculum" | "website" | "both"
    if (!type || !["curriculum","website","both"].includes(type)) {
      return res.status(400).json({ error: "type은 curriculum|website|both 중 하나여야 합니다." });
    }
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const approved: string[] = [];

      if (type === "curriculum" || type === "both") {
        const profileRes = await superAdminDb.execute(
          sql`SELECT id, status FROM x_curriculum_profiles WHERE pool_id = ${pool.id} LIMIT 1`
        );
        const p = (profileRes as any).rows?.[0];
        if (!p) return res.status(404).json({ error: "커리큘럼 구조화 데이터가 없습니다." });
        if (!["STRUCTURED","REVIEW_REQUIRED"].includes(p.status)) {
          return res.status(409).json({ error: `커리큘럼 상태가 승인 불가: ${p.status}` });
        }
        await superAdminDb.execute(sql`
          UPDATE x_curriculum_profiles SET
            status = 'APPROVED', reviewed_at = NOW(), reviewed_by = ${actorId}, updated_at = NOW()
          WHERE pool_id = ${pool.id}
        `);
        approved.push("curriculum");
      }

      if (type === "website" || type === "both") {
        const profileRes = await superAdminDb.execute(
          sql`SELECT id, status FROM x_website_profiles WHERE pool_id = ${pool.id} LIMIT 1`
        );
        const p = (profileRes as any).rows?.[0];
        if (!p) return res.status(404).json({ error: "홈페이지 구조화 데이터가 없습니다." });
        if (!["STRUCTURED","REVIEW_REQUIRED"].includes(p.status)) {
          return res.status(409).json({ error: `홈페이지 상태가 승인 불가: ${p.status}` });
        }
        await superAdminDb.execute(sql`
          UPDATE x_website_profiles SET
            status = 'APPROVED', reviewed_at = NOW(), reviewed_by = ${actorId}, updated_at = NOW()
          WHERE pool_id = ${pool.id}
        `);
        approved.push("website");
      }

      await insertAuditLog("STRUCTURED_APPROVED", actorId, pool.id, { approved, type });
      res.json({ ok: true, approved });
    } catch (err) {
      console.error("[super/x-setup/structured/approve]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── POST /super/x-setup/:poolId/package ──────────────────────────────────────

router.post(
  "/super/x-setup/:poolId/package",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    const actorId = (req as any).user?.id;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      // Must have APPROVED website profile
      const profileRes = await superAdminDb.execute(
        sql`SELECT * FROM x_website_profiles WHERE pool_id = ${pool.id} LIMIT 1`
      );
      const websiteProfile = (profileRes as any).rows?.[0];
      if (!websiteProfile) {
        return res.status(404).json({ error: "홈페이지 구조화 데이터가 없습니다." });
      }
      if (websiteProfile.status !== "APPROVED") {
        return res.status(409).json({ error: "APPROVED 상태인 홈페이지 구조화 데이터가 필요합니다." });
      }

      // Get submission files
      const filesRes = await superAdminDb.execute(
        sql`SELECT * FROM x_setup_files
            WHERE pool_id = ${pool.id} AND is_current = true AND deleted_at IS NULL
            ORDER BY file_type, submission_version DESC, photo_order ASC`
      );
      const dbFiles = (filesRes as any).rows ?? [];

      const packageFiles: PackageFile[] = dbFiles.map((f: any) => ({
        r2_key: f.r2_key,
        file_name: f.original_filename,
        file_type: f.file_type,
        photo_order: f.photo_order,
        photo_category: f.photo_category,
      }));

      // Determine package version
      const versionRes = await superAdminDb.execute(
        sql`SELECT COALESCE(MAX(package_version), 0) + 1 AS next_v FROM x_website_packages WHERE pool_id = ${pool.id}`
      );
      const packageVersion = (versionRes as any).rows?.[0]?.next_v ?? 1;

      // Generate package
      const submissionVersion = websiteProfile.source_version ?? 1;
      const pkg = await generateWebsitePackage({
        pool_id: pool.id,
        pool_name: pool.name,
        profile_id: websiteProfile.id,
        submission_id: websiteProfile.submission_id ?? "",
        submission_version: submissionVersion,
        structured: websiteProfile,
        files: packageFiles,
        generated_by_id: actorId,
        approval_timestamp: websiteProfile.reviewed_at ?? new Date().toISOString(),
      });

      // Upload ZIP to R2
      const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,"");
      const r2Key = `x-website-packages/${pool.id}/${dateStr}-v${packageVersion}-${pkg.packageName}`;
      await uploadToR2(r2Key, pkg.zipBuffer, "application/zip", "photo");

      // Save package record
      await superAdminDb.execute(sql`
        INSERT INTO x_website_packages (pool_id, profile_id, package_version, package_name, r2_key, source_submission_version, generated_by)
        VALUES (${pool.id}, ${websiteProfile.id}, ${packageVersion}, ${pkg.packageName}, ${r2Key}, ${submissionVersion}, ${actorId})
      `);

      await insertAuditLog("PACKAGE_GENERATED", actorId, pool.id, {
        package_version: packageVersion,
        package_name: pkg.packageName,
        file_count: pkg.fileCount,
      });

      res.json({ ok: true, package_version: packageVersion, package_name: pkg.packageName });
    } catch (err) {
      console.error("[super/x-setup/package POST]", err);
      res.status(500).json({ error: "패키지 생성 오류" });
    }
  }
);

// ── GET /super/x-setup/:poolId/packages ──────────────────────────────────────

router.get(
  "/super/x-setup/:poolId/packages",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId } = req.params;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const pkgsRes = await superAdminDb.execute(
        sql`SELECT id, pool_id, package_version, package_name, source_submission_version, generated_by, generated_at
            FROM x_website_packages WHERE pool_id = ${pool.id}
            ORDER BY generated_at DESC`
      );
      res.json({ packages: (pkgsRes as any).rows ?? [] });
    } catch (err) {
      console.error("[super/x-setup/packages GET]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/x-setup/:poolId/packages/:pkgId/download ──────────────────────

router.get(
  "/super/x-setup/:poolId/packages/:pkgId/download",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    const { poolId, pkgId } = req.params;
    try {
      const pool = await getPoolRow(poolId);
      if (!pool) return res.status(404).json({ error: "수영장을 찾을 수 없습니다." });

      const pkgRes = await superAdminDb.execute(
        sql`SELECT * FROM x_website_packages WHERE id = ${pkgId} AND pool_id = ${pool.id} LIMIT 1`
      );
      const pkg = (pkgRes as any).rows?.[0];
      if (!pkg) return res.status(404).json({ error: "패키지를 찾을 수 없습니다." });

      // Return presigned URL (300 sec) — super_admin only
      const presignRes = await getPresignedUrl(pkg.r2_key, "photo", 300);
      if (!presignRes.ok || !presignRes.url) {
        return res.status(500).json({ error: "다운로드 URL 생성 실패" });
      }

      res.json({ url: presignRes.url, package_name: pkg.package_name });
    } catch (err) {
      console.error("[super/x-setup/packages/download GET]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── Startup migration ─────────────────────────────────────────────────────────
import("../migrations/pool-db-x04.js")
  .then(async ({ runX04Migration }) => {
    const { superAdminDb } = await import("@workspace/db");
    return runX04Migration(superAdminDb);
  })
  .catch((e: any) => console.error("[x04-init] migration failed:", e?.message));

export default router;
