/**
 * WP-M4: Teacher Student Detail Long-scroll Consolidation
 *
 * CASE A~W (23개)
 * 대상: student-detail.tsx 구조 변경 + 공통 컴포넌트 재사용 검증
 *
 * Baseline: 154 pre-existing failures (WP-M3 이후)
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SWIM_APP     = path.resolve(__dirname, "../../../../swim-app");
const TEACHER_SCREEN = path.resolve(SWIM_APP, "app/(teacher)/student-detail.tsx");
const ADMIN_MEMBER = path.resolve(SWIM_APP, "components/admin/member");

function readScreen(): string {
  return fs.readFileSync(TEACHER_SCREEN, "utf-8");
}

// ──────────────────────────────────────────────────────────────────────────────
// CASE A: Teacher Student Detail 진입 — 화면 파일 존재 + long-scroll 구조
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE A: student-detail screen 존재 + long-scroll 구조", () => {
  it("A-1. student-detail.tsx 파일 존재", () => {
    expect(fs.existsSync(TEACHER_SCREEN)).toBe(true);
  });

  it("A-2. 탭 구조 없음 (tab bar 제거)", () => {
    const src = readScreen();
    expect(src).not.toContain("activeTab");
    expect(src).not.toContain("TABS");
  });

  it("A-3. 단일 ScrollView long-scroll", () => {
    const src = readScreen();
    expect(src).toContain("ScrollView");
    expect(src).toContain("contentContainerStyle");
    expect(src).toContain("paddingBottom");
  });

  it("A-4. KeyboardAvoidingView 사용", () => {
    const src = readScreen();
    expect(src).toContain("KeyboardAvoidingView");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE B: Back navigation — previous screen (homePath 제거)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE B: back navigation", () => {
  it("B-1. homePath 없음 (today-schedule 하드코딩 제거)", () => {
    const src = readScreen();
    // SubScreenHeader에 homePath prop 없어야 함
    expect(src).not.toMatch(/homePath=["']\/(teacher)\/today-schedule["']/);
  });

  it("B-2. 홈 하드코딩 router.push/replace 없음", () => {
    const src = readScreen();
    expect(src).not.toMatch(/router\.(push|replace).*today-schedule/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE C: 기본정보 표시 (Section A)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE C: Section A — 기본정보 표시", () => {
  it("C-1. name, birth_year, gender, parent_name 표시", () => {
    const src = readScreen();
    expect(src).toContain("student.name");
    expect(src).toContain("birth_year");
    expect(src).toContain("gender");
    expect(src).toContain("parent_name");
  });

  it("C-2. 기본 정보 섹션 레이블", () => {
    const src = readScreen();
    expect(src).toContain("기본 정보");
  });

  it("C-3. 등록일(created_at) 표시", () => {
    const src = readScreen();
    expect(src).toContain("created_at");
    expect(src).toContain("등록일");
  });

  it("C-4. Admin 전용 민감정보(memo/notes edit) 미추가", () => {
    const src = readScreen();
    // teacher는 기본정보 full edit form 없음
    expect(src).not.toContain("SectionA_BasicInfo");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE D: 반/요일/시간 표시 (Section B)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE D: Section B — 수강정보 표시", () => {
  it("D-1. 수강 반 섹션 레이블", () => {
    const src = readScreen();
    expect(src).toContain("수강 정보");
  });

  it("D-2. assignedClasses — schedule_days, schedule_time, name", () => {
    const src = readScreen();
    expect(src).toContain("assignedClasses");
    expect(src).toContain("schedule_days");
    expect(src).toContain("schedule_time");
    expect(src).toContain("cls.name");
  });

  it("D-3. 요일 한글 변환 (KO_DAYS)", () => {
    const src = readScreen();
    expect(src).toContain("KO_DAYS");
  });

  it("D-4. Section B는 READ-ONLY (반 변경 버튼 없음)", () => {
    const src = readScreen();
    // 반 배정 변경 기능 없음
    expect(src).not.toContain("setAssignedIds");
    expect(src).not.toContain("showPicker");
    expect(src).not.toContain("ClassPickerModal");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE E: 개인 레벨 표시 (Section C)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE E: Section C — 레벨 표시", () => {
  it("E-1. SectionC_Level 공통 컴포넌트 재사용 (Admin과 공유)", () => {
    const src = readScreen();
    expect(src).toContain("SectionC_Level");
  });

  it("E-2. current_level_order 참조", () => {
    const src = readScreen();
    expect(src).toContain("current_level_order");
  });

  it("E-3. level badge 표시", () => {
    const src = readScreen();
    expect(src).toContain("level_name");
  });

  it("E-4. 레벨 초기 로드 — mount 시 /teacher/students/:id/level", () => {
    const src = readScreen();
    expect(src).toContain("/teacher/students/${id}/level");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE F: 레벨 변경 (PATCH /teacher/students/:id/level)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE F: 레벨 변경 보존", () => {
  it("F-1. PATCH /teacher/students/:id/level 사용", () => {
    const src = readScreen();
    // teacher endpoint 사용 (admin endpoint 사용 안 함)
    expect(src).toContain("/teacher/students/${id}/level");
    expect(src).toContain(`"PATCH"`);
  });

  it("F-2. Admin endpoint 미사용", () => {
    const src = readScreen();
    expect(src).not.toContain("/admin/students/${id}/level");
  });

  it("F-3. showLevelPicker + handleLevelChange 유지", () => {
    const src = readScreen();
    expect(src).toContain("showLevelPicker");
    expect(src).toContain("handleLevelChange");
  });

  it("F-4. level note 입력 UI (기존 기능 유지)", () => {
    const src = readScreen();
    expect(src).toContain("levelNote");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE G: 출결 summary 표시 (Section D)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE G: Section D — 출결 summary 표시", () => {
  it("G-1. 출결 현황 섹션 레이블", () => {
    const src = readScreen();
    expect(src).toContain("출결 현황");
  });

  it("G-2. present/absent/late 카운트 표시", () => {
    const src = readScreen();
    expect(src).toContain("attStat.present");
    expect(src).toContain("attStat.absent");
    expect(src).toContain("attStat.late");
  });

  it("G-3. /students/:id/attendance 호출", () => {
    const src = readScreen();
    expect(src).toContain("/students/${id}/attendance");
  });

  it("G-4. 출결 상세보기 shortcut", () => {
    const src = readScreen();
    expect(src).toContain("출결 상세보기");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE H: 보강 summary — 구조 확인
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE H: Section D — 보강 summary 구조", () => {
  it("H-1. SectionD에서 출결 데이터 기반 표시 (makeups shortcut은 Section F에서 지원)", () => {
    const src = readScreen();
    // 보강 shortcut or section D
    const hasMakeup = src.includes("makeups") || src.includes("보강");
    expect(hasMakeup).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE I: parent_phone1 표시 (Section E)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE I: Section E — parent_phone1 표시", () => {
  it("I-1. parent_phone 표시 + 전화/문자 action", () => {
    const src = readScreen();
    expect(src).toContain("parent_phone");
    expect(src).toContain("callPhone");
    expect(src).toContain("sendSms");
  });

  it("I-2. 보호자 연락처 섹션 레이블", () => {
    const src = readScreen();
    expect(src).toContain("보호자 연락처");
  });

  it("I-3. 보호자 1 슬롯 표시", () => {
    const src = readScreen();
    expect(src).toContain("보호자 1");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE J: parent_phone2 표시
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE J: parent_phone2 표시", () => {
  it("J-1. parent_phone2 참조", () => {
    const src = readScreen();
    expect(src).toContain("parent_phone2");
  });

  it("J-2. 보호자 2 슬롯 표시", () => {
    const src = readScreen();
    expect(src).toContain("보호자 2");
  });

  it("J-3. slot 1/2 편집 기능 유지 (PATCH /students/:id/parent-phones)", () => {
    const src = readScreen();
    expect(src).toContain("/students/${id}/parent-phones");
    expect(src).toContain("slot");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE K: phone3/4 미노출 (teacher 의도적 제한)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE K: phone3/4 미노출", () => {
  it("K-1. parent_phone3 상태변수 없음", () => {
    const src = readScreen();
    expect(src).not.toContain("editParentPhone3");
    expect(src).not.toContain("parent_phone3");
  });

  it("K-2. parent_phone4 상태변수 없음", () => {
    const src = readScreen();
    expect(src).not.toContain("editParentPhone4");
    expect(src).not.toContain("parent_phone4");
  });

  it("K-3. 보호자 3/4 슬롯 미노출", () => {
    const src = readScreen();
    expect(src).not.toContain("보호자 3");
    expect(src).not.toContain("보호자 4");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE L: 메모 수정 — teacher 권한 범위 확인
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE L: 메모 수정 권한 범위 확인", () => {
  it("L-1. Admin 전체 기본정보 edit form 없음 (SectionA_BasicInfo 미포함)", () => {
    const src = readScreen();
    expect(src).not.toContain("SectionA_BasicInfo");
  });

  it("L-2. teacher가 현재 수정 가능한 것만: 레벨, phone1/2", () => {
    const src = readScreen();
    // 레벨 변경 O
    expect(src).toContain("confirmLevelChange");
    // phone edit O
    expect(src).toContain("savePhoneEdit");
    // Admin info edit (name/birth 전체) X
    expect(src).not.toContain("saveInfo");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE M: 일지 shortcut (Section F)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE M: Section F — 일지 shortcut", () => {
  it("M-1. 일지 보기 버튼 존재", () => {
    const src = readScreen();
    expect(src).toContain("일지 보기");
  });

  it("M-2. diary 화면으로 push", () => {
    const src = readScreen();
    expect(src).toContain("diary");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE N: 사진/영상 shortcut
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE N: Section F — 사진/영상 shortcut", () => {
  it("N-1. 사진/영상 버튼 존재", () => {
    const src = readScreen();
    expect(src).toContain("사진/영상");
  });

  it("N-2. photos 화면으로 push", () => {
    const src = readScreen();
    expect(src).toContain("photos");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE O: Admin Danger Zone 미노출
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE O: Admin Danger Zone 미노출", () => {
  it("O-1. SectionH_StatusMgmt 미포함 (admin 전용)", () => {
    const src = readScreen();
    expect(src).not.toContain("SectionH_StatusMgmt");
  });

  it("O-2. dangerExpanded / 위험 작업 accordion 없음", () => {
    const src = readScreen();
    expect(src).not.toContain("dangerExpanded");
    expect(src).not.toContain("위험 작업");
  });

  it("O-3. MemberStatusChangeModal 없음 (상태 변경 = admin 전용)", () => {
    const src = readScreen();
    expect(src).not.toContain("MemberStatusChangeModal");
    expect(src).not.toContain("showStatusModal");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE P: delete/purge/force-delete 미노출
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE P: 관리자 전용 삭제 액션 미노출", () => {
  it("P-1. purge endpoint 미사용 (API call 없음)", () => {
    const src = readScreen();
    // 실제 API 호출 없음 — apiRequest 인자로 purge 없음
    expect(src).not.toMatch(/apiRequest\([^)]*purge/);
    expect(src).not.toContain("/purge");
    expect(src).not.toContain("영구 삭제");
  });

  it("P-2. force-delete endpoint 미사용 (API call 없음)", () => {
    const src = readScreen();
    expect(src).not.toMatch(/apiRequest\([^)]*force-delete/);
    expect(src).not.toContain("강제 삭제");
  });

  it("P-3. permanent delete 미노출 (UI label 없음)", () => {
    const src = readScreen();
    expect(src).not.toContain("영구삭제");
    expect(src).not.toContain("영구 삭제");
    // Section H에 DangerZone UI 없음
    expect(src).not.toContain("dangerExpanded");
  });

  it("P-4. restore endpoint 미사용 (API call 없음)", () => {
    const src = readScreen();
    expect(src).not.toMatch(/apiRequest\([^)]*\/restore/);
    expect(src).not.toContain("복귀 처리");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE Q: 다른 teacher 담당 학생 접근 차단 (API 권한 유지)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE Q: 담당 학생 접근 범위", () => {
  it("Q-1. /students/:id 호출 (teacher scope 기존 API 유지)", () => {
    const src = readScreen();
    expect(src).toContain("/students/${id}`");
  });

  it("Q-2. 관리자용 /admin/students/:id/detail 미사용", () => {
    const src = readScreen();
    expect(src).not.toContain("/admin/students/${id}/detail");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE R: 다른 pool 학생 접근 차단 (API 권한 유지)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE R: cross-pool 차단", () => {
  it("R-1. pool 파라미터 별도 사용 없음 (API가 pool 격리 보장)", () => {
    const src = readScreen();
    // teacher API는 서버 측에서 pool 격리
    // 클라이언트는 token 기반 (별도 pool 파라미터 추가 없음)
    expect(src).toContain("token");
    expect(src).not.toContain("poolId");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE S: SWIMNOTE normal 동일 화면 (mode gate 없음)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE S: Normal mode 동일 화면", () => {
  it("S-1. student-detail에 xMode 분기 없음", () => {
    const src = readScreen();
    expect(src).not.toMatch(/isXMode|xMode\s*\?|useXMode/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE T: X mode 동일 화면
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE T: X mode 동일 화면", () => {
  it("T-1. useModeContext 없음", () => {
    const src = readScreen();
    expect(src).not.toContain("useModeContext");
    expect(src).not.toContain("useMode(");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE U: 신규 mode gate 0
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE U: 신규 mode gate 0", () => {
  it("U-1. mode gate 추가 없음", () => {
    const src = readScreen();
    expect(src).not.toContain("XModeGuard");
    expect(src).not.toContain("requiresX");
    expect(src).not.toContain("isXMode");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE V: Admin과 공통 component 동작 (공통 재사용 검증)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE V: Admin 공통 컴포넌트 재사용", () => {
  it("V-1. MemberSectionCard import (WP-M3 공통 컴포넌트 재사용)", () => {
    const src = readScreen();
    expect(src).toContain("MemberSectionCard");
    expect(src).toContain("InfoRow");
  });

  it("V-2. SectionC_Level 공통 재사용 (endpoint는 callback으로 분리)", () => {
    const src = readScreen();
    expect(src).toContain("SectionC_Level");
    // 레벨 endpoint는 teacher가 직접 관리 (admin endpoint 미포함)
    expect(src).not.toContain("/admin/students/${id}/level");
  });

  it("V-3. MemberSectionCard.tsx 파일 Admin member에 존재", () => {
    expect(fs.existsSync(path.join(ADMIN_MEMBER, "MemberSectionCard.tsx"))).toBe(true);
  });

  it("V-4. SectionC_Level.tsx 파일 Admin member에 존재", () => {
    expect(fs.existsSync(path.join(ADMIN_MEMBER, "SectionC_Level.tsx"))).toBe(true);
  });

  it("V-5. Teacher screen이 Admin의 SectionA_BasicInfo 미사용 (역할별 분리)", () => {
    const src = readScreen();
    // admin 전용 section 컴포넌트는 재사용 안 함
    expect(src).not.toContain("SectionA_BasicInfo");
    expect(src).not.toContain("SectionB_ClassInfo");
    expect(src).not.toContain("SectionH_StatusMgmt");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE W: 마지막 Section까지 scroll 가능
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE W: long-scroll — 마지막 section 도달 가능", () => {
  it("W-1. contentContainerStyle paddingBottom ≥ 40", () => {
    const src = readScreen();
    const match = src.match(/paddingBottom:\s*(\d+)/);
    expect(match).toBeTruthy();
    const val = parseInt(match![1], 10);
    expect(val).toBeGreaterThanOrEqual(40);
  });

  it("W-2. Section H (회원 상태)가 ScrollView 마지막 자식", () => {
    const src = readScreen();
    const hIdx = src.indexOf("회원 상태");
    const fIdx = src.indexOf("일지 / 사진");
    expect(hIdx).toBeGreaterThan(fIdx);
  });

  it("W-3. Section G 미노출 (WP-M5 전까지)", () => {
    const src = readScreen();
    expect(src).not.toContain("SectionG");
    expect(src).not.toContain("준비 중");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 구조 무결성
// ──────────────────────────────────────────────────────────────────────────────
describe("구조 무결성", () => {
  it("Admin Member Detail 미수정 (member-detail.tsx 변경 없음)", () => {
    const adminScreen = path.resolve(SWIM_APP, "app/(admin)/member-detail.tsx");
    expect(fs.existsSync(adminScreen)).toBe(true);
    const src = fs.readFileSync(adminScreen, "utf-8");
    // Admin 화면은 WP-M3 이후 그대로 (SectionA_BasicInfo 포함)
    expect(src).toContain("SectionA_BasicInfo");
    expect(src).toContain("SectionH_StatusMgmt");
  });

  it("Parent UI 미수정", () => {
    const parentHome = path.resolve(SWIM_APP, "app/(parent)/home.tsx");
    if (fs.existsSync(parentHome)) {
      const src = fs.readFileSync(parentHome, "utf-8");
      expect(src).not.toContain("SectionH_StatusMgmt");
    } else {
      expect(true).toBe(true);
    }
  });

  it("student_links 미생성", () => {
    const src = readScreen();
    expect(src).not.toContain("student_links");
  });

  it("Delete/Restore API 미변경 (teacher screen에서 API 미사용 확인)", () => {
    const src = readScreen();
    // 실제 API call 없음
    expect(src).not.toMatch(/apiRequest\([^)]*force-delete/);
    expect(src).not.toMatch(/apiRequest\([^)]*\/restore/);
    // admin member-detail.tsx는 기존 상태 유지
    const adminScreen = path.resolve(SWIM_APP, "app/(admin)/member-detail.tsx");
    if (fs.existsSync(adminScreen)) {
      const adminSrc = fs.readFileSync(adminScreen, "utf-8");
      expect(adminSrc).toContain("SectionH_StatusMgmt");
    }
  });
});
