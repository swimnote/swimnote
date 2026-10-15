---
name: GitHub source-control authentication boundary
description: Distinguish Replit Git authentication from product login and interpret source-control connector status cautiously.
---

GitHub push 인증 문제는 Replit 개발환경의 source-control 자격증명 문제로 다룬다. 이를 SWIMNOTE 앱·대시보드·웹의 로그인, 회원가입, 세션, PIN, TOTP 변경 요청으로 해석하지 않는다.

**Why:** 개발환경 인증 복구 중 제품 로그인 설정을 재조사하고 변경 대상을 되묻는 잘못된 방향으로 진행한 적이 있다. 사용자가 두 범위를 명확히 구분하도록 지시했다.

**How to apply:** 원래 작업 위치와 격리 worktree의 Git 인증 경로 및 고정 SHA dry-run을 비교한다. 앱 인증 변경은 별도의 명시적 요청이 있을 때만 다룬다.

Replit source-control 연결에 일반 커넥터의 상태 해석을 기계적으로 적용하지 않는다. 목록의 `not_added`만으로 프로젝트 연결 누락을 확정하지 말고, 연결 도구의 실제 응답과 Git 인증 결과를 함께 확인한다.

**Why:** source-control 연결은 목록에서 `not_added`로 보이면서 연결 도구는 이미 활성이라고 응답할 수 있다. 관리 상태가 healthy이거나 scope가 등록되어 있어도 실제 Git push 인증 성공의 증거는 아니다. 일반 OAuth 재연결 도구가 source-control 연결을 처리하지 못할 수도 있다.

**How to apply:** 목록 상태, 연결 관리 응답, Git 원격 응답을 구분해 보고한다. 서로 불일치하면 만료·권한 부족·연결 누락으로 추정하지 않는다. 공개된 메뉴 안내를 현재 UI에서 확인된 사실처럼 말하거나, 같은 실패를 해결하려고 앱 인증을 바꾸지 않는다.
