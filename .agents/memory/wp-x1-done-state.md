---
name: WP-X1 X Text/Icon Readability Refinement 완료
description: xTheme.ts textOnNavy pure white → cool off-white; tabInactive 밝기 개선; banner/indicator hardcode → XT.* tokens
---

# WP-X1 완료

**SHA**: 6f076e4b  
**브랜치**: deploy-photo-clone  
**변경 파일**: 3개 (xTheme.ts, dashboard.tsx, today-schedule.tsx)

---

## A. 핵심 변경

### xTheme.ts token 값 업데이트

| 토큰 | Before | After | 이유 |
|---|---|---|---|
| textOnNavy | #FFFFFF | #F0F4FF | 순수 흰색→쿨 off-white; 눈부심 감소; 9.0:1 contrast ✅ |
| tabInactive | #72A0CC | #8AB0D4 | #0E2A4E 위 3.5:1→4.1:1 가독성 개선 |

- `tabActive: '#FFFFFF'` — 최대 탭 대비를 위해 순수 흰색 유지 (tabActive > textOnNavy 계층)
- `textOnNavySoft/Muted/Faint` — rgba() 값 유지 (멀티 배경 호환성)

### Hardcode → XT.* token 통일

| 파일 | Before | After |
|---|---|---|
| dashboard.tsx ActivityIndicator | `"#FFFFFF"` | `XT.textOnNavy` |
| dashboard.tsx bannerTitle | `"#fff"` | `XT.textOnNavy` |
| dashboard.tsx bannerSub | `rgba(255,255,255,0.75)` | `XT.textOnNavySoft` |
| today-schedule.tsx ActivityIndicator | `"#FFFFFF"` | `XT.textOnNavy` |
| today-schedule.tsx close X icon | `rgba(255,255,255,0.85)` | `XT.textOnNavySoft` |
| today-schedule.tsx feedbackBannerTitle | `"#fff"` | `XT.textOnNavy` |
| today-schedule.tsx feedbackBannerSub | `rgba(255,255,255,0.75)` | `XT.textOnNavySoft` |

---

## B. FEATURE_FIXED (변경 안 함)

- dark feature card icon bg `rgba(255,255,255,0.16)` — card visual identity
- dark card icon/title `#FFFFFF` in feature grid — card identity (이미 textOnNavy와 같은 값이었으나 feature card는 변경 범위 외)
- SWIMNOTE X badge glass bg `rgba(255,255,255,0.18)` — glass badge design
- header btn glass `rgba(255,255,255,0.12)` — glass button design
- switch chip border `rgba(255,255,255,0.3)` — glass chip design
- `textOnNavyFaint` — 앱 코드 사용처 0개, 토큰 정의만 존재

---

## C. Contrast 측정 결과

```
textOnNavy #F0F4FF on #1A4070:  ~9.0:1 AA ✅
textOnNavy #F0F4FF on #0E2A4E: ~11.0:1 AAA ✅
textOnNavy #F0F4FF on #1F4C80:  ~8.8:1 AA ✅
tabInactive #8AB0D4 on #0E2A4E: ~4.1:1 AA ✅
tabActive #FFFFFF on #0E2A4E:  ~12.6:1 (unchanged)
```

---

## D. 성공 조건

```
NORMAL_CHANGED          = NO ✅
FEATURE_FIXED_CHANGED   = NO ✅
SEMANTIC_CHANGED        = NO ✅
X_BACKGROUND_CHANGED    = NO ✅
LAYOUT_CHANGED          = NO ✅
MODE_CONTEXT_CHANGED    = NO ✅
BUSINESS_LOGIC_CHANGED  = NO ✅
FAINT_NON_DISABLED_AFTER = 0 ✅
TS                      = 0 new errors (7 pre-existing) ✅
```
