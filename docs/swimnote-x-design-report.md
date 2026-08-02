# SWIMNOTE X — 구현 전 설계 보고서
> 작성일: 2026-08-02 | 검증 등급 표시 포함

---

## 검증 등급 범례
- `REPOSITORY_VERIFIED` — 실제 파일·함수·테이블 직접 확인
- `DB_SCHEMA_VERIFIED` — 실제 DDL/Drizzle 스키마 확인
- `CONTRACT_DESIGNED` — 실제 코드 기반으로 설계 (미구현)
- `IMPLEMENTATION_NOT_STARTED` — 해당 기능 코드 없음

---

## 1. Repository 현황 요약

### 1.1 핵심 경로
| 역할 | 경로 |
|------|------|
| DB 스키마 (Drizzle) | `lib/db/src/schema/` |
| API 서버 Migration | `artifacts/api-server/src/migrations/` |
| API 라우트 | `artifacts/api-server/src/routes/` |
| 앱 (Expo) | `artifacts/swim-app/app/` |
| 슈퍼어드민 화면 | `artifacts/swim-app/app/(super)/` |
| 웹 홈페이지 | `artifacts/swimnote-web/src/` |
| RevenueCat 클라이언트 | `artifacts/swim-app/lib/revenuecat.tsx` |
| AI 일지 파이프라인 | `artifacts/api-server/src/routes/ai-v1.ts` (추정), `teacher-diary` 관련 |
| 파일 업로드 | `artifacts/api-server/src/routes/uploads.ts`, `photos.ts`, `videos.ts` |
| Object Storage | `artifacts/api-server/src/lib/objectStorage.ts` |
| 푸시 알림 | `artifacts/api-server/src/lib/push-service.ts` |
| 구독 서비스 | `artifacts/api-server/src/lib/subscriptionService.ts` |
| RevenueCat Webhook | `artifacts/api-server/src/routes/billing.ts:121-435` |

---

## 2. V2.1과 실제 코드 차이

### 2.1 swimming_pools 테이블 `REPOSITORY_VERIFIED`
| V2.1 명세 | 실제 코드 | 상태 |
|-----------|----------|------|
| `xmode_status` TEXT enum 컬럼 | **없음** | ❌ 신규 추가 필요 |
| (없음) | `homepage_slug` TEXT | ✅ 이미 존재 |
| (없음) | `homepage_enabled` BOOLEAN DEFAULT false | ✅ 이미 존재 |
| (없음) | `subscription_status`, `subscription_tier`, `subscription_end_at` | ✅ 이미 존재 |

### 2.2 diary_templates 테이블 `DB_SCHEMA_VERIFIED`
| V2.1 명세 | 실제 코드 | 상태 |
|-----------|----------|------|
| `pool_id` | 실제 컬럼명은 **`swimming_pool_id`** (NOT NULL) | ⚠️ 컬럼명 수정 필요 |
| `is_hidden` BOOLEAN | **없음** | ❌ 신규 추가 필요 |
| `curriculum_item_id` TEXT | **없음** | ❌ 신규 추가 필요 |

**중요**: 기존 diary_templates는 `swimming_pool_id NOT NULL`이다. 히든 템플릿(pool_id=null)을 허용하려면 이 컬럼을 NULLABLE로 변경해야 한다.

### 2.3 신규 테이블 (전부 미존재) `IMPLEMENTATION_NOT_STARTED`
| 테이블 | 상태 |
|--------|------|
| `curriculum_items` | ❌ 없음 |
| `curriculum_progress` | ❌ 없음 |
| `growth_events` | ❌ 없음 |
| `pool_events` | ❌ 없음 |
| `curriculum_requests` | ❌ 없음 |
| `growth_report_entitlements` | ❌ 없음 |

### 2.4 RevenueCat 구조 `REPOSITORY_VERIFIED`
| V2.1 명세 | 실제 코드 |
|-----------|----------|
| X모드 150,000원 상품 | **없음** — `solo`, `center_monthly` offering만 존재 |
| x_mode entitlement | **없음** — `solo`, `center` entitlement만 존재 |
| Webhook 존재 | ✅ `POST /revenuecat-webhook` (`billing.ts:121`) |
| 구독 만료일 | ✅ `swimming_pools.subscription_end_at` |

---

## 3. 확인된 충돌

### 충돌 1: diary_templates.swimming_pool_id NOT NULL
- **문제**: 히든 템플릿은 pool_id=null이어야 하는데 현재 NOT NULL 제약
- **해결**: `ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id DROP NOT NULL`
- **영향**: 기존 일반 플랜 템플릿 검색에서 `WHERE swimming_pool_id = $poolId` 조건 반드시 유지 필요

