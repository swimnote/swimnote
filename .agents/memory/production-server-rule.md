---
name: Production 서버 작업 원칙
description: 서버 코드 수정 시 반드시 실제 앱이 연결된 Production 서버에서만 작업해야 한다는 최우선 원칙
---

## 최우선 원칙 — Production 서버에서만 작업

### 실제 앱 연결 구조

| 항목 | 값 |
|---|---|
| 앱 API Base URL / APP 저장소·branch | `replit.md`의 현재 APP Render 연결 기준 참조 |
| 실제 API 및 홈페이지 서버 | 각각의 기존 Render 서비스; 홈페이지와 API 호스트를 혼동하지 않음 |
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
2. 승인 SHA를 해당 Render 서비스의 실제 연결 저장소·branch에 준비; 개발 origin과 혼동 금지
3. Render.com 배포 완료 확인
4. 실제 API 서비스의 기존 health endpoint에서 승인 SHA와 Production 반영 확인

### 작업 완료 보고 필수 항목

```
□ 실제 Production API Base URL: 현재 APP 연결 지침과 실제 서비스 기준
□ 수정이 반영된 서버: Render.com
□ Render 연결 저장소에 준비된 승인 커밋 SHA
□ Render.com 배포 완료 확인
□ Production API 호출 결과 (실제 응답)
```

### 클라이언트(앱) 변경 시

앱 코드(.tsx) 변경은 OTA 배포 필요. Replit에서 코드만 수정해도 앱 사용자에게 반영 안 됨.
→ OTA 배포 패턴 참고.

**Why:** 과거에 Replit API 서버에서만 수정하고 "완료"로 보고한 사례가 있었음. 실제 앱은 별도 Render API 서버를 바라보므로 개발 환경 검증만으로 운영 반영을 주장할 수 없다. 개발 저장소와 Render 연결이 분리된 이후에는 개발 origin의 push도 배포 증거가 아니다.

**How to apply:** 실제 백엔드 코드 변경이 승인된 작업은 현재 Render 연결 저장소에 승인 source 준비 → 배포 완료까지 검증한다. 저장소 설정만 전환하는 작업에 이 규칙을 적용해 불필요한 배포를 실행하지 않는다.
