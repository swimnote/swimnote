---
name: Production URL 실제 라우팅
description: swimnote.kr vs swimnote-api.onrender.com 실제 라우팅 구조. 앱 API는 반드시 Render.com.
---

# Production URL 라우팅 (2026-08-18 확정)

## 확인된 서비스 구조 (저장소 연결은 replit.md의 현재 승인 기준 참조)
- `swimnote.kr` = **Render static_site** (`srv-dajnb2u7bikc73co7pv0`) = swimnote-web SPA
  - repo/branch: `replit.md`의 APP Render 저장소 연결 기준 참조
  - build: `pnpm --filter @workspace/swimnote-web run build && ... cp dashboard → dist/public/admin/`
  - publish: artifacts/swimnote-web/dist/public
  - Render 연결 branch push → 자동 배포 (autoDeploy: yes); 개발 GitHub push와 구분
  - swimnote-web.onrender.com도 동일 서비스
- `swimnote-api.onrender.com` = Render web_service = **api-server (운영)**
  - autoDeploy: no. 연결 저장소에 push만 해서는 배포되지 않음; 승인 SHA를 지정해 Render 배포 후 LIVE·health SHA 검증.
  - DB: SUPABASE_DATABASE_URL (shared)

⚠ swimnote.kr의 운영 원본은 위 Render 서비스다. 개발 origin의 push를 현재 Render 연결 저장소의 push와 혼동하지 않는다.

**Why:** Replit에 등록된 custom domain 정보나 저장소의 render.yaml만으로 실제 웹 origin과 현재 autoDeploy 설정을 판단할 수 없다. 운영 Render 설정은 저장소 설정과 다를 수 있다.
**How to apply:** 운영 웹 확인 시 Render 서비스·verified custom domain·실제 public bundle을 확인한다. API와 웹의 배포 상태를 각각 검증한다.

## 앱 API_BASE
`https://swimnote-api.onrender.com/api` (SessionContext.tsx)
swimnote.kr를 API_BASE로 사용하면 모든 API 호출이 SPA HTML 200 응답 → 무음 실패

## 서버 배포 방법
서비스별 연결 저장소·branch와 자동 배포 정책 확인 → 승인 SHA 준비 → 필요한 경우에만 Render 배포 → LIVE·health SHA 검증. OTA는 별도 승인 범위다.
