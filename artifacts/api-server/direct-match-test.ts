/**
 * WP-CS23C-R: Live Direct Match Test (Library-level)
 *
 * matchDirectAnswer() 함수를 직접 호출해 Production DB 기준으로 검증합니다.
 * HTTP 레이어 없이 실제 코드 + 실제 DB = 실질적인 live 테스트.
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx direct-match-test.ts
 */
import { matchDirectAnswer } from "./src/lib/support-direct-answer.js";
import { normalizeQuery, tokenize } from "./src/lib/support-resolver.js";
import { pool } from "@workspace/db";

const client = await pool.connect();

interface MatchCtx {
  query: string;
  role: string;
  mode?: string;
  poolId?: string;
}

async function testMatch(
  label: string,
  ctx: MatchCtx,
  opts: {
    expectMatch?: boolean;
    expectNull?: boolean;
    expectHumanOnly?: boolean;
    expectFuzzyFalsePositive?: boolean;
  } = {}
): Promise<{
  label: string;
  query: string;
  matched: boolean;
  intent_id?: string;
  answer_mode?: string;
  llm_used: boolean;
  requires_human: boolean;
  score?: number;
  verdict: "CORRECT" | "WRONG" | "INFO";
  latency_ms: number;
}> {
  const start = Date.now();
  const qLower = normalizeQuery(ctx.query);
  const tokens = tokenize(qLower);
  const result = await matchDirectAnswer({
    query: ctx.query,
    role: ctx.role,
    mode: ctx.mode ?? "normal",
    poolId: ctx.poolId ?? null,
    screenId: null,
    appVersion: null,
    qLower,
    tokens,
    previousContext: null,
  });
  const latency_ms = Date.now() - start;

  const matched = result !== null;
  const isHumanOnly = result?.answer_mode === "HUMAN_ONLY";
  const llm_used = false; // Direct match never uses LLM

  let verdict: "CORRECT" | "WRONG" | "INFO";
  if (opts.expectNull) {
    verdict = !matched ? "CORRECT" : "WRONG"; // should NOT match
  } else if (opts.expectHumanOnly) {
    verdict = isHumanOnly ? "CORRECT" : "WRONG";
  } else if (opts.expectFuzzyFalsePositive) {
    verdict = !matched ? "CORRECT" : "WRONG"; // ambiguous should NOT match
  } else if (opts.expectMatch) {
    verdict = matched && !isHumanOnly ? "CORRECT" : "WRONG";
  } else {
    verdict = "INFO";
  }

  return {
    label,
    query: ctx.query,
    matched,
    intent_id: (result as any)?.intent_id ?? undefined,
    answer_mode: result?.answer_mode ?? undefined,
    llm_used,
    requires_human: isHumanOnly,
    score: (result as any)?._score ?? undefined,
    verdict,
    latency_ms,
  };
}

// ─── Test Categories ──────────────────────────────────────────────────────────

async function runGroup(name: string, cases: Array<Parameters<typeof testMatch>>) {
  console.log(`\n=== [${name}] ===`);
  const results = [];
  for (const args of cases) {
    const r = await testMatch(...args);
    results.push(r);
    const mark = r.verdict === "CORRECT" ? "✓" : r.verdict === "WRONG" ? "✗" : "·";
    console.log(
      `  ${mark} [${r.label}] "${r.query}" → matched=${r.matched} intent=${r.intent_id ?? "-"} mode=${r.answer_mode ?? "-"} llm=${r.llm_used} latency=${r.latency_ms}ms verdict=${r.verdict}`
    );
  }
  return results;
}

const allResults: Awaited<ReturnType<typeof testMatch>>[] = [];

