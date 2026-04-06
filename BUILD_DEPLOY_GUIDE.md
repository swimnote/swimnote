# SwimNote — Build & Deploy Guide

> 작성일: 2026-04-06

---

## 1. 의존성 설치

```bash
# 루트 디렉토리에서 (모노레포 전체 설치)
pnpm install
```

---

## 2. API 서버 로컬 실행

```bash
# 방법 1: pnpm workspace 필터
pnpm --filter @workspace/api-server run dev

# 방법 2: 직접 이동
cd artifacts/api-server
pnpm dev
```

- 포트: `8080`
- 시작 시 DB 테이블 자동 생성 (`super-db-init.ts` 실행)
- 학부모 자동 연결 스케줄러 시작 (매 1분)
- 로그에 `Server listening on port 8080` 출력 확인

---

## 3. 앱 로컬 실행

```bash
# 방법 1: pnpm workspace 필터
pnpm --filter @workspace/swim-app run dev

# 방법 2: 직접 이동
cd artifacts/swim-app
pnpm dev  # 또는 npx expo start
```

- Metro 번들러 시작 → QR 코드로 Expo Go 실행
- 로컬 실행 시 `EXPO_PUBLIC_API_URL=http://localhost:8080/api` 필요

---

## 4. EAS 빌드 (App Store / Play Store)

### 사전 준비

```bash
cd artifacts/swim-app

# 인증 확인
EXPO_TOKEN=<your-token> eas whoami
```

### iOS 빌드

```bash
# 빌드만
EXPO_TOKEN=<your-token> eas build --platform ios --profile production

# 빌드 + TestFlight 자동 제출
EXPO_TOKEN=<your-token> eas build --platform ios --profile production --auto-submit
```

### Android 빌드

```bash
EXPO_TOKEN=<your-token> eas build --platform android --profile production
```

### 빌드 후 TestFlight 제출 (iOS)

```bash
EXPO_TOKEN=<your-token> eas submit --platform ios --profile production
```

---

## 5. 현재 빌드 설정

| 항목 | 값 |
|---|---|
| 앱 버전 | 1.2.0 |
| iOS Build Number | 72 |
| Android versionCode | 100 |
| Expo SDK | 54 |
| Bundle ID | com.swimnote.app |
| EAS Project ID | 7d0e0faa-32d8-4f40-88c4-2c99e0613afc |
| Apple Team ID | 78G5C9G5Z4 |
| ASC App ID | 6761360360 |
| autoIncrement | false (app.json 값 그대로 사용) |

> 다음 빌드 시 `app.json`의 `buildNumber`를 수동으로 올려야 합니다 (현재 `autoIncrement: false`).

---

## 6. 빌드번호 올리는 방법

```json
// artifacts/swim-app/app.json
{
  "expo": {
    "ios": {
      "buildNumber": "73"   // ← 여기 증가
    },
    "android": {
      "versionCode": 101    // ← 여기 증가
    }
  }
}
```

---

## 7. 프로덕션 서버 배포

현재 Replit에서 호스팅 중 (`swimnote-8.replit.app`).

**Cursor/로컬 이전 시:**

1. API 서버를 다른 서버(Railway, Render, EC2 등)에 배포
2. `artifacts/swim-app/eas.json`의 `build.production.env` 수정:
   ```json
   "EXPO_PUBLIC_API_URL": "https://your-new-server.com/api",
   "EXPO_PUBLIC_DOMAIN": "your-new-server.com"
   ```
3. 개인정보처리방침 URL도 새 서버 주소로 App Store Connect에서 업데이트

---

## 8. GitHub 연동 정보

- **Remote**: `https://github.com/swimnote/swimnote.git`
- **Branch**: `main`
- **Push 방법**:
  ```bash
  git add -A
  git commit -m "your message"
  git push origin main
  ```

---

## 9. App Store Connect 제출 체크리스트

- [ ] Privacy Policy URL 입력: `https://swimnote-8.replit.app/api/privacy-policy`
- [ ] 스크린샷 업로드 (iPhone 6.5" / 5.5")
- [ ] 앱 설명 한국어/영어 작성
- [ ] 연령 등급 설정
- [ ] TestFlight 빌드 확인 후 심사 제출
