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
import { saveAiTrace }                    from '../lib/ai-trace-service.js';
import { AI_FEATURE }                     from '../lib/ai-feature-enum.js';
import { AI_MODEL }                       from '../config/ai-model-config.js';

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
      // max_chars: 서버 자체 상한 1000자, 클라이언트 미전송 시 maxLines×25로 fallback
      const maxChars = Math.max(50, Math.min(1000, Number(req.body?.max_chars) || maxLines * 25));

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
        // parent.ts의 실제 diary visibility 정책과 동일:
        // 날짜 범위 비교 없이 해당 반 이력(ALL-TIME) 존재 여부만 확인.
        // (반 이동 후 과거 반 일지도 접근 허용 — parent.ts line 569-576 참조)
        const accessRows = await db.execute(sql`
          SELECT ps.student_id
          FROM parent_accounts pa
          JOIN parent_students ps ON ps.parent_id = pa.id
          JOIN student_class_history sch
            ON sch.student_id = ps.student_id
           AND sch.class_group_id = ${diary.class_group_id}
          WHERE pa.id = ${userId}
          LIMIT 5
        `);
        if (accessRows.rows.length === 0) {
          res.status(403).json({ error: 'access_denied' }); return;
        }
        const studentIds = (accessRows.rows as any[]).map(r => String(r.student_id));

        // 해당 학부모 자녀의 개인 일지만 조회 (다른 학생 개인정보 혼입 구조적 차단)
        // ANY(${array}::text[]) 대신 IN (...) 사용:
        // Drizzle sql 태그에 JS 배열을 직접 보간하면 ($1,$2) ROW 타입으로 직렬화되어
        // ANY()와 충돌, SQL ERROR 발생. sql.join()으로 개별 파라미터 바인딩.
        if (studentIds.length > 0) {
          const noteRow = await db.execute(sql`
            SELECT note_content FROM class_diary_student_notes
            WHERE diary_id   = ${diaryId}
              AND student_id IN (${sql.join(studentIds.map(id => sql`${id}`), sql`, `)})
              AND is_deleted = false
            LIMIT 1
          `);
          studentNoteContent = (noteRow.rows[0] as any)?.note_content ?? null;
        }

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

      // CS-PA1: 계측용 trace 변수 (provider call 토큰 누계)
      const storyStartMs  = Date.now();
      const storyTraceId  = `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let firstCallTokens: { prompt: number; completion: number; total: number } | null = null;
      let retryCallTokens: { prompt: number; completion: number; total: number } | null = null;

      // V3: 자상한 선생님 한마디 스타일 — 50~90자 목표
      const prompt =
`당신은 수영 선생님이 학부모에게 오늘 수업을 짧게 전하는 한마디를 적는 도우미입니다.

규칙:
- 반드시 ${maxChars}자 이내 (공백 포함 전체 글자 수 기준)
- 원문에 실제 존재하는 사실만 사용한다
- 원문에 없는 성취, 칭찬, 성장, 향상, 다음 계획을 만들지 않는다
- 수영 전문지식을 새로 추가하지 않는다
- 자상하고 자연스러운 존댓말 — 선생님이 직접 학부모에게 전하는 느낌
- 따뜻하지만 과장하지 않는다
- 보고서체, 업무보고체, 평가표 말투, 광고문구, 기계적 AI 요약체 금지
- 이모지 추가 금지
- 줄임표("...") 없이 완성된 문장으로 끝낼 것
- 2~3줄 분량이 자연스럽다
- 부정적 내용은 숨기지 않되, 부드럽고 발전적인 표현으로 전달한다

원문:
${fullText}

