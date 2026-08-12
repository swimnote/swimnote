/**
 * growth-event-service.ts — WP7
 *
 * X mode 일지 저장 시 growth_events 테이블에 행을 삽입합니다.
 *
 * 설계 원칙:
 *   - TX 내부에서 호출 (drizzle transaction object 파라미터로 전달).
 *   - match_token verify 실패(만료·서명 오류 등)는 해당 항목만 skip + 로그.
 *     → diary TX를 롤백하지 않음.
 *   - DB INSERT 오류는 throw → TX 롤백 (데이터 불일치 방지).
 *   - growth_match_status = 'PENDING_REVIEW' 명시 필수
 *     (DB default 'AUTO_ACCEPTED' 사용 금지 — match-token.ts WP7 주석 참조).
 *   - ON CONFLICT DO NOTHING: partial unique index uq_growth_events_per_note
 *     (diary_note_id, student_id, curriculum_item_id, source) WHERE ... IS NOT NULL AND is_invalidated = false
 *   - match_token_id UNIQUE WHERE NOT NULL: 동일 token 재사용 시도도 23505로 처리.
 *
 * 로그 정책 (PII 미포함):
 *   허용: diary_id, note_id, student_id(opaque), curriculum_item_id, inserted/skipped counts, error codes.
 *   금지: 일지 본문, 교사명, 학생명, confidence 원문.
 */
import { sql } from "drizzle-orm";
import { verifyMatchToken, MatchTokenError } from "./match-token.js";

// ── 입력 타입 ─────────────────────────────────────────────────────────────────

/** 앱이 diary save body에 전달하는 curriculum match 항목 (1건) */
export interface CurriculumMatchInput {
  /** AI generate 시 서버가 발급한 student reference (= students.id) */
  student_ref:   string;
  /** AI generate 응답의 candidate_id (opaque ID) */
  candidate_id:  string;
  /** HMAC-SHA256 서명 match token */
  match_token:   string;
  /** AI generate 응답의 match_status — 'PENDING_REVIEW' 외에는 skip */
  match_status:  string;
}

/** insertGrowthEvents 반환 — 로깅·응답에 사용 */
export interface GrowthEventInsertResult {
  inserted:  number;
  skipped:   number;
  errors:    number;
}

// ── 주 함수 ───────────────────────────────────────────────────────────────────

/**
 * X mode diary save 후 growth_events 삽입.
 *
 * @param tx                drizzle transaction object (diary TX 내부에서 호출).
 * @param poolId            swimming_pools.id.
 * @param diaryId           class_diaries.id (로그용).
 * @param savedNotes        이번 TX에서 저장된 student notes [{ id, student_id }].
 * @param curriculumMatches 앱이 전달한 curriculum match 목록.
 * @param requestId         AI generate request_id (trace용, optional).
 * @param contractVersion   AI contract version (trace용, optional).
 */
export async function insertGrowthEvents(params: {
  tx:                 any;   // drizzle Transaction<any> — 타입 순환 방지
  poolId:             string;
  diaryId:            string;
  savedNotes:         Array<{ id: string; student_id: string }>;
  curriculumMatches:  CurriculumMatchInput[];
  requestId?:         string;
  contractVersion?:   string;
}): Promise<GrowthEventInsertResult> {
  const {
    tx, poolId, diaryId, savedNotes,
    curriculumMatches, requestId, contractVersion,
  } = params;

  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const match of curriculumMatches) {
    // ── (1) match_status 필터 — PENDING_REVIEW 만 처리 ──────────────────────
    if (match.match_status !== "PENDING_REVIEW") {
      console.log(
        `[growth-event] SKIP_STATUS diary=${diaryId} student_ref=${match.student_ref}` +
        ` status=${match.match_status}`,
      );
      skipped++;
      continue;
    }

    // ── (2) match_token 검증 → curriculum_item_id 등 추출 ───────────────────
    let tokenPayload;
    try {
      tokenPayload = verifyMatchToken(match.match_token, {
        expectedPoolId:      poolId,
        expectedStudentId:   match.student_ref,
        expectedCandidateId: match.candidate_id,
      });
    } catch (e) {
      if (e instanceof MatchTokenError) {
        // match_token 만료·서명 오류·pool 불일치 등 → skip, diary TX 유지
        console.error(
          `[growth-event] TOKEN_ERROR diary=${diaryId} student_ref=${match.student_ref}` +
          ` code=${e.code}`,
        );
        errors++;
        continue;
      }
      // 예상치 못한 오류 → TX 롤백
      throw e;
    }

    // ── (3) 해당 student_id 의 student_note 찾기 ────────────────────────────
    const studentNote = savedNotes.find(n => n.student_id === tokenPayload.student_id);
    if (!studentNote) {
      // 학생 note 없음 (COMMON only) — diary_note_id NOT NULL 조건 불충족, skip
      console.log(
        `[growth-event] NO_NOTE diary=${diaryId} student_id=${tokenPayload.student_id}`,
      );
      skipped++;
      continue;
    }

    // ── (4) growth_event INSERT ──────────────────────────────────────────────
    //
    // ON CONFLICT 대상:
    //   uq_growth_events_per_note:
    //     (diary_note_id, student_id, curriculum_item_id, source)
    //     WHERE diary_note_id IS NOT NULL AND is_invalidated = false
    //
    //   uq_growth_events_match_token_id:
    //     (match_token_id) WHERE match_token_id IS NOT NULL
    //     → 동일 token 재전송 시 23505 constraint violation → skipped 처리
    //
    // growth_match_status = 'PENDING_REVIEW' 명시 필수 (DB default AUTO_ACCEPTED 금지)
    try {
      const insertRes = await tx.execute(sql`
        INSERT INTO growth_events (
          student_id,
          swimming_pool_id,
          curriculum_item_id,
          curriculum_version_id,
          diary_note_id,
          source,
          match_token_id,
          growth_match_status,
          confidence,
          matching_algorithm_version,
          contract_version,
          request_id
        ) VALUES (
          ${tokenPayload.student_id},
          ${poolId},
          ${tokenPayload.curriculum_item_id},
          ${tokenPayload.curriculum_version_id},
          ${studentNote.id},
          'teacher_ai',
          ${tokenPayload.token_id},
          'PENDING_REVIEW',
          ${tokenPayload.confidence},
          ${tokenPayload.matching_algorithm_version},
          ${contractVersion ?? null},
          ${requestId ?? null}
        )
        ON CONFLICT (diary_note_id, student_id, curriculum_item_id, source)
          WHERE diary_note_id IS NOT NULL AND is_invalidated = false
        DO NOTHING
      `);

      const rowCount = (insertRes as any).rowCount ?? 0;
      if (rowCount > 0) {
        console.log(
          `[growth-event] INSERTED diary=${diaryId} note=${studentNote.id}` +
          ` student=${tokenPayload.student_id} curriculum=${tokenPayload.curriculum_item_id}`,
        );
        inserted++;
      } else {
        console.log(
          `[growth-event] CONFLICT_SKIP diary=${diaryId} note=${studentNote.id}` +
          ` student=${tokenPayload.student_id}`,
        );
        skipped++;
      }
    } catch (e: any) {
      // match_token_id UNIQUE 위반 (동일 token 재사용 시도)
      if (e?.code === "23505") {
        console.log(
          `[growth-event] DUPLICATE_TOKEN_SKIP diary=${diaryId}` +
          ` student=${tokenPayload.student_id}`,
        );
        skipped++;
      } else {
        // 그 외 DB 오류 → TX 롤백
        throw e;
      }
    }
  }

  return { inserted, skipped, errors };
}
