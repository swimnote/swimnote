---
name: WP-CS-04R 완료 상태
description: Frontend Map Registry Foundation — 검색 엔드포인트 + 52 TC 완료 상태
---

## 상태
COMPLETED

## SHA
e345a5ad

## 핵심 파일
- `artifacts/api-server/src/config/support/frontend-map.v1.ts` — 레지스트리 (80+ 화면)
- `artifacts/api-server/src/routes/frontend-map.ts` — 검색/상세/메타 엔드포인트
- `artifacts/api-server/src/routes/__tests__/cs-04r.test.ts` — FMREG-01~20, 52TC

## 엔드포인트
- `GET /support/frontend-map/search?q=&role=&mode=&route=&screen_id=&version=`
- `GET /support/frontend-map/screens/:screen_id`
- `GET /support/frontend-map/meta`

## 검색 우선순위
1. exact screen_id (score=100, source="exact_screen_id")
2. exact route (score=95, source="exact_route")
3. label match / screen_name (score=90, source="label_match")
4. keyword_exact (score=85)
5. keyword_partial (score=75)
6. feature_match (score=65)
7. purpose_token (score=50)
8. screen_id_token (score=40)

**Why:** NO_MATCH는 0결과 반환, 추측 fallback 없음. OpenAI 호출 없음(deterministic).

## 테스트 결과
52/52 TC, 1552/1552 전체 회귀 통과

## 배포
- Render: push 트리거됨 (자동 배포)
- OTA: 불필요 (서버 전용)
