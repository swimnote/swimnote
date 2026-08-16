---
name: WP-N6 Parent Normal/X Theme Frame Finalization 완료
description: 학부모 앱 THEME_MUTABLE 정리; AI/feed/semantic 보호; ParentScreenHeader 이미 mode-aware 확인
---

# WP-N6 완료

**SHA**: cdb6a810  
**브랜치**: deploy-photo-clone  
**변경 파일**: 2개 (notifications.tsx, home.tsx)

---

## A. 핵심 발견

**이미 mode-aware (변경 불필요):**
- `ParentScreenHeader.tsx` — isX ? XT.* : C.* 완벽 구현 ✅
- `MainTabs` — isX ? XT.accent : C.brandStrong ✅
- `home.tsx` — TEAL = C.brandStrong, IB = C.brandMist (line 53-55) ✅
- `additional-guardians.tsx` — TEAL = C.brandStrong, TEAL_BG = C.brandMist ✅
- `more.tsx` — MINT_C = C.brandStrong, MINT_BG = C.brandMist ✅

---

## B. 변경 항목 (2 파일, 5 라인)

| 파일 | 항목 | Before → After |
|---|---|---|
| notifications.tsx | submit ActivityIndicator | #1B3A70 → C.brandStrong |
| notifications.tsx | send icon color | #1B3A70 → C.brandStrong |
| notifications.tsx | 요청 보내기 text | #1B3A70 → C.brandStrong |
| home.tsx | child selector pressed bg | #F0FAF9 → C.brandMist |
| home.tsx | pool search input bg | #F4F6FA → C.backgroundSoft |

---

## C. FEATURE_FIXED (변경 금지)

- `growth-report-detail.tsx` MINT=#3ECFBA → AI report identity
- `growth-report.tsx` #2EC4B6 bars/legend → AI report graph
- `curriculum-chat.tsx` TEAL/TEAL_BG → AI curriculum feature
- `x-growth.tsx` MINT/MINT_LIGHT → X growth feature
- `notifications.tsx` badgeDot #2EC4B6 → §18 FEATURE_FIXED (unread dot)
- `swim-diary.tsx` #7C3AED individual diary system → content identity
- `home.tsx` #E0EEF9/#EAF4FF/NAVY in growth report card → AI report card identity
- `home.tsx` #FEF9C3/#FDE68A blockedCard → semantic warning
- `home.tsx` #7C3AED noteLabel → content identity
- `diary.tsx` #E8003D/#E1306C → feed reaction/social identity

## D. AMBIGUOUS (변경 안 함)

- `home.tsx:1723,2031` NAVY pool-search/link-child buttons — NAVY 변수가 FEATURE_FIXED growth card와 공유됨, mode branching 없이 변경 위험
- `home.tsx:1843-1862` X-mode only section #355C7D/#23415C → X-mode UI (WP-X1에서 처리)

---

## E. 성공 조건

```
AI_REPORT_CHANGED           = NO ✅
AI_CURRICULUM_CHANGED       = NO ✅
FEED_CHANGED                = NO ✅
REACTIONS_CHANGED           = NO ✅
ATTENDANCE_SEMANTIC_CHANGED = NO ✅
LEVEL_COLOR_CHANGED         = NO ✅
PHOTO_CONTENT_CHANGED       = NO ✅
UNREAD_DOT_CHANGED          = NO ✅
NORMAL_X_THEME_LEAKAGE      = NO ✅
LAYOUT_CHANGED              = NO ✅
ONPRESS_CHANGED             = NO ✅
ROUTE_CHANGED               = NO ✅
API_CHANGED                 = NO ✅
STATE_LOGIC_CHANGED         = NO ✅
MODE_CONTEXT_CHANGED        = NO ✅
X_THEME_CHANGED             = NO ✅
TS                          = 0 new errors (7 pre-existing) ✅
COMMIT_SHA                  = cdb6a810
PRODUCTION_OTA              = 01a00bd9-4fc4-7746-9660-465d8f1f80cf
PREVIEW_OTA                 = 01a00bd9-8259-7475-9e9c-69c7f24f92a1
```
