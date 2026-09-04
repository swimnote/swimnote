# SWIMNOTE 업데이트 정책

> 배포 담당자가 반드시 숙지해야 할 운영 원칙.

---

## 업데이트 두 종류 — 절대 혼용 금지

| 종류 | 트리거 | 사용자 경험 |
|---|---|---|
| **A. Native Store Build** | 1.6.1 → 1.6.2 등 네이티브 변경 | 강제 업데이트 Modal → App Store 이동 → 구버전 사용 불가 |
| **B. Expo OTA** | 같은 runtimeVersion 내 JS 코드 변경 | 자동 감지 → 다운로드 → 재시작 Modal → 적용 |

Native update에 OTA restart를 사용하지 않는다.  
OTA update에 Store update modal을 사용하지 않는다.

---

## A. Native Store Build 배포 절차

```
1. EAS production 빌드 생성 (iOS IPA / Android AAB)
2. App Store Connect / Google Play 업로드
3. Store 심사 통과 → 실제 다운로드 가능 상태 확인
4. artifacts/api-server/src/routes/app-version.ts 수정:
   - LATEST_VERSION = "신규 버전"   ← 소프트 업데이트 안내 시작
5. GitHub push → Render 자동 배포 (또는 Render API 수동 트리거)
6. 실제 Store 다운로드 가능 확인 후:
   - MIN_VERSION = "신규 버전"       ← 강제 차단 시작
7. Render 재배포
```

> ⚠️ Store 공개 전에 MIN_VERSION을 올리면 절대 안 됩니다.  
> 사용자가 업데이트할 수 없는 상태에서 구버전이 차단됩니다.

---

## B. Expo OTA 배포 절차

```
1. runtimeVersion 확인 — Native 빌드와 동일해야 함
2. production channel에 OTA 배포:
   EAS_NO_VCS=1 EAS_PROJECT_ROOT=... eas update --channel production --message "..."
3. 앱이 cold start 또는 foreground 복귀 시 자동 감지
4. 다운로드 완료 → "업데이트 준비 완료" Modal → "지금 업데이트" → reloadAsync()
```

---

## Version Gate 코드 위치

| 항목 | 파일 | 함수 |
|---|---|---|
| Native version check | `app/_layout.tsx` | `checkNativeVersion()` |
| OTA check + download | `app/_layout.tsx` | `checkAndDownloadOta()` |
| 통합 실행 (시작/foreground) | `app/_layout.tsx` | `runStartupChecks()` |
| version 상수 | `artifacts/api-server/src/routes/app-version.ts` | `IOS_MIN_VERSION` 등 |

---

## 실행 우선순위

```
1. Native force update 판정 (min_version 비교)
   → forced? → 강제 Modal → Store 이동 → OTA check 건너뜀
   → not forced? → OTA check 진행
2. OTA check
   → update 있음? → 다운로드 → 재시작 Modal
   → update 없음? → 정상 진입
```

---

## 네트워크 실패 정책

- Version API 네트워크 실패 → **fail-open** (앱 정상 사용 가능)
- 서버가 명시적으로 `current < min_version` 판정 → **fail-closed** (강제 차단)
- OTA check 실패 → **fail-open** (앱 정상 사용 가능)

---

## DEV 환경

- `__DEV__ === true` (Expo Go, Metro 개발 서버): 모든 version check 비활성화
- TestFlight / production channel: 모든 check 활성화

---

## 버전 상수 현재값

파일: `artifacts/api-server/src/routes/app-version.ts`

| 상수 | 설명 |
|---|---|
| `IOS_MIN_VERSION` | 이 미만이면 iOS 강제 차단 |
| `IOS_LATEST_VERSION` | 이 미만이면 iOS 소프트 업데이트 안내 |
| `AOS_MIN_VERSION` | 이 미만이면 Android 강제 차단 |
| `AOS_LATEST_VERSION` | 이 미만이면 Android 소프트 업데이트 안내 |
