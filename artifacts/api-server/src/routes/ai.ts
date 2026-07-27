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
    const allowed = ['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/wav',
                     'audio/webm', 'audio/x-m4a', 'video/mp4'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(m4a|mp4|mp3|wav|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`지원하지 않는 오디오 형식입니다: ${file.mimetype}`));
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

    console.log(`[AI/transcribe] 수신: ${file.originalname} size=${file.size}bytes mime=${file.mimetype}`);

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

      const transcript = transcription.text.trim();
      console.log(`[AI/transcribe] 완료: "${transcript.slice(0, 50)}${transcript.length > 50 ? '...' : ''}"`);

      res.json({ transcript });
    } catch (e: any) {
      console.error('[AI/transcribe] Whisper API 오류:', e?.message ?? e);
      const status  = e?.status ?? 500;
      const message = e?.message ?? 'Whisper API 호출 실패';
      res.status(status).json({ error: message });
    }
  },
);

export default router;
