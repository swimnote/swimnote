# SWIMNOTE 디자인 시스템

> 버전 1.0 — 2026년 7월 확정  
> **이 문서는 모든 신규 화면·컴포넌트 작성의 단일 참조점입니다.**  
> 코드를 작성하기 전에 반드시 이 문서를 먼저 확인하세요.

---

## 목차

1. [Theme 구조](#1-theme-구조)
2. [아이콘 규칙](#2-아이콘-규칙)
3. [Colors](#3-colors)
4. [Typography](#4-typography)
5. [Spacing](#5-spacing)
6. [Radius](#6-radius)
7. [Shadow](#7-shadow)
8. [Animation Rule](#8-animation-rule)
9. [Component Naming Rules](#9-component-naming-rules)
10. [카드 규칙](#10-카드-규칙)
11. [버튼 규칙](#11-버튼-규칙)
12. [배너 규칙](#12-배너-규칙)
13. [사진 카드 규칙](#13-사진-카드-규칙)
14. [수업일지 카드 규칙](#14-수업일지-카드-규칙)
15. [금지사항](#15-금지사항)

---

## 1. Theme 구조

### 1-1. 파일 위치

```
artifacts/swim-app/
  theme/
    colors.ts       ← 색상 토큰 (단일 진실 소스)
    spacing.ts      ← 여백·간격 상수
    radius.ts       ← 모서리 반경 상수
    typography.ts   ← 폰트 패밀리·사이즈·preset
    shadows.ts      ← 그림자 preset
    index.ts        ← 전체 re-export 진입점
  constants/
    colors.ts       ← theme/colors.ts re-export barrel (기존 호환용, 수정 금지)
```

### 1-2. Import 규칙

```typescript
// 기존 파일 — 변경 없이 그대로 동작
import Colors from "@/constants/colors";
const C = Colors.light;

// 신규 파일 — theme에서 직접 import
import Colors from "@/theme/colors";
import { spacing, radius, textStyle, cardShadow } from "@/theme";
```

### 1-3. Color Scheme

| 모드 | 상태 | 설명 |
|------|------|------|
| **Light** | ✅ 지원 | 현재 유일한 운영 테마 |
| **Dark** | 🔒 Reserved | 토큰 구조만 준비, 미구현 |
| **System** | 🔒 Reserved | OS 설정 자동 전환, 미구현 |

Dark / System 모드를 위해 `Colors.light` 외 `Colors.dark` 슬롯을 reserved합니다.  
신규 코드에서 색상을 하드코딩하지 않고 반드시 `C.토큰명`을 사용하는 이유입니다.

---

## 2. 아이콘 규칙

### 2-1. 유일하게 허용되는 아이콘 소스

```typescript
// ✅ 올바른 사용 — LucideIcon 래퍼
import { LucideIcon } from "@/components/common/LucideIcon";
<LucideIcon name="bell" size={20} color={C.iconBlue} />

// ❌ 금지 — lucide-react-native 직접 named import
import { Bell } from "lucide-react-native";

// ❌ 금지 — @expo/vector-icons
import { Ionicons } from "@expo/vector-icons";
```

ICON_MAP에 없는 아이콘이 필요하면 `components/common/LucideIcon.tsx`의 ICON_MAP에 먼저 추가한 후 사용합니다. 예외 없음.

### 2-2. 아이콘 3색 시스템

| 색상 | 토큰 | 배경 토큰 | 의미 | 사용 예 |
|------|------|---------|------|--------|
| `#007AFF` | `C.iconBlue` | `C.iconBlueBg` | 탐색·기본행동 | 홈, 일정, 검색, 설정 |
| `#00704A` | `C.iconGreen` | `C.iconGreenBg` | 완료·긍정 | 출석 완료, 저장, 승인 |
| `#FF6F0F` | `C.iconOrange` | `C.iconOrangeBg` | 경고·알림 | 결석, 지각, 대기, 삭제 |

```typescript
// 아이콘 배경 원형 표준 패턴
<View style={[styles.iconBg, { backgroundColor: C.iconBlueBg }]}>
  <LucideIcon name="calendar" size={18} color={C.iconBlue} />
</View>

iconBg: {
  width: 36, height: 36,
  borderRadius: radius.icon,  // 10
  alignItems: "center", justifyContent: "center",
}
```

### 2-3. 헤더 아이콘 (학부모 홈 기준)

| 순서 | 아이콘 | 의미 | 라우팅 |
|------|--------|------|-------|
| 우측 1 | `bell` | 알림 | `/(parent)/notifications` |
| 우측 2 | `award` | 현재 레벨 | `/(parent)/growth` |
| 우측 3 | `settings` | 설정 | `/(parent)/more` |

**헤더 아이콘 최대 3개.** 4개 이상은 320px 화면에서 수영장명이 잘립니다.

### 2-4. 특정 아이콘 의미 고정

| 아이콘 | 허용 용도 | 금지 용도 |
|--------|---------|---------|
| `megaphone` | 공지사항 전용 | 레벨, 기타 |
| `award` | 레벨·성취 전용 | 공지사항, 기타 |
| `bell` | 알림 전용 | — |
| `alert-triangle` | 경고 메시지 | 이모지 대체 |

### 2-5. 이모지 금지

UI의 아이콘·상태 표시 목적으로 Unicode 이모지를 사용하지 않습니다.  
`LucideIcon` 또는 텍스트로 대체합니다.  
사용자가 직접 입력하는 TextInput 내용에는 제한하지 않습니다.

---

## 3. Colors

```typescript
import Colors from "@/constants/colors";  // 기존 파일
// 또는
import Colors from "@/theme/colors";       // 신규 파일

const C = Colors.light;
```

### 3-1. 텍스트

| 토큰 | 값 | 용도 |
|------|-----|------|
| `C.text` | `#0F172A` | 기본 텍스트 |
| `C.textSecondary` | `#64748B` | 보조 텍스트 |
| `C.textMuted` | `#64748B` | 힌트·메타 정보 |
| `C.disabledText` | `#C7C7CC` | 비활성 텍스트 |

### 3-2. 배경·서피스

| 토큰 | 값 | 용도 |
|------|-----|------|
| `C.background` | `#F5F5F5` | 앱 전체 배경 |
| `C.backgroundSoft` | `#EBEBEB` | 서브 배경 |
| `C.card` | `#FFFFFF` | 카드 배경 |
| `C.disabled` | `#EBEBEB` | 비활성 배경 |

### 3-3. 메인 액센트 (민트)

| 토큰 | 값 |
|------|-----|
| `C.tint` / `C.primary` | `#2EC4B6` |
| `C.tintLight` | `#E6FAF8` |

### 3-4. 상태 색상

| 상태 | 토큰 | 값 |
|------|------|-----|
| 성공·출석 | `C.success`, `C.present` | `#2E9B6F` |
| 경고·지각 | `C.warning`, `C.late` | `#E4A93A` |
| 오류·결석 | `C.error`, `C.absent` | `#D96C6C` |
| 정보 | `C.info` | `#2563EB` |

### 3-5. 파스텔 카드 구분색

```typescript
C.lavender  // #EEDDF5 — 보라 계열
C.sky       // #DCEEFF — 파랑 계열
C.butter    // #FFF1BF — 노랑 계열
C.peach     // #F9DEDA — 살구 계열
C.mintSoft  // #E6FAF8 — 민트 계열
```

### 3-6. 수영장 로고 렌더링 우선순위

```
logo_url  →  수영장명 텍스트 이니셜(앞 2자)  →  logo_emoji(하위 호환만)
```

신규 수영장 로고 UI에서 이모지 선택 기능을 제공하지 않습니다.

---

## 4. Typography

```typescript
import { fontFamily, fontSize, textStyle } from "@/theme/typography";
// 또는
import { textStyle } from "@/theme";
```

### 4-1. Font Family

| 토큰 | 값 | 용도 |
|------|-----|------|
| `fontFamily.regular` | `"Pretendard-Regular"` | 기본 텍스트 |
| `fontFamily.semibold` | `"Pretendard-SemiBold"` | 강조·타이틀 |
| `fontFamily.bold` | `"Pretendard-Bold"` | 헤딩 |

### 4-2. 사이즈 스케일

| 토큰 | size | lineHeight | 용도 |
|------|------|-----------|------|
| `xs` | 10 | 14 | 배지 텍스트 |
| `sm` | 11 | 16 | 캡션·날짜 |
| `base` | 12 | 18 | 소형 레이블 |
| `md` | 13 | 19 | 기본 레이블 |
| `body` | 14 | 21 | 본문·버튼 |
| `sub` | 15 | 22 | 서브 제목 |
| `lg` | 17 | 24 | 섹션 타이틀 |
| `xl` | 20 | 28 | 페이지 제목 |
| `xxl` | 24 | 32 | 헤딩 |

### 4-3. Preset (권장)

```typescript
// 컴포넌트에서
import { textStyle } from "@/theme";
<Text style={[textStyle.body, { color: C.text }]}>본문</Text>
<Text style={[textStyle.title, { color: C.text }]}>제목</Text>
```

| Preset | fontFamily | fontSize |
|--------|-----------|---------|
| `textStyle.caption` | regular | 11 |
| `textStyle.body` | regular | 14 |
| `textStyle.bodyMedium` | semibold | 14 |
| `textStyle.label` | regular | 13 |
| `textStyle.labelMedium` | semibold | 13 |
| `textStyle.title` | semibold | 17 |
| `textStyle.heading` | bold | 20 |
| `textStyle.sectionTitle` | semibold | 13 |
| `textStyle.badge` | regular | 10 |

> **주의:** 탭 바 Text에 Pretendard fontFamily 사용 시 iOS에서 한글 받침 세로 클리핑 발생.  
> `lineHeight`를 반드시 명시합니다.

---

## 5. Spacing

```typescript
import { spacing } from "@/theme";
```

| 토큰 | 값 | 용도 |
|------|-----|------|
| `spacing.xs` | 4 | 아이콘 간 최소 간격 |
| `spacing.sm` | 8 | 카드 내부 항목 gap |
| `spacing.md` | 12 | 카드 gap, 섹션 여백 |
| `spacing.card` | 14 | 카드 내부 padding |
| `spacing.base` | 16 | 일반 padding |
| `spacing.screen` | 20 | 좌우 화면 여백 (기준값) |
| `spacing.xl` | 24 | 섹션 타이틀 상단 |
| `spacing.xxl` | 32 | 빈 상태 아이콘 여백 |
| `spacing.section` | 40 | 큰 섹션 구분 |
| `spacing.empty` | 60 | 빈 상태 화면 상단 |

---

## 6. Radius

```typescript
import { radius } from "@/theme";
```

| 토큰 | 값 | 용도 |
|------|-----|------|
| `radius.xs` | 6 | 배지, 상태 칩 |
| `radius.sm` | 8 | 노트박스, 인라인 요소 |
| `radius.md` | 10 | 버튼, 입력 필드, 이미지 썸네일 |
| `radius.icon` | 10 | 아이콘 배경 원형(36×36) |
| `radius.button` | 12 | 헤더 버튼, 중형 버튼 |
| `radius.panel` | 14 | 슬림 패널, 두꺼운 배너 카드 |
| `radius.card` | 16 | 일반 카드 (기준값) |
| `radius.lg` | 20 | 큰 모달, Bottom Sheet, 자녀 탭 |
| `radius.xl` | 24 | 최상위 Bottom Sheet |
| `radius.full` | 9999 | 완전 원형 |

---

## 7. Shadow

```typescript
import { cardShadow, elevatedShadow, bannerShadow, noShadow } from "@/theme";

// StyleSheet에 spread
card: {
  borderRadius: radius.card,
  backgroundColor: C.card,
  padding: spacing.card,
  ...cardShadow,
}
```

| Preset | iOS opacity | Android elevation | 용도 |
|--------|------------|-------------------|------|
| `cardShadow` | 0.06 | 2 | 일반 카드 |
| `elevatedShadow` | 0.10 | 4 | 모달, 플로팅 버튼 |
| `bannerShadow` | 0.04 | 1 | strip / slider 배너 |
| `noShadow` | 0 | 0 | 그림자 명시적 제거 |

컴포넌트마다 `shadowColor`, `elevation` 값을 직접 작성하지 않습니다.

---

## 8. Animation Rule

```typescript
import { Animated, Easing } from "react-native";
// 또는 react-native-reanimated 사용 시
import Animated, { withTiming, withSpring } from "react-native-reanimated";
```

### 8-1. Duration 기준

| 상수명 | 값 | 용도 |
|--------|-----|------|
| `DURATION_FAST` | 100ms | 즉각 피드백 (버튼 press, 탭 전환) |
| `DURATION_BASE` | 150ms | 기본 전환 (모달 열기, 카드 나타남) |
| `DURATION_NORMAL` | 200ms | 표준 애니메이션 (슬라이드, 페이드) |
| `DURATION_SLOW` | 250ms | 강조 애니메이션 (성장 리포트, 레벨업) |

### 8-2. Fade

```typescript
// 나타남
Animated.timing(opacity, {
  toValue: 1,
  duration: 200,          // DURATION_NORMAL
  easing: Easing.out(Easing.ease),
  useNativeDriver: true,
}).start();

// 사라짐
Animated.timing(opacity, {
  toValue: 0,
  duration: 150,          // DURATION_BASE
  easing: Easing.in(Easing.ease),
  useNativeDriver: true,
}).start();
```

### 8-3. Scale

```typescript
// 버튼 Press — 100ms
Animated.timing(scale, {
  toValue: 0.97,
  duration: 100,          // DURATION_FAST
  easing: Easing.out(Easing.ease),
  useNativeDriver: true,
}).start();

// 카드 등장 — 200ms
Animated.timing(scale, {
  toValue: 1,
  duration: 200,          // DURATION_NORMAL
  easing: Easing.out(Easing.back(1.2)),
  useNativeDriver: true,
}).start();
```

### 8-4. Spring

```typescript
// 자녀 탭 전환, 카드 선택 강조 — 250ms 상당
Animated.spring(value, {
  toValue: 1,
  damping: 18,
  stiffness: 200,
  mass: 0.8,
  useNativeDriver: true,
}).start();

// 체크박스, 아이콘 상태 전환 — 빠른 spring
Animated.spring(value, {
  toValue: 1,
  damping: 20,
  stiffness: 300,
  useNativeDriver: true,
}).start();
```

### 8-5. 원칙

- `useNativeDriver: true`를 항상 사용합니다. `backgroundColor`, `width`, `height` 애니메이션에는 사용 불가 — 이 경우에만 `false`.
- 애니메이션은 반드시 cleanup(`animation.stop()`)합니다.
- 인터랙션이 없는 단순 로딩 상태는 `ActivityIndicator`를 사용합니다.

---

## 9. Component Naming Rules

### 9-1. 파일명 규칙

| 유형 | 규칙 | 예시 |
|------|------|------|
| 화면 컴포넌트 | `camelCase` (Expo Router 파일명) | `home.tsx`, `class-management.tsx` |
| 재사용 컴포넌트 | `PascalCase` | `ParentSlimInfoPanel.tsx` |
| 공통 컴포넌트 | `PascalCase` | `LucideIcon.tsx`, `SubScreenHeader.tsx` |
| 훅 | `use` prefix + camelCase | `useParentDiary.ts` |
| 스토어 | `camelCase` + `Store` suffix | `adsStore.ts` |
| 유틸 | `camelCase` | `compressImage.ts` |

### 9-2. 컴포넌트 폴더 구조

```
components/
  common/         ← 역할 무관 공통 (LucideIcon, SubScreenHeader 등)
  parent/         ← 학부모 전용
  teacher/        ← 선생님 전용
  admin/          ← 관리자 전용
```

### 9-3. Props 명명

```typescript
// 콜백: on + 동사 (PascalCase)
onPress, onClose, onSelect, onEdit

// 상태: is / has / can + 형용사
isLoading, hasError, canEdit

// 데이터: 명사
diary, student, poolName

// 렌더 prop: render + 명사
renderHeader, renderEmpty
```

### 9-4. Style 명명

```typescript
// StyleSheet 키: camelCase, 역할 기술
const styles = StyleSheet.create({
  card: { ... },         // 컨테이너
  header: { ... },       // 내부 헤더 행
  iconBg: { ... },       // 아이콘 배경
  title: { ... },        // 텍스트
  emptyTxt: { ... },     // 빈 상태 텍스트
});
```

---

## 10. 카드 규칙

### 10-1. 기본 카드 구조

```typescript
import { cardShadow } from "@/theme/shadows";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";

// StyleSheet
card: {
  marginHorizontal: spacing.screen,   // 20
  marginTop: spacing.md,              // 12
  borderRadius: radius.card,          // 16
  backgroundColor: C.card,
  padding: spacing.card,              // 14
  gap: spacing.sm,                    // 8~10
  ...cardShadow,
},
```

### 10-2. 카드 헤더 행 표준 패턴

```typescript
// [아이콘 배경] [타이틀 flex:1] [ChevronRight]
header: { flexDirection: "row", alignItems: "center", gap: 8 },
iconBg: { width: 30, height: 30, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
titleTxt: { flex: 1, fontSize: 14, fontFamily: fontFamily.regular },
```

### 10-3. 빈 상태 패턴

```typescript
// 이모지 금지 — LucideIcon 사용
<View style={styles.empty}>
  <LucideIcon name="sun" size={22} color={C.textMuted} />
  <Text style={[styles.emptyTxt, { color: C.textMuted }]}>아직 기록이 없습니다</Text>
</View>
```

### 10-4. 슬림 자녀 정보 패널 (학부모 홈 HeroCard 대체)

```typescript
slimPanel: {
  marginHorizontal: spacing.screen,   // 20
  marginTop: 10,
  borderRadius: radius.panel,         // 14
  backgroundColor: C.card,
  padding: spacing.card,              // 14
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.md,                    // 12
  ...cardShadow,
},
// 오늘 수업: 수업 있는 날에만 소형 라벨 표시
```

---

## 11. 버튼 규칙

### 11-1. Primary (민트)

```typescript
btn: {
  borderRadius: radius.button,        // 12
  paddingVertical: 14,
  paddingHorizontal: spacing.base,    // 16
  alignItems: "center",
  backgroundColor: C.tint,
},
btnTxt: { ...textStyle.bodyMedium, color: "#fff" },
```

### 11-2. Secondary / Ghost

```typescript
btnSecondary: {
  borderRadius: radius.button,
  paddingVertical: 13,
  paddingHorizontal: spacing.base,
  alignItems: "center",
  backgroundColor: C.card,
  borderWidth: 1,
  borderColor: C.border,
},
```

### 11-3. Destructive (빨강)

```typescript
btnDanger: {
  borderRadius: radius.button,
  paddingVertical: 14,
  alignItems: "center",
  backgroundColor: "#DC2626",
},
```

### 11-4. 헤더 아이콘 버튼

```typescript
headerBtn: {
  width: 40, height: 40,
  borderRadius: radius.button,        // 12
  alignItems: "center", justifyContent: "center",
  backgroundColor: C.card,
},
```

헤더 우측 아이콘 버튼: 40×40, borderRadius 12, gap 8 고정. **최대 3개.**

---

## 12. 배너 규칙

### 12-1. 얇은 배너 (Strip)

- 높이: **42 px 고정**
- 제목: **최대 15자**, 줄바꿈 금지
- 이모지 사용 금지, `LucideIcon name="megaphone"` 사용
- 배경색: `THEME_BG[colorTheme]` 동적 적용

```typescript
promoStrip: {
  marginHorizontal: spacing.screen,
  marginTop: 10,
  height: 42,
  borderRadius: radius.md,           // 10
  flexDirection: "row",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  gap: spacing.sm,
  ...bannerShadow,
},
```

**서버 검증:** `POST /super/banners`, `PUT /super/banners/:id`에서 `validateBannerTitle(title, "strip")` 적용.

### 12-2. 두꺼운 배너 (Slider)

- 높이: **~130 px** (이미지 포함 시 가변)
- 제목: **최대 30자**, 줄바꿈 최대 1회 (2줄)

```typescript
promoBannerCard: {
  width: CARD_WIDTH,                  // 화면폭 - 48
  borderRadius: radius.panel,         // 14
  overflow: "hidden",
  ...cardShadow,
},
```

**서버 검증:** `validateBannerTitle(title, "slider")` 적용 (30자 초과 또는 줄바꿈 2회 이상 400 반환).

### 12-3. 공통 검증 함수 (서버)

```typescript
function validateBannerTitle(title: string, bannerType: "strip" | "slider") {
  const newlineCount = (title.match(/\n/g) || []).length;
  if (bannerType === "strip") {
    if (newlineCount > 0) return { ok: false, message: "줄바꿈 불가" };
    if (title.length > 15) return { ok: false, message: "15자 초과" };
  }
  if (bannerType === "slider") {
    if (newlineCount > 1) return { ok: false, message: "줄바꿈 2회 초과" };
    if (title.length > 30) return { ok: false, message: "30자 초과" };
  }
  return { ok: true };
}
```

---

## 13. 사진 카드 규칙

- 컴포넌트명: `ParentRecentPhotosCard`
- 섹션 타이틀: **"사진 업데이트"** (`"최근 사진"` 사용 금지)
- 홈 화면 순서: 두꺼운 배너 아래, 수업일지 위

```typescript
photosCard: {
  marginHorizontal: spacing.screen,
  marginTop: spacing.md,
  borderRadius: radius.card,
  backgroundColor: C.card,
  padding: spacing.card,
  gap: spacing.sm,
  ...cardShadow,
},
thumb: {
  flex: 1,
  aspectRatio: 1,
  borderRadius: radius.md,           // 10
  backgroundColor: C.backgroundSoft,
},
overflowOverlay: {
  ...StyleSheet.absoluteFillObject,
  borderRadius: radius.md,
  backgroundColor: "rgba(0,0,0,0.45)",
  alignItems: "center", justifyContent: "center",
},
overflowTxt: { ...textStyle.bodyMedium, color: "#fff" },
```

---

## 14. 수업일지 카드 규칙

- 컴포넌트명: `DiaryFeedCard`
- 렌더 방식: `FlatList` `renderItem` — 단일 `ParentLatestDiaryCard` 사용 금지
- 세로 ScrollView 안에 세로 FlatList 중첩 금지 — 단일 FlatList + `ListHeaderComponent` 구조 사용

```typescript
diaryCard: {
  marginHorizontal: spacing.screen,
  marginBottom: 10,
  borderRadius: radius.card,
  backgroundColor: C.card,
  padding: spacing.card,
  gap: spacing.sm,
  ...cardShadow,
},
```

### Soft Snap 상수

```typescript
const SNAP_THRESHOLD  = 80;   // px — 경계 이 거리 이내에서만 snap
const MAX_SNAP_DIST   = 300;  // px — 이 거리 초과 보정 금지 (뒤로 튀는 현상 방지)
const VELOCITY_CUTOFF = 0.3;  // 이 속도 초과 시 snap 금지 (관성 스크롤 중)
```

### Soft Snap 동작 원칙

- `pagingEnabled` 또는 고정 `snapToInterval` 사용 금지 (가변 높이)
- `onLayout` 으로 각 카드의 content 기준 y offset 측정
- `ListHeaderComponent` 높이 포함한 절대 좌표를 실기기에서 검증
- 자녀 변경 시 offset 배열 초기화
- 동일 offset 연속 `scrollToOffset` 금지

---

## 15. 금지사항

### 15-1. 아이콘

| 금지 | 대체 |
|------|------|
| `lucide-react-native` 직접 named import | `LucideIcon` 래퍼 |
| `@expo/vector-icons` 사용 | `LucideIcon` 래퍼 |
| 이모지를 아이콘·상태 표시로 사용 | `LucideIcon` |
| 이모지를 푸시 알림 기본 템플릿에 포함 | 텍스트만 |
| 이모지를 외부 공유 기본 문구에 포함 | 텍스트만 |
| `megaphone`을 레벨 표시에 사용 | `award` |

### 15-2. 레이아웃

| 금지 | 대체 |
|------|------|
| 세로 ScrollView 안에 세로 FlatList 중첩 | 단일 FlatList + `ListHeaderComponent` |
| `KeyboardAwareScrollView`를 학부모 홈 세로 스크롤에 사용 | `FlatList` |
| 헤더 아이콘 4개 이상 | 최대 3개 |
| `pagingEnabled` / 고정 `snapToInterval`을 가변 높이 피드에 사용 | Soft Snap |

### 15-3. 스타일

| 금지 | 대체 |
|------|------|
| `shadowColor`·`elevation` 인라인 직접 작성 | `theme/shadows.ts` preset spread |
| `fontFamily: "Pretendard-Regular"` 문자열 직접 작성 | `fontFamily.regular` |
| 탭 바 Text에 Pretendard + `lineHeight` 미지정 | `lineHeight` 명시 |
| 색상 hex 값을 StyleSheet에 직접 하드코딩 | `Colors.light.*` 토큰 |
| `spacing`, `radius` 숫자를 직접 작성 | `spacing.*`, `radius.*` 토큰 |

### 15-4. 수영장 로고

| 금지 | 대체 |
|------|------|
| 신규 이모지 그리드 선택 UI | 이미지 업로드 + 텍스트 이니셜 fallback |
| `logo_emoji` 신규 입력 | `logo_url` 우선 |

### 15-5. 배너

| 금지 | 대체 |
|------|------|
| strip 제목 16자 이상 | `maxLength={15}` + 서버 검증 |
| slider 제목 31자 이상 | `maxLength={30}` + 서버 검증 |
| strip 제목 줄바꿈 | `replace(/\n/g, "")` |
| POST/PUT 단일 길이 검증 | `validateBannerTitle` 공통 함수 사용 |

### 15-6. 절대 변경 금지

디자인 시스템 리뉴얼 범위 밖의 항목입니다. 어떠한 경우에도 수정하지 않습니다:

- API 엔드포인트
- JWT 발급·검증 로직
- 로그인·세션 흐름
- AsyncStorage 키 구조
- Database 스키마 (필요 최소 마이그레이션 제외)
- 상태관리 (Context, Store 로직)
- 비즈니스 로직 (출결, 정산, 보강)
- 권한 미들웨어
- 네비게이션 구조 (라우팅 경로)
