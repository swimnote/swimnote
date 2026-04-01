# PROJECT_RECOVERY_AUDIT.md — 스윔노트 프로젝트 복구 분석

> 작성일: 2026-04-01 | 분석 기준: 현재 Replit 운영 환경

---

## A. 프로젝트 기본 구조

### 모노레포 구조 (pnpm workspace)
```
/
├── artifacts/
│   ├── swim-app/          # 모바일 앱 (React Native + Expo)
│   ├── api-server/        # 백엔드 API (Node.js + Express + Drizzle ORM)
│   └── mockup-sandbox/    # UI 컴포넌트 프리뷰 (Vite)
├── packages/
│   └── db/                # DB 스키마 공유 패키지 (Drizzle ORM)
├── scripts/               # DB 유틸리티 스크립트
├── lib/                   # 공유 라이브러리
└── pnpm-workspace.yaml    # pnpm 모노레포 설정
```

### 기술 스택

| 레이어 | 기술 |
|--------|------|
| 모바일 앱 | React Native + Expo SDK, Expo Router |
| 백엔드 API | Node.js + Express + TypeScript (tsx) |
| ORM | Drizzle ORM |
| DB | PostgreSQL (Supabase — ap-south-1) |
| 스토리지 | Replit Object Storage (`@replit/object-storage`) ⚠️ |
| SMS | 네이버 SENS (기본) / 대체 가능 |
| 결제 | 포트원(PortOne) + 토스(Toss) |
| 푸시 알림 | Expo Push Notifications (FCM/APNs) |
| 빌드 | EAS Build (Expo Application Services) |
| 배포 | Replit Autoscale (API), App Store + Google Play (앱) |
| 패키지 관리 | pnpm |

### 설정 파일 존재 여부
- [x] `pnpm-workspace.yaml` (모노레포 설정)
- [x] `package.json` (루트)
- [x] `artifacts/swim-app/package.json`
- [x] `artifacts/swim-app/app.json` (Expo 설정)
- [x] `artifacts/swim-app/eas.json` (EAS 빌드 설정)
- [x] `artifacts/api-server/package.json`
- [x] `tsconfig.base.json` + 각 패키지 `tsconfig.json`
- [x] `babel.config.js` (swim-app)
- [ ] `drizzle.config.ts` (없음 — 스키마는 코드 내 정의)
- [ ] `migrations/` 디렉토리 (없음 — `db:push` 방식 사용)

### 실행 명령어 요약
```bash
# 설치
pnpm install

# 개발 실행
pnpm --filter @workspace/api-server run dev      # API 서버 (포트 8080)
pnpm --filter @workspace/swim-app run dev         # 모바일 앱 (Expo Go)

# 프로덕션 빌드
pnpm --filter @workspace/api-server run build    # API 빌드

# EAS 빌드 (앱)
npx eas build --platform android --profile production --non-interactive
npx eas build --platform ios --profile production --non-interactive
```

---

## B. 외부 의존 서비스

| 서비스 | 용도 | 필수 여부 |
|--------|------|----------|
| **Supabase** (ap-south-1) | 메인 PostgreSQL DB (users, pools 등) | 필수 |
| **Supabase** (별도 URL) | 풀별 DB 백업 | 필수 |
| **Replit Object Storage** | 사진/영상 파일 저장 | ⚠️ Replit 전용 |
| **네이버 SENS** | SMS 인증번호 발송 | 필수 |
| **PortOne** | 결제 처리 | 필수 |
| **Toss Payments** | 결제 처리 (대체) | 선택 |
| **Expo EAS** | 앱 빌드/배포 | 필수 |
| **Expo Push** | 푸시 알림 | 필수 |
| **Apple App Store** | iOS 앱 배포 | 필수 |
| **Google Play** | Android 앱 배포 | 필수 |

---

## C. 배포 및 운영 구조

### API 서버
- **개발**: Replit 워크플로우 (`pnpm --filter @workspace/api-server run dev`)
- **운영**: Replit Autoscale 배포 → `https://swimnote-7.replit.app/api`
- **빌드**: `pnpm --filter @workspace/api-server run build` → `dist/index.cjs`

### 모바일 앱
- **번들 ID**: `com.swimnote.app`
- **개발**: Expo Go (`exp://...`)
- **프로덕션**: EAS Build → App Store / Google Play
- **Android versionCode**: 34 (현재)
- **iOS buildNumber**: 5 (현재)

### 도메인/URL
- API URL: `https://swimnote-7.replit.app/api` (Replit 배포 URL)
- 개발 API: `http://localhost:8080/api`

---

## D. 위험요소 분석

### 🔴 높은 위험
| 항목 | 상세 |
|------|------|
| **Replit Object Storage** | `@replit/object-storage` 패키지 사용 — Replit 전용 서비스. 다른 환경에서는 완전히 대체 필요 (Cloudflare R2, S3 등) |
| **API URL 하드코딩** | `artifacts/swim-app/.env`에 `swimnote-7.replit.app` 하드코딩 — Replit 사라지면 앱이 API 연결 불가 |

### 🟡 중간 위험
| 항목 | 상세 |
|------|------|
| **마이그레이션 파일 없음** | `db:push` 방식으로 스키마 관리 — DB 완전 초기화 시 Drizzle 스키마 코드 기준으로만 복원 가능 |
| **Replit Secrets 의존** | 모든 환경변수가 Replit Secrets에만 존재 — 이관 시 수동 재입력 필요 |

### 🟢 낮은 위험
| 항목 | 상세 |
|------|------|
| **`REPLIT_DEV_DOMAIN`** | 개발 환경에서만 사용, 운영에는 영향 없음 |
| **pnpm 버전** | `pnpm-lock.yaml` 있음 — 재현 가능 |
