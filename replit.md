# SwimNote — Nationwide Swimming Pool Online Integrated Management Platform

## Overview
SwimNote is a multi-tenant B2B SaaS platform designed for comprehensive management of swimming pools. It aims to streamline operations for various user roles including super_admin, platform_admin, pool_admin, teacher, and parent_account, with a Korean UI. The platform facilitates the entire lifecycle from swimming pool application and approval to daily operations like class management, attendance, and communication. It provides robust multi-tenancy at the database level and a flexible permission system for platform administrators. The business vision is to become the leading integrated management solution for swimming facilities, offering efficiency and an enhanced experience for administrators, teachers, and parents.

## User Preferences
I prefer the AI to operate with a clear understanding of the existing system's multi-tenancy and role-based access control. When implementing new features or modifying existing ones, prioritize maintaining data isolation and security across different swimming pools and user roles. I expect the AI to maintain a consistent API response format and to automatically record activity logs for significant actions, especially status changes and data modifications.

## System Architecture

### UI/UX Decisions
The administrator application features a 6-tab structure (Dashboard, People, Classes, Communication, Messenger, More) with additional hidden routes for detailed management. The teacher application features a 7-tab structure (Today's Schedule, Class Management, Attendance, Swim Diary, Photos, Messenger, Settings). A consistent selection mode UX is implemented for bulk actions like deletion, featuring a common selection hook, a fixed action bar, and clear visual feedback for selected items. The member detail screen is a comprehensive 8-tab hub for managing individual student information, including personal details, class info, makeup lessons, parent sharing, and activity logs.

**Navigation Rule (시간표 탐색 순서)**: 시간표 → 선생님 선택(TeacherPickerList) → 반 목록 → 반 현황판(ClassDetailPanel) — 1명/1개여도 항상 모든 단계 표시, 자동 스킵 금지. Alert.alert 금지 (웹뷰 미작동), 모든 확인 UI는 Modal 사용.

**UI 통일 공통 컴포넌트**:
- `components/common/SubScreenHeader.tsx`: 하위 화면 공통 헤더 — back 버튼 + 중앙 타이틀 + subtitle prop + home 버튼(showHome=true) 또는 rightSlot 커스텀 영역. `onBack` prop으로 커스텀 뒤로가기 처리 가능. 자체적으로 safe area insets 처리.
- `components/common/PageHeader.tsx`: 탭 화면 최상단 헤더 — 큰 제목 + subtitle + action 버튼 또는 rightSlot. 자체 safe area insets 처리.
- `components/common/ModalSheet.tsx`: 공통 바텀 시트 — 75% 높이, PanResponder 스와이프 닫기, X 버튼, ScrollView 내장, KeyboardAvoidingView 지원.
- **적용 완료 범위**: admin 하위 화면 전체 (20개+), parent 하위 화면 8개, teacher/student-detail, super/storage-policy, admin/community(PoolHeader left prop 추가). Alert.alert 금지 규칙 유지.

**화면 구조 통일 (2025-03 UI Unification)**:
- **탭바 통일**: 슈퍼관리자/관리자/선생님/학부모 4개 모드 모두 `position: "absolute"` + iOS BlurView + 탭바 배경 통일.
- **선생님 레이아웃**: `headerShown: false` 적용, 네이티브 헤더 제거. 선생님 탭 화면 전체 `edges={[]}` (PoolHeader가 safe area 처리). messenger는 `paddingTop: insets.top` 커스텀 헤더 패턴. settings에 로그아웃 버튼 추가.
- **관리자 탭 헤더 통일**: `(admin)/more.tsx`, `(admin)/people.tsx`, `(admin)/communication.tsx` → PageHeader 적용.
- **팝업 공통화**: admin branches/makeups/communication, super subscriptions/users, parent home의 form-type Modal → ModalSheet로 교체. 확인 dialog(삭제·승인 등)는 기존 Modal 유지.

**Shared Admin Components**:
- `AdminWeekBoard.tsx`: 주간 시간표 보드 (셀 클릭 → 탐색)
- `TeacherPickerList.tsx`: 가나다순 선생님 선택 목록 (props: day?, date?, time, teachers, onSelectTeacher, onBack, bottomInset?)
- `ClassDetailPanel.tsx`: 4탭 반 현황판 (학생/출결/일지/결석)

**Classes Tab** (`(admin)/classes.tsx`): AdminWeekBoard 고정 → 셀 클릭 → TeacherPickerList → 반 목록 → ClassDetailPanel. 반 등록(ClassCreateFlow), 삭제 Modal 포함. NavStep: main→teachers→classes→detail.

**Teachers Tab** (`(admin)/teachers.tsx`): 탭 일간(Daily)/월간(Monthly). 일간=오늘 통계+시간대 목록, 월간=MonthlyCalendar(인라인, 날짜 점 표시) → timeslots → TeacherPickerList → 반 목록 → ClassDetailPanel. 계정 관리 모달(추가·수정·삭제·인증코드) 포함. NavStep: main→[timeslots]→teachers→classes→detail.

### Technical Implementations
The platform is built as a pnpm workspace monorepo using TypeScript. It leverages Node.js 24, pnpm, TypeScript 5.9, Express 5 for the API server, PostgreSQL with Drizzle ORM for the database, Zod for validation, and Orval for API codegen. Esbuild is used for CJS bundling. Object storage is integrated for managing photos, with distinct album types (group and private) and corresponding access controls.

### Feature Specifications
- **Role-Based Access Control**: Differentiated permissions for `super_admin`, `platform_admin`, `pool_admin`, `teacher`, and `parent_account`. `platform_admin` permissions are granularly configurable.
- **Swimming Pool Approval Flow**: A multi-step process for new swimming pool registrations, involving administrator account creation, detailed application submission, super_admin approval/rejection, and login restriction based on approval status.
- **Multi-tenancy**: Achieved at the database level by including `swimming_pool_id` in all relevant tables, ensuring data isolation.
- **Photo Album System**: Supports both group and private photo albums with access control based on user roles and student/class assignments. Utilizes a dedicated object storage client for file uploads and downloads.
- **Makeup Lesson System**: Automated creation of makeup lesson requests upon student absence, with comprehensive lifecycle management (waiting, assigned, transferred, completed, cancelled) via dedicated API endpoints.
- **Activity Logging**: Automated tracking of significant administrator actions (e.g., status changes, information edits, restorations) in a `member_activity_logs` table, providing a detailed audit trail.
- **Work Messenger (업무 메신저)**: Internal staff messaging system accessible to pool_admin and teacher roles. Features: text messages (全体 or target-specific), photo attachments (stored in object storage, served via auth-protected API), member transfer cards (회원이전), message filters (전체/사진/회원이전). DB tables: `work_messages`, `member_transfers`. API: `/messenger/*` routes. Shared component: `components/common/MessengerScreen.tsx`.
- **Settlement/Payroll System (정산 시스템)**: Complete monthly settlement and payroll system for teachers. DB tables: `pool_class_pricing`, `pool_holidays`, `teacher_absences`, `temp_class_transfers`, `extra_classes`, `monthly_settlements`. APIs: `/pricing`, `/holidays`, `/absences`, `/extra-classes`, `/settlement`. UI: `(admin)/holidays.tsx` (달력형 휴무일 관리), `(admin)/pool-settings.tsx` (단가표 편집 섹션), `(teacher)/revenue.tsx` (매출계산기), `(teacher)/today-schedule.tsx` (결근 처리 AbsenceModal). Extra class creation with unregistered member support in `(teacher)/my-schedule.tsx`. Admin more.tsx has "정산·일정" section with links to holidays and pricing.
- **Login/Signup System (로그인/회원가입)**: Differentiated login error handling — `unified-login` returns `error_code: "user_not_found"` or `"wrong_password"` in 401 responses. UI: `index.tsx` shows a "계정 없음" modal on user_not_found and "비밀번호 찾기" button after 2 failed attempts (auto-redirect to forgot-password after 3). New screens: `signup-role.tsx` (역할 선택), `teacher-signup.tsx` (수영장검색+PENDING 가입), `parent-signup.tsx` (가입 방법 선택), `parent-code-signup.tsx` (초대코드 검증→정보확인→계정설정(loginId+password)→즉시ACTIVE), `pool-join-request.tsx` (수영장검색→정보입력+loginId+password→관리자 승인 대기), `parent-login.tsx` (identifier+password 로그인), `forgot-password.tsx` (아이디확인→비밀번호재설정). New APIs: `POST /auth/teacher-self-signup`, `POST /auth/reset-password`, `GET /auth/parent-invite/verify`, `POST /auth/parent-invite/join`, `POST /admin/parent-invites`, `POST /auth/pool-join-request`. DB: `parent_invite_codes` table (7일 유효, is_used 체크). **학부모 계정 아이디/비밀번호 추가**: `parent_accounts.login_id` (nullable unique), `parent_pool_requests.login_id` + `password_hash` 컬럼 추가. 모든 parent 가입 경로(pool-join-request, parent-invite/join, parent-register)에서 loginId+password 수집 및 저장. `parent-login`·`unified-login` 모두 loginId(login_id) 또는 phone으로 로그인 가능. 관리자 승인 시 request의 login_id/password_hash가 parent_accounts로 이관. 중복 아이디 체크는 parent_accounts + pending parent_pool_requests 모두 확인.

### System Design Choices
- **API Design**: RESTful API endpoints with clear responsibilities, consistent JSON response formats (success/failure), and strong authentication/authorization middleware.
- **Database Schema**: PostgreSQL with Drizzle ORM, featuring key tables for swimming pools, users, students, classes, attendance, photos, and activity logs, all designed with `swimming_pool_id` for multi-tenancy.
- **Security**: Robust security measures including JWT-based authentication, role and pool access checks, API validation, and login restrictions based on pool approval status.
- **Modular Structure**: A monorepo setup with `artifacts` for deployable applications, `lib` for shared libraries, and `packages` for shared components, promoting code reusability and maintainability.

## External Dependencies
- **PostgreSQL**: Primary database for all application data.
- **Drizzle ORM**: Object-relational mapper for interacting with PostgreSQL.
- **Express 5**: Web application framework for the API server.
- **Zod**: Schema declaration and validation library.
- **Orval**: OpenAPI code generator for API clients.
- **Google Cloud Storage (GCS) or equivalent**: Object storage for managing student and class photos. (Indicated by `new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID })`)