한줄평:`;

      let summary: string;
      try {
        const completion = await openai.chat.completions.create(
          {
            model:       AI_MODEL.STORY,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  400,
          },
          { signal: controller.signal },
        );
        clearTimeout(timer);
        summary = completion.choices[0]?.message?.content?.trim() ?? '';
        if (!summary) throw new Error('empty_response');
        // CS-PA1: 1차 call 토큰 캡처
        if (completion.usage) {
          firstCallTokens = {
            prompt:     completion.usage.prompt_tokens     ?? 0,
            completion: completion.usage.completion_tokens ?? 0,
            total:      completion.usage.total_tokens      ?? 0,
          };
        }
      } catch (e: any) {
        clearTimeout(timer);
        // 비개인정보 로그만 (원문/학생명/JWT 로그 금지)
        console.error(
          `[story-summary] OpenAI error` +
          ` diaryId=...${diaryId.slice(-8)}` +
          ` msg=${String(e?.message ?? 'unknown').slice(0, 80)}`
        );
        void saveAiTrace({
          status: 'FAILED', request_id: storyTraceId, internal_id: storyTraceId,
          pool_id: diary.swimming_pool_id ?? '', actor_id: userId,
          contract_version: '1.0', feature: AI_FEATURE.STORY_SUMMARY,
          pool_mode: null, user_role: role, result_generated: false, provider: 'openai',
          error_stage: 'PROVIDER_CALL', error_code: 'OPENAI_ERROR',
          latency_ms: Date.now() - storyStartMs,
        }).catch(() => {});
        res.status(500).json({ error: 'summary_failed' }); return;
      }

      // ── 5. 서버 측 1차 길이 검증 ──────────────────────────────────────────
      if (summary.length > maxChars) {
        // 1차 FAIL → 더 짧은 기준으로 재요약 요청
        const retryMaxChars = Math.floor(maxChars * 0.85);
        console.log(
          `[story-summary] 1차 길이 초과(${summary.length}>${maxChars})` +
          ` → retry retryMaxChars=${retryMaxChars}` +
          ` diaryId=...${diaryId.slice(-8)}`
        );
        const retryController = new AbortController();
        const retryTimer = setTimeout(() => retryController.abort(), 25_000);
        let retrySummary: string;
        try {
          const retryCompletion = await openai.chat.completions.create(
            {
              model:       AI_MODEL.STORY,
              messages:    [
                { role: 'user',      content: prompt },
                { role: 'assistant', content: summary },
                { role: 'user',      content:
                  `이전 결과가 길이 제한을 초과했습니다.\n` +
                  `내용을 더 압축하여 반드시 ${retryMaxChars}자 이내로 작성하십시오.` },
              ],
              temperature: 0.3,
              max_tokens:  400,
            },
            { signal: retryController.signal },
          );
          clearTimeout(retryTimer);
          retrySummary = retryCompletion.choices[0]?.message?.content?.trim() ?? '';
          // CS-PA1: 재시도 call 토큰 캡처
          if (retryCompletion.usage) {
            retryCallTokens = {
              prompt:     retryCompletion.usage.prompt_tokens     ?? 0,
              completion: retryCompletion.usage.completion_tokens ?? 0,
              total:      retryCompletion.usage.total_tokens      ?? 0,
            };
          }
        } catch (e: any) {
          clearTimeout(retryTimer);
          console.error(
            `[story-summary] retry OpenAI error` +
            ` diaryId=...${diaryId.slice(-8)}` +
            ` msg=${String(e?.message ?? 'unknown').slice(0, 80)}`
          );
          void saveAiTrace({
            status: 'FAILED', request_id: storyTraceId, internal_id: storyTraceId,
            pool_id: diary.swimming_pool_id ?? '', actor_id: userId,
            contract_version: '1.0', feature: AI_FEATURE.STORY_SUMMARY,
            pool_mode: null, user_role: role, result_generated: false, provider: 'openai',
            error_stage: 'PROVIDER_CALL', error_code: 'RETRY_OPENAI_ERROR',
            latency_ms: Date.now() - storyStartMs,
            sub_feature: 'RETRY',
            input_tokens:  firstCallTokens?.prompt     ?? null,
            output_tokens: firstCallTokens?.completion ?? null,
            total_tokens:  firstCallTokens?.total      ?? null,
          }).catch(() => {});
          res.status(500).json({ error: 'summary_failed' }); return;
        }

        // 2차 길이 검증 — 임의 truncate 금지, FAIL 시 summary_failed
        if (!retrySummary || retrySummary.length > retryMaxChars) {
          console.error(
            `[story-summary] 2차 길이 초과(${retrySummary.length}>${retryMaxChars})` +
            ` diaryId=...${diaryId.slice(-8)}`
          );
          void saveAiTrace({
            status: 'FAILED', request_id: storyTraceId, internal_id: storyTraceId,
            pool_id: diary.swimming_pool_id ?? '', actor_id: userId,
            contract_version: '1.0', feature: AI_FEATURE.STORY_SUMMARY,
            pool_mode: null, user_role: role, result_generated: false, provider: 'openai',
            error_stage: 'OUTPUT_VALIDATION', error_code: 'LENGTH_EXCEEDED_AFTER_RETRY',
            latency_ms: Date.now() - storyStartMs,
            sub_feature: 'RETRY',
          }).catch(() => {});
          res.status(500).json({ error: 'summary_failed' }); return;
        }
        summary = retrySummary;
      }

      // CS-PA1: 성공 trace — 1차 + 재시도 토큰 합산
      const totalInput  = (firstCallTokens?.prompt     ?? 0) + (retryCallTokens?.prompt     ?? 0);
      const totalOutput = (firstCallTokens?.completion ?? 0) + (retryCallTokens?.completion ?? 0);
      const totalAll    = (firstCallTokens?.total      ?? 0) + (retryCallTokens?.total      ?? 0);
      void saveAiTrace({
        status:           'SUCCESS',
        request_id:       storyTraceId,
        internal_id:      storyTraceId,
        pool_id:          diary.swimming_pool_id ?? '',
        actor_id:         userId,
        contract_version: '1.0',
        feature:          AI_FEATURE.STORY_SUMMARY,
        pool_mode:        null,
        user_role:        role,
        result_generated: true,
        provider:         'openai',
        generation_mode:  retryCallTokens ? 'story_with_retry' : 'story_direct',
        model:            AI_MODEL.STORY,
        latency_ms:       Date.now() - storyStartMs,
        input_tokens:     totalInput  > 0 ? totalInput  : null,
        output_tokens:    totalOutput > 0 ? totalOutput : null,
        total_tokens:     totalAll    > 0 ? totalAll    : null,
      }).catch(() => {});

      res.json({ summary });
    } catch (e) {
      console.error('[story-summary] server error:', e);
      res.status(500).json({ error: 'server_error' });
    }
  },
);

export default router;
