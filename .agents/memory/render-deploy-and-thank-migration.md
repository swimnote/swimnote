---
name: Render.com 배포 및 reaction_type 마이그레이션 패턴
description: DB CHECK 제약을 변경할 때 Render.com 서버와 OTA 앱의 순서 위험, 서버 측 normalization 패턴
---

## 규칙: DB CHECK 변경 전 서버 코드 우선 배포

diary_reactions reaction_type을 'thank'→'thanks'로 통일하면서 DB CHECK에 `('like','thanks')`를 추가했다가
Render.com 구버전 서버가 `'thank'`를 INSERT → CHECK 위반 → 500 에러 발생.

**Why:** 로컬 dev API 서버(Replit)와 Render.com 서버가 같은 production PostgreSQL을 공유하기 때문.
로컬 재시작 시 super-db-init 마이그레이션이 production DB에 즉시 적용됨.

**How to apply:**
1. DB CHECK를 신규 값 only로 변경하기 전에 반드시 Render.com에 새 코드를 먼저 배포
2. 임시 우회책: CHECK 없이 (`DROP CONSTRAINT`만 하고 ADD는 생략) + 서버에서 normalization
   ```typescript
   const reaction_type = raw === "thank" ? "thanks" : raw;
   ```
3. OTA 순서: Render.com 새 코드 배포 → OTA (앱이 새 값 전송하기 전에 서버가 준비돼야 함)

## Render.com 배포 방법

- GitHub remote: `https://github.com/swimnote/swimnote.git`
- Replit에서 git commit은 차단됨 (태스크 종료 시 auto-commit)
- auto-commit 후 터미널에서 `git push origin master` 실행 → Render.com 자동 배포 트리거
- 배포 확인: `curl https://swimnote-api.onrender.com/api/health`
  - 현재 버전 필드: `"version":"v2.3-2026-07-20"` (신규 배포 시 DEPLOYMENT_VERSION 업데이트됨)

## executeSql vs 운영 DB 재확인

- `executeSql` = Replit 내부 PostgreSQL (별도, production 아님)
- 로컬 dev API 서버 + Render.com = **같은** 외부 production PostgreSQL 공유
- super-db-init 마이그레이션은 로컬 dev API 재시작 시 production DB에 즉시 반영
