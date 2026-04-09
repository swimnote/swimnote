# SwimNote — Nationwide Swimming Pool Online Integrated Management Platform

## Overview
SwimNote is a multi-tenant B2B SaaS platform designed for comprehensive management of swimming pools. It streamlines operations for various user roles, including super_admin, platform_admin, pool_admin, teacher, and parent_account, with a Korean UI. The platform manages the entire lifecycle from swimming pool application and approval to daily operations like class management, attendance, and communication. It provides robust multi-tenancy at the database level and a flexible permission system for platform administrators. The business vision is to become the leading integrated management solution for swimming facilities, offering efficiency and an enhanced experience for administrators, teachers, and parents.

## User Preferences
I prefer the AI to operate with a clear understanding of the existing system's multi-tenancy and role-based access control. When implementing new features or modifying existing ones, prioritize maintaining data isolation and security across different swimming pools and user roles. I expect the AI to maintain a consistent API response format and to automatically record activity logs for significant actions, especially status changes and data modifications.

## System Architecture

### UI/UX Decisions
The administrator application features a 6-tab structure (Dashboard, People, Classes, Communication, Messenger, More), while the teacher application has a 7-tab structure (Today's Schedule, Class Management, Attendance, Swim Diary, Photos, Messenger, Settings). A consistent selection mode UX is implemented for bulk actions. The member detail screen is an 8-tab hub for managing student information. Common UI components like `SubScreenHeader`, `PageHeader`, and `ModalSheet` are used across the application. Navigation rules emphasize a structured flow (e.g., `시간표 → 선생님 선택 → 반 목록 → 반 현황판`). `Alert.alert` is prohibited in favor of custom `Modal` components. Tab navigation supports resetting scroll positions on re-selection and maintaining tab state. Logout buttons are consistently placed in the header of each mode's home screen. The parent application was reconfigured to a Stack-based navigation, removing the bottom tab bar.

### Technical Implementations
The platform uses a pnpm workspace monorepo with TypeScript, Node.js 24, pnpm, TypeScript 5.9, Express 5 for the API, PostgreSQL with Drizzle ORM, Zod for validation, and Orval for API codegen. Esbuild is used for CJS bundling. Key features include a subscription plan structure with various tiers, payment failure and deletion policies, write blocking middleware (`readonlyGuard`), member limit enforcement, storage blocking, and a comprehensive read-only UI. Role-Based Access Control differentiates permissions for all user types. A swimming pool approval flow manages new registrations. Database-level multi-tenancy is achieved using `swimming_pool_id`. A photo album system supports group and private albums. Makeup lesson management and activity logging are implemented. An event log timeline tracks significant system events. Server-based change collection and daily/weekly backups are implemented, including a change logger and batch jobs. A kill switch feature allows secure deletion of data. A bulk unregistered member management system facilitates mass registration and invitation. A feedback template manager allows teachers to customize feedback sentences. Storage management provides insights into data usage. A Work Messenger facilitates internal collaboration between administrators and teachers. A complete settlement/payroll system handles monthly teacher payments. A refactored login/signup system supports unified login and a three-step parent onboarding process. Role switching and route guards manage access based on user roles. A multi-pool management system with white-label capabilities allows managing multiple swimming pools under one account and customizing branding. The invite system was rebuilt to use the device's native SMS app instead of a custom SMS service. The super_admin console includes extended security settings for external services and a full MVP for operational features like subscription product management, backup/restore, and read-only control. A centralized push notification system supports various notification types, scheduled pushes, and user/pool-specific settings. The subscription payment system has been refactored with new plan structures, first-month discounts, and expanded revenue logging.

### DB Architecture (단일화 완료 — 2026-03-25)
**운영 DB**: `superAdminDb` (SUPABASE_DATABASE_URL) — 앱의 모든 읽기/쓰기. 학생/반/출결/보강/일지/공지/정산/결제 전부 저장. `db` export가 `superAdminDb`의 alias.
**pool 백업 DB**: `poolDb` (POOL_DATABASE_URL) — 백업 전용, 운영 사용 금지. 미설정 시 superAdminDb와 동일 연결.
**super 보호백업 DB**: `backupProtectDb` (SUPER_PROTECT_DATABASE_URL) — 전체 백업 전용, 운영 사용 금지. 미설정 시 null.

`photo_assets_meta` and `video_assets_meta` tables manage media metadata. Event logs are redundantly stored in both `pool_change_logs` and `pool_event_logs`. Change logging directs `data_change_logs` to `superAdminDb`. A DB monitoring API provides connection status, diagnostics, event verification, and dead-letter queue management. `backup_logs` table tracks backup status (target, status, last_success_at, error_message, size_bytes, row_count).

### System Design Choices
API design follows RESTful principles with consistent JSON formats and strong authentication. The database schema (PostgreSQL with Drizzle ORM) includes key tables for multi-tenancy via `swimming_pool_id`. Security features include JWT authentication, role/pool access checks, and API validation. A modular monorepo structure with `artifacts`, `lib`, and `packages` promotes reusability.

## 구조 리팩터링 (2026-03-25 완성)
역할별 코드 분리 · 대형 파일 분해 · 스토어 구성 — 5단계 완료:

### Step 1: AuthContext 분리
- `context/AuthContext.tsx` → `auth/types.ts`, `auth/authUtils.ts`, `auth/AdminAuthContext.tsx`, `auth/SuperAuthContext.tsx`, `auth/AuthContext.tsx` (re-export barrel)

### Step 2: (admin)/ 대형 파일 분해
- `schedules.tsx`, `members.tsx`, `makeups.tsx` → thin shells + `components/admin/` 하위 컴포넌트
- 각 파일 800줄 미만으로 축소

### Step 3: (teacher)/ 대형 파일 분해
- `my-schedule.tsx` → thin shell + 7 components
- `today-schedule.tsx` → thin shell + 9 components
- `diary.tsx` → thin shell + 5 components (`components/teacher/diary/`)

### Step 4: Zustand store 역할별 구성
- `store/super/index.ts` — 슈퍼 전용 barrel
- `store/admin/index.ts` — 관리자 전용 barrel
- `store/shared/index.ts` — 전 역할 공용 barrel
- `store/index.ts` — 역할 구분 주석 + 전체 re-export

### Step 5: (super)/ 대형 파일 분해
- `security-settings.tsx`: 1422줄 → 1073줄 (-25%)
- `components/super/security-settings/types.ts` — 타입·상수·헬퍼
- `components/super/security-settings/SectionTitle.tsx`
- `components/super/security-settings/SessionsSection.tsx`
- `components/super/security-settings/SecurityPolicySection.tsx`
- `components/super/security-settings/LoginHistorySection.tsx`
- 컴파일 검증 완료 (22270ms)

## Backup System (2026-03-25 아키텍처 재정비 완료)
**DB 단일화**: `db` export = `superAdminDb` alias. 앱은 superAdminDb만 사용.
**백업 흐름**: superAdminDb → pool 백업 DB (POOL_DATABASE_URL) + super 보호백업 DB (SUPER_PROTECT_DATABASE_URL)
**backup_logs 테이블**: target(pool/super_protect), status(pending/running/success/failed), started_at, finished_at, last_success_at, error_message, size_bytes, row_count
**신규 API**: GET /super/backup-status (4개 카드 상태), POST /super/backup/run (수동 백업, full|pool_only)
**lib/backup-target.ts**: 대상 백업 DB로 백업 실행 + backup_logs 기록 공유 모듈
**자동 백업**: backup-batch.ts — runAutoBackup이 Object Storage + pool/protect 백업 동시 실행
**모바일 UI**: backup.tsx 상단에 4개 DB 상태 카드 추가 (운영DB, pool백업, 보호백업, 전체요약) + 수동 백업 버튼
**pool-db-init.ts**: superAdminDb에 운영 테이블 초기화 (isDbSeparated 시 pool 백업 DB도 스키마 초기화)
**기존 유지**: Object Storage 백업(lib/backup.ts), 자동 스케줄러, backup.tsx 기존 기능 전체 유지
- **선백업**: `bk_1774411347140_209a9300` (0.11MB, 82테이블, DB 저장)
- **검증**: health OK, backup-status 401 (인증 필요), DB 단일화 로그 확인

## Verified State (2026-03-25)
- **pool_event_logs**: 46건 기록 / 17가지 이벤트 타입 / 3개 풀 / retry_queue=0 / DLQ=0
- **학부모 모드**: 10가지 기능 전체 검증 완료 (자녀목록/일지/공지/사진/영상/알림설정/결제차단/공지읽음/출결/학생상세)
- **CRUD**: 학생수정/반수정/반삭제/일지수정/공지생성삭제/휴일삭제/보강배정/보강완료
- **notice_reads**: poolDb에 DDL 추가 (pool-db-init.ts) — 학부모 공지 500 버그 수정
- **parent-student 링크 승인**: `PATCH /api/admin/parents/:id/students/:link_id` body `{action:"approve"}`
- **올바른 학부모 API 경로**: `/api/parent/students` (자녀목록), `/api/parent/students/:id/diary` (일지), `/api/parent/notices` (공지)
- **올바른 CRUD PATCH 경로**: `PATCH /api/students/:id`, `PATCH /api/class-groups/:id`
- **반 생성 필수 필드**: `schedule_days`, `schedule_time` (name 선택)
- **보강 생성 방식**: 출결 absent 처리 시 자동 생성, `PATCH /api/admin/makeups/:id/assign` → complete
- **tier 버그**: growth → advance 수정 완료

## 아이콘 시스템 (2026-03-27 완성)
**Feather → Lucide React Native 전환 완료** (216개 파일)
- `@expo/vector-icons` Feather 전부 제거, `lucide-react-native`로 교체
- 동적 name={변수} 파일용 래퍼: `components/common/LucideIcon.tsx`
- `Image` 충돌 해결: Lucide `Image as ImageIcon` 알리아스 처리

**3색 아이콘 색상 시스템** (`constants/colors.ts` 추가)
- `iconBlue #007AFF` (앱스토어 파랑) — 탐색·기본행동
- `iconGreen #00704A` (스타벅스 녹색) — 완료·긍정
- `iconOrange #FF6F0F` (당근마켓 주황) — 경고·알림
- 배경색: `iconBlueBg`, `iconGreenBg`, `iconOrangeBg`

## 카카오 소셜 로그인 (2026-04-02 완성)
- **패키지**: `@react-native-seoul/kakao-login` 설치 완료
- **앱 키**: `aeafd08cc53e41b28efa52498136efa7` (EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY)
- **Android 키 해시**: `GGOGNQSufjzrpcSzDrMZM3TtJi0=` (EAS managed keystore SHA-1 기반)
- **iOS URL Scheme**: `kakaoaeafd08cc53e41b28efa52498136efa7` (app.json LSApplicationQueriesSchemes)
- **app.json 플러그인**: `@react-native-seoul/kakao-login` 설정 완료
- **DB**: `parent_accounts.kakao_id` / `kakao_profile_image` 컬럼 추가
- **API**: `POST /api/auth/kakao-social-login` — kakao_id → 계정 매칭 → JWT 발급
- **API**: `POST /api/auth/kakao-link-account` — 전화번호로 기존 계정과 카카오 연결
- **UI**: `app/index.tsx` 하단 "카카오로 시작하기" 버튼 (노란색 #FEE500)
- **화면**: `app/(auth)/kakao-link.tsx` — 미연결 계정용 전화번호 입력 화면
- **흐름**: 카카오 로그인 → kakao_id 매칭 → 성공시 JWT / 미연결시 전화번호 입력 화면으로 이동
- **참고**: EAS 빌드 재배포 필요 (네이티브 플러그인 변경됨)

## 구독 정책 구현 (2026-04-07 완료)

### 업그레이드 / 다운그레이드 정책
- **업그레이드**: 즉시 적용 (applySubscriptionState → swimming_pools + pool_subscriptions 동기화)
- **다운그레이드**: `pending_tier` + `downgrade_at` 컬럼에 예약 → next_billing_at에 크론이 자동 적용
- **무료전환**: 동일 다운그레이드 경로 (next_billing_at까지 현재 플랜 유지)
- **환불**: 스토어 정책 따름 (내부 계산 없음)

### 관련 파일
- `subscriptionService.ts`: `TIER_ORDER`, `isUpgradeTier`, `isDowngradeTier` + `ResolvedSubscription` pending 필드
- `billing.ts` `sync-rc-subscription`: 업/다운그레이드 분기 처리
- `billing.ts` webhook `PRODUCT_CHANGE`: 업/다운그레이드 분기 처리
- `billing.ts` `/billing/status`: `pending_tier`, `pending_plan_name`, `downgrade_at`, `next_billing_at` 노출
- `billing.ts` 크론: 만료된 예약 다운그레이드를 `applySubscriptionState` 경유 적용 (단일 경로)
- `pools.ts` `/pools/my`: pending 필드 노출
- `super.ts` `/super/operators/:id`: pending 필드 노출
- `billing.tsx`: "다운그레이드 예약됨" 배너 (노란색, 날짜 + 플랜명 표시)

### TIER_ORDER (낮은 숫자 = 하위 플랜)
`free=0 < starter=1 < basic=2 < standard=3 < center_200=4 < advance=5 < pro=6 < max=7`

## 다음 업데이트 예정 목록 (v1.4.0+)

| 항목 | 설명 | 우선순위 |
|---|---|---|
| 연결 대기 화면 로그아웃 버튼 | 학부모가 수영장 등록 대기 중일 때 로그인 화면으로 돌아갈 수 있는 버튼 추가 | 보통 |
| 스플래시 화면 개선 | 로고 위치·테두리 정리 + Lottie 애니메이션 스플래시 적용 | 낮음 |

## External Dependencies
- **PostgreSQL**: Primary database for all application data.
- **Drizzle ORM**: Object-relational mapper for interacting with PostgreSQL.
- **Express 5**: Web application framework for the API server.
- **Zod**: Schema declaration and validation library.
- **Orval**: OpenAPI code generator for API clients.
- **Google Cloud Storage (GCS) or equivalent**: Object storage for managing student and class photos.