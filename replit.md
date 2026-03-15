# SwimNote — 전국 수영장 온라인 통합 관리 플랫폼

## 앱 개요
멀티테넌트 수영장 관리 B2B SaaS. 역할: super_admin / platform_admin / pool_admin / teacher / parent_account.
한국어 UI. 데모 계정: 1/1(super_admin), 2/2(pool_admin-토이키즈), 3/3(teacher-토이키즈), 4/4(parent-서태웅).
데모 풀: 토이키즈(pool_toykids_001), 아쿠아스타(pool_aquastar_002).

## 플랫폼 관리자 권한 체계

### 역할 구분
- **super_admin**: 슈퍼관리자 — 모든 권한 보유 (변경 불가)
- **platform_admin**: 플랫폼관리자 — 세부 권한 개별 부여

### 플랫폼관리자 권한 항목 (permissions JSONB)
| 권한 키 | 설명 |
|---------|------|
| `canViewPools` | 수영장 목록/상세 열람 |
| `canEditPools` | 수영장 정보 편집 |
| `canApprovePools` | 수영장 신청 승인/반려 |
| `canManageSubscriptions` | 구독 상태 변경 |
| `canManagePlatformAdmins` | 플랫폼 관리자 계정 생성/수정 |

### API 권한 맵핑
- `GET /admin/pools` → `canViewPools`
- `GET /admin/pools/:id/detail` → `canViewPools`
- `PATCH /admin/pools/:id/approve` → `canApprovePools`
- `PATCH /admin/pools/:id/reject` → `canApprovePools`
- `PATCH /admin/pools/:id/subscription` → `canManageSubscriptions`
- `GET /admin/users` → `canManagePlatformAdmins`
- `POST /admin/users` → super_admin 전용
- `PATCH /admin/users/:id/permissions` → super_admin 전용

### 미들웨어
- `requirePermission(perm)`: super_admin은 항상 통과, platform_admin은 해당 권한 체크
- `requireRole(...)`: 기존 역할 체크 (pool_admin, teacher 등에 사용)

## 플랫폼 승인 플로우 (수영장 가입 신청 ↔ 관리자 계정 활성화)

### 1단계: 수영장 관리자 가입
- `artifacts/swim-app/app/register.tsx`: 관리자 개인 계정 생성 (이메일/비밀번호)
- 역할: pool_admin, 상태: 아직 수영장 미배정

### 2단계: 수영장 등록 신청
- `artifacts/swim-app/app/pool-apply.tsx`: 수영장 신청 폼
- **필수 입력 필드:**
  - **수영장 정보**: 이름, 주소, 전화, 대표자명, 사업자등록번호, 사업자등록증 이미지
  - **관리자 정보**: 이름, 이메일(로그인 ID), 연락처
- API: `POST /api/pools/apply` (FormData + 이미지)
- DB: `swimming_pools` 테이블에 신규 pool 생성 (approval_status = 'pending')
- 신청 후 라우팅: `/pending` (승인 대기 화면)

### 3단계: 플랫폼 운영자 승인
- `artifacts/swim-app/app/(super)/pools.tsx`: super_admin만 접근 가능
- 신청 목록 조회: `GET /api/admin/pools`
- **상태 필터**: pending(미승인), approved(승인), rejected(반려)
- **운영자 버튼**:
  - **승인**: `PATCH /api/admin/pools/:id/approve` → approval_status = 'approved'
  - **반려**: `PATCH /api/admin/pools/:id/reject` → approval_status = 'rejected'
  - 반려 사유 저장 가능

### 4단계: 관리자 계정 활성화 및 로그인 제한
- **승인 시**: DB의 users 레코드는 이미 존재 (2단계에서 신청자가 pool 생성 후 계정에 pool_id 연결됨)
- **로그인 제한 로직** (`artifacts/api-server/src/routes/auth.ts`):
  - `POST /login` 시 pool_admin은 pool의 approval_status 체크
  - **pending** → 403 응답: "수영장이 아직 승인되지 않았습니다. 플랫폼 운영자의 승인을 기다려주세요."
  - **rejected** → 403 응답: "수영장 신청이 반려되었습니다. 플랫폼 운영자에게 문의하세요."
  - **approved** → 정상 로그인 가능, 토큰 발급
