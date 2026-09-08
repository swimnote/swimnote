/**
 * curriculum-candidate-search.ts — Curriculum Candidate 검색 (2-Layer Architecture)
 *
 * 2-Layer 검색 흐름:
 *   Layer 1 (POOL_LOCAL):
 *     Canonical Local Resolver:
 *       1. student에게 active SCA가 있고 is_global_reference=false Local version → 해당 version 사용
 *       2. SCA 없으면 → pool의 active Local version fallback 사용
 *          조건: is_global_reference=false AND swimming_pool_id=poolId AND is_active=true
 *                AND import_status='ACTIVE' AND archived_at IS NULL
 *       3. 둘 다 없으면 → NO_ACTIVE_LOCAL_CURRICULUM (candidate 0)
 *
 *   Layer 2 (GLOBAL_REFERENCE):
 *     curriculum_versions WHERE is_global_reference=true AND import_status='ACTIVE'
 *       → global items (pool_id 무관) → confidence → CurriculumCandidateResult[source_scope='GLOBAL_REFERENCE']
 *
 * Local 우선 규칙:
 *   - Local progress target: source_scope='POOL_LOCAL' candidate만 허용
 *   - Global-only match: AI grounding/context에만 사용, growth_event/CPO/SCP 생성 금지
 *   - 동일 기술 Local+Global 동시 match → Local 우선 (source_scope 구분으로 caller 처리)
 *
 * SCA Optional 정책 (500 Pool Standard):
 *   - SCA 없는 신규 pool도 pool active Local version fallback으로 정상 작동
 *   - SCA는 한 pool 내 학생별 다른 curriculum이 필요한 경우의 override 기능
 *   - AI Diary / Manual Diary / Parent / Growth 모두 동일 Local Resolver 사용
 *
 * 설계 결정:
 *   - student_ref = students.id (동일값, 앱 코드 ref:s.id 확인)
 *   - class 소속 검증 없음 (B안): pool 소속만 강제.
 *     이유: 보강(makeup_sessions)·다중반·임시 합류 학생이 다른 반 수업 참여 가능.
 *   - 미검증 학생: curriculum match에서만 제외, AI 일지 본문은 유지, 전체 요청 실패 없음.
 *   - candidate_id: "cand_" + randomBytes(16).toString("hex") = 37자, DB PK 미노출.
 *   - _curriculum_item_id: match_token payload 안에만 포함, 응답 JSON에는 절대 미포함.
 *   - DB 오류 발생 시 [] 반환 (기존 AI 일지 파이프라인 영향 없음).
 *   - CurriculumDb 인터페이스: 운영 DB 의존성 주입 + 테스트 mock 주입 지원.
 */

import crypto from "crypto";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { ExtractedMeaning } from "./diary-parser.js";
import type { GrowthConfidenceConfigV1 } from "../config/growth-confidence-config.js";
import { computeCurriculumConfidence, MATCHING_ALGORITHM_VERSION } from "./curriculum-confidence.js";

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

/**
 * candidate의 원천 scope.
 *   POOL_LOCAL       — 해당 수영장의 공식 Local curriculum에서 검색된 항목.
 *                      progress growth_event/CPO/SCP 생성 허용.
 *   GLOBAL_REFERENCE — 전체 공유 Global Reference curriculum에서 검색된 항목.
 *                      AI grounding/context에만 사용. progress 생성 금지.
 */
export type CurriculumSourceScope = "POOL_LOCAL" | "GLOBAL_REFERENCE";

export interface CurriculumCandidateResult {
  student_ref:           string;
  /** 앱 노출용 opaque ID ("cand_" + 32자 hex). DB PK 절대 미노출. */
  candidate_id:          string;
  /** curriculum_items.title */
  display_label:         string;
  description:           string | null;
  curriculum_version_id: string;
  confidence:            number;
  /** V1 고정: AUTO_ACCEPTED 절대 사용 금지 */
  match_status:          "PENDING_REVIEW";
  matching_algorithm_version: typeof MATCHING_ALGORITHM_VERSION;
  /**
   * 원천 scope. progress 생성 가능 여부를 결정한다.
   *   POOL_LOCAL       → growth_event/CPO/SCP 생성 허용
   *   GLOBAL_REFERENCE → AI grounding 전용, progress 생성 금지
   */
  source_scope:          CurriculumSourceScope;
  /**
   * match_token payload 전용 내부 필드.
   * 응답 JSON 직렬화 시 반드시 제외할 것.
   * ai-v1.ts에서 토큰 생성 후 응답 빌드 시 이 필드를 spread하지 않는다.
   */
  _curriculum_item_id:   string;
}

