---
name: Growth Report v3 eligibility + curriculum gauge fix
description: v3 eligibility(MIN_SOURCE=1, VERSION=3) 완료, curriculum gauge SCP=0% 버그 수정, ToyKids cleanup 완료
---

## 핵심 변경사항 (SHA 622b956d, 2026-09-12)

### eligibility v3 정책
- `GROWTH_REPORT_MIN_SOURCE_RECORDS = 1` (3/1 정책 확정)
- `GROWTH_REPORT_ELIGIBILITY_VERSION = 3`
- `INSUFFICIENT_SOURCE_DATA` 코드: v3에서 신규 발생 없음 (historical compat enum 유지)
- source 유효 기준: `note_content ~ '[가-힣A-Za-z0-9]'` (punctuation-only 제외)

### Curriculum Gauge SCP=0% 버그 수정
**Root Cause:** `curriculum-confirmation-engine.ts` step 1에서 `cv.is_active=true` 조건이 풀-단위로 비활성화된 CV(is_active=false, archived_at=NULL)를 가진 학생 assignments를 skip → pool fallback 사용 → 신 CV에는 CPO 없음 → SCP=0%

**Fix:** `cv.is_active=true` 조건 제거, `cv.archived_at IS NULL`로 완화 (비활성 CV도 archived 아니면 CPO 집계 허용)

**영향:** ToyKids pool 231명 모두 해당 (구 CV `cv_bw6pee53qf4l2ipi` is_active=false, archived_at=null)

### snapshot-builder.ts 변경
1. `queryDiaries`: punctuation-only note 필터 (`AND cdn.note_content ~ '[가-힣A-Za-z0-9]'`)
2. `queryAttendanceForEligibility`: 정규수업 `COUNT(DISTINCT date)` + makeup `COUNT(*)` 별도 event
3. `queryPreviousUsableReport`: COMPLETE + fact_package + safe discard_reason → continuity context
4. `buildAnalysisSnapshot`: previousUsableReport → `longitudinal.previous_report_structured_results` prepend
5. `isUsableDiscardedReport`: snapshot-builder.ts에서 export (eligibility.ts 아님)

### UNSAFE_DISCARD_PATTERNS (isUsableDiscardedReport 거부 조건)
- "내용 오류", "근거 오류", "잘못된 학생", "잘못된 기간", "잘못된 풀" → NOT usable
- 글자/레이아웃 오류, null → safe (usable)

### ToyKids Growth Report cleanup (2026-09-12 실행)
- soft-deleted: 419건 (DISCARDED 251 + REVIEW_REQUIRED 168)
- deleted questions: 262건
- deleted batch_jobs: 1건
- growth_events 보존: 247건
- growth_report_cycles: 2건 보존 (미삭제)

### 테스트
- `growth-report-eligibility-v3.test.ts`: 51/51 TC-A~TC-U 전체 통과
- 기존 3개 파일 7TC 실패: pre-existing (v3 변경과 무관, super.ts 패턴 매칭 실패)

**Why:** cv.is_active=false는 "신규 배정 불가"를 의미하며 기존 CPO 데이터 무효화가 아님. archived_at IS NULL이면 데이터 유효.

**How to apply:** 향후 curriculum version 교체 시 old version을 is_active=false로만 설정하면 기존 CPO 계속 집계됨. archived_at 설정 시 완전 종료.
