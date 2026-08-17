---
name: WP-CS-PA0 완료 상태
description: CS-PA0 AI Customer Support + Partner Analytics Foundation 완료 기록
---

# WP-CS-PA0 완료 상태

## SHA
미정 (commit 후 기록)

## 구현 범위
- `artifacts/api-server/src/lib/ai-feature-enum.ts` — TEACHER_AI_DIARY/PARENT_CURRICULUM_AI/GROWTH_REPORT_AI/SUPPORT_AI + SUPPORT_CASE_STATE/ESCALATION_REASON/KNOWLEDGE_ITEM_TYPE/RESOLUTION_SOURCE enums
- `artifacts/api-server/src/migrations/pool-db-cs-pa0.ts` — support_cases + support_knowledge_items + partner_analytics_snapshots (idempotent)
- `artifacts/api-server/src/routes/cs-pa0.ts` — 8 endpoints (/super/ai/metrics, /super/partner/metrics, /super/partner/snapshots GET+POST, /super/support/cases GET+POST, /super/support/knowledge GET+POST+PATCH)
- `artifacts/swimnote-web/src/pages/super/SuperPartner.tsx` — Adoption/AI Usage/Evidence 탭 실 데이터 연결
- `artifacts/api-server/src/routes/__tests__/cs-pa0.test.ts` — 29TC PA0-01~PA0-15

## 총 TC: 1254 (모두 통과)

## 핵심 설계 결정
1. **event_logs 재사용** — 신규 ai_traces 테이블 없음. category='AI' 필터로 집계
2. **null=NOT_AVAILABLE** — 소스 없는 지표(result_adoption, support_resolution)는 null (fake 0 금지)
3. **estimated_cost_usd** — 실제 청구금액이 아닌 추정치임을 필드명에 명시
4. **Knowledge pending** — AI 자동 knowledge 승인 금지, super_admin PATCH로만 active 전환
5. **Privacy** — support_cases에 원문/이름 저장 금지, ticket_id FK 참조 방식

## 미배포 사항 (WP-CS-PA1에서 처리)
- story.ts AI trace 미연결 (uninstrumented OpenAI call)
- teacher_diary/parent_curriculum_search 호출부에 user_role/mode/result_generated 추가 미완
- Knowledge DB 실 데이터 없음 (Foundation만 구축)
- SuperSupport.tsx: AI 처리/사람 확인/Knowledge 탭은 placeholder 유지 (CS-PA1)
