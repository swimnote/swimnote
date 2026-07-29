---
name: Production 서버 작업 원칙
description: 서버 코드 수정 시 반드시 실제 앱이 연결된 Production 서버에서만 작업해야 한다는 최우선 원칙
---

## 최우선 원칙 — Production 서버에서만 작업

### 실제 앱 연결 구조

| 항목 | 값 |
|---|---|
| iOS/Android 앱 API Base URL | `https://swimnote.kr/api` |
| Android 앱 API Base URL | `https://swimnote.kr/api` (동일) |
| swimnote.kr 실제 서버 | Render.com (GitHub auto-deploy) |
| Replit API 서버 | 개발/테스트 전용 — 실제 앱과 무관 |

### 금지 사항

서버 코드를 수정한 뒤 아래 환경에서만 확인하고 "완료"라고 보고하는 것은 절대 금지:

- Replit API 서버 (artifacts/api-server)
- Replit Dev URL (*.replit.dev)
- Replit Preview
- Local 서버
- 임시 서버

이 서버들은 실제 iOS/Android 앱과 연결되어 있지 않다.
Replit에서 curl로 테스트해도 실제 앱 사용자에게는 아무 영향이 없다.

### 서버 코드 변경 시 필수 배포 절차

1. Replit에서 코드 수정
2. GitHub에 push → Render.com 자동 배포
3. Render.com 배포 완료 확인
4. `https://swimnote.kr/api/health` 또는 실제 API 엔드포인트 호출로 Production 반영 확인

### 작업 완료 보고 필수 항목

```
□ 실제 Production API Base URL: https://swimnote.kr/api
□ 수정이 반영된 서버: Render.com
□ GitHub push 완료 커밋 SHA
□ Render.com 배포 완료 확인
□ Production API 호출 결과 (실제 응답)
```

### 클라이언트(앱) 변경 시

앱 코드(.tsx) 변경은 OTA 배포 필요. Replit에서 코드만 수정해도 앱 사용자에게 반영 안 됨.
→ OTA 배포 패턴 참고.

**Why:** 과거에 Replit API 서버에서만 수정하고 "완료"로 보고한 사례가 있었음. 실제 앱(swimnote.kr)은 Render.com 서버를 바라보므로 Render.com 재배포 없이는 변경이 운영에 반영되지 않는다.

**How to apply:** 서버 routes/*.ts, services/*.ts, middlewares/*.ts 등 백엔드 파일 수정 시 반드시 GitHub push → Render.com 배포 완료까지 진행 후 완료 보고.
