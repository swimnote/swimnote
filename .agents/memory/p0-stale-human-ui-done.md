---
name: P0-STALE-HUMAN-UI 완료 상태
description: auto HUMAN_REQUIRED → FAQ 성공 후에도 stale UI(상담사 연결 대기/legacy ack/CTA) 잔류 버그 수정
---

## 버그 요약
parent가 "스윔노트X에 대해 알려줘" 첫 질문 → NO_MATCH → HUMAN_REQUIRED.
Knowledge 승인 후 두 번째 같은 질문 → FAQ 정상 답변 표시, BUT 이전 HUMAN_REQUIRED UI가 잔류:
- 헤더: "상담사 연결 대기"
- 본문: "문의가 접수되었습니다. 운영팀이 확인 후 답변드립니다."
- CTA 카드: "상담사에게 문의하기" / "상담사가 확인 중입니다"

## 근본 원인 (3개)

**Bug 1 (Server): VALID_TRANSITIONS 미완성**
`VALID_TRANSITIONS["HUMAN_REQUIRED"]` = `["HUMAN_RESPONDED","ESCALATED","PHONE_REQUIRED"]`
→ "AI_PROCESSING" 없음 → `transitionSupportCase` 422 reject (`.catch(()=>{})` 무음 실패)
→ case 영구 HUMAN_REQUIRED

**Bug 2 (Server): AI_PROCESSING_FROM gate 미포함**
`AI_PROCESSING_FROM = new Set(["NEW","REOPENED","AI_RESPONDED","WAITING"])`
→ HUMAN_REQUIRED 케이스에서 AI_PROCESSING 전환 시도 자체 안 함

**Bug 3 (Mobile): legacy ack 조건 과다**
조건: `!messages.some(m => m.author_role === "system")`
→ isHuman 체크 없어서 FAQ 성공 후에도 표시

## 수정 내용

**support-case-service.ts:**
`HUMAN_REQUIRED: [..., "AI_PROCESSING"]` — AI 복구 경로 개방

**support-respond.ts:**
`isAutoHumanRequired = sc.state === "HUMAN_REQUIRED" && !sc.ticket_id && sc.escalation_reason !== "USER_REQUESTED_HUMAN"`
→ `AI_PROCESSING_FROM.has(sc.state) || isAutoHumanRequired` 조건으로 진입

**SupportChatScreen.tsx:**
- legacy ack: `isHuman &&` 조건 추가 (STALE-05)
- `fetchCaseDetail`: non-human master_state 시 `setShowHumanCta(false)` 리셋 (STALE-06)

## 보호된 케이스 (regression 없음)
- `ticket_id != null` OR `escalation_reason = "USER_REQUESTED_HUMAN"` → AI_PROCESSING 차단 유지
- 과거 NO_MATCH 메시지는 DB에서 삭제하지 않음 (conversation history 보존)

**Why:** auto-fallback vs 사용자 명시 요청 구분이 핵심. ticket 존재 = 인간 에이전트 workflow 시작 = AI가 임의로 취소 불가.

**How to apply:** 이 패턴 재발 시 - escalation_reason + ticket_id 두 가지 모두 확인 필요.

## 배포 결과
- COMMIT_SHA = fcc5c3f8
- STALE 18TC + 전체 1776TC passed (58 files)
- Render deploy = push→auto-build 트리거
- iOS OTA production = 01a01295-fdcd-7ce4-8701-bab3b1e1d724 (branch=production, runtime=1.6.3)
- Android OTA = NO
- Preview OTA = NO
