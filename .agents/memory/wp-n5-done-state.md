---
name: WP-N5 Normal Icon/Emoji Visual Normalization 완료
description: 임의 blue/purple 아이콘 색 → Sage/neutral 토큰; emoji → vector icon; diary 선택 시스템 통합
---

# WP-N5 완료

**SHA**: 1adcf0d6  
**브랜치**: deploy-photo-clone  
**변경 파일**: 6개

---

## A. 핵심 정책

- NORMAL_FUNCTION icon: C.textPrimary / C.textSecondary (neutral)
- ACTIVE/SELECTED: C.brandStrong / C.brandPrimary
- Picker action buttons: C.brandStrong (interactive, always-available)
- Primary action buttons: C.primaryAction (#4F6F67)
- SEMANTIC: error/warning/success 고유색 유지
- FEATURE_FIXED: AI identity, subscription crown, pool brand, feed reactions 유지
- xTheme.ts: 수정 금지

---

## B. 변경 항목

| 파일 | 항목 | Before → After |
|---|---|---|
| diary-reactions.tsx | commentCountBadge | #6366F1 → C.brandStrong |
| diary-reactions.tsx | replyBtn bg | #EEF2FF → C.brandMist |
| diary-reactions.tsx | reply icon/text | #6366F1 → C.brandStrong |
| diary-reactions.tsx | teacher bubble bg | #F0F4FF → C.backgroundSoft |
| diary-reactions.tsx | teacher name | #3B82F6 → C.textPrimary |
| diary-reactions.tsx | replyContext bg/border/text | #EEF2FF/#6366F1 → C.brandMist/C.brandStrong |
| diary-reactions.tsx | sendBtn active | #6366F1 → C.primaryAction |
| DiaryHistoryList.tsx | message-circle icon + count | #6366F1 → C.textSecondary |
| DiaryEditView.tsx | users cardIcon bg/icon | #8B5CF620/#8B5CF6 → C.brandMist/C.textSecondary |
| DiaryEditView.tsx | album picker image+text | #3B82F6 → C.brandStrong |
| DiaryEditView.tsx | student chip active system | #8B5CF6/#EEDDF5 → C.brandStrong/C.brandSoft |
| DiaryEditView.tsx | note input/textarea/btn | #8B5CF6/#EEDDF5 → C.brandSoft/C.primaryAction |
| DiaryWriteView.tsx | user cardIcon bg/icon | #8B5CF620/#8B5CF6 → C.brandMist/C.textSecondary |
| DiaryWriteView.tsx | template/album picker | #8B5CF6/#3B82F6 → C.brandStrong |
| DiaryWriteView.tsx | student note active system | same as DiaryEditView |
| DiaryWriteView.tsx | retry text | #8B5CF6 → C.textSecondary |
| level.tsx | book-open icon + label | #3B82F6 → C.textSecondary |
| route-error.tsx | ⚠️ emoji | → LucideIcon alert-triangle C.textSecondary |

---

## C. FEATURE_FIXED / AMBIGUOUS (변경 안 함)

- `#F59E0B` clock/crown/trophy: subscription/X-setup/allDone identity
- `#EA580C` dashboard rotate-ccw / MemberCard user-x: AMBIGUOUS
- billing alert-circle: SEMANTIC WARNING
- link-child clock: SEMANTIC PENDING
- onboarding emoji (💡📌📋✅❌): content/feature description
- growth report 🏊🏅📚: AI feature identity
- 📘 teacher reply badge: role identity in chat
- _layout.tsx ⚠️/✅/🔔 OTA/notification UI: complex restructure (kept as-is)

---

## D. 성공 조건

```
SEMANTIC_FIXED_PRESERVED     = YES ✅
FEATURE_FIXED_PRESERVED      = YES ✅
USER_CONFIG_PRESERVED        = YES ✅
SCHEDULER_PROTECTED_PRESERVED = YES ✅
X_THEME_PRESERVED            = YES ✅
ICON_POSITION_CHANGED        = NO ✅
TOUCH_TARGET_CHANGED         = NO ✅
ONPRESS_CHANGED              = NO ✅
ROUTE_CHANGED                = NO ✅
API_CHANGED                  = NO ✅
STATE_CHANGED                = NO ✅
TS                           = 0 new errors (7 pre-existing) ✅
COMMIT_SHA                   = 1adcf0d6
PRODUCTION_OTA               = 01a00bce-1c31-7279-a6c3-b314d23be1ed
PREVIEW_OTA                  = 01a00bce-62e2-7861-bc75-60c7c750a807
```
