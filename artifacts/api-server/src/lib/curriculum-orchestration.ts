/**
 * curriculum-orchestration.ts
 *
 * One-click Curriculum Auto-Apply Orchestration
 * ─────────────────────────────────────────────
 * 파일 업로드 1회 → PARSE → STRUCTURE → APPROVE → ACTIVATE LOCAL → READY
 *
 * 정책 (2026-09-08):
 * - REVIEW_REQUIRED는 soft review — activation blocker 아님
 * - HARD BLOCK만 abort (parse 실패, count 0, declared≠parsed, duplicate key, etc.)
 * - content_hash idempotency: 동일 hash가 이미 ACTIVE → 현재 결과 반환
 * - activation 실패 시 atomic ROLLBACK — 기존 active 보존
 */

import crypto from "crypto";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { downloadFromR2 } from "./objectStorage.js";
import { parseCurriculumDocx } from "./docxParser.js";

// ── HARD BLOCK 조건 목록 ────────────────────────────────────────────────────
// 이 조건에 해당하면 activation 금지 (IMPORT_FAILED 반환)
// soft review (level_order IS NULL 등)는 이 목록에 없음 → activation 허용

export const HARD_BLOCK_REASONS = [
  "parse_failed",            // parseCurriculumDocx throw
  "canonical_count_zero",   // searchable_items.length === 0
  "declared_count_mismatch",// declared != parsed (FINAL_IMPORT 전용, 파서 내부 throw)
  "duplicate_canonical_key",// canonical_key 중복
  "db_transaction_failed",  // activate TX rollback
] as const;

export type HardBlockReason = (typeof HARD_BLOCK_REASONS)[number];

