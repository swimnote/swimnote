---
name: GitHub source-control authentication boundary
description: Distinguish Replit Git authentication from product login and interpret source-control connector status cautiously.
---

GitHub push 인증 문제는 Replit 개발환경의 source-control 자격증명 문제로 다룬다. 이를 SWIMNOTE 앱·대시보드·웹의 로그인, 회원가입, 세션, PIN, TOTP 변경 요청으로 해석하지 않는다.

**Why:** 개발환경 인증 복구 중 제품 로그인 설정을 재조사하고 변경 대상을 되묻는 잘못된 방향으로 진행한 적이 있다. 사용자가 두 범위를 명확히 구분하도록 지시했다.

**How to apply:** 원래 작업 위치와 격리 worktree의 Git 인증 경로 및 고정 SHA dry-run을 비교한다. 앱 인증 변경은 별도의 명시적 요청이 있을 때만 다룬다.

관리형 연결 실패와 서비스 timeout이 겹치면 계정·승인·Secret 변경을 요청하기 전에 Replit과 GitHub의 공식 장애·점검 상태 및 사용자 화면의 업데이트 공지를 먼저 확인한다.

**Why:** 플랫폼이나 작업 환경 업데이트 가능성을 배제하지 않은 채 인증 문제로 좁히면, 불필요한 재연결과 승인 취소를 반복하게 된다.

**How to apply:** 공식 전체 상태가 정상이어도 개별 작업 환경의 문제까지 정상이라고 단정하지 않는다. 반대로 timeout만으로 점검 중이라고 확정하지도 않는다. 실제 업데이트 중이라면 추가 인증 변경을 멈추고 종료 후 기존 경로로 검증한다.

새 source-control 연결 생성이 확인됐는데도 Git 인증이 실패한다면, 재연결 미실행으로 몰아가지 말고 작업 환경의 관리형 인증 전달 경로를 별도로 확인한다.

**Why:** 새 연결을 관리 도구는 active/healthy로, 재인증 도구는 not connected로 처리하는 불일치를 관찰했다. 로컬 인증 서비스는 일반 경로에는 응답했지만 인증 요청은 30초 뒤 오류를 반환했다. 설치된 관리형 askpass가 오류 JSON의 token 단어를 토큰 필드로 오인하여 `GitHub token request timed out` 자체를 비밀번호 출력으로 반환하는 동작도 실제 재현했다. 이는 사용자 재승인 반복만으로 해결된다는 근거가 아니다.

**How to apply:** 자격증명 값 없이 전달 서비스의 응답 상태와 오류/토큰 구분을 확인한다. 짧은 timeout만 보고 서비스 전체 중단으로 단정하지 않는다. 관리형 helper 오류가 GitHub의 Invalid username or token으로 보일 수 있으므로 토큰 만료·권한 부족과 구분한다. 인증 요청에 응답할 세션/클라이언트가 왜 응답하지 않는지는 별도 원인으로 남긴다. 작업 환경 재시작과 앱 workflow 재시작을 구분하고, 재시작 영향도 알린다.

Replit source-control 연결에 일반 커넥터의 상태 해석을 기계적으로 적용하지 않는다. 목록의 `not_added`만으로 프로젝트 연결 누락을 확정하지 말고, 연결 도구의 실제 응답과 Git 인증 결과를 함께 확인한다.

**Why:** source-control 연결은 목록에서 `not_added`로 보이면서 연결 도구는 이미 활성이라고 응답할 수 있다. 관리 상태가 healthy이거나 scope가 등록되어 있어도 실제 Git push 인증 성공의 증거는 아니다. 일반 OAuth 재연결 도구가 source-control 연결을 처리하지 못할 수도 있다.

**How to apply:** 목록 상태, 연결 관리 응답, Git 원격 응답을 구분해 보고한다. 서로 불일치하면 만료·권한 부족·연결 누락으로 추정하지 않는다. 공개된 메뉴 안내를 현재 UI에서 확인된 사실처럼 말하거나, 같은 실패를 해결하려고 앱 인증을 바꾸지 않는다.

관리형 연결의 반복 재인증이 실패한 경우 같은 절차를 무작정 반복하지 않는다. 사용자는 기존 관리형 인증 dry-run 1회가 같은 인증 오류로 실패하면 기존 연결을 완전히 해제하고 새로 연결하는 절차로 전환하도록 명시했다. 사용자 조작 안내는 현재 화면을 확인한 뒤 제공한다. PAT 전환 승인은 철회된 상태이므로, 준비된 PAT 도구가 남아 있어도 실행하거나 Secret·전용 인증 설정을 추가하지 않는다. 향후 PAT 대안에는 새로운 명시적 승인이 필요하다. 전역 credential 설정이나 remote URL에 토큰을 저장하지 않는다.

**Why:** 관리형 연결 실패를 별도 PAT 문제로 단정하거나 전역 인증을 교체하면 다른 개발 작업까지 영향을 받을 수 있다. 완전 해제·새 연결에 대한 명시적 승인은 PAT 사용 승인이 아니며, 과거 승인을 현재 승인으로 취급하면 안 된다.

**How to apply:** 실제 push 범위에 workflow 변경이 있는지 최종 diff와 커밋 이력 모두 확인한 뒤 필요한 권한만 요청한다. 등록은 Secrets 경로로만 받고, 인증 후에도 승인 SHA와 대상 release ref를 고정한다. 공개 저장소 조회 성공만으로 계정 인증이나 쓰기 권한을 확인했다고 보고하지 않는다.

원격 반영 전 보존해야 하는 승인 source를 `/tmp` 격리 폴더에만 의존하지 않는다.

**Why:** 기존 임시 worktree의 디렉터리가 사라지고 Git 객체와 worktree 등록 정보만 남아 있는 상태를 관찰했다. 등록 정보가 존재하는 것과 실제 checkout 보존은 다르다.

**How to apply:** 승인 커밋의 객체 존재를 확인하고 작업 공간 내부의 Git 추적 제외 경로에 detached worktree를 보존한다. 원래 작업 트리와 기존 worktree 등록 정보를 삭제·prune·reset하지 않는다. 인증 복구 후 실제 push는 새 보존 경로의 SHA와 clean 상태를 확인한 뒤 수행한다.

중첩된 보존 폴더가 존재해도 `.git` 표식이 사라졌다면 `git -C`가 부모 저장소를 찾아 다른 HEAD와 branch를 반환할 수 있다.

**Why:** 승인 source 폴더와 Git 객체는 남아 있었지만 worktree 표식이 없어, 해당 폴더에서 Git을 실행했을 때 원래 작업 공간의 최신 HEAD로 해석되는 상태를 관찰했다.

**How to apply:** 폴더 존재나 worktree 목록만으로 격리를 판정하지 않는다. 실제 Git 표식과 승인 full SHA·clean 상태를 함께 검증하고, 일치하지 않으면 인증 검사와 push 전에 중단한다. Push refspec은 검증한 승인 SHA를 직접 사용하며 현재 HEAD로 대체하지 않는다.
