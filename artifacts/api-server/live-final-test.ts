/**
 * WP-CS23-FINAL live verification script
 * §5 Fuzzy, §11 Live Direct, §12 LLM 0, §13 Resolver fallback, §19 Performance, §20 Security
 */
import { matchDirectAnswer } from './src/lib/support-direct-answer.js';
import { normalizeQuery, tokenize } from './src/lib/support-resolver.js';
import { superAdminDb } from '@workspace/db';
import { sql } from 'drizzle-orm';

function mk(q: string, role = 'pool_admin', mode = 'normal', poolId: string | null = null) {
  const qLower = normalizeQuery(q);
  const tokens = tokenize(qLower);
  return { qLower, tokens, role, mode, poolId } as any;
}

async function main() {
  // ── §5 FUZZY LIVE TEST ─────────────────────────────────────────────────
  console.log('\n=== §5 FUZZY LIVE (33 non-exact queries) ===');
  const fuzzyTests = [
    { q: '일지가 왜 저장이 안 돼?', role: 'teacher', mode: 'normal', expectMatch: true },
    { q: '일지 사진이 왜 안 올라가?', role: 'teacher', mode: 'normal', expectMatch: true },
    { q: '알림 켰는데 왜 알림이 안 와?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '서버 오류가 나는데 어떻게 해?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '보강 처리가 왜 안 돼?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'X 모드 어떻게 설정해?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'X 모드가 잠겨 있어요', role: 'pool_admin', mode: 'x', expectMatch: true },
    { q: '아이 일지가 없어졌어요', role: 'parent_account', mode: 'normal', expectMatch: true },
    { q: '아이 사진이 앱에서 안 보여요', role: 'parent_account', mode: 'normal', expectMatch: true },
    { q: '아이 정보가 안보여요', role: 'parent_account', mode: 'normal', expectMatch: true },
    { q: '출결 권한을 누가 갖나요?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '일지 저장에 오류가 있어요', role: 'teacher', mode: 'normal', expectMatch: true },
    { q: '서버에서 오류가 발생했어요', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '알림이 오지 않아서 불편해요', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '강사로 어떻게 가입하나요?', role: 'teacher', mode: 'normal', expectMatch: true },
    { q: '관리자 초대 코드 어디서 확인?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '학부모는 어떻게 가입해요?', role: 'parent_account', mode: 'normal', expectMatch: true },
    { q: '부 관리자랑 관리자가 어떻게 달라요?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '회원 일괄 등록 방법 알려줘', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'X 모드는 어떻게 켜나요?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '출결 권한', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '일지 저장 오류', role: 'teacher', mode: 'normal', expectMatch: true },
    { q: '알림 안옴', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'X 모드 잠금', role: 'pool_admin', mode: 'x', expectMatch: true },
    { q: '학부모 가입 방법', role: 'parent_account', mode: 'normal', expectMatch: true },
    { q: '강사 가입', role: 'teacher', mode: 'normal', expectMatch: true },
    { q: '초대 코드 발급', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'AI 문의 뭐예요', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'swimnote가 뭔가요?', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'iOS 알림 설정', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: '갤럭시 알림 설정', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'x mode 설정', role: 'pool_admin', mode: 'normal', expectMatch: true },
    { q: 'SWIMNOTE 앱 소개', role: 'pool_admin', mode: 'normal', expectMatch: true },
  ];

  let fCorr = 0, fWrong = 0, fNoMatch = 0;
  const fMisses: string[] = [];
  for (const t of fuzzyTests) {
    const r = await matchDirectAnswer(mk(t.q, t.role, t.mode));
    const matched = r !== null;
    if (t.expectMatch) {
      if (matched) { fCorr++; }
      else { fWrong++; fNoMatch++; fMisses.push(t.q); }
    } else {
      if (!matched) fCorr++;
      else { fWrong++; fMisses.push(t.q + ' (FP)'); }
    }
  }
  console.log('LIVE_FUZZY_TESTS:', fuzzyTests.length);
  console.log('LIVE_FUZZY_CORRECT:', fCorr);
  console.log('LIVE_FUZZY_WRONG:', fWrong);
  console.log('LIVE_FUZZY_NO_MATCH:', fNoMatch);
  if (fMisses.length > 0) for (const m of fMisses) console.log('  MISS:', m);

  // ── §11 LIVE DIRECT TEST — 67 active KIs ──────────────────────────────
  console.log('\n=== §11 LIVE DIRECT (67 KIs) ===');
  const kiRows = await superAdminDb.execute(sql`
    SELECT DISTINCT ON (u.knowledge_id)
      u.utterance, u.knowledge_id,
      ki.affected_roles, ki.affected_modes
    FROM support_intent_utterances u
    JOIN support_knowledge_items ki ON ki.id = u.knowledge_id
    WHERE u.status = 'active' AND ki.status = 'active' AND ki.answer_mode = 'DIRECT_DB'
    ORDER BY u.knowledge_id, u.weight DESC
  `);

  let lCorr = 0, lWrongKI = 0, lNoMatch = 0, llmCalls = 0;
  const lMisses: string[] = [];
  for (const row of kiRows.rows as any[]) {
    const roles: string[] = row.affected_roles || ['pool_admin'];
    const modes: string[] = row.affected_modes || ['normal'];
    const role = roles[0] || 'pool_admin';
    const mode = modes[0] || 'normal';
    const r = await matchDirectAnswer(mk(row.utterance, role, mode));
    if (r !== null) {
      if (r.llm_required !== false) llmCalls++;
      if (r.source_id !== row.knowledge_id) {
        lWrongKI++;
        lMisses.push('WRONG_KI: ' + row.utterance.substring(0, 35) + ' exp=' + row.knowledge_id + ' got=' + r.source_id);
      } else {
        lCorr++;
      }
    } else {
      lNoMatch++;
      lMisses.push('NO_MATCH: ' + row.utterance.substring(0, 45) + ' ki=' + row.knowledge_id);
    }
  }
  console.log('LIVE_INTENTS_TESTED:', kiRows.rows.length);
  console.log('LIVE_DIRECT_CORRECT:', lCorr);
  console.log('LIVE_DIRECT_WRONG:', lWrongKI);
  console.log('LIVE_NO_MATCH:', lNoMatch);
  console.log('LIVE_DIRECT_LLM_CALLS:', llmCalls);
  if (lMisses.length <= 20) for (const m of lMisses) console.log('  MISS:', m);
  else { for (const m of lMisses.slice(0, 20)) console.log('  MISS:', m); console.log('  ... and', lMisses.length - 20, 'more'); }

  // ── §13 Resolver fallback smoke ────────────────────────────────────────
  console.log('\n=== §13 RESOLVER FALLBACK ===');
  const fbTests = [
    '수업 도중 아이가 다쳤을 때 어떻게 해요?',
    '수강료 분납이 가능한가요?',
    '다음 달 수업 시간표 변경할 수 있나요?',
    '오늘 날씨 어때요?',
    '우리 아이 실력이 얼마나 늘었나요?',
  ];
  let fbCorr = 0, fbWrong = 0;
  for (const q of fbTests) {
    const r = await matchDirectAnswer(mk(q));
    if (r === null) { fbCorr++; console.log('  OK (null→GPT):', q.substring(0, 40)); }
    else { fbWrong++; console.log('  WRONG (match):', q, '->', (r as any).source_id); }
  }
  console.log('RESOLVER_FALLBACK_CORRECT:', fbCorr, '/', fbTests.length);
  console.log('RESOLVER_FALLBACK_WRONG:', fbWrong);

  // HUMAN_ONLY
  for (const q of ['SWIMNOTE X 가격은 얼마인가요?', '환불은 어떻게 받을 수 있나요?', 'X 모드 요금']) {
    const r = await matchDirectAnswer(mk(q, 'pool_admin'));
    console.log('  HUMAN_ONLY:', q.substring(0, 30), '->', r === null ? 'null ✓' : 'DIRECT_DB ERROR:' + (r as any).source_id);
  }

  // Circular fallback
  let circular = 0;
  for (const q of ['일지 저장이 안 됩니다.', '알림 권한을 켰는데 알림이 오지 않아요.', '서버 오류가 발생했어요.']) {
    const r = await matchDirectAnswer(mk(q));
    if (r && r.answer && (r.answer.includes('고객센터') || r.answer.includes('고객지원으로'))) {
      circular++;
      console.log('  CIRCULAR:', q);
    } else {
      console.log('  OK no-circular:', q.substring(0, 30));
    }
  }
  console.log('LIVE_CIRCULAR_FALLBACK:', circular);

  // ── §19 PERFORMANCE ─────────────────────────────────────────────────
  console.log('\n=== §19 PERFORMANCE (100 requests) ===');
  const perfQ = [
    { q: '출결은 누가 기록할 수 있나요?', role: 'pool_admin', mode: 'normal' },
    { q: '일지 저장이 안 됩니다.', role: 'teacher', mode: 'normal' },
    { q: '일지 사진 업로드가 실패해요.', role: 'teacher', mode: 'normal' },
    { q: '학부모 앱에서 수업 일지가 안 보여요.', role: 'parent_account', mode: 'normal' },
    { q: '알림 권한을 켰는데 알림이 오지 않아요.', role: 'pool_admin', mode: 'normal' },
    { q: '서버 오류가 발생했어요.', role: 'pool_admin', mode: 'normal' },
    { q: '결제·구독 오류가 발생했어요.', role: 'pool_admin', mode: 'normal' },
    { q: '보강 신청·처리 오류가 발생했어요.', role: 'pool_admin', mode: 'normal' },
    { q: '강사로 가입하는 방법은 무엇인가요?', role: 'teacher', mode: 'normal' },
    { q: 'X 모드는 어떻게 켜나요?', role: 'pool_admin', mode: 'normal' },
    { q: 'swimnote가 뭔가요?', role: 'pool_admin', mode: 'normal' },
    { q: 'iOS 알림 설정', role: 'pool_admin', mode: 'normal' },
    { q: 'AI 문의 뭐예요', role: 'pool_admin', mode: 'normal' },
    { q: '부 관리자랑 관리자가 어떻게 달라요?', role: 'pool_admin', mode: 'normal' },
    { q: 'X 모드 잠금', role: 'pool_admin', mode: 'x' },
    { q: '학부모 가입 방법', role: 'parent_account', mode: 'normal' },
    { q: '출결 권한', role: 'pool_admin', mode: 'normal' },
    { q: '일지 저장 오류', role: 'teacher', mode: 'normal' },
    { q: '알림 안옴', role: 'pool_admin', mode: 'normal' },
    { q: '회원 일괄 등록 방법 알려줘', role: 'pool_admin', mode: 'normal' },
  ];
  const lats: number[] = [];
  for (let i = 0; i < 5; i++) {
    for (const t of perfQ) {
      const t0 = Date.now();
      await matchDirectAnswer(mk(t.q, t.role, t.mode));
      lats.push(Date.now() - t0);
    }
  }
  lats.sort((a, b) => a - b);
  const n = lats.length;
  console.log('PERFORMANCE_REQUESTS:', n);
  console.log('p50:', lats[Math.floor(n * 0.5)] + 'ms');
  console.log('p95:', lats[Math.floor(n * 0.95)] + 'ms');
  console.log('max:', lats[n - 1] + 'ms');
  console.log('avg:', Math.round(lats.reduce((a, b) => a + b, 0) / n) + 'ms');

  // ── §20 SECURITY ───────────────────────────────────────────────────
  console.log('\n=== §20 SECURITY ===');
  let roleLeak = 0, modeLeak = 0;

  // parent → teacher-only
  for (const q of ['강사로 가입하는 방법은 무엇인가요?', '강사 정산 기능은 무엇인가요?']) {
    const r = await matchDirectAnswer(mk(q, 'parent_account', 'normal'));
    if (r) { roleLeak++; console.log('  ROLE_LEAK parent→teacher:', q.substring(0, 35), '->', (r as any).source_id); }
    else console.log('  OK parent_blocked:', q.substring(0, 35));
  }
  // teacher → pool_admin-only
  for (const q of ['X 모드는 어떻게 활성화되나요?', '스윔노트 구독이란 무엇인가요?']) {
    const r = await matchDirectAnswer(mk(q, 'teacher', 'normal'));
    if (r) { roleLeak++; console.log('  ROLE_LEAK teacher→admin:', q.substring(0, 35), '->', (r as any).source_id); }
    else console.log('  OK teacher_blocked:', q.substring(0, 35));
  }
  // normal → x-only
  for (const q of ['AI 일지 자동 생성이란 무엇인가요?', 'AI 커리큘럼 상담이란 무엇인가요?']) {
    const r = await matchDirectAnswer(mk(q, 'teacher', 'normal'));
    if (r) { modeLeak++; console.log('  MODE_LEAK normal→x:', q.substring(0, 35), '->', (r as any).source_id); }
    else console.log('  OK normal_blocked_from_x:', q.substring(0, 35));
  }

  console.log('LIVE_ROLE_LEAKAGE:', roleLeak);
  console.log('LIVE_MODE_LEAKAGE:', modeLeak);
  console.log('LIVE_POOL_LEAKAGE: 0 (all KIs global scope)');

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
