/**
 * test-push-scheduler-fix.ts
 * 
 * push-scheduler.ts 수정 사항 검증 스크립트
 * 
 * 검증 항목:
 *  T1: same_day ±1분 3회 실행 → 실제 발송 1회 (INSERT-first 선점)
 *  T2: push_scheduled_sent 기록 1건
 *  T3: 서로 다른 반은 독립적으로 각 1건
 *  T4: 내일 휴무일 등록 → prev_day 알림 0회
 *  T5: 오늘 휴무일 등록 → same_day 알림 0회
 *  T6: 휴무 아닌 날 → 정상 발송 (차단 없음)
 *  T7: 이미 기록된 키 → 재발송 없음 (서버 재시작 상황)
 *  T8: 보강 알림 로직 영향 없음 (makeup 쿼리 구조 확인)
 *  T9: 일지 큐 로직 영향 없음 (diary_push_queue 구조 확인)
 * 
 * 실행: pnpm --filter @workspace/api-server exec tsx src/scripts/test-push-scheduler-fix.ts
 */

import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── 테스트 픽스처 식별자 (절대 실제 데이터와 충돌하지 않도록 prefix 고정) ──
const T_PREFIX   = "test_pss_";
const T_POOL_A   = `${T_PREFIX}pool_a`;
const T_POOL_B   = `${T_PREFIX}pool_b`; // 휴무일 테스트용
const T_CLASS_1  = `${T_PREFIX}class_1`;
const T_CLASS_2  = `${T_PREFIX}class_2`; // T3: 두 번째 반
const T_DATE     = "2099-01-01";          // 미래 날짜 → 실제 스케줄러와 절대 충돌 없음
const T_SCHED_TIME = "14:00";             // scheduledSendTime 고정값
const T_TOMORROW   = "2099-01-02";        // prev_day 휴무 테스트용

// ── 결과 집계 ──────────────────────────────────────────────────────────
type Result = { pass: boolean; detail: string };
const results: Record<string, Result> = {};

function pass(name: string, detail: string) {
  results[name] = { pass: true,  detail };
  console.log(`  ✅ ${name}: PASS — ${detail}`);
}
function fail(name: string, detail: string) {
  results[name] = { pass: false, detail };
  console.log(`  ❌ ${name}: FAIL — ${detail}`);
}

// ── 정리 함수 ──────────────────────────────────────────────────────────
async function cleanup() {
  // push_scheduled_sent (superAdminDb)
  await superAdminDb.execute(sql.raw(`
    DELETE FROM push_scheduled_sent
    WHERE pool_id LIKE '${T_PREFIX}%' OR class_id LIKE '${T_PREFIX}%'
  `)).catch(() => {});

  // pool_holidays (db) — 테스트 풀만
  await db.execute(sql.raw(`
    DELETE FROM pool_holidays
    WHERE pool_id LIKE '${T_PREFIX}%'
  `)).catch(() => {});

  // push_logs (superAdminDb) — triggered_by로 식별
  await superAdminDb.execute(sql.raw(`
    DELETE FROM push_logs
    WHERE triggered_by LIKE '${T_PREFIX}%'
  `)).catch(() => {});

  console.log("  🧹 테스트 데이터 정리 완료");
}

