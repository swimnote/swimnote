---
name: WP9 완료 상태
description: AI Diary Hub — ai_generated/ai_trace_id 컬럼, snapshot, diary-based admin feed, diary-hub.tsx 전면 재작성
---

## 상태: COMPLETE

- **SHA:** `1913680c`
- **Branch:** `release/v2.0.0`
- **Supabase migration:** 적용 완료 (ai_generated/ai_trace_id/partial index)
- **Render:** 미배포 (사용자 수동)
- **iOS OTA:** production branch, runtime 2.1.0, update ID `01a06ae3-67af-781e-82ce-90ab77889bc6`
- **Tests:** 36/36 PASS

## 변경 파일

1. `artifacts/api-server/src/migrations/step-wp9-ai-diary-columns.ts` — 신규
2. `artifacts/api-server/src/routes/diary.ts` — refreshAiDiarySnapshot + ai 컬럼 저장 + DELETE 후 refresh
3. `artifacts/api-server/src/routes/admin.ts` — /diaries/summary diary-based + ai_only filter + /x-hub/summary ai_diary metrics 활성화
4. `artifacts/swim-app/app/(admin)/diary-hub.tsx` — 전면 재작성
5. `scripts/validate-wp9.ts` — 검증 스크립트

## 핵심 결정사항

- **ai_generated 판정:** server-side (`!!ai_request_id` 존재 여부); client boolean 무시 (보안)
- **ai_trace_id:** TEXT, NO FK (event_logs fire-and-forget 특성상 cross-DB FK 불가)
- **snapshot:** advisory lock pattern (WP10 curriculum과 동일), ai cols ONLY UPSERT (curriculum cols 보존)
- **admin feed:** class_diaries PRIMARY (LEFT JOIN notes), 0-note diary도 표시
- **ai_only filter:** 서버/앱 양측에서 `ai_only=true` 파라미터로 AI 일지만 필터
- **icon fix:** `sliders-horizontal` → `sliders` (ICON_MAP 지원 이름)
- **dateBtn height:34** 고정 (폰트 로딩 후 resize 방지)

## AI ENGINE CHANGE REQUIRED: NO
(request_id가 이미 response에 포함됨 — 에이전트 변경 불필요)
