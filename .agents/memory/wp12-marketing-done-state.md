---
name: WP12 Marketing MVP 완료 상태
description: WP12 Super Admin Marketing MVP 구현 결과 — SHA, 파일, 핵심 패턴
---

**SHA:** dc768326 — pushed to origin/release/v2.0.0
**이전 WP:** WP11 e2d4ac0f
**Tests:** 36/36 PASS (wp12-marketing.test.ts, tests A–AJ)
**Migration:** 없음 (target_plan_types 기존 존재 확인)
**Render 배포:** 트리거 필요

## 주요 파일

- `artifacts/api-server/src/lib/marketing-audience.ts` — NEW, canonical audience resolver
- `artifacts/api-server/src/routes/super.ts` — +283 lines (WP12 마케팅 3개 라우트)
- `artifacts/api-server/src/jobs/push-scheduler.ts` — checkDueMarketingPushes() 추가
- `artifacts/swim-app/app/(super)/marketing.tsx` — NEW, 마케팅 발송 UI
- `artifacts/swim-app/app/(super)/_layout.tsx` — marketing 스택 등록

## 핵심 패턴

**Audience Resolver (N+1 없음):**
- pool_ids: null=전체, []=0 pools (명시적 빈 집합), [...ids]=필터
- plan_types: subscription_tier + x_manual_entitlement + x_management_override 3개 소스 병합
- roles: ADMIN(pool_admin), TEACHER, PARENT — 2개 batch SQL (users, parent_accounts)

**Push Fanout:**
- WP5 push_fanout_jobs/deliveries 스키마 직접 재사용 (job_type='marketing')
- jobRef = `notice:{id}:send` → idempotent ON CONFLICT DO NOTHING
- starts_at > now → enqueue 금지; scheduler poll이 처리

**Scheduled Push (checkDueMarketingPushes):**
- 매 분 push-minute 락 내부에서 실행
- optimistic UPDATE push_sent_at=NOW WHERE push_sent_at IS NULL (중복 방지)
- Limit 5 per tick

**Accidental Global Send Guard:**
- pool_ids + plan_types + roles 모두 빈/null → 400 ACCIDENTAL_GLOBAL_SEND
- 명시적 target_all=true 필요

**RBAC:** super_admin + platform_admin만 허용

**Why:** pool 수가 500+일 때 per-pool loop은 타임아웃 위험; batch SQL 2개로 해결
