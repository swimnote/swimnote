---
name: dist gitignore로 인한 Replit 배포 구버전 문제
description: artifacts/api-server/dist가 .gitignore → Replit 재배포 없이 새 코드 미적용
---

## 문제

- `artifacts/api-server/.gitignore`의 4번째 줄에 `dist` 포함 → dist/ 전체 gitignore
- Replit 배포: `node artifacts/api-server/dist/index.mjs` 실행
- **재배포(Publish) 없이 GitHub push만 해도 Replit은 캐시된 OLD dist 계속 사용**
- dist는 Replit 배포 컨테이너에 캐시됨 (코드 변경이 자동 반영 안됨)

## 해결 패턴

1. **Replit 재배포**: Publish 버튼 클릭 → artifact.toml의 build command 실행 → 새 dist 생성
   - build: `pnpm --filter @workspace/api-server run build`
   - 이 방법이 권장됨 (dist를 git에 커밋할 필요 없음)

2. **dist 강제 커밋**: `git add -f artifacts/api-server/dist/index.mjs` → commit → push
   - 단기 핫픽스로 사용 가능 (2026-08-16 P0 대응 시 사용: SHA ad0e554f)
   - 단점: 빌드 결과를 git에 커밋하는 것은 좋지 않은 관행

## Render vs Replit 차이

- **Render**: GitHub push 시 자동 빌드 (`pnpm run build` 실행) → 항상 최신 코드 반영
- **Replit 배포**: Publish 버튼 클릭 시에만 빌드 실행

**Why:** 동일한 코드 수정이 Render에서는 정상인데 swimnote.kr(Replit 배포)에서만 구버전인 혼란 발생.
**How to apply:** 서버 코드 변경 후 항상 Replit 재배포 확인. 긴급 시 dist 강제 커밋 허용.
