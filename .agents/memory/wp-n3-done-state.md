---
name: WP-N3 Button Role Normalization 완료
description: Normal mode 버튼 역할 정규화 — C.primaryAction Sage Strong 전환, mint 버튼 sweep (228 files)
---

# WP-N3 완료

**SHA**: 23c4e82c  
**브랜치**: deploy-photo-clone  
**변경 파일**: 228개 (3 subagent 병렬 — n3-admin/n3-teacher-parent/n3-components)

---

## A. 핵심 토큰 전환

| 토큰 | Before | After |
|---|---|---|
| C.primaryAction | #0F2742 (navy) | #4F6F67 (Sage Strong) |
| C.primaryActionPressed | #0B1F33 | #3D5750 |
| C.primaryActionSoft | #E8EDF4 (navy soft) | #DDE7E3 (Sage Soft) |

**Contrast**: white on #4F6F67 = 5.6:1 ✅ AA

---

## B. 공통 컴포넌트 변경

| 컴포넌트 | Normal 변경 | X 변경 |
|---|---|---|
| AppButton | primary→brandStrong(via token); secondary→brandSoft+brandStrong text; tertiary→backgroundSoft pressed | XT.primary 유지 |
| FilterChips | active: C.tint→C.brandStrong, bg: C.tintLight→C.brandSoft | XT.accent/accentSoft 유지 |
| MainTabs | active: C.tint→C.brandStrong | XT.accent 유지 |
| ConfirmModal | Normal confirm: C.tint→C.primaryAction | XT.primary 유지 |

---

## C. Screen Sweep 분류

- **PRIMARY_ACTION** (save/CTA mint → C.primaryAction): 전체 적용
- **SELECTION_ACTIVE** (chip/tab active mint → brandStrong+brandSoft): 전체 적용
- **NAVIGATION** (text/border mint → brandStrong): 적용
- **SOFT_INFO** (tintLight info box → brandMist/backgroundSoft): 적용
- **SEMANTIC CORRECTIONS**: ATT_COLORS.present→C.present, success states→C.success

---

## D. Protected (보존 목록)

| 색상/항목 | 이유 |
|---|---|
| Notification unread dot (C.tint) | Feature identity |
| attendance present #2EC4B6 | SEMANTIC_PROTECTED |
| LevelBadge badge_color fallback | FEATURE_FIXED |
| AIFeatureModal TEAL, DiaryAIButton #2EC4B6 | AI feature identity |
| growth-report barFill/legendDot | Semantic rate-based |
| teacher/my-info DAY_COLORS | Scheduler decoration |
| branding.tsx, level-settings.tsx | User-configurable |
| XT.*/Nautic/Yacht | X theme untouched |

---

## E. WP-N3 성공 조건 확인

- BUTTON_POSITION_CHANGED = NO ✅
- ONPRESS_CHANGED = NO ✅
- ROUTE_CHANGED = NO ✅
- API_CHANGED = NO ✅
- SCHEDULER_PROTECTED_CHANGED = NO ✅
- FEATURE_FIXED_CHANGED = NO ✅
- X_THEME_CHANGED = NO ✅
- TS: 0 new errors (7 pre-existing) ✅

---

## F. 특이사항

- `push-message-settings.tsx`: 자체 로컬 C 객체(primary: "#4F6F67" 이미 Sage Strong) → C.primary 유지
- `register.tsx`: StyleSheet 모듈 레벨에 const C 추가 (컴포넌트 내부 중복이지만 필요)
- C.tintLight 잔여 19건 = 모두 protected/feature-fixed 항목

---

## G. 다음 WP

- **WP-N3B**: 버튼 위치/그룹 UX 정리 (이번 WP에서 position 변경 금지였음)
- **WP-N4**: Scheduler Control UI — today-highlight/progress → brandPrimary
- **WP-N5**: 독립 아이콘 컬러 전수 정리
