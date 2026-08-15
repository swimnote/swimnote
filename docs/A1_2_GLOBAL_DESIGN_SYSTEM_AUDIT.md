# SWIMNOTE — A1-2 GLOBAL DESIGN SYSTEM AUDIT
**Date:** 2026-08-15  
**Status:** AUDIT COMPLETE — 승인 대기  
**Code changes:** NONE · OTA: NONE · Deploy: NONE  

---

## A. TOTAL SCREENS AUDITED

- **Route files (app/):** 145개
- **Shared components (components/):** 32개
- **Theme files:** `theme/colors.ts`, `theme/typography.ts`
- **AI sub-system:** `components/ai/theme/AITheme.ts`
- **역할별 커버리지:** AUTH / ADMIN / TEACHER / PARENT / SUPER / COMMON 전체

---

## B. TOTAL UI FILES AUDITED

| 카테고리 | 파일 수 |
|---|---|
| app/(auth)/ | ~20 |
| app/(admin)/ | ~40 |
| app/(teacher)/ | ~20 |
| app/(parent)/ | ~15 |
| app/(super)/ | ~18 |
| app/ root (common) | ~20 |
| components/common/ | 30 |
| components/x/ | 2 |
| components/parent/ | 7 |
| components/admin/ | 다수 |
| components/ai/ | 다수 |
| **합계** | **~170+** |

---

## C. CURRENT DESIGN SYSTEM SUMMARY

### 현재 상태 진단

```
[ DESIGN SYSTEM STATUS ]

Token 정의:    theme/colors.ts ✅  (color 토큰 존재)
Token 사용:    ❌ PARTIAL  (대부분 화면에서 인라인 하드코딩)
Typography:    ❌ NOT TOKENIZED  (theme/typography.ts 존재하나 미사용)
Button:        ❌ MISSING SHARED COMPONENT
Input:         ❌ MISSING SHARED COMPONENT
Card:          ❌ MISSING SHARED COMPONENT
NavigationItem:❌ MISSING SHARED COMPONENT
Divider:       ❌ MISSING SHARED COMPONENT
EmptyState:    ✅ EXISTS (components/common/EmptyState.tsx)
Header:        ⚠️ PARTIAL (PageHeader + SubScreenHeader, AppHeader 없음)
Modal/Sheet:   ✅ EXISTS (ModalSheet, SubSheetModal)
```

### 핵심 진단 요약

현재 앱은 **"토큰이 정의된 아마추어 시스템"** 상태.  
colors.ts는 존재하나, 각 화면이 이를 독립적으로 재해석하거나 무시하고 있음.  
같은 의미의 버튼/아이콘/카드가 화면마다 다른 색상·형태·두께로 구현됨.  
결과: Design Language가 아니라 **화면별 개인 스타일 컬렉션** 상태.

---

## D. BORDER INVENTORY

### 분류 결과

| 분류 | 빈도 | 대표 사례 |
|---|---|---|
| STRUCTURAL_REQUIRED | 높음 | 목록 row separator, settlement 그룹 카드, ops-hub 내비 구분선 |
| INTERACTION_REQUIRED | **매우 높음** | 입력 필드, 선택 가능 chip/toggle, checkbox, 필터 chip |
| SEMANTIC_REQUIRED | 중간 | 결제 배너, 환불 정책 카드, growth event 강조 테두리, status badge |
| **DECORATIVE** | **중간** | 설정 메뉴 아이템 `borderWidth:1.5 + borderRadius:14` (admin settings/more) |
| **REDUNDANT** | **중간** | 여백/배경으로 충분히 구분되는 곳에 추가된 1px border |

### ❌ 주요 문제: Thick Round Border Menu Pattern

```
app/(admin)/settings.tsx
app/(admin)/more.tsx

현재:  borderWidth:1.5, borderRadius:14, borderColor:C.border
→ DECORATIVE 판정. 아이콘+제목+chevron+spacing으로 충분.
→ 제거 후보
```

### ❌ 주요 문제: Border + Shadow 동시 사용

```
app/(admin)/data-storage-by-category.tsx
app/(admin)/data-storage-by-account.tsx
app/(admin)/settlement.tsx

borderWidth + shadow 동시 적용 → 과도한 decoration
→ 둘 중 하나만 사용 (shadow 우선 권장)
```

