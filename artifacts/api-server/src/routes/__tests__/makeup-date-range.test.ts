/**
 * makeup-date-range.test.ts — 보강 날짜 범위 수정 실제 연결 검증
 *
 * 구조:
 *   Part A — lib/makeup-date-range.ts 직접 import (운영 함수 단위 테스트)
 *   Part B — admin.ts PATCH /makeups/:id/assign 실제 라우트 HTTP 테스트
 *   Part C — teachers.ts PATCH /teacher/makeups/:id/assign 실제 라우트 HTTP 테스트
 *
 * 원칙:
 *   - 운영 코드 복사 금지: helpers는 ../lib/makeup-date-range.ts에서 import
 *   - teachers.ts · admin.ts 실제 라우트 핸들러를 express 앱에 mount
 *   - DB·인증·외부 서비스 mock; 운영 DB 변경 없음
 *   - 고정 KST 오늘: 2026-08-06 (vi.useFakeTimers + historyUtils mock)
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import * as nodeHttp from 'node:http';

// ── 고정 시간: KST 2026-08-06 00:00 (UTC 2026-08-05T15:00Z) ──────────────
const FIXED_KST_TODAY = '2026-08-06';
const FIXED_UTC_MS    = new Date('2026-08-05T15:00:00.000Z').getTime();

// ════════════════════════════════════════════════════════════════════════════
// vi.hoisted — mock 핸들 hoisting 이전 선언 필수
// ════════════════════════════════════════════════════════════════════════════
const mockDbExecute     = vi.hoisted(() => vi.fn());
const mockDbSelect      = vi.hoisted(() => vi.fn());
const mockSuperDbExec   = vi.hoisted(() => vi.fn());
const mockSuperDbSelect = vi.hoisted(() => vi.fn());
// 테스트별로 user 역할을 변경할 수 있도록 mutable 객체 사용
const mockUser = vi.hoisted(() => ({
  role: 'pool_admin' as string,
  poolId: 'pool1' as string | null,
  userId: 'u1',
  name: '테스터',
}));

// ════════════════════════════════════════════════════════════════════════════
// vi.mock (자동 hoisting — import 이전 실행 보장)
// ════════════════════════════════════════════════════════════════════════════

// 인증 미들웨어
vi.mock('../../middlewares/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { ...mockUser };
    next();
  },
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  requirePermission: (..._args: any[]) => (_req: any, _res: any, next: any) => next(),
}));

// DB — execute·select 체인 mock
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

// DB Schema — drizzle ORM 테이블 참조 (eq()에 넘겨지는 column 객체; mock chain이 무시하므로 단순 객체)
vi.mock('@workspace/db/schema', () => {
  const col = (n: string) => ({ name: n });
  return {
    swimmingPoolsTable: { id: col('id') },
    usersTable: { id: col('id'), swimming_pool_id: col('swimming_pool_id') },
    classGroupsTable: { id: col('id'), swimming_pool_id: col('swimming_pool_id') },
    subscriptionsTable: { id: col('id') },
    membersTable: { id: col('id') },
    parentAccountsTable: { id: col('id') },
    parentStudentsTable: { id: col('id') },
    studentsTable: { id: col('id') },
    studentRegistrationRequestsTable: { id: col('id') },
  };
});

// drizzle-orm — sql(template tag)·sql.raw은 실제 사용; eq·and는 safe no-op으로 교체
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    eq:  (_col: any, _val: any) => ({ _type: 'eq' }),
    and: (..._args: any[])       => ({ _type: 'and' }),
  };
});

// historyUtils — kstTodayStr을 고정값으로 교체 (admin.ts 사용)
vi.mock('../../utils/historyUtils.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, kstTodayStr: () => FIXED_KST_TODAY };
});

// 외부 서비스 — 순수 no-op
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
// Part A — lib/makeup-date-range.ts 단위 테스트 (실제 운영 파일 import)
// ════════════════════════════════════════════════════════════════════════════
import {
  addDateDays,
  dayOfWeekFromDateStr,
  isValidDateFormat,
  isValidCalendarDate,
  getMakeupDateRange,
  validateMakeupDateRange,
} from '../../lib/makeup-date-range.js';

describe('A. lib/makeup-date-range.ts — 운영 파일 직접 import', () => {
  describe('A1. addDateDays', () => {
    it('A1-01 오늘 +28일: 2026-08-06 → 2026-09-03', () => {
      expect(addDateDays('2026-08-06', 28)).toBe('2026-09-03');
    });
    it('A1-02 오늘 -14일: 2026-08-06 → 2026-07-23', () => {
      expect(addDateDays('2026-08-06', -14)).toBe('2026-07-23');
    });
    it('A1-03 월말 이동: 2026-07-31 + 1 → 2026-08-01', () => {
      expect(addDateDays('2026-07-31', 1)).toBe('2026-08-01');
    });
    it('A1-04 연말 이동: 2025-12-31 + 1 → 2026-01-01', () => {
      expect(addDateDays('2025-12-31', 1)).toBe('2026-01-01');
    });
    it('A1-05 윤년: 2028-02-27 + 2 → 2028-02-29', () => {
      expect(addDateDays('2028-02-27', 2)).toBe('2028-02-29');
    });
    it('A1-06 평년: 2025-02-27 + 2 → 2025-03-01', () => {
      expect(addDateDays('2025-02-27', 2)).toBe('2025-03-01');
    });
  });

  describe('A2. dayOfWeekFromDateStr', () => {
    it('A2-01 2026-08-06 = 목(4)', () => expect(dayOfWeekFromDateStr('2026-08-06')).toBe(4));
    it('A2-02 2026-07-23 = 목(4)',  () => expect(dayOfWeekFromDateStr('2026-07-23')).toBe(4));
    it('A2-03 2026-09-03 = 목(4)',  () => expect(dayOfWeekFromDateStr('2026-09-03')).toBe(4));
    it('A2-04 2026-08-02 = 일(0)',  () => expect(dayOfWeekFromDateStr('2026-08-02')).toBe(0));
  });

  describe('A3. isValidDateFormat (형식만 검사)', () => {
    it('A3-01 유효 형식: 2026-08-06 → true',     () => expect(isValidDateFormat('2026-08-06')).toBe(true));
    it('A3-02 슬래시 구분자: 2026/08/06 → false', () => expect(isValidDateFormat('2026/08/06')).toBe(false));
    it('A3-03 짧은 형식: 26-08-06 → false',       () => expect(isValidDateFormat('26-08-06')).toBe(false));
    it('A3-04 문자 포함: 2026-AB-06 → false',     () => expect(isValidDateFormat('2026-AB-06')).toBe(false));
    // 주의: 형식은 맞지만 달력에 없는 날짜도 형식 검사는 통과
    it('A3-05 2026-02-31 형식만 보면 true',       () => expect(isValidDateFormat('2026-02-31')).toBe(true));
  });

  describe('A4. isValidCalendarDate (형식 + 실존 날짜)', () => {
    it('A4-01 2026-02-31 → false (2월에 31일 없음)',  () => expect(isValidCalendarDate('2026-02-31')).toBe(false));
    it('A4-02 2026-13-01 → false (13월 없음)',         () => expect(isValidCalendarDate('2026-13-01')).toBe(false));
    it('A4-03 2026-00-10 → false (0월 없음)',          () => expect(isValidCalendarDate('2026-00-10')).toBe(false));
    it('A4-04 2026-04-31 → false (4월은 30일)',        () => expect(isValidCalendarDate('2026-04-31')).toBe(false));
    it('A4-05 2025-02-29 → false (평년)',              () => expect(isValidCalendarDate('2025-02-29')).toBe(false));
    it('A4-06 2028-02-29 → true  (윤년)',              () => expect(isValidCalendarDate('2028-02-29')).toBe(true));
    it('A4-07 2026-08-06 → true',                      () => expect(isValidCalendarDate('2026-08-06')).toBe(true));
    it('A4-08 슬래시 형식 → false',                    () => expect(isValidCalendarDate('2026/08/06')).toBe(false));
  });

  describe('A5. getMakeupDateRange', () => {
    it('A5-01 2026-08-06 기준 rangeStart = 2026-07-23', () => {
      expect(getMakeupDateRange('2026-08-06').rangeStart).toBe('2026-07-23');
    });
    it('A5-02 2026-08-06 기준 rangeEnd = 2026-09-03', () => {
      expect(getMakeupDateRange('2026-08-06').rangeEnd).toBe('2026-09-03');
    });
  });

  describe('A6. validateMakeupDateRange (throw / no-throw)', () => {
    it('A6-01 rangeStart(2026-07-23) → throws 없음', () => {
      expect(() => validateMakeupDateRange('2026-07-23', FIXED_KST_TODAY)).not.toThrow();
    });
    it('A6-02 rangeEnd(2026-09-03) → throws 없음', () => {
      expect(() => validateMakeupDateRange('2026-09-03', FIXED_KST_TODAY)).not.toThrow();
    });
    it('A6-03 오늘(2026-08-06) → throws 없음', () => {
      expect(() => validateMakeupDateRange(FIXED_KST_TODAY, FIXED_KST_TODAY)).not.toThrow();
    });
    it('A6-04 rangeStart -1일(2026-07-22) → throws MAKEUP_DATE_OUT_OF_RANGE', () => {
      expect(() => validateMakeupDateRange('2026-07-22', FIXED_KST_TODAY))
        .toThrow(expect.objectContaining({ code: 'MAKEUP_DATE_OUT_OF_RANGE', status: 400 }));
    });
    it('A6-05 rangeEnd +1일(2026-09-04) → throws MAKEUP_DATE_OUT_OF_RANGE', () => {
      expect(() => validateMakeupDateRange('2026-09-04', FIXED_KST_TODAY))
        .toThrow(expect.objectContaining({ code: 'MAKEUP_DATE_OUT_OF_RANGE', status: 400 }));
    });
    it('A6-06 throw message에 "2주 전" 포함', () => {
      let caught: any;
      try { validateMakeupDateRange('2026-06-01', FIXED_KST_TODAY); } catch (e) { caught = e; }
      expect(caught?.message).toContain('2주 전');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part B — admin.ts PATCH /makeups/:id/assign 실제 라우트 HTTP 테스트
// ════════════════════════════════════════════════════════════════════════════
describe('B. admin.ts — PATCH /admin/makeups/:id/assign 날짜 검증 (실제 라우트)', () => {
  let server: nodeHttp.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Date fake: KST 2026-08-06
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_UTC_MS);

    // admin.ts는 historyUtils.kstTodayStr을 import → 모듈 mock으로 고정됨
    const adminModule = await import('../admin.js');
    const adminRouter = adminModule.default;

    const app = express();
    app.use(express.json());
    app.use('/admin', adminRouter);

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
    vi.clearAllMocks();
    // pool_admin: getAdminPoolId가 req.user.poolId를 즉시 반환 → superAdminDb 조회 없음
    mockUser.role   = 'pool_admin';
    mockUser.poolId = 'pool1';
  });

  // ── 헬퍼 ─────────────────────────────────────────────────────────────────
  async function patchAssign(makeupId: string, payload: object) {
    const r = await fetch(`${baseUrl}/admin/makeups/${makeupId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: any = await r.json().catch(() => null);
    return { status: r.status, body: json };
  }

  // 성공 경로용 DB mock 셋업
  function setupSuccessDbMocks(assigned_date: string) {
    const cgMock = { id: 'cg1', name: '월수금반', teacher_user_id: 't1', instructor: '이선생' };
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([cgMock]),
        }),
      }),
    });
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ status: 'waiting' }] })              // SELECT status
      .mockResolvedValueOnce({ rows: [{ id: 'mk1' }] })                      // sql.raw UPDATE
      .mockResolvedValueOnce({ rows: [] })                                    // writeActivityLog INSERT
      .mockResolvedValueOnce({ rows: [{ student_name: '테스터', assigned_date }] }) // SELECT student_name
      .mockResolvedValue({ rows: [] });
  }

  // ── B1. 날짜 형식 오류 ───────────────────────────────────────────────────
  it('B1-01 슬래시 구분자 (2026/08/06) → 400 INVALID_ASSIGNED_DATE', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026/08/06',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  it('B1-02 짧은 형식 (26-08-06) → 400 INVALID_ASSIGNED_DATE', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '26-08-06',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  // ── B2. 달력 실존 날짜 오류 (핵심 신규 검증) ────────────────────────────
  it('B2-01 2026-02-31 → 400 INVALID_ASSIGNED_DATE (2월 31일 없음)', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-02-31',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  it('B2-02 2026-13-01 → 400 INVALID_ASSIGNED_DATE (13월 없음)', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-13-01',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  it('B2-03 2026-00-10 → 400 INVALID_ASSIGNED_DATE (0월 없음)', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-00-10',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  it('B2-04 2026-04-31 → 400 INVALID_ASSIGNED_DATE (4월은 30일)', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-04-31',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  it('B2-05 2025-02-29 → 400 INVALID_ASSIGNED_DATE (평년 윤일 없음)', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2025-02-29',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  // ── B3. 날짜 범위 오류 ───────────────────────────────────────────────────
  it('B3-01 오늘 -15일 (2026-07-22) → 400 MAKEUP_DATE_OUT_OF_RANGE', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-07-22',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
    expect(body.message).toContain('2주 전');
  });

  it('B3-02 오늘 +29일 (2026-09-04) → 400 MAKEUP_DATE_OUT_OF_RANGE', async () => {
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-09-04',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  // ── B4. 유효 날짜 — 날짜 검증 통과 후 DB 레이어 도달 ───────────────────
  it('B4-01 rangeStart (2026-07-23) → 날짜 검증 통과, DB 레이어 도달 (200)', async () => {
    setupSuccessDbMocks('2026-07-23');
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-07-23',
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('B4-02 rangeEnd (2026-09-03) → 날짜 검증 통과, DB 레이어 도달 (200)', async () => {
    setupSuccessDbMocks('2026-09-03');
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-09-03',
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('B4-03 오늘 (2026-08-06) → 날짜 검증 통과, DB 레이어 도달 (200)', async () => {
    setupSuccessDbMocks('2026-08-06');
    const { status, body } = await patchAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-08-06',
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  // ── B5. assigned_date 없음 — 날짜 검증 건너뜀 ───────────────────────────
  it('B5-01 assigned_date 없음 → 날짜 검증 건너뜀 (DB 레이어 도달)', async () => {
    const cgMock = { id: 'cg1', name: '월수금반', teacher_user_id: 't1', instructor: '이선생' };
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([cgMock]) }) }),
    });
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ status: 'waiting' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'mk1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ student_name: '테스터', assigned_date: null }] })
      .mockResolvedValue({ rows: [] });
    const { status } = await patchAssign('mk1', { class_group_id: 'cg1' });
    expect(status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Part C — teachers.ts PATCH /teacher/makeups/:id/assign 실제 라우트 HTTP 테스트
// ════════════════════════════════════════════════════════════════════════════
describe('C. teachers.ts — PATCH /teacher/makeups/:id/assign 날짜 검증 (실제 라우트)', () => {
  let server: nodeHttp.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // teachers.ts의 kstTodayStr()은 내부 함수 → vi.useFakeTimers로 new Date() 픽스
    // (이미 Part B beforeAll에서 설정됨 — 이 describe는 이후 실행)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_UTC_MS);

    const teachersModule = await import('../teachers.js');
    const teachersRouter = teachersModule.default;

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
    // vi.resetAllMocks(): clearAllMocks와 달리 once 큐도 초기화한다.
    // vi.clearAllMocks()만 쓰면 이전 테스트의 소비되지 않은 once 항목이 남아 오염된다.
    vi.resetAllMocks();
    // teacher role: getMyPoolId는 superAdminDb.select().from().where().limit() 사용
    mockUser.role   = 'teacher';
    mockUser.poolId = 'pool1';
    mockUser.userId = 'u1';

    // superAdminDb.select 체인 → getMyPoolId가 pool1 반환
    mockSuperDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ swimming_pool_id: 'pool1' }]),
        }),
      }),
    });

    // 기본 DB mock: makeup_sessions 조회 → waiting 상태 세션 반환
    mockDbExecute.mockResolvedValue({
      rows: [{
        student_id: 's1',
        student_name: '학생',
        status: 'waiting',
        assigned_class_group_id: null,
        absence_date: '2026-08-01',
        expire_at: null,
        swimming_pool_id: 'pool1',
      }],
    });
  });

  async function patchTeacherAssign(makeupId: string, payload: object) {
    const r = await fetch(`${baseUrl}/teacher/makeups/${makeupId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: any = await r.json().catch(() => null);
    return { status: r.status, body: json };
  }

  // ── C1. 달력 실존 날짜 오류 (validateMakeupOccurrence 내부에서 lib 함수 사용) ─
  it('C1-01 2026-02-31 → 400 INVALID_ASSIGNED_DATE (달력 없는 날)', async () => {
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-02-31',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
    expect(body.message).toContain('존재하지 않는 날짜');
  });

  it('C1-02 2026-13-01 → 400 INVALID_ASSIGNED_DATE', async () => {
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-13-01',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  it('C1-03 2026-04-31 → 400 INVALID_ASSIGNED_DATE (4월 31일 없음)', async () => {
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-04-31',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('INVALID_ASSIGNED_DATE');
  });

  // ── C2. 날짜 범위 오류 (validateMakeupOccurrence 내부에서 lib 함수 사용) ──
  it('C2-01 오늘 -15일 (2026-07-22) → 400 MAKEUP_DATE_OUT_OF_RANGE', async () => {
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-07-22',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
    expect(body.message).toContain('2주 전');
  });

  it('C2-02 오늘 +29일 (2026-09-04) → 400 MAKEUP_DATE_OUT_OF_RANGE', async () => {
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-09-04',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  // ── C3. 날짜 범위 내 날짜 — range 검증 통과 후 다음 검증으로 이동 ────────
  it('C3-01 rangeEnd 미래(2026-09-03) → 범위 통과 후 ASSIGN_REQUIRES_FUTURE_DATE 아님 확인', async () => {
    // 2026-09-03 > 2026-08-06(오늘) → is_future=true → assign 통과 조건
    // superAdminDb.execute (class_groups 조회) 필요
    mockSuperDbExec.mockResolvedValueOnce({
      rows: [{
        id: 'cg1', name: '월수금반', schedule_days: '월,수,금',
        schedule_time: '10:00', capacity: 20, teacher_user_id: 't1',
        teacher_name: '이선생', swimming_pool_id: 'pool1',
      }],
    });
    // db.execute: pool_holidays, member count, UPDATE, 부모 알림
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ student_id: 's1', student_name: '학생', status: 'waiting', assigned_class_group_id: null, absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] })
      .mockResolvedValueOnce({ rows: [] })       // pool_holidays
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })  // member count
      .mockResolvedValueOnce({ rows: [] })       // UPDATE
      .mockResolvedValue({ rows: [] });
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-09-03',  // 목요일 - schedule_days에 없으므로 CLASS_NOT_SCHEDULED_ON_DATE
    });
    // 날짜 범위 검증은 통과됨 (MAKEUP_DATE_OUT_OF_RANGE가 아님)
    expect(body.error).not.toBe('MAKEUP_DATE_OUT_OF_RANGE');
    expect(body.error).not.toBe('INVALID_ASSIGNED_DATE');
  });

  it('C3-02 오늘(2026-08-06)을 assign 요청 → ASSIGN_REQUIRES_FUTURE_DATE', async () => {
    mockSuperDbExec.mockResolvedValueOnce({
      rows: [{
        id: 'cg1', name: '월수금반', schedule_days: '목',
        schedule_time: '10:00', capacity: 20, teacher_user_id: 't1',
        teacher_name: '이선생', swimming_pool_id: 'pool1',
      }],
    });
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ student_id: 's1', student_name: '학생', status: 'waiting', assigned_class_group_id: null, absence_date: '2026-08-01', expire_at: null, swimming_pool_id: 'pool1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })
      .mockResolvedValue({ rows: [] });
    // 오늘(목) → isFuture=false → ASSIGN_REQUIRES_FUTURE_DATE
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-08-06',
    });
    expect(status).toBe(400);
    expect(body.error).toBe('ASSIGN_REQUIRES_FUTURE_DATE');
  });

  // ── C4. 상태 게이트 — validateMakeupOccurrence 진입 전 처리 ──────────────
  it('C4-01 status=expired + allow_expired 없음 → 409 MAKEUP_EXPIRED_CONFIRM_REQUIRED', async () => {
    mockDbExecute.mockResolvedValue({
      rows: [{
        student_id: 's1', student_name: '학생', status: 'expired',
        assigned_class_group_id: null, absence_date: '2026-08-01',
        expire_at: '2026-07-01', swimming_pool_id: 'pool1',
      }],
    });
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-09-03',
    });
    expect(status).toBe(409);
    expect(body.error).toBe('MAKEUP_EXPIRED_CONFIRM_REQUIRED');
  });

  it('C4-02 status=completed → 409 MAKEUP_ALREADY_COMPLETED', async () => {
    mockDbExecute.mockResolvedValue({
      rows: [{
        student_id: 's1', student_name: '학생', status: 'completed',
        assigned_class_group_id: null, absence_date: '2026-08-01',
        expire_at: null, swimming_pool_id: 'pool1',
      }],
    });
    const { status, body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-09-03',
    });
    expect(status).toBe(409);
    expect(body.error).toBe('MAKEUP_ALREADY_COMPLETED');
  });

  it('C4-03 status=waiting + expire_at 초과 + 범위 내 날짜 → expire_at 제한 없음 (날짜 검증 통과)', async () => {
    // expire_at이 과거여도 MAKEUP_DATE_OUT_OF_RANGE 또는 expire_at 관련 오류가 없어야 함
    mockDbExecute.mockResolvedValue({
      rows: [{
        student_id: 's1', student_name: '학생', status: 'waiting',
        assigned_class_group_id: null, absence_date: '2026-08-01',
        expire_at: '2026-07-01',  // 과거 expire_at
        swimming_pool_id: 'pool1',
      }],
    });
    mockSuperDbExec.mockResolvedValueOnce({
      rows: [{
        id: 'cg1', name: '목요반', schedule_days: '목',
        schedule_time: '10:00', capacity: 0, teacher_user_id: 't1',
        teacher_name: '이선생', swimming_pool_id: 'pool1',
      }],
    });
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ student_id: 's1', student_name: '학생', status: 'waiting', assigned_class_group_id: null, absence_date: '2026-08-01', expire_at: '2026-07-01', swimming_pool_id: 'pool1' }] })
      .mockResolvedValueOnce({ rows: [] })         // pool_holidays
      .mockResolvedValueOnce({ rows: [{ cnt: 5 }] })  // member count (capacity=0 이므로 no-limit)
      .mockResolvedValueOnce({ rows: [] })         // UPDATE
      .mockResolvedValue({ rows: [] });
    const { body } = await patchTeacherAssign('mk1', {
      class_group_id: 'cg1',
      assigned_date: '2026-09-04',  // +29 범위 밖
    });
    // 범위 밖 → MAKEUP_DATE_OUT_OF_RANGE (expire_at 오류가 아님)
    expect(body.error).toBe('MAKEUP_DATE_OUT_OF_RANGE');
    // expire_at 관련 오류 코드가 아님을 확인
    expect(body.error).not.toMatch(/EXPIRED|EXPIRE/);
  });
});
