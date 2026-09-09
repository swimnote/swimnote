---
name: 다음 빌드 포함 변경 사항
description: 최신 빌드 이후 코드에 반영됐으나 아직 다음 빌드에서 전달되지 않은 변경 목록
---

## Android 243 이후 미배포 변경 (서버측)
- Task8 FIX: ALL paid EXPIRATION → PAYMENT_SUSPENDED (만료 원인 무관) — 서버 코드, OTA 배포됨
- 앱 Task8 FIX: admin layout redirect loop 수정 (usePathname) — OTA 배포됨

## 다음 Android 빌드 시 포함 예정
- 위 OTA들은 Android에 자동으로 OTA를 통해 반영됨 (runtimeVersion 2.1.0 동일)
