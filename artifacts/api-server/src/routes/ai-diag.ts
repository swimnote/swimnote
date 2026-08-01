/**
 * POST /api/ai/diary/diagnose
 *
 * 앱 AI 진단 로그 수신 엔드포인트.
 * 인증 불필요 (진단 데이터는 PII 제외 설계).
 * 수신된 데이터를 stdout에 출력 → Render.com 로그에서 확인.
 */
import { Router, type Request, type Response } from 'express';

const router = Router();

const ALLOWED_KEYS = new Set([
  'ts', 'request_id', 'pipeline_mode',
  'endpoint_host', 'endpoint_path',
  'http_status', 'content_type_raw',
  'client_reason', 'cause_code',
  'response_keys', 'response_preview',
  'contract_version', 'schema_version', 'engine_version',
  'has_result', 'common_type', 'students_type',
]);

router.post('/ai/diary/diagnose', (req: Request, res: Response) => {
  try {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const key of ALLOWED_KEYS) {
      if (key in payload) safe[key] = payload[key];
    }
    console.log('[AI-DIAG]', JSON.stringify(safe));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

export default router;
