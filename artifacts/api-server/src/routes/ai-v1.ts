/**
 * ai-v1.ts — Teacher Diary AI Engine V1 (Template-Grounded Pipeline)
 *
 * POST /v1/teacher-diary/generate
 *
 * Pipeline:
 *   1. Request 검증 (V1 Contract)
 *   2. Meaning Extraction — 키워드 기반 파싱, GPT 불필요
 *   3. Template Search  — diary_templates DB 검색 (CANDIDATE_MIN_CONCEPT_OVERLAP=0.30)
 *   4. Ranking          — USAGE_MIN_SCORE=1.40 통과, TOP_K_USAGE=1 선택
 *   5. Prompt Build     — 선택된 템플릿을 참고 예문으로 포함
 *   6. GPT 호출         — gpt-4o-mini
 *   7. Grounding 검증   — GPT 출력의 미지원 주장 검출 (parser_confidence와 완전 분리)
 *   8. Response         — V1 Contract + meta 메타데이터
 *
 * V1 Contract:
 *   Request:  { contract_version, request_id, schema_version, feature, locale, input, context }
 *   Response: { contract_version, request_id, schema_version, engine_version, feature, result, meta, usage }
 *   Error:    { contract_version, request_id, schema_version, feature, status:'failed', error }
 *
 * meta 필드:
 *   pipeline_mode:            "template_v1"
 *   generation_mode:          "TEMPLATE_ASSISTED" | "INPUT_ONLY"
 *   parser_confidence:        TeacherInputParser 입력 해석 신뢰도 (grounding과 별개)
 *   template_candidate_count: conceptOverlap >= 0.30 통과 후보 수
 *   template_used_count:      score >= 1.40 통과 실제 사용 수 (최대 1)
 *   top_score:                상위 template score (최대 3.0)
 *   top_breakdown:            상위 template 점수 구성 {strokeMatch, focusMatch, conceptOverlap, observationMatch}
 *   grounding_validation:     GPT 출력 실제 검증 결과 (parser_confidence 미사용)
 *   template_candidate_ids:   후보 실제 DB ID 목록
 *   template_ids:             사용된 실제 DB ID 목록 (최대 1)
 */

import { Router, type Response }          from 'express';
import OpenAI                              from 'openai';
import { requireAuth, type AuthRequest }   from '../middlewares/auth.js';
import {
  isValidExternalRequestId,
  newInternalRequestId,
  hashPoolId,
  logDiaryStructured,
  ModelTimeoutError,
  OutputValidationError,
  validateDiaryOutput,
  getGptTimeoutMs,
  countLegacyStudentIdFallback,
} from '../lib/ai-diary-utils.js';
import { extractMeaning }    from '../lib/diary-parser.js';
import {
  searchTemplates,
  CANDIDATE_MIN_CONCEPT_OVERLAP,
  USAGE_MIN_SCORE,
  TOP_K_USAGE,
} from '../lib/diary-template-search.js';
import { validateGrounding, purgeStudentLeaksFromCommon, purgeInventedEvaluations } from '../lib/diary-grounding.js';

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

// ── Supported versions ────────────────────────────────────────────────────────
const SUPPORTED_CONTRACT_VERSIONS = new Set(['1.0']);
const ENGINE_VERSION              = 'grounded_v1';
const PIPELINE_MODE               = 'template_v1';

