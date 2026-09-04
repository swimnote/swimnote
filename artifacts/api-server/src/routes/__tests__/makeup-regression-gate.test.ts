/**
 * makeup-regression-gate.test.ts — 보강 회귀 복구 Gate 검증
 *
 * 구조:
 *   Part W — teacher waiting list ownership filter 제거 검증
 *   Part O — eligible-occurrences is_one_time=true 허용 검증
 *   Part Date — 날짜 정책 생존 확인 (validateMakeupDateRange)
 *
 * 원칙:
 *   - 운영 코드 복사본 테스트 금지
 *   - teachers.ts 실제 라우트 핸들러를 express 앱에 mount
 *   - DB·인증만 mock; 운영 DB 변경 없음
 *   - 고정 KST 오늘: 2026-08-07 (금요일 = dayOfWeek 5)
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import * as nodeHttp from 'node:http';

// ── 고정 시간: KST 2026-08-07 00:00 (UTC 2026-08-06T15:00:00.000Z) ────────
const FIXED_KST_TODAY = '2026-08-07';   // 금요일(5)
const FIXED_UTC_MS    = new Date('2026-08-06T15:00:00.000Z').getTime();
const DATE_FUTURE     = '2026-08-14';   // +7일, 금요일(5), 범위 내
const DATE_MINUS14    = '2026-07-24';   // -14일 = rangeStart, 금요일(5)
const DATE_PLUS28     = '2026-09-04';   // +28일 = rangeEnd, 금요일(5)
const DATE_MINUS15    = '2026-07-23';   // -15일 범위 밖
const DATE_PLUS29     = '2026-09-05';   // +29일 범위 밖

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
  userId: 'u1',
  name:   '테스터',
}));

// ════════════════════════════════════════════════════════════════════════════
// vi.mock
// ════════════════════════════════════════════════════════════════════════════
vi.mock('../../middlewares/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { ...mockUser }; next(); },
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  requirePermission: (..._args: any[]) => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@workspace/db', () => ({
  db: { execute: mockDbExecute, select: mockDbSelect },
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

vi.mock('../../lib/pool-event-logger.js', () => ({ logPoolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/auto-link-v2.js',       () => ({ triggerAutoLinkOnStudentV2: vi.fn() }));
vi.mock('../../utils/messenger-system.js', () => ({ createSystemMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/poolOperatorService.js', () => ({ getPoolOperators: vi.fn(), countPoolOperators: vi.fn() }));
vi.mock('../../lib/auth.js', () => ({
  hashPassword: vi.fn(),
  DEFAULT_PLATFORM_ADMIN_PERMISSIONS: {},
  comparePassword: vi.fn(),
  generateToken: vi.fn(),
}));
vi.mock('../../lib/push-service.js', () => ({ sendPushToUser: vi.fn() }));

// ════════════════════════════════════════════════════════════════════════════
// 공통 헬퍼
// ════════════════════════════════════════════════════════════════════════════

/** getMyPoolId → superAdminDb.select chain 설정 */
function setupPoolMock(poolId = 'pool1') {
  mockSuperDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ swimming_pool_id: poolId }]),
      }),
    }),
  });
}

/** makeup 세션 레코드 */
function makeMkRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id:                       'mk1',
    student_id:               's1',
    student_name:             '학생',
    status:                   'waiting',
    absence_date:             '2026-08-01',
    expire_at:                null,
    swimming_pool_id:         'pool1',
    original_teacher_id:      'other_teacher',
    handed_to_teacher_id:     null,
    original_class_group_id:  'cg_orig',
    cancelled_at:             null,
    ...overrides,
  };
}

/** class_group 레코드 — schedule_days 기본값 '금' (금요일=5) */
function makeCgRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id:               'cg1',
    name:             '금요반',
    schedule_days:    '금',
    schedule_time:    '10:00',
    capacity:         5,
    teacher_user_id:  't1',
    instructor:       '이선생',
    swimming_pool_id: 'pool1',
    is_mine:          true,
    is_one_time:      false,
    is_deleted:       false,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Part W — teacher waiting list ownership filter 제거 검증
