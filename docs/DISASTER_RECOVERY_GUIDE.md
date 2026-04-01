# DISASTER_RECOVERY_GUIDE.md — 재해 복구 가이드

> 리플릿이 사라지거나 서비스 장애 발생 시 다른 환경에서 복구하는 절차

---

## 1. 프로젝트 클론 및 설치

```bash
# 1. 저장소 클론
git clone https://github.com/[YOUR_REPO]/swimnote.git
cd swimnote

# 2. pnpm 설치 (없으면)
npm install -g pnpm

# 3. 의존성 설치
pnpm install

# 4. 환경변수 설정
cp .env.example artifacts/api-server/.env
# .env 파일에서 실제 값 입력 (ENVIRONMENT_SETUP.md 참고)

# 5. 앱 환경변수 설정
cp .env.example artifacts/swim-app/.env
# EXPO_PUBLIC_API_URL=https://your-new-api-url/api
# EXPO_PUBLIC_DOMAIN=your-new-api-domain
```

---

## 2. 개발 환경 실행

```bash
# API 서버 실행 (터미널 1)
pnpm --filter @workspace/api-server run dev
# → http://localhost:8080/api

# 모바일 앱 실행 (터미널 2)
pnpm --filter @workspace/swim-app run dev
# → Expo Go로 QR 스캔하여 실행

# 헬스체크
curl http://localhost:8080/api/healthz
```

---

## 3. 운영 빌드

### API 서버
```bash
pnpm --filter @workspace/api-server run build
# → artifacts/api-server/dist/index.cjs 생성

# 실행
node artifacts/api-server/dist/index.cjs
```

### 모바일 앱 (EAS 빌드)

**사전 필요:**
- Expo 계정 (`swimnote`)
- EAS CLI: `npm install -g eas-cli`
- Apple Developer 계정 (iOS)
- Google Play Console (Android)
- `EXPO_TOKEN` 환경변수

```bash
# Expo 로그인
EXPO_TOKEN=[토큰] npx eas whoami

# Android 빌드
EXPO_TOKEN=[토큰] npx eas build \
  --platform android \
  --profile production \
  --non-interactive

# iOS 빌드
EXPO_TOKEN=[토큰] npx eas build \
  --platform ios \
  --profile production \
  --non-interactive
```

---

## 4. 배포 대상별 이관 방법

### API 서버 이관 (Replit → Railway/Render/Fly.io)

| 단계 | 작업 |
|------|------|
| 1 | 새 서비스 생성 (Railway/Render) |
| 2 | GitHub 저장소 연결 |
| 3 | Build Command: `pnpm --filter @workspace/api-server run build` |
| 4 | Start Command: `node artifacts/api-server/dist/index.cjs` |
| 5 | 환경변수 전부 주입 (ENVIRONMENT_SETUP.md 참고) |
| 6 | 새 API URL을 `artifacts/swim-app/eas.json`에 업데이트 |
| 7 | 앱 재빌드 및 스토어 제출 |

### ⚠️ Replit Object Storage 대체 (필수)

현재 사진/영상은 `@replit/object-storage`에 저장됨.
다른 환경에서는 동작하지 않으므로 아래 중 하나로 대체 필요:

**Cloudflare R2 (권장)**
```typescript
// @replit/object-storage 대신 R2 사용
// 환경변수: R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY
```

**AWS S3 (대체)**
```typescript
// 환경변수: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET
```

대체 후 `artifacts/api-server/src/` 내 Object Storage import 전부 교체 필요.

---

## 5. 장애 복구 체크리스트

### 즉시 확인 항목

- [ ] Git 저장소에서 최신 코드 pull 가능한지 확인
- [ ] Supabase DB 접속 가능한지 확인 (SUPABASE_DATABASE_URL)
- [ ] 환경변수 전부 보유 중인지 확인 (.env 백업)
- [ ] EAS 빌드 자격증명 유효한지 확인
- [ ] Apple Developer 계정 접근 가능한지 확인
- [ ] Google Play Console 접근 가능한지 확인

### 복구 순서

```
1. 코드 clone
2. 환경변수(.env) 주입
3. pnpm install
4. DB 연결 확인 (curl /api/healthz)
5. Object Storage 대체 또는 마이그레이션
6. API 서버 빌드 및 배포
7. 앱 .env의 API URL 업데이트
8. EAS 빌드 (Android → iOS)
9. 스토어 제출
10. 기능 테스트
```

---

## 6. 반드시 보관해야 하는 외부 자산

| 자산 | 보관 위치 | 비고 |
|------|----------|------|
| Git 저장소 URL | GitHub/GitLab | 코드 전체 |
| `.env` 파일 | 암호화된 안전한 저장소 | 절대 Git X |
| Supabase 접속 정보 | 패스워드 매니저 | DB 복구 핵심 |
| Expo 계정 (swimnote) | 패스워드 매니저 | 앱 빌드 |
| Apple Developer 계정 | 패스워드 매니저 | iOS 배포 |
| Google Play 계정 | 패스워드 매니저 | Android 배포 |
| EXPO_TOKEN | Replit Secrets | EAS 인증 |
| 네이버 SENS 키 | 패스워드 매니저 | SMS 발송 |
| 포트원/토스 키 | 패스워드 매니저 | 결제 |

---

## 7. 복구 난이도 평가

| 항목 | 난이도 | 비고 |
|------|--------|------|
| 코드 복구 | 쉬움 | Git clone 후 install |
| DB 복구 | 쉬움 | Supabase는 외부 서비스 — 코드 없어도 접근 가능 |
| API 서버 재배포 | 중간 | 새 플랫폼 설정 필요 |
| **Object Storage 이관** | **어려움** | Replit 전용 — 기존 파일 이전 필요 |
| 앱 재빌드 | 중간 | EAS 자격증명 필요 |
| 스토어 재제출 | 중간~느림 | Apple 심사 1~7일 |