// ── POST /v1/teacher-diary/generate ──────────────────────────────────────────
router.post(
  '/v1/teacher-diary/generate',
  requireAuth as any,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const internalId = newInternalRequestId();
    const startMs    = Date.now();
    const raw        = req.body ?? {};

    // ── 1. request_id ────────────────────────────────────────────────────────
    const externalRequestId = raw.request_id;
    if (!isValidExternalRequestId(externalRequestId)) {
      res.status(400).json(errBody(null, 'INVALID_REQUEST', 'request_id is required.', false));
      return;
    }

    // ── 2. contract_version ──────────────────────────────────────────────────
    if (
      typeof raw.contract_version !== 'string' ||
      !SUPPORTED_CONTRACT_VERSIONS.has(raw.contract_version)
    ) {
      res.status(400).json(errBody(externalRequestId, 'UNSUPPORTED_CONTRACT',
        `Unsupported contract_version: ${raw.contract_version ?? '(missing)'}. Supported: 1.0`, false));
      return;
    }

    // ── 3. schema_version ────────────────────────────────────────────────────
    if (raw.schema_version !== '1.0') {
      res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'Invalid schema_version.', false));
      return;
    }

    // ── 4. feature ───────────────────────────────────────────────────────────
    if (raw.feature !== 'teacher_diary') {
      res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'Invalid feature.', false));
      return;
    }

    // ── 5. input.text ────────────────────────────────────────────────────────
    const inputText = typeof raw.input?.text === 'string' ? raw.input.text.trim() : '';
    if (!inputText) {
      res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'input.text is required.', false));
      return;
    }

    // ── 6. context ───────────────────────────────────────────────────────────
    const context    = raw.context ?? {};
    const poolId     = typeof context.pool_id     === 'string' ? context.pool_id.trim()    : '';
    const classId    = typeof context.class_id    === 'string' ? context.class_id.trim()   : '';
    const lessonDate = typeof context.lesson_date === 'string' ? context.lesson_date.trim(): '';
    const studentRefs: unknown[] = Array.isArray(context.student_refs) ? context.student_refs : [];
    const students:    unknown[] = Array.isArray(context.students)     ? context.students    : [];

    if (!poolId)     { res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'context.pool_id is required.',     false)); return; }
    if (!classId)    { res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'context.class_id is required.',    false)); return; }
    if (!lessonDate) { res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'context.lesson_date is required.', false)); return; }

    // ── 7. students 구조 검증 ────────────────────────────────────────────────
    const normalizedStudents: { ref: string; name: string }[] = [];
    for (let i = 0; i < students.length; i++) {
      const s = students[i];
      if (typeof s !== 'object' || s === null) {
        res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'Invalid students array.', false)); return;
      }
      const entry = s as Record<string, unknown>;
      if (typeof entry.ref  !== 'string' || !entry.ref.trim())  {
        res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'Invalid students array.', false)); return;
      }
      if (typeof entry.name !== 'string' || !entry.name.trim()) {
        res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'Invalid students array.', false)); return;
      }
      normalizedStudents.push({ ref: entry.ref.trim(), name: entry.name.trim() });
    }

    // ── 8. student_refs ↔ students[].ref 일치 ───────────────────────────────
    const normalizedRefs = normalizedStudents.map(s => s.ref);
    const refsMatch =
      studentRefs.length === normalizedRefs.length &&
      studentRefs.every((ref, idx) => ref === normalizedRefs[idx]);
    if (!refsMatch) {
      res.status(400).json(errBody(externalRequestId, 'INVALID_REQUEST', 'student_refs mismatch.', false)); return;
    }

    // ── 9. JWT Tenant 격리 ───────────────────────────────────────────────────
    const jwtPoolId = req.user?.poolId;
    if (jwtPoolId && jwtPoolId !== poolId) {
      console.warn(`[AI/v1:${internalId}] tenant_mismatch jwt=${jwtPoolId} req=${poolId}`);
      res.status(403).json(errBody(externalRequestId, 'TENANT_MISMATCH', '수영장 정보가 일치하지 않습니다.', false)); return;
    }

    // ── Trace: API_REQUEST_RECEIVED ──────────────────────────────────────────
    console.log(`[AI/v1:${internalId}] API_REQUEST_RECEIVED request_id=${externalRequestId} pool_hash=${hashPoolId(poolId)} student_count=${normalizedStudents.length} text_len=${inputText.length}`);

    // ── Trace: AUTH_SUCCESS ───────────────────────────────────────────────────
    console.log(`[AI/v1:${internalId}] AUTH_SUCCESS role=${req.user?.role ?? 'unknown'} tenant_match=${!req.user?.poolId || req.user?.poolId === poolId}`);

    // ── Trace: REQUEST_VALIDATED ─────────────────────────────────────────────
    console.log(`[AI/v1:${internalId}] REQUEST_VALIDATED student_count=${normalizedStudents.length} lesson_date=${lessonDate}`);

    // ── Trace: TEACHER_DIARY_ROUTE_ENTERED ────────────────────────────────────
    console.log(`[AI/v1:${internalId}] TEACHER_DIARY_ROUTE_ENTERED pipeline=${PIPELINE_MODE} engine=${ENGINE_VERSION}`);

    try {
      // ── Phase 1: Meaning Extraction (TeacherInputParser) ─────────────────
      const t_parser = Date.now();
      const meaning = extractMeaning(inputText);
      const parser_ms = Date.now() - t_parser;

      // ── Trace: PARSER_COMPLETED ───────────────────────────────────────────
      console.log(
        `[AI/v1:${internalId}] PARSER_COMPLETED latency_ms=${parser_ms}` +
        ` strokes=${meaning.strokes.join(',') || '(none)'}` +
        ` skills=${meaning.skills.length}` +
        ` issues=${meaning.issues.length}` +
        ` confidence=${meaning.confidence}` +
        ` allKeywords=${meaning.allKeywords.length}`,
      );

      // ── Trace: STUDENT_MATCH_COMPLETED ───────────────────────────────────
      console.log(`[AI/v1:${internalId}] STUDENT_MATCH_COMPLETED student_count=${normalizedStudents.length} refs=${normalizedStudents.map(s => s.ref).join(',')}`);

      // ── Phase 2 & 3: Template Search + Ranking ────────────────────────────
      // diary-template-search.ts 단일 경로 사용
      // CANDIDATE_MIN_CONCEPT_OVERLAP=0.30, USAGE_MIN_SCORE=1.40, TOP_K_USAGE=1
      const t_template = Date.now();
      const searchResult = await searchTemplates(poolId, meaning);
      const template_ms = Date.now() - t_template;

      // ── Trace: TEMPLATE_SEARCH_COMPLETED ──────────────────────────────────
      const topBd = searchResult.topBreakdown;
      console.log(
        `[AI/v1:${internalId}] TEMPLATE_SEARCH_COMPLETED latency_ms=${template_ms}` +
        ` candidates=${searchResult.candidateCount}` +
        ` used=${searchResult.usedCount}` +
        ` top_score=${searchResult.topScore.toFixed(2)}` +
        (topBd
          ? ` strokeMatch=${topBd.strokeMatch} focusMatch=${topBd.focusMatch}` +
            ` conceptOverlap=${topBd.conceptOverlap.toFixed(2)} observationMatch=${topBd.observationMatch}`
          : '') +
        (searchResult.usedFallbackPool ? ' fallback_pool=true' : ''),
      );

      // ── Trace: KNOWLEDGE_SEARCH_COMPLETED (N/A) ───────────────────────────
      console.log(`[AI/v1:${internalId}] KNOWLEDGE_SEARCH_COMPLETED knowledge_count=0 note=template_v1_pipeline`);

      // ── Trace: MODE_DECIDED ────────────────────────────────────────────────
      // TEMPLATE_ASSISTED: usedCount > 0 (score >= USAGE_MIN_SCORE=1.40 통과)
      // INPUT_ONLY: 후보 없거나 모든 후보 score < USAGE_MIN_SCORE
      const generation_mode =
        searchResult.usedCount > 0 ? 'TEMPLATE_ASSISTED' : 'INPUT_ONLY';
      console.log(
        `[AI/v1:${internalId}] MODE_DECIDED generation_mode=${generation_mode}` +
        ` template_used=${searchResult.usedCount}` +
        ` top_score=${searchResult.topScore.toFixed(2)}` +
        ` usage_min_score=${USAGE_MIN_SCORE}` +
        ` candidate_min_overlap=${CANDIDATE_MIN_CONCEPT_OVERLAP}` +
        ` top_k=${TOP_K_USAGE}`,
      );

      // ── Phase 4: Prompt Build ─────────────────────────────────────────────
      const templatesForPrompt = generation_mode === 'TEMPLATE_ASSISTED'
        ? searchResult.usedTemplates
        : [];
      const { systemPrompt, userPrompt } = buildPrompt({
        lessonDate,
        normalizedStudents,
        inputText,
        templates: templatesForPrompt,
      });

      // ── Phase 5: GPT 호출 (Naturalizer) ──────────────────────────────────
      const gptTimeoutMs  = getGptTimeoutMs();
      const controller    = new AbortController();
      const timer         = setTimeout(() => controller.abort(), gptTimeoutMs);
      const t_gpt         = Date.now();

      let completion: Awaited<ReturnType<OpenAI['chat']['completions']['create']>>;
      try {
        completion = await getOpenAI().chat.completions.create(
          {
            model:           'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt   },
            ],
            response_format: { type: 'json_object' },
            temperature:     0.7,
            max_tokens:      1200,
          },
          { signal: controller.signal },
        );
        clearTimeout(timer);
      } catch (e: any) {
        clearTimeout(timer);
        if (controller.signal.aborted || e?.name === 'AbortError' || String(e?.message ?? '').toLowerCase().includes('aborted')) {
          throw new ModelTimeoutError();
        }
        throw e;
      }
      const gpt_ms = Date.now() - t_gpt;

      // ── Trace: NATURALIZER_COMPLETED ──────────────────────────────────────
      console.log(`[AI/v1:${internalId}] NATURALIZER_COMPLETED latency_ms=${gpt_ms} tokens=${completion.usage?.total_tokens ?? 0}`);

      // ── Phase 6: 응답 파싱 + 구조 검증 ───────────────────────────────────
      const rawContent = completion.choices[0]?.message?.content ?? '{}';
      let parsed: unknown;
      try { parsed = JSON.parse(rawContent); }
      catch { throw new Error('GPT 응답 JSON 파싱 실패'); }

      const allowedRefs         = new Set(normalizedStudents.map(s => s.ref));
      const legacyFallbackCount = countLegacyStudentIdFallback(parsed, allowedRefs);
      const validated           = validateDiaryOutput(parsed, allowedRefs);

      // ── Phase 6.5: Common 학생 누출 문장 강제 제거 (코드 레벨 강제, GPT 판단 불사용) ──
      // studentDrafts에 포함된 학생 이름이 common에 등장하면 해당 문장을 무조건 삭제
      const studentNames = normalizedStudents.map(s => s.name);
      const { purged: purgedCommon, removedSentenceCount } = purgeStudentLeaksFromCommon(
        validated.common,
        studentNames,
      );
      if (removedSentenceCount > 0) {
        console.log(
          `[AI/v1:${internalId}] COMMON_LEAK_PURGED` +
          ` removed_sentences=${removedSentenceCount}` +
          ` names=[${studentNames.join(',')}]`,
        );
      }
      // purgedCommon을 이후 모든 단계에서 사용 (validated.common 대체)
      let finalResult = { ...validated, common: purgedCommon };

      // ── Phase 6.6: 발명된 태도·평가 표현 강제 제거 (common + 학생별) ───────
      // 강사 원문에 없는 평가 키워드(집중, 적극, 응원, 즐겁 등) 포함 문장 삭제
      {
        const { purged: evalPurgedCommon, removedSentenceCount: evalRemovedCommon } =
          purgeInventedEvaluations(finalResult.common, inputText);

        // 학생 content: 해당 학생 이름 변형이 포함된 문장은 보호 (관찰 문장 삭제 방지)
        const evalPurgedStudents = finalResult.students.map(s => {
          // 이름 변형 목록: '서태웅' → ['서태웅', '태웅'] 등
          const studentEntry = normalizedStudents.find(ns => ns.ref === s.student_ref);
          const nameVariants: string[] = [];
          if (studentEntry?.name) {
            const n = studentEntry.name.trim();
            nameVariants.push(n);
            if (n.length >= 3) nameVariants.push(n.slice(1));
            if (n.length >= 4) nameVariants.push(n.slice(2));
          }
          const { purged } = purgeInventedEvaluations(s.content, inputText, nameVariants);
          return { ...s, content: purged };
        });

        const totalEvalRemoved = evalRemovedCommon +
          finalResult.students.reduce((acc, s, i) => {
            const before = s.content.split(/(?<=[.!?~])\s+/).filter(Boolean).length;
            const after  = evalPurgedStudents[i].content.split(/(?<=[.!?~])\s+/).filter(Boolean).length;
            return acc + Math.max(0, before - after);
          }, 0);

        if (totalEvalRemoved > 0) {
          console.log(
            `[AI/v1:${internalId}] EVAL_PURGED` +
            ` common_removed=${evalRemovedCommon}` +
            ` total_removed=${totalEvalRemoved}`,
          );
        }
        finalResult = { common: evalPurgedCommon, students: evalPurgedStudents };
      }

      // ── Phase 7: Grounding 검증 (GPT 출력 실제 분석) ─────────────────────
      // parser_confidence와 완전 분리 — GPT 생성 결과가 입력 범위를 벗어났는지 검사
      const groundingResult = validateGrounding(finalResult, inputText, studentNames);

      // ── Trace: GROUNDING_VALIDATED ────────────────────────────────────────
      console.log(
        `[AI/v1:${internalId}] GROUNDING_VALIDATED` +
        ` status=${groundingResult.status}` +
        ` score=${groundingResult.score.toFixed(2)}` +
        ` unsupported_claims=${groundingResult.unsupported_claim_count}` +
        ` technique=${groundingResult.invented_technique_count}` +
        ` evaluation=${groundingResult.invented_student_evaluation_count}` +
        ` next_plan=${groundingResult.invented_next_plan_count}` +
        ` student_leak=${groundingResult.student_to_common_leak_count}` +
        ` students_out=${finalResult.students.length}` +
        ` legacy_fallback=${legacyFallbackCount}`,
      );

      const usage     = completion.usage;
      const elapsedMs = Date.now() - startMs;

      logDiaryStructured({
        internal_id:         internalId,
        external_request_id: externalRequestId,
        feature_flag:        'parser_v1',
        engine_version:      ENGINE_VERSION,
        prompt_version:      'p_template_v2',
        validator_result:    groundingResult.status === 'FAIL' ? 'grounding_fail' : 'pass',
        latency_ms:          elapsedMs,
        pool_id_hash:        hashPoolId(poolId),
      });

      console.log(
        `[AI/v1:${internalId}] success` +
        ` elapsed=${elapsedMs}ms` +
        ` tokens=${usage?.total_tokens ?? 0}` +
        ` students_out=${finalResult.students.length}` +
        ` pipeline=${PIPELINE_MODE}` +
        ` generation_mode=${generation_mode}` +
        ` template_used=${searchResult.usedCount}` +
        ` parser_confidence=${meaning.confidence}` +
        ` grounding=${groundingResult.status}` +
        (legacyFallbackCount > 0 ? ` legacy_fallback=${legacyFallbackCount}` : ''),
      );

      const responseBody = {
        contract_version: '1.0',
        request_id:       externalRequestId,
        schema_version:   '1.0',
        engine_version:   ENGINE_VERSION,
        feature:          'teacher_diary',
        result: {
          common:   finalResult.common,
          students: finalResult.students,
        },
        meta: {
          pipeline_mode:            PIPELINE_MODE,
          generation_mode:          generation_mode,
          // parser_confidence: TeacherInputParser 입력 해석 신뢰도 (grounding과 별개)
          parser_confidence:        meaning.confidence,
          template_candidate_count: searchResult.candidateCount,
          template_used_count:      generation_mode === 'TEMPLATE_ASSISTED' ? searchResult.usedCount : 0,
          top_score:                Number(searchResult.topScore.toFixed(2)),
          // 상위 template 점수 구성 (strokeMatch/focusMatch/conceptOverlap/observationMatch)
          top_breakdown:            searchResult.topBreakdown
            ? {
                strokeMatch:      searchResult.topBreakdown.strokeMatch,
                focusMatch:       searchResult.topBreakdown.focusMatch,
                conceptOverlap:   Number(searchResult.topBreakdown.conceptOverlap.toFixed(3)),
                observationMatch: searchResult.topBreakdown.observationMatch,
              }
            : null,
          fallback_pool_used:       searchResult.usedFallbackPool,
          // grounding_validation: GPT 출력 실제 검증 결과 (parser_confidence 미사용)
          grounding_validation: {
            status:                            groundingResult.status,
            score:                             groundingResult.score,
            unsupported_claim_count:           groundingResult.unsupported_claim_count,
            student_to_common_leak_count:      groundingResult.student_to_common_leak_count,
            invented_student_evaluation_count: groundingResult.invented_student_evaluation_count,
            invented_next_plan_count:          groundingResult.invented_next_plan_count,
            invented_technique_count:          groundingResult.invented_technique_count,
          },
          knowledge_ids:          [],
          // 실제 DB template IDs — 후보 vs 사용 분리
          template_candidate_ids: searchResult.candidateIds,
          template_ids:           generation_mode === 'TEMPLATE_ASSISTED'
            ? searchResult.usedTemplates.map(t => t.id)
            : [],
          fallback_used:          searchResult.usedFallbackPool,
        },
        usage: {
          input_tokens:  usage?.prompt_tokens     ?? 0,
          output_tokens: usage?.completion_tokens ?? 0,
          total_tokens:  usage?.total_tokens      ?? 0,
          latency_ms:    elapsedMs,
        },
      };

      // ── Trace: RESPONSE_SENT ────────────────────────────────────────────────
      console.log(`[AI/v1:${internalId}] RESPONSE_SENT request_id=${externalRequestId} http_status=200 generation_mode=${generation_mode} student_count=${finalResult.students.length} grounding=${groundingResult.status} total_latency_ms=${elapsedMs}`);

      res.status(200).json(responseBody);

    } catch (e: any) {
      const elapsedMs = Date.now() - startMs;

      if (e instanceof ModelTimeoutError) {
        logDiaryStructured({ internal_id: internalId, external_request_id: externalRequestId, feature_flag: 'parser_v1', engine_version: ENGINE_VERSION, prompt_version: 'p_template_v2', validator_result: 'timeout', error_code: 'MODEL_TIMEOUT', latency_ms: elapsedMs, pool_id_hash: hashPoolId(poolId) });
        res.status(504).json(errBody(externalRequestId, 'MODEL_TIMEOUT', 'Teacher diary generation timed out.', true)); return;
      }

      if (e instanceof OutputValidationError) {
        logDiaryStructured({ internal_id: internalId, external_request_id: externalRequestId, feature_flag: 'parser_v1', engine_version: ENGINE_VERSION, prompt_version: 'p_template_v2', validator_result: `fail:${e.reason}`, error_code: 'OUTPUT_VALIDATION_FAILED', latency_ms: elapsedMs, pool_id_hash: hashPoolId(poolId) });
        console.error(`[AI/v1:${internalId}] output_validation_failed reason=${e.reason}`);
        res.status(500).json(errBody(externalRequestId, 'OUTPUT_VALIDATION_FAILED', 'Teacher diary output validation failed.', false)); return;
      }

      const safeMsg = String(e?.message ?? '').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
      logDiaryStructured({ internal_id: internalId, external_request_id: externalRequestId, feature_flag: 'parser_v1', engine_version: ENGINE_VERSION, prompt_version: 'p_template_v2', validator_result: 'error', error_code: e?.code ?? 'INTERNAL_ERROR', latency_ms: elapsedMs, pool_id_hash: hashPoolId(poolId) });
      console.error(`[AI/v1:${internalId}] error elapsed=${elapsedMs}ms msg=${safeMsg}`);
      const retryable = !e?.status || e.status >= 500 || e.status === 429;
      res.status(e?.status ?? 500).json(errBody(externalRequestId, e?.code ?? 'INTERNAL_ERROR', 'Teacher diary generation failed.', retryable));
    }
  },
);