### ✅ 유지 권장 Border

- 입력 필드 focus/active state
- calendar/scheduler grid
- checkbox unchecked state
- filter chip selected/unselected
- 구분이 필요한 list row separator (subtle only)
- semantic 상태 배너 (error/warning/success)

---

## E. ICON BACKGROUND INVENTORY

### 분류 결과

| 분류 | 개수 | 대표 사례 |
|---|---|---|
| FUNCTIONAL_STATE | 많음 | status 화면(pending/rejected), TOTP/OTP 보안 단계, 세션 관리 |
| BRAND_REQUIRED | 일부 | pool-apply map-pin, parent-login heart, X policy, billing |
| **DECORATIVE_ONLY** | **많음** | ⚠️ 아래 목록 |

### ❌ 주요 DECORATIVE 아이콘 배경 — 제거 후보

| 파일 | 화면 | 아이콘 | 배경색 |
|---|---|---|---|
| components/parent/ParentAttendanceCard.tsx | 학부모 홈 | calendar-check | #DBEAFE (파란색 tile) |
| components/parent/ParentRecentPhotosCard.tsx | 학부모 홈 | image | #FEF3C7 (노란색 tile) |
| components/parent/ParentNoticeCard.tsx | 학부모 홈 | bell | #FEF9C3 (노란색 tile) |
| components/parent/ParentLatestDiaryCard.tsx | 학부모 홈 | book-open | #EDE9FE (보라색 tile) |
| components/parent/ParentGrowthCard.tsx | 학부모 홈 | trending-up | #DCFCE7 (초록색 tile) |
| app/parent-invite-info.tsx | 학부모 초대 | 단계별 아이콘 | 단계별 pastel |
| app/(auth)/onboarding-parent.tsx | 학부모 온보딩 | feature 아이콘 | pastel tiles |
| components/super/security-settings/SessionsSection.tsx | 슈퍼 보안 | monitor | #FFFFFF (무의미) |
| components/admin/IconPopup.tsx | 아이콘 선택기 | 선택 아이콘 | item.bg |

**특히 학부모 홈 대시보드 카드(5개):** 각 카드가 서로 다른 pastel 배경색 아이콘 tile을 가짐. 각 카드 자체가 이미 섹션을 명확히 구분하므로 icon tile은 decoration. → 제거하면 더 깔끔.

---

## F. COLOR INVENTORY

### 전체 색상 카탈로그

| HEX | 색조 | 파일 수 | 현재 용도 | SEMANTIC 분류 |
|---|---|---|---|---|
| `#2EC4B6` | Mint | 매우 많음 | primary tint, selected, brand accent, button bg | BRAND |
| `#E6FAF8` | Mint Light | 108 | mint surface, icon bg, input focus bg | BRAND SOFT |
| `#0F172A` | Navy | 많음 | primary text, tintDark | TEXT_PRIMARY |
| `#F97316` | Orange | 많음 | C.button (primary button) | PRIMARY ACTION |
| `#F4A261` | Orange Light | 일부 | 일부 화면 primary button | PRIMARY ACTION (중복!) |
| `#2563EB` | Blue | 15 | secondary button, info | SECONDARY ACTION / INFO |
| `#10B981` | Green | 많음 | success icon bg, various ✅ | SUCCESS (일부 → J) |
| `#2E9B6F` | Green | 24 | status: present/approved/active | SUCCESS / STATUS |
| `#E4A93A` | Amber | 30 | status: late/pending/suspended | WARNING / STATUS |
| `#D97706` | Amber Dark | 121 | warning text, pending icon | WARNING |
| `#EA580C` | Orange Dark | 12 | error text, disconnected icon | WARNING/ERROR |
| `#D96C6C` | Red | 127 | error/absent/rejected/cancelled | ERROR |
| `#EF4444` | Red | 33 | error/danger (AI, X module) | ERROR |
| `#8B5CF6` | Purple | 15 | trial status | STATUS |
| `#7C3AED` | Purple Dark | 116 | super admin role/accent | BRAND (SUPER) |
| `#64748B` | Gray | 134 | secondary/muted text, inactive | TEXT_SECONDARY |
| `#EEDDF5` | Lavender | 56 | pastel card bg | **DECORATIVE / I** |
| `#DCEEFF` | Sky Blue | 3+ | pastel card bg | **DECORATIVE / I** |
| `#FFF1BF` | Butter Yellow | 85 | pastel card bg, makeup pending | DECORATIVE / PENDING |
| `#F9DEDA` | Peach | 96 | pastel card bg, error state | DECORATIVE / ERROR |
| `#355C7D` | Steel Blue | 12 | X accent (신규 A1) | X BRAND |
| `#23415C` | Steel Blue Dark | 12 | X accent strong | X BRAND |
| `#B7791F` | Muted Gold | 3 | X pending | X PENDING |
| `#3B82F6` | Blue | 14 | AI primary/action | AI BRAND |
| `#FFFFFF` | White | 112 | card surface, button text | SURFACE |
| `#F5F5F5` | Light Gray | 6+ | app background | SURFACE |

