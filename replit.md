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

**선생님 모드 OS 허브형 홈 (2026-03 개편)**:
- `today-schedule.tsx`: OS 허브형 홈 완성. Row1(4-stat배너: 오늘수업/출결완료/일지작성/주간스케줄), Row2(4-누적업무: 미작성일지/보강대기/출석미체크/안읽은쪽지, 항상표시), Row3(스케줄메모 진입). 8아이콘: 수업관리/회원관리/보강관리/쪽지(popup)/메신저/정산/내정보/설정.
- `my-info.tsx`: 내정보 분리 신규화면 (프로필/내반통계/회원현황/권한정보/모드전환/탈퇴요청)
- `students.tsx`: 회원관리 신규화면 (정상/연기/탈퇴 탭 필터, 검색, 학생상세 이동)
- `makeups.tsx`: 보강관리 재편 (보강대기/보강현황 탭, 보강지정→주간스케줄 플로우)
- `settings.tsx`: 내정보 코드 제거, 설정위주 재편 (저장공간/알림/앱설정/피드백/사진영상)
- `my-schedule.tsx`: 액션칩 통일 — ClassDetailSheet(주간)와 일간 서브헤더를 동일 레이아웃으로 통일 (flex:1, paddingVertical:9, gap:8). 기타수업 버튼 ClassDetailSheet에도 추가.
- `_layout.tsx`: my-info, students hidden screen 등록 완료
- **Alert.alert 금지 → ConfirmModal** 규칙 유지

**화면 구조 통일 (2025-03 UI Unification)**:
- **탭바 통일**: 슈퍼관리자/관리자/선생님/학부모 4개 모드 모두 `position: "absolute"` + iOS BlurView + 탭바 배경 통일.
- **선생님 레이아웃**: `headerShown: false` 적용, 네이티브 헤더 제거. 선생님 탭 화면 전체 `edges={[]}` (PoolHeader가 safe area 처리). messenger는 `paddingTop: insets.top` 커스텀 헤더 패턴. settings에 로그아웃 버튼 추가.
- **관리자 탭 헤더 통일**: `(admin)/more.tsx`, `(admin)/people.tsx`, `(admin)/communication.tsx` → PageHeader 적용.
- **팝업 공통화**: admin branches/makeups/communication, super subscriptions/users, parent home의 form-type Modal → ModalSheet로 교체. 확인 dialog(삭제·승인 등)는 기존 Modal 유지.

**Shared Admin Components**:
- `AdminWeekBoard.tsx`: 주간 시간표 보드 (셀 클릭 → 탐색)
- `TeacherPickerList.tsx`: 가나다순 선생님 선택 목록 (props: day?, date?, time, teachers, onSelectTeacher, onBack, bottomInset?)
- `ClassDetailPanel.tsx`: 4탭 반 현황판 (학생/출결/일지/결석)

**Classes Tab** (`(admin)/classes.tsx`): AdminWeekBoard 고정 → 셀 클릭 → TeacherPickerList → 반 목록 → ClassDetailPanel. 반 등록(ClassCreateFlow), 삭제 Modal 포함. NavStep: main→teachers→classes→detail. `useFocusEffect`로 탭 포커스 시 NavStep 자동 초기화.

**네비게이션 규칙 통일 (2025-03)**:
- **탭 재탭 → 스크롤 초기화**: `utils/tabReset.ts` (경량 pub/sub 이벤트 에미터) + `hooks/useTabScrollReset.ts` (ScrollView ref 훅). 4개 모드 레이아웃 모두 `makeTabListener()` 패턴 — 같은 탭 재탭 시 `emitTabReset()`, 다른 탭 전환 시 `navigation.navigate()`. 루트 화면들(dashboard, admin-revenue, more, teacher/revenue, teacher/settings, parent/home, super/dashboard)에 `useTabScrollReset("tabName")` + `ref={scrollRef}` 연결 완료.
- **탭 상태 유지**: 다른 탭으로 전환 시 각 탭의 마지막 상태 유지 (navigate() 사용, push() 아님).
- **뒤로가기**: 탭 내부 한 단계씩 (SubScreenHeader → `router.back()` 패턴). 탭 간 이동 없음.
- **로그아웃 버튼 위치 규칙**: 각 모드 홈 화면 헤더 우측에만 배치. 슈퍼관리자=dashboard, 관리자=dashboard, 선생님=today-schedule(PoolHeader right prop), 학부모=home. pools.tsx/more.tsx(admin)/settings.tsx(teacher)/more.tsx(parent)에서 제거.
- **팝업 뒤로가기**: ModalSheet의 `onRequestClose`가 Android 하드웨어 뒤로가기를 처리 (팝업 먼저 닫기).

