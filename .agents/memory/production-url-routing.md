---
name: Production URL 실제 라우팅
description: swimnote.kr vs swimnote-api.onrender.com 실제 라우팅 구조. 앱 API는 반드시 Render.com.
---

# Production URL 라우팅 (2026-08-18 확정)

## 확정된 구조 (2026-09-18 재확인)
- `swimnote.kr` = **Render static_site** (`srv-dajnb2u7bikc73co7pv0`) = swimnote-web SPA
  - repo: github.com/swimnote/swimnote, branch: main
  - build: `pnpm --filter @workspace/swimnote-web run build && ... cp dashboard → dist/public/admin/`
  - publish: artifacts/swimnote-web/dist/public
  - GitHub main push → Render 자동 배포 (autoDeploy: yes)
  - swimnote-web.onrender.com도 동일 서비스
- `swimnote-api.onrender.com` = Render web_service = **api-server (운영)**
  - GitHub push → 자동 빌드·배포
  - DB: SUPABASE_DATABASE_URL (shared)

⚠ Replit 게시버튼으로는 swimnote.kr 배포 불가 — GitHub push만 유효

## 앱 API_BASE
`https://swimnote-api.onrender.com/api` (SessionContext.tsx)
swimnote.kr를 API_BASE로 사용하면 모든 API 호출이 SPA HTML 200 응답 → 무음 실패

## 서버 배포 방법
GitHub push → Render.com 자동 빌드 완료 확인 → OTA 필요 시 별도 배포
