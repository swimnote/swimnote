/**
 * AI Routes — SwimNote API Server
 *
 * POST /ai/whisper/transcribe — 음성 파일 → Whisper STT → transcript 반환
 * POST /ai/transcribe         — 구 경로 (하위 호환 유지)
 * POST /ai/diary/generate     — 수업 입력 → GPT → 일지 생성 (E1 Contract)
 *
 * E1 Contract (E-A2~): 앱이 보내는 request_id를 그대로 echo.
 *   Request:  { request_id, schema_version, feature, locale, input, context }
 *   Response: { request_id, schema_version, feature, result, usage }
 *   Error:    { request_id, schema_version, feature, status: 'failed', error }
 *
 * 401 응답은 requireAuth 공통 미들웨어 형식을 유지합니다 (E-A2 수정 범위 외).
 *
 * 안전장치:
 *   DIARY_PIPELINE_MODE  — env var, 허용값: legacy | parser_v1 (기본 legacy)
 *   DIARY_GPT_TIMEOUT_MS — env var, GPT 호출 타임아웃 (기본 30000ms)
 *   MODEL_TIMEOUT        — GPT 타임아웃 시 HTTP 504, retryable=true
 *   STUDENT_RESOLUTION_REQUIRED — parser_v1에서 학생 미확정 시 별도 오류코드
 *   parser_v1 Tenant 격리 — JWT poolId ↔ context.pool_id 일치 검증
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { requireAuth, type AuthRequest } from '../middlewares/auth.js';
import {
  getEffectivePipelineMode,
  getGptTimeoutMs,
  ModelTimeoutError,
  StudentResolutionError,
  OutputValidationError,
  validateDiaryOutput,
  countLegacyStudentIdFallback,
  isValidExternalRequestId,
  newInternalRequestId,
  hashPoolId,
  logDiaryStructured,
  type PipelineMode,
} from '../lib/ai-diary-utils.js';

export {
  getEffectivePipelineMode,
  getGptTimeoutMs,
  ModelTimeoutError,
  StudentResolutionError,
  OutputValidationError,
  validateDiaryOutput,
  isValidExternalRequestId,
  newInternalRequestId,
  hashPoolId,
  logDiaryStructured,
  type PipelineMode,
};

const router = Router();

// ── OpenAI 클라이언트 (lazy init) ─────────────────────────────────────────────
let openai: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ── multer — 메모리 저장, 최대 25MB (Whisper API 제한) ───────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMime = ['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/wav',
                         'audio/webm', 'audio/x-m4a', 'video/mp4'];
    const allowedExt  = /\.(m4a|mp4|mp3|wav|webm)$/i;
    if (allowedMime.includes(file.mimetype) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`지원하지 않는 오디오 형식입니다. mime=${file.mimetype}`));
    }
  },
});

// ── POST /ai/whisper/transcribe (신규 경로) ───────────────────────────────────
async function handleWhisper(req: Request, res: Response): Promise<void> {
  const internalId = newInternalRequestId();
  const startMs    = Date.now();
  const file = req.file;

  if (!file) {
    res.status(400).json({
      request_id: internalId,
      error: { code: 'NO_FILE', message: '음성 파일이 없습니다.', retryable: false },
    });
    return;
  }

  console.log(`[AI/whisper:${internalId}] 수신 size=${file.size}B mime=${file.mimetype}`);

  try {
    const client = getOpenAI();

    const audioFile = new File(
      [new Uint8Array(file.buffer)],
      file.originalname || 'audio.m4a',
      { type: file.mimetype || 'audio/m4a' },
    );

    const transcription = await client.audio.transcriptions.create({
      file:     audioFile,
      model:    'whisper-1',
      language: 'ko',
    });

    const transcript = transcription.text.trim();
    const elapsedMs  = Date.now() - startMs;
    console.log(`[AI/whisper:${internalId}] 완료 elapsed=${elapsedMs}ms len=${transcript.length}chars`);

    res.json({ request_id: internalId, transcript });
  } catch (e: any) {
    const elapsedMs = Date.now() - startMs;
    const safeMsg   = String(e?.message ?? 'Whisper API 호출 실패').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
    console.error(`[AI/whisper:${internalId}] 오류 elapsed=${elapsedMs}ms status=${e?.status ?? 500} msg=${safeMsg}`);
    const retryable = !e?.status || e.status >= 500 || e.status === 429;
    res.status(e?.status ?? 500).json({
      request_id: internalId,
      error: { code: e?.code ?? 'WHISPER_ERROR', message: safeMsg, retryable },
    });
  }
}

router.post('/ai/whisper/transcribe', requireAuth as any, upload.single('audio') as any, handleWhisper);
router.post('/ai/transcribe',         requireAuth as any, upload.single('audio') as any, handleWhisper);

// ── POST /ai/diary/generate (E1 Contract) ────────────────────────────────────
router.post(
  '/ai/diary/generate',
  requireAuth as any,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const internalId = newInternalRequestId();
    const startMs    = Date.now();

    // 매 요청마다 읽어서 Kill Switch 역할
    const effectiveMode  = getEffectivePipelineMode();
    const gptTimeoutMs   = getGptTimeoutMs();

    const rawBody = req.body ?? {};

    // ── 1. 외부 request_id ───────────────────────────────────────────────────
    const externalRequestId = rawBody.request_id;

    if (!isValidExternalRequestId(externalRequestId)) {
      console.warn(`[AI/diary:${internalId}] invalid_request_id mode=${effectiveMode}`);
      res.status(400).json({
        contract_version: '1.0',
        request_id:       null,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'request_id is required.', retryable: false },
      });
      return;
    }

    // ── 2. contract_version ─────────────────────────────────────────────────
    // 앱이 전송하는 contract_version을 검증합니다.
    // 지원하지 않는 버전의 요청은 즉시 거부하여 하위 호환성을 강제합니다.
    const contractVersion = rawBody.contract_version;
    const SUPPORTED_REQUEST_CONTRACT_VERSIONS = new Set(['1.0']);
    if (typeof contractVersion !== 'string' || !SUPPORTED_REQUEST_CONTRACT_VERSIONS.has(contractVersion)) {
      console.warn(`[AI/diary:${internalId}] unsupported_contract_version version=${contractVersion} ext_id=${externalRequestId}`);
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'UNSUPPORTED_CONTRACT', message: `Unsupported contract_version: ${contractVersion ?? '(missing)'}. Supported: 1.0`, retryable: false },
      });
      return;
    }

    // ── 3. schema_version ────────────────────────────────────────────────────
    if (rawBody.schema_version !== '1.0') {
      console.warn(`[AI/diary:${internalId}] invalid_schema_version ext_id=${externalRequestId}`);
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'Invalid teacher diary request.', retryable: false },
      });
      return;
    }

    // ── 4. feature ───────────────────────────────────────────────────────────
    if (rawBody.feature !== 'teacher_diary') {
      console.warn(`[AI/diary:${internalId}] invalid_feature ext_id=${externalRequestId}`);
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'Invalid teacher diary request.', retryable: false },
      });
      return;
    }

    // ── 4. input.text ────────────────────────────────────────────────────────
    const input = rawBody.input;
    const inputText          = typeof input?.text === 'string' ? input.text : '';
    const normalizedInputText = inputText.trim();

    if (!normalizedInputText) {
      console.warn(`[AI/diary:${internalId}] invalid_input_text ext_id=${externalRequestId}`);
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'Invalid teacher diary request.', retryable: false },
      });
      return;
    }

    // ── 5. context 파싱 ──────────────────────────────────────────────────────
    const context = rawBody.context;

    const poolId      = typeof context?.pool_id      === 'string' ? context.pool_id      : '';
    const classId     = typeof context?.class_id     === 'string' ? context.class_id     : '';
    const lessonDate  = typeof context?.lesson_date  === 'string' ? context.lesson_date  : '';
    const studentRefs = Array.isArray(context?.student_refs) ? (context.student_refs as unknown[]) : [];
    const students    = Array.isArray(context?.students)     ? (context.students    as unknown[]) : [];

    // ── 6. context 필수값 검증 ───────────────────────────────────────────────
    if (!poolId.trim()) {
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'context.pool_id is required.', retryable: false },
      });
      return;
    }

    if (!classId.trim()) {
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'context.class_id is required.', retryable: false },
      });
      return;
    }

    if (!lessonDate.trim()) {
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'context.lesson_date is required.', retryable: false },
      });
      return;
    }

    // ── 7. parser_v1 Tenant 격리 ─────────────────────────────────────────────
    // JWT poolId가 없거나 context.pool_id와 불일치하면 403
    if (effectiveMode === 'parser_v1') {
      const jwtPoolId = req.user?.poolId;

      if (!jwtPoolId) {
        console.warn(`[AI/diary:${internalId}] tenant_isolation_fail: jwt_pool_id=null mode=parser_v1 ext_id=${externalRequestId}`);
        res.status(403).json({
          contract_version: '1.0',
          request_id:       externalRequestId,
          schema_version:   '1.0',
          feature:          'teacher_diary',
          status:           'failed',
          error: { code: 'TENANT_MISMATCH', message: '수영장 인증 정보가 없습니다.', retryable: false },
        });
        return;
      }

      if (jwtPoolId !== poolId) {
        console.warn(`[AI/diary:${internalId}] tenant_isolation_fail: pool_mismatch mode=parser_v1 ext_id=${externalRequestId}`);
        res.status(403).json({
          contract_version: '1.0',
          request_id:       externalRequestId,
          schema_version:   '1.0',
          feature:          'teacher_diary',
          status:           'failed',
          error: { code: 'TENANT_MISMATCH', message: '수영장 정보가 일치하지 않습니다.', retryable: false },
        });
        return;
      }
    }

    // ── 8. 학생 배열 구조 검증 ───────────────────────────────────────────────
    const normalizedStudents: { ref: string; name: string }[] = [];

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      if (typeof s !== 'object' || s === null) {
        res.status(400).json({
          request_id:     externalRequestId,
          schema_version: '1.0',
          feature:        'teacher_diary',
          status:         'failed',
          error: { code: 'INVALID_REQUEST', message: 'Invalid teacher diary request.', retryable: false },
        });
        return;
      }
      const student = s as Record<string, unknown>;
      if (typeof student.ref !== 'string' || !student.ref.trim()) {
        res.status(400).json({
          request_id:     externalRequestId,
          schema_version: '1.0',
          feature:        'teacher_diary',
          status:         'failed',
          error: { code: 'INVALID_REQUEST', message: 'Invalid teacher diary request.', retryable: false },
        });
        return;
      }
      if (typeof student.name !== 'string' || !student.name.trim()) {
        res.status(400).json({
          request_id:     externalRequestId,
          schema_version: '1.0',
          feature:        'teacher_diary',
          status:         'failed',
          error: { code: 'INVALID_REQUEST', message: 'Invalid teacher diary request.', retryable: false },
        });
        return;
      }
      normalizedStudents.push({ ref: student.ref.trim(), name: student.name.trim() });
    }

    // ── 9. student_refs ↔ students[].ref 일치 검증 ──────────────────────────
    const normalizedRefs = normalizedStudents.map(s => s.ref);
    const refsMatch =
      studentRefs.length === normalizedRefs.length &&
      studentRefs.every((ref, idx) => ref === normalizedRefs[idx]);

    if (!refsMatch) {
      res.status(400).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'INVALID_REQUEST', message: 'Invalid teacher diary request.', retryable: false },
      });
      return;
    }

    // ── 10. parser_v1 STUDENT_RESOLUTION_REQUIRED ────────────────────────────
    // parser_v1에서 students가 비어 있으면 생성 차단
    if (effectiveMode === 'parser_v1' && normalizedStudents.length === 0) {
      console.warn(`[AI/diary:${internalId}] student_resolution_required: no students mode=parser_v1 ext_id=${externalRequestId}`);
      res.status(422).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: 'STUDENT_RESOLUTION_REQUIRED', message: '학생 정보를 확인할 수 없습니다.', retryable: false },
      });
      return;
    }

    // ── 검증 완료 — LLM 호출 ─────────────────────────────────────────────────
    console.log(`[AI/diary:${internalId}] ext_id=${externalRequestId} student_count=${normalizedStudents.length} mode=${effectiveMode} timeout_ms=${gptTimeoutMs}`);

    try {
      const client = getOpenAI();

      const studentListText = normalizedStudents.length > 0
        ? `수업 참여 학생 (${normalizedStudents.length}명): ${normalizedStudents.map(s => `${s.name}(ref:${s.ref})`).join(', ')}`
        : '(수업 참여 학생 정보 없음 — students 배열이 빈 배열이면 common만 작성)';

      const systemPrompt = `당신은 수영 강사를 위한 AI 수업 일지 작성 도우미입니다.
강사가 제공하는 수업 메모를 바탕으로 자연스럽고 전문적인 수영 수업 일지를 작성합니다.

[응답 규칙]
- 반드시 JSON 형식으로만 응답합니다. 마크다운이나 다른 텍스트를 포함하지 않습니다.
- common: 모든 학생에게 공통으로 보이는 수업 일지입니다.
  - 100자 이상 300자 이내로 작성합니다.
  - 자연스럽고 따뜻한 한국어로 작성합니다.
  - 수영 수업 특성(발차기, 호흡, 자세, 턴, 스트로크 등)을 적절히 반영합니다.
- students: 개별 학생 메모 배열입니다.
  - 강사의 입력에 특정 학생에 대한 언급이 있을 때만 포함합니다.
  - 개별 언급이 없으면 반드시 빈 배열([])을 반환합니다.
  - 학생 메모는 50자 이상 120자 이내로 작성합니다.
  - students에는 학생별로 실제 작성할 내용이 있는 학생만 포함한다.
  - 내용이 없는 학생은 students 배열에 포함하지 않는다.
  - student_ref는 제공된 학생 목록의 ref 중 하나만 그대로 사용한다. 목록에 없는 ref는 절대 사용하지 않는다.
  - 같은 student_ref를 두 번 이상 반환하지 않는다.

[응답 형식]
{"common":"...","students":[{"student_ref":"...","content":"..."}]}`;

      const lines: string[] = [];
      lines.push(`수업 날짜: ${lessonDate}`);
      lines.push(studentListText);
      lines.push(`\n강사 수업 메모:\n${normalizedInputText}`);
      lines.push('\n위 내용을 바탕으로 수업 일지를 JSON으로 작성해주세요.');
      const userPrompt = lines.join('\n');

      // ── AbortController로 timeout 적용 ─────────────────────────────────────
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), gptTimeoutMs);

      let completion: Awaited<ReturnType<OpenAI['chat']['completions']['create']>>;
      try {
        completion = await client.chat.completions.create(
          {
            model:           'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt   },
            ],
            response_format: { type: 'json_object' },
            temperature:     0.7,
            max_tokens:      1000,
          },
          { signal: controller.signal },
        );
        clearTimeout(timer);
      } catch (e: any) {
        clearTimeout(timer);
        // AbortController 신호 또는 OpenAI AbortError
        if (controller.signal.aborted || e?.name === 'AbortError' || String(e?.message ?? '').toLowerCase().includes('aborted')) {
          throw new ModelTimeoutError();
        }
        throw e;
      }

      const rawContent = completion.choices[0]?.message?.content ?? '{}';
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        throw new Error('GPT 응답 JSON 파싱 실패');
      }

      const allowedStudentRefs = new Set(normalizedStudents.map(s => s.ref));
      const legacyFallbackCount = countLegacyStudentIdFallback(parsed, allowedStudentRefs);
      const validatedOutput = validateDiaryOutput(parsed, allowedStudentRefs);

      const usage     = completion.usage;
      const elapsedMs = Date.now() - startMs;

      logDiaryStructured({
        internal_id:         internalId,
        external_request_id: externalRequestId,
        feature_flag:        effectiveMode,
        engine_version:      'v1',
        prompt_version:      'p1',
        validator_result:    'pass',
        latency_ms:          elapsedMs,
        pool_id_hash:        poolId ? hashPoolId(poolId) : undefined,
      });

      console.log(
        `[AI/diary:${internalId}] ext_id=${externalRequestId}` +
        ` elapsed=${elapsedMs}ms tokens=${usage?.total_tokens ?? 0}` +
        ` students_out=${validatedOutput.students.length}` +
        ` mode=${effectiveMode}` +
        (legacyFallbackCount > 0 ? ` legacy_student_id_used=${legacyFallbackCount}` : ''),
      );

      res.status(200).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        engine_version:   'v1',
        feature:          'teacher_diary',
        result: {
          common:   validatedOutput.common,
          students: validatedOutput.students,
        },
        meta:  {},
        usage: {
          input_tokens:  usage?.prompt_tokens     ?? 0,
          output_tokens: usage?.completion_tokens ?? 0,
          total_tokens:  usage?.total_tokens      ?? 0,
        },
      });

    } catch (e: any) {
      const elapsedMs = Date.now() - startMs;

      // ── MODEL_TIMEOUT → 504 ───────────────────────────────────────────────
      if (e instanceof ModelTimeoutError) {
        logDiaryStructured({
          internal_id:         internalId,
          external_request_id: externalRequestId,
          feature_flag:        effectiveMode,
          engine_version:      'v1',
          prompt_version:      'p1',
          validator_result:    'timeout',
          error_code:          'MODEL_TIMEOUT',
          latency_ms:          elapsedMs,
          pool_id_hash:        poolId ? hashPoolId(poolId) : undefined,
        });
        console.error(`[AI/diary:${internalId}] MODEL_TIMEOUT ext_id=${externalRequestId} elapsed=${elapsedMs}ms timeout_ms=${gptTimeoutMs}`);
        res.status(504).json({
          contract_version: '1.0',
          request_id:       externalRequestId,
          schema_version:   '1.0',
          engine_version:   'v1',
          feature:          'teacher_diary',
          status:           'failed',
          error: { code: 'MODEL_TIMEOUT', message: 'Teacher diary generation timed out.', retryable: true },
        });
        return;
      }

      // ── OutputValidationError → 500 ───────────────────────────────────────
      if (e instanceof OutputValidationError) {
        logDiaryStructured({
          internal_id:         internalId,
          external_request_id: externalRequestId,
          feature_flag:        effectiveMode,
          engine_version:      'v1',
          prompt_version:      'p1',
          validator_result:    `fail:${e.reason}`,
          error_code:          'OUTPUT_VALIDATION_FAILED',
          latency_ms:          elapsedMs,
          pool_id_hash:        poolId ? hashPoolId(poolId) : undefined,
        });
        console.error('[AI/diary]', {
          internal_id:         internalId,
          external_request_id: externalRequestId,
          code:                'OUTPUT_VALIDATION_FAILED',
          reason:              e.reason,
          ...(e.studentIndex !== undefined && { student_index: e.studentIndex }),
          elapsed_ms:          elapsedMs,
        });
        res.status(500).json({
          contract_version: '1.0',
          request_id:       externalRequestId,
          schema_version:   '1.0',
          engine_version:   'v1',
          feature:          'teacher_diary',
          status:           'failed',
          error: { code: 'OUTPUT_VALIDATION_FAILED', message: 'Teacher diary output validation failed.', retryable: false },
        });
        return;
      }

      // ── 일반 오류 ─────────────────────────────────────────────────────────
      const safeMsg = String(e?.message ?? '').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
      logDiaryStructured({
        internal_id:         internalId,
        external_request_id: externalRequestId,
        feature_flag:        effectiveMode,
        engine_version:      'v1',
        prompt_version:      'p1',
        validator_result:    'error',
        error_code:          e?.code ?? 'INTERNAL_ERROR',
        latency_ms:          elapsedMs,
        pool_id_hash:        poolId ? hashPoolId(poolId) : undefined,
      });
      console.error(`[AI/diary:${internalId}] ext_id=${externalRequestId} elapsed=${elapsedMs}ms status=${e?.status ?? 500} msg=${safeMsg}`);
      const retryable = !e?.status || e.status >= 500 || e.status === 429;
      res.status(e?.status ?? 500).json({
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        engine_version:   'v1',
        feature:          'teacher_diary',
        status:           'failed',
        error: { code: e?.code ?? 'INTERNAL_ERROR', message: 'Teacher diary generation failed.', retryable },
      });
    }
  },
);

export default router;
