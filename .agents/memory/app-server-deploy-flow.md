---
name: 앱→서버 배포 흐름
description: iPhone 앱이 연결하는 서버, 배포 흐름, Render.com/OTA 구분
---

## 연결 구조

- iPhone 앱: `EXPO_PUBLIC_API_URL=https://swimnote.kr/api` (Render.com)
- Replit API 서버: 개발/테스트 전용
- DB: swimnote.kr과 Replit이 동일 외부 PostgreSQL DB 공유

## 배포 흐름

| 변경 유형 | 배포 대상 | 방법 |
|---|---|---|
| 서버 코드 (routes/*.ts) | Render.com | Render.com 수동 재배포 |
| 클라이언트 코드 (앱 .tsx) | iPhone 앱 | EAS OTA 업데이트 |
| 네이티브 변경 | iPhone 앱 | EAS 빌드 + 스토어 배포 |

## 주의사항

- Replit API 서버에서 curl 테스트해도 iPhone 앱에는 반영 안 됨
- 서버 변경 후 Render.com 재배포 없으면 구버전 코드가 운영에 계속 실행됨
- OTA 배포는 OTA 배포 패턴 참고

**Why:** 초기에 Replit API 서버를 운영 서버로 착각하여 시간 낭비. 앱의 EXPO_PUBLIC_API_URL이 swimnote.kr이므로 서버 수정은 반드시 Render.com 재배포 필요.
