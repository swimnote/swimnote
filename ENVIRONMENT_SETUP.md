# SwimNote — Environment Setup

> 작성일: 2026-04-06

---

## API 서버 환경변수 (`artifacts/api-server/.env`)

아래 파일을 `artifacts/api-server/.env`로 생성하고 실제 값을 채워야 합니다.

```env
# ────────────────────────────────
# 데이터베이스
# ────────────────────────────────
DATABASE_URL=postgresql://user:password@host:5432/dbname

# 슈퍼관리자 보호백업 DB (선택 — 없으면 경고만 출력, 서버 정상 동작)
SUPER_PROTECT_DATABASE_URL=

# 풀 백업 DB (선택)
POOL_BACKUP_DATABASE_URL=

# ────────────────────────────────
# 인증
# ────────────────────────────────
JWT_SECRET=your-jwt-secret-minimum-32-chars

# ────────────────────────────────
# Cloudflare R2 — 사진 스토리지
# ────────────────────────────────
CF_R2_ACCESS_KEY_ID=
CF_R2_SECRET_ACCESS_KEY=
CF_R2_BUCKET_NAME=
CF_R2_ACCOUNT_ID=
CF_R2_PUBLIC_URL=https://your-r2-public-domain.com

# ────────────────────────────────
# Cloudflare R2 — 영상 스토리지 (별도 버킷)
# ────────────────────────────────
CF_R2_VIDEO_ACCESS_KEY_ID=
CF_R2_VIDEO_SECRET_ACCESS_KEY=
CF_R2_VIDEO_BUCKET_NAME=
CF_R2_VIDEO_PUBLIC_URL=

# ────────────────────────────────
# RevenueCat
# ────────────────────────────────
REVENUECAT_WEBHOOK_SECRET=

# ────────────────────────────────
# 기타
# ────────────────────────────────
NODE_ENV=development
PORT=8080
```

---

## 앱 환경변수 (`artifacts/swim-app/.env` 또는 `eas.json`)

로컬 개발 시 `artifacts/swim-app/.env` 파일 생성:

```env
EXPO_PUBLIC_API_URL=http://localhost:8080/api
EXPO_PUBLIC_DOMAIN=localhost:8080
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_...
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_...
```

프로덕션 빌드 시 `eas.json`의 `build.production.env` 섹션에 설정됨:

```json
"EXPO_PUBLIC_API_URL": "https://swimnote-8.replit.app/api",
"EXPO_PUBLIC_DOMAIN": "swimnote-8.replit.app"
```

---

## EAS 빌드용 Expo 인증

이메일/패스워드 로그인 **불가** — 반드시 토큰 방식 사용:

```bash
# 환경변수로 설정
export EXPO_TOKEN=your-expo-token

# 또는 명령 앞에 붙여서 실행
EXPO_TOKEN=your-expo-token eas build --platform ios --profile production
```

Expo 토큰 발급: https://expo.dev/accounts/[username]/settings/access-tokens

---

## Replit 시크릿 (참고용 — 실제 값은 Replit 대시보드에서 관리)

Replit에서 현재 설정된 시크릿 이름 목록:

```
CF_R2_ACCESS_KEY_ID
CF_R2_SECRET_ACCESS_KEY
CF_R2_VIDEO_ACCESS_KEY_ID
CF_R2_VIDEO_SECRET_ACCESS_KEY
JWT_SECRET
REVENUECAT_WEBHOOK_SECRET
```

DATABASE_URL은 Replit PostgreSQL 통합으로 자동 주입됨.

---

## Apple / Google 크리덴셜 파일

| 파일 | 위치 | 용도 |
|---|---|---|
| `asc-key.p8` | `artifacts/swim-app/asc-key.p8` | App Store Connect API 키 |
| `asc-key.json` | `artifacts/swim-app/asc-key.json` | ASC 키 메타데이터 |
| `google-service-account.json` | `artifacts/swim-app/` (현재 미존재) | Android Play Store 자동 제출용 |

> **⚠️ 주의**: `asc-key.p8`는 민감 파일입니다. `.gitignore`에 포함되어 있는지 반드시 확인하세요.

---

## 로컬 개발 환경 체크리스트

- [ ] Node.js 18+ 설치
- [ ] pnpm 설치 (`npm install -g pnpm`)
- [ ] PostgreSQL 연결 가능 (로컬 또는 원격)
- [ ] `artifacts/api-server/.env` 작성 완료
- [ ] `artifacts/swim-app/.env` 작성 완료 (로컬 API URL로)
- [ ] `pnpm install` 루트에서 실행 완료
- [ ] Expo Go 앱 또는 개발 빌드 준비