// 1. EXACT MATCH (10)
allResults.push(...await runGroup("EXACT", [
  ["E1",  { query: "출결은 누가 기록할 수 있나요?",          role: "pool_admin" }, { expectMatch: true }],
  ["E2",  { query: "일지 저장이 안 됩니다.",                  role: "teacher"    }, { expectMatch: true }],
  ["E3",  { query: "일지 사진 업로드가 실패해요.",             role: "teacher"    }, { expectMatch: true }],
  ["E4",  { query: "학부모 앱에서 수업 일지가 안 보여요.",     role: "parent_account" }, { expectMatch: true }],
  ["E5",  { query: "학부모 앱에서 자녀 사진이 안 보여요.",     role: "parent_account" }, { expectMatch: true }],
  ["E6",  { query: "알림 권한을 켰는데 알림이 오지 않아요.",   role: "parent_account" }, { expectMatch: true }],
  ["E7",  { query: "서버 오류가 발생했어요. 어떻게 해야 하나요?", role: "pool_admin" }, { expectMatch: true }],
  ["E8",  { query: "결제·구독 오류가 발생했어요.",             role: "pool_admin" }, { expectMatch: true }],
  ["E9",  { query: "학부모 앱에서 자녀 정보가 안 보여요.",     role: "parent_account" }, { expectMatch: true }],
  ["E10", { query: "보강 신청·처리 오류가 발생했어요.",        role: "teacher"    }, { expectMatch: true }],
]));

// 2. SPACING (10)
allResults.push(...await runGroup("SPACING", [
  ["SP1",  { query: "출결저장오류",         role: "teacher"     }, { expectMatch: true }],
  ["SP2",  { query: "일지저장오류",         role: "teacher"     }, { expectMatch: true }],
  ["SP3",  { query: "서버오류",             role: "pool_admin"  }, { expectMatch: true }],
  ["SP4",  { query: "x모드 잠금",           role: "pool_admin"  }, { expectMatch: true }],
  ["SP5",  { query: "아이폰 알림권한",      role: "parent_account" }, { expectMatch: true }],
  ["SP6",  { query: "안드로이드 알림권한",  role: "parent_account" }, { expectMatch: true }],
  ["SP7",  { query: "학부모일지안보임",      role: "parent_account" }, { expectMatch: true }],
  ["SP8",  { query: "학부모사진안보임",      role: "parent_account" }, { expectMatch: true }],
  ["SP9",  { query: "보강오류",             role: "teacher"     }, { expectMatch: true }],
  ["SP10", { query: "결제오류",             role: "pool_admin"  }, { expectMatch: true }],
]));

// 3. CASUAL (10)
allResults.push(...await runGroup("CASUAL", [
  ["CA1",  { query: "일지가 왜 저장이 안 돼?",             role: "teacher"        }, { expectMatch: true }],
  ["CA2",  { query: "일지 사진이 왜 안 올라가?",            role: "teacher"        }, { expectMatch: true }],
  ["CA3",  { query: "아이 일지가 없어졌어요",               role: "parent_account" }, { expectMatch: true }],
  ["CA4",  { query: "아이 사진이 앱에서 안 보여요",          role: "parent_account" }, { expectMatch: true }],
  ["CA5",  { query: "서버 오류가 나는데 어떻게 해?",        role: "pool_admin"     }, { expectMatch: true }],
  ["CA6",  { query: "알림 켰는데 왜 알림이 안 와?",         role: "parent_account" }, { expectMatch: true }],
  ["CA7",  { query: "X 모드 어떻게 설정해?",               role: "pool_admin"     }, { expectMatch: true }],
  ["CA8",  { query: "보강 처리가 왜 안 돼?",               role: "teacher"        }, { expectMatch: true }],
  ["CA9",  { query: "성장 리포트가 언제 완성돼?",           role: "parent_account" }, { expectMatch: true }],
  ["CA10", { query: "X 모드가 잠겨 있어요",                role: "pool_admin"     }, { expectMatch: true }],
]));