// ── Prompt Builder ────────────────────────────────────────────────────────────

interface BuildPromptParams {
  lessonDate:         string;
  normalizedStudents: { ref: string; name: string }[];
  inputText:          string;
  templates:          { template_text: string; level_name: string }[];
}

function buildPrompt(p: BuildPromptParams): { systemPrompt: string; userPrompt: string } {
  const { lessonDate, normalizedStudents, inputText, templates } = p;

  // ── System Prompt ─────────────────────────────────────────────────────────
  const templateBlock = templates.length > 0
    ? [
        '',
        '[수업 일지 문체 참고 예문]',
        '아래 예문들은 문체와 수영 전문 용어 참고 전용입니다.',
        '예문의 구체적 내용(기술·동작·평가)은 강사 메모에 없으면 절대 사용하지 않습니다.',
        '',
        ...templates.map((t, i) => `예문 ${i + 1} (${t.level_name || '일반'}):\n${t.template_text}`),
      ].join('\n')
    : '';

  const systemPrompt = `당신은 수영 강사의 수업 메모를 일지로 변환하는 도우미입니다.
강사의 메모에 적힌 내용만 일지로 작성합니다.
${templateBlock}
[핵심 원칙]
- 강사 메모에 없는 내용은 절대 생성하지 않습니다.
- 발차기, 호흡, 자세, 턴, 스트로크, 태도, 향상, 다음 수업 계획 등은 메모에 명시된 경우에만 사용합니다.
- 특정 학생에 대한 관찰은 common에 포함하지 않습니다.
- 학생 칭찬·격려·추론·교정 방법은 메모에 없으면 생성하지 않습니다.

[응답 규칙]
- 반드시 JSON 형식으로만 응답합니다. 마크다운이나 다른 텍스트를 포함하지 않습니다.
- common: 모든 학생에게 공통으로 보이는 수업 일지입니다.
  - 100자 이상 300자 이내로 작성합니다.
  - 자연스럽고 전문적인 한국어로 작성합니다.
  - 강사 메모에 있는 내용만 반영합니다.
  - 특정 학생 이름이나 개인 관찰 내용을 포함하지 않습니다.
- students: 개별 학생 메모 배열입니다.
  - 강사의 메모에 특정 학생 이름과 함께 관찰 내용이 명시된 경우에만 포함합니다.
  - 학생 이름이 메모에 없으면 반드시 빈 배열([])을 반환합니다.
  - 학생 메모는 50자 이상 120자 이내로 작성합니다.
  - 메모에 있는 관찰 내용만 사용합니다. 추론·교정 방법·다음 계획은 생성하지 않습니다.
  - students에는 실제 작성할 내용이 있는 학생만 포함합니다.
  - 내용이 없는 학생은 포함하지 않습니다.
  - student_ref는 제공된 학생 목록의 ref 중 하나만 그대로 사용합니다.
  - 목록에 없는 ref는 절대 사용하지 않습니다.
  - 같은 student_ref를 두 번 이상 반환하지 않습니다.

[응답 형식]
{"common":"...","students":[{"student_ref":"...","content":"..."}]}`;

  // ── User Prompt ──────────────────────────────────────────────────────────
  const studentListText = normalizedStudents.length > 0
    ? `수업 참여 학생 (${normalizedStudents.length}명): ${normalizedStudents.map(s => `${s.name}(ref:${s.ref})`).join(', ')}`
    : '(수업 참여 학생 정보 없음)';

  const userPrompt = [
    `수업 날짜: ${lessonDate}`,
    studentListText,
    `\n강사 수업 메모:\n${inputText}`,
    '\n위 내용을 바탕으로 수업 일지를 JSON으로 작성해주세요.',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

// ── 오류 응답 헬퍼 ────────────────────────────────────────────────────────────

function errBody(
  requestId: string | null,
  code:      string,
  message:   string,
  retryable: boolean,
) {
  return {
    contract_version: '1.0',
    request_id:       requestId,
    schema_version:   '1.0',
    engine_version:   ENGINE_VERSION,
    feature:          'teacher_diary',
    status:           'failed',
    error:            { code, message, retryable },
  };
}

export default router;