### ❌ 가장 심각한 문제: PRIMARY COLOR 분열

```
Primary button으로 사용되는 색상:
- #F97316 (C.button, orange) ← 공식 theme 정의
- #F4A261 (orange light) ← 일부 화면에서 다름
- #2EC4B6 (mint) ← admin/teacher onboarding, class creation, route-error
- #2563EB (blue) ← secondary로 정의됐으나 일부 primary CTA로 사용
- #7C3AED (purple) ← super admin 일부 CTA
- #10B981 (green) ← 일부 확인/완료 버튼

→ 같은 "저장" 또는 "다음" 액션이 화면마다 다른 색상.
→ 심각한 일관성 위반.
```

---

## G. GREEN USAGE CLASSIFICATION

| 사용처 | 색상 | 분류 |
|---|---|---|
| 출결: 출석(present) | `#2E9B6F` | **KEEP_SUCCESS** |
| 멤버 status: active/approved | `#2E9B6F` | **KEEP_SUCCESS** |
| 저장 완료 토스트 | green | **KEEP_SUCCESS** |
| 저장/완료 체크 아이콘 | `#2E9B6F` / `#00704A` | **KEEP_SUCCESS** |
| 학부모 GrowthCard icon bg | `#DCFCE7` | **REPLACE_NEUTRAL** → 아이콘 tile 제거 |
| TOTP success state bg | `#DCFCE7` | KEEP_SUCCESS (상태 표현) |
| 구독 expired 화면 check-circle bg | `#E6FFFA` | **REVIEW** (완료 상태라 KEEP 가능) |
| 일부 primary CTA 버튼 | green | **REPLACE_BRAND** → navy/mint CTA로 |
| 단순 강조 텍스트 | `#2E9B6F` | **REPLACE_BRAND** → textBrand 사용 |
| makeups.tsx 일부 아이콘 | green | **REPLACE_NEUTRAL** → gray/navy |

---

## H. ORANGE USAGE CLASSIFICATION

| 사용처 | 색상 | 분류 |
|---|---|---|
| C.button (primary button 공식 토큰) | `#F97316` | **REVIEW** → 디자인 목표와 재검토 필요 |
| 학부모 온보딩 "다음" 버튼 | Orange | **REPLACE_PRIMARY** → brand color로 |
| Pool join request 제출 | `#F4A261` | **REPLACE_PRIMARY** → 통일 |
| 반 등록 버튼 (scheduler) | Orange | **REPLACE_PRIMARY** → mint/navy |
| 보강 신청 (makeups) | Orange/Amber | **KEEP_PENDING** (대기 상태 표현) |
| 환불/지원티켓 open status | `#D97706` | **KEEP_PENDING** |
| 출결: 지각 | `#E4A93A` | **KEEP_WARNING** |
| 멤버 status: 정지/suspended | `#E4A93A` | **KEEP_WARNING** |
| 일반 아이콘 색 (warning) | `#FF6F0F` | **KEEP_WARNING** |
| 추가/생성 CTA 버튼 | Orange | **REPLACE_PRIMARY** |

**핵심 결론:** C.button = orange(`#F97316`)이 공식 primary 색이지만, 디자인 목표 "고급스럽다/묵직하다"와 충돌 가능. Navy-first primary 전환 후보.

---

## I. BUTTON STYLE INVENTORY

### 현재 상태 — 혼돈 수준 ❌

```
같은 역할의 버튼이 화면마다 다른 색상 사용:
```

