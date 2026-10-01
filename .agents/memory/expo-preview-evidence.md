---
name: Expo 미리보기 검증 경계
description: 다중 artifact 환경의 미리보기 라우팅과 native 검증을 구분하는 이유
---

Expo 기본 브라우저 미리보기가 실제로 어느 서비스를 표시하는지 확인한다. 다른 서비스의 정상 응답을 native 앱 실행 성공으로 판단하지 않는다.

**Why:** 2026-10-01 Expo와 Metro가 실행되고 두 플랫폼 Hermes export도 성공했지만, 기본 미리보기는 API 서버의 health JSON을 표시했다. 이 환경의 프록시 라우팅 문제는 native 컴파일 결과와 별개였다.

**How to apply:** 미리보기 응답을 확인하고 라우팅 문제는 별도 범위로 다룬다. 전체 native 실기기 확인, 합성 데이터로 실행한 실제 컴포넌트 인터랙션, Hermes export를 구분하여 보고한다. 개발 미리보기 문제를 해결하려고 운영 API 주소나 정상 가입 로직을 변경하지 않는다.