- 승인 후 해당 관리자는 자신의 poolId로 로그인 가능

## 데이터베이스 변경사항

### swimming_pools 테이블 추가 컬럼
```sql
ALTER TABLE swimming_pools ADD COLUMN admin_name text;
ALTER TABLE swimming_pools ADD COLUMN admin_email text;
ALTER TABLE swimming_pools ADD COLUMN admin_phone text;
```
- `admin_email`: 승인되는 pool의 관리자 로그인 이메일 (owner_email과 동일하게 저장)
- `admin_name`: 관리자 이름
- `admin_phone`: 관리자 연락처

## API 엔드포인트 정리

| 메서드 | 경로 | 역할 | 기능 |
|--------|------|------|------|
| POST | `/api/pools/apply` | pool_admin(신청자) | 수영장 신청 (FormData + 이미지) |
| GET | `/api/admin/pools` | super_admin | 신청 목록 조회 (상태 구분) |
| PATCH | `/api/admin/pools/:id/approve` | super_admin | 승인 처리 |
| PATCH | `/api/admin/pools/:id/reject` | super_admin | 반려 처리 |
| POST | `/api/auth/login` | - | 로그인 (pool 상태 검증) |

## 응답 형식 (JSON 통일)

```json
{
  "success": true,
  "data": { /* ... */ }
}
```

```json
{
  "success": false,
  "message": "사용자 친화적 에러 메시지",
  "error": "기술적 에러 키"
}
```

## 테스트 시나리오

### 시나리오 1: 정상 신청 → 승인 → 로그인
1. 새 관리자가 `register.tsx`에서 계정 생성 (이메일, 비밀번호)
2. `pool-apply.tsx`에서 수영장 신청
3. super_admin이 `pools.tsx`에서 조회 후 승인
4. 관리자가 `login`으로 로그인 가능

### 시나리오 2: 신청 → 반려
1. 관리자가 신청
2. super_admin이 "반려" 버튼 클릭
3. 관리자가 로그인 시도 → 403 "신청이 반려되었습니다"

### 시나리오 3: 승인 대기
1. 관리자가 신청
2. 아직 승인 전: 로그인 시도 → 403 "승인을 기다려주세요"

## 파일 수정 목록
- `artifacts/swim-app/app/pool-apply.tsx`: 관리자 정보 필드 추가
- `artifacts/api-server/src/routes/pools.ts`: /apply 엔드포인트 수정 (admin_* 처리)
- `artifacts/api-server/src/routes/admin.ts`: /pools/:id/approve 로직 개선
- `artifacts/api-server/src/routes/auth.ts`: 로그인 시 pool approval_status 검증

## 향후 작업 (이번 턴 제외)
- 승인/반려 시 관리자에게 이메일 알림 (별도 이메일 서비스 통합)
- rejected 상태 UI 개선 (재신청 기능 등)
- suspended 상태 추가 (일시 정지 기능)
- 구독 상태 자동화 (승인 후 trial → active 등)

---

## 사진 앨범 구조 (photo album)
`student_photos` 테이블에 `album_type` (group|private) + `class_id` 컬럼 추가.
- **group album**: student_id = NULL, class_id 필수. 반 모든 학부모에게 공개.
- **private album**: student_id + class_id 모두 필수. 해당 학생 학부모만 공개.

