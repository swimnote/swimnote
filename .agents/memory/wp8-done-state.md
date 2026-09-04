---
name: WP8 완료 상태
description: Super Admin Pool Control Center — Audit / Support Case CRM 완료 상태
---

## WP8 완료 상태

- **SHA**: b728e007
- **브랜치**: release/v2.0.0
- **결과**: 76 PASSED | 0 FAILED | 2 SKIPPED (pre-existing dev DB: diary_entries 없음)

### 서버 변경사항
- `ensureWp8Schema()`: support_cases 컬럼 8개 추가 + support_case_notes 테이블 생성
- 감사 로그: GET /super/pools/:id/control-center/audit (필터+페이지) + /:logId (maskSensitive 적용)
- 지원 케이스: POST(생성) / GET(목록/상세) / PATCH(status/assign) / POST(notes/resolve/reopen)
- 모든 엔드포인트 pool-scoped 404 guard + cross-pool subject 400 guard

### 웹 변경사항
- AuditTab: 필터(action/entity_type/actor_id/날짜), 페이지네이션, SafeJsonDiff 상세
- SupportTab: 필터, 요약 배지, CreateCaseModal, SupportCaseTimeline, 라이프사이클 패널
- SubjectSupportButton: Members/Teachers/Parents/Classes 상세 드로어에 케이스 생성 버튼

### OTA / Render
- OTA: 없음 (APP 파일 미변경)
- Render: GitHub push로 자동 배포 트리거됨

### Pre-existing Dev DB 이슈
- `diary_entries` 테이블이 dev DB에 없음 → members/summary 500 pre-existing
- WP8 해당 라우트 미수정 확인 완료 (git diff 검증)