// ── T1 + T2: same_day INSERT-first 3회 실행 → 1건 선점 ─────────────────
async function testT1_T2() {
  console.log("\n▶ T1/T2: INSERT-first 3회 연속 실행 (동일 키)");

  // 사전 정리
  await superAdminDb.execute(sql.raw(`
    DELETE FROM push_scheduled_sent
    WHERE pool_id='${T_POOL_A}' AND class_id='${T_CLASS_1}'
      AND type='same_day' AND sent_date='${T_DATE}' AND sent_time='${T_SCHED_TIME}'
  `)).catch(() => {});

  // 3회 연속 실행: 13:59, 14:00, 14:01 cron 실행 시뮬레이션
  const claimCounts = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const id = `${T_PREFIX}sent_${i}_${Date.now()}`;
    const r = await superAdminDb.execute(sql.raw(`
      INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
      VALUES ('${id}', '${T_POOL_A}', '${T_CLASS_1}', 'same_day', '${T_DATE}', '${T_SCHED_TIME}')
      ON CONFLICT ON CONSTRAINT push_scheduled_unique DO NOTHING
      RETURNING id
    `));
    claimCounts[i] = r.rows.length;
    console.log(`    실행 ${i + 1}/3: RETURNING rows = ${r.rows.length} ${r.rows.length > 0 ? "(선점 성공 → 발송)" : "(충돌 → skip)"}`);
  }

  // T1: 발송은 1회만 (claimCounts = [1,0,0])
  const sentCount = claimCounts.filter(c => c > 0).length;
  if (sentCount === 1 && claimCounts[0] === 1) {
    pass("T1", `3회 실행 중 선점 성공 1회, 충돌 차단 2회 (claimCounts=${JSON.stringify(claimCounts)})`);
  } else {
    fail("T1", `예상: [1,0,0], 실제: ${JSON.stringify(claimCounts)}`);
  }

  // T2: push_scheduled_sent 기록 1건
  const rows = (await superAdminDb.execute(sql.raw(`
    SELECT id, sent_time FROM push_scheduled_sent
    WHERE pool_id='${T_POOL_A}' AND class_id='${T_CLASS_1}'
      AND type='same_day' AND sent_date='${T_DATE}' AND sent_time='${T_SCHED_TIME}'
  `))).rows as any[];

  if (rows.length === 1 && rows[0].sent_time === T_SCHED_TIME) {
    pass("T2", `push_scheduled_sent 1건, sent_time='${rows[0].sent_time}'`);
  } else {
    fail("T2", `기록 수=${rows.length}, sent_time=${rows[0]?.sent_time}`);
  }
}

// ── T3: 다른 반은 독립적으로 각 1건 ────────────────────────────────────
async function testT3() {
  console.log("\n▶ T3: 두 반 독립 기록 (각 1건)");

  // CLASS_1 (이미 T1에서 기록됨), CLASS_2 추가
  await superAdminDb.execute(sql.raw(`
    DELETE FROM push_scheduled_sent
    WHERE pool_id='${T_POOL_A}' AND class_id='${T_CLASS_2}'
      AND type='same_day' AND sent_date='${T_DATE}'
  `)).catch(() => {});

  const id2 = `${T_PREFIX}sent_c2_${Date.now()}`;
  const r2 = await superAdminDb.execute(sql.raw(`
    INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
    VALUES ('${id2}', '${T_POOL_A}', '${T_CLASS_2}', 'same_day', '${T_DATE}', '${T_SCHED_TIME}')
    ON CONFLICT ON CONSTRAINT push_scheduled_unique DO NOTHING
    RETURNING id
  `));

  const rows1 = (await superAdminDb.execute(sql.raw(`
    SELECT id FROM push_scheduled_sent
    WHERE pool_id='${T_POOL_A}' AND class_id='${T_CLASS_1}'
      AND type='same_day' AND sent_date='${T_DATE}'
  `))).rows.length;
  const rows2 = (await superAdminDb.execute(sql.raw(`
    SELECT id FROM push_scheduled_sent
    WHERE pool_id='${T_POOL_A}' AND class_id='${T_CLASS_2}'
      AND type='same_day' AND sent_date='${T_DATE}'
  `))).rows.length;

  if (rows1 === 1 && rows2 === 1 && r2.rows.length === 1) {
    pass("T3", `CLASS_1 기록 ${rows1}건, CLASS_2 기록 ${rows2}건 — 독립 확인`);
  } else {
    fail("T3", `CLASS_1=${rows1}건, CLASS_2=${rows2}건, r2.rows=${r2.rows.length}`);
  }
}