### 충돌 2: RevenueCat entitlement 구조 없음
- **문제**: X모드용 entitlement/상품이 RevenueCat 대시보드에 없음
- **해결**: RevenueCat 대시보드에서 신규 상품 생성 후 webhook 핸들러에 분기 추가
- **영향**: `billing.ts`의 `RC_PRODUCT_TIER_MAP`에 xmode 상품 ID 매핑 추가 필요

### 충돌 3: 일지 테이블이 class_diaries + class_diary_student_notes 분리 구조
- **문제**: V2.1은 단일 diary_id 기준으로 growth_event를 생성한다고 설계했으나, 실제 일지는 `class_diaries`(공통) + `class_diary_student_notes`(학생별)로 분리됨
- **해결**: growth_event는 `class_diary_student_notes.id`를 diary_id로 사용 (학생별 note가 최종 저장 단위)
- **영향**: 일지 저장 완료 = student_note가 생성/확정되는 시점

---

## 4. 확정 가능한 부분 `REPOSITORY_VERIFIED`

1. **홈페이지 slug**: `swimming_pools.homepage_slug` + `homepage_enabled` 이미 존재. `GET /by-slug/:slug` API도 존재. → X모드 종료 시 `homepage_enabled = false`로 처리 가능 (slug 삭제 불필요)
2. **푸시 알림 인프라**: Expo push system 완비. `push_tokens` + `push_logs` + `notifications` 테이블 존재
3. **RevenueCat Webhook**: `POST /revenuecat-webhook` 동작 중. 기존 이벤트 처리 패턴 재사용 가능
4. **파일 업로드 인프라**: R2 Object Storage + uploads/photos/videos 라우트 존재. Presigned URL helper 존재
5. **슈퍼어드민 화면**: `(super)/` 디렉토리에 다수 화면 존재. 수영장별 inquiries 화면 이미 있음

---

## 5. 추가 결정이 필요한 부분

1. **PURCHASED 의미 확정**: 결제 유효 + 슈퍼어드민 승인 전 vs 결제 유효 + 슈퍼어드민 승인 완료
2. **curriculum_progress 집계 방식**: A안(growth_events 원본+매번 집계) vs B안(트랜잭션 캐시)
3. **커리큘럼 버전 관리**: A안(version 컬럼+soft delete) vs B안(별도 버전 테이블)
4. **무료 리포트 생성 기준**: 데이터 부족 임계값 (최소 일지 수, 최소 기간 등)
5. **pool_events 첨부파일**: JSONB vs 별도 테이블

---

## 6. 추천 최종 DB ERD (신규/변경 부분만)

