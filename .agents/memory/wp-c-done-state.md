---
name: WP-C 완료 상태
description: AI 커리큘럼 검색 Chat UI — Normal 버튼 노출, 서버 권위 eligibility, 다자녀 지원
---

## WP-C 완료 상태

**SHA**: e346fd39  
**브랜치**: deploy-photo-clone  
**Task**: #44 (MERGED)

## 변경 파일

### 서버 (parent-curriculum.ts)
- history GET 응답에 `eligible: boolean` + `reason?: "CURRICULUM_NOT_AVAILABLE" | "CURRICULUM_NOT_READY"` additive 필드 추가
- Normal/x_pending → eligible:false, reason:CURRICULUM_NOT_AVAILABLE
- X + curriculum <300 → eligible:false, reason:CURRICULUM_NOT_READY
- X + curriculum ≥300 → eligible:true (기존 메시지/usage 응답 유지)
- AI/GPT 호출 없음, quota 차감 없음

### 앱 (curriculum-chat.tsx)
- XModeGuard 제거 — Normal 학부모도 진입 가능
- 서버 권위 eligibility: history GET 응답의 eligible/reason으로 결정 (global useMode() 불사용)
- NOT_AVAILABLE/NOT_READY → 입력창/추천질문 숨김, AI 호출 없음
- 다자녀 switcher: studentId-scoped ref guard (race-condition free)
- 학생 전환 시 eligibility UNKNOWN 리셋 → history 재로드
- 답변 복사 버튼 (expo-clipboard + useToast)
- Retryable error: "답변을 불러오지 못했습니다. 잠시 후 다시 시도해주세요." + retry 버튼
- 추천 질문 업데이트 (4개)
- 할당량 초과 메시지 spec 기준 업데이트

### 앱 (home.tsx)
- 커리큘럼 검색 버튼: `selectedStudent && (mode === "x" || mode === "x_pending")` → `selectedStudent` (모든 학부모)
- AI 성장 리포트 버튼: X/x_pending 전용 유지

## 미배포 (별도 승인 필요)
- Render.com 재배포
- iOS OTA production 채널

## Follow-up
- #45: WP-C 서버+앱 배포 + Normal/NOT_READY/다자녀 테스트
