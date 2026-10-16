---
name: Worktree test isolation
description: Prevent mixed original/release test imports from escaping database mocks.
---

격리 release 검증에서 원본 테스트와 별도 worktree의 실제 모듈을 함께 사용할 때, DB mock을 패키지 이름에만 의존하지 않는다. 모든 DB import를 단일 절대경로 mock 대상으로 통일하고, mock 누락 시 연결 대신 즉시 예외를 내는 trap을 둔다.

**Why:** 같은 패키지 이름이라도 테스트와 release 모듈의 importer 위치·node_modules 경로에 따라 서로 다른 모듈 ID로 해석될 수 있다. 겉으로 같은 mock 선언만으로 실제 DB 접근 차단을 보장할 수 없었다.

**How to apply:** 원본 테스트의 import와 mock specifier를 모두 격리 release 모듈로 연결한다. DB 의존성에는 fail-closed trap을 적용하고, release에만 있는 동작을 검증해 원본 개발 source가 대신 실행되지 않았음을 확인한다. 테스트 증거는 release commit에 섞지 않는다.
