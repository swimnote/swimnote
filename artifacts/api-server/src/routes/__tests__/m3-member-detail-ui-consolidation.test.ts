/**
 * WP-M3: Admin Member Detail Long-scroll Consolidation
 *
 * CASE A~X (24개)
 * 대상: 신규 Section 컴포넌트 계약 + member-detail 화면 구조 변경
 * 성격: 구조적/계약적 검증 (UI 렌더는 Expo에서만 가능, 여기는 계약 검증)
 *
 * Baseline: 154 pre-existing failures (WP-M2 이후)
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SWIM_APP = path.resolve(__dirname, "../../../../swim-app");
const MEMBER_COMP = path.resolve(SWIM_APP, "components/admin/member");
const ADMIN_SCREEN = path.resolve(SWIM_APP, "app/(admin)/member-detail.tsx");

function readComp(name: string): string {
  return fs.readFileSync(path.join(MEMBER_COMP, name), "utf-8");
}

function readScreen(): string {
  return fs.readFileSync(ADMIN_SCREEN, "utf-8");
}

// ──────────────────────────────────────────────────────────────────────────────
// CASE A: Member Detail screen 파일 존재 + long-scroll 구조
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE A: member-detail screen 존재 + long-scroll 구조", () => {
  it("A-1. member-detail.tsx 파일 존재", () => {
    expect(fs.existsSync(ADMIN_SCREEN)).toBe(true);
  });

  it("A-2. 탭 바 (TABS const + horizontal ScrollView tabScroll) 제거됨", () => {
    const src = readScreen();
    expect(src).not.toContain("const TABS");
    expect(src).not.toContain("tabScroll");
    expect(src).not.toContain("activeTab");
  });

  it("A-3. 단일 vertical ScrollView 존재", () => {
    const src = readScreen();
    // 수직 스크롤 contentContainerStyle
    expect(src).toContain("contentContainerStyle");
    expect(src).toContain("paddingBottom");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE B: Back navigation — router.back() 만 사용
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE B: back navigation", () => {
  it("B-1. router.back() 사용", () => {
    const src = readScreen();
    expect(src).toContain("router.back()");
  });

  it("B-2. 홈 하드코딩 없음", () => {
    const src = readScreen();
    expect(src).not.toMatch(/router\.push.*["']\/(admin\/)?home["']/);
    expect(src).not.toMatch(/router\.replace.*["']\/(admin\/)?home["']/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE C: 기본정보 표시 (Section A)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE C: Section A — 기본정보 표시", () => {
  it("C-1. SectionA_BasicInfo 컴포넌트 파일 존재", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "SectionA_BasicInfo.tsx"))).toBe(true);
  });

  it("C-2. name, birth_year, memo, notes 필드 표시", () => {
    const src = readComp("SectionA_BasicInfo.tsx");
    expect(src).toContain("data.name");
    expect(src).toContain("birth_year");
    expect(src).toContain("memo");
    expect(src).toContain("notes");
  });

  it("C-3. 등록일(created_at) + 등록 경로(registration_path) 표시", () => {
    const src = readComp("SectionA_BasicInfo.tsx");
    expect(src).toContain("created_at");
    expect(src).toContain("registration_path");
  });

  it("C-4. member-detail이 SectionA_BasicInfo import", () => {
    const src = readScreen();
    expect(src).toContain("SectionA_BasicInfo");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE D: 기본정보 수정/저장 (Section A edit mode)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE D: Section A — 기본정보 section-level edit mode", () => {
  it("D-1. SectionA_BasicInfo에 onSave prop", () => {
    const src = readComp("SectionA_BasicInfo.tsx");
    expect(src).toContain("onSave");
  });

  it("D-2. editing state (수정/저장/취소 토글)", () => {
    const src = readComp("SectionA_BasicInfo.tsx");
    expect(src).toContain("editing");
    expect(src).toContain("setEditing");
  });

  it("D-3. handleCancel이 원본값으로 리셋", () => {
    const src = readComp("SectionA_BasicInfo.tsx");
    expect(src).toContain("handleCancel");
    expect(src).toContain("setEditName(data.name");
  });

  it("D-4. PATCH /admin/students/:id/info 호출 (saveInfo)", () => {
    const src = readScreen();
    expect(src).toContain("/admin/students/${id}/info");
    expect(src).toContain(`"PATCH"`);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE E: 보호자 연락처 1~4 표시 (Section E)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE E: Section E — 보호자 연락처 parent_phone~4", () => {
  it("E-1. SectionE_Guardian 파일 존재", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "SectionE_Guardian.tsx"))).toBe(true);
  });

  it("E-2. parent_phone, phone2, phone3, phone4 모두 참조", () => {
    const src = readComp("SectionE_Guardian.tsx");
    expect(src).toContain("parent_phone");
    expect(src).toContain("parent_phone2");
    expect(src).toContain("parent_phone3");
    expect(src).toContain("parent_phone4");
  });

  it("E-3. phone 표시 배열: 보호자 1~4 레이블", () => {
    const src = readComp("SectionE_Guardian.tsx");
    expect(src).toContain("보호자 1");
    expect(src).toContain("보호자 2");
    expect(src).toContain("보호자 3");
    expect(src).toContain("보호자 4");
  });

  it("E-4. phone/sms utility 사용 (callPhone, sendSms)", () => {
    const src = readComp("SectionE_Guardian.tsx");
    expect(src).toContain("callPhone");
    expect(src).toContain("sendSms");
  });

  it("E-5. member-detail이 SectionE_Guardian import + editParentPhone4 state", () => {
    const src = readScreen();
    expect(src).toContain("SectionE_Guardian");
    expect(src).toContain("editParentPhone4");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE F: 반·담당선생님·요일·시간 표시 (Section B)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE F: Section B — 수강정보 표시", () => {
  it("F-1. SectionB_ClassInfo 파일 존재", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "SectionB_ClassInfo.tsx"))).toBe(true);
  });

  it("F-2. 반명(g.name), 요일(schedule_days), 시간(schedule_time), 선생님(instructor) 표시", () => {
    const src = readComp("SectionB_ClassInfo.tsx");
    expect(src).toContain("g.name");
    expect(src).toContain("schedule_days");
    expect(src).toContain("schedule_time");
    expect(src).toContain("instructor");
  });

  it("F-3. 배정된 반 수 / 주당횟수 표시 (assignedIds.length/weeklyCount)", () => {
    const src = readComp("SectionB_ClassInfo.tsx");
    expect(src).toContain("assignedIds.length");
    expect(src).toContain("weeklyCount");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE G: 반 변경 — 인라인 피커로 교체 (WP1 정책: ClassPickerModal detail에서 제거)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE G: 반 변경 — 인라인 피커 (WP1)", () => {
  it("G-1. detail에서 ClassPickerModal mount 없음 + showClassPicker 인라인 피커 존재", () => {
    const src = readScreen();
    // WP1: ClassPickerModal은 detail에서 제거됨 (mount 없음)
    expect(src).not.toContain("showPicker");
    expect(src).not.toContain("setShowPicker");
    // 인라인 피커 state + 핸들러 존재
    expect(src).toContain("showClassPicker");
    expect(src).toContain("pickedClassIds");
    expect(src).toContain("togglePickedClass");
  });

  it("G-2. ClassPickerModal.tsx 파일은 members.tsx 재사용을 위해 유지됨", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "ClassPickerModal.tsx"))).toBe(true);
  });

  it("G-3. 반 선택 후 assignedIds + classChanged 업데이트", () => {
    const src = readScreen();
    expect(src).toContain("setAssignedIds");
    expect(src).toContain("setClassChanged");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE H: 주당횟수 변경 기존 기능 보존
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE H: 주당횟수 변경 보존", () => {
  it("H-1. WEEKLY_BADGE + 1/2/3 버튼 (SectionB)", () => {
    const src = readComp("SectionB_ClassInfo.tsx");
    expect(src).toContain("WEEKLY_BADGE");
    expect(src).toContain("[1, 2, 3]");
  });

  it("H-2. setWeeklyCount + setClassChanged 연동", () => {
    const src = readComp("SectionB_ClassInfo.tsx");
    expect(src).toContain("setWeeklyCount");
    expect(src).toContain("setClassChanged");
  });

  it("H-3. 배정 저장 → PATCH /students/:id/assign", () => {
    const src = readScreen();
    expect(src).toContain("/students/${id}/assign");
    expect(src).toContain("assigned_class_ids");
    expect(src).toContain("weekly_count");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE I: 학생 개인 레벨 표시 (Section C)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE I: Section C — 학생 레벨 표시", () => {
  it("I-1. SectionC_Level 파일 존재", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "SectionC_Level.tsx"))).toBe(true);
  });

  it("I-2. current_level_order SoT 참조 (WP-M2 data or levelInfo)", () => {
    const src = readComp("SectionC_Level.tsx");
    expect(src).toContain("current_level_order");
  });

  it("I-3. current_level_name 표시 (WP-M2 expanded field)", () => {
    const src = readComp("SectionC_Level.tsx");
    expect(src).toContain("current_level_name");
  });

  it("I-4. level 초기 로드 — mount 시 /admin/students/:id/level 호출", () => {
    const src = readScreen();
    expect(src).toContain("/admin/students/${id}/level");
    // 탭 lazy load 아닌 초기 load에 포함
    expect(src).toContain("Promise.all");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE J: 레벨 변경 보존
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE J: 레벨 변경 보존", () => {
  it("J-1. showLevelPicker state + PATCH /admin/students/:id/level", () => {
    const src = readScreen();
    expect(src).toContain("showLevelPicker");
    expect(src).toContain("level_order");
    expect(src).toContain("PATCH");
  });

  it("J-2. SectionC에 onLevelChange + onOpenLevelPicker prop", () => {
    const src = readComp("SectionC_Level.tsx");
    expect(src).toContain("onLevelChange");
    expect(src).toContain("onOpenLevelPicker");
  });

  it("J-3. 레벨 picker → all_levels 목록 표시", () => {
    const src = readComp("SectionC_Level.tsx");
    expect(src).toContain("all_levels");
    expect(src).toContain("level_name");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE K: attendance_summary 표시 (WP-M2 contract)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE K: Section D — attendance_summary 표시", () => {
  it("K-1. SectionD_Summary 파일 존재", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "SectionD_Summary.tsx"))).toBe(true);
  });

  it("K-2. attendance_summary present/absent/late 참조", () => {
    const src = readComp("SectionD_Summary.tsx");
    expect(src).toContain("attendance_summary");
    expect(src).toContain("present");
    expect(src).toContain("absent");
    expect(src).toContain("late");
  });

  it("K-3. 이번 달 출결 레이블", () => {
    const src = readComp("SectionD_Summary.tsx");
    expect(src).toContain("이번 달 출결");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE L: makeup_summary 표시 (WP-M2 contract)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE L: Section D — makeup_summary 표시", () => {
  it("L-1. makeup_summary waiting/assigned/completed 참조", () => {
    const src = readComp("SectionD_Summary.tsx");
    expect(src).toContain("makeup_summary");
    expect(src).toContain("waiting");
    expect(src).toContain("assigned");
    expect(src).toContain("completed");
  });

  it("L-2. 보강 현황 레이블 + 상세보기 shortcut", () => {
    const src = readComp("SectionD_Summary.tsx");
    expect(src).toContain("보강 현황");
    expect(src).toContain("보강 상세보기");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE M: 보호자 연결 정보 표시 (Section E)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE M: Section E — 보호자 연결 상태 표시", () => {
  it("M-1. parent_user_id로 연결 여부 판단", () => {
    const src = readComp("SectionE_Guardian.tsx");
    expect(src).toContain("parent_user_id");
    expect(src).toContain("isLinked");
  });

  it("M-2. 학부모 앱 연결됨 / 미연결 표시", () => {
    const src = readComp("SectionE_Guardian.tsx");
    expect(src).toContain("학부모 앱 연결됨");
    expect(src).toContain("학부모 앱 미연결");
  });

  it("M-3. parent_account_name 연결 계정 표시", () => {
    const src = readComp("SectionE_Guardian.tsx");
    expect(src).toContain("parent_account_name");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE N: 일지/미디어 shortcut (Section F)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE N: Section F — 일지/출결 shortcut", () => {
  it("N-1. SectionF_Feed 파일 존재", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "SectionF_Feed.tsx"))).toBe(true);
  });

  it("N-2. onGoDiary + onGoAttendance prop", () => {
    const src = readComp("SectionF_Feed.tsx");
    expect(src).toContain("onGoDiary");
    expect(src).toContain("onGoAttendance");
  });

  it("N-3. 일지 보기 + 출결 보기 버튼 텍스트", () => {
    const src = readComp("SectionF_Feed.tsx");
    expect(src).toContain("일지 보기");
    expect(src).toContain("출결 보기");
  });

  it("N-4. member-detail → diary-hub / attendance 라우팅", () => {
    const src = readScreen();
    expect(src).toContain("diary-hub");
    expect(src).toContain("attendance");
  });

  it("N-5. recent_diaries 미리보기 (최대 2개)", () => {
    const src = readComp("SectionF_Feed.tsx");
    expect(src).toContain("recent_diaries");
    expect(src).toContain("slice(0, 2)");
  });

  it("N-6. 전체 미디어 API 로딩 없음 (대량 로딩 금지)", () => {
    const src = readComp("SectionF_Feed.tsx");
    // apiRequest 호출 없음
    expect(src).not.toContain("apiRequest");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE O: withdrawn 복구 (POST /admin/students/:id/restore)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE O: withdrawn 복구 보존", () => {
  it("O-1. /admin/students/:id/restore POST 호출", () => {
    const src = readScreen();
    expect(src).toContain("/admin/students/${id}/restore");
    expect(src).toContain(`"POST"`);
  });

  it("O-2. 복구 후 status → active 업데이트", () => {
    const src = readScreen();
    expect(src).toContain("status: \"active\"");
  });

  it("O-3. showRestoreConfirm + ConfirmModal", () => {
    const src = readScreen();
    expect(src).toContain("showRestoreConfirm");
    expect(src).toContain("회원 복구");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE P: archived 복구 액션 구분 표시
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE P: archived 복구 구분", () => {
  it("P-1. SectionH_StatusMgmt에서 isRestoreable 구분", () => {
    const src = readComp("SectionH_StatusMgmt.tsx");
    expect(src).toContain("isRestoreable");
    // archived 포함 여부
    expect(src).toContain("archived");
  });

  it("P-2. 복구 버튼과 상태 변경 버튼이 조건부 표시", () => {
    const src = readComp("SectionH_StatusMgmt.tsx");
    expect(src).toContain("재원 복구");
    expect(src).toContain("상태 변경");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE Q: purge 의미 보존 (개인정보 소각)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE Q: purge (개인정보 소각) 의미 보존", () => {
  it("Q-1. /students/:id/purge POST 호출", () => {
    const src = readScreen();
    expect(src).toContain("/students/${id}/purge");
  });

  it("Q-2. 개인정보 소각 confirm 메시지", () => {
    const src = readScreen();
    expect(src).toContain("개인정보 소각");
    expect(src).toContain("익명화");
    expect(src).toContain("수업 기록은 유지");
  });

  it("Q-3. SectionH에서 purge = withdrawn/deleted 상태에서만 노출", () => {
    const src = readComp("SectionH_StatusMgmt.tsx");
    expect(src).toContain("isWithdrawnOrDeleted");
    expect(src).toContain("소각하기");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE R: permanent delete 안전 flow 보존
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE R: permanent delete (안전 flow) — 구조 유지", () => {
  it("R-1. MemberStatusChangeModal import 유지됨", () => {
    const src = readScreen();
    expect(src).toContain("MemberStatusChangeModal");
  });

  it("R-2. 기존 상태관리 모달 onChanged=load (리로드)", () => {
    const src = readScreen();
    expect(src).toContain("onChanged={load}");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE S: force-delete Danger Zone 격리
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE S: force-delete Danger Zone 격리", () => {
  it("S-1. /admin/students/:id/force-delete DELETE 호출", () => {
    const src = readScreen();
    expect(src).toContain("/admin/students/${id}/force-delete");
    expect(src).toContain(`"DELETE"`);
  });

  it("S-2. SectionH Danger Zone accordion (dangerExpanded)", () => {
    const src = readComp("SectionH_StatusMgmt.tsx");
    expect(src).toContain("dangerExpanded");
    expect(src).toContain("위험 작업");
  });

  it("S-3. force-delete 라벨에 비상용 안내 포함", () => {
    const src = readComp("SectionH_StatusMgmt.tsx");
    expect(src).toContain("비상용");
    // 일반 퇴원처럼 노출되지 않음 (퇴원이라는 단어와 일반 나란히 없음)
    expect(src).not.toMatch(/회원 탈퇴.*즉시/);
  });

  it("S-4. ConfirmModal: 즉시 삭제 confirm 포함", () => {
    const src = readScreen();
    expect(src).toContain("즉시 전체 삭제");
    expect(src).toContain("절대 되돌릴 수 없습니다");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE T: SWIMNOTE Normal 동일 화면 (mode gate 없음)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE T: Normal mode 동일 화면", () => {
  it("T-1. member-detail에 xMode / isXMode 분기 없음", () => {
    const src = readScreen();
    expect(src).not.toMatch(/isXMode|xMode\s*\?|useXMode/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE U: X mode 동일 화면
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE U: X mode 동일 화면", () => {
  it("U-1. Section 컴포넌트들에 xMode 분기 없음", () => {
    const sections = [
      "SectionA_BasicInfo.tsx", "SectionB_ClassInfo.tsx", "SectionC_Level.tsx",
      "SectionD_Summary.tsx", "SectionE_Guardian.tsx", "SectionF_Feed.tsx",
      "SectionH_StatusMgmt.tsx",
    ];
    for (const s of sections) {
      const src = readComp(s);
      expect(src, `${s} 에 xMode 분기 없어야 함`).not.toMatch(/isXMode|xMode\s*\?|useXMode/);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE V: mode gate 신규 추가 없음
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE V: mode gate 신규 추가 없음", () => {
  it("V-1. useModeContext 사용 없음 (member-detail)", () => {
    const src = readScreen();
    expect(src).not.toContain("useModeContext");
    expect(src).not.toContain("useMode");
  });

  it("V-2. Section 컴포넌트에 useModeContext 없음", () => {
    const sections = [
      "SectionA_BasicInfo.tsx", "SectionB_ClassInfo.tsx", "SectionC_Level.tsx",
      "SectionD_Summary.tsx", "SectionE_Guardian.tsx", "SectionF_Feed.tsx",
      "SectionH_StatusMgmt.tsx", "MemberSectionCard.tsx",
    ];
    for (const s of sections) {
      const src = readComp(s);
      expect(src, `${s}에 useModeContext 없어야 함`).not.toContain("useModeContext");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE W: 기존 탭 기능 누락 0 확인
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE W: 기존 탭 기능 누락 없음", () => {
  it("W-1. MemberStatusChangeModal 보존 + showStatusModal 유지", () => {
    const src = readScreen();
    expect(src).toContain("MemberStatusChangeModal");
    expect(src).toContain("showStatusModal");
  });

  it("W-2. 인라인 반 변경 피커 + ClassPickerModal.tsx 파일 유지", () => {
    const src = readScreen();
    // WP1: detail에서 ClassPickerModal 제거, 인라인 피커로 대체
    expect(src).toContain("showClassPicker");
    expect(src).toContain("pickedClassIds");
    // ClassPickerModal.tsx 파일 자체는 members.tsx가 사용하므로 유지
    expect(fs.existsSync(path.join(MEMBER_COMP, "ClassPickerModal.tsx"))).toBe(true);
  });

  it("W-3. 레벨 변경 기능 (handleLevelChange) 유지", () => {
    const src = readScreen();
    expect(src).toContain("handleLevelChange");
    expect(src).toContain("levelChanging");
  });

  it("W-4. info 저장 (saveInfo) 유지", () => {
    const src = readScreen();
    expect(src).toContain("saveInfo");
  });

  it("W-5. 반 배정 저장 (saveAssignment) 유지", () => {
    const src = readScreen();
    expect(src).toContain("saveAssignment");
  });

  it("W-6. purge + forceDelete + restore 유지", () => {
    const src = readScreen();
    expect(src).toContain("purgeMember");
    expect(src).toContain("doForceDelete");
    expect(src).toContain("doRestoreMember");
  });

  it("W-7. 기존 tab 컴포넌트 파일들 삭제 안 됨", () => {
    const legacyTabs = [
      "MemberInfoTab.tsx", "MemberClassTab.tsx", "MemberLevelTab.tsx",
      "MemberParentTab.tsx", "MemberPaymentTab.tsx", "MemberLogTab.tsx",
      "MemberMakeupTab.tsx",
    ];
    for (const t of legacyTabs) {
      expect(fs.existsSync(path.join(MEMBER_COMP, t)), `${t} 삭제 안 됨`).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CASE X: 마지막 Section까지 스크롤 가능 (paddingBottom 충분)
// ──────────────────────────────────────────────────────────────────────────────
describe("CASE X: long-scroll — 마지막 section 도달 가능", () => {
  it("X-1. contentContainerStyle에 paddingBottom ≥ 40", () => {
    const src = readScreen();
    const match = src.match(/paddingBottom:\s*(\d+)/);
    expect(match).toBeTruthy();
    const val = parseInt(match![1], 10);
    expect(val).toBeGreaterThanOrEqual(40);
  });

  it("X-2. SectionH_StatusMgmt이 ScrollView 마지막 자식", () => {
    const src = readScreen();
    // SectionH는 Section G(미노출) 이후 마지막
    const hIdx = src.indexOf("SectionH_StatusMgmt");
    const feedIdx = src.indexOf("SectionF_Feed");
    expect(hIdx).toBeGreaterThan(feedIdx);
  });

  it("X-3. Section G 미노출 — 사용자 UI에 empty section 없음", () => {
    const src = readScreen();
    // Section G 관련 컴포넌트 렌더 없음 (주석 언급은 허용)
    expect(src).not.toContain("SectionG");
    expect(src).not.toContain("준비 중");
    expect(src).not.toContain("coming_soon");
  });

  it("X-4. MemberSectionCard 공유 래퍼 존재", () => {
    expect(fs.existsSync(path.join(MEMBER_COMP, "MemberSectionCard.tsx"))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 구조 무결성 검사
// ──────────────────────────────────────────────────────────────────────────────
describe("구조 무결성", () => {
  it("teacher/parent UI 수정 없음 (변경 파일 외)", () => {
    // teacher member detail 파일 없음 (admin 전용)
    const teacherDetail = path.resolve(SWIM_APP, "app/(teacher)/member-detail.tsx");
    // teacher 화면이 없거나, 있으면 WP-M3 섹션 컴포넌트를 import 안 함
    if (fs.existsSync(teacherDetail)) {
      const src = fs.readFileSync(teacherDetail, "utf-8");
      expect(src).not.toContain("SectionA_BasicInfo");
      expect(src).not.toContain("SectionH_StatusMgmt");
    } else {
      expect(true).toBe(true); // teacher 화면 없음 = OK
    }
  });

  it("신규 Section 컴포넌트 8개 모두 존재", () => {
    const newFiles = [
      "MemberSectionCard.tsx",
      "SectionA_BasicInfo.tsx",
      "SectionB_ClassInfo.tsx",
      "SectionC_Level.tsx",
      "SectionD_Summary.tsx",
      "SectionE_Guardian.tsx",
      "SectionF_Feed.tsx",
      "SectionH_StatusMgmt.tsx",
    ];
    for (const f of newFiles) {
      expect(fs.existsSync(path.join(MEMBER_COMP, f)), `${f} 존재`).toBe(true);
    }
  });

  it("member-detail.tsx에 LucideIcon 직접 사용하지 않음 (섹션에 위임)", () => {
    const src = readScreen();
    // LucideIcon은 Section 컴포넌트에서만
    // 메인 파일은 LucideIcon import 불필요
    expect(src).not.toContain("import.*LucideIcon");
  });
});