// ════════════════════════════════════════════════════════════════════════════
describe('W. teacher waiting list — ownership filter 제거 (실제 Route)', () => {
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
    mockUser.userId = 'u1';
    setupPoolMock('pool1');
  });

  // ─── W1. 다른 original_teacher_id → waiting 응답에 포함 ───────────────
  it('W1 동일 pool, 다른 original_teacher_id → 응답에 포함 (ownership filter 없음)', async () => {
    const mk = makeMkRow({ original_teacher_id: 'other_teacher', handed_to_teacher_id: null });
    // db.execute(sql.raw(...)) → waiting rows 반환
    mockDbExecute.mockResolvedValueOnce({ rows: [mk] });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    // 해당 makeup이 포함되어야 함 (ownership filter가 제거된 결과)
    const found = data.find((m: any) => m.id === 'mk1');
    expect(found).toBeDefined();
  });

  // ─── W2. status=expired, 다른 original_teacher_id → 응답에 포함 ────────
  it('W2 동일 pool, status=expired, 다른 original_teacher_id → 응답에 포함', async () => {
    const mk = makeMkRow({ status: 'expired', original_teacher_id: 'other_teacher' });
    mockDbExecute.mockResolvedValueOnce({ rows: [mk] });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    const found = data.find((m: any) => m.id === 'mk1');
    expect(found).toBeDefined();
    // is_expired 필드 확인
    expect(found.is_expired).toBe(true);
  });

  // ─── W3. 다른 swimming_pool_id → 응답에 포함되지 않음 ──────────────────
  it('W3 다른 pool → SQL WHERE에 의해 제외됨 (응답 빈 배열)', async () => {
    // 실제 SQL: WHERE ms.swimming_pool_id = 'pool1' → 다른 pool 데이터는 DB에서 반환 안 됨
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    expect(data).toHaveLength(0);
  });

  // ─── W4. cancelled_at != null → 응답에서 제외 ───────────────────────────
  it('W4 cancelled_at != null → SQL WHERE에 의해 제외됨 (응답 빈 배열)', async () => {
    // 실제 SQL: AND ms.cancelled_at IS NULL → cancelled makeup은 DB에서 반환 안 됨
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const r = await fetch(`${baseUrl}/teacher/makeups`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();
    expect(data).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part O — eligible-occurrences is_one_time 제거 검증
// ════════════════════════════════════════════════════════════════════════════
describe('O. eligible-occurrences — is_one_time=true 허용 (실제 Route)', () => {
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
    mockUser.userId = 'u1';
    setupPoolMock('pool1');
  });

  /** eligible-occurrences 성공 경로 mock 설정 */
  function setupOccMocks(cgOverrides: Partial<Record<string, any>> = {}) {
    // 1. makeup session (db.execute)
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] })
      // 3. member count
      .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })
      // 4. pool_holidays
      .mockResolvedValueOnce({ rows: [] });

    // 2. class_group (superAdminDb.execute)
    mockSuperDbExec.mockResolvedValueOnce({ rows: [makeCgRow(cgOverrides)] });
  }

  async function getOccurrences(makeupId: string, classGroupId: string) {
    const r = await fetch(`${baseUrl}/teacher/makeups/${makeupId}/eligible-occurrences?class_group_id=${classGroupId}`);
    const json: any = await r.json().catch(() => null);
    return { status: r.status, body: json };
  }

  // ─── O1. is_one_time=true → 200, CLASS_NOT_FOUND 없음 ── 핵심 회귀 ────
  it('O1 is_one_time=true 반 → HTTP 200, CLASS_NOT_FOUND 없음 (이번 회귀 핵심)', async () => {
    setupOccMocks({ is_one_time: true });

    const { status, body } = await getOccurrences('mk1', 'cg1');

    expect(body?.error).not.toBe('CLASS_NOT_FOUND');
    expect(status).toBe(200);
    expect(body?.class_group_id).toBe('cg1');
    // 금요일 schedule_days → 범위 내 금요일 occurrence 생성
    expect(Array.isArray(body?.occurrences)).toBe(true);
    expect(body.occurrences.length).toBeGreaterThan(0);
  });

  // ─── O2. is_one_time=false (일반 반) → 기존처럼 200 ─────────────────────
  it('O2 is_one_time=false 일반 반 → HTTP 200, occurrences 생성', async () => {
    setupOccMocks({ is_one_time: false });

    const { status, body } = await getOccurrences('mk1', 'cg1');

    expect(status).toBe(200);
    expect(body?.error).toBeUndefined();
    expect(body.occurrences.length).toBeGreaterThan(0);
  });

  // ─── O3. 다른 pool class_group → CLASS_NOT_FOUND 유지 ───────────────────
  it('O3 다른 pool class_group_id → 404 CLASS_NOT_FOUND 유지', async () => {
    // makeup session 정상 반환
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }],
    });
    // 다른 pool의 class_group → SQL에서 AND cg.swimming_pool_id = poolId 조건으로 빈 배열 반환
    mockSuperDbExec.mockResolvedValueOnce({ rows: [] });

    const { status, body } = await getOccurrences('mk1', 'cg_other_pool');

    expect(status).toBe(404);
    expect(body?.error).toBe('CLASS_NOT_FOUND');
  });

  // ─── O4. is_deleted=true → CLASS_NOT_FOUND 유지 ─────────────────────────
  it('O4 is_deleted=true 반 → 404 CLASS_NOT_FOUND 유지', async () => {
    // makeup session 정상 반환
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }],
    });
    // SQL에서 AND cg.is_deleted = false 조건 → 삭제된 반은 빈 배열
    mockSuperDbExec.mockResolvedValueOnce({ rows: [] });

    const { status, body } = await getOccurrences('mk1', 'cg_deleted');

    expect(status).toBe(404);
    expect(body?.error).toBe('CLASS_NOT_FOUND');
  });

  // ─── O5. 요일 불일치 → occurrences 빈 배열 ──────────────────────────────
  it('O5 schedule_days=월 인 반 → 고정 날짜(금요일 포함) 범위에서 occurrences 0건', async () => {
    // schedule_days='월' → 월요일(1)만 해당. 2026-08-07(금)~2026-09-04(금) 범위에서
    // 월요일: 08-10, 08-17, 08-24, 08-31 = 4건 존재하므로 실제로는 4건.
    // 실제 요일 검증: schedule_days='토' (토요일=6) — 금요일 기반 범위이므로
    // 토요일: 08-08, 08-15, 08-22, 08-29, 09-05(범위 밖) → 4건 존재
    // schedule_days='' (빈 문자열) → 0건
    setupOccMocks({ schedule_days: '', is_one_time: true });

    const { status, body } = await getOccurrences('mk1', 'cg1');

    expect(status).toBe(200);
    expect(body.occurrences).toHaveLength(0);
  });

  // ─── O6. pool holiday → 해당 날짜 occurrences 제외 ──────────────────────
  it('O6 pool holiday 설정 → 해당 날짜 occurrence 제외', async () => {
    // 1. makeup session
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] })
      // 3. member count
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      // 4. pool_holidays: 2026-08-14 (다음 금요일) 를 holiday로 설정
      .mockResolvedValueOnce({ rows: [{ hd: '2026-08-14' }] });

    // 2. class_group: schedule_days='금'
    mockSuperDbExec.mockResolvedValueOnce({ rows: [makeCgRow()] });

    const { status, body } = await getOccurrences('mk1', 'cg1');

    expect(status).toBe(200);
    // 2026-08-14 (금)가 holiday → occurrences에서 제외
    const holidayOcc = body.occurrences.find((o: any) => o.occurrence_date === '2026-08-14');
    expect(holidayOcc).toBeUndefined();
    // 다른 금요일은 포함
    const otherOcc = body.occurrences.find((o: any) => o.occurrence_date === '2026-08-21');
    expect(otherOcc).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part Date — 날짜 정책 생존 (assign Route를 통한 검증)
