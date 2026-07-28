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
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// ── OpenAI 클라이언트 (lazy init) ─────────────────────────────────────────────
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
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

// ── 내부 추적용 ID 생성 (로그·서버 내부 전용, 외부 응답에 사용 금지) ─────────
function newInternalRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── 외부 request_id 검증 ─────────────────────────────────────────────────────
function isValidExternalRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 128
  );
}

// ── Whisper STT 내부 핸들러 (두 경로에서 공유) ────────────────────────────────
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

// ── POST /ai/whisper/transcribe (신규 경로) ───────────────────────────────────
router.post(
  '/ai/whisper/transcribe',
  requireAuth as any,
  upload.single('audio') as any,
  handleWhisper,
);

// ── POST /ai/transcribe (구 경로 — 하위 호환) ─────────────────────────────────
router.post(
  '/ai/transcribe',
  requireAuth as any,
  upload.single('audio') as any,
  handleWhisper,
);

// ── POST /ai/diary/generate (E1 Contract) ────────────────────────────────────
/**
 * E1 Request body:
 *   {
 *     request_id:     string,           // 앱이 생성한 외부 ID (echo됨)
 *     schema_version: "1.0",
 *     feature:        "teacher_diary",
 *     locale?:        string,
 *     input: {
 *       text: string,                   // 강사 입력 (텍스트 or STT 결과)
 *     },
 *     context: {
 *       pool_id:      string,           // 수영장 ID (필수)
 *       class_id:     string,           // 반 ID (필수)
 *       lesson_date:  string,           // "YYYY-MM-DD" (필수)
 *       student_refs: string[],         // 학생 ref 배열
 *       students:     { ref: string, name: string }[],
 *     },
 *   }
 *
 * E1 Response (success):
 *   {
 *     request_id,          // 요청 request_id 그대로 echo
 *     schema_version: "1.0",
 *     feature: "teacher_diary",
 *     result: { common: string, students: { student_ref, content }[] },
 *     usage:  { input_tokens, output_tokens, total_tokens }
 *   }
 *
 * E1 Error:
 *   {
 *     request_id,          // 요청 request_id 그대로 echo (null if request_id invalid)
 *     schema_version: "1.0",
 *     feature: "teacher_diary",
 *     status: "failed",
 *     error: { code, message, retryable }
 *   }
 */
