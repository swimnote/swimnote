/**
 * pool-db-cs-23a.ts — WP-CS23A: Direct DB Answer Engine
 *
 * 추가:
 *   1. support_knowledge_items: intent_id, answer_mode 컬럼 추가 (additive, IF NOT EXISTS)
 *   2. support_intent_utterances: 신규 예상질문 테이블
 *   3. 인덱스: exact B-tree (normalized_utterance, intent_id, knowledge_id)
 *      pg_trgm 미지원(Production) → GIN 인덱스 생략, LIKE 기반 fallback 사용
 *   4. 테스트 fixture: 4개 intent × 5~8 utterance (TEST_ 접두어)
 *
 * 절대 원칙:
 *   - 기존 26개 ACTIVE knowledge content/status/revision 변경 금지
 *   - additive ALTER + IF NOT EXISTS — 기존 behavior 유지
 *   - TEST_ 접두어 fixture는 Production canonical answer로 사용 금지
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

let ran = false;

export async function runCs23aMigration(): Promise<void> {
  if (ran) return;
  ran = true;

  // ── 1. support_knowledge_items 컬럼 추가 ──────────────────────────────────
  // intent_id: 같은 질문 intent를 가리키는 canonical grouping key
  await superAdminDb.execute(sql.raw(`
    ALTER TABLE support_knowledge_items
      ADD COLUMN IF NOT EXISTS intent_id TEXT
  `));

  // answer_mode: DIRECT_DB|GROUNDED_GPT|HUMAN_ONLY
  // null = 기존 동작(기존 resolver chain으로 처리) → GROUNDED_GPT와 동일하게 동작
  await superAdminDb.execute(sql.raw(`
    ALTER TABLE support_knowledge_items
      ADD COLUMN IF NOT EXISTS answer_mode TEXT
        CHECK (answer_mode IS NULL
          OR answer_mode IN ('DIRECT_DB', 'GROUNDED_GPT', 'HUMAN_ONLY'))
  `));

  // intent_id 인덱스
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_ski_intent_id
      ON support_knowledge_items (intent_id)
      WHERE intent_id IS NOT NULL
  `));

  // ── 2. support_intent_utterances 신규 테이블 ──────────────────────────────
  await superAdminDb.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS support_intent_utterances (
      id                   TEXT PRIMARY KEY,
      intent_id            TEXT NOT NULL,
      knowledge_id         TEXT NOT NULL REFERENCES support_knowledge_items(id)
                             ON DELETE CASCADE,
      utterance            TEXT NOT NULL,
      normalized_utterance TEXT NOT NULL,
      language             TEXT NOT NULL DEFAULT 'ko',
      weight               SMALLINT NOT NULL DEFAULT 100,
      status               TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'pending')),
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  // 검색 인덱스 (exact match + intent/knowledge lookup)
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_siu_normalized_utterance
      ON support_intent_utterances (normalized_utterance)
      WHERE status = 'active'
  `));
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_siu_intent_id
      ON support_intent_utterances (intent_id)
      WHERE status = 'active'
  `));
  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_siu_knowledge_id
      ON support_intent_utterances (knowledge_id)
  `));

  // ── 3. Test fixture knowledge items ───────────────────────────────────────
  // 이번 WP에서는 TEST_ 접두어 4개만 삽입. Production canonical answer 아님.

  const fixtures: Array<{
    id: string; intentId: string; title: string; question: string;
    answer: string; answerMode: string; roles: string[]; modes: string[];
  }> = [
    {
      id:         "ki_test_x_price",
      intentId:   "TEST_X_PRICE",
      title:      "[TEST] SWIMNOTE X 가격",
      question:   "SWIMNOTE X 가격이 얼마인가요?",
      answer:     "[테스트 응답] SWIMNOTE X 가격은 현재 운영 정책에 따라 담당자가 안내드립니다. 이 항목은 테스트 전용입니다.",
      answerMode: "DIRECT_DB",
      roles:      ["pool_admin", "teacher", "parent_account"],
      modes:      ["normal", "x", "x_pending"],
    },
    {
      id:         "ki_test_attendance_permission",
      intentId:   "TEST_ATTENDANCE_PERMISSION",
      title:      "[TEST] 교사 출결 권한",
      question:   "교사가 출결을 수정할 수 있나요?",
      answer:     "[테스트 응답] 네. 교사는 담당 학생의 출결을 기록하고 수정할 수 있습니다. 이 항목은 테스트 전용입니다.",
      answerMode: "DIRECT_DB",
      roles:      ["teacher", "pool_admin"],
      modes:      ["normal", "x"],
    },
    {
      id:         "ki_test_parent_photo",
      intentId:   "TEST_PARENT_PHOTO",
      title:      "[TEST] 학부모 사진 조회",
      question:   "학부모가 자녀 사진을 어떻게 보나요?",
      answer:     "[테스트 응답] 학부모는 앱 하단 앨범 탭에서 자녀의 일지 사진을 확인할 수 있습니다. 이 항목은 테스트 전용입니다.",
      answerMode: "DIRECT_DB",
      roles:      ["parent_account"],
      modes:      ["normal", "x"],
    },
    {
      id:         "ki_test_human_only",
      intentId:   "TEST_HUMAN_ONLY",
      title:      "[TEST] HUMAN_ONLY 테스트",
      question:   "환불 받고 싶어요 [테스트]",
      answer:     "이 문의는 담당자 확인이 필요합니다. 아래 버튼을 통해 직접 문의해 주세요.",
      answerMode: "HUMAN_ONLY",
      roles:      ["pool_admin", "teacher", "parent_account"],
      modes:      ["normal", "x", "x_pending"],
    },
  ];

  for (const f of fixtures) {
    // Upsert knowledge item (ignore if already exists)
    await superAdminDb.execute(sql.raw(`
      INSERT INTO support_knowledge_items
        (id, item_type, scope, category, feature,
         affected_roles, affected_modes,
         title, content, question, answer,
         intent_id, answer_mode,
         status, revision, created_at, updated_at)
      VALUES
        ('${f.id}', 'FAQ', 'global', 'TEST', 'TEST',
         ARRAY[${f.roles.map(r => `'${r}'`).join(",")}],
         ARRAY[${f.modes.map(m => `'${m}'`).join(",")}],
         '${f.title.replace(/'/g, "''")}',
         '${f.answer.replace(/'/g, "''")}',
         '${f.question.replace(/'/g, "''")}',
         '${f.answer.replace(/'/g, "''")}',
         '${f.intentId}', '${f.answerMode}',
         'active', 1, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        intent_id   = EXCLUDED.intent_id,
        answer_mode = EXCLUDED.answer_mode,
        updated_at  = NOW()
    `));
  }

  // ── 4. Test utterance fixtures ─────────────────────────────────────────────

  // Helper: upsert utterance
  async function upsertUtterance(
    id: string, intentId: string, knowledgeId: string,
    utterance: string, normalizedUtterance: string, weight = 100
  ) {
    await superAdminDb.execute(sql.raw(`
      INSERT INTO support_intent_utterances
        (id, intent_id, knowledge_id, utterance, normalized_utterance, weight, status)
      VALUES
        ('${id}', '${intentId}', '${knowledgeId}',
         '${utterance.replace(/'/g, "''")}',
         '${normalizedUtterance.replace(/'/g, "''")}',
         ${weight}, 'active')
      ON CONFLICT (id) DO UPDATE SET
        normalized_utterance = EXCLUDED.normalized_utterance,
        updated_at           = NOW()
    `));
  }

  // TEST_X_PRICE utterances
  const xPriceUtterances = [
    ["u_txp_1", "x모드 가격 얼마야",         "x 모드 가격 얼마야"],
    ["u_txp_2", "x모드 비용",                "x 모드 비용"],
    ["u_txp_3", "스윔노트x 가격",             "스윔노트 x 가격"],
    ["u_txp_4", "엑스모드 가격 알려줘",        "엑스모드 가격 알려줘"],
    ["u_txp_5", "x 구독료 얼마야",            "x 구독료 얼마야"],
    ["u_txp_6", "x모드 한달 얼마야",          "x 모드 한달 얼마야"],
    ["u_txp_7", "swimnote x 이용료",         "swimnote x 이용료"],
    ["u_txp_8", "x 요금이 어떻게 돼요",       "x 요금이 어떻게 돼요"],
  ] as const;
  for (const [id, raw, norm] of xPriceUtterances) {
    await upsertUtterance(id, "TEST_X_PRICE", "ki_test_x_price", raw, norm);
  }

  // TEST_ATTENDANCE_PERMISSION utterances
  const attUtterances = [
    ["u_tat_1", "교사가 출결 수정할 수 있어",   "교사가 출결 수정할 수 있어"],
    ["u_tat_2", "선생님 출결 권한",             "선생님 출결 권한"],
    ["u_tat_3", "출결 수정 가능해요",            "출결 수정 가능해요"],
    ["u_tat_4", "출결 변경 누가 해요",           "출결 변경 누가 해요"],
    ["u_tat_5", "교사 출결 기록 권한",           "교사 출결 기록 권한"],
  ] as const;
  for (const [id, raw, norm] of attUtterances) {
    await upsertUtterance(id, "TEST_ATTENDANCE_PERMISSION", "ki_test_attendance_permission", raw, norm);
  }

  // TEST_PARENT_PHOTO utterances
  const photoUtterances = [
    ["u_tpp_1", "학부모 사진 어디서 봐요",      "학부모 사진 어디서 봐요"],
    ["u_tpp_2", "자녀 사진 보는 법",            "자녀 사진 보는 법"],
    ["u_tpp_3", "앨범 어디 있어요",             "앨범 어디 있어요"],
    ["u_tpp_4", "부모 사진 조회",               "부모 사진 조회"],
    ["u_tpp_5", "사진 앨범 학부모",             "사진 앨범 학부모"],
  ] as const;
  for (const [id, raw, norm] of photoUtterances) {
    await upsertUtterance(id, "TEST_PARENT_PHOTO", "ki_test_parent_photo", raw, norm);
  }

  // TEST_HUMAN_ONLY utterances
  const humanOnlyUtterances = [
    ["u_tho_1", "환불 받고 싶어요 테스트",      "환불 받고 싶어요 테스트"],
    ["u_tho_2", "결제 취소 테스트",             "결제 취소 테스트"],
    ["u_tho_3", "구독 해지 테스트",             "구독 해지 테스트"],
    ["u_tho_4", "환불 요청 테스트",             "환불 요청 테스트"],
    ["u_tho_5", "취소 처리 테스트",             "취소 처리 테스트"],
  ] as const;
  for (const [id, raw, norm] of humanOnlyUtterances) {
    await upsertUtterance(id, "TEST_HUMAN_ONLY", "ki_test_human_only", raw, norm);
  }

  console.log("[cs23a] migration complete — intent_id/answer_mode added, support_intent_utterances created, 4 test fixtures inserted");
}
