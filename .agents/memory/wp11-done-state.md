---
name: WP11 완료 상태
description: x-hub/summary partial-failure hardening + monthly KPI + APP 운영현황 UI
---

## SHA
67515a67 (pushed to origin/release/v2.0.0)

## 변경 파일
- artifacts/api-server/src/routes/admin.ts (GET /x-hub/summary 전면 재작성)
- artifacts/swim-app/app/(admin)/x-hub.tsx (전면 재작성)

## 핵심 변경사항

### Server
- safeXMetric<T>(name, poolId, fn) helper: 실패 시 structured console.error + null 반환, never throws
- Promise.all(14 queries) → Promise.all(13 safeXMetric wraps): setupRow 제거, snapshotM 추가
- x_monthly_operational_snapshots에서 parent_curriculum_search_count/user_count 읽기 (WP10 연결)
- AI 일지 monthly.ai_diary_count = null (UNAVAILABLE_UNTIL_WP9, class_diaries에 ai_generated 컬럼 없음)
- X_TIER_LABEL: tier1→Standard, tier2→Plus, tier3→Pro
- Response 구조: plan / monthly / live / storage / period / unavailable[]
- HTTP 200 partial response — unavailable[]에 실패 metric 목록 명시

### APP
- 화면 제목: "SWIMNOTE X 관리" → "SWIMNOTE X 운영현황" (SCREEN_TITLE 상수화)
- 섹션 재편: 오늘확인할것 / 이번달AI활용 / 현재운영현황 / 현재X플랜 / 저장공간 / 빠른관리
- setup_completion 섹션 제거 (운영 대시보드 범위 외)
- fmtNum(): null → "—", number → 천단위 포맷
- partial 배너: unavailable.length > 0 시 노란 안내
- KpiRow 컴포넌트: onPress 있으면 Pressable, 없으면 View

## OTA 배포
- Platform: iOS
- Branch: production
- Runtime: 2.1.0
- Update ID: 01a06ac2-41b2-739f-b036-8e922e10633e
- Android: 미배포

## Render 배포
- 사용자 수동 배포 필요 (GitHub push → Render.com 자동 빌드)

## 미완성 항목 (다음 WP)
- monthly.ai_diary_count: WP9에서 class_diaries.ai_generated 컬럼 추가 후 연결
- monthly.growth_report_sent_count: snapshot 미연결 (live 쿼리 fallback 사용 중)
- x_monthly_operational_snapshots: 운영 DB에 아직 없음 (Render 재배포 시 startup 마이그레이션으로 생성)
