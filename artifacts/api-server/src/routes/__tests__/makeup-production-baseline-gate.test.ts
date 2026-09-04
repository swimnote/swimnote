/**
 * makeup-production-baseline-gate.test.ts
 * SWIMNOTE Makeup Production Baseline 회귀 Gate
 *
 * 이 파일은 2026-08-08 실기기 검증 완료 상태를 고정하는 회귀 테스트다.
 * Baseline Tag: swimnote-makeup-production-stable-2026-08-08
 * Baseline SHA: baee4222f51f6c25c295a110d1988efced28ebdd
 *
 * 구조:
 *   Part T  — Teacher visibility CASE 1~7 (REQ-5)
 *   Part S  — 앱 정적 코드 Gate (onPress, state 초기화)
 *
 * 원칙:
 *   - 운영 코드 복사본 테스트 금지
 *   - teachers.ts 실제 라우트 핸들러를 express 앱에 mount
 *   - DB·인증만 mock; 운영 DB 변경 없음
 *   - 고정 KST 오늘: 2026-08-08 (토요일)
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import * as nodeHttp from 'node:http';

// ── 고정 시간: KST 2026-08-08 00:00 (UTC 2026-08-07T15:00:00.000Z) ────────
const FIXED_KST_TODAY = '2026-08-08';
const FIXED_UTC_MS    = new Date('2026-08-07T15:00:00.000Z').getTime();

// ════════════════════════════════════════════════════════════════════════════
// vi.hoisted
// ════════════════════════════════════════════════════════════════════════════
const mockDbExecute     = vi.hoisted(() => vi.fn());
const mockDbSelect      = vi.hoisted(() => vi.fn());
const mockSuperDbExec   = vi.hoisted(() => vi.fn());
const mockSuperDbSelect = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => ({
  role:   'teacher' as string,
  poolId: 'pool1'   as string | null,
  userId: 'tA',
  name:   '선생A',
}));

// ════════════════════════════════════════════════════════════════════════════
// vi.mock
// ════════════════════════════════════════════════════════════════════════════
vi.mock('../../middlewares/auth.js', () => ({
  requireAuth:       (req: any, _res: any, next: any) => { req.user = { ...mockUser }; next(); },
  requireRole:       (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  requirePermission: (..._args: any[]) => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@workspace/db', () => ({
  db:           { execute: mockDbExecute, select: mockDbSelect },
  superAdminDb: { execute: mockSuperDbExec, select: mockSuperDbSelect },
}));

vi.mock('@workspace/db/schema', () => {
  const col = (n: string) => ({ name: n });
  return {
    swimmingPoolsTable:               { id: col('id') },
    usersTable:                       { id: col('id'), swimming_pool_id: col('swimming_pool_id') },
    classGroupsTable:                 { id: col('id'), swimming_pool_id: col('swimming_pool_id') },
    subscriptionsTable:               { id: col('id') },
    membersTable:                     { id: col('id') },
    parentAccountsTable:              { id: col('id') },
    parentStudentsTable:              { id: col('id') },
    studentsTable:                    { id: col('id') },
    studentRegistrationRequestsTable: { id: col('id') },
    attendanceTable:                  { id: col('id') },
    makeupSessionsTable:              { id: col('id') },
  };
});

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    eq:  (_col: any, _val: any) => ({ _type: 'eq' }),
    and: (..._args: any[])      => ({ _type: 'and' }),
  };
});

vi.mock('../../utils/historyUtils.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, kstTodayStr: () => FIXED_KST_TODAY };
});

vi.mock('../../lib/pool-event-logger.js',   () => ({ logPoolEvent:               vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/auto-link-v2.js',        () => ({ triggerAutoLinkOnStudentV2: vi.fn() }));
vi.mock('../../utils/messenger-system.js',  () => ({ createSystemMessage:        vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/poolOperatorService.js', () => ({ getPoolOperators: vi.fn(), countPoolOperators: vi.fn() }));
vi.mock('../../lib/auth.js', () => ({
  hashPassword:                    vi.fn(),
  DEFAULT_PLATFORM_ADMIN_PERMISSIONS: {},
  comparePassword:                 vi.fn(),
  generateToken:                   vi.fn(),
}));
vi.mock('../../lib/push-service.js', () => ({ sendPushToUser: vi.fn() }));

// ════════════════════════════════════════════════════════════════════════════
// 공통 헬퍼
// ════════════════════════════════════════════════════════════════════════════
function setupPoolMock(poolId = 'pool1') {
  mockSuperDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ swimming_pool_id: poolId }]),
      }),
    }),
  });
}

function makeMkRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id:                      'mk1',
    student_id:              's1',
    student_name:            '학생',
    status:                  'waiting',
    absence_date:            '2026-08-01',
    expire_at:               null,
    swimming_pool_id:        'pool1',
    original_teacher_id:     'tA',
    handed_to_teacher_id:    null,
    original_class_group_id: 'cg1',
    cancelled_at:            null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Part T — Teacher visibility CASE 1~7 (REQ-5)
//
// SQL 필터(left_at IS NULL + teacher_user_id / co_teacher_ids)가 DB 레이어에 있으므로
// 여기서는 "mockDbExecute가 해당 teacher의 학생 결과를 반환하면 응답에 포함된다"를
// 확인하고, SQL 소스에 필터 조건이 명시되어 있는지 코드 grep으로 이중 검증한다.
// ════════════════════════════════════════════════════════════════════════════
describe('T. Teacher visibility — REQ-5 (CASE 1~7)', () => {
  let server: nodeHttp.Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_UTC_MS);

    const { default: teachersRouter } = await import('../teachers.js');
    const app = express();
    app.use(express.json());
    app.use('/', teachersRouter);

    await new Promise<void>(resolve => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    vi.useRealTimers();
    await new Promise<void>((resolve, reject) =>
      server.close(err => err ? reject(err) : resolve())
    );
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockUser.role   = 'teacher';
    mockUser.poolId = 'pool1';
    mockUser.userId = 'tA';
    setupPoolMock('pool1');
  });

  // ── CASE 1: Teacher A → A 담당 학생 보강이 응답에 포함됨 ───────────────
  it('CASE-1 Teacher A(tA) 로그인 → A 담당 학생(s_A) 보강 포함', async () => {
    mockUser.userId = 'tA';
    mockDbExecute.mockResolvedValueOnce({
      rows: [makeMkRow({ student_id: 's_A', student_name: 'A담당학생', original_teacher_id: 'tA' })],
    });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    const found = data.find((m: any) => m.student_id === 's_A');
    expect(found).toBeDefined();
  });

  // ── CASE 2: Teacher B → B 담당 학생 보강이 응답에 포함됨 ───────────────
  it('CASE-2 Teacher B(tB) 로그인 → B 담당 학생(s_B) 보강 포함', async () => {
    mockUser.userId = 'tB';
    setupPoolMock('pool1');
    mockDbExecute.mockResolvedValueOnce({
      rows: [makeMkRow({ student_id: 's_B', student_name: 'B담당학생', original_teacher_id: 'tB' })],
    });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    const found = data.find((m: any) => m.student_id === 's_B');
    expect(found).toBeDefined();
  });

  // ── CASE 3: 각 teacher는 자기 pool DB 결과만 받는다 (A·B 중복 없음) ───
  it('CASE-3 Teacher A 응답에 B 전용 학생 없음 (SQL 분리, mock으로 격리 확인)', async () => {
    mockUser.userId = 'tA';
    // Teacher A 쿼리에서 B 담당 학생은 DB가 반환하지 않음
    mockDbExecute.mockResolvedValueOnce({
      rows: [makeMkRow({ student_id: 's_A', student_name: 'A담당학생' })],
    });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    expect(data.find((m: any) => m.student_id === 's_B')).toBeUndefined();
    expect(data.find((m: any) => m.student_id === 's_A')).toBeDefined();
  });

  // ── CASE 4: expired 보강 표시 유지 ────────────────────────────────────
  it('CASE-4 현재 담당 학생의 expired 보강 → is_expired=true 포함', async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [makeMkRow({ status: 'expired', expire_at: '2026-07-01' })],
    });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    const found = data.find((m: any) => m.id === 'mk1');
    expect(found).toBeDefined();
    expect(found.is_expired).toBe(true);
  });

  // ── CASE 5: co_teacher — SQL에 co_teacher_ids 조건 명시 확인 ──────────
  it('CASE-5 teachers.ts SQL — co_teacher_ids 필터 조건 포함', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../routes/teachers.ts', import.meta.url).pathname,
      'utf-8'
    );
    // Source of Truth: co_teacher_ids @> to_jsonb(...)
    expect(src).toContain('co_teacher_ids');
    expect(src).toContain('left_at IS NULL');
  });

  // ── CASE 6: handoff receiver → 인계받은 보강 포함 ─────────────────────
  it('CASE-6 handoff receiver: handed_to_teacher_id=tA → 응답에 포함', async () => {
    // handed_to_teacher_id로 인계받은 보강 → DB에서 반환됨
    mockDbExecute.mockResolvedValueOnce({
      rows: [makeMkRow({ original_teacher_id: 'other', handed_to_teacher_id: 'tA' })],
    });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('mk1');
  });

  // ── CASE 7: Admin → pool 전체 조회 (SQL에 admin 분기 존재 확인) ────────
  it('CASE-7 teachers.ts SQL — pool_admin·admin 분기 존재', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../routes/teachers.ts', import.meta.url).pathname,
      'utf-8'
    );
    // Admin 분기: role === 'pool_admin' || 'admin'이면 전체 pool 조회
    expect(src).toContain('pool_admin');
    // 담당 teacher 필터 SQL 포함 (teacher 분기)
    expect(src).toContain('teacher_user_id');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part S — 앱 정적 코드 Gate
//
// 다음 코드가 사라지거나 되돌아가면 회귀로 판정한다.
// ════════════════════════════════════════════════════════════════════════════
describe('S. 앱 정적 코드 Gate (makeups.tsx)', () => {
  let src: string;

  beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    src = readFileSync(
      new URL('../../../../../artifacts/swim-app/app/(teacher)/makeups.tsx', import.meta.url).pathname,
      'utf-8'
    );
  });

  // ── S1. onPress={() => doAssign()} 유지 ───────────────────────────────
  it('S1 onPress={() => doAssign()} — GestureResponderEvent 래핑 유지', () => {
    // 배정 확정 버튼이 올바르게 래핑되어야 함
    expect(src).toContain('onPress={() => doAssign()}');
  });

  // ── S2. onPress={doAssign} 직접 전달 없음 ─────────────────────────────
  it('S2 onPress={doAssign} 직접 전달 없음 (GestureResponderEvent 오염 방지)', () => {
    // GestureResponderEvent 오염 패턴 금지
    // expired Alert 내부의 doAssign(true)는 화살표 함수 내이므로 이 패턴과 무관
    expect(src).not.toMatch(/onPress=\{doAssign\}(?!\()/);
  });

  // ── S3. 날짜 다시 선택 — 두 state 동시 초기화 유지 ───────────────────
  it('S3 날짜 다시 선택 시 setSelectedDate(null) + setSelectedOccurrence(null) 동시 초기화', () => {
    // 두 줄이 같은 onPress 핸들러 내에 존재해야 함
    // 패턴: { setSelectedDate(null); setSelectedOccurrence(null); }
    expect(src).toContain('setSelectedDate(null)');
    expect(src).toContain('setSelectedOccurrence(null)');
    // 두 초기화가 같은 핸들러에 묶여 있는지 확인 (연속 발생)
    const idx1 = src.indexOf('setSelectedDate(null)');
    const idx2 = src.indexOf('setSelectedOccurrence(null)', idx1);
    expect(idx2 - idx1).toBeLessThan(200); // 같은 핸들러 블록 내
  });

  // ── S4. 보강 경로 FULL 반 onPress 차단 없음 ───────────────────────────
  it('S4 보강 배정 경로에서 is_full로 onPress 차단하는 코드 없음', () => {
    // 보강 assign 버튼이 is_full && is_future 조건으로 차단되면 안 됨
    expect(src).not.toContain('disabled={occ.is_full && occ.is_future}');
    expect(src).not.toContain('if (occ.is_full && occ.is_future) return');
  });

  // ── S5. 정원 뱃지 표시 유지 (정보 제공용은 허용) ─────────────────────
  it('S5 정원마감/정원초과 뱃지 표시 코드 유지 (정보 제공)', () => {
    expect(src).toContain('정원마감');
    expect(src).toContain('정원초과');
  });
});
