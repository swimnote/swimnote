/**
 * curriculum-candidate-search.ts — Curriculum Candidate 검색
 *
 * WP6 파이프라인 흐름:
 *   student_ref (= students.id)
 *     → student_curriculum_assignments (is_active, deactivated_at IS NULL)
 *     → curriculum_versions (is_active, archived_at IS NULL)
 *     → curriculum_items (is_active)
 *     → computeCurriculumConfidence
 *     → CurriculumCandidateResult[]
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
  /** 검증된 학생들의 활성 curriculum_version 배정 목록 반환 */
  getAssignedVersions(
    studentIds: string[],
    poolId: string,
  ): Promise<{ student_id: string; curriculum_version_id: string }[]>;
  /** 활성 version의 curriculum items 반환 */
  getCurriculumItems(
    versionIds: string[],
    poolId: string,
  ): Promise<{ id: string; title: string; description: string | null; curriculum_version_id: string }[]>;
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
    const result = await superAdminDb.execute(sql`
      SELECT DISTINCT sca.student_id, sca.curriculum_version_id
      FROM student_curriculum_assignments sca
      JOIN curriculum_versions cv
        ON cv.id = sca.curriculum_version_id
      WHERE sca.student_id          = ANY(${studentIds}::text[])
        AND sca.swimming_pool_id    = ${poolId}
        AND sca.is_active           = true
        AND sca.deactivated_at      IS NULL
        AND cv.is_active            = true
        AND cv.swimming_pool_id     = ${poolId}
        AND cv.archived_at          IS NULL
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
    // Step 1: student_ref → students.id DB 검증 (pool + deleted_at IS NULL)
    const verifiedIds = await db.verifyStudentRefs(requestedRefs, poolId);
    if (verifiedIds.length === 0) return [];

    // Step 2: 검증된 학생의 활성 curriculum version 배정 조회
    const assignments = await db.getAssignedVersions(verifiedIds, poolId);
    if (assignments.length === 0) return [];

    const allVersionIds = [...new Set(assignments.map((a) => a.curriculum_version_id))];

    // Step 3: 활성 version의 curriculum items 조회
    const items = await db.getCurriculumItems(allVersionIds, poolId);
    if (items.length === 0) return [];

    // Step 4: 학생별 confidence 계산 및 후보 생성
    const results: CurriculumCandidateResult[] = [];

    for (const ref of verifiedIds) {
      // 이 학생에게 배정된 version ids 집합
      const assignedVersionIds = new Set(
        assignments
          .filter((a) => a.student_id === ref)
          .map((a) => a.curriculum_version_id),
      );

      for (const item of items) {
        if (!assignedVersionIds.has(item.curriculum_version_id)) continue;

        const conf = computeCurriculumConfidence(meaning, item, config);
        if (!conf) continue; // threshold 미달 → 제외

        results.push({
          student_ref:                ref,
          candidate_id:               newCandidateId(),
          display_label:              item.title,
          description:                item.description,
          curriculum_version_id:      item.curriculum_version_id,
          confidence:                 conf.confidence,
          match_status:               "PENDING_REVIEW", // AUTO_ACCEPTED 금지
          matching_algorithm_version: MATCHING_ALGORITHM_VERSION,
          _curriculum_item_id:        item.id, // match_token 생성 전용, 응답 미포함
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
