/**
 * makeup-capacity-gate.test.ts — 정원 마감 반 보강 허용 Gate 검증
 *
 * 구조:
 *   Part D — teacher assign 5/5·6/5 정원 초과 허용 (실제 Route)
 *   Part E — teacher/admin eligible-classes 5/5 반 포함 (실제 Route)
 *   Part F — complete-direct 5/5 정원 오늘·과거 허용 (실제 Route)
 *   Part G — 기존 차단 규칙 생존 확인 (teacher assign 회귀)
 *   Part H — UI 정적 코드 확인 (코드 검사)
 *
 * 원칙:
 *   - 운영 코드 복사본 테스트 금지
 *   - teachers.ts · admin.ts 실제 라우트 핸들러를 express 앱에 mount
 *   - DB·인증·외부 서비스 mock; 운영 DB 변경 없음
 *   - 고정 KST 오늘: 2026-08-07 (금요일 = dayOfWeek 5)
 *   - 미래 테스트 날짜: 2026-08-14 (금요일, +7일, range 내)
 *   - 과거 테스트 날짜: 2026-07-24 (금요일, -14일 = rangeStart)
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import * as nodeHttp from 'node:http';

// ── 고정 시간: KST 2026-08-07 00:00 (UTC 2026-08-06T15:00:00.000Z) ────────
const FIXED_KST_TODAY  = '2026-08-07';     // 금요일(5)
const FIXED_UTC_MS     = new Date('2026-08-06T15:00:00.000Z').getTime();
const DATE_FUTURE      = '2026-08-14';     // 금요일(5), +7일, 범위 내
const DATE_TODAY       = '2026-08-07';     // 오늘, 금요일(5)
const DATE_PAST_RANGE  = '2026-07-24';     // 금요일(5), -14일 = rangeStart
const DATE_MINUS_15    = '2026-07-23';     // 범위 밖 (-15일)
const DATE_PLUS_29     = '2026-09-05';     // 범위 밖 (+29일)

// ════════════════════════════════════════════════════════════════════════════
// vi.hoisted
// ════════════════════════════════════════════════════════════════════════════
const mockDbExecute     = vi.hoisted(() => vi.fn());
const mockDbSelect      = vi.hoisted(() => vi.fn());
const mockSuperDbExec   = vi.hoisted(() => vi.fn());
const mockSuperDbSelect = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => ({
  role: 'teacher' as string,
  poolId: 'pool1' as string | null,
  userId: 'u1',
  name: '테스터',
}));

// ════════════════════════════════════════════════════════════════════════════
// vi.mock
// ════════════════════════════════════════════════════════════════════════════
vi.mock('../../middlewares/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { ...mockUser };
    next();
  },
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  requirePermission: (..._args: any[]) => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@workspace/db', () => ({
  db: {
    execute: mockDbExecute,
    select: mockDbSelect,
  },
  superAdminDb: {
    execute: mockSuperDbExec,
    select: mockSuperDbSelect,
  },
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
vi.mock('../../lib/auto-link-v2.js',      () => ({ triggerAutoLinkOnStudentV2: vi.fn() }));
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

/** 기본 makeup 세션 레코드 (status=waiting) */
function makeMkRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    student_id:                 's1',
    student_name:               '학생',
    status:                     'waiting',
    assigned_class_group_id:    null,
    absence_date:               '2026-08-01',
    expire_at:                  null,
    swimming_pool_id:           'pool1',
    ...overrides,
  };
}

/** class_group 레코드 — capacity/schedule_days 조정 가능 */
function makeCgRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id:               'cg1',
    name:             '금요반',
    schedule_days:    '금',          // 금요일(5) — FUTURE/TODAY/PAST 날짜와 일치
    schedule_time:    '10:00',
    capacity:         5,
    teacher_user_id:  't1',
    teacher_name:     '이선생',
    swimming_pool_id: 'pool1',
    instructor:       '이선생',
    is_mine:          true,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Part D — teacher assign Gate (정원 초과 허용)
