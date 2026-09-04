---
name: WP-N1 Sage/Ocean Token Foundation 완료
description: Normal SWIMNOTE Sage/Ocean 디자인 토큰 기반 구축 — theme/colors.ts 단일 파일
---

# WP-N1 완료

**SHA**: e1aded7d  
**브랜치**: deploy-photo-clone  
**OTA production**: 01a00b48-a130  
**OTA preview**: 01a00b48-ee84  
**변경 파일**: `artifacts/swim-app/theme/colors.ts` 단 1개

---

## A. Sage/Ocean Brand Palette (신규 상수 + 토큰)

```
sageStrong  = #4F6F67  → C.brandStrong  (CTA target / small active text — 5.0:1 ✅)
sagePrimary = #6F9187  → C.brandPrimary (accent, icon, selected — 3.1:1, large/icon only)
sageMid     = #91ABA3  → C.brandMid     (secondary, decorative)
sageSoft    = #DDE7E3  → C.brandSoft    (selected bg, chip bg)
sageMist    = #ECF2F0  → C.brandMist    (section soft bg)
```

Selected state 신규:
- `C.selected` = sagePrimary
- `C.selectedSoft` = sageSoft

---

## B. Text Hierarchy 정상화 (핵심 수정)

| 토큰 | Before | After | Contrast |
|---|---|---|---|
| textStrong | #0F2742 (navy) | #24302E (sage dark) | 12.7:1 ✅ |
| text/textPrimary | #14283D (navy) | #35413F (sage) | 9.9:1 ✅ |
| textSecondary | #64748B | #5E6B68 (sage-toned) | 5.0:1 ✅ |
| textMuted | #64748B (= secondary!) | #74817E (DISTINCT) | 3.5:1 ⚠️ hint-only |

**Before**: textSecondary = textMuted = same value → 2-tier only  
**After**: 4-tier hierarchy, textMuted는 hint-only 용도로만

---

## C. Background/Surface 계층 정리

| 토큰 | Before | After |
|---|---|---|
| background | #F7F9FB | #F4F7F6 (sage tint) |
| backgroundSoft | #F1F4F7 | #ECF2F0 (Sage Mist) |
| card/surface | #FFFFFF | #FBFCFC (almost-white sage) |
| border/divider | #E6EAF0 | #DDE7E3 (Sage Soft) |

신규 토큰: `surface`, `surfaceElevated` (#FFFFFF), `borderSoft`

---

## D. primaryAction 결정

**변경하지 않음**: C.primaryAction = navy #0F2742 (98곳, 59파일 사용)  
WP-N3에서 brandStrong (#4F6F67)으로 전환 예정. 파일 내 주석에 기록.

---

## E. 유지한 것

- Legacy mint: C.tint / C.primary / C.tintLight (WP-N3에서 migration)
- Scheduler classColor() palette (FEATURE_FIXED)
- Semantic: success/warning/error/present/absent/late
- X theme: xTheme.ts 전혀 건드리지 않음
- mode-aware components: AppButton/MainTabs/FilterChips X 분기 유지

---

## F. 영향 규모 (user-visible)

- C.text: 940 usages → 모든 텍스트 navy→sage 색조 변화
- C.border: 663 usages → sage 톤 보더
- C.card: 347 usages → barely off-white sage
- C.background: 332 usages → sage tint bg

**WP-N3 주의**: primaryAction 변경 시 98개 파일의 CTA가 navy→sage로 바뀜. 시각 변화 큼.
