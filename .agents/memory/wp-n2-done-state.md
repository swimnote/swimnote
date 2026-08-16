---
name: WP-N2 Background/Text Token Sweep 완료
description: Normal SWIMNOTE 165개 파일 hardcoded hex → C.* 토큰 교체 (admin/teacher/parent/components)
---

# WP-N2 완료

**SHA**: 4346947b  
**브랜치**: deploy-photo-clone  
**변경 파일**: 165개 (3 subagent 병렬 — n2-admin/n2-teacher-parent/n2-components)

---

## 교체 실적

| 색상 | Before | After remaining | 토큰 |
|---|---|---|---|
| #14283D | 417 | 19 | C.textPrimary |
| #64748B | 678 | 43 | C.textSecondary / C.textMuted (역할별) |
| #94A3B8 | 111 | 21 | C.textMuted |
| #9CA3AF | 45 | 3 | C.textMuted |
| #374151 | 44 | 10 | C.textPrimary |
| #1E293B | 28 | 13 | C.textStrong |
| #F8FAFC | 73 | 28 | C.backgroundSoft |
| #F1F5F9 | 187 | 28 | C.backgroundSoft |
| #E5E7EB | 265 | 12 | C.border |
| #E2E8F0 | 64 | 11 | C.border |

잔여는 모두 protected (semantic/feature-fixed/scheduler/X mode/button states).

---

## Protected Intact

| 색상 | Count | 이유 |
|---|---|---|
| #0F2742 | 18 | primaryAction — WP-N3 대상 |
| #2EC4B6 | 491 | mint legacy — WP-N3 migration |
| #4EA7D8 | 36 | scheduler classColor (절대 보호) |
| #2E9B6F | 34 | semantic (present/success) |
| #D96C6C | 482 | semantic (absent/error) |
| #E4A93A | 49 | semantic (late/warning) |

---

## 주요 결정사항

- `placeholderTextColor="#64748B"` → C.textMuted (hint용)
- `color: "#64748B"` subtitle/label → C.textSecondary
- `isX ? XT.something : "#hex"` → Normal side만 변경
- `backgroundColor: "#94A3B8"` icon bg → 보존 (icon surface, not text)
- `branding.tsx` palette selector `{ color: "#14283D" }` → 보존 (UI palette 선택 feature)
- `HolidayModal` calendar circle → 보존 (branded calendar highlight)

---

## WP-N3 다음 타겟

1. C.primaryAction: navy `#0F2742` → `C.brandStrong #4F6F67` (98 usages)
2. mint `#2EC4B6` buttons → C.brandPrimary 전환 (491 uses)
3. Button role normalization (WP-N3)

---

## TS / 테스트

- TS 오류: 7개 pre-existing (admin-revenue/parents-list/additional-guardians/photos/revenue) — 새 오류 없음
- BUTTON_COLORS_CHANGED = NO
- SCHEDULER_PROTECTED_CHANGED = NO
- SEMANTIC_CHANGED = NO
- X_THEME_CHANGED = NO