**탭 구조 재정리 (2025-03)**:
- **선생님 (5탭)**: 홈(today-schedule) / 수업(my-schedule) / 메신저(messenger) / 정산(revenue) / 더보기(settings). 출결·일지·사진영상 탭 → href:null. my-schedule 내 반 카드에서 attendance/diary로 router.push 접근. settings(더보기)에 사진영상 앨범 바로가기 버튼 추가.
- **관리자 (6탭)**: 홈(dashboard) / 사람(people) / 수업(classes) / 메신저(messenger) / 정산(billing) / 더보기(more). 커뮤니케이션 탭 → href:null. billing이 정산 메인 탭으로 승격 (SubScreenHeader→PageHeader). classes 수업 탭에 공지 바로가기 버튼 추가(community.tsx 연결).
- **학부모 (Stack 네비게이션, 2026-03 전면 재구성)**: 하단 탭바 제거 → Stack 기반. `home.tsx`가 메인 진입점 (자녀탭+정보카드+3×2아이콘그리드+뉴스피드). `ParentScreenHeader` 공통 헤더 — 항상 `/(parent)/home`으로, 관리자 경로 차단. 신규 화면: `messages.tsx`(쪽지 전체페이지), `parent-profile.tsx`(이름/전화/비밀번호), `child-profile.tsx`(자녀정보+바로가기), `swim-info.tsx`(수영정보:수영장소개/수업료/레벨테스트/이벤트/수영용품). 재구성: `more.tsx`(5개메뉴: 부모정보수정·자녀관리·이용약관·개인정보·로그아웃), `children.tsx`(자녀연결+신청현황), `diary.tsx`(MessageModal제거→messages이동). 홈 아이콘 6개: 수업일지·출결·앨범·공지·쪽지·수영정보. 설정 아이콘 → 헤더 톱니바퀴로 이동. API: `PUT /parent/me`(이름/전화/비번변경), `GET /parent/pool-info`(수영장기본정보) 추가.
- **슈퍼관리자 (5탭)**: 홈(dashboard) / 수영장(pools) / 구독(subscriptions) / 운영(users) / 더보기(more). 탭 이름 변경(수영장 승인→수영장, 구독 관리→구독, 계정 관리→운영). 신규 `(super)/more.tsx` 생성(저장소 정책·플랫폼 정보 링크).

**Teachers Tab** (`(admin)/teachers.tsx`): 탭 일간(Daily)/월간(Monthly). 일간=오늘 통계+시간대 목록, 월간=MonthlyCalendar(인라인, 날짜 점 표시) → timeslots → TeacherPickerList → 반 목록 → ClassDetailPanel. 계정 관리 모달(추가·수정·삭제·인증코드) 포함. NavStep: main→[timeslots]→teachers→classes→detail.

### Technical Implementations
The platform is built as a pnpm workspace monorepo using TypeScript. It leverages Node.js 24, pnpm, TypeScript 5.9, Express 5 for the API server, PostgreSQL with Drizzle ORM for the database, Zod for validation, and Orval for API codegen. Esbuild is used for CJS bundling. Object storage is integrated for managing photos, with distinct album types (group and private) and corresponding access controls.