```sql
-- [변경] diary_templates
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id DROP NOT NULL,  -- 히든 템플릿 허용
  ADD COLUMN is_hidden BOOLEAN DEFAULT FALSE,
  ADD COLUMN curriculum_item_id TEXT;           -- 연결 커리큘럼 (nullable)

-- [변경] swimming_pools
ALTER TABLE swimming_pools
  ADD COLUMN xmode_status TEXT DEFAULT 'OFF'
    CHECK (xmode_status IN ('OFF','PURCHASED','CURRICULUM_PENDING','ACTIVE'));
-- homepage_slug, homepage_enabled는 이미 존재

-- [신규] curriculum_requests: 커리큘럼 의뢰
CREATE TABLE curriculum_requests (
  id TEXT PRIMARY KEY DEFAULT ('cr_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','rejected','cancelled')),
  level_description TEXT,
  stroke_notes TEXT,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ,
  generating_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pool_id, status) WHERE status NOT IN ('completed','rejected','cancelled')
  -- 동시 활성 의뢰 1건 제한
);

-- [신규] curriculum_request_files: 의뢰 첨부파일
CREATE TABLE curriculum_request_files (
  id TEXT PRIMARY KEY DEFAULT ('crf_' || replace(gen_random_uuid()::text,'-','')),
  request_id TEXT NOT NULL REFERENCES curriculum_requests(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,   -- R2 Object key
  file_name TEXT NOT NULL,  -- 원본 파일명
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [신규] curriculum_items: 수영장 커리큘럼 항목
CREATE TABLE curriculum_items (
  id TEXT PRIMARY KEY DEFAULT ('ci_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
  level_number INTEGER NOT NULL,
  item_number INTEGER NOT NULL,
  stroke_code TEXT,
  skill_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,  -- soft delete
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [신규] curriculum_progress: 학생별 항목 완료 횟수 (캐시)
CREATE TABLE curriculum_progress (
  id TEXT PRIMARY KEY DEFAULT ('cp_' || replace(gen_random_uuid()::text,'-','')),
  student_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  curriculum_item_id TEXT NOT NULL REFERENCES curriculum_items(id),
  completion_count INTEGER DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, curriculum_item_id)
);

-- [신규] growth_events: 원본 이벤트
CREATE TABLE growth_events (
  id TEXT PRIMARY KEY DEFAULT ('ge_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  diary_note_id TEXT,               -- class_diary_student_notes.id (nullable: 수동 등록)
  curriculum_item_id TEXT REFERENCES curriculum_items(id),
  stroke_code TEXT,
  observation_type TEXT,
  observation_text TEXT,
  change_direction TEXT,
  confidence NUMERIC,
  source TEXT DEFAULT 'teacher_ai'
    CHECK (source IN ('teacher_ai','teacher_manual','parent_ai','video_ai')),
  is_invalidated BOOLEAN DEFAULT FALSE,  -- 일지 삭제 시 무효화
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (diary_note_id, student_id, curriculum_item_id, source)
  -- 멱등성: 같은 note+item+source 중복 방지
);

-- [신규] pool_events: 수영장별 이벤트 알림함
CREATE TABLE pool_events (
  id TEXT PRIMARY KEY DEFAULT ('pe_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL REFERENCES swimming_pools(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'new_signup','xmode_signup','cancel','inquiry',
      'file_submit','domain_release','reply','system'
    )),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('super_admin','pool_admin')),
  sender_id TEXT,
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  requires_action BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [신규] pool_event_attachments: 이벤트 첨부파일 (JSONB 대신 별도 테이블)
CREATE TABLE pool_event_attachments (
  id TEXT PRIMARY KEY DEFAULT ('pea_' || replace(gen_random_uuid()::text,'-','')),
  event_id TEXT NOT NULL REFERENCES pool_events(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [신규] growth_report_entitlements: 무료 리포트 지급권
CREATE TABLE growth_report_entitlements (
  id TEXT PRIMARY KEY DEFAULT ('gre_' || replace(gen_random_uuid()::text,'-','')),
  pool_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  report_month TEXT NOT NULL,  -- 'YYYY-MM' (Asia/Seoul 기준)
  report_type TEXT NOT NULL CHECK (report_type IN ('basic','deep')),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','generating','completed','failed','insufficient_data')),
  generated_report_id TEXT,
  reserved_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, report_month, report_type)
  -- 동일 학생+월+타입 중복 방지
);
```

---

## 7. 상태 전이표

### 7.1 xmode_status 전이
| From | To | 트리거 | 주체 |
|------|-----|--------|------|
| OFF | PURCHASED | RevenueCat webhook INITIAL_PURCHASE (xmode 상품) | 자동 |
| PURCHASED | CURRICULUM_PENDING | 수영장이 커리큘럼 의뢰 제출 | pool_admin |
| CURRICULUM_PENDING | ACTIVE | 슈퍼어드민 완료 처리 | super_admin |
| CURRICULUM_PENDING | PURCHASED | 슈퍼어드민 반려 또는 수영장 취소 | super_admin / pool_admin |
| 모든 상태 | OFF | RevenueCat webhook EXPIRATION/CANCELLATION | 자동 |

**금지 전환**: PURCHASED → ACTIVE (커리큘럼 없이 직행 불가), OFF → CURRICULUM_PENDING, OFF → ACTIVE

### 7.2 curriculum_request.status 전이
| From | To | 트리거 |
|------|-----|--------|
| (없음) | pending | 수영장 제출 |
| pending | in_progress | 슈퍼어드민 검토 시작 |
| in_progress | completed | GPT 생성 완료 → 슈퍼어드민 처리 |
| pending / in_progress | rejected | 슈퍼어드민 반려 |
| pending | cancelled | 수영장 취소 |

### 7.3 결제 상태 (xmode_subscriptions) — A안 권장

**권장: A안** — RevenueCat entitlement가 결제 원본, `swimming_pools.xmode_status`는 교육 준비 상태만 저장

이유:
- 기존 `subscription_status`, `subscription_end_at` 패턴과 동일
- 별도 xmode_subscriptions 테이블 불필요
- webhook 핸들러에 xmode 분기만 추가하면 됨

**추가 필요 컬럼** (`swimming_pools`):
```sql
ALTER TABLE swimming_pools
  ADD COLUMN xmode_subscription_end_at TIMESTAMPTZ,
  ADD COLUMN xmode_purchased_at TIMESTAMPTZ;
```

