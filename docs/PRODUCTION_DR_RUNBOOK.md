# PRODUCTION DR RUNBOOK — SWIMNOTE 2.0.x
# Last updated: 2026-09-07 (WP18)

> **절대 포함 금지: 비밀번호, JWT_SECRET, API key, DB 비밀번호, R2 credential 값**
> 이 문서는 repo에 커밋됩니다. 값은 Render Secret / Supabase dashboard에만 보관.

---

## 0. 환경 식별자

| 항목 | 식별자 / 위치 |
|---|---|
| Production DB | Supabase ref `mrgkiussgbbmxfnkjgqy` (ap-south-1) |
| Staging DB | Supabase ref `lspmacdbyvpzysnrjsww` (ap-northeast-2) |
| APP API Production | `swimnote-api.onrender.com` |
| AI Engine | `swimnote-professional-engine.onrender.com` |
| Photo R2 bucket | `swimnotepicture` |
| Video R2 bucket | `swimnotevideo` |
| R2 Account | Cloudflare account (CF_ACCOUNT_ID in env) |
| GitHub repo | `swimnote/swimnote` |
| Release branch | `release/v2.0.0` |
| Client version | 2.0.1 / runtimeVersion 2.1.0 / buildNumber 256 |
| EAS OTA channel | `production-v2` |

---

## 1. 절대 금지 (NEVER DO)

- Production DB mutation (INSERT/UPDATE/DELETE) 장애 조사 중 금지
- Production R2 object 삭제/변경 복구 목적 직접 작업 금지
- Production에서 PITR 실행 금지 (데이터 손실 위험)
- 복구 전 Render Production deploy 금지 (스키마 호환성 확인 전)
- backup dump 파일을 repo commit / Replit workspace에 장기 저장 금지
- 다른 pool의 데이터를 staging에 dump 금지

---

## 2. 인시던트 선언 체크리스트

```
□ 인시던트 시각 기록
□ 영향 범위 확인 (API 전체 / 특정 pool / 특정 기능)
□ 원인 카테고리 판단 (DB / API / R2 / Client / Network)
□ 쓰기 차단 필요 여부 결정
□ Render health endpoint 확인: GET /api/health
□ Production DB 접속 가능 여부 확인 (Supabase dashboard)
□ 팀 내 인시던트 담당자 지정
```

---

## 3. 복구 순서 (RECOVERY ORDER)

```
STEP 1  인시던트 선언 / 쓰기 중단 결정
STEP 2  DB 상태 판단 (접속 가능 / 불가 / 데이터 오염)
STEP 3  DB restore / PITR (필요 시, Supabase console)
STEP 4  schema / migration 호환성 확인
STEP 5  APP server known-good SHA 복구 (Render → Manual Deploy)
STEP 6  AI Engine known-good SHA 확인 (필요 시 rollback)
STEP 7  R2 object 가용성 확인 (presigned URL 응답 확인)
STEP 8  DB ↔ media relation smoke
STEP 9  Auth / 풀 tenant smoke
STEP 10 Teacher / Parent / Admin core smoke
STEP 11 쓰기 재개
STEP 12 인시던트 audit 기록
```

---

## 4. DB 복구 절차

### 4-A. Supabase Automatic Backup 복구

```
1. Supabase dashboard → project mrgkiussgbbmxfnkjgqy → Backups
2. 복구 시점 선택 (provider 제공 retention period 이내)
3. Restore 대상: 현재 project 또는 새 project (isolated restore 권장)
4. 복구 완료 후 app server 재기동 전 schema 버전 확인
```

> **HOLD_EXTERNAL_CONFIG**: 실제 retention period, PITR 활성화 여부는
> Supabase dashboard 접근이 필요합니다. Console 없이 UNKNOWN.

### 4-B. PITR 복구 (활성화된 경우)

```
Supabase dashboard → project → Backups → Point in Time Recovery
복구 시점(UTC): YYYY-MM-DDTHH:MM:SSZ
대상: 별도 isolated project 생성 후 복구 (Production 직접 복구 금지)
```

### 4-C. Schema-only 복구 (데이터 오염 없이 스키마만 필요한 경우)

```
1. git clone swimnote/swimnote
2. APP API startup: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS 멱등 실행
3. migrations/ SQL 파일 순서대로 적용 (날짜순)
4. src/migrations/*.ts 스크립트 순서대로 실행
```

---

## 5. APP Server 롤백

```
Current Production SHA: 7bc86267
Known-good previous SHA: d16d62ee

Rollback 방법:
  Render dashboard → swimnote-api → Events → 이전 deploy 선택 → Rollback
  또는: git revert + push → 자동 빌드

주의: DB schema 변경 포함 배포라면 rollback 전 DB 호환성 확인 필수
```

### DB 호환성 분류 (최근 migration 기준)