### Feature Specifications
- **구독 요금제 구조 (2026-03 개편)**: `subscription_plans` 테이블 — `tier`(PK), `name`, `price_per_month`, `member_limit`, `storage_gb`. 7개 플랜: free(5명/0.1GB/0원), starter(30명/0.6GB/2900원), basic(50명/1GB/3900원), standard(100명/5GB/9900원), growth(300명/20GB/29000원), pro(500명/40GB/59000원), max(1000명/100GB/99000원). `swimming_pools.subscription_tier` FK로 현재 플랜 참조.
- **결제 실패·삭제 정책 (2026-03 구현)**: `subscription_status` enum에 `payment_failed`/`pending_deletion`/`deleted` 추가. 결제 실패 시 `swimming_pools.payment_failed_at = NOW()`, `is_readonly = true`, `upload_blocked = true` 설정 → 7일 후 `pending_deletion` → 14일 후 `deleted`(크론 매시간 실행). `billing.ts`에 `/retry`(재결제·복구), `/simulate-failure`(super_admin 테스트용) 엔드포인트 추가. `pools/my` 응답에 `days_until_deletion`, `member_count`, `member_limit` 포함.
- **쓰기 차단 미들웨어 (readonlyGuard)**: `src/lib/readonlyGuard.ts` — JWT 디코딩 후 풀 상태 확인, `is_readonly=true` 또는 `subscription_status ∈ {payment_failed, pending_deletion, deleted}` 이면 POST/PUT/PATCH/DELETE → 403 반환. `/auth`, `/billing`, `/pricing`, `/super` 경로는 우회. `routes/index.ts` 최상단에 전역 적용.
- **회원 수 한도 차단**: `students.ts` POST `/` 핸들러에서 학생 등록 전 구독 플랜의 `member_limit` 대비 현재 active 학생 수 초과 시 403 `MEMBER_LIMIT_EXCEEDED` 반환.
- **스토리지 차단**: `uploads.ts` POST `/` 핸들러에서 `upload_blocked=true` 시 403 `UPLOAD_BLOCKED` 반환. 90% 이상 시 응답 헤더 `X-Storage-Warning` 경고.
- **읽기전용 UI (swim-app)**: `hooks/useWriteGuard.ts` — 쓰기 작업 전 `is_readonly`/`upload_blocked` 체크, 차단 시 `WriteGuardModal` 트리거. `components/common/ReadOnlyModal.tsx` — 읽기전용/업로드차단/회원한도 상태별 안내 모달 (관리자용 결제 이동 버튼 포함). `components/common/PaymentBanner.tsx` — 결제 실패/삭제 예약 상태 시 관리자 홈·결제 화면 상단 배너 표시. `AuthContext.PoolInfo`에 `is_readonly`, `upload_blocked`, `payment_failed_at`, `subscription_tier`, `member_count`, `member_limit`, `days_until_deletion` 등 추가.
- **Role-Based Access Control**: Differentiated permissions for `super_admin`, `platform_admin`, `pool_admin`, `teacher`, and `parent_account`. `platform_admin` permissions are granularly configurable.
- **Swimming Pool Approval Flow**: A multi-step process for new swimming pool registrations, involving administrator account creation, detailed application submission, super_admin approval/rejection, and login restriction based on approval status.
- **Multi-tenancy**: Achieved at the database level by including `swimming_pool_id` in all relevant tables, ensuring data isolation.
- **Photo Album System**: Supports both group and private photo albums with access control based on user roles and student/class assignments. Utilizes a dedicated object storage client for file uploads and downloads.
- **Makeup Lesson System**: Automated creation of makeup lesson requests upon student absence, with comprehensive lifecycle management (waiting, assigned, transferred, completed, cancelled) via dedicated API endpoints.
- **Activity Logging**: Automated tracking of significant administrator actions (e.g., status changes, information edits, restorations) in a `member_activity_logs` table, providing a detailed audit trail.
- **이벤트 기록 타임라인 (Event Log Timeline)**: `event_logs` 테이블 + `event-logger.ts` 헬퍼 모듈로 구조화된 이벤트 로그 관리. 카테고리: 삭제·결제·구독·해지·권한·선생님·저장공간·휴무일. 연결된 라우터: `teacher-invites.ts` (승인/해제/부관리자/인수), `billing.ts` (구독/결제/해지/저장공간추가), `holidays.ts` (휴무일추가/삭제), `kill-switch.ts` (원본삭제). Admin `more.tsx`에 "이벤트 기록" 탭 추가 (카테고리 필터 + FlatList 타임라인).
- **서버 기반 변경분 수집 + 새벽 배치 (2026-03)**:
  - **DB**: `data_change_logs`(tenant_id, table_name, record_id, change_type, payload, sync_status=pending/synced, created_at, synced_at), `backup_snapshots`(snapshot_type=incremental/full, tables_included, record_count) 2개 테이블 신규.
  - **Change Logger**: `api-server/src/utils/change-logger.ts` — `logChange({tenantId, tableName, recordId, changeType, payload})` 헬퍼. 오류 발생해도 메인 흐름에 영향 없음.
  - **변경 계측 라우트**: `students.ts`(create/update/delete), `class-groups.ts`(create/update/delete), `teacher-invites.ts`(create), `settlement.ts`(save/finalize), `parent.ts`(PUT /me) — 각 변경 직후 logChange 호출.
  - **배치 잡**: `api-server/src/jobs/backup-batch.ts` — node-cron. 매일 새벽 03:00 증분 동기화(pending→synced), 매주 일 02:00 전체 스냅샷(7개 테이블 레코드 수 집계). 앱 꺼져 있어도 서버 기준 실행.
  - **Sync API**: `GET /super/sync/stats`, `GET /super/sync/tenants`, `GET /super/sync/changes`, `POST /super/sync/run`(즉시 증분), `POST /super/sync/snapshot`(즉시 전체 스냅샷), `GET /super/sync/snapshots`.
  - **슈퍼관리자 UI**: `(super)/sync.tsx` — 통계카드/테이블별현황/테넌트별현황/즉시실행버튼/스냅샷이력. 더보기 → "데이터 동기화" 메뉴 추가.
