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
- `students` (id, swimming_pool_id, name, ...)
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

## Branching & Git

Main branch only. Commits auto-saved.
