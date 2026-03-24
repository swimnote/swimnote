/**
 * STAGE 8 — 실제 결제 → 매출 로그 생성 검증
 * 실행: node stage8_sim.mjs
 *
 * 검증 대상:
 *   G. 결제 발생 → revenue_logs 생성 (charged_amount, store_fee, net_revenue, plan_id)
 *   H. 복수 결제 → 플랜별 집계 (revenue-by-plan) 일치 여부
 *   I. 환불 → refunded_amount 기록
 *   J. 결제 실패 후 재결제 → 신규 revenue_logs 생성 (기존 덮어쓰기 없음)
 *
 * 버그 판정 기준:
 *   - 결제했는데 revenue_logs 없음
 *   - charged_amount = 0
 *   - plan_id 누락
 *   - store_fee != Math.round(charged_amount * 0.3)
 *   - net_revenue != charged_amount - store_fee
 *   - super 화면(revenue-by-plan / revenue-by-pool) 미반영
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const BASE   = 'http://localhost:8080/api';
const SECRET = 'swim-platform-secret-key-2024';

// ── 결과 수집 ─────────────────────────────────────────────
const R = { pass: [], fail: [], warn: [], bug: [] };
function pass(s, d='') { R.pass.push(s); console.log(`  ✅ PASS  ${s}${d?' — '+d:''}`); }
function fail(s, d='') { R.fail.push(s); console.error(`  ❌ FAIL  ${s}${d?' — '+d:''}`); }
function warn(s, d='') { R.warn.push(s); console.warn(`  ⚠️  WARN  ${s}${d?' — '+d:''}`); }
function bug(s, d='')  { R.bug.push(s);  console.error(`  🐛 BUG   ${s}${d?' — '+d:''}`); }
function section(t)    { console.log(`\n${'═'.repeat(64)}\n  ${t}\n${'═'.repeat(64)}`); }
function sub(t)        { console.log(`\n  ── ${t} ──`); }

function tok(userId, role, poolId=null) {
  const p = { userId, role };
  if (poolId) p.poolId = poolId;
  return jwt.sign(p, SECRET, { expiresIn: '1d' });
}
async function api(method, path, body, token) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: null, err: e.message };
  }
}

// ── 상수 ─────────────────────────────────────────────────
const SUPER    = tok('user_super_admin_1773418927301', 'super_admin');
const POOL_A   = 'pool_aquastar_002';
const ADM_A    = tok('user_pool_admin_aquastar',     'pool_admin', POOL_A);
const POOL_B   = 'pool_toykids_001';
const ADM_B    = tok('user_pool_admin_002',          'pool_admin', POOL_B);
const POOL_C   = 'pool_1774021648896_yrxhdasr8';
const ADM_C    = tok('user_1774021584696_nq3yxqzv6', 'pool_admin', POOL_C);

// 테스트 전 revenue_logs 기준 카운트
let baseRevCount = 0;

// =========================================================
// 공통 유틸 — revenue_logs 조회
// =========================================================
async function fetchRevLogs(poolId = null) {
  const q = poolId ? `?pool_id_filter=${poolId}` : '';
  const r = await api('GET', `/billing/revenue-logs${q}`, null, SUPER);
  if (!r.ok) return [];
  const rows = r.data?.logs ?? r.data ?? [];
  if (!Array.isArray(rows)) return [];
  return poolId ? rows.filter(l => l.pool_id === poolId) : rows;
}

async function registerCard(adminTok) {
  const r = await api('POST', '/billing/cards', {
    card_number: '4111111111111111',
    expiry: '12/26',
    birth_or_biz: '900101',
    password: '11',
    card_nickname: '테스트카드',
  }, adminTok);
  return r;
}

async function resetToFree(adminTok) {
  return await api('POST', '/billing/subscribe', { tier: 'free' }, adminTok);
}

// =========================================================
// 시나리오 G — 결제 발생 → revenue_logs 생성 검증
// =========================================================
async function scenarioG() {
  section('시나리오 G — 결제 발생 → revenue_logs 생성 검증');

  // G0. 기준 카운트
  sub('G0. 사전 기준 revenue_logs 카운트');
  const before = await fetchRevLogs();
  baseRevCount = before.length;
  pass('기준 카운트', `${baseRevCount}건`);

  // G1. 카드 등록
  sub('G1. 아쿠아스타 — mock 카드 등록');
  await resetToFree(ADM_A);                      // 먼저 free로 초기화
  const card = await registerCard(ADM_A);
  if (card.ok || card.data?.card || card.data?.id || card.status === 409) {
    pass('카드 등록 성공 (또는 기존 카드 존재)', `status=${card.status}`);
  } else if (card.status === 400 && card.data?.error?.includes('카드번호')) {
    warn('mock 카드 형식 오류 — 기존 카드 사용');
  } else {
    warn('카드 등록', `status=${card.status} ${JSON.stringify(card.data).slice(0,80)}`);
  }

  // G2. free → starter 구독 (첫 결제 50% 할인)
  sub('G2. free → starter 구독 (첫 결제 50% 할인 적용 예상)');
  // starter = 2,900원, 첫 결제 50% = 1,450원 과금
  const subResult = await api('POST', '/billing/subscribe', { tier: 'starter' }, ADM_A);
  if (subResult.ok) {
    const d = subResult.data;
    pass('starter 구독 성공', `change_type=${d.change_type}, charged=${d.charged_amount}, gross=${d.gross_amount}`);
    if (d.first_payment_discount === true) {
      pass('첫 결제 50% 할인 적용', `gross=2900, charged=1450`);
    } else {
      warn('첫 결제 할인 미적용 (이미 사용 여부 확인 필요)', `charged_amount=${d.charged_amount}`);
    }
  } else {
    fail('starter 구독 실패', JSON.stringify(subResult.data));
    return; // 이후 검증 불가
  }

  // G3. revenue_logs 생성 확인
  sub('G3. revenue_logs 생성 확인');
  await new Promise(r => setTimeout(r, 300)); // DB 반영 대기
  const afterLogs = await fetchRevLogs(POOL_A);
  if (afterLogs.length === 0) {
    bug('결제 완료했는데 revenue_logs 없음 — 가장 치명적 버그');
    return;
  }
  const latest = afterLogs[0];
  pass('revenue_logs 생성 확인', `총 ${afterLogs.length}건`);

  // G4. 핵심 필드 검증
  sub('G4. revenue_logs 핵심 필드 검증');

  // plan_id
  if (latest.plan_id && latest.plan_id !== '') {
    pass('plan_id 존재', `${latest.plan_id}`);
  } else {
    bug('plan_id 누락', JSON.stringify(latest));
  }

  // plan_name
  if (latest.plan_name) {
    pass('plan_name 존재', `${latest.plan_name}`);
  } else {
    warn('plan_name 없음');
  }

  // charged_amount
  const charged = Number(latest.charged_amount ?? 0);
  if (charged > 0) {
    pass('charged_amount > 0', `${charged.toLocaleString()}원`);
  } else {
    bug('charged_amount = 0 또는 없음', JSON.stringify(latest));
  }

  // store_fee = Math.round(charged * 0.3)
  const expectedFee = Math.round(charged * 0.3);
  const actualFee = Number(latest.store_fee ?? 0);
  if (actualFee === expectedFee) {
    pass('store_fee 계산 정확', `${actualFee} = ${charged} × 0.3`);
  } else {
    bug('store_fee 계산 오류', `expected=${expectedFee}, actual=${actualFee}`);
  }

  // net_revenue = charged - store_fee
  const expectedNet = charged - actualFee;
  const actualNet = Number(latest.net_revenue ?? 0);
  if (actualNet === expectedNet) {
    pass('net_revenue 계산 정확', `${actualNet} = ${charged} - ${actualFee}`);
  } else {
    bug('net_revenue 계산 오류', `expected=${expectedNet}, actual=${actualNet}`);
  }

  // created_at / occurred_at
  if (latest.created_at || latest.occurred_at) {
    pass('created_at / occurred_at 존재', `${(latest.occurred_at ?? latest.created_at).slice(0,19)}`);
  } else {
    bug('created_at 없음');
  }

  // event_type
  if (latest.event_type) {
    pass('event_type 존재', `${latest.event_type}`);
  } else {
    warn('event_type 없음');
  }

  // pool_name
  if (latest.pool_name) {
    pass('pool_name 존재', `${latest.pool_name}`);
  } else {
    warn('pool_name 없음');
  }

  // 레거시 amount 컬럼 = 0 여부 (recordPayment가 amount를 사용하지 않음)
  if (typeof latest.amount !== 'undefined') {
    if (Number(latest.amount) === 0) {
      warn('레거시 amount 컬럼 = 0 (charged_amount 사용 중 — 레거시 컬럼 잔존)', `amount=${latest.amount}, charged_amount=${charged}`);
    } else {
      pass('amount 컬럼', `${latest.amount}`);
    }
  }

  // G5. gross_amount / intro_discount 검증
  sub('G5. gross_amount / intro_discount_amount 검증');
  const gross   = Number(latest.gross_amount ?? 0);
  const discount = Number(latest.intro_discount_amount ?? 0);
  if (gross > 0) {
    pass('gross_amount 존재', `${gross.toLocaleString()}원`);
    if (discount > 0) {
      pass('intro_discount_amount (첫 달 할인)', `${discount.toLocaleString()}원`);
      if (gross - discount === charged) {
        pass('gross - discount = charged 일치', `${gross} - ${discount} = ${charged}`);
      } else {
        bug('gross - discount ≠ charged 불일치', `${gross} - ${discount} ≠ ${charged}`);
      }
    } else {
      warn('intro_discount_amount = 0 (첫 결제 할인 미적용 또는 이미 사용됨)');
    }
  } else {
    bug('gross_amount = 0', JSON.stringify(latest));
  }
}

// =========================================================
// 시나리오 H — 복수 결제 → 플랜별 집계 검증
// =========================================================
async function scenarioH() {
  section('시나리오 H — 복수 결제 (3개 플랜) → revenue-by-plan 집계 검증');

  // 현재 revenue_logs 기준값
  const beforeAll = await fetchRevLogs();
  const beforeCount = beforeAll.length;
  pass('H 시작 revenue_logs 카운트', `${beforeCount}건`);

  // H1. 아쿠아스타 → standard 업그레이드
  sub('H1. 아쿠아스타 → standard 업그레이드 (9,900원)');
  const rA = await api('POST', '/billing/subscribe', { tier: 'standard' }, ADM_A);
  if (rA.ok) {
    pass('standard 업그레이드', `charged=${rA.data?.charged_amount}`);
  } else {
    fail('standard 업그레이드', JSON.stringify(rA.data));
  }

  // H2. 토이키즈 — 카드 등록 + basic 구독
  sub('H2. 토이키즈 — 카드 등록 + basic 구독 (3,900원)');
  await resetToFree(ADM_B);
  await registerCard(ADM_B);
  const rB = await api('POST', '/billing/subscribe', { tier: 'basic' }, ADM_B);
  if (rB.ok) {
    pass('토이키즈 basic 구독', `charged=${rB.data?.charged_amount}`);
  } else {
    fail('토이키즈 basic 구독', JSON.stringify(rB.data));
  }

  // H3. 비타스위밍 — 카드 등록 + growth 구독 (29,000원)
  sub('H3. 비타스위밍 → growth 구독 (29,000원)');
  await resetToFree(ADM_C);
  await registerCard(ADM_C);
  const rC = await api('POST', '/billing/subscribe', { tier: 'growth' }, ADM_C);
  if (rC.ok) {
    pass('비타스위밍 growth 구독', `charged=${rC.data?.charged_amount}`);
  } else {
    fail('비타스위밍 growth 구독', JSON.stringify(rC.data));
  }

  // H4. revenue_logs 건수 증가 확인
  sub('H4. revenue_logs 건수 증가 확인');
  await new Promise(r => setTimeout(r, 500));
  const afterAll = await fetchRevLogs();
  const newCount = afterAll.length - beforeCount;
  if (newCount >= 2) {
    pass('신규 revenue_logs 추가', `+${newCount}건 (기존=${beforeCount}, 현재=${afterAll.length})`);
  } else {
    fail('신규 revenue_logs 미생성', `기존=${beforeCount}, 현재=${afterAll.length}`);
  }

  // H5. revenue-by-plan 집계 확인
  sub('H5. revenue-by-plan 집계 확인');
  const byPlan = await api('GET', '/billing/revenue-by-plan', null, SUPER);
  if (byPlan.ok && Array.isArray(byPlan.data)) {
    pass('revenue-by-plan 응답', `${byPlan.data.length}개 플랜`);
    byPlan.data.forEach(p => {
      const t = Number(p.total_amount ?? 0);
      const f = Number(p.total_store_fee ?? 0);
      const n = Number(p.total_net_revenue ?? 0);
      const expectedFee = Math.round(t * 0.3);
      if (Math.abs(f - expectedFee) <= 1) {
        pass(`[${p.plan_id}] fee 계산 정확`, `total=${t.toLocaleString()}, fee=${f}, net=${n}`);
      } else {
        bug(`[${p.plan_id}] fee 계산 오류`, `total=${t}, fee=${f} (expected=${expectedFee})`);
      }
    });
  } else {
    fail('revenue-by-plan', JSON.stringify(byPlan.data));
  }

  // H6. revenue-by-pool 집계 확인
  sub('H6. revenue-by-pool 집계 확인');
  const byPool = await api('GET', '/billing/revenue-by-pool', null, SUPER);
  if (byPool.ok && Array.isArray(byPool.data)) {
    pass('revenue-by-pool 응답', `${byPool.data.length}개 풀`);
    // 각 풀의 total = charged_amount 합산 검증
    for (const p of byPool.data) {
      const poolLogs = afterAll.filter(l => l.pool_id === p.pool_id);
      const sumCharged = poolLogs.reduce((s, l) => s + Number(l.charged_amount ?? 0), 0);
      if (Number(p.total_amount) === sumCharged) {
        pass(`[${p.pool_name ?? p.pool_id}] pool 집계 총액 일치`, `total=${Number(p.total_amount).toLocaleString()}원`);
      } else {
        bug(`[${p.pool_name ?? p.pool_id}] pool 집계 불일치`, `집계=${p.total_amount}, 합산=${sumCharged}`);
      }
    }
  } else {
    fail('revenue-by-pool', JSON.stringify(byPool.data));
  }

  // H7. revenue-logs 총합 일치 검증
  sub('H7. revenue-logs 총합 검증');
  const revLogs = await api('GET', '/billing/revenue-logs?limit=500', null, SUPER);
  if (revLogs.ok) {
    const d = revLogs.data;
    const logs = d?.logs ?? d ?? [];
    const arr = Array.isArray(logs) ? logs : [];
    const sumCharged  = arr.reduce((s, l) => s + Number(l.charged_amount ?? 0), 0);
    const sumFee      = arr.reduce((s, l) => s + Number(l.store_fee ?? 0), 0);
    const sumNet      = arr.reduce((s, l) => s + Number(l.net_revenue ?? 0), 0);
    const expectedFeeTotal = arr.reduce((s, l) => s + Math.round(Number(l.charged_amount ?? 0) * 0.3), 0);
    pass('revenue_logs 총합', `charged=${sumCharged.toLocaleString()}, fee=${sumFee.toLocaleString()}, net=${sumNet.toLocaleString()}`);
    if (sumCharged === sumFee + sumNet) {
      pass('charged = fee + net 총합 일치');
    } else {
      bug('charged ≠ fee + net 총합 불일치', `${sumCharged} ≠ ${sumFee} + ${sumNet}`);
    }
    // d.total_charged 등 집계 필드 검증
    if (d?.total_charged !== undefined) {
      if (Number(d.total_charged) === sumCharged) {
        pass('total_charged 집계 일치', `${d.total_charged.toLocaleString()}원`);
      } else {
        bug('total_charged 집계 불일치', `api=${d.total_charged}, sum=${sumCharged}`);
      }
    }
  } else {
    fail('revenue-logs 총합', JSON.stringify(revLogs.data));
  }
}

// =========================================================
// 시나리오 I — 환불 → refunded_amount 기록 검증
// =========================================================
async function scenarioI() {
  section('시나리오 I — 환불 → refunded_amount 기록 검증');

  // I1. 아쿠아스타의 최신 revenue_logs 확인
  sub('I1. 환불 전 아쿠아스타 revenue_logs 확인');
  const beforeLogs = await fetchRevLogs(POOL_A);
  const beforeCount = beforeLogs.length;
  pass('환불 전 revenue_logs', `${beforeCount}건`);
  const lastLog = beforeLogs[0];
  const lastRevId = lastLog?.id ?? null;

  // I2. store-refund 웹훅 호출 (스토어 → 서버 환불 알림)
  sub('I2. store-refund 웹훅 호출');
  const refundAmount = 1450; // starter 첫 결제 금액
  const refundResult = await api('POST', '/billing/store-refund', {
    pool_id: POOL_A,
    plan_id: lastLog?.plan_id ?? 'starter',
    amount: refundAmount,
    store_transaction_id: `stx_refund_${Date.now()}`,
  }, null);  // store-refund는 인증 불필요 (서버-서버 웹훅)
  if (refundResult.ok) {
    pass('store-refund 웹훅 수신 성공');
  } else {
    fail('store-refund 웹훅', JSON.stringify(refundResult.data));
    return;
  }

  // I3. swimming_pools is_readonly 상태 확인 (환불 → 읽기모드 전환 기대)
  sub('I3. 환불 후 billing/status 확인 (읽기모드 전환 여부)');
  const statusAfterRefund = await api('GET', '/billing/status', null, ADM_A);
  if (statusAfterRefund.ok) {
    const d = statusAfterRefund.data;
    if (d?.subscription_status === 'payment_failed' || d?.is_readonly === true) {
      pass('환불 후 읽기모드 전환', `status=${d.subscription_status}, is_readonly=${d.is_readonly}`);
    } else {
      warn('환불 후 읽기모드 미전환', `status=${d.subscription_status}, is_readonly=${d.is_readonly}`);
    }
  } else {
    warn('환불 후 billing/status', `status=${statusAfterRefund.status}`);
  }

  // I4. revenue_logs에 refunded_amount 기록 여부 확인
  sub('I4. revenue_logs refunded_amount 기록 확인');
  await new Promise(r => setTimeout(r, 300));
  const afterLogs = await fetchRevLogs(POOL_A);
  const refundedLog = afterLogs.find(l => Number(l.refunded_amount ?? 0) > 0);

  if (refundedLog) {
    pass('revenue_logs refunded_amount 기록됨', `refunded=${refundedLog.refunded_amount}`);
  } else {
    bug('revenue_logs에 refunded_amount 미기록 — store-refund가 revenue_logs를 업데이트하지 않음',
        '현재 store-refund는 payment_logs에만 기록, revenue_logs.refunded_amount 미갱신');
  }

  // I5. payment_logs에 환불 기록 확인 (음수 금액)
  sub('I5. payment_logs 음수 환불 기록 확인');
  const payLogs = await api('GET', '/billing/revenue-logs?limit=20', null, SUPER);
  // payment_logs는 별도 API로 직접 확인 (revenue-logs와 다름)
  // 슈퍼관리자 operators/:id/logs를 통해 확인
  const opLogs = await api('GET', `/super/operators/${POOL_A}`, null, SUPER);
  if (opLogs.ok) {
    const logs = opLogs.data?.logs ?? [];
    const refundLog = logs.find(l => l.description?.includes('환불') || l.category?.includes('환불'));
    if (refundLog) {
      pass('event_logs 환불 기록 확인', refundLog.description?.slice(0, 60));
    } else {
      warn('event_logs에 환불 기록 없음 (logEvent 미작동 가능성)');
    }
  }

  // I6. 환불 후 아쿠아스타 복구 (테스트 정리)
  sub('I6. 환불 상태 복구 (다음 시나리오 대비)');
  const recovery = await api('PATCH', `/super/operators/${POOL_A}/subscription`, {
    subscription_status: 'active',
    is_readonly: false,
  }, SUPER);
  if (recovery.ok) pass('아쿠아스타 복구 완료');
  else warn('복구 실패', JSON.stringify(recovery.data));
}

// =========================================================
// 시나리오 J — 결제 실패 후 재결제 → 신규 revenue_logs
// =========================================================
async function scenarioJ() {
  section('시나리오 J — 결제 실패 후 재결제 → 신규 revenue_logs 생성 (기존 덮어쓰기 없음)');

  // J1. 토이키즈 기준 카운트
  sub('J1. 재결제 전 revenue_logs 카운트 (토이키즈)');
  const beforeLogs = await fetchRevLogs(POOL_B);
  const beforeCount = beforeLogs.length;
  pass('재결제 전 카운트', `${beforeCount}건`);

  // J2. 결제 실패 시뮬레이션
  sub('J2. 결제 실패 시뮬레이션 (billing/simulate-failure)');
  const simFail = await api('POST', '/billing/simulate-failure', { pool_id: POOL_B }, SUPER);
  if (simFail.ok) {
    pass('결제 실패 시뮬레이션 성공');
  } else {
    fail('결제 실패 시뮬레이션', JSON.stringify(simFail.data));
    return;
  }

  // J3. 결제 실패 상태 확인
  sub('J3. 결제 실패 상태 확인');
  const failStatus = await api('GET', '/billing/status', null, ADM_B);
  if (failStatus.ok && failStatus.data?.subscription_status === 'payment_failed') {
    pass('payment_failed 상태 확인', `is_readonly=${failStatus.data.is_readonly}`);
  } else {
    warn('payment_failed 상태 미확인', `status=${failStatus.data?.subscription_status}`);
  }

  // J4. 재결제 실행
  sub('J4. 재결제 실행 (billing/retry)');
  const retryResult = await api('POST', '/billing/retry', {}, ADM_B);
  if (retryResult.ok) {
    pass('재결제 성공');
  } else {
    fail('재결제 실패', JSON.stringify(retryResult.data));
    return;
  }

  // J5. 재결제 후 revenue_logs 신규 생성 확인
  sub('J5. 재결제 후 revenue_logs 신규 생성 확인');
  await new Promise(r => setTimeout(r, 300));
  const afterLogs = await fetchRevLogs(POOL_B);
  const afterCount = afterLogs.length;

  if (afterCount > beforeCount) {
    pass(`신규 revenue_logs 생성 확인`, `+${afterCount - beforeCount}건 (기존=${beforeCount}, 현재=${afterCount})`);
  } else {
    bug('재결제 성공했는데 revenue_logs 미생성',
        `retry endpoint가 recordPayment에 planId를 전달하지 않아 revenue_logs 누락 가능성 있음`);
  }

  // J6. 재결제 revenue_logs 필드 검증
  sub('J6. 재결제 revenue_logs 필드 검증');
  if (afterCount > beforeCount) {
    const latest = afterLogs[0];
    // plan_id 확인 — retry는 planId를 recordPayment에 전달하지 않아 null일 수 있음
    if (latest.plan_id && latest.plan_id !== '') {
      pass('재결제 plan_id 존재', `${latest.plan_id}`);
    } else {
      bug('재결제 plan_id 누락 — retry()가 recordPayment()에 planId 미전달',
          JSON.stringify(latest).slice(0,120));
    }
    const charged = Number(latest.charged_amount ?? 0);
    if (charged > 0) {
      pass('재결제 charged_amount > 0', `${charged.toLocaleString()}원`);
    } else {
      bug('재결제 charged_amount = 0');
    }
    const expFee = Math.round(charged * 0.3);
    const actFee = Number(latest.store_fee ?? 0);
    if (actFee === expFee) {
      pass('재결제 store_fee 정확', `${actFee}`);
    } else {
      bug('재결제 store_fee 오류', `expected=${expFee}, actual=${actFee}`);
    }
  }

  // J7. 기존 레코드 덮어쓰기 없음 확인
  sub('J7. 기존 revenue_logs 덮어쓰기 없음 확인');
  if (afterLogs.length > 1) {
    const beforeIds = new Set(beforeLogs.map(l => l.id));
    const preserved = afterLogs.filter(l => beforeIds.has(l.id));
    if (preserved.length === beforeCount) {
      pass('기존 레코드 보존 확인', `${beforeCount}건 모두 유지`);
    } else {
      bug('기존 레코드 손실', `기존=${beforeCount}, 유지=${preserved.length}`);
    }
  }

  // J8. 재결제 후 구독 상태 정상화 확인
  sub('J8. 재결제 후 구독 상태 정상화 확인');
  const afterStatus = await api('GET', '/billing/status', null, ADM_B);
  if (afterStatus.ok) {
    const d = afterStatus.data;
    if (d?.subscription_status === 'active' && d?.is_readonly === false) {
      pass('재결제 후 상태 정상화', `status=active, is_readonly=false`);
    } else {
      bug('재결제 후 상태 비정상', `status=${d?.subscription_status}, is_readonly=${d?.is_readonly}`);
    }
  } else {
    warn('재결제 후 billing/status', `status=${afterStatus.status}`);
  }
}

// =========================================================
// 추가 — revenue_logs 레거시 컬럼 및 구조 감사
// =========================================================
async function structureAudit() {
  section('구조 감사 — revenue_logs 컬럼 무결성');

  sub('revenue_logs 전체 필드 샘플 검사');
  const logs = await fetchRevLogs();
  if (logs.length === 0) {
    warn('revenue_logs 데이터 없음 — 구조 검사 불가');
    return;
  }
  const sample = logs[0];
  console.log('\n  샘플 레코드:\n  ', JSON.stringify(sample, null, 2).replace(/\n/g, '\n  ').slice(0, 600));

  // 필수 필드 존재 여부
  const required = ['id','pool_id','plan_id','charged_amount','store_fee','net_revenue','created_at'];
  const missing = required.filter(k => typeof sample[k] === 'undefined' || sample[k] === null);
  if (missing.length === 0) {
    pass('필수 필드 모두 존재', required.join(', '));
  } else {
    bug('필수 필드 누락', missing.join(', '));
  }

  // amount vs charged_amount
  sub('레거시 amount 컬럼 분석');
  const hasAmount = typeof sample.amount !== 'undefined';
  const hasCharged = typeof sample.charged_amount !== 'undefined';
  if (hasAmount && hasCharged) {
    warn('레거시 amount 컬럼 잔존 — charged_amount와 이중화', `amount=${sample.amount}, charged_amount=${sample.charged_amount}`);
  } else if (!hasCharged) {
    bug('charged_amount 컬럼 없음 — 결제 금액 조회 불가');
  } else {
    pass('charged_amount 단독 사용 (정상)');
  }

  // store_fee 정확도 전수 검사
  sub('store_fee 전수 정확도 검사');
  let feeOk = 0, feeErr = 0;
  for (const log of logs) {
    const c = Number(log.charged_amount ?? 0);
    const f = Number(log.store_fee ?? 0);
    const exp = Math.round(c * 0.3);
    if (Math.abs(f - exp) <= 1) feeOk++;
    else feeErr++;
  }
  if (feeErr === 0) {
    pass(`store_fee 전수 검사 통과`, `${feeOk}건 모두 정확`);
  } else {
    bug(`store_fee 오류 건 발견`, `${feeErr}건 오류 / ${logs.length}건 총`);
  }

  // charged = fee + net 검사
  sub('charged = fee + net 전수 검사');
  let sumOk = 0, sumErr = 0;
  for (const log of logs) {
    const c = Number(log.charged_amount ?? 0);
    const f = Number(log.store_fee ?? 0);
    const n = Number(log.net_revenue ?? 0);
    if (c === f + n) sumOk++;
    else sumErr++;
  }
  if (sumErr === 0) {
    pass(`charged = fee + net 전수 검사 통과`, `${sumOk}건`);
  } else {
    bug(`charged ≠ fee + net 오류`, `${sumErr}건`);
  }
}

// =========================================================
// Main
// =========================================================
async function main() {
  console.log('\n🏊 STAGE 8 — 결제 매출 로그 생성 검증\n');
  console.log('API:  ', BASE);
  console.log('시각: ', new Date().toLocaleString('ko-KR'));
  console.log('결제: MockPaymentProvider (항상 성공)\n');

  await scenarioG();
  await scenarioH();
  await scenarioI();
  await scenarioJ();
  await structureAudit();

  const total = R.pass.length + R.fail.length + R.bug.length + R.warn.length;
  console.log(`\n${'═'.repeat(64)}`);
  console.log('  📊 STAGE 8 최종 결과');
  console.log(`${'═'.repeat(64)}`);
  console.log(`  ✅ PASS : ${R.pass.length}개`);
  console.log(`  ❌ FAIL : ${R.fail.length}개`);
  console.log(`  🐛 BUG  : ${R.bug.length}개`);
  console.log(`  ⚠️  WARN : ${R.warn.length}개`);
  console.log(`  합계   : ${total}개`);

  if (R.bug.length > 0) {
    console.log('\n  ▼ 치명 버그 목록:');
    R.bug.forEach(b => console.log(`    🐛 ${b}`));
  }
  if (R.fail.length > 0) {
    console.log('\n  ▼ 실패 목록:');
    R.fail.forEach(f => console.log(`    ❌ ${f}`));
  }
  if (R.warn.length > 0) {
    console.log('\n  ▼ 경고 목록:');
    R.warn.forEach(w => console.log(`    ⚠️  ${w}`));
  }

  const score = R.pass.length + R.fail.length + R.bug.length > 0
    ? Math.round((R.pass.length / (R.pass.length + R.fail.length + R.bug.length)) * 100) : 0;
  console.log(`\n  품질 점수: ${score}% (PASS / PASS+FAIL+BUG)`);
  console.log(`  완료: ${new Date().toLocaleString('ko-KR')}\n`);
}

main().catch(console.error);