**PURCHASED 의미 확정**: 결제 유효 + 의뢰 전
- 슈퍼어드민 별도 승인 불필요 (결제 즉시 PURCHASED)
- APPROVAL_PENDING 단계 불필요

---

## 8. API 목록 및 Request/Response Contract `CONTRACT_DESIGNED`

### 8.1 X모드 상태
```
GET  /api/v1/pools/:poolId/xmode/status
  → { xmode_status, xmode_subscription_end_at, curriculum_request_status }

PATCH /api/v1/admin/pools/:poolId/xmode/status (super_admin only)
  Body: { status: 'ACTIVE' | 'PURCHASED' | 'OFF' }
```

### 8.2 커리큘럼 의뢰
```
POST   /api/v1/pools/:poolId/curriculum-request
  Body: { level_description, stroke_notes }
  → { request_id, status: 'pending' }

GET    /api/v1/pools/:poolId/curriculum-request
  → { id, status, submitted_at, files[] }

DELETE /api/v1/pools/:poolId/curriculum-request/:id  (취소)

POST   /api/v1/curriculum-request/:id/files  (파일 업로드)
  multipart/form-data

GET    /api/v1/admin/curriculum-requests  (super_admin)
  → [{ pool_id, pool_name, status, submitted_at, file_count }]

PATCH  /api/v1/admin/curriculum-request/:id  (super_admin)
  Body: { action: 'approve' | 'reject', rejection_reason? }
```

### 8.3 성장판
```
GET /api/v1/pools/:poolId/students/:studentId/growth-progress
  → { items: [{ curriculum_item_id, skill_name, count, completed }], percentage }
```

### 8.4 이벤트 알림함
```
GET  /api/v1/admin/pools/:poolId/events
  → [{ id, event_type, sender_role, message, attachments[], created_at, is_read }]

POST /api/v1/admin/pools/:poolId/events  (메시지 발송)
  multipart/form-data (message + files)

GET  /api/v1/pools/:poolId/events  (pool_admin용)
PATCH /api/v1/pools/:poolId/events/:id/read
```

### 8.5 성장 리포트
```
GET  /api/v1/pools/:poolId/students/:studentId/report-entitlement
  → { available: bool, report_month, status }

POST /api/v1/pools/:poolId/students/:studentId/report/basic
  → { report_id, status: 'generating' | 'insufficient_data' }

GET  /api/v1/pools/:poolId/students/:studentId/report/:reportId
  → { status, content?, generated_at }
```

---

## 9. 권한표 `CONTRACT_DESIGNED`

| 작업 | super_admin | pool_admin | teacher | parent |
|------|------------|------------|---------|--------|
| X모드 결제 (RevenueCat) | — | ✅ | ❌ | ❌ |
| xmode_status 조회 | ✅ | ✅ | ✅ | ✅ |
| xmode_status 강제 변경 | ✅ | ❌ | ❌ | ❌ |
| 커리큘럼 의뢰 제출 | ❌ | ✅ | ❌ | ❌ |
| 의뢰 취소 | ❌ | ✅(자신) | ❌ | ❌ |
| 의뢰 파일 업로드 | ❌ | ✅ | ❌ | ❌ |
| 의뢰 파일 다운로드 | ✅ | ✅(자신) | ❌ | ❌ |
| 의뢰 승인/반려 | ✅ | ❌ | ❌ | ❌ |
| ACTIVE 전환 | ✅ | ❌ | ❌ | ❌ |
| 성장판 조회 | ✅ | ✅ | ✅ | ✅(자녀) |
| 무료 리포트 생성 | — | — | — | ✅(자녀) |
| 심층 리포트 구매 | — | — | — | ✅(자녀) |
| pool_events 읽기 | ✅ | ✅(자신) | ❌ | ❌ |
| pool_events 답장 | ✅ | ✅(자신) | ❌ | ❌ |
| 홈페이지 SUSPEND | ✅ | ❌ | ❌ | ❌ |

**IDOR 방지**: 모든 API에서 `pool_id`를 body만 신뢰하지 않고 JWT의 `swimming_pool_id`와 일치 여부 검증 필수

---

## 10. AI Pipeline 변경 지점 `REPOSITORY_VERIFIED`

### 현재 구조
- 진입: `artifacts/api-server/src/routes/ai-v1.ts` (또는 teacher-diary 관련 라우트)
- 템플릿 검색: `diary-template-search` 함수에서 `swimming_pool_id = $poolId` 조건으로 검색
- 모드 결정: 검색 결과 없거나 유사도 미달 → INPUT_ONLY