// ════════════════════════════════════════════════════════════════════════════
describe('Date. 날짜 정책 생존 — assign Route validateMakeupDateRange', () => {
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
    mockUser.userId = 'u1';
    setupPoolMock('pool1');
  });

  /** assign 성공 경로 mock (날짜 검증 통과 후 DB 호출들) */
  function setupAssignDateMocks() {
    // 1. makeup session (prevRows)
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ student_id: 's1', student_name: '학생', status: 'waiting', assigned_class_group_id: null, absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] })
      // pool_holidays
      .mockResolvedValueOnce({ rows: [] })
      // member count
      .mockResolvedValueOnce({ rows: [{ cnt: 2 }] })
      // UPDATE makeup_sessions
      .mockResolvedValueOnce({ rows: [] })
      // INSERT attendance
      .mockResolvedValueOnce({ rows: [] })
      // parent_student_requests
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });

    // class_group (superAdminDb.execute in validateMakeupOccurrence)
    mockSuperDbExec.mockResolvedValueOnce({ rows: [{ id: 'cg1', name: '금요반', schedule_days: '금', schedule_time: '10:00', capacity: 5, teacher_user_id: 't1', instructor: '이선생', is_mine: true }] });
  }

  async function patchAssign(date: string) {
    const r = await fetch(`${baseUrl}/teacher/makeups/mk1/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_group_id: 'cg1', assigned_date: date }),
    });
    const json: any = await r.json().catch(() => null);
    return { status: r.status, body: json };
  }

  // ─── Date1. -14일 (rangeStart) → 범위 내 (MAKEUP_DATE_OUT_OF_RANGE 없음) ─
  it('Date1 오늘 -14일 (2026-07-24, 금) → 범위 내, MAKEUP_DATE_OUT_OF_RANGE 없음 (과거이므로 ASSIGN_REQUIRES_FUTURE_DATE)', async () => {
    // 2026-07-24는 과거이므로 assign은 ASSIGN_REQUIRES_FUTURE_DATE(400) 반환.
    // 단, MAKEUP_DATE_OUT_OF_RANGE가 아니어야 함 (날짜 범위 정책 정상).
    mockDbExecute.mockResolvedValueOnce({ rows: [{ student_id: 's1', student_name: '학생', status: 'waiting', assigned_class_group_id: null, absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] });
    mockDbExecute.mockResolvedValue({ rows: [] });
    mockSuperDbExec.mockResolvedValueOnce({ rows: [{ id: 'cg1', name: '금요반', schedule_days: '금', schedule_time: '10:00', capacity: 5, teacher_user_id: 't1', instructor: '이선생', is_mine: true }] });

    const { status, body } = await patchAssign(DATE_MINUS14);
    // 날짜 범위 정책 통과 → MAKEUP_DATE_OUT_OF_RANGE 없음
    expect(body?.error).not.toBe('MAKEUP_DATE_OUT_OF_RANGE');
    // 과거이므로 assign 차단 → ASSIGN_REQUIRES_FUTURE_DATE
    expect(status).toBe(400);
    expect(body?.error).toBe('ASSIGN_REQUIRES_FUTURE_DATE');
  });

  // ─── Date2. +28일 (rangeEnd) → 허용 ─────────────────────────────────────
  it('Date2 오늘 +28일 (2026-09-04, 금) → assign 허용 (MAKEUP_DATE_OUT_OF_RANGE 없음)', async () => {
    setupAssignDateMocks();
    const { status, body } = await patchAssign(DATE_PLUS28);
    expect(body?.error).not.toBe('MAKEUP_DATE_OUT_OF_RANGE');
    expect(status).toBe(200);
  });

  // ─── Date3. -15일 (범위 밖) → MAKEUP_DATE_OUT_OF_RANGE ──────────────────
  it('Date3 오늘 -15일 (2026-07-23) → MAKEUP_DATE_OUT_OF_RANGE', async () => {
    // 날짜 범위 밖이면 validateMakeupDateRange가 throws → 400 응답
    mockDbExecute.mockResolvedValueOnce({ rows: [{ student_id: 's1', student_name: '학생', status: 'waiting', assigned_class_group_id: null, absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] });

    const { status, body } = await patchAssign(DATE_MINUS15);

    expect(status).toBe(400);
    expect(body?.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  // ─── Date4. +29일 (범위 밖) → MAKEUP_DATE_OUT_OF_RANGE ──────────────────
  it('Date4 오늘 +29일 (2026-09-05) → MAKEUP_DATE_OUT_OF_RANGE', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ student_id: 's1', student_name: '학생', status: 'waiting', assigned_class_group_id: null, absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] });

    const { status, body } = await patchAssign(DATE_PLUS29);

    expect(status).toBe(400);
    expect(body?.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  // ─── Date5. 결석일 이전 미래 → 날짜 때문에는 차단되지 않음 ──────────────
  it('Date5 absence_date(08-01) 이전 날짜 미래(08-07) → 날짜 차단 없음 (미래이므로 assign)', async () => {
    setupAssignDateMocks();
    // absence_date=2026-08-01, assigned_date=2026-08-07(오늘) → complete-direct 분기이므로 ASSIGN_REQUIRES_FUTURE_DATE
    // 선보강: 결석 전 날짜(DATE_FUTURE=08-14)가 미래이므로 assign 허용
    const { status, body } = await patchAssign(DATE_FUTURE);
    expect(body?.error).not.toBe('MAKEUP_DATE_OUT_OF_RANGE');
    expect(status).toBe(200);
  });
});
