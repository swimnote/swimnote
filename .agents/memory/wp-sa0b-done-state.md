---
name: WP-SA0-B 완료 상태
description: Super Admin 운영 데이터 연결 — 서버 신규 엔드포인트 + 웹 7개 컴포넌트
---

SHA 7f24da5e; 9파일 변경 (+2218/-581); Render 배포 트리거됨

## 서버 변경
- super.ts: super_incidents 테이블 (ensureExtraTables) + CRUD 3라우트 + logIncidentAudit
- super.ts: GET /super/billing/list — normalizeBillingStatus + detectAnomalies + x_subscription_slots 배치 조회
- super.ts: GET /super/servers/status — DB/RC/AI/Storage/Push 독립체크, 전체 500 금지
- restore.ts: /super/pools/search — phone/pool_id/u.email ILIKE 추가, q<2 빈결과 강제

## 웹 컴포넌트 (모두 완료)
- SuperLayout.tsx: 전역 풀 검색 (디바운스 400ms, ESC/외부클릭 닫기, dropdown)
- SuperOverview.tsx: dashboard-stats + servers/status + incidents 실시간, 30s 폴링, Promise.allSettled
- SuperPoolDetail.tsx: D(X Setup)/E(X04)/F(AI 최근5)/G(지원통계)/H(장애)/I(사용자 현황) 섹션
- SuperBilling.tsx: 6탭(전체/X/결제이상/해지예정/만료/Sync) + anomaly 배지, row→/super/pools/:id
- SuperIncidents.tsx: 목록(필터)+생성모달+상세패널+편집 CRUD
- SuperServers.tsx: /super/servers/status 연결, 30s 갱신, 카드 UI + infra 탭
- SuperAI.tsx: Usage/Errors 탭 /super/ai-traces 페이지네이션, GlobalTemplateSets/GrowthReviewStats 탭 연결

## 주의사항
- super_incidents는 superAdminDb에 생성됨 (revenuecat_webhook_events도 동일)
- billing/list는 x_subscription_slots 없으면 graceful fallback
- servers/status app_api는 self-ping 루프 위험 → UNKNOWN + 클라이언트 직접체크 권장 메시지 반환
- pool search q<2 → 즉시 [] 반환 (서버 전체 preload 방지)
