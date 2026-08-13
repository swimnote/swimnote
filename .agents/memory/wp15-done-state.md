---
name: WP15 완료 상태
description: Growth Review Statistics (super_admin READ ONLY) 구현 완료 현황
---

# WP15 — Growth Review Statistics 완료

**SHA:** `d196d9fa`  
**완료일:** 2026-08-13

## 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `super.ts` | GET /super/growth-review-stats (summary + pool_breakdown) |
| `wp15-growth-stats.test.ts` | 신규 16 TC (A-N) |
| `SuperAdmin.tsx` | "검토 통계" 탭 추가 |
| `GrowthReviewStats.tsx` | 신규 (summary cards + pool table, loading/empty/error 분리) |

## 결과

- **테스트:** 371/371 전체 통과 (WP15 신규 16 TC 포함)
- **Render:** `dep-d9uk7oflk1mc73dthdag` live, SHA `d196d9fa`
- **iOS OTA:** 앱 변경 없음 → 미배포
- **Web build:** ✅

## 핵심 설계

- super_admin ONLY (requireAuth + requireRole)
- READ ONLY — growth_events write 없음
- source: growth_events WHERE is_invalidated=false (audit_logs 사용 금지)
- 기간 필터 기준: created_at (WP8 기존 패턴 동일)
- pending age: created_at 기준 24h/48h COUNT만 (상태 변경 없음)
- average_review_time_hours: reviewed_at - created_at (필드 의미 명확)
- NaN/Infinity 방지: 분모 0 → rate=0
- AUTO_ACCEPTED: teacher review_rate 분모 제외 (별도 집계 필드)
- Pool breakdown: LEFT JOIN swimming_pools (N+1 금지, 1 query)
- 오해 방지 문구: "성장 이벤트 검토 처리 현황" 명시

## 제약

- WP15.5/WP16 자동 시작 금지
- 학생 ranking/교사 ranking/성장 score 금지
- growth event write 변경 금지
