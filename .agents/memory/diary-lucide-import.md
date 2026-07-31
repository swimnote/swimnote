---
name: DiaryWriteView LucideIcon 버그
description: DiaryWriteView에서 LucideIcon import 누락으로 ErrorFallback 발생; 진단 방법 기록
---

# DiaryWriteView LucideIcon import 누락 → ErrorFallback

## 증상
- 교사가 일지 저장 버튼 누르면 즉시 ErrorFallback 화면으로 전환됨
- 코드 리뷰로는 원인 불명 (handleSave는 try-catch로 감싸짐)

## 근본 원인
`DiaryWriteView.tsx`에서 `LucideIcon` 컴포넌트를 4곳에서 사용하지만 import문 없음.
React render 중 `ReferenceError: Property 'LucideIcon' doesn't exist` 발생 → ErrorBoundary catch → ErrorFallback 표시.

## 진단 방법
`fetch_deployment_logs(message="CRASH_REPORT")` 로 확인.
`ErrorBoundary.componentDidCatch`가 `/crash-report` POST로 에러를 서버 console.error에 기록함.
→ 프로덕션 로그에서 `[CRASH_REPORT]` 검색으로 정확한 컴포넌트명/에러메시지 확인 가능.

**Why:** 코드 정적 분석으로는 찾기 어려운 케이스였음; 배포 로그가 디버깅의 가장 빠른 경로.

## 수정
`DiaryWriteView.tsx` 상단에 추가:
```javascript
import { LucideIcon } from "@/components/common/LucideIcon";
```
