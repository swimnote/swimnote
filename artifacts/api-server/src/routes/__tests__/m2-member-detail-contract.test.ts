/**
 * m2-member-detail-contract.test.ts
 * WP-M2: GET /admin/students/:id/detail — Data Contract 확장 검증
 *
 * CASE A  기존 detail client 필드 유지 (backward compat)
 * CASE B  parent_phone2~4 반환
 * CASE C  current_level_order 반환
 * CASE D  current_level_name mapping 정상
 * CASE E  class_group 정보 정상
 * CASE F  teacher 정보 정상
 * CASE G  attendance_summary 정확
 * CASE H  makeup_summary 정확
 * CASE I  parent account summary 안전 (민감정보 미포함)
 * CASE J  다른 pool student 접근 차단
 * CASE K  SWIMNOTE mode 동일 응답
 * CASE L  X mode 동일 일반 회원 응답
 * CASE M  AI/X field 불필요 mode gate 없음
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── DB 모킹 ──────────────────────────────────────────────────────────────────
const mockDbExecute         = vi.fn();
const mockSuperAdminExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db:           { execute: (...a: any[]) => mockDbExecute(...a), select: vi.fn() },
  superAdminDb: { execute: (...a: any[]) => mockSuperAdminExecute(...a), select: vi.fn() },
  pool:         { query: vi.fn().mockResolvedValue({ rows: [] }) },
  isDbSeparated:         false,
  isProtectDbConfigured: false,
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({ queryChunks: strings.raw, values }),
}));

// ── Auth 미들웨어 모킹 ─────────────────────────────────────────────────────────
const POOL_ID    = "pool_test_001";
const STUDENT_ID = "st_m2_001";
const TEACHER_ID = "user_teacher_001";
const PARENT_ID  = "pa_m2_001";

// req.user에 poolId 주입 → getAdminPoolId가 JWT poolId를 우선 사용
vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => {
    _req.user = { userId: "admin_user", role: "pool_admin", poolId: POOL_ID };
    next();
  },
  requireRole:       (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  requirePermission: (..._perms: string[]) => (_req: any, _res: any, next: any) => next(),
  requireXMode:      (_req: any, _res: any, next: any) => next(),
}));

// ── 라우터 import (mock 이후) ─────────────────────────────────────────────────
const { default: adminRouter } = await import("../admin.js");

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/admin", adminRouter);

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeStudent(overrides: Record<string, any> = {}) {
  return {
    id:               STUDENT_ID,
    swimming_pool_id: POOL_ID,
    name:             "김수영",
    phone:            "01011112222",
    birth_year:       "2010",
    birth_date:       null,
    status:           "active",
    memo:             "메모내용",
    notes:            "노트내용",
    parent_name:      "김학부모",
    parent_phone:     "01033334444",
    parent_phone2:    "01055556666",
    parent_phone3:    "01077778888",
    parent_phone4:    null,
    current_level_order:  3,
    class_group_id:       "cg_001",
    class_name:           "화목반",
    class_schedule_days:  "화,목",
    class_schedule_time:  "16:00",
    class_capacity:       12,
    teacher_user_id:      TEACHER_ID,
    teacher_name:         "박선생",
    parent_account_id:    PARENT_ID,
    parent_account_name:  "김학부모앱",
    parent_link_status:   "approved",
    withdrawn_at:         null,
    deleted_at:           null,
    archived_reason:      null,
    weekly_count:         2,
    assigned_class_ids:   ["cg_001"],
    created_at:           "2024-01-01T00:00:00Z",
    updated_at:           "2024-06-01T00:00:00Z",
    registration_path:    "admin_created",
    ...overrides,
  };
}

function setupMocks(opts: {
  student?:     Record<string, any>;
  levelRow?:    Record<string, any> | null;
  attSummary?:  Record<string, any>;
  mkSummary?:   Record<string, any>;
  parentLinks?: Record<string, any>[];
} = {}) {
  const stu = opts.student    ?? makeStudent();
  const lv  = opts.levelRow   !== undefined ? opts.levelRow : { level_order: 3, level_name: "중급", badge_color: "#1F8F86", badge_text_color: "#FFFFFF" };
  const att = opts.attSummary ?? { present_count: 8, absent_count: 1, late_count: 0 };
  const mk  = opts.mkSummary  ?? { waiting_count: 2, assigned_count: 1, completed_count: 5 };
  const pl  = opts.parentLinks ?? [{ id: PARENT_ID, name: "김학부모앱", phone: "01033334444", link_status: "approved" }];

  // superAdminDb — student + class + teacher + parent subquery (main query)
  mockSuperAdminExecute.mockResolvedValueOnce({ rows: [stu] });

  // db — Promise.all 6개 순서: level, attSummary, makeupSummary, attendance30, diaries, parentLinks
  mockDbExecute
    .mockResolvedValueOnce({ rows: lv ? [lv] : [] })  // level
    .mockResolvedValueOnce({ rows: [att] })            // attSummary
    .mockResolvedValueOnce({ rows: [mk] })             // makeupSummary
    .mockResolvedValueOnce({ rows: [] })               // attendance30
    .mockResolvedValueOnce({ rows: [] })               // diaries
    .mockResolvedValueOnce({ rows: pl });              // parentLinks
}

// ─────────────────────────────────────────────────────────────────────────────

describe("WP-M2 GET /admin/students/:id/detail — Data Contract", () => {
  beforeEach(() => { vi.resetAllMocks(); }); // resetAllMocks: mockResolvedValueOnce 큐도 초기화

  // ── CASE A: 기존 client 필드 유지 ──────────────────────────────────────────
  it("CASE A — 기존 client 필드 유지 (backward compat)", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(STUDENT_ID);
    expect(res.body.name).toBe("김수영");
    expect(res.body.status).toBe("active");
    expect(res.body.class_name).toBe("화목반");
    expect(res.body.teacher_name).toBe("박선생");
    expect(res.body.parent_account_name).toBe("김학부모앱");
    expect(res.body.parent_link_status).toBe("approved");
    expect(Array.isArray(res.body.recent_attendance)).toBe(true);
    expect(Array.isArray(res.body.recent_diaries)).toBe(true);
    expect(Array.isArray(res.body.parents)).toBe(true);
  });

  // ── CASE B: parent_phone2~4 ─────────────────────────────────────────────────
  it("CASE B — parent_phone2~4 정식 반환", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.parent_phone2).toBe("01055556666");
    expect(res.body.parent_phone3).toBe("01077778888");
    expect(res.body.parent_phone4).toBeNull();
  });

  // ── CASE C: current_level_order ─────────────────────────────────────────────
  it("CASE C — current_level_order (students SoT) 반환", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.current_level_order).toBe(3);
  });

  // ── CASE D: current_level_name mapping ─────────────────────────────────────
  it("CASE D — current_level_name/color mapping 정상", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.current_level_name).toBe("중급");
    expect(res.body.current_level_color).toBe("#1F8F86");
    expect(res.body.current_level_text_color).toBe("#FFFFFF");
  });

  it("CASE D-null — current_level_order null → level fields null", async () => {
    setupMocks({ student: makeStudent({ current_level_order: null }), levelRow: null });
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.current_level_order).toBeNull();
    expect(res.body.current_level_name).toBeNull();
    expect(res.body.current_level_color).toBeNull();
  });

  // ── CASE E: class_group 정보 ────────────────────────────────────────────────
  it("CASE E — class_group schedule_days/time/capacity 반환", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.class_group_id).toBe("cg_001");
    expect(res.body.class_schedule_days).toBe("화,목");
    expect(res.body.class_schedule_time).toBe("16:00");
    expect(res.body.class_capacity).toBe(12);
  });

  // ── CASE F: teacher 정보 ────────────────────────────────────────────────────
  it("CASE F — teacher_user_id + teacher_name 반환", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.teacher_user_id).toBe(TEACHER_ID);
    expect(res.body.teacher_name).toBe("박선생");
  });

  // ── CASE G: attendance_summary ──────────────────────────────────────────────
  it("CASE G — attendance_summary 이번 달 counts 정확", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    const s = res.body.attendance_summary;
    expect(s).toBeDefined();
    expect(s.current_month_present_count).toBe(8);
    expect(s.current_month_absent_count).toBe(1);
    expect(s.current_month_late_count).toBe(0);
  });

  it("CASE G-zero — 출결 없으면 all 0", async () => {
    setupMocks({ attSummary: { present_count: 0, absent_count: 0, late_count: 0 } });
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    const s = res.body.attendance_summary;
    expect(s.current_month_present_count).toBe(0);
    expect(s.current_month_absent_count).toBe(0);
    expect(s.current_month_late_count).toBe(0);
  });

  // ── CASE H: makeup_summary ──────────────────────────────────────────────────
  it("CASE H — makeup_summary counts 정확", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    const m = res.body.makeup_summary;
    expect(m).toBeDefined();
    expect(m.waiting_count).toBe(2);
    expect(m.assigned_count).toBe(1);
    expect(m.completed_count).toBe(5);
  });

  // ── CASE I: parent account summary 안전 ────────────────────────────────────
  it("CASE I — parent account summary 반환, 민감정보 없음", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.parent_account_id).toBe(PARENT_ID);
    expect(res.body.parent_account_name).toBe("김학부모앱");
    expect(res.body.parent_account_linked).toBe(true);
    // 민감정보 미포함
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("hashed_password");
    expect(res.body).not.toHaveProperty("login_id");
    expect(res.body).not.toHaveProperty("auth_token");
  });

  it("CASE I-unlinked — 학부모 미연결 시 parent_account_linked=false", async () => {
    setupMocks({
      student: makeStudent({ parent_account_id: null, parent_account_name: null, parent_link_status: null }),
      parentLinks: [],
    });
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body.parent_account_linked).toBe(false);
    expect(res.body.parent_account_id).toBeNull();
    expect(res.body.parents).toEqual([]);
  });

  // ── CASE J: 다른 pool student 접근 차단 ────────────────────────────────────
  it("CASE J — 다른 pool 학생: 404 반환", async () => {
    // student not found because poolId scope filter returns empty
    mockSuperAdminExecute.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/admin/students/st_other_pool/detail`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  // ── CASE K: SWIMNOTE mode ────────────────────────────────────────────────────
  it("CASE K — SWIMNOTE mode(일반) 동일 contract 반환", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("attendance_summary");
    expect(res.body).toHaveProperty("makeup_summary");
    expect(res.body).toHaveProperty("current_level_order");
    expect(res.body).toHaveProperty("parent_phone2");
  });

  // ── CASE L: X mode ──────────────────────────────────────────────────────────
  it("CASE L — X mode 학생도 동일 회원 contract 반환", async () => {
    setupMocks({ student: makeStudent({ status: "active" }) });
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("attendance_summary");
    expect(res.body).toHaveProperty("makeup_summary");
    expect(res.body).toHaveProperty("parent_phone2");
    expect(res.body).toHaveProperty("current_level_order");
  });

  // ── CASE M: mode gate 없음 ───────────────────────────────────────────────────
  it("CASE M — 응답에 UI/AI/mode-gate 전용 field 없음", async () => {
    setupMocks();
    const res = await request(app).get(`/admin/students/${STUDENT_ID}/detail`);
    expect(res.status).toBe(200);
    // UI-specific
    expect(res.body).not.toHaveProperty("tab1");
    expect(res.body).not.toHaveProperty("tab2");
    expect(res.body).not.toHaveProperty("sectionAVisible");
    expect(res.body).not.toHaveProperty("isXMode");
    expect(res.body).not.toHaveProperty("xModeGated");
    // AI 전용 데이터 미포함
    expect(res.body).not.toHaveProperty("growth_report");
    expect(res.body).not.toHaveProperty("ai_curriculum");
  });
});
