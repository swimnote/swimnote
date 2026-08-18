---
name: WP-CS17 완료 상태
description: Super Admin Knowledge Review Console 구현 완료 상태 및 핵심 사항
---

# WP-CS17 완료 상태

**SHA**: fcb3c9e9
**TC**: 90 신규, 2595 전체 통과
**Render**: 미배포 (서버 코드 변경 없음 — knowledge-approval.ts DB import fix만)
**OTA**: 없음 (web-only UI)

## 구현 내용

- `SuperKnowledgeReview.tsx`: 6-tab console (검토대기/수정요청/활성/거절됨/아카이브/감사이력)
- `App.tsx`: `/super/knowledge-review` 라우트 추가
- `SuperLayout.tsx`: 지식 검토 nav item 추가
- `knowledge-approval.ts`: DB import 수정 (`superAdminDb`→`@workspace/db`, `sql`→`drizzle-orm`)

## 중요 패턴

- `safeSourceRef()`: 소스 경로 60자 truncate, raw path 노출 금지 (§6)
- `reviewer_id` UI 미노출, `reviewer_role`만 표시 (§15 PII)
- CONCURRENT_APPROVAL_CONFLICT: 메시지 표시 + re-fetch, auto-retry 금지
- CS12 21개 후보 정적 표시 (READY=17, REVIEW_REQUIRED=4)
- `canApprove = blockers.length === 0 && status not STALE/SUPERSEDED`

## 테스트 수정 패턴

- 파일 경로: `../../../../../artifacts/swimnote-web/...` (5단계 상위 + artifacts/)
- `CHECKED_AUTO_PROMOTION_PATHS`: string[] — status 필드 없음, 각 항목이 string
- `isAiReviewerAttempt`: AI_IDS = ["ai","system","agent","llm","openai","anthropic","gemini"] — "gpt" 없음
- `getP0CoverageReadiness()`: Record<string, Cs12ReadinessLabel> — 배열 아님, 반드시 import
- SQL IN 절 regex: `/status IN \('pending',\s*'edit_required'\)/` (공백 허용)