- **킬 스위치 (Kill Switch)**: `/admin/kill-switch/preview` + `/admin/kill-switch/execute` 엔드포인트. 사진/영상/기록 종류 선택 + 기간(1~12개월) → 미리보기(건수/용량) → 비밀번호 bcrypt 인증 → 오브젝트 스토리지 삭제 + DB DELETE + event_logs 기록. Admin `more.tsx` "데이터 관리" 섹션 + 3단계 Modal UI (select→preview→confirm). Alert.alert 금지 규칙 준수.
- **미등록회원 일괄등록 시스템 (Bulk Unregistered Member Management)**:
  - **DB**: `students.invite_status` 컬럼 추가 (text, default "none" | "invited" | "joined"). `status="unregistered"` + `registration_path="bulk_upload"` 조합으로 미등록회원 식별.
  - **API** (`routes/unregistered.ts`): `GET /admin/unregistered`, `POST /admin/unregistered/bulk` (JSON: {students:[{name,parent_phone}]}), `POST /admin/unregistered/invite` ({ids}), `DELETE /admin/unregistered/:id`, `GET /teacher/unregistered`, `POST /teacher/unregistered/:id/assign` ({class_group_id} → status=active).
  - **관리자 사람 탭** (`(admin)/people.tsx`): "미등록" 5번째 탭 추가. 템플릿 CSV 다운로드 (웹: blob URL), CSV 업로드 → 파싱 → 서버 검증(정상/중복/오류) → ValidationModal. 체크박스 다중선택 + 전체선택. 학부모 초대 발송 (인원 확인 ConfirmModal → POST /admin/unregistered/invite → invite_status="invited").
  - **선생님 수업탭** (`(teacher)/my-schedule.tsx`): 일간 서브뷰 헤더 + 주간/월간 ClassDetailSheet actionRow에 "미등록" 버튼 추가. UnregisteredPickerModal — 검색 가능 리스트, 반배정 버튼 → ConfirmModal → POST /teacher/unregistered/:id/assign → status=active(정상회원 전환) + 학생 목록 갱신.
  - **상태 흐름**: 미등록회원(status=unregistered) → 선생님 반배정 → 정상회원(status=active). 학부모 가입 전에도 반배정 가능. 학부모 가입 후 기존 parent_phone 매칭으로 연결 구조 확보.
