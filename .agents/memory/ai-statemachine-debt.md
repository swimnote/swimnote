---
name: AI StateMachine Refactoring Candidate
description: handleSubmit()의 RESULT→INPUT→PROCESSING 경로가 React dispatch batching에 의존하는 구조적 취약점 — 실 API 연동 완료 후 리팩터링 예정
---

## 대상

- `useDiaryAI.ts` — `handleSubmit()`
- 향후 동일 패턴을 사용할 모든 AI feature hook

## 문제

RESULT 상태에서 "다시 생성" 클릭 시 두 dispatch가 연속 호출됨:

```ts
machine.retry('INPUT');   // dispatch #1: RESULT → INPUT
machine.submit();          // dispatch #2: INPUT → PROCESSING
```

React `useReducer`는 동기 블록 내 연속 dispatch를 순차 배치로 처리하므로 현재는 정상 동작.
그러나 이는 React 공식 문서에 명시된 보장이 아니며, `startTransition` 또는 Concurrent 렌더링 환경에서는 interleaving 가능성이 있음.

## 목표

- React dispatch batching 의존 제거
- `handleSubmit()`과 `handleResubmit()` 경로 명확히 분리
- 공통 AI 기능(STT/OCR/영상/사진/Parent AI) 추가 시 동일 패턴 적용

## 검토 옵션

**Option C (권장 — 장기):** `useEffect` + `pendingRef`
- `machine.retry('INPUT')` 후 렌더에서 실제로 INPUT이 확정된 시점에 `machine.submit()` 호출
- dispatch 완전 분리, batching 제거

**Option D (권장 — 단기):** 함수 분리
- `handleSubmit()`: INPUT → PROCESSING (첫 생성)
- `handleResubmit()`: RESULT → INPUT → PROCESSING (재생성, batching 격리)
- 변경 최소화

## 적용 시점

모든 AI 입력 기능(STT/OCR/영상/사진/Parent AI) 연결 완료 +
실 AI API 연동 완료 이후 공통 AI 모듈 리팩터링 단계에서 Option C vs D 최종 비교 후 결정.

**Why:** 현재 실제 버그 없음. 기능 완성 우선. Phase 3 API 연동 전에는 구조 변경 보류.
**How to apply:** 이 파일을 공통 AI 모듈 리팩터링 시작 전에 반드시 참조할 것.
