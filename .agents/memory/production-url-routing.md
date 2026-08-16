---
name: Production URL Routing
description: swimnote.kr vs Render URL 실제 라우팅 구조 — 혼동 방지
---

## 실제 URL 구조 (2026-08-16 확인)

- **swimnote.kr** = **Replit 배포** (primaryUrl)
  - Replit autoscale deployment
  - 빌드: `pnpm --filter @workspace/api-server run build` (artifact.toml)
  - 실행: `node artifacts/api-server/dist/index.mjs`
  - dist가 .gitignore에 있으므로 재배포 없이는 새 코드 미적용

- **swimnote-api.onrender.com** = **Render.com** 서버
  - 별도 Render 서비스
  - GitHub push → Render 자동 배포
  - Render buildCommand: `pnpm --filter @workspace/api-server run build` (dist 새로 생성)

## 주의사항

- production-server-rule.md의 "swimnote.kr(Render.com) 연결" 설명은 부정확함
- swimnote.kr은 Replit 배포이고, Render는 별도 URL (swimnote-api.onrender.com)
- 서버 코드 수정 후 swimnote.kr에 적용하려면 **Replit 재배포** 필요 (Publish 버튼)
- Render에 적용하려면 **GitHub push** 필요 (Render 자동 빌드)

**Why:** P0 디버깅 중 발견. swimnote.kr을 Render로 착각하여 Render health 확인으로 P0 해결 착각.
**How to apply:** swimnote.kr health 이상 시 항상 두 URL 별도 확인.
