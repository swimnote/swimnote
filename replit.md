# SwimNote — Nationwide Swimming Pool Online Integrated Management Platform

## Overview
SwimNote is a multi-tenant B2B SaaS platform designed for comprehensive management of swimming pools. It streamlines operations for various user roles, including super_admin, platform_admin, pool_admin, teacher, and parent_account, with a Korean UI. The platform manages the entire lifecycle from swimming pool application and approval to daily operations like class management, attendance, and communication. It provides robust multi-tenancy at the database level and a flexible permission system for platform administrators. The business vision is to become the leading integrated management solution for swimming facilities, offering efficiency and an enhanced experience for administrators, teachers, and parents.

## User Preferences
I prefer the AI to operate with a clear understanding of the existing system's multi-tenancy and role-based access control. When implementing new features or modifying existing ones, prioritize maintaining data isolation and security across different swimming pools and user roles. I expect the AI to maintain a consistent API response format and to automatically record activity logs for significant actions, especially status changes and data modifications.

- 설계서·보고서·조사 결과는 항상 전체 내용을 코드 블록(``` ```) 하나에 담아 제출한다. 섹션별 분리 블록 금지. 블록 하나에 전부 넣어야 한다.

---

### ★ 작업 규칙 헌법 (모든 작업지시 맨 위에 항상 적용)

이번 작업은 지정된 feature 브랜치와 개발 환경에서만 수행한다. Production 코드, Production 배포, Production DB를 직접 수정하지 않는다. 작업 시작 전 현재 branch, HEAD, git status를 보고한다. 작업 완료 후 변경 파일 목록, 전체 git diff 요약, 타입 검사, 테스트 결과, 실제 실행 결과, commit hash, remote push 결과를 제출한다. 원격 저장소에 push되지 않은 작업은 완료로 인정하지 않는다. 한 단계가 승인되기 전 다음 단계 작업을 시작하지 않는다. 기존 파일 삭제, 디렉터리 이동, merge, rebase, reset, force push는 별도 승인 없이 금지한다.

---

