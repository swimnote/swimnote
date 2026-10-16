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
- APP 기본 개발·운영 저장소는 GitHub이며, APP 서버 배포 대상은 swimnote-api다.
- AI ENGINE 작업 = GitLab only, swimnote-professional-engine 배포만
- 기본적으로 APP workspace에 AI ENGINE의 GitLab remote를 추가하지 않는다. 사용자가 명시 승인한 별도 APP 검증용 remote는 예외이며, 기본 저장소·배포 연결 전환 승인을 뜻하지 않는다.
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

## APP GitLab 검증 대상의 제품 경계
- `https://gitlab.com/swimnote.admin/swimnote-app.git`은 사용자가 지정한 별도 APP 비공개 검증 대상이며 AI ENGINE 저장소가 아니다.
- GitLab 검증 성공만으로 GitHub origin, 기본 개발 저장소, Render/EAS 연결을 바꾸지 않는다.

**Why:** 사용자는 GitHub를 유지한 채 현재 Replit에서 GitLab push 가능 여부만 확인하도록 범위를 한정했다.

**How to apply:** APP 검증은 별도 추가 remote와 명시 승인된 ref에만 수행한다. 저장소 이전이나 배포 전환은 별도의 승인이 필요하다.

## 검증 push의 LFS 전송 경계
검증 push에서 로컬 hook을 제외하면 Git LFS의 자동 pre-push 전송도 제외된다. 이를 인증 성공이나 Git 객체 전송 성공만으로 LFS 전송 완료로 판단하지 않는다.

**Why:** 이 저장소의 pre-push hook은 Git LFS 전송을 호출한다. 명령 한정으로 hook을 비활성화한 검증 push에서 대상 GitLab이 LFS 객체 누락을 이유로 거절했다.

**How to apply:** 자동 실행 방지를 위해 hook을 제외해야 한다면 승인 SHA에 필요한 LFS 객체만 별도로 전송하는 범위를 먼저 확인한다. 이력 재작성·LFS 검사 해제·ref 범위 없는 전체 업로드로 우회하지 않으며, 추가 push 횟수 제한을 준수한다.
