/**
 * AI Routes — SwimNote API Server
 * POST /api/ai/transcribe — 음성 파일 → Whisper STT → transcript 반환
 *
 * 흐름:
 *   Expo 앱 → multipart/form-data (audio file) → 이 엔드포인트
 *   → OpenAI Whisper API (model: whisper-1, language: ko)
 *   → { transcript: string } 반환
 *   → 앱에서 inputText에 자동 입력 (AI 자동 실행 없음)
 *
 * 인증: JWT 필요 (requireAuth 미들웨어)
 * 파일: multer memoryStorage (디스크 저장 없음, 바로 Whisper로 전달)
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

// ── OpenAI 클라이언트 (lazy init — API key 없으면 에러 로그) ──────────────────
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
    // MIME 우선 검사, 이후 확장자 보조 검사 (AND → OR, 단 둘 다 실패 시만 거부)
    // 실제 앱은 항상 audio/m4a 또는 audio/mpeg를 전송하므로 MIME으로만 통과됨
    const mimeOk = allowedMime.includes(file.mimetype);
    const extOk  = allowedExt.test(file.originalname);
    if (mimeOk || extOk) {
      cb(null, true);
    } else {
      cb(new Error(`지원하지 않는 오디오 형식입니다. mime=${file.mimetype}`));
    }
  },
});

// ── POST /ai/transcribe ───────────────────────────────────────────────────────

router.post(
  '/ai/transcribe',
  requireAuth as any,
  upload.single('audio') as any,
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: '음성 파일이 없습니다.' });
      return;
    }

    // ── 처리 시작 로그 (API Key / 개인정보 제외) ────────────────────────────
    const requestId = Math.random().toString(36).slice(2, 10);
    const startMs   = Date.now();
    console.log(`[AI/transcribe:${requestId}] 수신 size=${file.size}B mime=${file.mimetype}`);

    try {
      const client = getOpenAI();

      // Whisper API는 File 객체를 요구하므로 Buffer → Uint8Array → File 변환
      // (Node.js Buffer는 BlobPart에 직접 할당 불가 — Uint8Array 경유)
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

      const transcript   = transcription.text.trim();
      const elapsedMs    = Date.now() - startMs;
      // transcript 내용은 로그에 남기지 않음 — 길이만 기록
      console.log(`[AI/transcribe:${requestId}] 완료 elapsed=${elapsedMs}ms transcript_len=${transcript.length}chars`);

      res.json({ transcript });
    } catch (e: any) {
      const elapsedMs = Date.now() - startMs;
      // 에러 메시지에서 API Key가 포함된 경우 제거 (OpenAI SDK는 key를 노출하지 않으나 예방)
      const safeMsg = String(e?.message ?? 'Whisper API 호출 실패').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
      console.error(`[AI/transcribe:${requestId}] 오류 elapsed=${elapsedMs}ms status=${e?.status ?? 500} msg=${safeMsg}`);
      const status = e?.status ?? 500;
      res.status(status).json({ error: safeMsg });
    }
  },
);

export default router;