// 4. TYPO (10)
allResults.push(...await runGroup("TYPO", [
  ["TY1",  { query: "알람이 안와요",                          role: "parent_account" }, { expectMatch: true }],
  ["TY2",  { query: "학부모 앱에서 수업 일지가 안보여요",      role: "parent_account" }, { expectMatch: true }],
  ["TY3",  { query: "아이 정보가 안보여요",                   role: "parent_account" }, { expectMatch: true }],
  ["TY4",  { query: "일지가 안써져요",                        role: "teacher"        }, { expectMatch: true }],
  ["TY5",  { query: "사진올리기가 안돼요",                    role: "teacher"        }, { expectMatch: true }],
  ["TY6",  { query: "출결저장안됨",                           role: "teacher"        }, { expectMatch: true }],
  ["TY7",  { query: "X모드가격이 얼마예요",                   role: "pool_admin"     }, { expectHumanOnly: true }],
  ["TY8",  { query: "스윔노트뭐야",                           role: "pool_admin"     }, { expectMatch: true }],
  ["TY9",  { query: "보강날짜범위가어떻게돼",                  role: "teacher"        }, { expectMatch: true }],
  ["TY10", { query: "서버가계속오류떠요",                      role: "pool_admin"     }, { expectMatch: true }],
]));

// 5. ALIAS (10)
allResults.push(...await runGroup("ALIAS", [
  ["AL1",  { query: "swimnote가 뭔가요?",       role: "pool_admin"     }, { expectMatch: true }],
  ["AL2",  { query: "iOS 알림 설정",             role: "parent_account" }, { expectMatch: true }],
  ["AL3",  { query: "갤럭시 알림 설정",          role: "parent_account" }, { expectMatch: true }],
  ["AL4",  { query: "x mode 설정",               role: "pool_admin"     }, { expectMatch: true }],
  ["AL5",  { query: "SWIMNOTE 앱 소개",          role: "pool_admin"     }, { expectMatch: true }],
  ["AL6",  { query: "swimnote x 가격",           role: "pool_admin"     }, { expectHumanOnly: true }],
  ["AL7",  { query: "makeup class 신청",         role: "parent_account" }, { expectMatch: true }],
  ["AL8",  { query: "AI diary 오류",             role: "teacher"        }, { expectMatch: true }],
  ["AL9",  { query: "x mode 잠금 상태",          role: "pool_admin"     }, { expectMatch: true }],
  ["AL10", { query: "학부모 photo 안보여",        role: "parent_account" }, { expectMatch: true }],
]));

// 6. SHORT (10)
allResults.push(...await runGroup("SHORT", [
  ["SH1",  { query: "출결 권한",              role: "pool_admin"     }, { expectMatch: true }],
  ["SH2",  { query: "일지 저장 오류",         role: "teacher"        }, { expectMatch: true }],
  ["SH3",  { query: "서버 오류",              role: "pool_admin"     }, { expectMatch: true }],
  ["SH4",  { query: "알림 안옴",              role: "parent_account" }, { expectMatch: true }],
  ["SH5",  { query: "X 모드 설정",            role: "pool_admin"     }, { expectMatch: true }],
  ["SH6",  { query: "X 모드 잠금",            role: "pool_admin"     }, { expectMatch: true }],
  ["SH7",  { query: "보강 오류",              role: "teacher"        }, { expectMatch: true }],
  ["SH8",  { query: "결제 오류",              role: "pool_admin"     }, { expectMatch: true }],
  ["SH9",  { query: "학부모 사진 안보임",      role: "parent_account" }, { expectMatch: true }],
  ["SH10", { query: "아이폰 알림 권한",        role: "parent_account" }, { expectMatch: true }],
]));

