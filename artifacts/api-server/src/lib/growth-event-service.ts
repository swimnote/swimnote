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

  // trace prefix — 전체 루프에서 공유
  const trace = `req=${requestId ?? "-"} diary=${diaryId}`;

  for (const match of curriculumMatches) {
    // ── (1) match_status 필터 — PENDING_REVIEW 만 처리 ──────────────────────
    if (match.match_status !== "PENDING_REVIEW") {
      console.log(
        `[growth-event] SKIP_STATUS ${trace} student=${match.student_ref}` +
        ` skip_reason=status:${match.match_status}`,
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
          `[growth-event] TOKEN_ERROR ${trace} student=${match.student_ref}` +
          ` skip_reason=${e.code}`,
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
        `[growth-event] NO_NOTE ${trace} student=${tokenPayload.student_id}` +
        ` skip_reason=no_student_note`,
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
          `[growth-event] INSERTED ${trace} note=${studentNote.id}` +
          ` student=${tokenPayload.student_id} curriculum=${tokenPayload.curriculum_item_id}`,
        );
        inserted++;
      } else {
        console.log(
          `[growth-event] CONFLICT_SKIP ${trace} note=${studentNote.id}` +
          ` student=${tokenPayload.student_id} skip_reason=uq_per_note`,
        );
        skipped++;
      }
    } catch (e: any) {
      // match_token_id UNIQUE 위반 (동일 token 재사용 시도)
      if (e?.code === "23505") {
        console.log(
          `[growth-event] DUPLICATE_TOKEN_SKIP ${trace}` +
          ` student=${tokenPayload.student_id} skip_reason=uq_match_token`,
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

// ── READ LAYER (WP8) ──────────────────────────────────────────────────────────

/**
 * growth_events READ 결과 단건 행 타입 (response contract).
 *
 * 실제 schema 컬럼 기준. LEFT JOIN curriculum_items → curriculum_title(nullable).
 */
export interface GrowthEventRow {
  event_id:              string;
  student_id:            string;
  source:                string;
  status:                string;   // growth_match_status enum 값
  created_at:            string;
  diary_note_id:         string | null;
  curriculum_item_id:    string | null;
  curriculum_version_id: string | null;
  match_token_id:        string | null;
  confidence:            number | null;
  is_invalidated:        boolean;
  // optional linked
  curriculum_title:      string | null;  // curriculum_items.title (LEFT JOIN)
}

export interface GrowthEventListResult {
  events: GrowthEventRow[];
  total:  number;
}

/**
 * 학생별 growth_events 조회 (WP8).
 *
 * 보안 원칙:
 *   - WHERE swimming_pool_id = poolId → 다른 pool 데이터 혼입 방지 (서버사이드 이중 확인)
 *   - WHERE is_invalidated = false 기본 적용
 *   - curriculum_items LEFT JOIN → 테이블/데이터 없어도 null 반환, 전체 조회 실패 없음
 *
 * @param poolId    호출자의 swimming_pool_id (authorization 검증 후 전달)
 * @param studentId 대상 학생 ID
 * @param limit     최대 반환 건수 (기본 30, max 100)
 * @param offset    페이지네이션 오프셋 (기본 0)
 * @param status    growth_match_status 필터 (optional)
 * @param source    source 필터 (optional)
 * @param from      created_at >= ISO date (optional)
 * @param to        created_at <  ISO date (optional, exclusive 처리로 당일 포함)
 */
export async function getStudentGrowthEvents(params: {
  db:        any;   // superAdminDb — 타입 순환 방지
  poolId:    string;
  studentId: string;
  limit:     number;
  offset:    number;
  status?:   string;
  source?:   string;
  from?:     string;
  to?:       string;
}): Promise<GrowthEventListResult> {
  const { db, poolId, studentId, limit, offset, status, source, from, to } = params;

  // ── 동적 WHERE 절 구성 ────────────────────────────────────────────────────
  // drizzle sql tag 내부에서 조건을 동적으로 이어붙이는 방식
  const statusClause  = status ? sql` AND ge.growth_match_status = ${status}::growth_match_status_enum` : sql``;
  const sourceClause  = source ? sql` AND ge.source = ${source}`                                        : sql``;
  const fromClause    = from   ? sql` AND ge.created_at >= ${from}::timestamptz`                         : sql``;
  const toClause      = to     ? sql` AND ge.created_at <  ${to}::timestamptz`                           : sql``;

  // ── 이벤트 목록 조회 (LEFT JOIN curriculum_items) ────────────────────────
  const listRes = await db.execute(sql`
    SELECT
      ge.id                    AS event_id,
      ge.student_id,
      ge.source,
      ge.growth_match_status   AS status,
      ge.created_at,
      ge.diary_note_id,
      ge.curriculum_item_id,
      ge.curriculum_version_id,
      ge.match_token_id,
      ge.confidence,
      ge.is_invalidated,
      ci.title                 AS curriculum_title
    FROM growth_events ge
    LEFT JOIN curriculum_items ci ON ci.id = ge.curriculum_item_id
    WHERE ge.student_id        = ${studentId}
      AND ge.swimming_pool_id  = ${poolId}
      AND ge.is_invalidated    = false
      ${statusClause}
      ${sourceClause}
      ${fromClause}
      ${toClause}
    ORDER BY ge.created_at DESC
    LIMIT  ${limit}
    OFFSET ${offset}
  `);

  // ── 전체 건수 카운트 ──────────────────────────────────────────────────────
  const countRes = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM growth_events ge
    WHERE ge.student_id       = ${studentId}
      AND ge.swimming_pool_id = ${poolId}
      AND ge.is_invalidated   = false
      ${statusClause}
      ${sourceClause}
      ${fromClause}
      ${toClause}
  `);

  const total = Number((countRes.rows as any[])[0]?.cnt ?? 0);

  const events: GrowthEventRow[] = (listRes.rows as any[]).map((r) => ({
    event_id:              r.event_id,
    student_id:            r.student_id,
    source:                r.source,
    status:                r.status,
    created_at:            r.created_at instanceof Date
                             ? r.created_at.toISOString()
                             : String(r.created_at),
    diary_note_id:         r.diary_note_id         ?? null,
    curriculum_item_id:    r.curriculum_item_id    ?? null,
    curriculum_version_id: r.curriculum_version_id ?? null,
    match_token_id:        r.match_token_id        ?? null,
    confidence:            r.confidence != null ? Number(r.confidence) : null,
    is_invalidated:        Boolean(r.is_invalidated),
    curriculum_title:      r.curriculum_title      ?? null,
  }));

  return { events, total };
}

/**
 * growth_event 단건 조회 (WP8 — GET .../events/:eventId).
 *
 * poolId + studentId를 함께 검증하므로 다른 pool/학생 데이터 접근 불가.
 * 반환: GrowthEventRow | null (없으면 null)
 */
export async function getGrowthEventById(params: {
  db:        any;
  poolId:    string;
  studentId: string;
  eventId:   string;
}): Promise<GrowthEventRow | null> {
  const { db, poolId, studentId, eventId } = params;

  const res = await db.execute(sql`
    SELECT
      ge.id                    AS event_id,
      ge.student_id,
      ge.source,
      ge.growth_match_status   AS status,
      ge.created_at,
      ge.diary_note_id,
      ge.curriculum_item_id,
      ge.curriculum_version_id,
      ge.match_token_id,
      ge.confidence,
      ge.is_invalidated,
      ci.title                 AS curriculum_title
    FROM growth_events ge
    LEFT JOIN curriculum_items ci ON ci.id = ge.curriculum_item_id
    WHERE ge.id               = ${eventId}
      AND ge.student_id       = ${studentId}
      AND ge.swimming_pool_id = ${poolId}
    LIMIT 1
  `);

  const r = (res.rows as any[])[0];
  if (!r) return null;

  return {
    event_id:              r.event_id,
    student_id:            r.student_id,
    source:                r.source,
    status:                r.status,
    created_at:            r.created_at instanceof Date
                             ? r.created_at.toISOString()
                             : String(r.created_at),
    diary_note_id:         r.diary_note_id         ?? null,
    curriculum_item_id:    r.curriculum_item_id    ?? null,
    curriculum_version_id: r.curriculum_version_id ?? null,
    match_token_id:        r.match_token_id        ?? null,
    confidence:            r.confidence != null ? Number(r.confidence) : null,
    is_invalidated:        Boolean(r.is_invalidated),
    curriculum_title:      r.curriculum_title      ?? null,
  };
}

// ── REVIEW LAYER (WP13) ──────────────────────────────────────────────────────

/**
 * ReviewConflictError — review 불가 상태 오류
 *  code "invalidated"        → is_invalidated=true event
 *  code "invalid_transition" → PENDING_REVIEW 아닌 event에 반대 방향 변경 시도
 */
export class ReviewConflictError extends Error {
  code: "invalidated" | "invalid_transition";
  constructor(code: "invalidated" | "invalid_transition", message: string) {
    super(message);
    this.name  = "ReviewConflictError";
    this.code  = code;
  }
}

export interface ReviewGrowthEventResult {
  updated:        boolean;
  previousStatus: string;
  newStatus:      string;
}

/**
 * growth_event 승인/거절 처리 (WP13).
 *
 * 허용 transition:
 *   PENDING_REVIEW → TEACHER_ACCEPTED  (action="accept")
 *   PENDING_REVIEW → TEACHER_REJECTED  (action="reject")
 *   idempotent: 동일 결과 재요청 → updated=false, 성공 반환
 *
 * 차단:
 *   is_invalidated=true              → ReviewConflictError("invalidated")
 *   currentStatus !== PENDING_REVIEW → ReviewConflictError("invalid_transition")
 *
 * audit_logs: 상태 변경 시 기록. 실패 시 warn only (review 자체는 유지).
 * PII 금지: 학생명/일지 본문 로그 없음.
 */
export async function reviewGrowthEvent(params: {
  db:             any;
  poolId:         string;
  studentId:      string;
  eventId:        string;
  action:         "accept" | "reject";
  reviewerUserId: string;
}): Promise<ReviewGrowthEventResult | null> {
  const { db, poolId, studentId, eventId, action, reviewerUserId } = params;

  const newStatus = action === "accept" ? "TEACHER_ACCEPTED" : "TEACHER_REJECTED";

  // 1. event 조회
  const fetchRes = await db.execute(sql`
    SELECT id, growth_match_status, is_invalidated
    FROM growth_events
    WHERE id               = ${eventId}
      AND student_id       = ${studentId}
      AND swimming_pool_id = ${poolId}
    LIMIT 1
  `);
  const row = (fetchRes.rows as any[])[0];
  if (!row) return null;  // 404

  // 2. is_invalidated 차단
  if (Boolean(row.is_invalidated)) {
    throw new ReviewConflictError("invalidated", "무효화된 이벤트는 검토할 수 없습니다.");
  }

  const currentStatus: string = row.growth_match_status;

  // 3. idempotent — 동일 결과 재요청
  if (currentStatus === newStatus) {
    return { updated: false, previousStatus: currentStatus, newStatus };
  }

  // 4. transition 허용: PENDING_REVIEW 만
  if (currentStatus !== "PENDING_REVIEW") {
    throw new ReviewConflictError(
      "invalid_transition",
      `${currentStatus} 상태에서는 review 변경이 불가합니다.`,
    );
  }

  const now = new Date().toISOString();

  // 5. UPDATE
  await db.execute(sql`
    UPDATE growth_events
    SET growth_match_status = ${newStatus}::growth_match_status_enum,
        reviewed_by         = ${reviewerUserId},
        reviewed_at         = ${now}::timestamptz,
        updated_at          = NOW()
    WHERE id               = ${eventId}
      AND swimming_pool_id = ${poolId}
  `);

  // 6. audit_logs (실패해도 review 자체는 유지)
  try {
    const versionRes = await db.execute(sql`
      SELECT next_audit_version('growth_event', ${eventId}) AS v
    `);
    const version = (versionRes.rows[0] as any)?.v ?? 1;

    await db.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason,
        request_id, correlation_id, ip_hash
      ) VALUES (
        'growth_event', ${eventId}, ${version},
        ${action === "accept" ? "review_accepted" : "review_rejected"},
        'user', ${reviewerUserId}, ${poolId},
        ${JSON.stringify({ status: currentStatus, student_id: studentId })}::jsonb,
        ${JSON.stringify({ status: newStatus, reviewed_by: reviewerUserId, reviewed_at: now })}::jsonb,
        'teacher_review',
        NULL, NULL, NULL
      )
    `);
  } catch (auditErr: any) {
    console.warn("[growth-review] audit_log 기록 실패:", auditErr.message);
  }

  console.log(
    `[growth-review] ${action.toUpperCase()}: event=${eventId}` +
    ` pool=${poolId} status: ${currentStatus} → ${newStatus} by=${reviewerUserId}`,
  );

  return { updated: true, previousStatus: currentStatus, newStatus };
}