### 변경 지점 (최소 변경 원칙)
```typescript
// 기존 코드 앞에 분기만 추가
function getTemplateSearchScope(poolId: string, xmodeStatus: string) {
  if (xmodeStatus === 'ACTIVE') {
    return { poolId, includeHidden: true, priority: 'pool_first' };
  }
  if (xmodeStatus === 'CURRICULUM_PENDING') {
    return { poolId: null, includeHidden: true, priority: 'hidden_only' };
  }
  return { poolId, includeHidden: false, priority: 'pool_only' };
}
```

### 검색 우선순위 쿼리 설계
```sql
-- ACTIVE 상태: pool_first (2단계 검색)
-- 1단계: 수영장 전용
SELECT *, similarity(template_text, $input) AS score
FROM diary_templates
WHERE swimming_pool_id = $poolId AND is_hidden = false AND is_active = true
ORDER BY score DESC LIMIT 5;

-- 1단계 결과가 threshold 미달이면 2단계: hidden으로 보완
SELECT *, similarity(template_text, $input) AS score
FROM diary_templates
WHERE swimming_pool_id IS NULL AND is_hidden = true AND is_active = true
ORDER BY score DESC LIMIT 5;
```

### 학부모 AI 검색 (별도 분리)
- AI 일지 검색과 완전히 다른 경로
- `curriculum_items` 테이블 기반 검색
- Hidden diary_templates 사용 금지

---

## 11. 일지 저장 → 성장판 Sequence `CONTRACT_DESIGNED`

```
[교사] AI 일지 생성 (미리보기)
  ↓
  → growth_event 생성 안 함 (preview 단계)
  
[교사] 최종 저장 확정 (class_diary_student_notes INSERT)
  ↓
  → diary_note_id = class_diary_student_notes.id
  → INSERT INTO growth_events (diary_note_id, student_id, curriculum_item_id, source='teacher_ai')
      ON CONFLICT (diary_note_id, student_id, curriculum_item_id, source) DO NOTHING  -- 멱등성
  ↓
  → UPDATE curriculum_progress SET completion_count = completion_count + 1
      WHERE student_id = $sid AND curriculum_item_id = $cid
      (트랜잭션으로 growth_event INSERT와 묶음)

[교사] 일지 수정 (curriculum_item 변경 없음)
  → growth_event 변경 없음

[교사] 일지 수정 (curriculum_item 변경 있음)
  → 기존 growth_event is_invalidated = true
  → curriculum_progress 재계산
  → 신규 growth_event INSERT

[교사] 일지 삭제
  → growth_event is_invalidated = true
  → curriculum_progress.completion_count 재계산 (유효한 event만)
```

---

## 12. 결제 → X모드 활성 Sequence `CONTRACT_DESIGNED`

```
[학부모/관리자] RevenueCat X모드 상품 구매
  ↓
RevenueCat → INITIAL_PURCHASE webhook → billing.ts
  ↓
  → swimming_pools SET
      xmode_status = 'PURCHASED',
      xmode_purchased_at = NOW(),
      xmode_subscription_end_at = expiration_at
  ↓
  → pool_events INSERT (event_type='xmode_signup') → 슈퍼어드민 즉시 푸시
  ↓
  → 앱: Pool Context refresh (foreground 복귀 시 또는 push 수신 시)

[결제 만료/취소] RevenueCat → EXPIRATION webhook
  ↓
  → swimming_pools SET xmode_status = 'OFF'
  ↓
  → homepage_enabled = false (slug는 유지)
  ↓
  → pool_events INSERT (event_type='domain_release') → 슈퍼어드민 즉시 푸시
  ↓
  → 앱: 즉시 일반 플랜 UI 전환
```

---

## 13. 커리큘럼 의뢰 Sequence `CONTRACT_DESIGNED`

```
[pool_admin] 앱 설정 → X모드 탭 → [커리큘럼 제작 의뢰]
  ↓
POST /pools/:id/curriculum-request (level_description, stroke_notes)
  ↓
  → curriculum_requests INSERT (status='pending')
  ↓
  → pool_events INSERT (event_type='file_submit') → 슈퍼어드민 즉시 푸시

[pool_admin] 파일 업로드
POST /curriculum-request/:id/files
  ↓
  → R2 업로드 → curriculum_request_files INSERT
  ↓
  → xmode_status = 'CURRICULUM_PENDING'

[super_admin] 슈퍼어드민에서 파일 확인 → GPT 생성 → DB 삽입
  ↓
PATCH /admin/curriculum-request/:id { action: 'approve' }
  ↓
  → curriculum_requests SET status='completed'
  ↓
  → swimming_pools SET xmode_status = 'ACTIVE'
  ↓
  → 수영장 관리자에게 푸시 알림

[super_admin] 반려
PATCH /admin/curriculum-request/:id { action: 'reject', rejection_reason }
  ↓
  → curriculum_requests SET status='rejected'
  ↓
  → swimming_pools SET xmode_status = 'PURCHASED' (복귀)
```

