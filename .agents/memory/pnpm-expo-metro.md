---
name: pnpm expo Metro 모노레포 의존성 패턴
description: pnpm workspace에서 expo 앱 OTA 번들링 시 Metro가 패키지를 못 찾는 문제와 해결 방법
---

## 문제

`pnpm install`을 실행하면 swim-app/node_modules에 expo-* 패키지들의 symlink 구조가 바뀌어
Metro bundler가 `expo-video-thumbnails`, `expo-image-manipulator` 등을 찾지 못함.

**Why:** pnpm isolated hoisting은 직접 dependencies에 없는 패키지를 sym링크로 제공하지 않음.
Metro는 watchFolders 밖 경로의 symlink를 기본적으로 follow하지 않음.

## 해결 방법 (적용됨)

1. **.npmrc**에 `public-hoist-pattern[]=expo-*` 추가 (root node_modules에 expo-* 호이스팅)

2. **metro.config.js** 설정:
   ```js
   config.watchFolders = [monorepoRoot, path.resolve(monorepoRoot, "node_modules/.pnpm")];
   config.resolver.nodeModulesPaths = [projectRoot/node_modules, monorepoRoot/node_modules];
   config.resolver.unstable_enableSymlinks = true;
   ```

3. **swim-app/package.json**에 미선언 expo 패키지 명시적 추가:
   - `expo-video-thumbnails@55.0.17`
   - `expo-image-manipulator@~55.0.19`
   - `expo-audio@~55.0.16`
   - `expo-updates@~55.0.26`
   
   swim-app이 실제로 사용하면서 package.json에 없으면 pnpm이 설치 안 함.

4. **swimnote-web/package.json**에서 존재하지 않는 `@workspace/app-content` 제거
   (workspace에 해당 패키지 없으면 pnpm 전체 install 실패)

## How to apply

- OTA 번들링 전 `pnpm install`을 실행하면 위 설정이 적용됨
- swim-app에 새 expo 패키지 추가 시 반드시 package.json에 명시적 선언
- pnpm install 후 node_modules가 크게 변경됐다면(-100 이상) OTA 번들링 실패 가능성 높음
