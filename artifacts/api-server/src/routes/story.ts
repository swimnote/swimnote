/**
 * story.ts — Instagram Story 요약 API
 *
 * POST /diaries/:diaryId/story-summary
 *
 * 목적:
 *   저장된 일지 원문을 Instagram Story용 짧은 요약문으로 변환.
 *   긴 일지에서만 클라이언트가 호출 (fit 판정 후 필요 시만).
 *
 * 요약 규칙:
 *   - 원문에 존재하는 사실만 사용
 *   - 새로운 수영 지식 / 평가 / 칭찬 / 다음 계획 추가 금지
 *   - 학부모 자녀 범위의 개인 피드백만 포함
 *   - max_lines 이내 완성 문장 (줄임표 금지)
 *
 * 학부모 visibility 보장:
 *   - parent_account: student_class_history 기준 연결 학생만 조회
 *   - 다른 학생 개인정보 혼입 구조적 차단 (DB JOIN 레벨)
 *   - teacher / pool_admin / super_admin: pool 소속 확인 후 common_content만 사용
 */

import { Router }                         from 'express';
import OpenAI                             from 'openai';
import { requireAuth, type AuthRequest }  from '../middlewares/auth.js';
import { db, superAdminDb }               from '@workspace/db';
import { sql }                            from 'drizzle-orm';

const router = Router();

// ── OpenAI 클라이언트 (lazy, shared) ─────────────────────────────────────────
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 미설정');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

async function getPoolId(userId: string): Promise<string | null> {
  const r = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1`);
  return (r.rows[0] as any)?.swimming_pool_id ?? null;
}

// ── POST /diaries/:diaryId/story-summary ─────────────────────────────────────
router.post(
  '/diaries/:diaryId/story-summary',
  requireAuth as any,
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const { userId, role } = req.user!;
      const diaryId  = req.params.diaryId;
      const maxLines = Math.max(1, Math.min(30, Number(req.body?.max_lines) || 8));

      // ── 1. 일지 기본 정보 조회 ─────────────────────────────────────────────
      const diaryRow = await db.execute(sql`
        SELECT id, common_content, class_group_id, swimming_pool_id, lesson_date
        FROM class_diaries
        WHERE id = ${diaryId} AND is_deleted = false
        LIMIT 1
      `);
      const diary = diaryRow.rows[0] as any;
      if (!diary) { res.status(404).json({ error: 'diary_not_found' }); return; }

      // ── 2. 접근 권한 확인 + visibility-safe 텍스트 구성 ───────────────────
      let studentNoteContent: string | null = null;

      if (role === 'parent_account') {
        // 학부모: student_class_history 기준으로 연결 학생 확인
        // (enrolled_at ≤ lesson_date < left_at 범위의 학생만 접근 허용)
        const accessRows = await db.execute(sql`
          SELECT ps.student_id
          FROM parent_accounts pa
          JOIN parent_students ps ON ps.parent_id = pa.id
          JOIN student_class_history sch
            ON sch.student_id = ps.student_id
           AND sch.class_group_id = ${diary.class_group_id}
           AND sch.enrolled_at::date <= ${diary.lesson_date}::date
           AND (sch.left_at IS NULL OR sch.left_at::date > ${diary.lesson_date}::date)
          WHERE pa.id = ${userId}
          LIMIT 5
        `);
        if (accessRows.rows.length === 0) {
          res.status(403).json({ error: 'access_denied' }); return;
        }
        const studentIds = (accessRows.rows as any[]).map(r => String(r.student_id));

        // 해당 학부모 자녀의 개인 일지만 조회 (다른 학생 개인정보 혼입 구조적 차단)
        const noteRow = await db.execute(sql`
          SELECT note_content FROM class_diary_student_notes
          WHERE diary_id   = ${diaryId}
            AND student_id = ANY(${studentIds}::text[])
            AND is_deleted = false
          LIMIT 1
        `);
        studentNoteContent = (noteRow.rows[0] as any)?.note_content ?? null;

      } else if (role === 'super_admin') {
        // super_admin: pool 무관 접근 — common_content만 사용 (학생 개인정보 제외)
      } else {
        // teacher / pool_admin: pool 소속 확인
        const poolId = await getPoolId(userId);
        if (!poolId || diary.swimming_pool_id !== poolId) {
          res.status(403).json({ error: 'access_denied' }); return;
        }
        // teacher/pool_admin은 common_content만 사용 (학생별 정보 미포함)
      }

      // ── 3. 본문 구성 ───────────────────────────────────────────────────────
      const parts = [
        (diary.common_content as string | null)?.trim(),
        studentNoteContent?.trim(),
      ].filter(Boolean);
      const fullText = parts.join('\n\n');

      if (!fullText) { res.status(400).json({ error: 'empty_content' }); return; }

      // ── 4. OpenAI 요약 호출 ────────────────────────────────────────────────
      const openai     = getOpenAI();
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), 25_000);

      const prompt =
`당신은 수영 수업 일지를 Instagram Story용으로 요약하는 도우미입니다.

규칙:
- 원문에 존재하는 사실만 사용한다
- 새로운 수영 지식, 평가, 칭찬, 다음 계획을 원문에 없는 경우 절대 추가하지 않는다
- 의미를 왜곡하지 않는다
- 핵심 수업 내용 우선, 개인 피드백이 있으면 핵심 1~2개 유지
- 광고 문구 금지
- ${maxLines}줄 이내의 짧은 문단 (한 줄 ≈ 한국어 25자)
- 줄임표("...") 없이 완성된 문장으로 끝낼 것

원문:
${fullText}

요약:`;

      let summary: string;
      try {
        const completion = await openai.chat.completions.create(
          {
            model:       'gpt-4o-mini',
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  300,
          },
          { signal: controller.signal },
        );
        clearTimeout(timer);
        summary = completion.choices[0]?.message?.content?.trim() ?? '';
        if (!summary) throw new Error('empty_response');
      } catch (e: any) {
        clearTimeout(timer);
        // 비개인정보 로그만 (원문/학생명/JWT 로그 금지)
        console.error(
          `[story-summary] OpenAI error` +
          ` diaryId=...${diaryId.slice(-8)}` +
          ` msg=${String(e?.message ?? 'unknown').slice(0, 80)}`
        );
        res.status(500).json({ error: 'summary_failed' }); return;
      }

      res.json({ summary });
    } catch (e) {
      console.error('[story-summary] server error:', e);
      res.status(500).json({ error: 'server_error' });
    }
  },
);

export default router;