| Migration | 유형 | 롤백 방법 |
|---|---|---|
| `2026-09-05-notice-unified-schema.sql` | ADDITIVE | app rollback만으로 가능 |
| `2026-09-05-official-plan-catalog.sql` | ADDITIVE | app rollback만으로 가능 |
| `2026-09-05-push-fanout-queue.sql` | ADDITIVE | app rollback만으로 가능 |
| `2026-09-05-subscription-plans-nullable.sql` | MODIFY (DROP NOT NULL) | app rollback만으로 가능 (backward compatible) |
| `2026-09-05-x-management-override.sql` | ADDITIVE | app rollback만으로 가능 |
| `2026-09-05-x-trial-columns.sql` | ADDITIVE | app rollback만으로 가능 |
| `wp2b-x-trial.ts` | DROP INDEX (DOWN 있음) | DB restore 필요 |
| `wp2a-plans-and-storage.ts` | 일부 DELETE + INSERT | DB restore 필요할 수 있음 |

---

## 6. AI Engine 롤백

```
Current SHA: GitHub swimnote repo latest (UNKNOWN — separate deploy env)
Rollback method: Render dashboard → swimnote-professional-engine → rollback

장애 격리: AI Engine 장애는 교사 일지 생성(grounded AI) 기능만 영향.
legacy fallback 경로는 코드에 존재하지 않으므로 feature 비활성화 결정 필요.
```

---

## 7. R2 Object Storage 복구

### 버킷 구성

| 버킷 | 용도 | 키 환경변수 |
|---|---|---|
| `swimnotepicture` | 수업 사진, 프로필 | CF_R2_ACCESS_KEY_ID / CF_R2_SECRET_ACCESS_KEY |
| `swimnotevideo` | 수업 영상 | CF_R2_VIDEO_ACCESS_KEY_ID / CF_R2_VIDEO_SECRET_ACCESS_KEY |

### R2 복구 판단

```
CASE A — DB 복구됐으나 R2 object 존재:
  → DB object_key 컬럼이 R2 키를 가리킴. DB relation 복구 후 즉시 접근 가능.

CASE B — DB relation 존재하나 R2 object 없음:
  → 앱: Image onError → null/fallback (crash 없음 — null 안전 처리 확인됨)
  → server: getPresignedUrl 실패 → 앱 graceful degradation
  → 해당 media row를 media_status='error' 또는 'orphan'으로 표시

CASE C — R2 object 존재하나 DB relation 없음:
  → orphan object — 서비스 영향 없음
  → POST /diaries/repair-orphan-media 엔드포인트로 DB 복구 가능 (pool_admin 권한)
  → 정기 orphan sweep 별도 도구 없음 — 수동 SQL로 확인
```

### R2 삭제 안전성

```
클라이언트 직접 삭제: 불가 (presigned DELETE 발급 없음)
삭제 경로: 서버 라우트 전용
  DELETE /videos/:videoId  (teacher/pool_admin 권한)
  DELETE /videos/bulk      (pool_admin 권한)
  DELETE /videos/saved     (teacher 권한)
  media 삭제: diary.ts repair-orphan-media 또는 내부 cleanup
```

---

## 8. 복구 후 Smoke Test

```
T1  DB connection:  GET /api/health → {"ok":true}
T2  Schema:         Supabase dashboard → Table Editor → critical tables 존재 확인
T3  Pool query:     SELECT id FROM swimming_pools LIMIT 1 (Supabase SQL Editor)
T4  Student:        GET /api/students (teacher 토큰)
T5  Diary:          GET /api/diaries?date=YYYY-MM-DD (teacher 토큰)
T6  Parent:         GET /api/parent/students (parent 토큰)
T7  Media:          GET /api/media/common?date=YYYY-MM-DD → presigned_url 포함
T8  Auth smoke:     POST /api/auth/refresh → 200
T9  Cross-pool:     teacher A 토큰으로 pool B 데이터 접근 → 401/403 확인
T10 Health:         GET /api/health → uptime > 0
```

---

## 9. Config / Secrets 복구 목록

> **값 포함 금지** — 위치만 기록

| Secret | 저장 위치 | 비고 |
|---|---|---|
| SUPABASE_DATABASE_URL | Render Env / Supabase dashboard | DB 연결 |
| POOL_DATABASE_URL | Render Env | pool 전용 DB |
| JWT_SECRET | Render Env | 토큰 서명 |
| SESSION_SECRET | Render Env | 세션 암호화 |
| CF_R2_ACCESS_KEY_ID | Render Env | photo R2 |
| CF_R2_SECRET_ACCESS_KEY | Render Env | photo R2 |
| CF_R2_VIDEO_ACCESS_KEY_ID | Render Env | video R2 |
| CF_R2_VIDEO_SECRET_ACCESS_KEY | Render Env | video R2 |
| NAVER_SENS_* | Render Env | SMS 발송 |
| REVENUECAT_SECRET_API_KEY | Render Env | 구독 검증 |
| REVENUECAT_WEBHOOK_SECRET | Render Env | webhook 서명 |
| OPENAI_API_KEY | AI Engine Render Env | GPT 호출 |
| PROFESSIONAL_ENGINE_API_SECRET | Render Env | Engine 서버간 인증 |
| EXPO_TOKEN | Replit Secret | OTA 업로드 |
| MATCH_TOKEN_SECRET | Render Env | 매칭 토큰 |
| SUPER_ADMIN_PASSWORD | Render Env | 슈퍼 어드민 |

