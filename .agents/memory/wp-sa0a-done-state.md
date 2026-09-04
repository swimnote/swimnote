---
name: WP-SA0-A Super Admin 재구성 완료
description: Super Admin shell + URL routing + sidebar 구현 완료 상태
---

## 완료 조건
- SHA 6a617dd2; branch deploy-photo-clone; GitHub pushed ✅
- TS errors: 0 (신규 파일 기준, AppPage/Intro/AdminSidebar 사전 오류 제외)
- Render 재배포 불필요 (web-only 변경)
- OTA 불필요 (web-only 변경)

## 구현 내용

### 새 구조
- `/super/*` flat URL routing (wouter Switch)
- `SuperGuard` — super_admin 아니면 /login 리다이렉트
- `SuperLayout` — 사이드바 11개 메뉴, useLocation() active state

### 11개 페이지
1. `SuperOverview` — 비즈니스 지표 shell (`/super/dashboard-stats`)
2. `SuperPools` — pool 목록/승인/거절/구독 (MOVED from SuperAdmin.tsx)
3. `SuperPoolDetail` — pool 상세 A/B/C + `/super/operators/:id`
4. `SuperBilling` — placeholder (SA0-B)
5. `SuperXMode` — X pool 목록 + XSetupTab 직접 재사용
6. `SuperAI` — GlobalTemplateSets + GrowthReviewStats 재배치
7. `SuperSupport` — 지원센터 (ticket list + reply) MOVED
8. `SuperServers` — db-status/infra-usage + UNKNOWN 표시
9. `SuperIncidents` — risk-center + op-logs (CRUD SA0-B)
10. `SuperPartner` — AnalyticsDashboard + AdCreativeManager 재배치
11. `SuperAudit` — AuditLogs 재사용
12. `SuperSettings` — 관리자 계정 생성 MOVED (sub-nav 4탭)

### 통합 파일
- `App.tsx` — /super/* routes + SuperPage wrapper + /super-admin redirect
- `PoolAdmin.tsx` — `export function XSetupTab` (keyword 추가)
- `SuperAdmin.tsx` — /super-admin → /super/overview redirect shim

## SA0-B 미구현 항목
- incidents CRUD DB (테이블 신규)
- Global Pool Search
- Billing 상세
- AI Usage/Errors 백엔드
- Partner Adoption/Evidence
- Overview 실시간 telemetry