// ════════════════════════════════════════════════════════════════════════════
describe('D. teacher assign — 5/5·6/5 정원 초과 허용 (실제 Route)', () => {
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

    // getMyPoolId → superAdminDb.select chain
    mockSuperDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ swimming_pool_id: 'pool1' }]),
        }),
      }),
    });
  });

  async function patchAssign(makeupId: string, payload: object) {
    const r = await fetch(`${baseUrl}/teacher/makeups/${makeupId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: any = await r.json().catch(() => null);
    return { status: r.status, body: json };
  }

  /** 성공 경로 DB mock: 정원 cnt 파라미터로 5/5 또는 6/5 시뮬레이션 */
  function setupAssignMocks(memberCount: number, date: string) {
    // 1. makeup session SELECT
    mockDbExecute
      .mockResolvedValueOnce({ rows: [makeMkRow()] })
      // 3. pool_holidays
      .mockResolvedValueOnce({ rows: [] })
      // 4. member count (cnt=memberCount → isFull if cnt>=capacity=5)
      .mockResolvedValueOnce({ rows: [{ cnt: memberCount }] })
      // 5. UPDATE makeup_sessions (assigned)
      .mockResolvedValueOnce({ rows: [] })
      // 6. INSERT attendance
      .mockResolvedValueOnce({ rows: [] })
      // 7. parent_student_requests (auto-link)
      .mockResolvedValueOnce({ rows: [] })
      // 8~N. 기타 (activity log, messenger, etc.)
      .mockResolvedValue({ rows: [] });

    // 2. class_groups (superAdminDb.execute in validateMakeupOccurrence)
    mockSuperDbExec.mockResolvedValueOnce({ rows: [makeCgRow()] });
  }

  // ─── D1. 5/5 미래 assign → 200 (CLASS_FULL 차단 없음) ─────────────────
  it('D1 capacity=5 members=5 (5/5) 미래 assign → 200 성공 (CLASS_FULL 없음)', async () => {
    setupAssignMocks(5, DATE_FUTURE);
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,  // 2026-08-14 금요일, 미래, 범위 내
    });
    expect(body?.error).not.toBe('CLASS_FULL');
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  // ─── D2. 6/5 미래 assign → 200 (정원 초과 상태도 허용) ───────────────
  it('D2 capacity=5 members=6 (6/5 초과) 미래 assign → 200 성공', async () => {
    setupAssignMocks(6, DATE_FUTURE);
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,
    });
    expect(body?.error).not.toBe('CLASS_FULL');
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  // ─── D3. 0/0 (capacity=0, 정원 미설정) → 200 ─────────────────────────
  it('D3 capacity=0 (정원 미설정) 미래 assign → 200 성공', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [makeMkRow()] })
      .mockResolvedValueOnce({ rows: [] })           // pool_holidays
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // member count (capacity=0 → isFull=false)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    mockSuperDbExec.mockResolvedValueOnce({ rows: [makeCgRow({ capacity: 0 })] });

    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,
    });
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part E — teacher/admin eligible-classes Gate (5/5 반 포함)
// ════════════════════════════════════════════════════════════════════════════
describe('E. eligible-classes — 5/5 반 포함 (실제 Route)', () => {
  let teacherServer: nodeHttp.Server;
  let adminServer:   nodeHttp.Server;
  let teacherBase:   string;
  let adminBase:     string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_UTC_MS);

    const { default: teachersRouter } = await import('../teachers.js');
    const { default: adminRouter }    = await import('../admin.js');

    const teacherApp = express();
    teacherApp.use(express.json());
    teacherApp.use('/', teachersRouter);

    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use('/admin', adminRouter);

    await new Promise<void>(resolve => {
      teacherServer = teacherApp.listen(0, '127.0.0.1', () => resolve());
    });
    await new Promise<void>(resolve => {
      adminServer = adminApp.listen(0, '127.0.0.1', () => resolve());
    });

    teacherBase = `http://127.0.0.1:${(teacherServer.address() as any).port}`;
    adminBase   = `http://127.0.0.1:${(adminServer.address() as any).port}`;
  });

  afterAll(async () => {
    vi.useRealTimers();
    await Promise.all([
      new Promise<void>((res, rej) => teacherServer.close(e => e ? rej(e) : res())),
      new Promise<void>((res, rej) => adminServer.close(e => e ? rej(e) : res())),
    ]);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockSuperDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ swimming_pool_id: 'pool1' }]),
        }),
      }),
    });
  });

  // ── E1. teacher eligible-classes: 5/5 반 포함 ──────────────────────────
  it('E1 teacher eligible-classes → capacity=5 members=5 반이 응답에 포함됨', async () => {
    mockUser.role   = 'teacher';
    mockUser.poolId = 'pool1';
    mockUser.userId = 'u1';

    // superAdminDb.execute → class list with 5/5 class
    mockSuperDbExec.mockResolvedValueOnce({
      rows: [
        {
          id: 'cg_full', name: '정원찬반', schedule_days: '금', schedule_time: '10:00',
          capacity: 5, teacher_user_id: 'u1', instructor: '이선생',
          current_members: 5,     // 5/5
          available_slots: 0,
          is_mine: true,
        },
        {
          id: 'cg_ok', name: '여유반', schedule_days: '금', schedule_time: '14:00',
          capacity: 5, teacher_user_id: 'u1', instructor: '이선생',
          current_members: 3,     // 3/5
          available_slots: 2,
          is_mine: true,
        },
      ],
    });

    const r = await fetch(`${teacherBase}/teacher/makeups/eligible-classes?all=true`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();

    // 5/5 반이 결과에 포함되어야 함
    const fullClass = data.find((c: any) => c.id === 'cg_full');
    expect(fullClass).toBeDefined();
    expect(fullClass.available_slots).toBe(0);

    // 여유 반도 포함
    const okClass = data.find((c: any) => c.id === 'cg_ok');
    expect(okClass).toBeDefined();
  });

  // ── E2. admin eligible-classes: 5/5 반 포함 + is_eligible 정보 유지 ────
  it('E2 admin eligible-classes → 5/5 반이 filter로 제거되지 않고 포함됨', async () => {
    mockUser.role   = 'pool_admin';
    mockUser.poolId = 'pool1';
    mockUser.userId = 'u1';

    // db.execute → class list (current_members 포함)
    mockDbExecute.mockResolvedValueOnce({
      rows: [
        { id: 'cg_full', name: '정원찬반', schedule_days: '금', schedule_time: '10:00', capacity: 5, instructor: '이선생', teacher_user_id: 'u1', current_members: 5 },
        { id: 'cg_ok',   name: '여유반',   schedule_days: '금', schedule_time: '14:00', capacity: 5, instructor: '이선생', teacher_user_id: 'u1', current_members: 2 },
      ],
    });

    const r = await fetch(`${adminBase}/admin/makeups/eligible-classes`);
    expect(r.status).toBe(200);
    const data: any[] = await r.json();

    // 5/5 반이 포함되어야 함 (filter 제거됨)
    const fullClass = data.find((c: any) => c.id === 'cg_full');
    expect(fullClass).toBeDefined();

    // is_eligible=false 이지만 응답에 포함됨 (정보 제공용)
    expect(fullClass.is_eligible).toBe(false);
    expect(fullClass.available_slots).toBe(0);
    expect(fullClass.current_members).toBe(5);
    expect(fullClass.capacity).toBe(5);

    // 여유 반도 포함
    const okClass = data.find((c: any) => c.id === 'cg_ok');
    expect(okClass).toBeDefined();
    expect(okClass.is_eligible).toBe(true);
  });

  // ── E3. admin eligible-classes: is_eligible 계산식 유지 확인 ───────────
  it('E3 admin eligible-classes → is_eligible 계산 결과가 응답에 포함됨 (정보 제공)', async () => {
    mockUser.role   = 'pool_admin';
    mockUser.poolId = 'pool1';

    mockDbExecute.mockResolvedValueOnce({
      rows: [
        { id: 'cg1', name: '반A', capacity: 5, current_members: 5, schedule_days: '금', schedule_time: '10:00', instructor: '이선생', teacher_user_id: 'u1' },
        { id: 'cg2', name: '반B', capacity: 0, current_members: 3, schedule_days: '금', schedule_time: '14:00', instructor: '이선생', teacher_user_id: 'u1' },  // capacity=0 → no limit
        { id: 'cg3', name: '반C', capacity: 5, current_members: 3, schedule_days: '금', schedule_time: '16:00', instructor: '이선생', teacher_user_id: 'u1' },
      ],
    });

    const r = await fetch(`${adminBase}/admin/makeups/eligible-classes`);
    const data: any[] = await r.json();

    const a = data.find((c: any) => c.id === 'cg1');
    const b = data.find((c: any) => c.id === 'cg2');
    const c = data.find((c: any) => c.id === 'cg3');

    expect(a.is_eligible).toBe(false);    // 5/5 → false
    expect(a.available_slots).toBe(0);
    expect(b.is_eligible).toBe(true);     // capacity=0 → true (no limit)
    expect(b.available_slots).toBe(999);
    expect(c.is_eligible).toBe(true);     // 3/5 → true
    expect(c.available_slots).toBe(2);

    // 모두 응답에 포함 (filter 없음)
    expect(data.length).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part F — complete-direct Gate (5/5 오늘·과거 허용)
// ════════════════════════════════════════════════════════════════════════════
describe('F. teacher complete-direct — 5/5 오늘·과거 정원 초과 허용 (실제 Route)', () => {
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
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
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

    mockSuperDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ swimming_pool_id: 'pool1' }]),
        }),
      }),
    });
  });

  async function patchDirectComplete(makeupId: string, payload: object) {
    const r = await fetch(`${baseUrl}/teacher/makeups/${makeupId}/complete-direct`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: any = await r.json().catch(() => null);
    return { status: r.status, body: json };
  }

  function setupDirectCompleteMocks(memberCount: number) {
    // superAdminDb.execute 호출 순서:
    // [0] SELECT name FROM users (핸들러 1097행 — userName 조회)
    // [1] SELECT FROM class_groups (validateMakeupOccurrence 내부)
    mockSuperDbExec
      .mockResolvedValueOnce({ rows: [{ name: '이선생' }] })  // userName
      .mockResolvedValueOnce({ rows: [makeCgRow()] });          // class_groups

    // db.execute 호출 순서:
    // [0] SELECT FROM makeup_sessions (1100행)
    // [1] pool_holidays (validateMakeupOccurrence 내부)
    // [2] member count (validateMakeupOccurrence 내부)
    // [3] UPDATE makeup_sessions (complete)
    // [4] INSERT attendance
    // [5+] 기타 (activity log, messenger 등)
    mockDbExecute
      .mockResolvedValueOnce({ rows: [makeMkRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: memberCount }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
  }

  // ── F1. 5/5 + 오늘 → complete-direct 200 ──────────────────────────────
  it('F1 capacity=5 members=5 오늘(2026-08-07) complete-direct → 200 성공', async () => {
    setupDirectCompleteMocks(5);
    const { status, body } = await patchDirectComplete('mk1', {
      class_group_id: 'cg1',
      date:           DATE_TODAY,    // 2026-08-07 금요일 = 오늘
    });
    expect(body?.error).not.toBe('CLASS_FULL');
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  // ── F2. 5/5 + 과거(rangeStart) → complete-direct 200 ─────────────────
  it('F2 capacity=5 members=5 과거(2026-07-24=rangeStart) complete-direct → 200 성공', async () => {
    setupDirectCompleteMocks(5);
    const { status, body } = await patchDirectComplete('mk1', {
      class_group_id: 'cg1',
      date:           DATE_PAST_RANGE,  // 2026-07-24 금요일 = -14일
    });
    expect(body?.error).not.toBe('CLASS_FULL');
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });

  // ── F3. 6/5 (초과) + 오늘 → complete-direct 200 ──────────────────────
  it('F3 capacity=5 members=6 (6/5 초과) 오늘 complete-direct → 200 성공', async () => {
    setupDirectCompleteMocks(6);
    const { status, body } = await patchDirectComplete('mk1', {
      class_group_id: 'cg1',
      date:           DATE_TODAY,
    });
    expect(body?.error).not.toBe('CLASS_FULL');
    expect(status).toBe(200);
    expect(body?.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part G — 기존 차단 규칙 생존 확인 (teacher assign 회귀)
// ════════════════════════════════════════════════════════════════════════════
describe('G. teacher assign — 기존 차단 규칙 생존 (회귀)', () => {
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
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
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

    mockSuperDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ swimming_pool_id: 'pool1' }]),
        }),
      }),
    });

    // 기본 makeup mock (status=waiting)
    mockDbExecute.mockResolvedValue({ rows: [makeMkRow()] });
  });

  async function patchAssign(makeupId: string, payload: object) {
    const r = await fetch(`${baseUrl}/teacher/makeups/${makeupId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: any = await r.json().catch(() => null);
    return { status: r.status, body: json };
  }

  // ── G1. -15일 → MAKEUP_DATE_OUT_OF_RANGE ─────────────────────────────
  it('G1 오늘 -15일(2026-07-23) → 400 MAKEUP_DATE_OUT_OF_RANGE', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_MINUS_15,
    });
    expect(status).toBe(400);
    expect(body.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  // ── G2. +29일 → MAKEUP_DATE_OUT_OF_RANGE ────────────────────────────
  it('G2 오늘 +29일(2026-09-05) → 400 MAKEUP_DATE_OUT_OF_RANGE', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_PLUS_29,
    });
    expect(status).toBe(400);
    expect(body.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  // ── G3. 존재하지 않는 달력 날짜 → INVALID_ASSIGNED_DATE ──────────────
  it('G3 2026-02-31 → 400 INVALID_ASSIGNED_DATE', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  '2026-02-31',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  // ── G4. 오늘 날짜를 assign → ASSIGN_REQUIRES_FUTURE_DATE ─────────────
  it('G4 오늘(2026-08-07)을 assign → 400 ASSIGN_REQUIRES_FUTURE_DATE', async () => {
    mockSuperDbExec.mockResolvedValueOnce({ rows: [makeCgRow()] });
    mockDbExecute
      .mockResolvedValueOnce({ rows: [makeMkRow()] })
      .mockResolvedValueOnce({ rows: [] })           // pool_holidays
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // member count
      .mockResolvedValue({ rows: [] });

    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_TODAY,  // 오늘 = 미래 아님
    });
    expect(status).toBe(400);
    expect(body.error).toBe('ASSIGN_REQUIRES_FUTURE_DATE');
  });

  // ── G5. expired + allow_expired 없음 → MAKEUP_EXPIRED_CONFIRM_REQUIRED
  it('G5 status=expired + allow_expired 없음 → 409 MAKEUP_EXPIRED_CONFIRM_REQUIRED', async () => {
    mockDbExecute.mockResolvedValue({
      rows: [makeMkRow({ status: 'expired', expire_at: '2026-07-01' })],
    });
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,
    });
    expect(status).toBe(409);
    expect(body.error).toBe('MAKEUP_EXPIRED_CONFIRM_REQUIRED');
  });

  // ── G6. status=completed → MAKEUP_ALREADY_COMPLETED ─────────────────
  it('G6 status=completed → 409 MAKEUP_ALREADY_COMPLETED', async () => {
    mockDbExecute.mockResolvedValue({ rows: [makeMkRow({ status: 'completed' })] });
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,
    });
    expect(status).toBe(409);
    expect(body.error).toBe('MAKEUP_ALREADY_COMPLETED');
  });

  // ── G7. status=cancelled → MAKEUP_ALREADY_CANCELLED ─────────────────
  it('G7 status=cancelled → 409 MAKEUP_ALREADY_CANCELLED', async () => {
    mockDbExecute.mockResolvedValue({ rows: [makeMkRow({ status: 'cancelled' })] });
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,
    });
    expect(status).toBe(409);
    expect(body.error).toBe('MAKEUP_ALREADY_CANCELLED');
  });

  // ── G8. 다른 pool 반 → CLASS_NOT_FOUND ──────────────────────────────
  it('G8 다른 pool 반(swimming_pool_id 불일치) → 404 CLASS_NOT_FOUND', async () => {
    // validateMakeupOccurrence: cgRows empty = CLASS_NOT_FOUND
    mockDbExecute.mockResolvedValueOnce({ rows: [makeMkRow()] });
    mockSuperDbExec.mockResolvedValueOnce({ rows: [] }); // class not found

    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg_other_pool',
      assigned_date:  DATE_FUTURE,
    });
    expect(status).toBe(404);
    expect(body.error).toBe('CLASS_NOT_FOUND');
  });

  // ── G9. 수업 요일 불일치 → CLASS_NOT_SCHEDULED_ON_DATE ───────────────
  it('G9 수업 요일 불일치(금요일 반에 토요일 날짜) → 400 CLASS_NOT_SCHEDULED_ON_DATE', async () => {
    // DATE_FUTURE = 2026-08-14 (금요일), schedule_days='화' → 불일치
    mockDbExecute.mockResolvedValueOnce({ rows: [makeMkRow()] });
    mockSuperDbExec.mockResolvedValueOnce({
      rows: [makeCgRow({ schedule_days: '화' })], // 화요일 반에 금요일 날짜 → 불일치
    });
    mockDbExecute
      .mockResolvedValueOnce({ rows: [] })           // pool_holidays
      .mockResolvedValue({ rows: [] });

    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,  // 2026-08-14 금요일
    });
    expect(status).toBe(400);
    expect(body.error).toBe('CLASS_NOT_SCHEDULED_ON_DATE');
  });

  // ── G10. 휴일 → POOL_HOLIDAY ─────────────────────────────────────────
  it('G10 수영장 휴일 → 400 POOL_HOLIDAY', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [makeMkRow()] });
    mockSuperDbExec.mockResolvedValueOnce({ rows: [makeCgRow()] });
    // pool_holidays: 해당 날짜가 휴일
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // pool_holidays hit
      .mockResolvedValue({ rows: [] });

    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_FUTURE,
    });
    expect(status).toBe(400);
    expect(body.error).toBe('POOL_HOLIDAY');
  });

  // ── G11. rangeStart(-14일=2026-07-24)를 assign → ASSIGN_REQUIRES_FUTURE_DATE
  it('G11 과거(rangeStart=2026-07-24)를 assign → 400 ASSIGN_REQUIRES_FUTURE_DATE', async () => {
    mockSuperDbExec.mockResolvedValueOnce({ rows: [makeCgRow()] });
    mockDbExecute
      .mockResolvedValueOnce({ rows: [makeMkRow()] })
      .mockResolvedValueOnce({ rows: [] })           // pool_holidays
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // member count
      .mockResolvedValue({ rows: [] });

    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date:  DATE_PAST_RANGE,  // 과거 날짜
    });
    expect(status).toBe(400);
    expect(body.error).toBe('ASSIGN_REQUIRES_FUTURE_DATE');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part H — UI 정적 코드 확인
// ════════════════════════════════════════════════════════════════════════════
describe('H. UI 정적 코드 확인 (makeups.tsx / ClassDetailSheet.tsx)', () => {
  it('H1 makeups.tsx — is_full && is_future disabled 없음', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../../../artifacts/swim-app/app/(teacher)/makeups.tsx', import.meta.url).pathname,
      'utf-8'
    );
    // 정원 때문에 disabled되는 코드 없어야 함
    expect(src).not.toContain('disabled={occ.is_full && occ.is_future}');
    expect(src).not.toContain('if (occ.is_full && occ.is_future) return');
    expect(src).not.toContain('opacity: 0.4');
  });

  it('H2 makeups.tsx — is_full 뱃지 표시 유지', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../../../artifacts/swim-app/app/(teacher)/makeups.tsx', import.meta.url).pathname,
      'utf-8'
    );
    // 정원 뱃지(정원마감/정원초과) 표시 코드가 유지됨
    expect(src).toContain('occ.is_full &&');
    expect(src).toContain('정원마감');
    expect(src).toContain('정원초과');
  });

  it('H3 ClassDetailSheet.tsx — isSaving 유지, is_full && is_future disabled 없음', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../../../artifacts/swim-app/components/teacher/my-schedule/ClassDetailSheet.tsx', import.meta.url).pathname,
      'utf-8'
    );
    // is_full && is_future에 의한 disabled 없어야 함
    expect(src).not.toContain('isSaving || (occ.is_full && occ.is_future)');
    expect(src).not.toContain('occ.is_full && occ.is_future ? C.textMuted');
    // isSaving은 유지
    expect(src).toContain('disabled={isSaving}');
  });

  it('H4 ClassDetailSheet.tsx — is_full 뱃지 유지', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../../../artifacts/swim-app/components/teacher/my-schedule/ClassDetailSheet.tsx', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).toContain('occ.is_full &&');
    expect(src).toContain('정원마감');
  });

  it('H5 teachers.ts — HAVING GREATEST capacity 없음', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../routes/teachers.ts', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).not.toContain('HAVING GREATEST(0, cg.capacity');
  });

  it('H6 teachers.ts — CLASS_FULL 400 블록 없음', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../routes/teachers.ts', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).not.toContain("error: \"CLASS_FULL\"");
    expect(src).not.toContain("error: 'CLASS_FULL'");
  });

  it('H7 admin.ts — filter is_eligible 없음', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../routes/admin.ts', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).not.toContain('.filter(r => r.is_eligible)');
  });

  it('H8 teachers.ts — 날짜 로직 모두 생존', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../routes/teachers.ts', import.meta.url).pathname,
      'utf-8'
    );
    expect(src).toContain('validateMakeupDateRange');
    expect(src).toContain('getMakeupDateRange');
    expect(src).toContain('MAKEUP_DATE_OUT_OF_RANGE');
    expect(src).toContain('ASSIGN_REQUIRES_FUTURE_DATE');
    expect(src).toContain('MAKEUP_EXPIRED_CONFIRM_REQUIRED');
  });
});
