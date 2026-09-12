---
name: GR 파이프라인 스키마 불일치 수정
description: growth_reports 테이블과 분석 워커 코드 간 스키마 불일치로 전체 분석 실패했던 버그들과 수정 내역
---

## 수정된 버그 목록 (2026-09-12)

### 1. batch-worker: class_group_id_at_creation 제거
- **문제**: growth_report_batch_worker.ts의 INSERT에 `class_group_id_at_creation` 컬럼 포함 → 운영 DB에 없음 → 전체 batch 254건 FAILED
- **수정**: INSERT 컬럼 목록에서 제거 (SHA f2926a0e)
- **Why**: 이 컬럼은 코드에만 있고 실제 DB 스키마에 없음. ON CONFLICT DO NOTHING이 catch 못함

### 2. 누락 컬럼 3개 DB 추가 (migration)
- `exclusion_code TEXT DEFAULT NULL`
- `attendance_count INTEGER DEFAULT NULL`  
- `eligibility_version INTEGER DEFAULT NULL`
- **Why**: 분석 워커 eligibility gate에서 이 컬럼에 UPDATE하는데 DB에 없어 전체 분석 500 에러

### 3. gr_product_status_enum에 EXCLUDED 추가
- **문제**: `ALTER TYPE gr_product_status_enum ADD VALUE 'EXCLUDED'` 미적용 → eligibility 제외 학생 처리 시 enum cast 오류
- **수정**: DB에 직접 ALTER TYPE으로 추가
- **Why**: 코드에서 'EXCLUDED' 상태를 쓰는데 enum에 없으면 전체 분석 실패

### 4. admin.ts: class_group_id_at_creation → 분리된 조건변수
- **문제**: line 4023 `AND gr.class_group_id_at_creation = '${classGroupId}'` → 리포트 목록 조회 500 에러
- **수정**: countSql → `classGroupCountCondition` (`AND cg.id = ...`), listSql → `classGroupListCondition` (`AND cls.class_group_id = ...`)
- **Why**: count/list 쿼리가 서로 다른 alias 구조를 가짐

## 검증 결과 (토이키즈 9월 리포트 2026-08)
- 대상: 247명 → 205건 생성 (42건 ON CONFLICT skip)
- REVIEW_REQUIRED: 85건 (완전 분석 완료)
- EXCLUDED: 120건 (NO_SOURCE_DATA:98, INSUFFICIENT_ATTENDANCE:22)
- 분석 속도: p50=213s, p90=246s, max=255s (4vCPU 엔진 기준)

## 10월 자동화 구조 검증
- 스케줄러: 매일 01:00 KST → Oct 1에 2026-09 사이클 자동 생성 ✅ (parentInputOpenAt=Sep 30 15:00 UTC)
- 배치 크론: 매월 5일 02:00 KST → Oct 5에 batch job 생성 ✅
- 배치 워커: 5분마다 → OPEN 리포트 생성
- 분석 워커: 5분마다 → OPEN → EXCLUDED/REVIEW_REQUIRED
- ToyKids x_manual_entitlement=true → X-eligible ✅
- UNIQUE INDEX uq_growth_report_cycles_pool_period → 중복 사이클 방지 ✅