- **피드백커스텀 (Feedback Template Manager)**: 선생님 개인 피드백 문장 세트 관리. `context/FeedbackTemplateContext.tsx` — AsyncStorage 기반 선생님별(userId) 로컬 저장, 4개 고정 카테고리(beginner/intermediate/advanced/custom), 기본 내장 문장 각 15개. `(teacher)/feedback-custom.tsx` — 문장 CRUD(추가/수정/삭제 각각 Modal UI), 카테고리 이름 수정, 카테고리별 초기화, 전체 초기화, 최대 100개 제한. `components/teacher/SentencePicker.tsx` — 컨텍스트에서 templates/labels 읽기(즉시 반영). `(teacher)/settings.tsx`에 "피드백커스텀" 메뉴 추가. `_layout.tsx`에 FeedbackTemplateProvider 래핑 + feedback-custom 숨김 화면 등록.
- **저장공간 관리 (Storage Management)**: `/teacher/me/storage` + `/admin/storage` 엔드포인트 — 사진/영상/메신저/수영일지/공지/시스템 6개 카테고리 집계. 선생님 `settings.tsx`에 "내 저장공간" 섹션 (게이지+카테고리 상세). 관리자 `more.tsx`에 "저장공간 관리" 섹션 (전체 게이지 + 카테고리 총합 + 계정별 리스트 + 상세 팝업).
- **Work Messenger (업무 메신저, 2탭 협업 구조)**: 관리자/선생님 내부 업무용 협업 메신저. 학부모 대상 아님. 2탭 구조: **대화** (관리자+선생님 실시간 채팅, KakaoTalk 스타일 말풍선) / **공지** (관리자만 작성, 이동·보강 시스템 자동 메시지 포함). `channel_type`: talk|notice, `message_type`: normal|notice|system_move|system_makeup. 키보드 처리: FlatList inverted + KeyboardAvoidingView(behavior=padding/height). 공지 탭 안읽음 점 배지. DB: `work_messages`(+channel_type, +message_type 컬럼), `member_transfers`, `messenger_read_state`(신규). 시스템 메시지 유틸: `api-server/src/utils/messenger-system.ts`. 이동 자동메시지: `POST /messenger/member-transfers` → notice+system_move. 보강배정 자동메시지: `PATCH /admin/makeups/:id/assign` → notice+system_makeup. API: `/messenger/messages`(GET/POST), `/messenger/notice`(POST, 관리자전용), `/messenger/read-state`(GET/POST), `/messenger/member-transfers`, `/messenger/photo/:id`. 공유 컴포넌트: `components/common/MessengerScreen.tsx`.
- **Settlement/Payroll System (정산 시스템)**: Complete monthly settlement and payroll system for teachers. DB tables: `pool_class_pricing`, `pool_holidays`, `teacher_absences`, `temp_class_transfers`, `extra_classes`, `monthly_settlements`. APIs: `/pricing`, `/holidays`, `/absences`, `/extra-classes`, `/settlement`. UI: `(admin)/holidays.tsx` (달력형 휴무일 관리), `(admin)/pool-settings.tsx` (단가표 편집 섹션), `(teacher)/revenue.tsx` (매출계산기), `(teacher)/today-schedule.tsx` (결근 처리 AbsenceModal). Extra class creation with unregistered member support in `(teacher)/my-schedule.tsx`. Admin more.tsx has "정산·일정" section with links to holidays and pricing.
- **Login/Signup System (로그인/회원가입, 2026-03 전면 재구성)**: 통합 로그인 화면(`index.tsx`) — 학부모 별도 버튼 제거, 회원가입·비밀번호찾기 항상 노출. `unified-login` v2: `available_accounts` 배열 반환(admin+parent 동시), 하위호환. `check-role-permission` 엔드포인트 신규. `AuthContext`: `allAccounts`, `AccountEntry`, `lastUsedRole/Tenant` AsyncStorage 지속, `activateAccount()`, `setLastUsedRole()`, `checkRolePermission()`, `updateParentNickname()`. `_layout.tsx`: last_used_role 기반 자동진입(유효성 검증) → 무효 시 `/org-role-select`. `org-role-select.tsx`: allAccounts 기반 역할 선택 UI, 선택 시 last_used_role 저장. **학부모 온보딩 3단계**: `parent-onboard-pool.tsx`(수영장 검색), `parent-onboard-child.tsx`(자동승인/대기), `parent-onboard-nickname.tsx`(호칭 설정). API: `GET /pools/search`, `POST /parent/onboard-pool`(parent_phone/parent_phone2 매칭→자동승인), `PUT /parent/nickname`, `GET /parent/attendance`(연결자녀 전체출결). **학부모 출결 화면**: `ParentScreenHeader`로 교체, 월 구분선 리스트형. **DB**: `parent_accounts.nickname`, `students.parent_phone2` 컬럼 추가. **관리자 학생상세**: `보호자연락처2(parent_phone2)` 편집/조회 추가. 헤더 규칙: 학부모 화면은 `SubScreenHeader` 금지, `ParentScreenHeader` 사용. `parent-signup.tsx` "이미 계정" 링크 → 통합 로그인(`/`)으로 변경. 역할 홈 매핑: super_admin/platform_admin→/(super)/dashboard, pool_admin/sub_admin→/(admin)/dashboard, teacher→/(teacher)/home, parent/parent_account→/(parent)/home.
- **역할 전환 및 라우트 보호 (Role Switch & Route Guard, 2026-03)**: 로그인 화면에서 테스트 계정 섹션 완전 제거(index.tsx, login.tsx). `_layout.tsx`의 `computeRoleKeys()` 헬퍼: allAccounts 기반 단일 역할 계정은 org-role-select 없이 홈으로 직행, 복수 역할은 선택 화면 유지. **역할 전환 칩 버튼**: `(admin)/dashboard.tsx` — `adminUser.roles.includes("teacher")`일 때 "선생님으로 전환" 칩 표시 (초록 #D1FAE5/#059669), `switchRole("teacher")` → `setLastUsedRole` → teacher home 이동. `(teacher)/today-schedule.tsx` — `adminUser.roles.includes("pool_admin"|"sub_admin")`일 때 "관리자로 전환" 칩 표시 (테마색), `switchRole(adminRoleKey)` → admin dashboard 이동. 칩 디자인: `switchChip`(flex-row, border+bg 반투명, borderRadius:8), `switchChipTxt`(11px, SemiBold), 전환 중 ActivityIndicator. **라우트 보호**: `(admin)/_layout.tsx` — adminUser.role==="teacher"이면 teacher 홈으로 리다이렉트. `(teacher)/_layout.tsx` — adminUser.role이 ADMIN_ROLES(pool_admin/sub_admin/super_admin/platform_admin)에 속하면 admin 홈으로 리다이렉트. isLoading 완료 후 실행(useEffect + guard).

- **멀티풀 관리 시스템 + 화이트라벨 분리 (Multi-Pool Management + White-Label, 2026-03)**:
  - **DB**: `user_pools` 조인 테이블 (user_id, pool_id, role, is_primary) — 운영자 1명이 복수 수영장 소유. `swimming_pools`에 `white_label_enabled`, `hide_platform_name` 컬럼 추가. 기존 `users.swimming_pool_id` 데이터를 `user_pools`로 마이그레이션(7개).
  - **API** (`routes/pools.ts`): `GET /pools/my-pools` (소유 수영장 목록), `POST /pools/switch/:poolId` (풀 전환 + 새 JWT 발급 + `users.swimming_pool_id` 업데이트), `POST /pools/create-pool` (신규 수영장 생성 + `user_pools` 연결 + 레벨/요금 복사 옵션), `GET/PUT /pools/white-label` (화이트라벨 설정 조회·저장).
  - **AuthContext**: `OwnedPool` 인터페이스 추가, `ownedPools: OwnedPool[]` 상태, `loadOwnedPools()` (비동기 API 호출 → 상태 갱신), `switchPool(poolId)` (POST switch → 토큰/풀/유저 상태 갱신 + AsyncStorage 저장). logout 시 `ownedPools` 초기화.
  - **UI 4종**:
    - `(admin)/branches.tsx` — 전면 재설계: "내 수영장 관리" 화면. 소유 풀 목록 카드(구독상태/승인상태 배지, 현재 풀 강조 2px 테두리, 전환 버튼). 새 수영장 추가 모달(이름/주소/전화 + 레벨/요금 복사 체크박스). ConfirmModal 전환 확인.
    - `(admin)/white-label.tsx` — 신규: 화이트라벨 설정. 화이트라벨 활성화 토글 + 플랫폼 이름 숨기기 토글(의존성 비활성). Switch 컴포넌트 + 학부모앱 실시간 미리보기 (스윔노트 표시/숨김 상태).
    - `app/pool-select.tsx` — 신규: 로그인 후 수영장 선택 화면. 복수 수영장 보유 시 자동 표시. 수영장 카드 리스트 + `switchPool` + `setLastUsedTenant` 후 admin 홈 이동. 다른 계정으로 로그인 버튼.
    - `app/_layout.tsx` — 멀티풀 라우팅 삽입: pool_admin 검증 후 `/pools/my-pools` 조회, 복수 풀이고 `lastUsedTenant` 없으면 `/pool-select`로 리다이렉트. `APP_ROOTS`에 `pool-select` 추가.
  - **대시보드**: "화이트라벨" 메뉴 → `/(admin)/white-label` 라우트 연결. "지점 관리" → "수영장 관리"로 명칭 변경 (`layers` 아이콘).

- **초대방식 설정 재구축 (Invite System Rebuild, 2026-03)**:
  - **SMS 과금 구조 완전 제거**: `FREE_QUOTA`, `SMS_UNIT_PRICE`, `MY_USAGE`, 과금 카드 UI 등 전부 삭제.
  - **기기 기본 문자앱 연동**: `Linking.openURL(sms:...)` 방식으로 iOS(`sms:phone&body=...`) / Android(`sms:phone?body=...`) 플랫폼 분기 처리.
  - **`inviteRecordStore.ts` 확장**: `parentTemplateBody` / `iosLink` / `androidLink` 편집 가능 상태 추가. `setParentTemplate()`, `resetParentTemplate()`, `setAppLinks()` 액션. `resolveTemplate()` 공용 변수 치환 헬퍼. `buildTeacherMessage`/`buildGuardianMessage` 서명 업데이트(iosLink, androidLink 인자 추가).
  - **고정 선생님 템플릿**: `TEACHER_TEMPLATE_FIXED` 상수. 관리자는 미리보기 + "문자앱 테스트 열기" 버튼만 제공.
  - **수정 가능 학부모 템플릿**: 변수 삽입 버튼(`{수영장이름}` / `{학생이름}` / `{iOS링크}` / `{Android링크}`), 텍스트 입력, 미리보기(홍길동 기준), 저장, 초기화(ConfirmModal 확인).
  - **`(admin)/invite-sms.tsx` 전면 재설계**: 탭 2개 — "초대 설정"(A.안내배너/B.선생님고정/C.학부모편집/D.앱링크) + "초대 기록"(filterType 필터+FlatList+재발송 버튼).

- **슈퍼관리자 콘솔 보안 설정 / 외부 서비스 섹션 대규모 확장 (2026-03)**:
  - `security-settings.tsx` — 섹션 D "외부 서비스 연결 상태" 완전 재설계:
    - `ServiceStatus` 8종 (`normal` / `caution` / `warning` / `error` / `disconnected` / `unconnected` / `checking` / `planned`), `ExtService` 인터페이스 확장 (category / serviceType / endpointUrl / projectId / bucketName / connectedAt / lastCheckedAt / lastErrorAt / statusMessage / notes / isPlaceholder)
    - 5개 카테고리 (`data` / `payment` / `messaging` / `appstore` / `other`) × 21개 서비스 시드 데이터
    - `CATEGORY_CFG` 카테고리 헤더 설정, `fmtChecked()` 상대시간 헬퍼
    - 섹션 D UI: 카테고리 분리 헤더 + 클릭 가능 서비스 카드 + "전체 새로고침" 버튼 + 이상 건수 배지
    - 서비스 상세 바텀시트 모달: 상태 배지·메시지, 연결 URL/프로젝트ID/버킷명/등록일/확인시간/오류시간/사용목적, "상태 새로고침" 버튼
    - `refreshService()` 업데이트: 새 `ExtService` 필드 기반, `refreshAllServices()` 추가
    - `selectedService` state 추가 (서비스 상세 모달 제어)
  - 기존 T001~T008 파일 전부 완성 상태 확인 (noticeStore, adsStore, supportStore, notices.tsx, ads.tsx, NoticePopup, revenue-analytics.tsx, cost-analytics.tsx, system-status.tsx, more.tsx 모두 완성)

- **슈퍼관리자 운영 콘솔 풀 MVP (2026-03)**:
  - **Zustand 스토어** (`store/index.ts`): 9개 슬라이스 — operatorsStore, billingStore, storageStore, riskStore, supportStore, auditLogStore, featureFlagStore, readonlyStore, backupStore.
  - **유틸리티** (`utils/super-utils.ts`): `safeDate`, `fmtDate`, `fmtRelative`, `fmtBytes`, `createAuditLog`, `IMPACT_CFG` 공유 헬퍼.
  - **신규 API 라우트** (`routes/super.ts`): `GET/POST/PATCH/DELETE /super/plans`(구독상품 CRUD), `GET/POST /super/backups`, `POST /super/backups/:id/restore`, `PUT /super/readonly-control`, `GET /super/risk-summary`, `GET /super/recent-audit-logs` — DB 테이블 자동 생성 + 감사 로그 기록.
  - **신규 화면 3종**:
    - `(super)/subscription-products.tsx`: 구독 상품 CRUD — 등급/가격/사용자/저장/기능 설정 폼 모달, 상태 토글, 아카이브, 감사 로그.
    - `(super)/backup.tsx`: 백업/스냅샷/복구/비교 — 증분/전체 백업 탭, 복구 확인 모달, 스냅샷 이력, 비교(shuffle 아이콘).
    - `(super)/readonly-control.tsx`: 읽기전용 제어 3단계 — 플랫폼/운영자/기능별, 활성/경고/긴급 레벨, 감사 로그.
  - **대시보드 확장** (`(super)/dashboard.tsx`): 메뉴 13개(구독 상품 설정·저장공간 정책·백업/복구·읽기전용 제어 추가), 리스크 요약 6지표, 최근 감사 로그 5건, 병렬 데이터 페칭.
  - **버그 수정**: `useAuth()` `user` → `adminUser` (AuthContextType 실제 필드명), Feather `"git-compare"` → `"shuffle"` (유효 아이콘).

- **푸시 알림 시스템 MVP (2026-03)**:
  - **중앙화된 push-service** (`artifacts/api-server/src/lib/push-service.ts`):
    - `sendRawPush(tokens, title, body, data)` — Expo Push API 직접 호출
    - `checkPushEnabled(userId, notifType, isParent)` — `push_settings` 테이블 ON/OFF 조회 (기본값 true)
    - `sendPushToUser(userId, isParent, type, ...)`, `sendPushToClassParents(classId, ...)`, `sendPushToPoolParents(poolId, ...)`, `sendPushToPoolAdmins(poolId, ...)`, `sendPushToPoolTeachers(poolId, ...)`
    - `initPushTables()` — `push_settings`, `pool_push_settings`, `push_logs`, `push_scheduled_sent` 테이블 자동 생성 + 부분 유니크 인덱스
  - **DB 테이블**:
    - `push_settings`: 유저/학부모별 알림 타입(notice/class_reminder/diary_upload/photo_upload/messenger/makeup_request/diary_reminder) ON/OFF 저장. 부분 인덱스로 NULL UNIQUE 문제 해결.
    - `pool_push_settings`: 수영장별 전날 알림 시간(`prev_day_push_time`), 당일 알림 오프셋(`same_day_push_offset`), 메시지 템플릿 5종
    - `push_logs`: 모든 푸시 발송/스킵/실패 로그
    - `push_scheduled_sent`: 예약 푸시 중복 방지 (날짜+시간+pool+class 키)
  - **예약 스케줄러** (`artifacts/api-server/src/jobs/push-scheduler.ts`): node-cron 매 분 실행. 전날 알림(pool별 설정 시간에 발송) + 당일 알림(수업 N시간 전, ±1분 허용).
  - **기존 라우트 푸시 연동**:
    - `routes/notices.ts`: POST 공지 등록 → 풀 전체 학부모 또는 개인 학부모에게 pool 템플릿 기반 푸시
    - `routes/diary.ts`: `sendDiaryPush()` → push-service `sendPushToClassParents()` 교체, 인앱 알림 + Expo 푸시 통합
    - `routes/photos.ts`: 그룹/개인 앨범 업로드 → 학부모 푸시 (일지 5분 내 발송 시 중복 스킵)
    - `routes/messenger.ts`: @멘션(`directed_message`) → 해당 유저 푸시
  - **푸시 설정 API** (`routes/push-settings.ts`): `GET/PUT /push-settings` (본인 ON/OFF), `GET/PUT /push-settings/pool` (관리자 전용), `GET /push-settings/logs`
  - **프론트엔드 화면**:
    - `(parent)/push-settings.tsx`: 공지/수업/일지/사진 4개 토글, API 연동
    - `(teacher)/settings.tsx`: 기존 Switch에 `PUT /push-settings` API 연동 추가 (messenger/makeup_request/diary_reminder)
    - `(admin)/push-notification-settings.tsx`: 관리자 수신 알림 ON/OFF (결제는 필수)
    - `(admin)/push-message-settings.tsx`: 전날/당일 알림 시간 선택 + 메시지 템플릿 5종 편집
  - **진입점**: parent more.tsx → 푸시 알림 설정, admin more.tsx SHORTCUTS → 푸시 알림/발송 설정 2개 추가

- **구독 결제 시스템 리팩터링 완료 (2026-03)**:
  - **9개 플랜 확정**: `free_5` / `swimnote_30`(스타터) / `swimnote_50`(베이직) / `swimnote_100`(스탠다드) / `swimnote_300`(어드밴스) / `swimnote_500`(프로) / `swimnote_1000`(맥스) / `swimnote_2000` / `swimnote_3000`. `domain/policies.ts`, `domain/types.ts` 완전 교체.
  - **50% 첫 달 할인**: `billing.ts` POST /subscribe에서 `first_payment_used` 플래그 체크 → `event_type='first_payment'`, `intro_discount_amount`, `charged_amount` 정확 기록.
  - **revenue_logs 스키마 확장**: `event_type`, `gross_amount`, `intro_discount_amount`, `charged_amount`, `refunded_amount`, `store_fee`(30%), `net_revenue`, `payment_provider`, `occurred_at` 컬럼 추가.
  - **API 연동 완료**:
    - `GET /billing/revenue-logs?start&end&limit` → 날짜 필터링, 집계 summary(total_charged/discount/store_fee/net_revenue) 반환.
    - `GET /billing/revenue-by-plan` → plan_id별 payment_count/total_amount 집계.
    - `subscription-products.tsx` → GET/PUT/POST/PATCH /super/plans 완전 연동.
    - `revenue-analytics.tsx` → revenue_logs API 기반 (주간/월간/연간 탭, 전기 대비 %).
    - `billing-analytics.tsx` → revenue_logs API + revenue-by-plan API 기반 (Zustand 의존 제거).
  - **레거시 퍼지 완료**: `유료100`, `유료300`, `plan-pro100`, `plan-free10` 등 구 플랜 문자열을 seed/subscriptions.ts, seed/operators.ts, seed/auditLogs.ts, store/operatorsStore.ts에서 전부 제거.
  - **앱스토어 수수료**: PG(PortOne) 수수료 완전 제거, 앱스토어/구글플레이 30% 단일 항목으로 통일.

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