**[최우선 원칙] Production 서버에서만 작업**
- 실제 iOS/Android 앱 API Base URL: `https://swimnote-api.onrender.com/api` (Render.com)
- Replit API 서버(artifacts/api-server)는 개발/테스트 전용 — 실제 앱과 무관
- 서버 코드(routes/*.ts 등) 수정 후 승인된 운영 SHA를 아래 APP Render 연결 저장소·branch에 준비 → 승인 범위 내 Render.com 배포·LIVE/health SHA 확인까지 진행
- Replit에서만 수정하고 "완료" 보고 절대 금지
- 완료 보고 시 필수: Production API Base URL, Render.com 배포 확인, 실제 API 호출 결과 제출

### APP Render 저장소 연결 기준 (2026-10-16 사용자 승인)

- 후속 사용자 승인으로 APP 기본 개발 저장소와 `origin`은 `https://gitlab.com/swimnote.admin/swimnote-app.git`으로 전환한다. 기존 GitHub 저장소·이력은 `github-backup` remote로 보존한다.
- 기존 APP Render 서비스의 연결 저장소는 `https://gitlab.com/swimnote.admin/swimnote-app.git`이다.
  - `swimnote-api`, `swimnote-web`: 공통 `main`.
  - `swimnote-production-backup`: `release/v2.0.0`.
  - `swimnote-worker`: `deploy-photo-clone`; 기존 suspended 상태 유지.
- 운영 배포는 서비스별 현재 LIVE SHA와 연결 branch의 tip을 구분한다. 공통 main이라도 서비스별 LIVE SHA가 다를 수 있으며, 로컬 HEAD나 branch tip을 검수 없이 배포하지 않는다.
- API 자동 배포는 off, 웹·백업 cron·중지된 worker는 기존 commit 정책을 유지한다. 저장소 설정 전환만으로 새 빌드·배포·cron 실행·worker 재개를 승인하지 않는다.
- ENGINE의 기존 GitLab 저장소·Render 연결은 별개이며 APP 작업에서 변경하지 않는다. EAS·OTA·DB·도메인·환경변수 변경은 이 연결 전환 승인에 포함되지 않는다.
- 이 지침 변경을 운영 branch에 자동 commit/push하지 않는다.
- OFFICE 개발은 전용 작업 branch에서 수행하며 GitLab의 동일 이름 branch를 추적하도록 설정한다. 원격 branch 생성·최초 push는 별도 승인 전 실행하지 않는다. `main`은 웹 자동배포 대상이므로 검증용 push를 하지 않는다.

## System Architecture

### SWIMNOTE OFFICE UI·UX 필수 부속 기준

현재 Stage 2 UI에는 [AI 매니저 보완 계약](docs/office/stage2-manager-supplement.md)을 함께 적용한다. 사용자 후속 합의로 단일 업무 화면+하단 AI 매니저를 사용한다. 헌법 원문과 전체개발 Stage 순서를 소급 수정하지 않으며, 실제 AI·결제·자료 Backend와 후속 Stage 실행은 별도 승인 범위다.

OFFICE 설계·구현·검수 전 [SWIMNOTE OFFICE UI·UX 헌법 V1.0](docs/office/ui-ux-constitution-v1.0.md)을 반드시 참조한다. [AGENTS.md](AGENTS.md)의 OFFICE 참조 지침도 적용한다. UX01~UX12 통합본이 이전 UX00/UX01~UX10의 중복 UI·UX 기준을 대신하며, 기존 OFFICE 전체개발 계획의 기능 범위·아키텍처·F01~F07·Stage 순서는 유지한다. 확정 원칙과 시안 검증 전 권장값을 구분하고, 이 문서 등록만으로 구현·테스트·빌드·배포 또는 다음 Task 실행이 승인된 것으로 해석하지 않는다. 아래 기존 APP UI/UX 설명은 보존하며 OFFICE 전용 규칙을 모바일 APP에 임의 적용하지 않는다.

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

## 환불 정책 v2 — 90일 유예 비활성화 시스템 (v1.3.5 완료)

### 구현 요약
- **DB**: `swimming_pools.deactivated_at`, `deletion_scheduled_at` 컬럼 + 인덱스
- **API 미들웨어**: `lib/deactivationGuard.ts` — 비활성 풀 전역 차단 (`requireNotDeactivated`), `/auth /billing /cards /pricing /health /super` 제외
- **billing.ts 웹훅**: EXPIRATION → `deactivated_at=NOW()` + 90일 후 `deletion_scheduled_at` 설정. INITIAL_PURCHASE/RENEWAL/UNCANCELLATION → 비활성 풀 자동 복구
- **billing.ts 크론**: `POST /billing/cron/cleanup-deactivated` — `deletion_scheduled_at <= NOW()` 풀 영구 삭제 (연관 데이터 cascading)
- **auth.ts 로그인 차단**: `/auth/login`, `/auth/unified-login` 모두 `deactivated_at` 체크 → `error_code: "pool_deactivated"` + `days_until_deletion`, `deletion_scheduled_at` 반환
- **auth.ts 가입 차단**: 같은 이메일이 비활성 풀에 속하면 `deactivated_account_reregistration` 에러
- **앱 화면**: `/(auth)/pool-deactivated.tsx` — 남은 일수, 재구독 버튼, 선생님/관리자 분기
- **앱 라우팅**: `SessionContext.tsx` — `adminLogin`/`unifiedLogin` 에서 `pool_deactivated` 에러 코드+메타 전파. `app/index.tsx` → `pool-deactivated` 화면 자동 라우팅

### Render 크론 Job 설정 방법
`POST /billing/cron/cleanup-deactivated` 를 매일 1회 호출 (예: 새벽 3시)
`Authorization: Bearer <CRON_SECRET 또는 JWT_SECRET>` 헤더 필수

## 빌드 101 예약 항목

| 항목 | 설명 |
|---|---|
| 시스템 상태 화면 실데이터 연결 | `system-status.tsx`의 하드코딩 더미 데이터 → 실제 `ops_alerts` DB 테이블 연결. 서버 이상 이력(느려짐/다운/헬스체크 실패) 앱에서 조회 가능 |
| 수영장 삭제 후 목록 미갱신 버그 수정 | `doDelete()` 성공 시 Zustand 스토어에서 즉시 제거(`removeOperator`) + `pools.tsx` useFocusEffect로 포커스 복귀 시 재조회 |
| 매출·비용 분석 계산 정확화 | Invalid Date 수정, revenue_logs 실데이터 수수료 연동, 손익 단계별 계산, 테스트 데이터 정리 버튼 추가 |

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