# ENVIRONMENT_SETUP.md — 환경변수 설정 가이드

> 모든 환경변수는 **절대 Git에 커밋하지 말 것**
> Replit에서는 Secrets 패널에서 설정, 다른 환경에서는 `.env` 파일 사용

---

## API 서버 환경변수 (`artifacts/api-server`)

### DB 연결

| 변수명 | 설명 | 필수 | 예시 |
|--------|------|------|------|
| `SUPABASE_DATABASE_URL` | 메인 DB (users, pools, 선생님, 관리자) | ✅ | `postgresql://postgres:[PW]@db.[ID].supabase.co:5432/postgres` |
| `POOL_DATABASE_URL` | 풀별 DB (parent_accounts, schedules 등) | ✅ | `postgresql://postgres:[PW]@db.[ID].supabase.co:5432/postgres` |
| `SUPER_PROTECT_DATABASE_URL` | 보호 백업 DB (선택) | ❌ | `postgresql://...` |

### 인증 및 보안

| 변수명 | 설명 | 필수 | 예시 |
|--------|------|------|------|
| `JWT_SECRET` | JWT 토큰 서명 비밀키 | ✅ | `your-very-long-random-secret-key` |

### 파일 스토리지

| 변수명 | 설명 | 필수 | 예시 |
|--------|------|------|------|
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Replit Object Storage 버킷 ID | ✅⚠️ | `bucket-xxxxx` |
| `R2_PHOTO_BUCKET` | 사진 저장 버킷명 (Cloudflare R2) | ❌ | `swimnote-photos` |
| `R2_VIDEO_BUCKET` | 영상 저장 버킷명 (Cloudflare R2) | ❌ | `swimnote-videos` |

> ⚠️ 현재 파일 저장은 Replit Object Storage 사용 중. 다른 환경으로 이관 시 R2/S3 연동 필요

### SMS 발송

| 변수명 | 설명 | 필수 | 예시 |
|--------|------|------|------|
| `SMS_PROVIDER` | SMS 제공자 선택 | ✅ | `naver` 또는 `coolsms` |
| `NAVER_SENS_ACCESS_KEY` | 네이버 SENS Access Key | ✅ (naver 사용 시) | `ACCESSKEY` |
| `NAVER_SENS_SECRET_KEY` | 네이버 SENS Secret Key | ✅ (naver 사용 시) | `SECRETKEY` |
| `NAVER_SENS_SENDER_PHONE` | 발신 전화번호 | ✅ | `01012345678` |
| `NAVER_SENS_SERVICE_ID` | SENS 서비스 ID | ✅ (naver 사용 시) | `ncp:sms:kr:...` |
| `SMS_API_KEY` | 대체 SMS API Key (coolsms 등) | ❌ | `key-xxx` |
| `SMS_API_SECRET` | 대체 SMS API Secret | ❌ | `secret-xxx` |
| `SMS_USER_ID` | 대체 SMS 계정 ID | ❌ | `user@email.com` |
| `SMS_SENDER_PHONE` | 대체 SMS 발신번호 | ❌ | `01012345678` |
| `SMS_DEV_EXPOSE_CODE` | 개발 환경 SMS 코드 노출 여부 | ❌ | `true` |

### 결제

| 변수명 | 설명 | 필수 | 예시 |
|--------|------|------|------|
| `PAYMENT_PROVIDER` | 결제 제공자 | ✅ | `portone` 또는 `toss` |
| `PORTONE_API_SECRET` | 포트원 API Secret | ✅ (portone 사용 시) | `secret_xxx` |
| `PORTONE_CHANNEL_KEY` | 포트원 채널 키 | ✅ (portone 사용 시) | `channel-key-xxx` |
| `TOSS_SECRET_KEY` | 토스 결제 시크릿 키 | ✅ (toss 사용 시) | `test_sk_xxx` |

### 제한 설정

| 변수명 | 설명 | 기본값 | 예시 |
|--------|------|--------|------|
| `PHOTO_LIMIT_MB` | 사진 업로드 제한 (MB) | `10` | `10` |
| `VIDEO_LIMIT_MB` | 영상 업로드 제한 (MB) | `100` | `100` |
| `POOL_DB_LIMIT_MB` | DB 용량 제한 (MB) | `500` | `500` |
| `SUPER_DB_LIMIT_MB` | 슈퍼 DB 용량 제한 (MB) | `1000` | `1000` |

### 시스템

| 변수명 | 설명 | 필수 | 예시 |
|--------|------|------|------|
| `NODE_ENV` | 실행 환경 | ✅ | `production` |
| `PORT` | 서버 포트 | ❌ | `8080` |
| `REPLIT_DEV_DOMAIN` | Replit 개발 도메인 (자동 주입) | Replit만 | 자동 |

---

## 모바일 앱 환경변수 (`artifacts/swim-app/.env`)

| 변수명 | 설명 | 필수 | 예시 |
|--------|------|------|------|
| `EXPO_PUBLIC_API_URL` | API 서버 URL | ✅ | `https://your-api.com/api` |
| `EXPO_PUBLIC_DOMAIN` | API 도메인 | ✅ | `your-api.com` |

---

## EAS 빌드 환경변수 (`artifacts/swim-app/eas.json`)

`production` 빌드 프로필에서 자동으로 주입됨:
- `EXPO_PUBLIC_API_URL=https://swimnote-7.replit.app/api`
- `EXPO_PUBLIC_DOMAIN=swimnote-7.replit.app`

> 이관 시 `eas.json`의 `build.production.env` 값도 변경 필요

---

## 환경변수 설정 방법

### Replit (현재 운영)
Replit 프로젝트 → Secrets 패널 → 키/값 추가

### 다른 환경 (이관 시)
```bash
cp .env.example .env
# .env 파일에서 실제 값 입력
```