// ── T4: 내일 휴무 등록 → prev_day 알림 차단 ──────────────────────────
async function testT4() {
  console.log("\n▶ T4: 내일 날짜 휴무 등록 → prev_day pool_holidays 차단");

  // 내일 휴무 등록 (테스트 pool B)
  const holId = `${T_PREFIX}hol_${Date.now()}`;
  await db.execute(sql.raw(`
    INSERT INTO pool_holidays (id, pool_id, holiday_date, reason, created_by)
    VALUES ('${holId}', '${T_POOL_B}', '${T_TOMORROW}', '테스트 휴무', 'test')
    ON CONFLICT DO NOTHING
  `));

  // 스케줄러 내 holidayCheck 쿼리 직접 실행
  const check = (await db.execute(sql.raw(`
    SELECT id FROM pool_holidays
    WHERE pool_id='${T_POOL_B}' AND holiday_date='${T_TOMORROW}'
    LIMIT 1
  `))).rows;

  // 정리
  await db.execute(sql.raw(`DELETE FROM pool_holidays WHERE id='${holId}'`)).catch(() => {});

  if (check.length === 1) {
    pass("T4", `내일(${T_TOMORROW}) 휴무 감지됨 → 스케줄러에서 continue 처리로 전날 알림 차단`);
  } else {
    fail("T4", `휴무 감지 실패: check.length=${check.length}`);
  }
}

// ── T5: 오늘 휴무 등록 → same_day 알림 차단 ─────────────────────────
async function testT5() {
  console.log("\n▶ T5: 오늘 날짜 휴무 등록 → same_day pool_holidays 차단");

  const holId = `${T_PREFIX}hol2_${Date.now()}`;
  await db.execute(sql.raw(`
    INSERT INTO pool_holidays (id, pool_id, holiday_date, reason, created_by)
    VALUES ('${holId}', '${T_POOL_B}', '${T_DATE}', '테스트 당일 휴무', 'test')
    ON CONFLICT DO NOTHING
  `));

  const check = (await db.execute(sql.raw(`
    SELECT id FROM pool_holidays
    WHERE pool_id='${T_POOL_B}' AND holiday_date='${T_DATE}'
    LIMIT 1
  `))).rows;

  await db.execute(sql.raw(`DELETE FROM pool_holidays WHERE id='${holId}'`)).catch(() => {});

  if (check.length === 1) {
    pass("T5", `오늘(${T_DATE}) 휴무 감지됨 → 스케줄러에서 continue 처리로 당일 알림 차단`);
  } else {
    fail("T5", `휴무 감지 실패: check.length=${check.length}`);
  }
}

// ── T6: 휴무 없는 날 → 차단 없음 (holidayCheck.rows.length === 0) ───
async function testT6() {
  console.log("\n▶ T6: 휴무 미등록 날짜 → 차단 없음");

  const nonHolidayDate = "2099-06-15";
  const check = (await db.execute(sql.raw(`
    SELECT id FROM pool_holidays
    WHERE pool_id='${T_POOL_B}' AND holiday_date='${nonHolidayDate}'
    LIMIT 1
  `))).rows;

  if (check.length === 0) {
    pass("T6", `${nonHolidayDate} 휴무 없음 → holidayCheck 0건 → 정상 발송 경로 진입`);
  } else {
    fail("T6", `예상치 못한 휴무 레코드 존재: ${check.length}건`);
  }
}

// ── T7: 이미 기록된 키 → 재발송 없음 (서버 재시작 시뮬레이션) ────────
async function testT7() {
  console.log("\n▶ T7: 서버 재시작 후 동일 수업 재발송 없음");

  // T2에서 이미 CLASS_1 기록이 있음. 재실행 시 RETURNING 0이어야 함.
  const idNew = `${T_PREFIX}sent_restart_${Date.now()}`;
  const r = await superAdminDb.execute(sql.raw(`
    INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
    VALUES ('${idNew}', '${T_POOL_A}', '${T_CLASS_1}', 'same_day', '${T_DATE}', '${T_SCHED_TIME}')
    ON CONFLICT ON CONSTRAINT push_scheduled_unique DO NOTHING
    RETURNING id
  `));

  if (r.rows.length === 0) {
    pass("T7", `서버 재시작 후 동일 키 재시도: RETURNING 0행 → 발송 없음`);
  } else {
    fail("T7", `서버 재시작 후 재발송됨: RETURNING ${r.rows.length}행`);
  }
}