router.post(
  '/ai/diary/generate',
  requireAuth as any,
  async (req: Request, res: Response): Promise<void> => {
    // ── 내부 추적 ID (로그 전용, 외부 응답에 사용 금지) ─────────────────────
    const internalId = newInternalRequestId();
    const startMs    = Date.now();

    const rawBody = req.body ?? {};

    // ── 1. 외부 request_id 수신 및 검증 ─────────────────────────────────────
    const externalRequestId = rawBody.request_id;

    if (!isValidExternalRequestId(externalRequestId)) {
      console.warn(`[AI/diary:${internalId}] invalid_request_id`);
      res.status(400).json({
        request_id:     null,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'request_id is required.',
          retryable: false,
        },
      });
      return;
    }

    // request_id 검증 통과 — 이후 모든 오류 응답에 externalRequestId 사용

    // ── 2. schema_version 검증 ──────────────────────────────────────────────
    if (rawBody.schema_version !== '1.0') {
      console.warn(`[AI/diary:${internalId}] invalid_schema_version ext_id=${externalRequestId}`);
      res.status(400).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'Invalid teacher diary request.',
          retryable: false,
        },
      });
      return;
    }

    // ── 3. feature 검증 ─────────────────────────────────────────────────────
    if (rawBody.feature !== 'teacher_diary') {
      console.warn(`[AI/diary:${internalId}] invalid_feature ext_id=${externalRequestId}`);
      res.status(400).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'Invalid teacher diary request.',
          retryable: false,
        },
      });
      return;
    }

    // ── 4. input.text 파싱 및 검증 ──────────────────────────────────────────
    const input = rawBody.input;
    const inputText = typeof input?.text === 'string' ? input.text : '';
    const normalizedInputText = inputText.trim();

    if (!normalizedInputText) {
      console.warn(`[AI/diary:${internalId}] invalid_input_text ext_id=${externalRequestId}`);
      res.status(400).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'Invalid teacher diary request.',
          retryable: false,
        },
      });
      return;
    }

    // ── 5. context 파싱 ─────────────────────────────────────────────────────
    const context = rawBody.context;

    const poolId      = typeof context?.pool_id      === 'string' ? context.pool_id      : '';
    const classId     = typeof context?.class_id     === 'string' ? context.class_id     : '';
    const lessonDate  = typeof context?.lesson_date  === 'string' ? context.lesson_date  : '';
    const studentRefs = Array.isArray(context?.student_refs) ? (context.student_refs as unknown[]) : [];
    const students    = Array.isArray(context?.students)     ? (context.students    as unknown[]) : [];

    // ── 6. context 필수값 검증 ──────────────────────────────────────────────
    if (!poolId.trim()) {
      console.warn(`[AI/diary:${internalId}] missing_pool_id ext_id=${externalRequestId}`);
      res.status(400).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'context.pool_id is required.',
          retryable: false,
        },
      });
      return;
    }

    if (!classId.trim()) {
      console.warn(`[AI/diary:${internalId}] missing_class_id ext_id=${externalRequestId}`);
      res.status(400).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'context.class_id is required.',
          retryable: false,
        },
      });
      return;
    }

    if (!lessonDate.trim()) {
      console.warn(`[AI/diary:${internalId}] missing_lesson_date ext_id=${externalRequestId}`);
      res.status(400).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'context.lesson_date is required.',
          retryable: false,
        },
      });
      return;
    }

    // ── 7. 학생 배열 구조 검증 ──────────────────────────────────────────────
    const normalizedStudents: { ref: string; name: string }[] = [];

    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      if (typeof s !== 'object' || s === null) {
        console.warn(`[AI/diary:${internalId}] invalid_student_structure index=${i} ext_id=${externalRequestId}`);
        res.status(400).json({
          request_id:     externalRequestId,
          schema_version: '1.0',
          feature:        'teacher_diary',
          status:         'failed',
          error: {
            code:      'INVALID_REQUEST',
            message:   'Invalid teacher diary request.',
            retryable: false,
          },
        });
        return;
      }
      const student = s as Record<string, unknown>;
      if (typeof student.ref !== 'string' || !student.ref.trim()) {
        console.warn(`[AI/diary:${internalId}] invalid_student_ref index=${i} ext_id=${externalRequestId}`);
        res.status(400).json({
          request_id:     externalRequestId,
          schema_version: '1.0',
          feature:        'teacher_diary',
          status:         'failed',
          error: {
            code:      'INVALID_REQUEST',
            message:   'Invalid teacher diary request.',
            retryable: false,
          },
        });
        return;
      }
      if (typeof student.name !== 'string' || !student.name.trim()) {
        console.warn(`[AI/diary:${internalId}] invalid_student_name index=${i} ext_id=${externalRequestId}`);
        res.status(400).json({
          request_id:     externalRequestId,
          schema_version: '1.0',
          feature:        'teacher_diary',
          status:         'failed',
          error: {
            code:      'INVALID_REQUEST',
            message:   'Invalid teacher diary request.',
            retryable: false,
          },
        });
        return;
      }
      normalizedStudents.push({ ref: student.ref, name: student.name });
    }

    // ── 8. student_refs와 students[].ref 일치 검증 ──────────────────────────
    const normalizedRefs = normalizedStudents.map(s => s.ref);
    const refsMatch =
      studentRefs.length === normalizedRefs.length &&
      studentRefs.every((ref, idx) => ref === normalizedRefs[idx]);

    if (!refsMatch) {
      console.warn(`[AI/diary:${internalId}] student_refs_mismatch refs_count=${studentRefs.length} students_count=${normalizedStudents.length} ext_id=${externalRequestId}`);
      res.status(400).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      'INVALID_REQUEST',
          message:   'Invalid teacher diary request.',
          retryable: false,
        },
      });
      return;
    }

    // ── 검증 완료 — LLM 호출 ─────────────────────────────────────────────────
    console.log(`[AI/diary:${internalId}] ext_id=${externalRequestId} student_count=${normalizedStudents.length}`);

    try {
      const client = getOpenAI();

      // ── 학생 목록 컨텍스트 (student_ref 사용) ─────────────────────────────
      const studentListText = normalizedStudents.length > 0
        ? `수업 참여 학생 (${normalizedStudents.length}명): ${normalizedStudents.map(s => `${s.name}(ref:${s.ref})`).join(', ')}`
        : '(수업 참여 학생 정보 없음 — students 배열이 빈 배열이면 common만 작성)';

      // ── System Prompt ─────────────────────────────────────────────────────
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
  - student_ref는 제공된 학생 목록의 ref를 그대로 사용합니다.

[응답 형식]
{"common":"...","students":[{"student_ref":"...","content":"..."}]}`;

      // ── User Prompt ───────────────────────────────────────────────────────
      const lines: string[] = [];
      lines.push(`수업 날짜: ${lessonDate}`);
      lines.push(studentListText);
      lines.push(`\n강사 수업 메모:\n${normalizedInputText}`);
      lines.push('\n위 내용을 바탕으로 수업 일지를 JSON으로 작성해주세요.');
      const userPrompt = lines.join('\n');

      // ── GPT 호출 ─────────────────────────────────────────────────────────
      const completion = await client.chat.completions.create({
        model:           'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        response_format: { type: 'json_object' },
        temperature:     0.7,
        max_tokens:      1000,
      });

      const rawContent = completion.choices[0]?.message?.content ?? '{}';
      let parsed: any;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        throw new Error('GPT 응답 JSON 파싱 실패');
      }

      // ── 학생 결과 정규화 — student_ref 표준 필드 사용 ─────────────────────
      // GPT가 student_ref를 반환하지만, 만약 student_id를 반환할 경우를 위한 fallback
      const rawStudents: unknown[] = Array.isArray(parsed.students) ? parsed.students : [];
      const studentResults = rawStudents
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map(s => ({
          student_ref: typeof s.student_ref === 'string' && s.student_ref
            ? s.student_ref
            : typeof s.student_id  === 'string' && s.student_id
              ? s.student_id
              : '',
          content: typeof s.content === 'string' ? s.content : '',
        }))
        .filter(s => s.student_ref !== '');

      const usage = completion.usage;
      const elapsedMs = Date.now() - startMs;
      console.log(`[AI/diary:${internalId}] ext_id=${externalRequestId} elapsed=${elapsedMs}ms tokens=${usage?.total_tokens ?? 0} students_out=${studentResults.length}`);

      res.status(200).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        result: {
          common:   String(parsed.common ?? ''),
          students: studentResults,
        },
        usage: {
          input_tokens:  usage?.prompt_tokens     ?? 0,
          output_tokens: usage?.completion_tokens ?? 0,
          total_tokens:  usage?.total_tokens      ?? 0,
        },
      });
    } catch (e: any) {
      const elapsedMs = Date.now() - startMs;
      const safeMsg   = String(e?.message ?? '').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
      console.error(`[AI/diary:${internalId}] ext_id=${externalRequestId} elapsed=${elapsedMs}ms status=${e?.status ?? 500} msg=${safeMsg}`);
      const retryable = !e?.status || e.status >= 500 || e.status === 429;
      res.status(e?.status ?? 500).json({
        request_id:     externalRequestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        status:         'failed',
        error: {
          code:      e?.code ?? 'INTERNAL_ERROR',
          message:   'Teacher diary generation failed.',
          retryable,
        },
      });
    }
  },
);

export default router;
