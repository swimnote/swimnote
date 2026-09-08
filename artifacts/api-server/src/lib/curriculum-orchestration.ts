/**
 * curriculum-orchestration.ts
 *
 * X Curriculum Review-Gate Pipeline
 * ─────────────────────────────────
 * 정책 (2026-09-09 확정):
 *   UPLOAD → PARSE → STRUCTURE → VALIDATE → [REVIEW_PENDING]
 *                                             ↓  (super_admin only)
 *                                          APPROVE → ACTIVATE → READY
 *
 * 업로드만으로는 절대 APPROVED / ACTIVE / READY 상태가 되지 않는다.
 * 사람 검수(super_admin) 이후에만 approve/activate/READY 전환 가능.
 *
 * HARD BLOCK 조건에 해당하면 approve 불가 (검수 화면에서 이유 확인 가능).
 * 기존 ACTIVE version은 새 version 승인 전까지 유지됨.
 * 기존 READY pool은 이번 변경 영향 없음 (배포 후 회귀 0).
 */

import crypto from "crypto";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { downloadFromR2 } from "./objectStorage.js";
import { parseCurriculumDocx } from "./docxParser.js";

// ── HARD BLOCK 조건 ──────────────────────────────────────────────────────────
export const HARD_BLOCK_REASONS = [
  "parse_failed",
  "canonical_count_zero",
  "declared_count_mismatch",
  "duplicate_canonical_key",
  "db_transaction_failed",
] as const;

export type HardBlockReason = (typeof HARD_BLOCK_REASONS)[number];

// ── Result types ─────────────────────────────────────────────────────────────

/**
 * processLocalCurriculumForReview 결과
 * - REVIEW_PENDING  : parse/structure 성공, 사람 검수 대기
 * - HARD_BLOCKED    : parse/validate 실패, approve 불가
 * - IDEMPOTENT_READY: 동일 content_hash가 이미 ACTIVE → 재처리 불필요
 */
export type ReviewResult = {
  status: "REVIEW_PENDING" | "HARD_BLOCKED" | "IDEMPOTENT_READY";
  /** structured 된 canonical node 수 */
  canonical_node_count?: number;
  /** level_order IS NULL 인 soft review node 수 */
  soft_review_count?: number;
  /** hard block 개수 (0이면 clean) */
  hard_error_count: number;
  /** hard block 이유 목록 */
  hard_errors?: HardBlockReason[];
  /** hard block 또는 오류 메시지 */
  block_message?: string;
  /** idempotent hit — 동일 hash 이미 ACTIVE */
  idempotent?: boolean;
  /** idempotent hit 시의 기존 active version id */
  existing_active_version_id?: string;
  /** 구조화된 버전 id (REVIEW_PENDING 시) */
  version_id?: string;
};

/**
 * approveAndActivateLocalCurriculum 결과
 * - READY       : activation 완료
 * - HARD_BLOCKED: activation 금지 (기존 active version 보존)
 */
