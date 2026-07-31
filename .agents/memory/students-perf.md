---
name: 학생 목록 성능 최적화
description: students GET / 엔드포인트 성능 병목 원인과 해결 패턴
---

## 병목 원인
1. `getPoolId(userId)` — 모든 요청마다 superAdminDb 쿼리 1회 추가 발생
2. JS sort (`enriched.sort(...)`) — SQL에서 정렬하면 불필요
3. DB 인덱스 없음 — `swimming_pool_id + status` 복합 인덱스 미존재

## 해결
1. `req.user!.poolId || await getPoolId(userId)` — JWT 토큰에 poolId 있으면 DB 조회 생략
2. 모든 쿼리 브랜치에 `.orderBy(desc(studentsTable.created_at))` 추가, JS sort 제거
3. pool-db-init에 인덱스 추가:
   - `idx_students_pool_status ON students(swimming_pool_id, status)`
   - `idx_students_pool_created ON students(swimming_pool_id, created_at DESC)`
   - `idx_class_groups_pool_deleted ON class_groups(swimming_pool_id, is_deleted)`
   - `idx_class_groups_teacher ON class_groups(teacher_user_id, is_deleted)`

**Why:** 학생 수가 많을수록 전체 테이블 스캔 + JS sort 비용이 증가하므로 인덱스가 핵심.

**How to apply:** 인덱스는 서버 재시작 시 CREATE INDEX IF NOT EXISTS로 자동 생성됨.