API 엔드포인트 (모두 인증 필수):
- GET `/api/photos/group/:classId` — 반 전체 앨범 (teacher=담당반, parent=자녀반, pool_admin=자신의풀)
- GET `/api/photos/private/:studentId` — 개인 앨범 (teacher=담당반, parent=자녀, pool_admin=자신의풀)
- POST `/api/photos/group` — 반 전체 업로드 (body: class_id + photos[])
- POST `/api/photos/private` — 개인 업로드 (body: class_id + student_id + photos[])
- GET `/api/photos/parent-view` — parent용 자녀별 앨범 통합 뷰
- GET `/api/photos/:photoId/file` — GCS에서 파일 스트리밍 (권한 검사 포함)
- DELETE `/api/photos/:photoId` — 삭제 (teacher=자신이 올린 것만, admin=풀 내 전체)

오브젝트 스토리지: `new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID })`
업로드 메서드: `client.uploadFromBytes(objectName, buffer, { contentType })` — 인자 순서 주의.
다운로드 메서드: `client.downloadAsBytes(objectName)` — 반환값 `[Buffer]` 배열. `bytes[0]` 로 접근.

# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
├── packages/               # Shared packages
└── package.json
```

## Database

PostgreSQL with Drizzle ORM. DB accessible via DATABASE_URL env var.

Key tables:
- `swimming_pools` (pool_id, name, approval_status, subscription_status, admin_name, admin_email, admin_phone, ...)
- `users` (id, email, password_hash, role, swimming_pool_id, ...)
- `students` (id, swimming_pool_id, name, birth_year, parent_name, parent_phone, parent_user_id, registration_path, weekly_count, assigned_class_ids[jsonb], schedule_labels, invite_code, status=[active|pending_parent_link|withdrawn|inactive], ...)
- `class_groups` (id, swimming_pool_id, name, ...)
- `classes` (id, class_group_id, swimming_pool_id, ...)
- `members` (id, swimming_pool_id, student_id, ...)
- `parent_accounts` (id, swimming_pool_id, name, ...)
- `parent_students` (id, parent_account_id, student_id, ...)
- `notices` (id, swimming_pool_id, title, ...)
- `student_photos` (id, swimming_pool_id, class_id, student_id, album_type, ...)
- `student_diaries` (id, swimming_pool_id, student_id, ...)
- `attendance` (id, swimming_pool_id, student_id, ...)
- `notice_reads` (id, notice_id, user_id, ...)

All tables include `swimming_pool_id` for multi-tenant isolation.

## Security / Isolation

- **Multi-tenant at DB level**: Every query filtered by `swimming_pool_id`
- **Auth middleware**: Decodes JWT, checks role & pool access
- **API validation**: Single-item endpoints (GET/PUT/DELETE) check pool ownership before returning data
- **Login restriction**: pool_admin cannot login if pool.approval_status != 'approved'

## 관리자 앱 5탭 구조 (v3 — 2026-03)

### 탭 구성
1. **대시보드** — 통합 검색(모달), KPI 4카드, 처리필요 배지, 빠른액션 6개, 오늘수업통계, 최근등록회원, 최근변경이력
2. **사람** (`people.tsx`) — 회원/학부모/선생님/승인 4탭, 실DB 연동, 학부모 요청 승인/거절(PATCH /admin/parent-requests/:id)
3. **수업** (`classes.tsx`) — 반관리, 출결, 수업일지, 보강 화면 링크
4. **커뮤니케이션** (`communication.tsx`) — 공지사항(CRUD), 학부모 요청 처리, 선생님 일지 조회
5. **더보기** (`more.tsx`) — 설정메뉴 허브(승인관리/선생님관리/학부모계정/삭제복구센터/브랜드/지점/알림/수영장/결제/모드변경) + 활동로그

### 숨김 라우트 (탭에 보이지 않지만 내비게이션 가능)
`members, community, approvals, attendance, parents, notices, mode, teachers, pool-settings, notifications, branches, withdrawn-members, billing, branding, member-detail, teacher-hub, makeups`

### 회원 상세 8탭 허브 (member-detail.tsx)
- 기본정보: 이름/출생/보호자 편집, 상태변경(재원/휴원/정지/탈퇴), 복구
- 수업정보: 반배정(주N회), 최근출결30일 시각화, 최근일지 5건
- **보강**: 이 회원의 보강 이력 목록 (GET /admin/makeups/student/:id)
- 레벨/평가: 수영레벨 뱃지선택+자유입력, 관리자내부메모
- 학부모공유: 앱연결상태, 초대코드 복사/공유
- **학부모 요청**: 이 회원 관련 학부모 요청 목록 (GET /admin/parent-requests)
- 결제/이용: 이용정보, 결제관리 바로가기
- 활동로그: 관리자 액션 로그 (GET /admin/students/:id/activity-logs)

### 보강 시스템 (makeups.tsx + attendance.ts)
- `makeup_sessions` 테이블: id, swimming_pool_id, student_id, original_class_group_id, original_teacher_id, absence_date, status(waiting/assigned/transferred/completed/cancelled), assigned_class_group_id, substitute_teacher_id, transferred_to_teacher_id, completed_at
- 결석 기록 시 자동 보강 대기 생성: `autoCreateMakeup()` in attendance.ts
- 보강 API: GET/POST/PATCH /api/admin/makeups, /makeups/:id/assign, /transfer, /complete, /cancel, /student/:id

### 선생님 허브 (teacher-hub.tsx)
- 담당 회원목록, 출결 기록, 수업일지 목록(삭제), 내 보강 현황
- GET /api/admin/teacher-hub/:teacherId
- 활동로그: 관리자 변경이력 타임라인

### 신규 Admin API 엔드포인트 (2026-03)
- `GET /admin/dashboard-stats` — 통합 통계 (members, attendance, classes, pending, recent)
- `GET /admin/search?q=` — 전체 검색 (회원/반/선생님/공지/학부모)
- `GET /admin/activity-logs?limit&offset` — 수영장 전체 활동 로그 (페이지네이션)
- `GET /admin/member-logs/:studentId` — 회원별 활동 로그
- `PATCH /admin/students/:id/status` — 상태변경 (활동로그 자동기록)
- `POST /admin/students/:id/restore` — 탈퇴/삭제 회원 복구 (활동로그 자동기록)
- `PATCH /admin/students/:id/info` — 기본정보 수정 (활동로그 자동기록)
- `GET /admin/students/:id/detail` — 통합 상세 (출결30일, 일지5건 포함)

### 활동 로그 DB
- 테이블: `member_activity_logs`
- 컬럼: id, swimming_pool_id, student_id, parent_id, target_name, action_type, target_type, before_value, after_value, actor_id, actor_name, actor_role, note, created_at
- 자동 기록: 상태변경, 정보수정, 복구 시

## 선택 모드 삭제 UX (관리자 화면)

`hooks/useSelectionMode.ts` — 공통 선택 상태 훅 (toggle, selectAll, isSelected 등)
`components/admin/SelectionActionBar.tsx` — 하단 고정 액션바 (전체선택·카운트·삭제·종료)

적용 화면:
- `app/(admin)/classes.tsx` — 반 선택 삭제 (soft delete, 학생 미배정 처리)
- `app/(admin)/members.tsx` — 회원 선택 삭제 (soft delete, parent_students 유지)
- `app/(admin)/notices.tsx` — 공지 선택 삭제 (hard delete)

공통 UX 패턴:
- 헤더 "선택" 버튼 → 선택 모드 진입
- 각 아이템에 체크박스 표시 (선택 시 파란 테두리)
- 선택 모드 중 기존 탭/이동 비활성, 카드 탭으로 선택 토글
- SelectionActionBar: 전체선택 체크박스 + "선택됨 N개" 배지 + 빨간 삭제 버튼 + X 종료
- 삭제 전 Alert 확인 → Promise.allSettled 병렬 처리 → 실패 시 부분 오류 알림
- 성공 후 UI 즉시 갱신 + 선택 모드 자동 종료

## Branching & Git

Main branch only. Commits auto-saved.