export type OrchestrationResult = {
  status: "READY" | "HARD_BLOCKED";
  activated_version_id?: string;
  deactivated_version_id?: string | null;
  canonical_node_count?: number;
  soft_review_count?: number;
  hard_error_count: number;
  hard_errors?: HardBlockReason[];
  block_message?: string;
  idempotent?: boolean;
  existing_active_version_id?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Step 1–5: Parse / Structure / Validate (upload 후 자동 실행) ─────────────

/**
 * processLocalCurriculumForReview
 *
 * 업로드 직후 자동 실행 허용 단계:
 *   DOWNLOAD → SHA-256 → PARSE → HARD_BLOCK_VALIDATE → STRUCTURE → REVIEW_PENDING
 *
 * approve/activate/READY 는 수행하지 않는다.
 * 기존 ACTIVE version 을 건드리지 않는다.
 *
 * @param poolId   대상 수영장 ID
 * @param actorId  audit 기록용 (업로더 userId)
 */
export async function processLocalCurriculumForReview(
  poolId: string,
  actorId: string
): Promise<ReviewResult> {
  console.log(`[curriculum-orchestration] REVIEW_PARSE START pool=${poolId} actor=${actorId}`);

  const pool = await getPoolRow(poolId);
  if (!pool) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: `수영장 없음: ${poolId}`,
    };
  }

  // ── Step 1: current curriculum file 조회 ──────────────────────────────────
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

  // ── Step 2: content_hash 계산 + idempotency 체크 ──────────────────────────
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

  // 동일 hash가 이미 ACTIVE인지 확인 → 재처리 불필요
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
    await insertAuditLog("CURRICULUM_UPLOAD_IDEMPOTENT", actorId, pool.id, {
      existing_active_version_id: alreadyActiveId,
      content_hash: contentHash,
    });
    return {
      status: "IDEMPOTENT_READY",
      hard_error_count: 0,
      idempotent: true,
      existing_active_version_id: alreadyActiveId,
    };
  }

  // 동일 hash의 DRAFT가 있으면 재사용
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

  // ── Step 3: PARSE ──────────────────────────────────────────────────────────
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
    await insertAuditLog("CURRICULUM_PARSE_FAILED", actorId, pool.id, { error: msg });
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: msg,
    };
  }

  // ── Step 4: HARD BLOCK validation ─────────────────────────────────────────
  const hardErrors: HardBlockReason[] = [];

  if (structured.searchable_items.length === 0) {
    hardErrors.push("canonical_count_zero");
  }

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
    await insertAuditLog("CURRICULUM_HARD_BLOCKED", actorId, pool.id, {
      hard_errors: hardErrors,
    });
    return {
      status: "HARD_BLOCKED",
      hard_error_count: hardErrors.length,
      hard_errors: hardErrors,
      block_message: `Hard block: ${hardErrors.join(", ")}`,
    };
  }

  // ── Step 5: STRUCTURE ──────────────────────────────────────────────────────
  const versionName = `x-local-${contentHash.slice(0, 12)}`;

  // Mark PROCESSING
  await superAdminDb.execute(sql`
    INSERT INTO x_curriculum_profiles (pool_id, status, updated_at)
    VALUES (${pool.id}, 'PROCESSING', NOW())
    ON CONFLICT (pool_id) DO UPDATE SET
      status = 'PROCESSING', parse_error = NULL, updated_at = NOW()
  `);

  // Profile → STRUCTURED (검수 대기 — approve 아님)
  await superAdminDb.execute(sql`
    UPDATE x_curriculum_profiles SET
      status                 = 'STRUCTURED',
      basic_info             = ${JSON.stringify(structured.basic_info)}::jsonb,
      teaching_summary       = ${JSON.stringify(structured.teaching_summary)}::jsonb,
      total_declared_levels  = ${structured.total_declared_levels},
      template_version       = ${structured.template_version},
      structured_at          = NOW(),
      reviewed_at            = NULL,
      reviewed_by            = NULL,
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

  // items 삽입 (신규 version만)
  if (resolvedVersionId && !existingDraftId) {
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

  await insertAuditLog("CURRICULUM_STRUCTURED_FOR_REVIEW", actorId, pool.id, {
    version_id: resolvedVersionId,
    canonical_node_count: canonicalCount,
    soft_review_count: softReviewCount,
    content_hash: contentHash,
  });

  console.log(
    `[curriculum-orchestration] REVIEW_PENDING pool=${pool.id} version=${resolvedVersionId} nodes=${canonicalCount}`
  );

  return {
    status: "REVIEW_PENDING",
    hard_error_count: 0,
    canonical_node_count: canonicalCount,
    soft_review_count: softReviewCount,
    version_id: resolvedVersionId,
  };
}

// ── Step 6–7: Approve + Activate (super_admin 승인 후에만 호출) ──────────────

/**
 * approveAndActivateLocalCurriculum
 *
 * super_admin 이 승인 액션을 취할 때만 호출.
 * - profile APPROVED (reviewed_by = 실제 super_admin)
 * - curriculum version approved_at 기록
 * - atomic TX: 기존 active deactivate → 새 version active
 * - swimming_pools.xmode_config_status = 'READY'
 *
 * 기존 ACTIVE version 은 TX 성공 전까지 유지됨.
 *
 * @param poolId          대상 수영장 ID
 * @param superAdminId    실제 super_admin userId (audit 기록)
 */
export async function approveAndActivateLocalCurriculum(
  poolId: string,
  superAdminId: string
): Promise<OrchestrationResult> {
  console.log(
    `[curriculum-orchestration] APPROVE_ACTIVATE START pool=${poolId} superAdmin=${superAdminId}`
  );

  const pool = await getPoolRow(poolId);
  if (!pool) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: `수영장 없음: ${poolId}`,
    };
  }

  // profile + version 조회 (STRUCTURED or REVIEW_REQUIRED 상태여야 함)
  const profileRes = await superAdminDb.execute(sql`
    SELECT id, status, curriculum_version_id
    FROM x_curriculum_profiles
    WHERE pool_id = ${pool.id}
    LIMIT 1
  `);
  const profile = (profileRes as any).rows?.[0] ?? null;

  if (!profile) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: "커리큘럼 프로필이 없습니다. 먼저 파일을 업로드해주세요.",
    };
  }

  const allowedStatuses = ["STRUCTURED", "REVIEW_REQUIRED", "APPROVED", "ACTIVATED"];
  if (!allowedStatuses.includes(profile.status)) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["parse_failed"],
      block_message: `승인 불가 상태입니다: ${profile.status}. 파일 업로드 후 다시 시도하세요.`,
    };
  }

  const resolvedVersionId: string | undefined = profile.curriculum_version_id ?? undefined;

  if (!resolvedVersionId) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["db_transaction_failed"],
      block_message: "승인할 커리큘럼 버전이 없습니다.",
    };
  }

  // version이 DRAFT 상태인지 확인 (ACTIVE는 이미 처리됨)
  const versionRes = await superAdminDb.execute(sql`
    SELECT id, is_active, import_status, source_content_hash
    FROM curriculum_versions
    WHERE id = ${resolvedVersionId}
      AND swimming_pool_id = ${pool.id}
      AND is_global_reference = false
    LIMIT 1
  `);
  const version = (versionRes as any).rows?.[0] ?? null;

  if (!version) {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: 1,
      hard_errors: ["db_transaction_failed"],
      block_message: "커리큘럼 버전을 찾을 수 없습니다.",
    };
  }

  // 이미 ACTIVE이면 idempotent
  if (version.is_active === true) {
    console.log(
      `[curriculum-orchestration] IDEMPOTENT: 이미 ACTIVE pool=${pool.id} version=${resolvedVersionId}`
    );
    return {
      status: "READY",
      hard_error_count: 0,
      idempotent: true,
      existing_active_version_id: resolvedVersionId,
    };
  }

  // item 수 조회 (로그/응답용)
  const countRes = await superAdminDb.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM curriculum_items
    WHERE curriculum_version_id = ${resolvedVersionId}
  `);
  const canonicalCount = Number((countRes as any).rows?.[0]?.cnt ?? 0);

  // ── Step 6: APPROVE ────────────────────────────────────────────────────────
  // reviewed_by = 실제 super_admin (uploader 자신이 아님)
  await superAdminDb.execute(sql`
    UPDATE x_curriculum_profiles SET
      status      = 'APPROVED',
      reviewed_at = NOW(),
      reviewed_by = ${superAdminId},
      updated_at  = NOW()
    WHERE pool_id = ${pool.id}
      AND status IN ('STRUCTURED', 'REVIEW_REQUIRED', 'APPROVED')
  `);

  await superAdminDb.execute(sql`
    UPDATE curriculum_versions
      SET approved_at = NOW(), updated_at = NOW()
    WHERE id = ${resolvedVersionId}
      AND is_global_reference = false
  `);

  await insertAuditLog("CURRICULUM_APPROVED_BY_SUPER_ADMIN", superAdminId, pool.id, {
    version_id: resolvedVersionId,
    canonical_node_count: canonicalCount,
  });

  // ── Step 7: ACTIVATE (Atomic TX) ──────────────────────────────────────────
  const oldActiveRes = await superAdminDb.execute(sql`
    SELECT id, is_global_reference FROM curriculum_versions
    WHERE swimming_pool_id = ${pool.id}
      AND is_active        = true
      AND archived_at      IS NULL
  `);
  const oldActiveRows = (oldActiveRes as any).rows ?? [];
  const oldVersionId: string | null =
    (oldActiveRows.find((r: any) => !r.is_global_reference)?.id) ?? null;

  try {
    await superAdminDb.execute(sql`BEGIN`);

    // 기존 active version 모두 deactivate
    for (const row of oldActiveRows) {
      await superAdminDb.execute(sql`
        UPDATE curriculum_versions SET
          is_active   = false,
          archived_at = CASE WHEN ${!row.is_global_reference} THEN NOW() ELSE archived_at END,
          updated_at  = NOW()
        WHERE id = ${row.id}
      `);
    }

    // 새 version activate
    await superAdminDb.execute(sql`
      UPDATE curriculum_versions SET
        is_active     = true,
        import_status = 'ACTIVE',
        activated_at  = NOW(),
        updated_at    = NOW()
      WHERE id = ${resolvedVersionId}
    `);

    // pool READY 전환
    await superAdminDb.execute(sql`
      UPDATE swimming_pools SET
        xmode_config_status = 'READY',
        updated_at          = NOW()
      WHERE id = ${pool.id}
    `);

    // profile ACTIVATED
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
      hard_error_count: 1,
      hard_errors: ["db_transaction_failed"],
      block_message: String(txErr?.message ?? txErr),
    };
  }

  await insertAuditLog("CURRICULUM_ACTIVATED_AFTER_APPROVAL", superAdminId, pool.id, {
    activated_version_id: resolvedVersionId,
    deactivated_version_id: oldVersionId,
    canonical_node_count: canonicalCount,
    xmode_config_status: "READY",
  });

  console.log(
    `[curriculum-orchestration] READY pool=${pool.id} version=${resolvedVersionId} nodes=${canonicalCount} approvedBy=${superAdminId}`
  );

  return {
    status: "READY",
    activated_version_id: resolvedVersionId,
    deactivated_version_id: oldVersionId,
    canonical_node_count: canonicalCount,
    hard_error_count: 0,
    idempotent: false,
  };
}

