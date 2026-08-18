---
name: WP-CS12 완료 상태
description: Support FAQ/Solution Candidate Generation — 21개 PENDING candidate, pool-db-cs-12.ts 마이그레이션
---

## WP-CS12: FAQ/Knowledge/Solution Candidate Generation

**SHA:** 62c8c0c5  
**완료일:** 2026-08-18

### 생성 파일
- `artifacts/api-server/src/migrations/pool-db-cs-12.ts` — 21개 candidate seed (status=pending)
- `artifacts/api-server/src/routes/__tests__/cs12-candidates.test.ts` — CS12-01~15, 42TC
- `knowledge-search.ts` — pool-db-cs-12.js 동적 import 등록

### Candidate 결과
| Type | Count |
|---|---|
| FAQ | 11 |
| SOLUTION | 10 |
| **Total** | **21** |
| ACTIVE_CREATED | 0 (절대 금지) |
| KNOWN_ISSUE item_type | 0 (CS15에서 incident 연결) |

### P0 처리 결과 (10/10 완료)
| Coverage ID | Candidate(s) |
|---|---|
| AUTH_ACCOUNT_WITHDRAWAL | ki_cs12_account_withdrawal + ki_cs12_pool_admin_withdrawal_deferred |
| AUTH_POOL_ACCESS_DENIED | ki_cs12_pool_access_denied (SOLUTION) |
| ATTENDANCE_PERMISSION_DENIED | ki_cs12_attendance_permission (FAQ) |
| NOTIFICATION_PERMISSION_OS | ki_cs12_notification_permission_ios + ki_cs12_notification_permission_android |
| DATA_NOT_VISIBLE_ROLE_MISMATCH | ki_cs12_data_role_mismatch (SOLUTION) |
| DATA_NOT_VISIBLE_FILTER | ki_cs12_data_filter_check (FAQ) |
| KNOWN_ISSUE_SERVER_API | ki_cs12_server_error_triage (FAQ) |
| KNOWN_ISSUE_AI_PROVIDER | ki_cs12_ai_error_triage (FAQ) |
| KNOWN_ISSUE_PUSH | ki_cs12_push_not_working (SOLUTION) |
| KNOWN_ISSUE_BILLING | ki_cs12_billing_error_triage (FAQ) |

### P1/P2 처리 (11개)
DIARY_AI_FAILED, DIARY_SAVE_FAILED, DIARY_PHOTO_UPLOAD_FAILED, BILLING_PAYMENT_FAILED,
PARENT_CHILD_NOT_LINKED, DIARY_PARENT_NOT_VISIBLE, X_SETUP_HOW_TO,
AI_GROWTH_REPORT_HOW_TO, ATTENDANCE_SAVE_FAILED + 2개 P0 보조 candidates

### 핵심 설계 원칙
- item_type: FAQ | SOLUTION (KNOWN_ISSUE type 사용 안 함 — incident_id 연결은 CS15)
- KNOWN_ISSUE coverage records → FAQ type으로 troubleshooting 안내
- 모든 candidate: source_ref 필수, question+answer 필수
- role scope: billing/x_setup = pool_admin only; diary 저장 = teacher; parent 연결 = parent only
- SOLUTION items: solution_steps JSON array 포함
- 중복 방지: CS05R 20개 기존 seed와 ID 겹침 없음

### 테스트
- CS12-01~15: 42TC 신규 추가
- 전체: 2146/2146 통과

### 배포/OTA
- Render 재배포: 없음 (data-only migration, auto-runs on boot)
- OTA: 없음
- Production DB write: 없음 (migration은 서버 부팅 시 실행, 아직 배포 안 됨)

### GAPS REMAINING
- SOURCE_GAP: 0
- IMPLEMENTATION_GAP: 0
- POLICY_GAP: 0 (탈퇴 데이터 보존 정책은 code에서 명확히 확인됨)
- ROLE_SCOPE_REVIEW_REQUIRED: 0

### 주의사항
- pool-db-cs-12.ts의 solution_steps는 `::jsonb` 캐스트 필요 — base cs-05r SeedItem 인터페이스에 없음
- 마이그레이션은 knowledge-search.ts 라우트 첫 로드 시 자동 실행 (cs-05r와 동일 패턴)
