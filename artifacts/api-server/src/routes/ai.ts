/**
 * AI Routes — SwimNote API Server
 *
 * POST /ai/whisper/transcribe — 음성 파일 → Whisper STT → transcript 반환
 * POST /ai/transcribe         — 구 경로 (하위 호환 유지)
 * POST /ai/diary/generate     — 수업 입력 → GPT → 일지 생성
 *
 * Response Contract (success):
 *   { request_id, schema_version, feature, result, usage }
 * Error Contract:
 *   { request_id, error: { code, message, retryable } }
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

// ── 공통: request_id 생성 ─────────────────────────────────────────────────────
function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Whisper STT 내부 핸들러 (두 경로에서 공유) ────────────────────────────────
async function handleWhisper(req: Request, res: Response): Promise<void> {
  const requestId = newRequestId();
  const startMs   = Date.now();
  const file = req.file;

  if (!file) {
    res.status(400).json({
      request_id: requestId,
      error: { code: 'NO_FILE', message: '음성 파일이 없습니다.', retryable: false },
    });
    return;
  }

  console.log(`[AI/whisper:${requestId}] 수신 size=${file.size}B mime=${file.mimetype}`);

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
    console.log(`[AI/whisper:${requestId}] 완료 elapsed=${elapsedMs}ms len=${transcript.length}chars`);

    res.json({ request_id: requestId, transcript });
  } catch (e: any) {
    const elapsedMs = Date.now() - startMs;
    const safeMsg   = String(e?.message ?? 'Whisper API 호출 실패').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
    console.error(`[AI/whisper:${requestId}] 오류 elapsed=${elapsedMs}ms status=${e?.status ?? 500} msg=${safeMsg}`);
    const retryable = !e?.status || e.status >= 500 || e.status === 429;
    res.status(e?.status ?? 500).json({
      request_id: requestId,
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

// ── POST /ai/diary/generate ───────────────────────────────────────────────────
/**
 * Request body:
 *   {
 *     teacher_id:       string,
 *     class_id:         string,
 *     lesson_date:      string,          // "YYYY-MM-DD"
 *     input_text:       string,          // 강사 입력 (텍스트 or STT 결과)
 *     students?:        { student_id: string, student_name: string }[],
 *     existing_content?: string,         // 이미 입력된 일지 (컨텍스트용)
 *   }
 *
 * Response (success):
 *   {
 *     request_id, schema_version: "1.0", feature: "teacher_diary",
 *     result: { common: string, students: { student_id, content }[] },
 *     usage:  { input_tokens, output_tokens, total_tokens }
 *   }
 */
router.post(
  '/ai/diary/generate',
  requireAuth as any,
  async (req: Request, res: Response): Promise<void> => {
    const requestId = newRequestId();
    const startMs   = Date.now();

    const {
      teacher_id,
      class_id,
      lesson_date,
      input_text,
      students    = [],
      existing_content,
    } = req.body ?? {};

    if (!input_text?.trim()) {
      res.status(400).json({
        request_id: requestId,
        error: { code: 'INVALID_INPUT', message: '수업 내용을 입력해주세요.', retryable: false },
      });
      return;
    }

    console.log(`[AI/diary:${requestId}] 요청 teacher=${teacher_id} class=${class_id} date=${lesson_date} students=${students.length}`);

    try {
      const client = getOpenAI();

      // ── 학생 목록 컨텍스트 ────────────────────────────────────────────────
      const studentListText = students.length > 0
        ? `수업 참여 학생 (${students.length}명): ${(students as any[]).map((s) => `${s.student_name}(id:${s.student_id})`).join(', ')}`
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
  - student_id는 제공된 학생 목록의 id를 그대로 사용합니다.

[응답 형식]
{"common":"...","students":[{"student_id":"...","content":"..."}]}`;

      // ── User Prompt ───────────────────────────────────────────────────────
      const lines: string[] = [];
      lines.push(`수업 날짜: ${lesson_date || '(날짜 미제공)'}`);
      lines.push(studentListText);
      if (existing_content?.trim()) {
        lines.push(`\n기존 작성된 일지 (참고용, 중복 내용 지양):\n${existing_content.trim()}`);
      }
      lines.push(`\n강사 수업 메모:\n${input_text.trim()}`);
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
        throw new Error(`GPT 응답 JSON 파싱 실패: ${rawContent.slice(0, 100)}`);
      }

      const usage = completion.usage;
      const elapsedMs = Date.now() - startMs;
      console.log(`[AI/diary:${requestId}] 완료 elapsed=${elapsedMs}ms tokens=${usage?.total_tokens ?? 0} students_out=${Array.isArray(parsed.students) ? parsed.students.length : 0}`);

      res.json({
        request_id:     requestId,
        schema_version: '1.0',
        feature:        'teacher_diary',
        result: {
          common:   String(parsed.common ?? ''),
          students: Array.isArray(parsed.students) ? parsed.students : [],
        },
        usage: {
          input_tokens:  usage?.prompt_tokens     ?? 0,
          output_tokens: usage?.completion_tokens ?? 0,
          total_tokens:  usage?.total_tokens      ?? 0,
        },
      });
    } catch (e: any) {
      const elapsedMs = Date.now() - startMs;
      const safeMsg   = String(e?.message ?? 'AI 일지 생성 실패').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
      console.error(`[AI/diary:${requestId}] 오류 elapsed=${elapsedMs}ms status=${e?.status ?? 500} msg=${safeMsg}`);
      const retryable = !e?.status || e.status >= 500 || e.status === 429;
      res.status(e?.status ?? 500).json({
        request_id: requestId,
        error: {
          code:      e?.code ?? 'AI_DIARY_ERROR',
          message:   'AI 일지 생성에 실패했습니다. 다시 시도해주세요.',
          retryable,
        },
      });
    }
  },
);

export default router;
