---
name: EAS Build tarball 구조 및 패치
description: Replit 모노레포에서 EAS iOS 빌드를 성공시키기 위한 tarball 구조, git.js 패치, 빌드 제출 방법
---

## 규칙

**tarball 구조**: 반드시 workspace root(git root) 기준으로 생성. `project/artifacts/swim-app/` 경로가 tarball 안에 있어야 함.

```bash
cd /home/runner/workspace && \
tar -czf /tmp/swim-archive.tar.gz \
  --exclude='./artifacts/swim-app/node_modules' \
  --exclude='./artifacts/swim-app/ios' \
  --exclude='./artifacts/swim-app/dist' \
  ... \
  --transform 's,^\.,project,' \
  ./artifacts/swim-app
```

**잘못된 방법 (실패)**: `cd artifacts/swim-app && tar ...` → `project/package.json` 구조 → EAS에서 "package.json does not exist" 에러.

## git.js 패치 (node_modules/eas-cli/build/vcs/clients/git.js)

세 가지 메서드를 no-op으로 패치해야 함:
1. `trackFileAsync` → no-op
2. `commitAsync` → no-op (return immediately)
3. `isCommitRequiredAsync` → return false

repository.js의 `reviewAndCommitChangesAsync`도 no-op 패치 필요.

## pnpm install --frozen-lockfile

EAS는 항상 `--frozen-lockfile`로 실행함. 성공 패턴:
- pnpm-lock.yaml 없음 + packageManager 없음 + .npmrc frozen-lockfile=false → EAS가 fresh install 허용 (성공)
- pnpm-lock.yaml 있음 + packageManager 있음 → 가끔 성공, 가끔 플랫폼 불일치로 실패

## App Store 제출

```bash
cd artifacts/swim-app && \
EXPO_TOKEN=$(printenv EXPO_TOKEN) \
node_modules/.bin/eas submit --platform ios --profile production --latest --non-interactive
```

## tarball 임시 파일

`/tmp/swim-archive.tar.gz`는 재시작 후 사라짐. 빌드 전 반드시 재생성 필요.
