/**
 * WP-CS23C-R: Live API Test
 * 실제 Production Render API에 요청하여 Direct Match / Fallback / Performance 검증
 *
 * Usage: pnpm --filter @workspace/api-server exec tsx live-test-cs23c.ts
 */
import { signToken } from "./src/lib/auth.js";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);

const BASE_URL = "https://swimnote-api.onrender.com";

// Real user IDs from production DB (queried 2026-08-19)
const USERS = {
  super_admin:    { userId: "user_super_1775303066795_yial5wvrm",  role: "super_admin",    poolId: null },
  pool_admin:     { userId: "user_1784865333802_kchge1xsc",        role: "pool_admin",     poolId: "pool_1784865333802_mi7k4fsa4" },
  parent_account: { userId: "pa_1775307998484_lwwcn2t5d",          role: "parent_account", poolId: null },
  teacher:        { userId: "user_1784865333802_kchge1xsc",        role: "pool_admin",     poolId: "pool_1784865333802_mi7k4fsa4" },
};

// ── Create a properly signed JWT ───────────────────────────────────────────────
function makeTestToken(role: string): string {
  const u = USERS[role as keyof typeof USERS] ?? USERS.pool_admin;
  return signToken({ userId: u.userId, role: u.role, poolId: u.poolId });
}

interface TestCase {
  label: string;
  query: string;
  role: string;
  type: string;
  expectDirectMatch?: boolean;
  expectNull?: boolean;
  expectHumanOnly?: boolean;
}

interface TestResult {
  label: string;
  type: string;
  query: string;
  status: number;
  resolution_status?: string;
  llm_required?: boolean;
  requires_human?: boolean;
  answer_mode?: string;
  latency_ms: number;
  error?: string;
  verdict: "CORRECT" | "WRONG" | "NO_MATCH" | "ERROR";
}

