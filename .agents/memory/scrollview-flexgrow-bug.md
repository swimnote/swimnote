---
name: ScrollView contentContainerStyle flexGrow:0 스크롤 불가 버그
description: React Native ScrollView의 contentContainerStyle에 flexGrow:0을 넣으면 스크롤이 작동하지 않음
---

## 규칙

ScrollView의 `contentContainerStyle`에 `flexGrow: 0`을 **절대 넣지 말 것**.

**Why:** React Native ScrollView는 contentContainerStyle의 flexGrow:0을 보고 스크롤 가능 높이를 0으로 계산한다. 내용이 아무리 길어도 스크롤이 막힌다. flexGrow:0은 contentContainerStyle 기본값(0)이므로 명시해도 의미가 없고 오히려 내부 레이아웃 계산을 방해한다.

**How to apply:**
- ScrollView contentContainerStyle에는 padding 값만 넣을 것
- 올바른 패턴:
  ```tsx
  contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 56 }}
  ```
- 잘못된 패턴:
  ```tsx
  contentContainerStyle={{ ..., flexGrow: 0 }}  // ← 스크롤 불가
  ```
- ScrollView 자체(style prop)에는 `flex: 1` 유지, BodyWrapper에 `flex: 1, minHeight: 0` 유지
