/**
 * ai-diary-utils.ts — ai/diary/generate 라우트의 순수 유틸 함수
 *
 * openai·express·multer 의존 없음 → 단위 테스트 직접 가능
 */

// ── 파이프라인 모드 ───────────────────────────────────────────────────────────
export type PipelineMode = 'legacy' | 'parser_v1';

/** DIARY_PIPELINE_MODE env var 읽기 (매 요청마다 호출 → Kill Switch) */
export function getEffectivePipelineMode(): PipelineMode {
  const raw = (process.env.DIARY_PIPELINE_MODE ?? '').trim().toLowerCase();
  if (raw === 'parser_v1') return 'parser_v1';
  if (raw === '' || raw === 'legacy') return 'legacy';
  console.warn(`[AI/config] DIARY_PIPELINE_MODE="${process.env.DIARY_PIPELINE_MODE}" 알 수 없는 값 — legacy로 폴백`);
  return 'legacy';
}

// ── GPT 타임아웃 ──────────────────────────────────────────────────────────────
const DEFAULT_GPT_TIMEOUT_MS = 30_000;

/** DIARY_GPT_TIMEOUT_MS env var 읽기 (매 요청마다 호출 → Kill Switch) */
export function getGptTimeoutMs(): number {
  const raw = process.env.DIARY_GPT_TIMEOUT_MS;
  if (!raw) return DEFAULT_GPT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[AI/config] DIARY_GPT_TIMEOUT_MS="${raw}" 유효하지 않음 — ${DEFAULT_GPT_TIMEOUT_MS}ms 사용`);
    return DEFAULT_GPT_TIMEOUT_MS;
  }
  return n;
}

// ── 오류 클래스 ───────────────────────────────────────────────────────────────

/** GPT 호출 타임아웃 → HTTP 504, retryable=true */
export class ModelTimeoutError extends Error {
  constructor() {
    super('MODEL_TIMEOUT');
    this.name = 'ModelTimeoutError';
  }
}

/** 학생 확정 불가 (parser_v1) → HTTP 422, retryable=false */
export class StudentResolutionError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super('STUDENT_RESOLUTION_REQUIRED');
    this.name   = 'StudentResolutionError';
    this.reason = reason;
  }
}

// ── 외부 request_id 검증 ─────────────────────────────────────────────────────
export function isValidExternalRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 128
  );
}

// ── pool_id 비식별 해시 (로그 전용, 복호화 불가) ─────────────────────────────
export function hashPoolId(poolId: string): string {
  let h = 0;
  for (let i = 0; i < poolId.length; i++) {
    h = Math.imul(31, h) + poolId.charCodeAt(i) | 0;
  }
  return 'p' + (h >>> 0).toString(16);
}

// ── 내부 추적용 ID 생성 ───────────────────────────────────────────────────────
export function newInternalRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── 구조화 로그 (비식별) ──────────────────────────────────────────────────────
export interface DiaryStructuredLog {
  internal_id:         string;
  external_request_id: string;
  feature_flag:        PipelineMode;
  engine_version:      string;
  prompt_version:      string;
  validator_result:    string;
  error_code?:         string;
  latency_ms:          number;
  pool_id_hash?:       string;
}

/** 비식별 구조화 로그 출력 (금지 필드: 교사 원문, 학생 이름, prompt 전문, GPT 응답 전문, JWT, Authorization) */
export function logDiaryStructured(params: DiaryStructuredLog): void {
  console.log('[AI/diary/structured]', JSON.stringify(params));
}

// ── Output Validation (E-A3) ─────────────────────────────────────────────────

export interface ValidatedStudentResult {
  student_ref: string;
  content:     string;
}

export interface ValidatedDiaryOutput {
  common:   string;
  students: ValidatedStudentResult[];
}

/** GPT 출력 검증 실패 */
export class OutputValidationError extends Error {
  readonly reason: string;
  readonly studentIndex?: number;
  constructor(reason: string, studentIndex?: number) {
    super('OUTPUT_VALIDATION_FAILED');
    this.name        = 'OutputValidationError';
    this.reason      = reason;
    this.studentIndex = studentIndex;
  }
}

/** GPT 출력을 검증·정상화합니다. 실패 시 OutputValidationError throw. */
export function validateDiaryOutput(
  parsed:             unknown,
  allowedStudentRefs: Set<string>,
): ValidatedDiaryOutput {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OutputValidationError('TOP_LEVEL_NOT_OBJECT');
  }
  const obj = parsed as Record<string, unknown>;

  const rawCommon = obj.common;
  if (rawCommon !== undefined && typeof rawCommon !== 'string') {
    throw new OutputValidationError('COMMON_NOT_STRING');
  }
  const normalizedCommon = typeof rawCommon === 'string' ? rawCommon.trim() : '';

  const rawStudentsField = obj.students;
  if (rawStudentsField !== undefined && !Array.isArray(rawStudentsField)) {
    throw new OutputValidationError('STUDENTS_NOT_ARRAY');
  }
  const rawStudents: unknown[] = Array.isArray(rawStudentsField) ? rawStudentsField : [];

  const seenRefs:     Set<string>              = new Set();
  const validResults: ValidatedStudentResult[] = [];

  for (let i = 0; i < rawStudents.length; i++) {
    const item = rawStudents[i];

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new OutputValidationError('STUDENT_ITEM_NOT_OBJECT', i);
    }
    const entry = item as Record<string, unknown>;

    // student_ref 우선, student_id fallback (legacy 호환)
    const rawRef   = entry.student_ref;
    const rawRefId = entry.student_id;
    let resolvedRef: string | null = null;

    if (typeof rawRef === 'string' && rawRef.trim()) {
      resolvedRef = rawRef.trim();
    } else if (typeof rawRefId === 'string' && rawRefId.trim()) {
      resolvedRef = rawRefId.trim();
    }

    if (!resolvedRef) {
      throw new OutputValidationError('STUDENT_REF_MISSING', i);
    }
    if (!allowedStudentRefs.has(resolvedRef)) {
      throw new OutputValidationError('UNKNOWN_STUDENT_REF', i);
    }
    if (seenRefs.has(resolvedRef)) {
      throw new OutputValidationError('DUPLICATE_STUDENT_REF', i);
    }
    seenRefs.add(resolvedRef);

    if (typeof entry.content !== 'string') {
      throw new OutputValidationError('STUDENT_CONTENT_NOT_STRING', i);
    }
    const normalizedContent = entry.content.trim();
    if (!normalizedContent) continue;

    validResults.push({ student_ref: resolvedRef, content: normalizedContent });
  }

  if (normalizedCommon === '' && validResults.length === 0) {
    throw new OutputValidationError('ALL_EMPTY_OUTPUT');
  }

  return { common: normalizedCommon, students: validResults };
}

/** GPT 출력의 legacy student_id fallback 사용 횟수 (개인정보 미포함) */
export function countLegacyStudentIdFallback(
  parsed:             unknown,
  allowedStudentRefs: Set<string>,
): number {
  if (typeof parsed !== 'object' || parsed === null) return 0;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.students)) return 0;

  let count = 0;
  for (const item of obj.students as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const hasValidRef   = typeof entry.student_ref === 'string' && String(entry.student_ref).trim() !== '' && allowedStudentRefs.has(String(entry.student_ref).trim());
    const hasValidRefId = typeof entry.student_id  === 'string' && String(entry.student_id ).trim() !== '' && allowedStudentRefs.has(String(entry.student_id ).trim());
    if (!hasValidRef && hasValidRefId) count++;
  }
  return count;
}
