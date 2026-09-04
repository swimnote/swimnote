---
name: WP-CS13~17 FINAL CLOSURE PATCH 완료
description: CS13/CS14/CS15/CS16 HOLD 해제 + CS17 무조건 CLOSE. SHA 28c15fcd. 2771/2771 TC.
---

## 결과 요약
- **SHA**: `28c15fcd` (branch: deploy-photo-clone, push: 489b09e2→28c15fcd)
- **TC**: 2771/2771 PASS (이전 2676 + 신규 95)
- **Render 배포**: 불필요 (서버측 governance 강화만)
- **OTA**: 없음

## CS13 CLOSED
- `support-tickets.ts` POST /support/tickets: non-super 사용자의 pool_id를 body 대신 JWT(req.user.poolId)에서 강제 주입
- POOL_ID_FORGERY_BYPASS=0, CROSS_USER_TICKET_ACCESS=0

## CS14 CLOSED
- 추가 코드 변경 없음 — 소스 분석 + golden scenario 10개로 증거 보강
- HALLUCINATION_RATE=0, PENDING_IN_EVIDENCE=0

## CS15 CLOSED
- Production DB 직접 감사(스크립트 실행 후 삭제): HARD_CONFLICTS=0, DUPLICATE_ACTIVE=0, UNRESOLVED_CONFLICTS=0
- ACTIVE 항목 2개(ki_x_mode_intro rev3, ki_swimnote_intro rev2) — 모두 CS12 이전 seed, 정상

## CS16 CLOSED — 가장 큰 변경
- `knowledge-search.ts` /approve 핸들러 전면 재작성 (9단계 governance chain)
- 신규 imports: isApprovalAllowed, isGlobalApprovalAllowed, isAiReviewerAttempt, validateApprovalChecklist, detectConflicts
- APPROVAL_GOVERNANCE_BYPASS_PATHS=0
- 에러 코드: INVALID_STATUS_TRANSITION (기존 cs12-17-closure 테스트와 호환 유지 필수)

## CS17 CLOSED
- CS16 완료로 조건부→무조건 CLOSE

## 핵심 교훈
1. vi.mock 경로: 테스트 파일 기준 상대경로. `src/routes/__tests__/`에서 `../../lib/` = `src/lib/`
2. auth 미들웨어 mock은 `../../middlewares/auth.js` (테스트 파일 기준)
3. drizzle SQL 객체 구조상 HTTP mock 테스트에서 쿼리 텍스트 매칭 어려움 → UNIT/COMPONENT 테스트로 전환이 안정적
4. validateApprovalChecklist ROLE 검사: VALID_ROLES에 "parent"(legacy) 포함 필수 — cs-05r seedItem이 "parent" 사용
5. 에러 코드 변경 시 cs12-17-closure.test.ts 소스 분석 테스트도 함께 확인 필요
