---
name: A3 Onboarding Cleanup 완료
description: A3 — 전체 앱 온보딩/Empty State 전수 감사 + 4개 파일 수정. 내용 요약.
---

## 완료 상태

- SHA: 9e67df1c
- OTA production: cc7689db · OTA preview: 64fa9282
- 수정 파일: 4개

## BATCH 1 감사 결과 요약 (변경 없는 항목)

- **onboarding-admin/teacher/parent** — AsyncStorage persistence 존재 (`@swimnote:onboarded_${id}_role`) → 기존 사용자 재노출 없음 ✅
- **x-setup.tsx** — user-visible 내부 용어 없음 (config_status/READY/entitlement = JS 조건문만, 사용자 화면에 "SWIMNOTE X 준비 중" / "커리큘럼 설정 요청하기" / statusLabel 등 user-friendly 문구 사용) ✅
- **XModeGuard** — lock states 사용자 친화적 ✅
- **Parent children.tsx** — 자녀 미연결 상태 명확히 처리 ✅
- **Login/Signup** — 내부 용어 없음, skip/CTA 동작 정상 ✅
- **A2 AI guards** — curriculum-chat/growth-report-detail/parent home AI btn/teacher diary AI — 모두 mode === "x" 가드 ✅

## 변경 내용

1. **`app/(auth)/onboarding-admin.tsx`** — `goToSetting(path)` dead function 제거; `SlideChecklist`에서 미사용 `onNavigate` prop 제거
2. **`app/(teacher)/today-schedule.tsx`** — "오늘 수업 없음" + "편하게 쉬어가세요" → "오늘 배정된 수업이 없습니다" + "수업이 배정되면 여기에 표시됩니다"
3. **`app/(parent)/level.tsx`** — "자녀를 선택해주세요" empty state에 sub-text + "홈으로 가기" Navy 버튼 추가; router import 추가
4. **`app/(parent)/diary.tsx`** — "자녀를 선택해주세요" empty state에 "홈으로 가기" Navy Pressable 추가; homeBtn/homeBtnTxt 스타일 추가

## 감사에서 남긴 항목 (의도적 NO CHANGE)

- onboarding 슬라이드 콘텐츠 전체 — skip 가능 + AsyncStorage 보호로 원칙 준수
- class-management.tsx "등록된 반이 없습니다" — 반 생성 라우트 불명확으로 잘못된 CTA 추가 금지(스펙 §14)
- Parent children.tsx 자동연결 안내 — 항상 표시되는 informational text (dismissible guide 아님)

## 다음 단계

A4_MODAL_ALERT_SHEET_CLEANUP (A3 PASS 전 시작 금지)