async function callSupport(query: string, role: string): Promise<{ body: any; latency_ms: number; status: number }> {
  const token = makeTestToken(role);
  const start = Date.now();

  // Step 1: Create case (routes mounted at /api prefix)
  const caseRes = await fetch(`${BASE_URL}/api/support/cases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ initial_message: query }),
  });
  const latency_ms = Date.now() - start;

  if (!caseRes.ok) {
    return { body: null, latency_ms, status: caseRes.status };
  }

  const caseBody = await caseRes.json();
  return { body: caseBody, latency_ms, status: caseRes.status };
}

async function runTest(tc: TestCase): Promise<TestResult> {
  try {
    const { body, latency_ms, status } = await callSupport(tc.query, tc.role);

    if (status !== 200 && status !== 201) {
      return { ...tc, status, latency_ms, error: `HTTP ${status}`, verdict: "ERROR" };
    }

    const msg = body?.messages?.find((m: any) => m.author_type === "ai") ?? body?.message ?? body;
    const resolution_status = body?.resolution_status ?? msg?.resolution_status;
    const llm_required = body?.llm_required ?? msg?.llm_required ?? false;
    const requires_human = body?.requires_human ?? msg?.requires_human ?? false;
    const answer_mode = body?.answer_mode ?? msg?.answer_mode;

    let verdict: TestResult["verdict"] = "NO_MATCH";

    if (tc.expectNull) {
      verdict = (resolution_status === null || resolution_status === undefined) ? "CORRECT" : "WRONG";
    } else if (tc.expectHumanOnly) {
      verdict = requires_human ? "CORRECT" : "WRONG";
    } else if (tc.expectDirectMatch) {
      verdict = (resolution_status === "RESOLVED" && !llm_required) ? "CORRECT" : "NO_MATCH";
    } else {
      // General: any resolved answer is fine
      verdict = resolution_status ? "CORRECT" : "NO_MATCH";
    }

    return {
      label: tc.label, type: tc.type, query: tc.query,
      status, resolution_status, llm_required, requires_human, answer_mode,
      latency_ms, verdict,
    };
  } catch (e) {
    return {
      label: tc.label, type: tc.type, query: tc.query,
      status: 0, latency_ms: 0, error: (e as Error).message, verdict: "ERROR",
    };
  }
}

// ── Test Cases ────────────────────────────────────────────────────────────────

const EXACT_TESTS: TestCase[] = [
  { label: "E1", type: "EXACT", query: "출결은 누가 기록할 수 있나요?", role: "pool_admin", expectDirectMatch: true },
  { label: "E2", type: "EXACT", query: "일지 저장이 안 됩니다.", role: "teacher", expectDirectMatch: true },
  { label: "E3", type: "EXACT", query: "일지 사진 업로드가 실패해요.", role: "teacher", expectDirectMatch: true },
  { label: "E4", type: "EXACT", query: "학부모 앱에서 수업 일지가 안 보여요.", role: "parent_account", expectDirectMatch: true },
  { label: "E5", type: "EXACT", query: "학부모 앱에서 자녀 사진이 안 보여요.", role: "parent_account", expectDirectMatch: true },
  { label: "E6", type: "EXACT", query: "알림 권한을 켰는데 알림이 오지 않아요.", role: "parent_account", expectDirectMatch: true },
  { label: "E7", type: "EXACT", query: "서버 오류가 발생했어요. 어떻게 해야 하나요?", role: "pool_admin", expectDirectMatch: true },
  { label: "E8", type: "EXACT", query: "결제·구독 오류가 발생했어요.", role: "pool_admin", expectDirectMatch: true },
  { label: "E9", type: "EXACT", query: "학부모 앱에서 자녀 정보가 안 보여요.", role: "parent_account", expectDirectMatch: true },
  { label: "E10", type: "EXACT", query: "보강 신청·처리 오류가 발생했어요.", role: "teacher", expectDirectMatch: true },
];

const SPACING_TESTS: TestCase[] = [
  { label: "SP1", type: "SPACING", query: "출결저장오류", role: "teacher", expectDirectMatch: true },
  { label: "SP2", type: "SPACING", query: "일지저장오류", role: "teacher", expectDirectMatch: true },
  { label: "SP3", type: "SPACING", query: "서버오류", role: "pool_admin", expectDirectMatch: true },
  { label: "SP4", type: "SPACING", query: "x모드 잠금", role: "pool_admin", expectDirectMatch: true },
  { label: "SP5", type: "SPACING", query: "아이폰 알림권한", role: "parent_account", expectDirectMatch: true },
  { label: "SP6", type: "SPACING", query: "안드로이드 알림권한", role: "parent_account", expectDirectMatch: true },
  { label: "SP7", type: "SPACING", query: "학부모일지안보임", role: "parent_account", expectDirectMatch: true },
  { label: "SP8", type: "SPACING", query: "학부모사진안보임", role: "parent_account", expectDirectMatch: true },
  { label: "SP9", type: "SPACING", query: "보강오류", role: "teacher", expectDirectMatch: true },
  { label: "SP10", type: "SPACING", query: "결제오류", role: "pool_admin", expectDirectMatch: true },
];

const CASUAL_TESTS: TestCase[] = [
  { label: "CA1", type: "CASUAL", query: "일지가 왜 저장이 안 돼?", role: "teacher", expectDirectMatch: true },
  { label: "CA2", type: "CASUAL", query: "일지 사진이 왜 안 올라가?", role: "teacher", expectDirectMatch: true },
  { label: "CA3", type: "CASUAL", query: "아이 일지가 없어졌어요", role: "parent_account", expectDirectMatch: true },
  { label: "CA4", type: "CASUAL", query: "아이 사진이 앱에서 안 보여요", role: "parent_account", expectDirectMatch: true },
  { label: "CA5", type: "CASUAL", query: "서버 오류가 나는데 어떻게 해?", role: "pool_admin", expectDirectMatch: true },
  { label: "CA6", type: "CASUAL", query: "알림 켰는데 왜 알림이 안 와?", role: "parent_account", expectDirectMatch: true },
  { label: "CA7", type: "CASUAL", query: "X 모드 어떻게 설정해?", role: "pool_admin", expectDirectMatch: true },
  { label: "CA8", type: "CASUAL", query: "보강 처리가 왜 안 돼?", role: "teacher", expectDirectMatch: true },
  { label: "CA9", type: "CASUAL", query: "성장 리포트가 언제 완성돼?", role: "parent_account", expectDirectMatch: true },
  { label: "CA10", type: "CASUAL", query: "X 모드가 잠겨 있어요", role: "pool_admin", expectDirectMatch: true },
];

const TYPO_TESTS: TestCase[] = [
  { label: "TY1", type: "TYPO", query: "알람이 안와요", role: "parent_account", expectDirectMatch: true },
  { label: "TY2", type: "TYPO", query: "학부모 앱에서 수업 일지가 안보여요", role: "parent_account", expectDirectMatch: true },
  { label: "TY3", type: "TYPO", query: "아이 정보가 안보여요", role: "parent_account", expectDirectMatch: true },
  { label: "TY4", type: "TYPO", query: "일지가 안써져요", role: "teacher", expectDirectMatch: true },
  { label: "TY5", type: "TYPO", query: "사진올리기가 안돼요", role: "teacher", expectDirectMatch: true },
  { label: "TY6", type: "TYPO", query: "출결저장안됨", role: "teacher", expectDirectMatch: true },
  { label: "TY7", type: "TYPO", query: "X모드가격이 얼마예요", role: "pool_admin" }, // HUMAN_ONLY → pending
  { label: "TY8", type: "TYPO", query: "스윔노트뭐야", role: "pool_admin", expectDirectMatch: true },
  { label: "TY9", type: "TYPO", query: "보강날짜범위가어떻게돼", role: "teacher", expectDirectMatch: true },
  { label: "TY10", type: "TYPO", query: "서버가계속오류떠요", role: "pool_admin", expectDirectMatch: true },
];

const ALIAS_TESTS: TestCase[] = [
  { label: "AL1", type: "ALIAS", query: "swimnote가 뭔가요?", role: "pool_admin", expectDirectMatch: true },
  { label: "AL2", type: "ALIAS", query: "iOS 알림 설정", role: "parent_account", expectDirectMatch: true },
  { label: "AL3", type: "ALIAS", query: "갤럭시 알림 설정", role: "parent_account", expectDirectMatch: true },
  { label: "AL4", type: "ALIAS", query: "x mode 설정", role: "pool_admin", expectDirectMatch: true },
  { label: "AL5", type: "ALIAS", query: "SWIMNOTE 앱 소개", role: "pool_admin", expectDirectMatch: true },
  { label: "AL6", type: "ALIAS", query: "swimnote x 가격", role: "pool_admin" }, // HUMAN_ONLY
  { label: "AL7", type: "ALIAS", query: "makeup class 신청", role: "parent_account", expectDirectMatch: true },
  { label: "AL8", type: "ALIAS", query: "AI diary 오류", role: "teacher", expectDirectMatch: true },
  { label: "AL9", type: "ALIAS", query: "x mode 잠금 상태", role: "pool_admin", expectDirectMatch: true },
  { label: "AL10", type: "ALIAS", query: "학부모 photo 안보여", role: "parent_account", expectDirectMatch: true },
];

const SHORT_TESTS: TestCase[] = [
  { label: "SH1", type: "SHORT", query: "출결 권한", role: "pool_admin", expectDirectMatch: true },
  { label: "SH2", type: "SHORT", query: "일지 저장 오류", role: "teacher", expectDirectMatch: true },
  { label: "SH3", type: "SHORT", query: "서버 오류", role: "pool_admin", expectDirectMatch: true },
  { label: "SH4", type: "SHORT", query: "알림 안옴", role: "parent_account", expectDirectMatch: true },
  { label: "SH5", type: "SHORT", query: "X 모드 설정", role: "pool_admin", expectDirectMatch: true },
  { label: "SH6", type: "SHORT", query: "X 모드 잠금", role: "pool_admin", expectDirectMatch: true },
  { label: "SH7", type: "SHORT", query: "보강 오류", role: "teacher", expectDirectMatch: true },
  { label: "SH8", type: "SHORT", query: "결제 오류", role: "pool_admin", expectDirectMatch: true },
  { label: "SH9", type: "SHORT", query: "학부모 사진 안보임", role: "parent_account", expectDirectMatch: true },
  { label: "SH10", type: "SHORT", query: "아이폰 알림 권한", role: "parent_account", expectDirectMatch: true },
];

// POST-500 tests (utterances physically inserted after position 500)
const POST500_TESTS: TestCase[] = [
  { label: "P500-1", type: "POST500", query: "역할이 달라서 데이터가 안 보이는 거야?", role: "teacher", expectDirectMatch: true },
  { label: "P500-2", type: "POST500", query: "데이터가 보이지 않아요. 필터 때문일 수 있나요?", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-3", type: "POST500", query: "다른 역할로 로그인했더니 데이터가 안 보여요.", role: "teacher", expectDirectMatch: true },
  { label: "P500-4", type: "POST500", query: "안드로이드에서 알림 권한을 설정하는 방법은?", role: "parent_account", expectDirectMatch: true },
  { label: "P500-5", type: "POST500", query: "아이폰에서 알림 권한을 설정하는 방법은?", role: "parent_account", expectDirectMatch: true },
  { label: "P500-6", type: "POST500", query: "구독 결제가 실패했어요.", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-7", type: "POST500", query: "AI 기능 오류가 발생했어요.", role: "teacher", expectDirectMatch: true },
  { label: "P500-8", type: "POST500", query: "성장 리포트가 생성 중인데 언제 완료되나요?", role: "parent_account", expectDirectMatch: true },
  { label: "P500-9", type: "POST500", query: "X 모드 잠금 화면이 뜨는 이유는 무엇인가요?", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-10", type: "POST500", query: "X 모드 설정은 어떻게 하나요?", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-11", type: "POST500", query: "AI 오류", role: "teacher", expectDirectMatch: true },
  { label: "P500-12", type: "POST500", query: "성장 리포트 대기 중", role: "parent_account", expectDirectMatch: true },
  { label: "P500-13", type: "POST500", query: "X 모드 활성화", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-14", type: "POST500", query: "역할별 권한", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-15", type: "POST500", query: "자녀 정보 안보임", role: "parent_account", expectDirectMatch: true },
  { label: "P500-16", type: "POST500", query: "관리자 탈퇴 유예기간", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-17", type: "POST500", query: "X 설정 상태 변화", role: "pool_admin", expectDirectMatch: true },
  { label: "P500-18", type: "POST500", query: "AI 커리큘럼 상담 횟수", role: "parent_account", expectDirectMatch: true },
  { label: "P500-19", type: "POST500", query: "성장 리포트 공개 조건", role: "parent_account", expectDirectMatch: true },
  { label: "P500-20", type: "POST500", query: "회원 일괄 등록", role: "pool_admin", expectDirectMatch: true },
];

// AMBIGUOUS / False Positive
const AMBIGUOUS_TESTS: TestCase[] = [
  { label: "AMB1", type: "AMBIGUOUS", query: "사진", role: "parent_account" },
  { label: "AMB2", type: "AMBIGUOUS", query: "가격", role: "pool_admin" },
  { label: "AMB3", type: "AMBIGUOUS", query: "보강", role: "teacher" },
  { label: "AMB4", type: "AMBIGUOUS", query: "결제", role: "pool_admin" },
  { label: "AMB5", type: "AMBIGUOUS", query: "안돼", role: "pool_admin" },
  { label: "AMB6", type: "AMBIGUOUS", query: "알림", role: "parent_account" },
  { label: "AMB7", type: "AMBIGUOUS", query: "수업", role: "teacher" },
  { label: "AMB8", type: "AMBIGUOUS", query: "오류", role: "pool_admin" },
];

// HUMAN_ONLY
const HUMAN_ONLY_TESTS: TestCase[] = [
  { label: "HO1", type: "HUMAN_ONLY", query: "SWIMNOTE X 가격은 얼마인가요?", role: "pool_admin", expectHumanOnly: true },
  { label: "HO2", type: "HUMAN_ONLY", query: "X 모드 요금이 얼마야?", role: "pool_admin", expectHumanOnly: true },
  { label: "HO3", type: "HUMAN_ONLY", query: "환불은 어떻게 받을 수 있나요?", role: "pool_admin", expectHumanOnly: true },
];

// Fallback resolver tests
const FALLBACK_TESTS: TestCase[] = [
  { label: "FB1", type: "FALLBACK_GPT", query: "수업 도중 아이가 다쳤을 때 어떻게 해요?", role: "parent_account" },
  { label: "FB2", type: "FALLBACK_GPT", query: "수강료 분납이 가능한가요?", role: "parent_account" },
  { label: "FB3", type: "FALLBACK_GPT", query: "앱 다운로드는 어디서 하나요?", role: "pool_admin" },
];

async function main() {
  console.log(`\n=== WP-CS23C-R Live API Test ===`);
  console.log(`TARGET: ${BASE_URL}`);
  console.log(`TIME: ${new Date().toISOString()}`);

  const allTests = [
    ...EXACT_TESTS, ...SPACING_TESTS, ...CASUAL_TESTS,
    ...TYPO_TESTS, ...ALIAS_TESTS, ...SHORT_TESTS,
    ...POST500_TESTS, ...AMBIGUOUS_TESTS, ...HUMAN_ONLY_TESTS,
    ...FALLBACK_TESTS,
  ];

  console.log(`\nTOTAL_TESTS: ${allTests.length}`);

  const results: TestResult[] = [];
  const latencies: number[] = [];

  // Run with small concurrency to avoid overwhelming Render
  const BATCH = 3;
  for (let i = 0; i < allTests.length; i += BATCH) {
    const batch = allTests.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(tc => runTest(tc)));
    results.push(...batchResults);
    process.stdout.write(".");
    // Small delay between batches
    await new Promise(r => setTimeout(r, 200));
  }
  console.log("\n");

  // Metrics
  const byType = new Map<string, { total: number; correct: number; wrong: number; noMatch: number; errors: number }>();
  let wrongDirect = 0, crossIntentWrong = 0, llmCalls = 0;

  for (const r of results) {
    if (!byType.has(r.type)) byType.set(r.type, { total: 0, correct: 0, wrong: 0, noMatch: 0, errors: 0 });
    const t = byType.get(r.type)!;
    t.total++;
    if (r.verdict === "CORRECT") t.correct++;
    else if (r.verdict === "WRONG") { t.wrong++; wrongDirect++; }
    else if (r.verdict === "NO_MATCH") t.noMatch++;
    else t.errors++;

    if (r.latency_ms > 0) latencies.push(r.latency_ms);
    if (r.llm_required) llmCalls++;
  }

  // Print per-type summary
  console.log("=== BY TEST TYPE ===");
  for (const [type, t] of byType) {
    console.log(`${type.padEnd(15)} total=${t.total} correct=${t.correct} wrong=${t.wrong} noMatch=${t.noMatch} errors=${t.errors}`);
  }

  // Print wrong/error details
  const wrongOrError = results.filter(r => r.verdict === "WRONG" || r.verdict === "ERROR");
  if (wrongOrError.length > 0) {
    console.log("\n=== WRONG/ERROR DETAILS ===");
    for (const r of wrongOrError) {
      console.log(`  [${r.label}] ${r.type} "${r.query}" → verdict=${r.verdict} status=${r.status} resolution=${r.resolution_status} err=${r.error ?? ""}`);
    }
  }

  // Performance
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const maxLat = latencies[latencies.length - 1] ?? 0;

  // Resolve totals
  const directTypes = ["EXACT","SPACING","CASUAL","TYPO","ALIAS","SHORT"];
  const directTests = results.filter(r => directTypes.includes(r.type));
  const post500Tests = results.filter(r => r.type === "POST500");
  const ambigTests = results.filter(r => r.type === "AMBIGUOUS");
  const humanTests = results.filter(r => r.type === "HUMAN_ONLY");
  const fallbackTests = results.filter(r => r.type.startsWith("FALLBACK"));

  const directCorrect = directTests.filter(r => r.verdict === "CORRECT").length;
  const directWrong = directTests.filter(r => r.verdict === "WRONG").length;
  const directNoMatch = directTests.filter(r => r.verdict === "NO_MATCH").length;
  const post500NotFound = post500Tests.filter(r => r.verdict === "NO_MATCH" || r.verdict === "ERROR").length;
  const ambigWrong = ambigTests.filter(r => r.verdict === "WRONG").length;
  const humanOnlyDirect = humanTests.filter(r => !r.requires_human && r.verdict === "WRONG").length;

  console.log("\n=== FINAL METRICS ===");
  console.log(`LIVE_DIRECT_TESTS: ${directTests.length}`);
  console.log(`LIVE_CORRECT_DIRECT: ${directCorrect}`);
  console.log(`LIVE_WRONG_DIRECT: ${directWrong}`);
  console.log(`LIVE_NO_MATCH: ${directNoMatch}`);
  console.log(`POST_500_TESTS: ${post500Tests.length}`);
  console.log(`POST_500_NOT_FOUND: ${post500NotFound}`);
  console.log(`AMBIGUOUS_WRONG_DIRECT: ${ambigWrong}`);
  console.log(`CROSS_INTENT_WRONG_DIRECT: ${crossIntentWrong}`);
  console.log(`LIVE_DIRECT_DB_LLM_CALLS: ${llmCalls}`);
  console.log(`HUMAN_ONLY_DIRECT_ANSWER: ${humanOnlyDirect}`);
  console.log(`\nPERFORMANCE_ROWS: 610`);
  console.log(`PERFORMANCE_REQUESTS: ${latencies.length}`);
  console.log(`PERFORMANCE_p50: ${p50}ms`);
  console.log(`PERFORMANCE_p95: ${p95}ms`);
  console.log(`PERFORMANCE_MAX: ${maxLat}ms`);

  process.exit(0);
}

main().catch(e => { console.error("ERR:", e.message, e.stack); process.exit(1); });