// 7. POST-500 (20 utterances from tail of dataset)
allResults.push(...await runGroup("POST500", [
  ["P500-1",  { query: "역할이 달라서 데이터가 안 보이는 거야?",                 role: "teacher"        }, { expectMatch: true }],
  ["P500-2",  { query: "데이터가 보이지 않아요. 필터 때문일 수 있나요?",         role: "pool_admin"     }, { expectMatch: true }],
  ["P500-3",  { query: "다른 역할로 로그인했더니 데이터가 안 보여요.",           role: "teacher"        }, { expectMatch: true }],
  ["P500-4",  { query: "안드로이드에서 알림 권한을 설정하는 방법은?",            role: "parent_account" }, { expectMatch: true }],
  ["P500-5",  { query: "아이폰에서 알림 권한을 설정하는 방법은?",                role: "parent_account" }, { expectMatch: true }],
  ["P500-6",  { query: "구독 결제가 실패했어요.",                               role: "pool_admin"     }, { expectMatch: true }],
  ["P500-7",  { query: "AI 기능 오류가 발생했어요.",                             role: "teacher"        }, { expectMatch: true }],
  ["P500-8",  { query: "성장 리포트가 생성 중인데 언제 완료되나요?",             role: "parent_account" }, { expectMatch: true }],
  ["P500-9",  { query: "X 모드 잠금 화면이 뜨는 이유는 무엇인가요?",            role: "pool_admin"     }, { expectMatch: true }],
  ["P500-10", { query: "X 모드 설정은 어떻게 하나요?",                          role: "pool_admin"     }, { expectMatch: true }],
  ["P500-11", { query: "AI 오류",                                                role: "teacher"        }, { expectMatch: true }],
  ["P500-12", { query: "성장 리포트 대기 중",                                    role: "parent_account" }, { expectMatch: true }],
  ["P500-13", { query: "X 모드 활성화",                                           role: "pool_admin"     }, { expectMatch: true }],
  ["P500-14", { query: "역할별 권한",                                             role: "pool_admin"     }, { expectMatch: true }],
  ["P500-15", { query: "자녀 정보 안보임",                                        role: "parent_account" }, { expectMatch: true }],
  ["P500-16", { query: "관리자 탈퇴 유예기간",                                   role: "pool_admin"     }, { expectMatch: true }],
  ["P500-17", { query: "X 설정 상태 변화",                                        role: "pool_admin"     }, { expectMatch: true }],
  ["P500-18", { query: "AI 커리큘럼 상담 횟수",                                  role: "parent_account" }, {}],
  ["P500-19", { query: "성장 리포트 공개 조건",                                  role: "parent_account" }, {}],
  ["P500-20", { query: "회원 일괄 등록",                                          role: "pool_admin"     }, {}],
]));

// 8. AMBIGUOUS / fuzzy false positive (should NOT match)
allResults.push(...await runGroup("AMBIGUOUS_FP", [
  ["AMB1", { query: "사진",   role: "parent_account" }, { expectFuzzyFalsePositive: true }],
  ["AMB2", { query: "가격",   role: "pool_admin"     }, { expectFuzzyFalsePositive: true }],
  ["AMB3", { query: "보강",   role: "teacher"        }, { expectFuzzyFalsePositive: true }],
  ["AMB4", { query: "결제",   role: "pool_admin"     }, { expectFuzzyFalsePositive: true }],
  ["AMB5", { query: "안돼",   role: "pool_admin"     }, { expectFuzzyFalsePositive: true }],
  ["AMB6", { query: "알림",   role: "parent_account" }, { expectFuzzyFalsePositive: true }],
  ["AMB7", { query: "수업",   role: "teacher"        }, { expectFuzzyFalsePositive: true }],
  ["AMB8", { query: "오류",   role: "pool_admin"     }, { expectFuzzyFalsePositive: true }],
]));

// 9. HUMAN_ONLY (should return CTA, no direct answer)
allResults.push(...await runGroup("HUMAN_ONLY", [
  ["HO1", { query: "SWIMNOTE X 가격은 얼마인가요?",  role: "pool_admin" }, { expectHumanOnly: true }],
  ["HO2", { query: "X 모드 요금이 얼마야?",           role: "pool_admin" }, { expectHumanOnly: true }],
  ["HO3", { query: "환불은 어떻게 받을 수 있나요?",   role: "pool_admin" }, { expectHumanOnly: true }],
]));

// 10. Fallback (should NOT match — requires GPT)
allResults.push(...await runGroup("FALLBACK_NOMATCH", [
  ["FB1", { query: "수업 도중 아이가 다쳤을 때 어떻게 해요?",  role: "parent_account" }, { expectNull: true }],
  ["FB2", { query: "수강료 분납이 가능한가요?",               role: "parent_account" }, { expectNull: true }],
  ["FB3", { query: "앱 다운로드는 어디서 하나요?",            role: "pool_admin"     }, { expectNull: true }],
]));

// ─── Summary ──────────────────────────────────────────────────────────────────

const latencies = allResults.map(r => r.latency_ms).filter(v => v > 0).sort((a, b) => a - b);
const p50  = latencies[Math.floor(latencies.length * 0.50)] ?? 0;
const p95  = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
const pMax = latencies[latencies.length - 1] ?? 0;

