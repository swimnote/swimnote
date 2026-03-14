# SwimClass — 수영장 관리 플랫폼

## 앱 개요
멀티테넌트 수영장 관리 B2B SaaS. 역할: super_admin / pool_admin / teacher / parent_account.
한국어 UI. 데모 계정: 1/1(super_admin), 2/2(pool_admin), 3/3(teacher), 4/4(parent).
데모 풀: 토이키즈(pool_toykids_001), 반: 초급반(cg_toykids_a), 학생: 서태웅(stu_taewung_001).

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
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.

## 앱 브랜딩 구조 (SwimClass 플랫폼)

### 이름 정책
- **앱스토어 / 구글플레이 이름**: `SwimClass` (고정, `app.json name` 변경 완료)
- **앱 내부 표시**: 수영장 이름 + "Powered by SwimClass"
  - 예: 토이키즈스윔클럽 화정점 / Powered by SwimClass

### 브랜딩 컨텍스트 (`context/BrandContext.tsx`)
- `useBrand()` hook으로 전역 브랜드 상태 접근
- 로그인 시 `BrandSync` 컴포넌트가 pool의 `theme_color`, `logo_url`, `logo_emoji` 자동 동기화
- 로그아웃 시 기본값 초기화
- AsyncStorage 캐시로 앱 재시작 시 즉시 복원

### PoolHeader 컴포넌트 (`components/PoolHeader.tsx`)
- 로그인 후 앱 내 상단 헤더
- 로고 표시 우선순위: 이미지 URL > 이모지 > 이니셜(수영장명 첫 글자)
- `right` prop으로 로그아웃 버튼 등 커스텀 가능

### 동적 테마 색상
- 관리자/학부모 탭바 activeTintColor가 `themeColor`로 동적 변경됨
- 대시보드 통계 카드, 메뉴 아이콘 색상도 테마 반영
- `swimming_pools.theme_color` 컬럼(기본 `#1A5CFF`)에 저장

### DB 컬럼 (swimming_pools)
- `theme_color text DEFAULT '#1A5CFF'` — 브랜드 주색상
- `logo_url text` — 로고 이미지 URL
- `logo_emoji text` — 로고 이모지 (로고 없을 때 대체)

### 브랜딩 설정 API
- `GET /pools/branding` — 현재 수영장 브랜딩 조회
- `PUT /pools/branding` — theme_color, logo_url, logo_emoji 수정

### 관리자 브랜딩 화면 (`(admin)/branding.tsx`)
- 12색 팔레트 + HEX 직접 입력
- 20개 수영장 테마 이모지 선택
- 로고 URL 입력
- 실시간 헤더 미리보기
- 앱 아이콘 커스터마이징 안내 (엔터프라이즈 플랜)

## 결제 시스템 (payment/)

### 프로바이더 패턴 (`artifacts/api-server/src/payment/`)
| 파일 | 설명 |
|------|------|
| `types.ts` | `PaymentProvider` 인터페이스 정의 |
| `mock.ts` | 개발 환경 모의 결제 (항상 성공) |
| `toss.ts` | 토스페이먼츠 빌링키 자동결제 스텁 |
| `portone.ts` | 포트원(아임포트) v2 빌링키 스텁 |
| `index.ts` | `PAYMENT_PROVIDER` 환경변수로 프로바이더 선택 |

### 환경변수로 PG 전환
```
PAYMENT_PROVIDER=mock       # 개발 기본값
PAYMENT_PROVIDER=toss       # 토스페이먼츠 (TOSS_SECRET_KEY 필요)
PAYMENT_PROVIDER=portone    # 포트원 (PORTONE_API_SECRET + PORTONE_CHANNEL_KEY 필요)
```

### 구독 규칙
- 월 선불, 지점 단위 독립 결제
- 업그레이드 시 일할 계산 후 즉시 차액 결제
- 다음 결제일은 기존 주기 유지
