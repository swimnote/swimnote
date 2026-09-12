---
name: 성장 리포트 엔진 업그레이드 완료 상태
description: Professional Engine 인스턴스 업그레이드 및 Swimnote API 서버 처리량 설정 완료 상태
---

## 완료 내용 (2026-09-12)

### Professional Engine (AI 엔진팀)
- 인스턴스: Starter(0.5vCPU, 512MB) → Standard(2vCPU, 2GB) [리포트 발급 시 임시 업그레이드]
- STAGE_B_CONCURRENCY_LIMIT: 미설정(default=5) → 20
- VOYAGE_API_KEY: render.yaml에 sync:false 추가 (reranker 활성화)
- Production URL: https://swimnote-professional-engine.onrender.com
- 인증: JWT_SECRET 공유 방식 (HS256). PROFESSIONAL_ENGINE_API_SECRET은 Growth Report에 미사용.

### Swimnote API Server (SHA cd15f6d2, Render LIVE)
- GROWTH_REPORT_ENGINE_URL: Render 환경변수 등록 완료
- GROWTH_REPORT_ENGINE_SECRET: 미설정 시 JWT_SECRET으로 자동 fallback (코드 수정)
- BATCH_SIZE: 200 (코드 기본값)
- CONCURRENCY: 20 (코드 기본값)
- 연속 큐 드레인: pending 소진까지 4.5분 연속 처리
- Stuck 워치독: PREANALYZING/ANALYZING 3분 초과 → 자동 리셋
- 배치 워커 학생 병렬: 3명

## ★ Render ENV 관리 주의사항 (2026-09-12 사고 기록)
- Render API PUT /env-vars는 서비스 레벨 전체를 덮어씀
- "sync:false" 문자열을 value로 넣으면 실제 시크릿이 그 문자열로 교체됨
- JWT_SECRET 등 env group에서 sync되던 변수들이 PUT 후 누락되면 서버 크래시
- **규칙: env var 수정 시 반드시 기존 전체 목록 + 신규를 함께 PUT. JWT_SECRET 항상 포함.**

## 다음 액션
- 토이키즈 9월 리포트 테스트 발급 (엔진 Standard 업그레이드 후)
- p50 실측값 확인 후 CONCURRENCY 조정 여부 결정
- 발급 완료 후 엔진 Starter로 다운그레이드 (~$14/5일 절감)