---

## 14. 무료·유료 리포트 Sequence `CONTRACT_DESIGNED`

### 14.1 무료 기본 리포트 (학생 1명당 월 1회)
```
[학부모] 리포트 탭 접근
  ↓
GET /students/:id/report-entitlement?month=2026-08
  ↓
  → growth_report_entitlements 조회 (student_id + report_month + type='basic')
  ↓
  → 없으면: 데이터 충분성 검사
    - 최소 유효 일지 수 ≥ 5건 (추천값, 추후 확정)
    - 최소 기간 ≥ 7일
    - 최소 growth_event ≥ 3건
  ↓
  → 부족하면: "분석 가능한 데이터가 부족합니다" 반환
  ↓
  → 충분하면: INSERT growth_report_entitlements (status='generating')
  → GPT 생성 → status='completed'
  → 실패 시 status='failed' (재시도 가능, 재결제 불필요)
```

### 14.2 유료 심층 리포트 (29,000원)
```
[학부모] RevenueCat consumable 상품 결제
  ↓
webhook 또는 앱 직접 검증
  ↓
INSERT growth_report_entitlements (type='deep', status='generating')
  ↓
GPT 생성 (130항목)
  ↓
status='completed'
  ↓
실패 시: status='GENERATION_FAILED' → 재시도 가능 (재결제 불필요)
```

**데이터 부족 기준 후보** (추천값, 확정 필요):
| 기준 | 추천값 | 이유 |
|------|-------|------|
| 최소 유효 일지 수 | 5건 | 통계 의미 최소 단위 |
| 최소 관찰 기간 | 7일 | 단기 스냅샷 방지 |
| 최소 growth_event | 3건 | 커리큘럼 연결 최소값 |
| 최소 출결 데이터 | 2회 | 수업 참여 확인 |

---

## 15. 파일 업로드 구조 `REPOSITORY_VERIFIED`

### 현재 인프라
- R2 Object Storage (`artifacts/api-server/src/lib/objectStorage.ts`)
- 업로드 라우트: `uploads.ts` (10MB/파일, 5파일), `photos.ts` (8MB), `videos.ts` (100MB)
- Presigned URL GET helper 존재 (`getPresignedUrl`)

### X모드용 신규 업로드 라우트 설계
```
POST /api/v1/curriculum-request/:id/files
POST /api/v1/pools/:poolId/events/:eventId/files

허용 확장자: jpg, jpeg, png, gif, webp, heic, bmp, pdf, doc, docx,
             xls, xlsx, ppt, pptx, txt, csv, mp4, mov, zip
파일당 최대 크기: 50MB (커리큘럼 파일 특성상 문서가 많음)
요청당 최대 파일 수: 10개
MIME type 검증: Content-Type 헤더 + 확장자 cross-check
R2 Key 패턴: x-mode/{poolId}/{requestId}/{uuid}.{ext}  ← 원본 파일명과 분리
```

### 보안 설계
- 원본 파일명 → DB 저장 (`file_name`), R2 key는 UUID 사용
- 다운로드 시 presigned URL (1시간 만료) 반환
- pool_admin은 자신의 pool 파일만 접근
- super_admin은 전체 접근
- X모드 종료 후 파일 보존 (삭제 금지), 단 신규 업로드 차단

### pool_event_attachments 별도 테이블 선택 이유
- 메시지 삭제 시 CASCADE로 파일 레코드 정리 가능
- 파일별 개별 다운로드 URL 생성 가능
- JSONB보다 정렬/검색 유리

---

## 16. Migration 계획 `CONTRACT_DESIGNED`

### 원칙
- 모든 기존 수영장 → `xmode_status = 'OFF'` (DEFAULT)
- 기존 diary_templates → `is_hidden = false`, `swimming_pool_id` nullable 허용
- 기존 일반 플랜 동작 완전히 동일하게 유지