// ── Deprecated: legacy one-click wrapper (호환성 유지, 신규 코드에서 사용 금지) ─
// 기존 READY pool에 영향 없도록 export 유지하나 내부에서 호출되지 않음
/** @deprecated processLocalCurriculumForReview + approveAndActivateLocalCurriculum 사용 */
export async function processAndActivateLocalCurriculum(
  poolId: string,
  actorId = "system"
): Promise<OrchestrationResult> {
  // upload path에서는 더 이상 호출되지 않음 (x-setup.ts 참조)
  // 이 wrapper는 혹시 남아있는 외부 호출자를 위해 보존
  console.warn(
    "[curriculum-orchestration] processAndActivateLocalCurriculum is DEPRECATED. " +
    "Use processLocalCurriculumForReview (upload) + approveAndActivateLocalCurriculum (super_admin approve)."
  );
  // 기존 동작 대신 review-only 실행 (auto-activate 제거)
  const reviewResult = await processLocalCurriculumForReview(poolId, actorId);
  if (reviewResult.status === "HARD_BLOCKED") {
    return {
      status: "HARD_BLOCKED",
      hard_error_count: reviewResult.hard_error_count,
      hard_errors: reviewResult.hard_errors,
      block_message: reviewResult.block_message,
    };
  }
  if (reviewResult.status === "IDEMPOTENT_READY") {
    return {
      status: "READY",
      hard_error_count: 0,
      idempotent: true,
      existing_active_version_id: reviewResult.existing_active_version_id,
    };
  }
  // REVIEW_PENDING — 더 이상 자동 activate하지 않음
  return {
    status: "HARD_BLOCKED",
    hard_error_count: 0,
    block_message: "REVIEW_PENDING: 사람 검수 후 super_admin 승인이 필요합니다.",
  };
}
