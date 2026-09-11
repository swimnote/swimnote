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
- swimnote-worker(srv-d9uc5hnlk1mc73efmnu0): stuck_crashlooping으로 suspended → 의존하면 안 됨