// ── DB 인터페이스 (운영 + 테스트 mock 주입) ───────────────────────────────────

export interface CurriculumDb {
  /** pool 소속 + deleted_at IS NULL 검증 후 실재하는 student_id 목록 반환 */
  verifyStudentRefs(refs: string[], poolId: string): Promise<string[]>;
  /**
   * 검증된 학생들의 활성 LOCAL curriculum_version 배정 목록 반환 (SCA 기반).
   * is_global_reference=true인 version은 반드시 제외한다 (Global이 SCA를 가리켜도 Local로 오인 불가).
   * SCA가 없는 학생은 반환 목록에서 제외됨 (getPoolActiveLocalVersion fallback 사용).
   */
  getAssignedVersions(
    studentIds: string[],
    poolId: string,
  ): Promise<{ student_id: string; curriculum_version_id: string }[]>;
  /** Local 활성 version의 curriculum items 반환 (pool-scoped) */
  getCurriculumItems(
    versionIds: string[],
    poolId: string,
  ): Promise<{ id: string; title: string; description: string | null; curriculum_version_id: string }[]>;
  /**
   * Global Reference curriculum items 반환.
   * 조건: curriculum_versions.is_global_reference=true AND import_status='ACTIVE' AND ci.is_active=true
   * pool_id 조건 없음 — 전 수영장 공통 reference.
   */
  getGlobalReferenceItems(): Promise<{ id: string; title: string; description: string | null; curriculum_version_id: string }[]>;
  /**
   * pool의 active Local version ID 반환 (SCA 없는 학생의 fallback).
   *
   * Canonical Local Resolver Step 2:
   *   SCA가 없는 학생은 pool의 단일 active Local version을 사용한다.
   *
   * 조건:
   *   is_global_reference = false
   *   AND swimming_pool_id = poolId
   *   AND is_active        = true
   *   AND import_status    = 'ACTIVE'
   *   AND archived_at      IS NULL
   *
   * pool당 active Local version은 최대 1개 (UNIQUE INDEX 보장).
   * 없으면 null 반환 → NO_ACTIVE_LOCAL_CURRICULUM.
   */
  getPoolActiveLocalVersion(poolId: string): Promise<string | null>;
}

// ── 운영 DB 구현 ─────────────────────────────────────────────────────────────

