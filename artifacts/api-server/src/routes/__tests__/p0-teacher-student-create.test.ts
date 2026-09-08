/**
 * P0: Teacher 신규회원 등록 권한 + Pool Scope Guard
 *
 * CASE A: admin create (기존 동작 유지)
 * CASE B: teacher own-pool create (허용)
 * CASE C: teacher cross-pool reject (403 차단)
 * CASE D: duplicate reject (409)
 * CASE E: class assignment after create
 * CASE F: parent exact-match auto-link (student_id 동일성)
 * CASE G: RegisterModal + class-assign.tsx 파일 구조 검증
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const API_SERVER  = path.resolve(__dirname, "../..");
const SWIM_APP    = path.resolve(__dirname, "../../../../swim-app");

const STUDENTS_ROUTE = path.resolve(API_SERVER, "routes/students.ts");
const AUTO_LINK_V2   = path.resolve(API_SERVER, "lib/auto-link-v2.ts");
const REGISTER_MODAL = path.resolve(SWIM_APP, "components/admin/members/RegisterModal.tsx");
const TEACHER_STU    = path.resolve(SWIM_APP, "app/(teacher)/students.tsx");
const CLASS_ASSIGN   = path.resolve(SWIM_APP, "app/class-assign.tsx");

function readFile(p: string) { return fs.readFileSync(p, "utf-8"); }

// ──────────────────────────────────────────────────────────────────────────────
// CASE A: Admin create 권한 유지
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE A: admin create 권한 유지", () => {
  it("A-1. POST /students/ 에 pool_admin 권한 존재", () => {
    const src = readFile(STUDENTS_ROUTE);
    expect(src).toContain('"pool_admin"');
  });
  it("A-2. POST /students/ 에 super_admin 권한 존재", () => {
    const src = readFile(STUDENTS_ROUTE);
    expect(src).toContain('"super_admin"');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE B: Teacher own-pool create 허용
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE B: teacher own-pool create 허용", () => {
  it("B-1. POST /students/ requireRole에 teacher 포함", () => {
    const src = readFile(STUDENTS_ROUTE);
    // POST / 라우트에서 teacher role이 허용되어야 함
    const postBlock = src.split("router.post").find(s => s.startsWith('("/",') || s.startsWith('("/", requireAuth'));
    expect(postBlock ?? src).toContain('"teacher"');
  });
  it("B-2. getPoolId로 server-side pool 결정 (body.pool_id 신뢰 안 함)", () => {
    const src = readFile(STUDENTS_ROUTE);
    expect(src).toContain("getPoolId(req.user");
    // client body의 pool_id를 직접 INSERT에 사용하지 않음
    // swimming_pool_id는 getPoolId로 결정된 poolId 사용
    expect(src).toContain("swimming_pool_id = ${poolId}");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE C: Teacher cross-pool reject — server-side scope
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE C: teacher cross-pool reject", () => {
  it("C-1. getPoolId 결과로 403 처리 존재", () => {
    const src = readFile(STUDENTS_ROUTE);
    // poolId가 없으면 403
    expect(src).toContain("소속된 수영장이 없습니다");
  });
  it("C-2. body에서 pool_id를 직접 받는 INSERT 없음", () => {
    const src = readFile(STUDENTS_ROUTE);
    // req.body.pool_id 또는 body.pool_id를 swimming_pool_id로 직접 insert하지 않음
    expect(src).not.toMatch(/swimming_pool_id.*req\.body\.pool_id/);
    expect(src).not.toMatch(/INSERT.*swimming_pool_id.*body\.pool_id/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE D: Duplicate reject (existing rule 유지)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE D: duplicate reject", () => {
  it("D-1. 409 duplicate 응답 존재", () => {
    const src = readFile(STUDENTS_ROUTE);
    expect(src).toContain("status(409)");
    expect(src).toContain("duplicate: true");
  });
  it("D-2. possible_duplicate (유사 중복) 처리 존재", () => {
    const src = readFile(STUDENTS_ROUTE);
    expect(src).toContain("possible_duplicate");
  });
  it("D-3. force_create 옵션 존재 (중복 확인 후 강제 등록)", () => {
    const src = readFile(STUDENTS_ROUTE);
    expect(src).toContain("force_create");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE E: class assignment after create (class-assign.tsx 구조)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE E: class assignment after create", () => {
  it("E-1. class-assign.tsx에 RegisterModal import", () => {
    const src = readFile(CLASS_ASSIGN);
    expect(src).toContain("RegisterModal");
  });
  it("E-2. handleRegisterSuccess 함수 존재 (신규등록 후 자동 배정)", () => {
    const src = readFile(CLASS_ASSIGN);
    expect(src).toContain("handleRegisterSuccess");
  });
  it("E-3. /assign PATCH API 호출 포함", () => {
    const src = readFile(CLASS_ASSIGN);
    expect(src).toContain("/assign");
    expect(src).toContain("PATCH");
  });
  it("E-4. 신규등록 버튼 UI 존재", () => {
    const src = readFile(CLASS_ASSIGN);
    expect(src).toContain("신규등록");
  });
  it("E-5. showRegister state 존재", () => {
    const src = readFile(CLASS_ASSIGN);
    expect(src).toContain("showRegister");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE F: parent exact-match auto-link (auto-link-v2)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE F: parent exact-match auto-link", () => {
  it("F-1. auto-link-v2.ts 존재", () => {
    expect(fs.existsSync(AUTO_LINK_V2)).toBe(true);
  });
  it("F-2. parent_v2_pending 테이블 사용", () => {
    const src = readFile(AUTO_LINK_V2);
    expect(src).toContain("parent_v2_pending");
  });
  it("F-3. student_id 동일성 기반 연결 (새 student 미생성)", () => {
    const src = readFile(AUTO_LINK_V2);
    expect(src).toContain("parent_students");
    // 새 student INSERT가 아닌 기존 student_id 기반 연결
    expect(src).toContain("student_id");
  });
  it("F-4. triggerAutoLinkOnStudentV2 존재 — student 생성 후 자동 링크 트리거", () => {
    const studSrc = readFile(STUDENTS_ROUTE);
    expect(studSrc).toContain("triggerAutoLinkOnStudentV2");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE G: Teacher 회원관리 신규등록 UI 구조
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE G: Teacher 회원관리 신규등록 UI", () => {
  it("G-1. (teacher)/students.tsx에 RegisterModal import", () => {
    const src = readFile(TEACHER_STU);
    expect(src).toContain("RegisterModal");
  });
  it("G-2. 신규등록 버튼 존재", () => {
    const src = readFile(TEACHER_STU);
    expect(src).toContain("신규등록");
  });
  it("G-3. showRegister state 존재", () => {
    const src = readFile(TEACHER_STU);
    expect(src).toContain("showRegister");
  });
  it("G-4. showTeacherHint prop 전달 — 학부모 전화번호 안내", () => {
    const src = readFile(TEACHER_STU);
    expect(src).toContain("showTeacherHint");
  });
  it("G-5. Home 이동 없음 (현재 화면 유지)", () => {
    const src = readFile(TEACHER_STU);
    // onSuccess에서 router.push/replace to home 없음
    const onSuccessBlock = src.match(/onSuccess=\{[^}]+\}/);
    if (onSuccessBlock) {
      expect(onSuccessBlock[0]).not.toContain("router.push");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE H: RegisterModal canonical 구조 유지 (Admin 회귀 없음)
// ──────────────────────────────────────────----------------------------------------------------------------
describe("CASE H: RegisterModal Admin 회귀 없음", () => {
  it("H-1. RegisterModal 필수 필드 유지: 학생이름, 출생년도, 학부모이름, 전화번호, 주횟수", () => {
    const src = readFile(REGISTER_MODAL);
    expect(src).toContain("학생 이름");
    expect(src).toContain("출생년도");
    expect(src).toContain("학부모 이름");
    expect(src).toContain("학부모 전화번호");
    expect(src).toContain("주 수업 횟수");
  });
  it("H-2. phone normalize/validation 유지", () => {
    const src = readFile(REGISTER_MODAL);
    expect(src).toContain("normalizePhone");
    expect(src).toContain("isValidPhone");
  });
  it("H-3. duplicate flow (DuplicateModal) 유지", () => {
    const src = readFile(REGISTER_MODAL);
    expect(src).toContain("DuplicateModal");
    expect(src).toContain("dupCandidates");
  });
  it("H-4. registration_path 'admin_created' 유지", () => {
    const src = readFile(REGISTER_MODAL);
    expect(src).toContain("admin_created");
  });
  it("H-5. showTeacherHint prop 추가 (optional)", () => {
    const src = readFile(REGISTER_MODAL);
    expect(src).toContain("showTeacherHint");
    // optional이어야 함 (? 사용)
    expect(src).toContain("showTeacherHint?");
  });
  it("H-6. poolName optional로 변경됨 (Teacher에서 poolName 없이 사용 가능)", () => {
    const src = readFile(REGISTER_MODAL);
    expect(src).toContain("poolName?");
  });
});
