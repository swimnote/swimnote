---
name: APP 인프라 고정 기준
description: SWIMNOTE APP vs AI ENGINE 배포 경로 분리 기준. 절대 혼동 금지. 2026-09-13 확정.
---

## APP Production (고정)
- Repository: https://github.com/swimnote/swimnote
- Branch: main
- Render Service: swimnote-api (srv-d7bn4gogjchc73dp1ci0)
- Production API Host: https://swimnote-api.onrender.com
- RENDER_GIT_COMMIT → /health commit 으로 노출

## AI ENGINE Production (별개, APP 작업에서 건드리지 않음)
- Repository: https://gitlab.com/swimnote-group/swimnote-project
- Branch: main
- Render Service: swimnote-professional-engine (srv-da4eemojo6nc738phl30)

## 규칙
- APP 작업 = GitHub only, swimnote-api 배포만
- AI ENGINE 작업 = GitLab only, swimnote-professional-engine 배포만
- gitlab remote를 APP workspace에 추가하지 않음
- deploy-photo-clone은 legacy branch. Production은 main.

## 완료보고 필수 항목 (APP)
Target: APP
Repository: github.com/swimnote/swimnote
Branch: main
Commit SHA: <sha>
Render target: swimnote-api
Production /health SHA: <sha>
OTA 필요 여부: yes/no

**Why:** 2026-09-13 세션에서 swimnote-professional-engine(GitLab)을 잘못 배포하는 사고 발생. APP과 AI ENGINE 혼동이 근본 원인.