const productionCurriculumDb: CurriculumDb = {
  async verifyStudentRefs(refs, poolId) {
    if (refs.length === 0) return [];
    const result = await superAdminDb.execute(sql`
      SELECT id
      FROM students
      WHERE id = ANY(${refs}::text[])
        AND swimming_pool_id = ${poolId}
        AND deleted_at IS NULL
    `);
    return (result.rows as { id: string }[]).map((r) => r.id);
  },

  async getAssignedVersions(studentIds, poolId) {
    if (studentIds.length === 0) return [];
    // is_global_reference=false 조건 필수:
    // SCA가 Global version을 가리키더라도 Local로 오인하지 않는다.
    const result = await superAdminDb.execute(sql`
      SELECT DISTINCT sca.student_id, sca.curriculum_version_id
      FROM student_curriculum_assignments sca
      JOIN curriculum_versions cv
        ON cv.id = sca.curriculum_version_id
      WHERE sca.student_id              = ANY(${studentIds}::text[])
        AND sca.swimming_pool_id        = ${poolId}
        AND sca.is_active               = true
        AND sca.deactivated_at          IS NULL
        AND cv.is_active                = true
        AND cv.swimming_pool_id         = ${poolId}
        AND cv.archived_at              IS NULL
        AND cv.is_global_reference      = false
    `);
    return result.rows as { student_id: string; curriculum_version_id: string }[];
  },

  async getCurriculumItems(versionIds, poolId) {
    if (versionIds.length === 0) return [];
    const result = await superAdminDb.execute(sql`
      SELECT id, title, description, curriculum_version_id
      FROM curriculum_items
      WHERE curriculum_version_id = ANY(${versionIds}::text[])
        AND is_active              = true
        AND swimming_pool_id       = ${poolId}
      ORDER BY sort_order ASC NULLS LAST
    `);
    return result.rows as {
      id: string;
      title: string;
      description: string | null;
      curriculum_version_id: string;
    }[];
  },

  async getGlobalReferenceItems() {
    // pool_id 조건 없음 — 전 수영장 공통 reference.
    // is_active는 pool당 UNIQUE 제약 때문에 false가 될 수 있으므로 조건으로 사용하지 않음.
    // is_global_reference=true AND import_status='ACTIVE' 을 source of truth로 사용.
    const result = await superAdminDb.execute(sql`
      SELECT ci.id, ci.title, ci.description, ci.curriculum_version_id
      FROM curriculum_items ci
      JOIN curriculum_versions cv ON cv.id = ci.curriculum_version_id
      WHERE cv.is_global_reference = true
        AND cv.import_status       = 'ACTIVE'
        AND ci.is_active           = true
      ORDER BY ci.sort_order ASC NULLS LAST
    `);
    return result.rows as {
      id: string;
      title: string;
      description: string | null;
      curriculum_version_id: string;
    }[];
  },

  async getPoolActiveLocalVersion(poolId) {
    // Canonical Local Resolver Step 2:
    // SCA 없는 학생의 fallback — pool의 단일 active Local version.
    // UNIQUE INDEX (swimming_pool_id) WHERE is_active=true 보장: 최대 1개.
    const result = await superAdminDb.execute(sql`
      SELECT id
      FROM curriculum_versions
      WHERE swimming_pool_id   = ${poolId}
        AND is_global_reference = false
        AND is_active            = true
        AND import_status        = 'ACTIVE'
        AND archived_at          IS NULL
      LIMIT 1
    `);
    return ((result.rows as any[])[0]?.id as string) ?? null;
  },
};

// ── candidate_id 생성 ─────────────────────────────────────────────────────────

