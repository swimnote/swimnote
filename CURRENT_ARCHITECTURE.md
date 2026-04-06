# SwimNote — Current Architecture

> 작성일: 2026-04-06

---

## 모노레포 구조

```
workspace/
├── artifacts/
│   ├── swim-app/          # Expo React Native 앱
│   └── api-server/        # Express API 서버
├── package.json           # pnpm workspace root
├── pnpm-workspace.yaml
├── PROJECT_HANDOFF.md
├── CURRENT_ARCHITECTURE.md
├── ENVIRONMENT_SETUP.md
└── BUILD_DEPLOY_GUIDE.md
```

---

## API 서버 구조 (`artifacts/api-server/`)

```
src/
├── index.ts               # Express 서버 진입점 (포트 8080)
├── db.ts                  # DB 연결 (superAdminDb = 단일 운영 DB)
├── lib/
│   └── auth.ts            # JWT 생성/검증 유틸
├── middlewares/
│   └── auth.ts            # Express 인증 미들웨어 (requireAuth)
├── migrations/
│   └── super-db-init.ts   # 서버 시작 시 테이블 자동 생성 ⚠️ 수정 금지
├── jobs/
│   ├── parent-link-scheduler.ts  # V2 학부모↔학생 자동 연결 (매 1분) ⚠️ 수정 금지
│   ├── backup-batch.ts           # 자동 백업 스케줄러
│   ├── auto-attendance-scheduler.ts  # 자동 출결 처리
│   └── push-scheduler.ts         # 예약 푸시 발송
└── routes/
    ├── index.ts           # 라우터 취합 (/api/* 하위 전체)
    ├── auth.ts            # 로그인/회원가입/카카오/Apple
    ├── parent.ts          # 학부모 API (diary messages 포함)
    ├── diary.ts           # 선생님 일지 + 쪽지 API
    ├── students.ts        # 학생 관리
    ├── members.ts         # 회원 관리
    ├── teachers.ts        # 선생님 관리
    ├── admin.ts           # 관리자 API
    ├── super.ts           # 슈퍼관리자 API (백업/복구 포함)
    ├── privacy-page.ts    # GET /privacy-policy, GET /terms (공개 HTML 페이지)
    └── ...                # 기타 기능별 라우터
```

### DB 구조

- **단일 PostgreSQL DB** (`superAdminDb`)
- 풀(수영장) 단위로 데이터 격리 (`swimming_pool_id` 컬럼으로 구분)
- 테이블 자동 생성: `super-db-init.ts`가 서버 시작 시 `CREATE TABLE IF NOT EXISTS` 실행
- ORM: Drizzle (일부), 나머지 raw SQL (`db.query()`)

### 핵심 테이블 (주요 항목)

| 테이블 | 설명 |
|---|---|
| `swimming_pools` | 수영장 정보 |
| `admin_accounts` | 관리자/선생님 계정 |
| `students` | 수강생 |
| `parent_accounts` | V2 학부모 계정 (`pa_v2_...` ID) |
| `parent_student_links` | 학부모↔학생 연결 |
| `class_groups` | 반 정보 |
| `lesson_diaries` | 수업 일지 |
| `diary_messages` | 학부모↔선생님 쪽지 |
| `attendance` | 출결 기록 |
| `backup_logs` | 백업 이력 |

---

## 앱 구조 (`artifacts/swim-app/`)

```
app/
├── (parent)/              # 학부모 화면 그룹
│   ├── _layout.tsx        # 학부모 탭 레이아웃
│   ├── home.tsx           # V2 상태 분기 홈 ⚠️ 수정 금지
│   ├── diary.tsx          # 수업 일지 목록
│   ├── messages.tsx       # 선생님과 쪽지 (10초 폴링)
│   ├── add-child.tsx      # 자녀 추가 (미완성)
│   └── link-child.tsx     # 자녀 연결 (미완성)
├── (teacher)/             # 선생님 화면 그룹
│   ├── _layout.tsx        # 메신저 배지 30초 폴링
│   ├── today-schedule.tsx # 홈 (overview 60초 폴링 + 포커스 갱신)
│   └── ...
├── (admin)/               # 관리자 화면 그룹 (~40개 화면)
├── (super)/               # 슈퍼관리자 화면 그룹
└── _layout.tsx            # 루트 레이아웃 (역할별 라우팅)

assets/
└── images/
    ├── icon.png           # 앱 아이콘 1024×1024 ⚠️ 교체 금지
    ├── swimnote-logo.png  # 스플래시 1160×960 ⚠️ 교체 금지
    └── swimnote-logo.svg  # 벡터 로고 (참고용)

ios/
└── SwimNote/
    ├── AppDelegate.swift
    ├── Info.plist
    ├── SplashScreen.storyboard
    ├── SwimNote.entitlements  # Apple Sign-In 필수 ⚠️
    ├── Images.xcassets/
    │   ├── AppIcon.appiconset/
    │   ├── SplashScreenBackground.colorset/
    │   └── SplashScreenLegacy.imageset/
    └── Supporting/
        └── Expo.plist

context/
├── AuthContext.tsx         # 전역 인증 ⚠️ 수정 금지
├── ParentContext.tsx       # 학부모 전역 상태
├── BrandContext.tsx        # 화이트라벨 테마
└── FeedbackTemplateContext.tsx

components/
├── common/                # 공통 컴포넌트
├── teacher/               # 선생님 전용
│   └── today-schedule/
│       └── UnreadMessagesModal.tsx  # 쪽지 확인 모달
└── parent/                # 학부모 전용
```

---

## 실시간 업데이트 현황

| 화면 | 방식 | 주기 |
|---|---|---|
| 선생님 홈 (overview) | `useFocusEffect` + `setInterval` | 포커스 즉시 + 60초 |
| 선생님 메신저 배지 | `setInterval` (레이아웃) | 30초 |
| 어드민 메신저 배지 | `setInterval` (레이아웃) | 30초 |
| 어드민 일반 배지 | `setInterval` (레이아웃) | 60초 |
| 학부모 메시지 화면 | `useFocusEffect` + `setInterval` | 10초 |
| 나머지 화면 | `useFocusEffect` | 화면 전환 시 |

---

## 인증 흐름

```
앱 실행
→ AuthContext.tsx 토큰 확인 (AsyncStorage)
→ /api/auth/me 호출로 역할(kind) 확인
→ kind에 따라 /(parent)/, /(teacher)/, /(admin)/, /(super)/ 라우팅
→ JWT 만료 시 자동 로그아웃
```

### 학부모 V2 특별 플로우
```
학부모 로그인
→ home.tsx에서 /api/parent/v2/status 호출
→ status = "linked"   → 정상 홈 표시
→ status = "pending"  → 수영장 승인 대기 화면
→ status = "no_pool"  → 기존 방식 fallback
```

---

## 빌드 설정 파일

| 파일 | 내용 |
|---|---|
| `app.json` | version: 1.2.0, iOS buildNumber: 72, Android versionCode: 100 |
| `eas.json` | production 프로파일, autoIncrement: false |
| `eas.json` submit | Apple ID: swimnote.admin@gmail.com, ascAppId: 6761360360 |
