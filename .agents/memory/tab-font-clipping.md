---
name: 탭 텍스트 Pretendard 클리핑
description: iOS 탭 바에서 fontFamily Pretendard 사용 시 한글 받침이 세로로 잘리는 버그와 해결법
---

## 규칙
탭 바(`tabText`, `tabTxt` 등)의 Text 컴포넌트에 `fontFamily: "Pretendard-Regular"` 사용 금지.
대신 `lineHeight`를 fontSize × 1.4 수준으로 명시한다.

## 기준 lineHeight
- fontSize 11 → lineHeight 16
- fontSize 12 → lineHeight 17
- fontSize 13 → lineHeight 18
- fontSize 14 → lineHeight 20

## tabBtn overflow
탭 Pressable에는 `overflow: "visible"` 추가 권장.

**Why:** iOS에서 Pretendard 폰트의 글리프 메트릭이 React Native 컨테이너 높이 계산과 맞지 않아 받침 자음(ㄱ, ㄹ, ㅇ 등)이 컨테이너 하단 경계에서 잘림.

**How to apply:** 새로 탭 바 Text 스타일 추가 시 fontFamily 대신 lineHeight만 명시. 기존 파일은 이미 수정 완료(2026-07-02).