| 액션 | 화면 A | 화면 B | 화면 C | 판정 |
|---|---|---|---|---|
| 저장/확인 | Orange (#F97316) | Mint (#2EC4B6) | Blue (#2563EB) | ❌ 분열 |
| 다음/시작 (온보딩) | Orange (학부모) | Mint (교사/관리자) | — | ❌ 역할별 분열 |
| 추가/등록 | Orange | Mint | — | ❌ 분열 |
| 취소 | #F1F5F9 (gray) | #FFFFFF | border-only | ⚠️ 거의 통일 |
| 삭제/영구삭제 | #D96C6C (red) | #FEF2F2 (pale red) | — | ⚠️ 거의 통일 |
| 모달 확인 | Mint | Orange | — | ❌ 분열 |

### 목표 매핑 (구현 단계에서 확정)

| 타입 | 현재 | 목표 |
|---|---|---|
| PRIMARY | Orange / Mint / Blue 혼재 | → **단일 brand color** (Navy or Mint, 결정 필요) |
| SECONDARY | pale gray / tintLight | → subtle surface, 최소 outline |
| TERTIARY | text-only in some | → text/icon only |
| DESTRUCTIVE | red / pale red | → `#D96C6C` 통일 |

---

## J. NAVIGATION ENTRY INVENTORY

### 현재 상태

**동일 성격 메뉴(설정/관리 진입점)가 최소 3가지 형태로 구현:**

#### 형태 A — Thick Round Border (❌ 제거 후보)
```
app/(admin)/settings.tsx
app/(admin)/more.tsx

borderWidth: 1.5
borderRadius: 14
borderColor: isActive ? cfg.color : C.border
아이콘 컨테이너 포함
→ 과도한 decoration
```

#### 형태 B — 구분선 기반 List (✅ 권장 방향)
```
app/(admin)/ops-hub.tsx

borderBottomWidth: 1
borderBottomColor: C.border
아이콘 + 제목 + chevron
→ 깔끔, 정보 계층 명확
```

#### 형태 C — 카드 묶음
```
일부 super admin 화면
→ 관련 항목 그룹핑 목적이면 유지 가능
```

### 결론

**NavigationListItem 공통 컴포넌트 필요.**

```
표준 구조 제안:
[ icon ] [ title ] [ optional description ] [ chevron ]
separator: subtle divider only
border: NONE (단, 선택 가능한 경우 selected state만 표시)
```

---

## K. CARD STYLE INVENTORY

| 타입 | 대표 파일 | 현재 문제 |
|---|---|---|
| STRUCTURAL CARD | settlement.tsx, dashboard | border + shadow 동시 — 과도 |
| INFORMATION CARD | PaymentBanner, level-settings 안내 | ✅ 적절 (semantic 정보 전달) |
| ACTION CARD | MemberCard, class cards | ✅ 대체로 적절 |
| **DECORATIVE CARD** | Parent 홈 5개 대시보드 카드 | ❌ 각기 다른 pastel icon tile — 불일치 |

### ❌ 학부모 홈 카드 문제 (P0)

```
ParentAttendanceCard   → 파란색 icon tile
ParentRecentPhotosCard → 노란색 icon tile
ParentNoticeCard       → 노란색 icon tile
ParentLatestDiaryCard  → 보라색 icon tile
ParentGrowthCard       → 초록색 icon tile

→ 5개 카드 아이콘 배경이 5가지 다른 색. 일관성 없음.
→ card 자체의 heading + icon으로 구분 가능. tile 제거 후보.
```

---

## L. TYPOGRAPHY COLOR INVENTORY

### 현재 텍스트 색상 사용

| 역할 | 색상 | 상태 |
|---|---|---|
| TEXT_PRIMARY | `#0F172A` (C.text = navy) | ✅ 대체로 일관 |
| TEXT_SECONDARY | `#64748B` (C.textSecondary) | ✅ 대체로 일관 |
| TEXT_TERTIARY | `#64748B` / `#C7C7CC` | ⚠️ 두 토큰 혼용 |
| TEXT_BRAND | `#2EC4B6` (mint) | ⚠️ 일부만 |
| TEXT_SUCCESS | `#2E9B6F` | ✅ 의미 있음 |
| TEXT_WARNING | `#E4A93A` / `#D97706` | ⚠️ 두 값 혼용 |
| TEXT_ERROR | `#D96C6C` / `#EF4444` | ⚠️ 두 값 혼용 |
| TEXT_LINK | 없음 (blue 일부 사용) | ❌ 미정의 |

### ❌ 핵심 문제: 강조를 배경색으로 해결

```
현재: 강조 → pastel 배경 + 색 아이콘 tile
→ 배경색이 서로 달라서 "난잡한" 느낌의 주 원인

목표: 강조 → fontWeight 600/700 + textBrand(mint)
배경색 배제, spacing + typography로 해결
```

### 폰트 사이즈 현황 (❌ 비토큰화)

```
실제 사용 사이즈: 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 32, 40, 48, 52
→ 21개 이상의 사이즈가 ad-hoc으로 사용
→ theme/typography.ts 존재하지만 미사용
→ 193개 파일에 인라인 fontFamily/fontSize/fontWeight 존재
```

---

## M. ROLE CONSISTENCY FINDINGS

### 같은 성격의 UI가 역할별로 다른 이유

| UI 요소 | ADMIN | TEACHER | PARENT | SUPER |
|---|---|---|---|---|
| 주요 CTA 색상 | Orange/Mint 혼재 | Mint 중심 | Orange 중심 | Purple |
| 헤더 | PageHeader | PageHeader | ParentScreenHeader | SubScreenHeader 주 |
| 목록 항목 | thick border | 다양 | card 중심 | list 중심 |
| 빈 상태 | EmptyState 사용 | 불일치 | 불일치 | 불일치 |
| 아이콘 배경 | 다양 | 일부 | pastel 5종 | functional 위주 |

**결론:** 동일 design language를 공유하나 구현이 분리됨. 역할이 달라도 동일 UI 문법을 사용해야 함.

---

## N. LOGIN / SIGNUP FINDINGS

### 상태: ⚠️ 기능 동작하나 일관성 미흡

**문제점:**
1. `onboarding-admin.tsx` → 다음/시작 버튼: **Mint** (`#2EC4B6`)
2. `onboarding-parent.tsx` → 다음/시작 버튼: **Orange** (C.button)
3. `onboarding-teacher.tsx` → 다음/시작 버튼: **Mint** (`#2EC4B6`)
4. `pool-join-request.tsx` → 가입신청: **Orange** (C.button)
5. `teacher-signup.tsx` → 가입 완료: **Mint**

→ 같은 "다음으로 이동" 액션이 역할마다 다른 색.

**폰트:** Pretendard-Regular (대체로 일관), labels ~13-15px (비토큰화)  
**Input 스타일:** 손수 제작 TextInput, borderRadius 10-12, 적절한 focus state  
**토큰 사용:** C.background, C.border, C.tint는 사용하나 C.button vs C.tint 선택이 불일치  

**첫인상 판정 (P0):** 기능적으로 무난하나 primary button 색상 불일치가 첫화면부터 노출됨.

---

## O. SCHEDULER FINDINGS

### 상태: ⚠️ 구조적 border는 유지 가능, 상단 버튼 색 혼재

**유지 가능한 요소:**
- calendar date cell border
- selected date 강조
- schedule block
- time grid line
- month/week/day segmented control (경계 필요)

**문제 요소:**
```
상단 action buttons에서:
- "선택" → mint
- "반 등록" → orange
- "수강생 관리" → outline/gray
- "수업일지" → mint or separate

→ 같은 레벨의 action이 서로 다른 primary 색상
→ 이유: "반 등록이 중요하니까 orange"처럼 임의 판단
→ 목표: 모든 scheduler CTA를 동일 button system으로
```

---

## P. SETTINGS FINDINGS

### 상태: ❌ Thick Border 메뉴 패턴이 문제

```
app/(admin)/settings.tsx
app/(admin)/more.tsx

현재: 각 설정 항목이 borderWidth:1.5 + borderRadius:14 카드로 둘러싸여 있음
→ 시각적으로 "무거운" 메뉴 목록
→ DECORATIVE 판정

제안:
- border 제거
- 아이콘 + 제목 + chevron + spacing
- 항목 간 subtle divider (1px #E8E8E8)
- 관련 항목은 section header로 그룹핑
```

**설정 저장 버튼도 불일치:**
- 일부: orange (C.button)
- 일부: mint (C.tint)
- 같은 화면에서 orange와 mint 혼용 사례 발견 (`level-settings.tsx`)

---

## Q. NORMAL SWIMNOTE FINDINGS

### Brand Identity 현재 상태

```
기본 앱 (Normal SWIMNOTE):
- 배경: #F5F5F5 ✅
- 카드: #FFFFFF ✅
- 텍스트: #0F172A (navy) ✅
- Accent: #2EC4B6 (mint) ✅
- Primary button: #F97316 (orange) ← ⚠️ 재검토 필요
```

**Primary 버튼이 orange인 문제:**  
디자인 목표 "고급스럽다, 묵직하다"에 orange는 어울리지 않을 수 있음.  
Navy 또는 Mint를 primary CTA로, orange를 warning/pending으로 이동하는 것이 목표에 부합.  
→ **이 결정은 구현 단계에서 확정 필요.**

---

## R. SWIMNOTE X FINDINGS

### 상태: ✅ A1에서 정리 완료 (Steel Blue 적용)

```
X 전용 토큰 (theme/colors.ts):
xBase:         #111827
xSurface:      #1B2433
xAccent:       #355C7D (Steel Blue)
xAccentStrong: #23415C
xAccentLight:  #E9EEF3
xPending:      #B7791F
xPendingLight: #F8EED8
```

**적용 완료 파일:** XModeBadge, XModeGuard, GrowthEventCard, GrowthEventDetail, x-setup, x-growth (3개), dashboard, today-schedule, parent/home

**남은 리스크:** X 모듈 내 일부 인라인 색 사용 가능성. 구현 단계에서 전수 grep 필요.

---

## S. SUPER ADMIN FINDINGS

### 상태: ⚠️ 역할 컬러(Purple)는 일관, CTA 혼재

**Purple (#7C3AED):** super admin 역할 badge/accent → ✅ 의미 있음  
**보라 pastel (#EEDDF5):** 메뉴 배경, 정책 카드 배경 → ⚠️ 과도 사용  
**CTA 버튼:**  
- feature-flags.tsx: `P` (primary) + danger = 적절
- risk-center.tsx: status-specific colors = 적절 (status 표현)
- pool-notices.tsx: #EEDDF5 (편집), #F9DEDA (삭제) → ⚠️ PRIMARY/DESTRUCTIVE 규칙 미적용

---

## T. SHARED COMPONENT REUSE

### 현존 공통 컴포넌트 (재사용 가능)

| 컴포넌트 | 파일 | 상태 |
|---|---|---|
| EmptyState | components/common/EmptyState.tsx | ✅ 사용 가능 |
| ModalSheet | components/common/ModalSheet.tsx | ✅ 사용 가능 |
| SubSheetModal | components/common/SubSheetModal.tsx | ✅ 사용 가능 |
| ConfirmModal | components/common/ConfirmModal.tsx | ✅ 사용 가능 |
| PageHeader | components/common/PageHeader.tsx | ✅ 부분 공통화 |
| SubScreenHeader | components/common/SubScreenHeader.tsx | ✅ 부분 공통화 |
| FilterChips | components/common/FilterChips.tsx | ✅ 사용 가능 |
| MemberCard | components/common/MemberCard.tsx | ✅ 역할 공통 |
| XModeBadge | components/common/XModeBadge.tsx | ✅ A1 정리 완료 |
| XModeGuard | components/common/XModeGuard.tsx | ✅ A1 정리 완료 |

### 누락된 공통 컴포넌트 — 생성 필요

| 컴포넌트 | 우선순위 | 현재 상황 |
|---|---|---|
| **PrimaryButton** | P0 | 각 화면 수백 개 개별 Pressable |
| **NavigationListItem** | P0 | 3가지 형태로 분산 |
| **FormInput** | P0 | 각 화면 개별 TextInput |
| **AppCard** | P1 | 없음 |
| **SectionHeader** | P1 | 2개 화면에 로컬 함수로 존재 |
| **StatusBadge** | P1 | 1개 화면에 로컬 함수로 존재 |
| **SegmentedControl** | P1 | 없음 (MainTabs/FilterChips는 다름) |
| **Divider** | P1 | 각 화면 로컬 View |
| **AppHeader** | P2 | PageHeader + SubScreenHeader 통합 후보 |

---

## U. NEW TOKEN REQUIREMENTS

### theme/colors.ts 추가 필요 토큰 (후보)

```typescript
// Surface
surface:           '#FFFFFF'   // = C.card (이미 있음)
surfaceSecondary:  '#F5F5F5'   // = C.background (이미 있음)

// Text (신규 명시화 필요)
textPrimary:       '#0F172A'   // = C.text (이미 있음, 이름 명확화)
textSecondary:     '#64748B'   // = C.textSecondary (이미 있음)
textTertiary:      '#C7C7CC'   // = C.tabIconDefault (이미 있음, 이름 명확화)
textBrand:         '#2EC4B6'   // = C.tint (이미 있음, brand text 역할 명확화)
textLink:          '#2563EB'   // 신규 — 현재 없음

// Border
borderSubtle:      '#E8E8E8'   // = C.border (이미 있음, 이름 명확화)
divider:           '#F0F0F0'   // 신규 — C.border보다 더 subtle한 구분선

// Action (재정비 필요)
primary:           ??? (Navy or Mint — 결정 필요)
primaryPressed:    ???
secondary:         '#F1F5F9'   // pale gray secondary button
secondaryBorder:   '#E2E8F0'   // secondary outline

// Status (이미 대부분 있음, 이름 통일 필요)
success:           '#2E9B6F'   // 이미 있음
warning:           '#E4A93A'   // 이미 있음 (D97706과 통일 필요)
error:             '#D96C6C'   // 이미 있음 (EF4444와 통일 필요)
info:              '#2563EB'   // = blue (이미 있음)
```

### 중복 토큰 정리 필요

```
warning:  E4A93A vs D97706 → 하나로 통일
error:    D96C6C vs EF4444 → 하나로 통일 (D96C6C 권장)
text:     두 가지 navy 값 (#0F172A vs #1F2937) 혼재 → 통일
```

---

## V. HIGH PRIORITY P0 SCREENS

| 파일 | 역할 | 이슈 심각도 | 주요 문제 |
|---|---|---|---|
| app/(auth)/login.tsx | AUTH | P0 | primary 버튼 색 불일치 |
| app/(auth)/signup.tsx | AUTH | P0 | primary 버튼 색 불일치 |
| app/(auth)/onboarding-*.tsx | AUTH | P0 | 역할별 버튼 색 분열 |
| app/(admin)/dashboard.tsx | ADMIN | P0 | 많은 색상 경쟁, 카드 border+shadow |
| app/(admin)/settings.tsx | ADMIN | P0 | thick border 메뉴 패턴 |
| app/(admin)/more.tsx | ADMIN | P0 | thick border 메뉴 패턴 |
| app/(admin)/classes.tsx | ADMIN | P0 | 버튼 색 혼재 |
| app/(teacher)/today-schedule.tsx | TEACHER | P0 | 버튼 색 혼재 |
| app/(parent)/home.tsx | PARENT | P0 | 5가지 icon tile 색, 카드 불일치 |
| app/index.tsx | COMMON | P0 | 브랜딩 혼재 |

---

## W. REMOVE CANDIDATES

| 항목 | 파일 | 이유 |
|---|---|---|
| 설정 메뉴 thick border | settings.tsx, more.tsx | DECORATIVE |
| 학부모 홈 icon tile 5종 | Parent*Card.tsx | DECORATIVE, 5가지 다른 색 |
| border + shadow 동시 | storage, settlement | 과도한 decoration |
| pastel card bg 7종 | 전체 | lavender/sky/butter/peach 불필요 |
| orange primary button | 전체 | 디자인 목표 "묵직함"과 불일치 |
| 헤더 action button 배경 박스 | 일부 화면 | touch target 유지하면서 visual bg 제거 |
| 온보딩 feature icon tile | onboarding-parent | DECORATIVE |

---

## X. KEEP EXCEPTIONS

| 항목 | 이유 |
|---|---|
| calendar/scheduler grid border | STRUCTURAL_REQUIRED |
| 입력 필드 border (focus state) | INTERACTION_REQUIRED |
| checkbox unchecked border | INTERACTION_REQUIRED |
| filter chip border | INTERACTION_REQUIRED |
| semantic 배너 (결제/에러) | SEMANTIC_REQUIRED |
| 출결 status 색 (green/amber/red) | STATUS — 명확한 의미 |
| super admin purple | 역할 구분 — 명확한 의미 |
| SWIMNOTE X Steel Blue | 제품 구분 — A1 완료 |
| AI 모듈 파란색 (#3B82F6) | AI 기능 구분 — 별도 context |
| error/destructive red | SEMANTIC_REQUIRED |

---

## Y. FILE CHANGE PLAN

### 구현 단계(A2+)에서 변경이 필요한 파일 우선순위

**P0 — 즉시 (A2)**

| 파일 | 변경 내용 |
|---|---|
| theme/colors.ts | primary 토큰 결정, warning/error 통일, divider/textLink 추가 |
| components/common/PrimaryButton.tsx | 신규 생성 |
| components/common/NavigationListItem.tsx | 신규 생성 |
| components/common/FormInput.tsx | 신규 생성 |
| app/(admin)/settings.tsx | thick border 제거, NavigationListItem 적용 |
| app/(admin)/more.tsx | thick border 제거, NavigationListItem 적용 |
| app/(auth)/onboarding-*.tsx | primary 버튼 통일 |
| components/parent/Parent*Card.tsx (5개) | icon tile 제거 또는 단색 통일 |

**P1 — A3**

| 파일 | 변경 내용 |
|---|---|
| app/(admin)/dashboard.tsx | border+shadow 정리, 버튼 통일 |
| app/(teacher)/today-schedule.tsx | 버튼 색 통일 |
| app/(parent)/home.tsx | 카드 정리 |
| 전체 설정/저장 버튼 | PrimaryButton 컴포넌트로 교체 |

**P2 — A4+**

| 파일 | 변경 내용 |
|---|---|
| 193개 인라인 폰트 파일 | typography 토큰 적용 |
| 전체 카드 | AppCard 컴포넌트로 교체 |
| 모달 시스템 | 통일된 sheet/modal 패턴 |

---

## Z. RECOMMENDED IMPLEMENTATION BATCHES

### A2 — Primary Color Decision + Core Tokens (코드 변경 최소)
1. `primary` 색 결정: **Navy (`#0F172A`) 또는 Mint (`#2EC4B6`)?** → 사용자 승인 필요
2. `warning`/`error` 중복 토큰 통일
3. `divider`, `textLink` 신규 토큰 추가
4. OTA 가능 (UI-only)

### A3 — Shared Button + NavigationListItem 컴포넌트
1. `PrimaryButton`, `SecondaryButton`, `TertiaryButton`, `DestructiveButton` 생성
2. `NavigationListItem` 생성
3. settings.tsx, more.tsx thick border → NavigationListItem
4. 온보딩 버튼 통일
5. OTA 필요

### A4 — FormInput + Card + Typography
1. `FormInput` 공통 컴포넌트
2. `AppCard` 공통 컴포넌트
3. 학부모 홈 icon tile 정리
4. typography 토큰 적용 시작 (P0 화면 우선)
5. OTA 필요

### A5 — Full Sweep (나머지 화면 일괄 정리)
1. 남은 화면들 PrimaryButton/NavigationListItem/FormInput/AppCard 적용
2. 인라인 color 전수 토큰 교체
3. OTA 필요

---

## DESIGN SYSTEM 핵심 결정사항 — 승인 필요

이번 감사에서 구현 전 확정이 필요한 결정:

### 결정 1: Primary Action 색상
```
옵션 A: Navy (#0F172A) → "묵직하다/고급스럽다" 목표에 부합
옵션 B: Mint (#2EC4B6) → 현재 brand accent와 통일, 밝음
옵션 C: Mint 유지하되 Orange 제거 → 가장 변경 폭이 작음

현재: Orange(C.button) = primary → 변경 권장
```

### 결정 2: pastel 배경 카드 시스템
```
현재: lavender, sky, butter, peach 등 7종 pastel bg card
→ 단색으로 통일? 또는 2종(warm/cool)으로 축소?
```

### 결정 3: 헤더 action button 배경
```
일부 화면: back/settings 아이콘에 square bg 있음
→ visual bg 제거 + hit area 44x44 유지?
```

---

```
A1_2_GLOBAL_DESIGN_SYSTEM_AUDIT_COMPLETE ✅

총 감사 화면: 145개 route
총 감사 파일: 170+ (route + components + theme)
코드 변경: NONE
OTA: NONE
Deploy: NONE

내 승인 없이 A2 구현 시작 금지.
```
