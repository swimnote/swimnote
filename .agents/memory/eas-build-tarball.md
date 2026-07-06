---
name: EAS Build tarball 구조 및 패치
description: Replit 모노레포에서 EAS iOS/Android 빌드를 성공시키기 위한 패치 방법
---

## 핵심 원인

EAS CLI의 `makeShallowCopyAsync`가 git root(`/home/runner/workspace`)를 기준으로 전체 workspace를 클론함.
→ workspace root `package.json`의 yarn 차단 preinstall이 포함되어 빌드 실패.
→ 187MB 업로드 = 전체 workspace (잘못된 것).
→ 5.5MB 업로드 = swim-app만 (올바른 것).

## 성공 패치 방법 (매 빌드 전 적용 필수)

```js
// pnpm store 경로의 eas-cli git.js를 패치
const realPath = '/home/runner/workspace/node_modules/.pnpm/eas-cli@20.5.1_@types+node@25.3.5_typescript@5.9.3/node_modules/eas-cli/build/vcs/clients/git.js';
```

### 1. commitAsync → no-op
### 2. isCommitRequiredAsync → return false
### 3. trackFileAsync → no-op (line 193-194 주의: `});` 오류 발생 가능, 수동 수정 필요)
### 4. getRootPathAsync → swim-app 경로 반환
```js
async getRootPathAsync() {
  return '/home/runner/workspace/artifacts/swim-app';
}
```
### 5. makeShallowCopyAsync → fs-extra로 swim-app만 복사 (핵심!)
```js
async makeShallowCopyAsync(destinationPath) {
  const fse = require('fs-extra');
  const src = '/home/runner/workspace/artifacts/swim-app';
  await fse.copy(src, destinationPath, {
    filter: (s) => {
      const rel = s.replace(src, '');
      return !rel.startsWith('/node_modules') && !rel.startsWith('/.expo') &&
             !rel.startsWith('/android') && !rel.startsWith('/ios') &&
             !rel.startsWith('/dist') && !rel.startsWith('/.git');
    }
  });
}
```

### 6. repository.js도 패치
```
artifacts/swim-app/node_modules/eas-cli/build/build/utils/repository.js
async function reviewAndCommitChangesAsync() {}
```

## 빌드 순서

```bash
# 1. pnpm-lock.yaml 제거 (swim-app에서)
rm -f artifacts/swim-app/pnpm-lock.yaml

# 2. 의존성 설치
cd artifacts/swim-app && pnpm install --no-frozen-lockfile

# 3. 위 패치 적용

# 4. 빌드 (--no-wait로 비동기)
EAS_SKIP_AUTO_FINGERPRINT=1 EXPO_TOKEN=$(printenv EXPO_TOKEN) \
  node_modules/.bin/eas build --platform ios --profile production --non-interactive --no-wait

# 5. iOS 제출 (빌드 FINISHED 후)
EXPO_TOKEN=$(printenv EXPO_TOKEN) \
  node_modules/.bin/eas submit --platform ios --profile production --latest --non-interactive
```

## 주의사항
- `trackFileAsync` 패치 시 regex가 `});` 잔여 문자를 남길 수 있음 → syntax OK 확인 필수
- pnpm store 실제 경로: `fs.realpathSync(path)` 로 확인
- rsync 없음 → fs-extra 사용
- 업로드 크기 5.5MB = 정상, 187MB = workspace 전체 포함됨 (실패 원인)
- iOS EAS Free 플랜 월 한도 있음 → Starter($19/월) 이상 필요

## .npmrc
`frozen-lockfile=false` 유지 필수
