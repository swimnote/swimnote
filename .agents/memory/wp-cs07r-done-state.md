---
name: WP-CS-07R Support Resolution Router 완료 상태
description: Resolution Router 7-layer chain 구현 — RULE→DB_STATE→SOLUTION→FRONTEND_MAP→FAQ/KNOWLEDGE→KNOWN_ISSUE→NO_MATCH
---

## 완료 상태

- SHA: c83dd197
- Branch: deploy-photo-clone
- Render: 배포 트리거됨 (push 완료)
- iOS OTA: NO
- Android OTA: NO

## 핵심 구현

### 라우터 엔드포인트
`POST /support/resolve`

### Resolution Order (고정 우선순위)
1. RULE — support_knowledge_items item_type=RULE (active only)
2. DB_STATE — swimming_pools/growth_reports 실시간 조회 (read-only)
3. SOLUTION — support_knowledge_items item_type=SOLUTION (active only)
4. FRONTEND_MAP — 정적 레지스트리 (role/mode/version 필터)
5. FAQ/KNOWLEDGE — support_knowledge_items item_type IN (FAQ,KNOWLEDGE) (active only)
6. KNOWN_ISSUE — super_incidents(OPEN/INVESTIGATING/MITIGATED) 연결된 ki만
7. NO_MATCH → llm_required=true 반환, OpenAI 호출 없음

### 핵심 설계 결정
- HIGH_CONFIDENCE = 60 (threshold). scoreText()에서 exact question=90, exact title=85, partial=65~78, token overlap>=50%=55
- FRONTEND_MAP은 SOLUTION 다음에 위치 (layer 4) — FAQ/KNOWLEDGE 앞
- Pool isolation: JWT poolId 기준, 클라이언트 파라미터 무시
- event_logs: raw query 저장 금지; source_id/role/mode/pool_id/category/feature만 기록
- DB_STATE: 키워드 기반 dispatcher (구독/X모드/리포트 3종류)

### 테스트 패턴 (중요)
- FRONTEND_MAP이 FAQ/KNOWLEDGE 앞에 있으므로, FAQ/KNOWLEDGE 레이어를 테스트하려면
  프론트엔드 맵 레지스트리에 없는 수영 전문 용어 쿼리 사용 필수
- "강습", "환불", "비밀번호", "로그인", "알림", "일지" 등은 frontend-map.v1.ts에 있음
- 안전한 테스트 쿼리 예: "배영 턴 동작 팔꿈치 각도", "자유형 킥 횟수 교정", "X 구독 수동 등록 규정"

### 파일
- NEW: artifacts/api-server/src/routes/resolution-router.ts
- NEW: artifacts/api-server/src/routes/__tests__/cs-07r.test.ts (25TC)
- MOD: artifacts/api-server/src/routes/index.ts (resolutionRouter 등록)

### 테스트
- CS07R: 25TC
- 전체: 1625TC

## Next
- Task #29,30,31 HOLD (LLM fallback은 CS-08R 이후)