function newCandidateId(): string {
  // "cand_" (5자) + hex 32자 = 37자. 요청별 랜덤. DB PK 미노출.
  return "cand_" + crypto.randomBytes(16).toString("hex");
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 검증된 학생 ref 목록에 대해 curriculum candidate를 검색합니다.
 *
 * Canonical Local Resolver (AI Diary / Manual Diary / Parent / Growth 공통):
 *   1. SCA 있는 학생 → SCA Local version 사용
 *   2. SCA 없는 학생 → pool active Local version fallback
 *   3. 둘 다 없으면 → Local candidate 0건 (Global grounding만 가능)
 *
 * @param params.requestedRefs 요청의 students[].ref (= students.id)
 * @param params.poolId JWT 검증된 pool_id
 * @param params.meaning extractMeaning() 결과
 * @param params.config GrowthConfidenceConfigV1
 * @param db CurriculumDb (기본: productionCurriculumDb, 테스트: mock 주입)
 *
 * @returns CurriculumCandidateResult[] (threshold 이상만 포함, 실패 시 [])
 */
export async function searchCurriculumCandidates(
  params: {
    requestedRefs: string[];
    poolId:        string;
    meaning:       ExtractedMeaning;
    config:        GrowthConfidenceConfigV1;
  },
  db: CurriculumDb = productionCurriculumDb,
): Promise<CurriculumCandidateResult[]> {
  const { requestedRefs, poolId, meaning, config } = params;

  if (requestedRefs.length === 0) return [];

  try {
    // ── Step 1: student_ref → students.id DB 검증 (pool + deleted_at IS NULL) ──
    const verifiedIds = await db.verifyStudentRefs(requestedRefs, poolId);
    if (verifiedIds.length === 0) return [];

    // ── Layer 1 (POOL_LOCAL): Canonical Local Resolver ────────────────────────
    //
    // Step 1-A: SCA 배정 (is_global_reference=false 조건 포함 — Global SCA 무시)
    const assignments = await db.getAssignedVersions(verifiedIds, poolId);

    // Step 1-B: SCA 없는 학생을 위한 pool active Local version fallback
    const poolFallbackVersionId = await db.getPoolActiveLocalVersion(poolId);

    // Step 1-C: 학생별 최종 Local version ID 결정
    //   SCA 있는 학생 → SCA version (우선)
    //   SCA 없는 학생 → pool active fallback
    //   둘 다 없으면 → Map에 미포함 (Local candidate 0)
    const studentVersionMap = new Map<string, string>(); // student_id → version_id

    for (const a of assignments) {
      studentVersionMap.set(a.student_id, a.curriculum_version_id);
    }
    if (poolFallbackVersionId) {
      for (const id of verifiedIds) {
        if (!studentVersionMap.has(id)) {
          studentVersionMap.set(id, poolFallbackVersionId);
        }
      }
    }

    // Step 1-D: 모든 고유 Local version IDs → items 일괄 조회 (N+1 방지)
    const allLocalVersionIds = [...new Set(studentVersionMap.values())];
    const localItems = allLocalVersionIds.length > 0
      ? await db.getCurriculumItems(allLocalVersionIds, poolId)
      : [];

    // ── Layer 2 (GLOBAL_REFERENCE): is_global_reference=true AND import_status='ACTIVE' ──
    // pool_id 무관 — 전 수영장 공통 reference
    const globalItems = await db.getGlobalReferenceItems();

    // ── Step 3: 학생별 candidate 생성 ────────────────────────────────────────

    const results: CurriculumCandidateResult[] = [];

    for (const ref of verifiedIds) {
      // 이 학생에게 배정된 Local version ID (SCA 또는 pool fallback)
      const studentVersionId = studentVersionMap.get(ref);

      // LOCAL candidates
      if (studentVersionId) {
        for (const item of localItems) {
          if (item.curriculum_version_id !== studentVersionId) continue;

          const conf = computeCurriculumConfidence(meaning, item, config);
          if (!conf) continue;

          results.push({
            student_ref:                ref,
            candidate_id:               newCandidateId(),
            display_label:              item.title,
            description:                item.description,
            curriculum_version_id:      item.curriculum_version_id,
            confidence:                 conf.confidence,
            match_status:               "PENDING_REVIEW", // AUTO_ACCEPTED 금지
            matching_algorithm_version: MATCHING_ALGORITHM_VERSION,
            source_scope:               "POOL_LOCAL",     // progress 허용
            _curriculum_item_id:        item.id,          // match_token 전용, 응답 미포함
          });
        }
      }

      // GLOBAL candidates — AI grounding 전용
      // Local 동일 항목(curriculum_item_id 기준)이 이미 POOL_LOCAL로 추가된 경우도
      // 별도 독립 candidate로 추가 (caller가 source_scope로 구분)
      for (const item of globalItems) {
        const conf = computeCurriculumConfidence(meaning, item, config);
        if (!conf) continue;

        results.push({
          student_ref:                ref,
          candidate_id:               newCandidateId(),
          display_label:              item.title,
          description:                item.description,
          curriculum_version_id:      item.curriculum_version_id,
          confidence:                 conf.confidence,
          match_status:               "PENDING_REVIEW",
          matching_algorithm_version: MATCHING_ALGORITHM_VERSION,
          source_scope:               "GLOBAL_REFERENCE", // progress 금지
          _curriculum_item_id:        item.id,
        });
      }
    }

    return results;
  } catch (err: unknown) {
    // DB 오류: AI 일지 파이프라인 영향 없도록 [] 반환
    // 학생 ref·이름·secret 로그 금지
    const safeMsg = String(
      err instanceof Error ? err.message : String(err),
    ).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]");
    console.error(`[curriculum-candidate-search] DB_ERROR msg=${safeMsg}`);
    return [];
  }
}
