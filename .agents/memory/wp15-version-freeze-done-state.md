---
name: WP15 Version/Runtime Freeze 완료
description: WP15 완료 — 최종 결정값, CASE A 판정 근거, 다음 WP 주의사항
---

## 완료 상태

- **SHA:** `aff68b8a` (pushed to `origin/release/v2.0.0`)
- **이전 SHA:** `c03446bd` (WP14)
- **테스트:** 15/15 PASS

## 최종 동결 값

| 항목 | 이전 | 이후 |
|---|---|---|
| version | 2.1.0 | **2.0.1** (Store marketing) |
| runtimeVersion | {policy:"appVersion"} | **"2.1.0"** (explicit string) |
| ios.buildNumber | "255" | **"256"** |
| android.versionCode | 239 | **240** |
| bundleIdentifier | com.swimnote.app | 변경 없음 |
| android.package | com.swimnote.app | 변경 없음 |
| production-v2 channel | production-v2 | 변경 없음 |

## CASE A 판정 근거

- WP1–WP14: JS/TS only, native deps 변경 0 (expo 55.0.28, RN 0.83.10, plugins=13 불변)
- 마지막 Store binary: build 255 / version 2.1.0 / runtime 2.1.0
- 현재 JS bundle은 runtime 2.1.0 binary와 native-compatible → CASE A

## 핵심 주의사항 (영구)

- runtimeVersion은 반드시 explicit string "2.1.0" 유지 — policy 절대 금지
  - policy:"appVersion" 복원 시 version 변경마다 runtime이 따라가서 OTA 파괴
- iOS OTA: production-v2 channel, runtime 2.1.0 compatible
- Android OTA: NO (프로젝트 영구 정책)
- WP19 Store 빌드 전까지 이 값들 변경 금지

## Render/OTA 상태

- Render: NO (서버 변경 없음)
- iOS OTA: YES — runtime 2.1.0 compatible (WP16+ 진행 시 가능)
- Android OTA: NO
- Native build: WP19에서 실행