**Secrets hardcoded in repo: NO** (모든 key는 환경변수로 주입)

---

## 10. ESCALATION / HOLD POINTS

```
HOLD_EXTERNAL_CONFIG: Supabase backup retention / PITR 설정 확인 필요
  → Supabase dashboard → project → Backups 탭에서 직접 확인

HOLD_FOR_APPROVAL: Production DB에 write 작업 필요한 경우
  → 팀 리더 승인 후 진행

HOLD_FOR_APPROVAL: Production R2 object 삭제 필요한 경우
  → 영향 범위 문서화 후 승인

HOLD_FOR_APPROVAL: Production Render deploy (schema 변경 포함)
  → migration 호환성 확인 + 테스트 통과 후 승인
```

---

## 11. DB Failover 동작

```
DB 접속 불가 시:
  API startup → process.exit(1) (fail closed)
  setServerReady() 미호출 → /api/health 503 유지
  Render health check 실패 → 자동 재시작 (crash loop 아님 — 환경 문제)

DB 접속 가능 후:
  Render restart → 자동 복구
  idempotent migration (IF NOT EXISTS) → 안전 재실행

요청 중 DB 오류:
  route catch block → 500 반환
  데이터 손상 없음 (트랜잭션 rollback)
```

---

*이 문서는 WP18 DR finalization 시 작성됨. 장애 발생 후 업데이트 권장.*

---

## 12. SYNTHETIC RESTORE REHEARSAL 결과 (WP18-B)

> 실행일: 2026-09-07 | 환경: Staging DB isolated schema (`dr_rehearsal`)
> Production 데이터 미사용. Synthetic 데이터 전용.

### Schema Inspection vs Real Restore 구분

| 항목 | WP18 (최초) | WP18-B (정정) |
|---|---|---|
| 방법 | Staging DB critical table 존재 확인 (조회만) | Backup → DROP → Restore → 검증 |
| 분류 | SCHEMA_INSPECTION_ONLY | ACTUAL RESTORE REHEARSAL |
| Actual restore executed | NO | YES |

### Restore Target

- Environment: Staging DB (TEST_DATABASE_URL ap-northeast-2) / isolated schema `dr_rehearsal`
- Isolated: YES (별도 schema, 실제 staging 테이블과 분리)
- Production data used: NO
- Backup method: Node.js SQL export (schema + synthetic INSERT statements)
- Restore method: SQL statement 재실행 (48 statements, 0 failures)

### Critical Table 매핑 (WP18 명칭 → 실제 테이블명)

| WP18 명칭 | 실제 테이블명 |
|---|---|
| student_diary_notes | class_diary_student_notes |
| media | photo_assets_meta |
| videos | video_assets_meta |

> `staging-manifest.ts`에서 누락 원인: bootstrap에 `class_diary_student_notes`는 `pool-db-init.ts`가 담당하나, staging-manifest가 photo/video asset 테이블을 bootstrap에서 누락. 서비스 영향 없음 (staging 전용 문제).

### Integrity Check Results

| 검증 항목 | 결과 |
|---|---|
| T1 Schema | PASS |
| T2 All 14 critical tables | PASS |
| T3 Indexes (4+) | PASS |
| T4 FK constraints (8+) | PASS |
| T5 Pool A records | PASS |
| T6 Pool B records | PASS |
| T7 Parent A → Student A | PASS |
| T8 Student A → Class A history | PASS |
| T9 Diary Pool A | PASS |
| T10 Diary note (class_diary_student_notes) | PASS |
| T11 Photo media (photo_assets_meta) | PASS |
| T12 Video (video_assets_meta) | PASS |
| T13 Growth report | PASS |
| T14 Cross-pool isolation | PASS |
| **RESTORE_SCHEMA_INTEGRITY** | **PASS** |
| **RESTORE_DATA_INTEGRITY** | **PASS** |
| **RESTORE_RELATION_INTEGRITY** | **PASS** |

### External Config (Dashboard 직접 확인 필요)

| 항목 | 상태 |
|---|---|
| Supabase automatic backup | USER_CONFIRM_REQUIRED |
| Supabase PITR | USER_CONFIRM_REQUIRED |
| Supabase retention period | USER_CONFIRM_REQUIRED |
| R2 photo versioning/recovery | USER_CONFIRM_REQUIRED |
| R2 video versioning/recovery | USER_CONFIRM_REQUIRED |
| AI Engine current deploy SHA | USER_CONFIRM_REQUIRED |

> Supabase: dashboard → project `mrgkiussgbbmxfnkjgqy` → Backups 탭
> R2: Cloudflare dashboard → R2 → bucket Settings → Versioning

### R2 Object 삭제 복구

```
R2_OBJECT_DELETE_RECOVERY = NOT_AVAILABLE (기본 설정 기준)
Cloudflare R2는 기본적으로 object versioning 미제공.
삭제된 object 복구 불가 (versioning 활성화 시 가능 — dashboard 확인 필요).
```