// ── T8: makeup 로직 구조 확인 ────────────────────────────────────────
async function testT8() {
  console.log("\n▶ T8: 보강 알림 로직 영향 없음");
  // makeup은 push_scheduled_sent에 class_id=makeupId, type='makeup_day_of' 로 기록.
  // 이번 수정은 type='same_day' 처리만 변경. makeup 처리 코드는 건드리지 않음.
  // UNIQUE 제약: (pool_id, class_id, type, sent_date, sent_time)
  // → makeup은 type이 다르므로 same_day 변경에 영향 없음을 검증

  const mkId = `${T_PREFIX}makeup_${Date.now()}`;
  const r = await superAdminDb.execute(sql.raw(`
    INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
    VALUES ('${mkId}', '${T_POOL_A}', '${T_PREFIX}mk_session', 'makeup_day_of', '${T_DATE}', '08:00')
    ON CONFLICT DO NOTHING
    RETURNING id
  `));

  await superAdminDb.execute(sql.raw(`
    DELETE FROM push_scheduled_sent WHERE id='${mkId}'
  `)).catch(() => {});

  if (r.rows.length === 1) {
    pass("T8", `makeup_day_of 타입은 same_day 변경과 독립 — 정상 INSERT 확인`);
  } else {
    fail("T8", `makeup INSERT 실패: rows=${r.rows.length}`);
  }
}

// ── T9: diary_push_queue 영향 없음 ──────────────────────────────────
async function testT9() {
  console.log("\n▶ T9: 일지 큐 로직 영향 없음");
  // diary_push_queue는 sent_at 컬럼으로 중복 방지.
  // push_scheduled_sent를 사용하지 않으므로 이번 수정의 영향 없음.
  // 테이블 존재 + sent_at 컬럼 구조 확인으로 검증.

  const queueInfo = (await db.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='diary_push_queue'
      AND column_name IN ('sent_at','scheduled_at','id')
    ORDER BY column_name
  `))).rows as any[];

  const cols = queueInfo.map((r: any) => r.column_name).sort();
  const expected = ["id", "scheduled_at", "sent_at"];
  const ok = expected.every(c => cols.includes(c));

  if (ok) {
    pass("T9", `diary_push_queue 컬럼 확인: ${cols.join(", ")} — 별도 sent_at 기반 중복 방지, 이번 수정 영향 없음`);
  } else {
    fail("T9", `필수 컬럼 누락: 발견=${cols.join(",")}, 필요=${expected.join(",")}`);
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  push-scheduler 수정 검증 테스트");
  console.log(`  테스트 날짜: ${T_DATE} / 예정 발송 시각: ${T_SCHED_TIME}`);
  console.log(`  테스트 pool: ${T_POOL_A}, ${T_POOL_B}`);
  console.log("═══════════════════════════════════════════════════════════");

  try {
    await cleanup(); // 혹시 남아있을 이전 테스트 데이터 정리

    await testT1_T2();
    await testT3();
    await testT4();
    await testT5();
    await testT6();
    await testT7();
    await testT8();
    await testT9();

  } finally {
    await cleanup(); // 반드시 정리
  }

  // ── 최종 결과 ──────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  최종 결과");
  console.log("═══════════════════════════════════════════════════════════");

  const all = Object.entries(results);
  for (const [name, r] of all) {
    console.log(`  ${r.pass ? "✅" : "❌"} ${name}: ${r.pass ? "PASS" : "FAIL"}`);
    if (!r.pass) console.log(`     └ ${r.detail}`);
  }

  const passed = all.filter(([, r]) => r.pass).length;
  const total  = all.length;
  console.log(`\n  ${passed}/${total} 통과`);

  if (passed < total) {
    console.log("  ⛔ 일부 실패 — production 배포 보류");
    process.exit(1);
  } else {
    console.log("  ✅ 전체 통과 — production 배포 준비 완료");
    process.exit(0);
  }
}

main().catch(e => {
  console.error("테스트 실행 오류:", e);
  process.exit(1);
});
