---
name: 성장 리포트 엔진 업그레이드 완료 상태
description: Professional Engine 인스턴스 업그레이드 및 Swimnote API 서버 처리량 설정 완료 상태
---

## 완료 내용 (2026-09-12)

### Professional Engine (AI 엔진팀)
- 인스턴스: Starter(0.5vCPU, 512MB) → **Standard(2vCPU, 2GB)**
- STAGE_B_CONCURRENCY_LIMIT: 미설정(default=5) → **20**
- VOYAGE_API_KEY: render.yaml에 sync:false 추가 (reranker 활성화)
- SHA: 28affe9b, Render 재배포 완료

### Swimnote API Server
- BATCH_SIZE: 10 → **200** (기본값 코드 변경)
- CONCURRENCY: 5 → **20** (기본값 코드 변경)
- 연속 큐 드레인: 5분 burst → **pending 소진까지 4.5분 연속 처리**
- Stuck 워치독: PREANALYZING/ANALYZING 3분 초과 → OPEN/READY_FOR_ANALYSIS 자동 리셋
- 배치 워커 학생 병렬: 1명 순차 → **3명 병렬**
- 배치 워커 락 TTL: 5분 → 10분

## 다음 액션
- Engine Render 재배포 완료 후 실측 p50 측정 필요
- p50 기준으로 GROWTH_REPORT_ANALYSIS_CONCURRENCY 추가 조정 가능
  - p50 ≤ 15s → CONCURRENCY=20 유지 (충분)
  - p50 15~30s → CONCURRENCY=15로 낮추거나 유지
  - p50 > 30s → CONCURRENCY=10으로 낮추고 엔진 추가 최적화 요청

## 이론 처리량 (Standard×1 기준)
- p50=20s 가정: 동시20 × (300s/20s) = 300건/사이클 → 배치 200 cap → 115,200건/96h
- p50=15s 가정: 동시20 × (300s/15s) = 400건/사이클 → 배치 200 cap → 172,800건/96h
- 20만 건 달성: p50≤15s + BATCH_SIZE 추가 상향(200→300) 또는 인스턴스 2대