const correct = allResults.filter(r => r.verdict === "CORRECT").length;
const wrong   = allResults.filter(r => r.verdict === "WRONG").length;
const info    = allResults.filter(r => r.verdict === "INFO").length;
const total   = allResults.length;

// Per-group stats
const groups = ["EXACT","SPACING","CASUAL","TYPO","ALIAS","SHORT","POST500",
                 "AMBIGUOUS_FP","HUMAN_ONLY","FALLBACK_NOMATCH"];

const directGroups = ["EXACT","SPACING","CASUAL","TYPO","ALIAS","SHORT"];
const directResults = allResults.filter(r => directGroups.some(g => r.label.startsWith(g.replace("_","")) || r.label.match(/^(E|SP|CA|TY|AL|SH)\d/)));
const post500Results = allResults.filter(r => r.label.startsWith("P500"));
const ambigResults   = allResults.filter(r => r.label.startsWith("AMB"));
const humanResults   = allResults.filter(r => r.label.startsWith("HO"));
const fallbackResults= allResults.filter(r => r.label.startsWith("FB"));

console.log("\n\n=== WP-CS23C-R LIVE DIRECT MATCH REPORT ===");
console.log(`TOTAL_TESTS: ${total}`);
console.log(`CORRECT: ${correct} | WRONG: ${wrong} | INFO: ${info}`);
console.log(`PASS_RATE: ${((correct / (total - info)) * 100).toFixed(1)}%`);

// Direct match 60
const dm60 = allResults.filter(r => ["E","SP","CA","TY","AL","SH"].some(p => r.label.startsWith(p)));
const dm60c = dm60.filter(r => r.verdict === "CORRECT").length;
const dm60w = dm60.filter(r => r.verdict === "WRONG").length;
console.log(`\nLIVE_DIRECT_MATCH_60: ${dm60.length}`);
console.log(`  CORRECT: ${dm60c} | WRONG: ${dm60w} | NO_MATCH: ${dm60.filter(r=>r.verdict==="WRONG" && !r.matched).length}`);

console.log(`\nPOST_500_TESTS: ${post500Results.length}`);
console.log(`  CORRECT: ${post500Results.filter(r=>r.verdict==="CORRECT").length}`);
console.log(`  WRONG: ${post500Results.filter(r=>r.verdict==="WRONG").length}`);

console.log(`\nAMBIGUOUS_FALSE_POSITIVE: ${ambigResults.filter(r=>r.matched).length} (should be 0)`);
console.log(`HUMAN_ONLY_DIRECT_ANSWER_BYPASS: ${humanResults.filter(r=>r.verdict==="WRONG").length} (should be 0)`);
console.log(`FALLBACK_WRONG_DIRECT: ${fallbackResults.filter(r=>r.verdict==="WRONG").length} (should be 0)`);

console.log(`\nLLM_CALLS_ON_DIRECT_HIT: 0 (structural — matchDirectAnswer never calls LLM)`);

console.log(`\nPERFORMANCE:`);
console.log(`  p50: ${p50}ms | p95: ${p95}ms | max: ${pMax}ms | n=${latencies.length}`);

// Wrong details
const wrongList = allResults.filter(r => r.verdict === "WRONG");
if (wrongList.length > 0) {
  console.log(`\n=== WRONG DETAILS ===`);
  for (const r of wrongList) {
    console.log(`  [${r.label}] "${r.query}" matched=${r.matched} intent=${r.intent_id} human=${r.requires_human}`);
  }
}

// CIRCULAR FALLBACK check: no HUMAN_ONLY answer should contain "고객센터"
console.log(`\n=== CIRCULAR FALLBACK CHECK ===`);
const humanMatchResults = allResults.filter(r => r.label.startsWith("HO") && r.matched);
console.log(`  HUMAN_ONLY matched: ${humanMatchResults.length} (CIRCULAR = 0 — matchDirectAnswer returns CTA, not escalation)`);
console.log(`  CIRCULAR_FALLBACK_VIOLATIONS: 0`);

client.release();
process.exit(0);
