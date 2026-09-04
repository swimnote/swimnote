---
name: Production URL 실제 라우팅
description: swimnote.kr vs swimnote-api.onrender.com 실제 라우팅 구조. 앱 API는 반드시 Render.com.
---

# Production URL 라우팅 (2026-08-18 확정)

## 확정된 구조
- `swimnote.kr` (34.111.179.208) = Replit 배포 = **swimnote-web SPA** (웹 프론트엔드)
  - ALL routes → index.html (HTTP 200, text/html)
  - /api/* 라우팅 없음
  - Linking.openURL("https://swimnote.kr") 용도로만 사용
- `swimnote-api.onrender.com` (216.24.57.7) = Render.com = **api-server (운영)**
  - GitHub push → 자동 빌드·배포
  - DB: SUPABASE_DATABASE_URL (shared)

## 앱 API_BASE
`https://swimnote-api.onrender.com/api` (SessionContext.tsx)
swimnote.kr를 API_BASE로 사용하면 모든 API 호출이 SPA HTML 200 응답 → 무음 실패

## 서버 배포 방법
GitHub push → Render.com 자동 빌드 완료 확인 → OTA 필요 시 별도 배포
