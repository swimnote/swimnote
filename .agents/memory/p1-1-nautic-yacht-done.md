---
name: P1.1 Nautic+Yacht Blue 2-tone System 완료
description: xTheme.ts Nautic+Yacht 2-tone 색상 재정의 + header pool-name 잘림 2-row 수정 완료
---

# P1.1 NAUTIC + YACHT BLUE SYSTEM 완료

**SHA**: 5163e424  
**브랜치**: deploy-photo-clone  
**OTA production**: 01a00b1c-5e58 (group: 5b0cfdbf)  
**OTA preview**: 01a00b1c-a958 (group: fd61cbac)

---

## A. COLOR SYSTEM (xTheme.ts single source)

| 토큰 | OLD | NEW | 역할 |
|---|---|---|---|
| `primary` / `surfaceNavy` | `#0F2742` | `#1A4070` | Nautic Primary |
| `primaryStrong` / `surfaceNavyStrong` | `#0A1E30` | `#0E2A4E` | Nautic Strong |
| `surfaceNavySoft` / `primaryPressed` | `#1A3655` | `#1F4C80` | Nautic Elevated |
| `accent` | `#355C7D` | `#2A5EA8` | Yacht Primary |
| `accentStrong` | `#23415C` | `#1D4880` | Yacht Deep |
| `ai` | `#2C6FAD` | `#4878BC` | Yacht Soft |
| `tabInactive` | `#5F89B0` | `#72A0CC` | Yacht Muted |
| `background` | `#F3F6FA` | `#EEF3FA` | 살짝 더 푸른 배경 |

**How to apply**: 모든 X surface는 XT 토큰만 사용. 화면별 hex 하드코딩 금지.

**Why**: 현재 #0F2742가 거의 검정처럼 보임 → Nautic Blue로 청색감+무게감 균형. Yacht는 자연스러운 층위 제공.

---

## B. HEADER POOL NAME TRUNCATION FIX

**ROOT_CAUSE**: topBar Row 1에 pool name + SWIMNOTE X badge + switchChip 공존 → badge가 flex space 경쟁 → pool name 잘림

**FIX**: 2-row layout
- ROW 1: 수영장명만 (flex:1, numberOfLines:1) → 거의 전체 너비
- ROW 2: SWIMNOTE X badge · tier badge · role chip · 선생님 전환

Header button bg: `rgba(255,255,255,0.12)` → `XT.surfaceNavySoft` (Nautic Elevated layer)

---

## C. X-ONLY HARDCODED HEX CLEANUP

| 파일 | 변경 |
|---|---|
| `x-mode-hub.tsx` | `NAVY = "#0F2742"` → `XT.primary` |
| `x-subscription.tsx` | `NAVY = "#0F2742"` → `XT.primary` |
| `parent/home.tsx` | photo viewer bg → `XT.primary` |
| `parent/diary.tsx` | homeBtn bg → `XT.primary` |
| `parent/photos.tsx` | lightbox btn bg → `XT.primary` |

---

## UNCHANGED
- Normal theme: 완전 보존
- semantic colors (danger/warning/success/orange revenue/etc): 그대로
- RevenueCat / 결제 / 서버 / DB / ModeContext behavior: 미수정
- `textOnNavy` / `textOnNavySoft` 계열: 그대로 (흰색 계열)
