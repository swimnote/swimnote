---
name: WP-N4 Scheduler Control UI Normalization 완료
description: Scheduler/Calendar THEME_MUTABLE neutral surfaces → C.* tokens; classColor 8색 보존; themeColor(pool brand) 전체 FEATURE_FIXED
---

# WP-N4 완료

**SHA**: f8e37f88  
**브랜치**: deploy-photo-clone  
**변경 파일**: 3개 (7 lines)

---

## A. 핵심 원칙

"정보를 구분하는 색은 유지한다. 조작을 위한 색만 테마에 맞춘다."

- THEME_MUTABLE: neutral surface/border → C.* tokens
- FEATURE_FIXED: themeColor (pool admin 설정 브랜드색) → 변경 금지
- SCHEDULE_CLASSIFICATION_PROTECTED: classColor 8색 → 절대 변경 금지
- SEMANTIC_PROTECTED: present/absent/late/warning/success → 변경 금지

---

## B. 변경 항목 (3 files, 7 lines)

| 파일 | 항목 | Before | After |
|---|---|---|---|
| AdminWeekBoard.tsx | 수업 있는 셀 bg | #F0F9FF | C.backgroundSoft |
| ClassDetailSheet.tsx | timingRow borderTop | #F8FAFC | C.border |
| ClassDetailSheet.tsx | capacityRow borderTop | #F1F5F9 | C.border |
| ClassDetailSheet.tsx | capacityBtn bg | #F1F5F9 | C.backgroundSoft |
| ScheduleCard.tsx | 출결 neutral badge bg | #F8FAFC | C.backgroundSoft |
| ScheduleCard.tsx | 출결 neutral icon color | #64748B | C.textSecondary |
| ScheduleCard.tsx | 출결 neutral text color | #64748B | C.textSecondary |

---

## C. FEATURE_FIXED (themeColor — pool admin 브랜드색)

WP-N4 audit에서 발견된 모든 `themeColor` 패턴은 `useBrand()` hook 에서 pool 관리자가 설정한 브랜드색 → FEATURE_FIXED.

주요 파일들:
- WeeklySchedule: todayDot/sectionDay/todayLabel
- ScheduleCard: timeBox bg (allDone/not-done state)
- AbsenceModal: selection state, choice buttons, confirm buttons
- MemoSheet: save btn, mic icon, audio play
- TeacherRegisterModal: doneIcon, save btn
- UnreadMessagesModal: iconBox, ActivityIndicator
- DaySheet: teacherChip
- ClassPickerModal: row selection, confirm btn
- MemberLevelTab/ClassTab: selection, save btn
- admin/classes.tsx: local MonthlyCalendar today/selected

---

## D. ALREADY SAGE (WP-N3에서 처리)

- MiniCalendar: today → C.brandStrong
- WeeklyTimetableV2: today → C.brandStrong
- teacher MonthlyCalendar: today/selected → C.brandSoft/brandStrong
- admin MonthlyCalendar: today → C.brandSoft/brandStrong
- DaySheet: controls → C.brandStrong/brandSoft
- ClassDetailSheet: attendance buttons → C.brandStrong/brandSoft

---

## E. 성공 조건

```
CLASSCOLOR_CHANGED           = NO ✅
STORED_COLOR_CHANGED         = NO ✅
SCHEDULE_BAR_CHANGED         = NO ✅
MONTH_DOT_CHANGED            = NO ✅
WEEK_CHIP_CHANGED            = NO ✅
ATTENDANCE_SEMANTIC_CHANGED  = NO ✅
BUTTON_POSITION_CHANGED      = NO ✅
ONPRESS_CHANGED              = NO ✅
API_CHANGED                  = NO ✅
STATE_LOGIC_CHANGED          = NO ✅
X_THEME_CHANGED              = NO ✅
FEATURE_FIXED_CHANGED        = NO ✅
TS                           = 0 new errors (7 pre-existing) ✅
```