export type OrchestrationResult = {
  /** READY = activation 완료 / HARD_BLOCKED = activation 금지 (기존 버전 유지) */
  status: "READY" | "HARD_BLOCKED";
  /** 새로 활성화된 version id */
  activated_version_id?: string;
  /** 기존에 deactivate/archive된 version id */
  deactivated_version_id?: string | null;
  /** structured 된 canonical node 수 */
  canonical_node_count?: number;
  /** level_order IS NULL 인 soft review node 수 */
  soft_review_count?: number;
  /** hard block 개수 (0이면 clean) */
  hard_error_count: number;
  /** hard block 이유 목록 */
  hard_errors?: HardBlockReason[];
  /** true = 동일 content_hash의 ACTIVE version이 이미 존재 → 재처리 불필요 */
  idempotent?: boolean;
  /** idempotent hit 시의 기존 active version id */
  existing_active_version_id?: string;
  /** HARD_BLOCKED 시의 추가 메시지 */
  block_message?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getPoolRow(poolId: string): Promise<any | null> {
  const res = await superAdminDb.execute(
    sql`SELECT id, name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`
  );
  return (res as any).rows?.[0] ?? null;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function insertAuditLog(
  action: string,
  actorId: string,
  poolId: string,
  details: Record<string, any>
): Promise<void> {
  try {
    const verRes = await superAdminDb.execute(
      sql`SELECT next_audit_version('x_structuring', ${poolId}) AS v`
    );
    const version = (verRes as any).rows?.[0]?.v ?? 1;
    await superAdminDb.execute(sql`
      INSERT INTO audit_logs
        (entity_type, entity_id, entity_version, action, actor_type, actor_id, pool_id,
         before_data, after_data, reason)
      VALUES
        ('x_structuring', ${poolId}, ${version}, ${action}, 'system', ${actorId}, ${poolId},
         ${"{}"}::jsonb, ${JSON.stringify(details)}::jsonb, ${action})
    `);
  } catch (e) {
    console.error("[curriculum-orchestration audit] failed:", e);
  }
}

// ── Core Orchestration Function ──────────────────────────────────────────────

/**
 * processAndActivateLocalCurriculum
 *
 * 하나의 함수로 전체 pipeline 실행:
 * DOWNLOAD → PARSE → STRUCTURE (versions/items) → APPROVE → ACTIVATE → READY
 *
 * @param poolId     대상 수영장 ID
 * @param actorId    audit 기록용 actor (system 자동 처리 시 "system")
 * @returns          OrchestrationResult
 */
export async function processAndActivateLocalCurriculum(
  poolId: string,
  actorId = "system"
): Promise<OrchestrationResult> {
  console.log(`[curriculum-orchestration] START pool=${poolId} actor=${actorId}`);

  const pool = await getPoolRow(poolId);
  if (!pool) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: `수영장 없음: ${poolId}`,
    };
  }

  // ── Step 1: current curriculum file 조회 ─────────────────────────────────
  const fileRes = await superAdminDb.execute(sql`
    SELECT id, r2_key, submission_version
    FROM x_setup_files
    WHERE pool_id = ${pool.id}
      AND file_type = 'curriculum'
      AND is_current = true
      AND deleted_at IS NULL
    ORDER BY submission_version DESC
    LIMIT 1
  `);
  const curriculumFile = (fileRes as any).rows?.[0] ?? null;

  if (!curriculumFile) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: "업로드된 커리큘럼 파일이 없습니다.",
    };
  }

  // ── Step 2: content_hash 계산 + idempotency 체크 ─────────────────────────
  const dlRes = await downloadFromR2(curriculumFile.r2_key, "photo");
  if (!dlRes.ok || !dlRes.data) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: "R2 다운로드 실패",
    };
  }

  const contentHash = crypto
    .createHash("sha256")
    .update(dlRes.data)
    .digest("hex");

  // 동일 hash가 이미 ACTIVE인지 확인
  const alreadyActiveRes = await superAdminDb.execute(sql`
    SELECT id FROM curriculum_versions
    WHERE swimming_pool_id    = ${pool.id}
      AND source_content_hash = ${contentHash}
      AND is_global_reference = false
      AND is_active           = true
      AND archived_at         IS NULL
    LIMIT 1
  `);
  const alreadyActiveId = (alreadyActiveRes as any).rows?.[0]?.id as string | undefined;
  if (alreadyActiveId) {
    console.log(
      `[curriculum-orchestration] IDEMPOTENT: 동일 hash 이미 ACTIVE pool=${pool.id} version=${alreadyActiveId}`
    );
    return {
      status: "READY",
      hard_error_count: 0,
      idempotent: true,
      existing_active_version_id: alreadyActiveId,
    };
  }

  // 동일 hash의 DRAFT가 있으면 재사용 (중복 생성 금지)
  const existingDraftRes = await superAdminDb.execute(sql`
    SELECT id FROM curriculum_versions
    WHERE swimming_pool_id    = ${pool.id}
      AND source_content_hash = ${contentHash}
      AND is_global_reference = false
      AND is_active           = false
      AND archived_at         IS NULL
    LIMIT 1
  `);
  const existingDraftId = (existingDraftRes as any).rows?.[0]?.id as string | undefined;

  // ── Step 3: PARSE ────────────────────────────────────────────────────────
  let structured: ReturnType<typeof parseCurriculumDocx>;
  try {
    structured = parseCurriculumDocx(dlRes.data);
  } catch (parseErr: any) {
    const msg = String(parseErr?.message ?? parseErr);
    await superAdminDb.execute(sql`
      UPDATE x_curriculum_profiles
        SET status = 'FAILED', parse_error = ${msg}, updated_at = NOW()
      WHERE pool_id = ${pool.id}
    `);
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: msg,
    };
  }

  // ── Step 4: HARD BLOCK validation ────────────────────────────────────────
  const hardErrors: HardBlockReason[] = [];

  if (structured.searchable_items.length === 0) {
    hardErrors.push("canonical_count_zero");
  }

  // duplicate canonical_key 체크
  if (structured.searchable_items.length > 0) {
    const canonicalKeys = structured.searchable_items
      .map((i) => i.canonical_key)
      .filter(Boolean);
    const keySet = new Set(canonicalKeys);
    if (keySet.size < canonicalKeys.length) {
      hardErrors.push("duplicate_canonical_key");
    }
  }

  if (hardErrors.length > 0) {
    await superAdminDb.execute(sql`
      UPDATE x_curriculum_profiles
        SET status = 'FAILED',
            parse_error = ${`HARD_BLOCK: ${hardErrors.join(", ")}`},
            updated_at = NOW()
      WHERE pool_id = ${pool.id}
    `);
    return {
      status: "HARD_BLOCKED",
      hard_error_count: hardErrors.length,
      hard_errors: hardErrors,
      block_message: `Hard block: ${hardErrors.join(", ")}`,
    };
  }

  // ── Step 5: STRUCTURE — x_curriculum_profiles + levels + versions + items ─
  const versionName = `x-local-${contentHash.slice(0, 12)}`;

  // Mark PROCESSING
  await superAdminDb.execute(sql`
    INSERT INTO x_curriculum_profiles (pool_id, status, updated_at)
    VALUES (${pool.id}, 'PROCESSING', NOW())
    ON CONFLICT (pool_id) DO UPDATE SET
      status = 'PROCESSING', parse_error = NULL, updated_at = NOW()
  `);

  // Profile UPDATE to STRUCTURED
  await superAdminDb.execute(sql`
    UPDATE x_curriculum_profiles SET
      status                 = 'STRUCTURED',
      basic_info             = ${JSON.stringify(structured.basic_info)}::jsonb,
      teaching_summary       = ${JSON.stringify(structured.teaching_summary)}::jsonb,
      total_declared_levels  = ${structured.total_declared_levels},
      template_version       = ${structured.template_version},
      structured_at          = NOW(),
      updated_at             = NOW()
    WHERE pool_id = ${pool.id}
  `);

  // Levels
  const profileIdRes = await superAdminDb.execute(
    sql`SELECT id FROM x_curriculum_profiles WHERE pool_id = ${pool.id} LIMIT 1`
  );
  const profileId = (profileIdRes as any).rows?.[0]?.id as string | undefined;

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

  // curriculum_version — 기존 DRAFT 재사용 or 신규 생성
  let resolvedVersionId: string | undefined = existingDraftId;

  if (!resolvedVersionId) {
    // Global overwrite 방지
    let finalVersionName = versionName;
    const globalCheck = await superAdminDb.execute(sql`
      SELECT id FROM curriculum_versions
      WHERE swimming_pool_id    = ${pool.id}
        AND version_name        = ${finalVersionName}
        AND is_global_reference = true
      LIMIT 1
    `);
    if ((globalCheck as any).rows?.length > 0) {
      finalVersionName = `x-local-${contentHash.slice(0, 8)}-${Date.now()}`;
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

    const newVer = await superAdminDb.execute(sql`
      SELECT id FROM curriculum_versions
      WHERE swimming_pool_id = ${pool.id}
        AND version_name     = ${finalVersionName}
      LIMIT 1
    `);
    resolvedVersionId = (newVer as any).rows?.[0]?.id as string | undefined;
  }

  // items 삽입 (기존 DRAFT items 재삽입 — 동일 sort_order CONFLICT DO NOTHING)
  if (resolvedVersionId && !existingDraftId) {
    // 신규 version만 items 삽입 (기존 DRAFT 재사용 시 items 이미 존재)
    for (const item of structured.searchable_items) {
      const levelOrderVal =
        item.level_order != null && item.level_order > 0 ? item.level_order : null;
      const isMasterImport = item.display_no != null ? true : null;
      await superAdminDb.execute(sql`
        INSERT INTO curriculum_items
          (curriculum_version_id, swimming_pool_id, sort_order, title, description, is_active,
           display_no, stroke, domain, skill_group, atomic_skill, level_order, is_master_import)
        VALUES
          (${resolvedVersionId!}, ${pool.id}, ${item.sort_order},
           ${item.title}, ${item.description}, true,
           ${item.display_no ?? null}, ${item.stroke ?? null},
           ${item.domain ?? null}, ${item.skill_group ?? null},
           ${item.atomic_skill ?? null}, ${levelOrderVal},
           ${isMasterImport})
        ON CONFLICT (curriculum_version_id, sort_order) DO NOTHING
      `);
    }
  }

  // profile.curriculum_version_id 기록
  if (resolvedVersionId && profileId) {
    await superAdminDb.execute(sql`
      UPDATE x_curriculum_profiles
        SET curriculum_version_id = ${resolvedVersionId}, updated_at = NOW()
      WHERE id = ${profileId}
    `);
  }

  const canonicalCount = structured.searchable_items.length;
  const softReviewCount = structured.searchable_items.filter(
    (i) => i.level_order == null || i.level_order <= 0
  ).length;

  // ── Step 6: APPROVE ──────────────────────────────────────────────────────
  // STRUCTURED 또는 REVIEW_REQUIRED 모두 approve 허용 (soft review policy)
  await superAdminDb.execute(sql`
    UPDATE x_curriculum_profiles SET
      status       = 'APPROVED',
      reviewed_at  = NOW(),
      reviewed_by  = ${actorId},
      updated_at   = NOW()
    WHERE pool_id = ${pool.id}
      AND status IN ('STRUCTURED', 'REVIEW_REQUIRED', 'APPROVED')
  `);

  if (resolvedVersionId) {
    await superAdminDb.execute(sql`
      UPDATE curriculum_versions
        SET approved_at = NOW(), updated_at = NOW()
      WHERE id = ${resolvedVersionId}
        AND is_global_reference = false
    `);
  }

  // ── Step 7: ACTIVATE LOCAL (Atomic TX) ──────────────────────────────────
  // uniq_curriculum_versions_one_active: (swimming_pool_id) WHERE is_active=true
  // → pool에 is_active=true인 version이 1개뿐이어야 함
  //   Global Reference version도 is_active=true일 수 있으므로 모두 조회
  const oldActiveRes = await superAdminDb.execute(sql`
    SELECT id, is_global_reference FROM curriculum_versions
    WHERE swimming_pool_id = ${pool.id}
      AND is_active        = true
      AND archived_at      IS NULL
  `);
  const oldActiveRows = (oldActiveRes as any).rows ?? [];
  const oldVersionId: string | null =
    (oldActiveRows.find((r: any) => !r.is_global_reference)?.id) ?? null;

  if (!resolvedVersionId) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["db_transaction_failed"],
      block_message: "version id 결정 실패",
    };
  }

  try {
    await superAdminDb.execute(sql`BEGIN`);

    // 기존 active version 모두 deactivate (Local + Global Reference)
    // archived_at은 Local에만 설정 (Global Reference는 archive 안 함)
    for (const row of oldActiveRows) {
      await superAdminDb.execute(sql`
        UPDATE curriculum_versions SET
          is_active   = false,
          archived_at = CASE WHEN ${!row.is_global_reference} THEN NOW() ELSE archived_at END,
          updated_at  = NOW()
        WHERE id = ${row.id}
      `);
    }

    await superAdminDb.execute(sql`
      UPDATE curriculum_versions SET
        is_active     = true,
        import_status = 'ACTIVE',
        activated_at  = NOW(),
        updated_at    = NOW()
      WHERE id = ${resolvedVersionId}
    `);

    await superAdminDb.execute(sql`
      UPDATE swimming_pools SET
        xmode_config_status = 'READY',
        updated_at          = NOW()
      WHERE id = ${pool.id}
    `);

    await superAdminDb.execute(sql`
      UPDATE x_curriculum_profiles SET
        status     = 'ACTIVATED',
        updated_at = NOW()
      WHERE pool_id = ${pool.id}
    `);

    await superAdminDb.execute(sql`COMMIT`);
  } catch (txErr: any) {
    await superAdminDb.execute(sql`ROLLBACK`).catch(() => {});
    return {
      status: "HARD_BLOCKED",
      canonical_node_count: canonicalCount,
      soft_review_count: softReviewCount,
      hard_error_count: 1,
      hard_errors: ["db_transaction_failed"],
      block_message: String(txErr?.message ?? txErr),
    };
  }

  await insertAuditLog("ONE_CLICK_CURRICULUM_ACTIVATED", actorId, pool.id, {
    activated_version_id: resolvedVersionId,
    deactivated_version_id: oldVersionId,
    canonical_node_count: canonicalCount,
    soft_review_count: softReviewCount,
    xmode_config_status: "READY",
  });

  console.log(
    `[curriculum-orchestration] DONE pool=${pool.id} version=${resolvedVersionId} nodes=${canonicalCount} soft_review=${softReviewCount}`
  );

  return {
    status: "READY",
    activated_version_id: resolvedVersionId,
    deactivated_version_id: oldVersionId,
    canonical_node_count: canonicalCount,
    soft_review_count: softReviewCount,
    hard_error_count: 0,
    idempotent: false,
  };
}
