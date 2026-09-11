---
name: Growth Report Engine Secret 설정 규칙
description: 분석 워커가 professional engine에 JWT 인증할 때 사용하는 secret 설정 규칙
---

## 규칙

`GROWTH_REPORT_ENGINE_SECRET`은 반드시 `JWT_SECRET`과 동일한 값(96자 full)이어야 한다.

엔진은 `JWT_SECRET`으로 JWT를 검증하므로, API 서버가 `GROWTH_REPORT_ENGINE_SECRET`으로 서명한 JWT가 엔진에서 통과하려면 두 값이 일치해야 한다.

**Why:** Render 환경변수 API가 긴 secret 값을 truncate해서 표시한다. `853348af...b` (60자)로 보이지만 실제 JWT_SECRET은 96자(`853348af...bee4c64ceff`)이다. truncated 값으로 서명하면 엔진이 항상 401 UNAUTHORIZED를 반환한다.

**How to apply:**
- API 서버 Render 환경변수: `GROWTH_REPORT_ENGINE_SECRET = process.env["JWT_SECRET"]` (Replit secret에서 읽은 full 96자 값)
- 분석 워커가 FAILED만 나올 때: 이 secret 불일치를 먼저 의심할 것
- Render API로 환경변수 값을 읽을 때 truncation 여부를 실제 테스트(401 vs 422)로 확인할 것

## 분석 워커 전체 구조 (2026-09-11 확인)

- `startGrowthReportAnalysisWorker()` → API 서버 모드에도 추가됨 (index.ts else 분기)
- `GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=true` → Render API 서버 환경변수에 설정
- `GROWTH_REPORT_ANALYSIS_BATCH_SIZE=50` → 5분마다 50건 처리
- `GROWTH_REPORT_ANALYSIS_CONCURRENCY=5` → 배치 내 동시 처리 건수 (기본 5, max 20)
- swimnote-worker(srv-d9uc5hnlk1mc73efmnu0): stuck_crashlooping으로 suspended → 의존하면 안 됨

## Render PUT /env-vars 주의사항

- PUT은 전체 교체(REPLACE ALL). 1개만 보내면 나머지 전부 삭제됨
- 항상 기존 vars 전부 + 신규 vars를 합쳐서 PUT해야 함
- Render API 서버(srv-d7bn4gogjchc73dp1ci0)에 필요한 env vars 31개
  - GROWTH_REPORT_* 6개 + SUPABASE_* + JWT_SECRET + SESSION_SECRET + NAVER_SENS_* + CF_R2_* + OPENAI_API_KEY 등
  - tmp_render_full.ts 패턴으로 Replit process.env에서 읽어 PUT

## batch-worker x_pool_subscriptions 버그 (수정 완료)

- 코드에서 `x_pool_subscriptions` 테이블을 JOIN했으나 실제 DB에 없음
- → `FREE_GROWTH_REPORT_ELIGIBLE_SQL` (swimming_pools의 x_paid_entitlement/x_manual_entitlement 조건)으로 교체
- SHA 659e8a9ac8 배포 완료

## getXEligiblePools 결과 (2026-09-11 기준)

- X-eligible pool 3개: 토이키즈스윔클럽, 샘플수영장, 스윔노트
- 총 active 학생 212명
- 처리 속도: 5건 동시 × 1분/건 = 50건/10분 (이론값)
