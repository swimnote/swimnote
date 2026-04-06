# SwimNote — Project Handoff

> 작성일: 2026-04-06 | 이전 대상: Cursor  
> 현재 버전: v1.2.0 / iOS Build #72 / Android versionCode 100

---

## 프로젝트 개요

SwimNote는 어린이 수영장 운영 B2B SaaS 플랫폼입니다.  
수영장 운영자(admin) · 선생님(teacher) · 학부모(parent) 세 역할을 연결합니다.

- **앱**: React Native (Expo SDK 54, New Architecture)
- **서버**: Node.js + Express + TypeScript
- **DB**: PostgreSQL (단일 DB, Drizzle ORM)
- **스토리지**: Cloudflare R2 (사진/영상)
- **결제**: RevenueCat (iOS/Android 구독)
- **푸시**: Expo Notifications (FCM/APNs)
- **배포**: Replit (API 서버) / EAS (앱 빌드)

---

## 현재 정상 동작하는 기능 목록

### 어드민 (수영장 관리자)
- 대시보드, 회원 목록, 회원 상세
- 수업 관리, 반 관리, 스케줄
- 출결 처리, 보강 관리
- 공지사항, 메신저(풀 단위 채팅)
- 선생님 계정 관리 및 초대
- 학부모 계정 승인/관리
- 데이터 백업/복구
- 사진·영상 업로드(Cloudflare R2)
- 화이트라벨 브랜딩(색상, 로고)
- 정산, 수익 관리
- RevenueCat 구독 관리
- QR 초대코드 생성

### 선생님
- 오늘 스케줄, 출결 체크
- 수업 일지 작성, 사진 첨부
- 학부모 쪽지 수신 (UnreadMessagesModal)
- 보강 관리, 공지, 메신저
- 정산 내역 조회

### 학부모 (Parent V2)
- 홈: linked / pending / no_pool 3-way 상태 분기
- 수업 일지 열람
- 선생님에게 쪽지 전송 (10초 폴링으로 실시간 반영)
- 출결 이력, 성장 리포트
- 사진 열람
- 자녀 관리

### 공통
- Apple 로그인, 카카오 로그인, 이메일 로그인
- 푸시 알림
- 개인정보처리방침: `https://swimnote-8.replit.app/api/privacy-policy`
- 이용약관: `https://swimnote-8.replit.app/api/terms`

---

## 미완료 / 보류 기능

| 기능 | 상태 | 파일 위치 |
|---|---|---|
| 선생님 → 학부모 답장 UI | 미구현 (학부모→선생님 단방향만 있음) | - |
| 학부모 자녀 추가 (add-child) | 화면 존재, V2 플로우 미완성 | `app/(parent)/add-child.tsx` |
| 학부모 자녀 연결 (link-child) | 화면 존재, V2 플로우 미완성 | `app/(parent)/link-child.tsx` |
| Android Play Store 자동 제출 | `google-service-account.json` 필요 | `eas.json` submit.android |
| 이용약관 공개 웹페이지 | API 서버에 `/api/terms` 엔드포인트로 구현됨 | `routes/privacy-page.ts` |

---

## 절대 건드리면 안 되는 안정화 구간

| 파일/구간 | 이유 |
|---|---|
| `jobs/parent-link-scheduler.ts` | V2 학부모↔학생 자동 연결 핵심. 로직 변경 시 연결 누락 |
| `migrations/super-db-init.ts` | 서버 시작 시 테이블 자동 생성. 순서/조건 변경 시 운영 DB 파손 |
| `app/(parent)/home.tsx` V2 상태 분기 | `linked/pending/no_pool` 3-way. 건드리면 로그인 루프 발생 |
| `assets/images/icon.png` | 1024×1024, bKGD 제거된 Apple 심사 통과 파일. 교체 금지 |
| `assets/images/swimnote-logo.png` | 스플래시용 1160×960. 비율 유지 필수 |
| Apple Sign-In entitlements | `app.json` + `eas.json` + `ios/SwimNote/SwimNote.entitlements` 3파일 일치 필수 |
| `context/AuthContext.tsx` | 전역 인증 상태. 수정 시 앱 전체 영향 |

---

## Replit 의존 요소

| 요소 | 내용 | 이전 시 처리 방법 |
|---|---|---|
| API 서버 호스팅 | `swimnote-8.replit.app` | 다른 서버로 이전 후 `EXPO_PUBLIC_API_URL` 변경 |
| 개인정보처리방침 URL | `swimnote-8.replit.app/api/privacy-policy` | 서버 이전 시 URL 업데이트 |
| 이용약관 URL | `swimnote-8.replit.app/api/terms` | 동일 |
| `EXPO_TOKEN` | Replit 워크플로우에 하드코딩 | 로컬 환경에서 `eas login` 또는 EXPO_TOKEN 별도 관리 |

---

## Cursor에서 가장 먼저 해야 할 3단계

1. **`.env` 파일 생성** — `ENVIRONMENT_SETUP.md` 참고하여 API 서버 `.env` 작성
2. **`pnpm install`** — 루트에서 실행하여 전체 의존성 설치
3. **API 서버 + 앱 동시 실행** — `BUILD_DEPLOY_GUIDE.md`의 로컬 실행 명령 참고