### 실행 순서
```sql
-- Step 1: swimming_pools 변경 (safe, DEFAULT 있음)
ALTER TABLE swimming_pools
  ADD COLUMN xmode_status TEXT NOT NULL DEFAULT 'OFF'
    CHECK (xmode_status IN ('OFF','PURCHASED','CURRICULUM_PENDING','ACTIVE')),
  ADD COLUMN xmode_subscription_end_at TIMESTAMPTZ,
  ADD COLUMN xmode_purchased_at TIMESTAMPTZ;

-- Step 2: diary_templates 변경
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id DROP NOT NULL,
  ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN curriculum_item_id TEXT;
-- 기존 레코드: swimming_pool_id 값 유지, is_hidden=false 자동 적용

-- Step 3: 신규 테이블 생성 (기존 데이터 영향 없음)
CREATE TABLE curriculum_requests (...);
CREATE TABLE curriculum_request_files (...);
CREATE TABLE curriculum_items (...);
CREATE TABLE curriculum_progress (...);
CREATE TABLE growth_events (...);
CREATE TABLE pool_events (...);
CREATE TABLE pool_event_attachments (...);
CREATE TABLE growth_report_entitlements (...);

-- Step 4: 인덱스 (CONCURRENTLY로 lock 없이)
CREATE INDEX CONCURRENTLY idx_diary_templates_hidden
  ON diary_templates (is_hidden) WHERE is_hidden = true;
CREATE INDEX CONCURRENTLY idx_curriculum_items_pool
  ON curriculum_items (pool_id);
CREATE INDEX CONCURRENTLY idx_growth_events_student
  ON growth_events (student_id, pool_id);
CREATE INDEX CONCURRENTLY idx_pool_events_pool
  ON pool_events (pool_id, created_at DESC);
```

### Rollback 방법
```sql
-- 신규 컬럼 제거 (데이터 손실 없음)
ALTER TABLE swimming_pools
  DROP COLUMN IF EXISTS xmode_status,
  DROP COLUMN IF EXISTS xmode_subscription_end_at,
  DROP COLUMN IF EXISTS xmode_purchased_at;

ALTER TABLE diary_templates
  DROP COLUMN IF EXISTS is_hidden,
  DROP COLUMN IF EXISTS curriculum_item_id;
-- swimming_pool_id NOT NULL은 기존 데이터에 null이 없으므로 복구 가능
ALTER TABLE diary_templates
  ALTER COLUMN swimming_pool_id SET NOT NULL;

-- 신규 테이블 DROP
DROP TABLE IF EXISTS growth_report_entitlements, pool_event_attachments,
  pool_events, growth_events, curriculum_progress, curriculum_items,
  curriculum_request_files, curriculum_requests;
```

---

## 17. X모드 UI 즉시 반영 구조 `REPOSITORY_VERIFIED`

### 현재 구조
- RevenueCat: `SubscriptionProvider` + React Query 메모리 상태
- JWT: `withdrawing` 플래그 있으나 구독 상태 미포함
- 앱 foreground 복귀 시: `billing.tsx:218` pull-to-refresh에서 `refetchCustomerInfo()` 존재

### 권장 방식: B안 (Pool Context refresh) + C안 (Push 수신 후 refresh) 결합

```
xmode_status 변경 시
  → 서버 푸시 발송 (data-only push)
  → 앱에서 AppState 'active' 또는 push 수신 시 pool 정보 재조회
  → Pool Context 갱신 → UI 즉시 반영
```

- JWT 재발급 불필요 (pool 정보는 별도 API 조회)
- 일반/X모드 중간 상태 방지: 로딩 스피너로 전환 완료 대기

---

## 18. 홈페이지 slug X모드 종료 처리 `REPOSITORY_VERIFIED`

### 현재 구조
- `swimming_pools.homepage_slug` (unique partial index)
- `swimming_pools.homepage_enabled` (boolean)
- `GET /by-slug/:slug`: `WHERE homepage_slug=$slug AND homepage_enabled=TRUE`

### X모드 종료 처리
- slug 삭제 금지 (SEO, URL 보존)
- `homepage_enabled = false`로만 처리 → 자동으로 404
- xmode_status = OFF 시 자동으로 `homepage_enabled = false` 처리 가능
- pool_events에 'domain_release' 이벤트 기록 + 슈퍼어드민 푸시

**homepage_status 별도 컬럼 불필요**: `homepage_enabled`로 충분히 SUSPENDED 표현 가능

---

## 19. Phase/WP 실행 순서 (의존성 반영) `CONTRACT_DESIGNED`

