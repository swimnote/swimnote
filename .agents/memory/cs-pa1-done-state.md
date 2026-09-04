---
name: CS-PA1 완료 상태
description: CS-PA1 Common AI Usage Instrumentation — 기존 AI 기능 공통 계측 완료
---

## 완료 기준
- SHA: f83a0101
- TC: 1305/1305 (PA1-01~PA1-22 37TC 추가)
- GitHub push: deploy-photo-clone → origin ✅
- Render: 자동 배포 트리거됨 (서버 전용, OTA 없음)

## 변경 파일
1. `lib/ai-trace-service.ts` — AiTraceContext 확장 (user_role/sub_feature/result_generated/provider/cached_tokens/source_app), AiTraceSuccess model/token null 허용, description 포맷 통일
2. `lib/ai-feature-enum.ts` — STORY_SUMMARY = "story_summary" 추가, 레이블 추가
3. `routes/ai.ts` (legacy /ai/diary/generate) — saveAiTrace SUCCESS/TIMEOUT/VALIDATION/INTERNAL 4경로
4. `routes/story.ts` (/diaries/:id/story-summary) — saveAiTrace SUCCESS/OPENAI_ERROR/RETRY/LENGTH 경로, 토큰 합산
5. `routes/parent-curriculum.ts` — saveAiTrace ENGINE SUCCESS/FAILED 경로, model/latency from meta
6. `jobs/growth-report-analysis-worker.ts` — saveAiTrace ENGINE SUCCESS/FAILED, sub_feature=stage
7. `routes/__tests__/cs-pa1.test.ts` — PA1-01~PA1-22 37TC

## 핵심 패턴
- `void saveAiTrace({...}).catch(() => {})` — TELEMETRY_FAILURE_BREAKS_AI = NO
- 외부 엔진 경유 시: model=null, input/output/total_tokens=null
- pool_id 항상 TEXT (parseInt 금지)
- story.ts: 1차+재시도 토큰 합산, generation_mode로 구분
- growth_report_ai: sub_feature = stage (PREANALYSIS/FINAL_ANALYSIS)

## 이미 계측된 엔드포인트
- ai-v1.ts (/v1/teacher-diary/generate): 기존 saveAiTrace 유지 (변경 없음)

## DB 변경 없음
- event_logs 테이블 재활용 (category='AI')
- 신규 필드는 모두 metadata JSONB에 포함