```
Phase 1: DB Migration (기반)
  - swimming_pools xmode 컬럼 추가
  - diary_templates 컬럼 변경
  - 신규 테이블 8개 생성
  - 인덱스 생성
  완료 조건: Migration 실행 성공, 기존 기능 동일 동작

Phase 2: RevenueCat X모드 상품 등록
  - RevenueCat 대시보드에서 xmode_monthly 상품 생성
  - billing.ts webhook 핸들러에 xmode 분기 추가
  - applyXmodeSubscriptionState() 함수 추가
  완료 조건: webhook 테스트 성공

Phase 3: X모드 상태 API + 슈퍼어드민 백엔드
  - GET/PATCH xmode status API
  - 커리큘럼 의뢰 CRUD API
  - pool_events CRUD API
  완료 조건: API 테스트 성공

Phase 4: 슈퍼어드민 앱 화면
  - (super)/pools.tsx에 X모드 탭 추가
  - 수영장 상세 모달 X모드 정보/토글
  - 이벤트 알림함 대화창 UI
  - 파일 업로드/다운로드
  완료 조건: 슈퍼어드민으로 X모드 ON 가능

Phase 5: 히든 템플릿 2,000개 생성
  - 영법별/레벨별 구조 설계
  - GPT 배치 생성 스크립트
  - DB 삽입 (is_hidden=true, swimming_pool_id=null)
  완료 조건: 2,000개 삽입 확인

Phase 6: AI 파이프라인 분기
  - template search에 xmode_status별 scope 파라미터 추가
  - ACTIVE: pool_first + hidden 보완
  - CURRICULUM_PENDING: hidden_only
  - OFF/PURCHASED: pool_only
  완료 조건: 3가지 상태 각각 템플릿 검색 동작 확인

Phase 7: 앱 수영장 설정 X모드 탭
  - 커리큘럼 의뢰 폼
  - 의뢰 상태 확인
  - 파일 업로드
  완료 조건: 의뢰 제출 → 슈퍼어드민 알림 수신

Phase 8: 앱 X모드 UI (선생님/학부모)
  - 선생님: AI 일지 품질 차이 UI
  - 학부모: 수영 성장판
  - 학부모: AI 검색 분기 메시지
  - 학부모: 기본 리포트 화면
  완료 조건: 샘플 수영장에서 전체 흐름 확인

Phase 9: 성장 이벤트 연동
  - 일지 저장 → growth_event 생성
  - 일지 삭제 → growth_event 무효화
  - curriculum_progress 갱신
  완료 조건: 일지 2회 저장 후 성장판 % 증가 확인

Phase 10: 무료 리포트 생성
  - growth_report_entitlements 지급권 관리
  - 데이터 충분성 검사
  - 기본 리포트 50항목 생성
  완료 조건: 학부모 앱에서 리포트 확인

Phase 11: 샘플 수영장 E2E 검증
Phase 12: 심층 리포트 (별도)
Phase 13: 토이키즈 → 전국 배포
```

---

## 20. 기존보다 단순한 대안 제안

### 단순화안 A: curriculum_progress 제거
- growth_events에서 매번 COUNT 집계
- 장점: 테이블 1개 감소, 데이터 일관성 100%
- 단점: 학생 수 많아지면 성능 이슈 가능
- **권장**: 초기엔 집계 방식, 성능 이슈 시 캐시 추가

### 단순화안 B: pool_events를 기존 notifications 재활용
- 기존 `notifications` 테이블에 sender/reply 구조 추가
- 장점: 신규 테이블 1개 감소
- 단점: 양방향 대화창 구조 억지 적용, 첨부파일 연결 복잡
- **비권장**: 용도가 다름

### 단순화안 C: Homepage Phase 분리
- X모드 Phase에서 홈페이지 활성화/비활성화만 처리
- 홈페이지 콘텐츠 편집은 별도 Phase
- **권장**: 이미 homepage_enabled/slug가 존재하므로 X모드 종료 연동만 Phase 1에 포함

---

## 검증 등급 최종 요약

| 항목 | 등급 |
|------|------|
| swimming_pools 스키마 | `REPOSITORY_VERIFIED` |
| diary_templates 스키마 | `DB_SCHEMA_VERIFIED` |
| RevenueCat entitlement/webhook | `REPOSITORY_VERIFIED` |
| 파일 업로드 인프라 | `REPOSITORY_VERIFIED` |
| 슈퍼어드민 화면 위치 | `REPOSITORY_VERIFIED` |
| 푸시 알림 인프라 | `REPOSITORY_VERIFIED` |
| 홈페이지 slug 구조 | `REPOSITORY_VERIFIED` |
| AI 파이프라인 진입점 | `REPOSITORY_VERIFIED` |
| X모드 신규 컬럼/테이블 | `CONTRACT_DESIGNED` |
| API Contract | `CONTRACT_DESIGNED` |
| Sequence Diagram | `CONTRACT_DESIGNED` |
| 코드 구현 | `IMPLEMENTATION_NOT_STARTED` |
