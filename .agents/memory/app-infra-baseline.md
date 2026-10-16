---
name: APP 인프라 고정 기준
description: APP와 ENGINE의 인프라 분리 원칙. APP Render 연결은 승인된 replit.md 기준을 참조한다.
---

## APP Production (고정)
- Repository / Branch: `replit.md`의 "APP Render 저장소 연결 기준"을 참조한다. 개발 origin과 Render 연결 저장소를 동일하다고 가정하지 않는다.
- Render Service: swimnote-api (srv-d7bn4gogjchc73dp1ci0)
- Production API Host: https://swimnote-api.onrender.com
- RENDER_GIT_COMMIT → /health commit 으로 노출

## AI ENGINE Production (별개, APP 작업에서 건드리지 않음)
- Repository: https://gitlab.com/swimnote-group/swimnote-project
- Branch: main
- Render Service: swimnote-professional-engine (srv-da4eemojo6nc738phl30)

## 규칙
- APP 개발·운영 저장소의 구분은 위 지침을 따르며, APP 서버 배포 대상은 swimnote-api다.
- AI ENGINE 작업 = GitLab only, swimnote-professional-engine 배포만
- 기본적으로 APP workspace에 AI ENGINE의 GitLab remote를 추가하지 않는다. 사용자가 명시 승인한 별도 APP 검증용 remote는 예외이며, 기본 저장소·배포 연결 전환 승인을 뜻하지 않는다.
- deploy-photo-clone은 legacy branch. Production은 main.

## 완료보고 필수 항목 (APP)
Target: APP
Repository / Branch: 해당 Render 서비스의 실제 연결과 승인 대상
Commit SHA: <sha>
Render target: swimnote-api
Production /health SHA: <sha>
OTA 필요 여부: yes/no

**Why:** 2026-09-13 세션에서 swimnote-professional-engine(GitLab)을 잘못 배포하는 사고 발생. APP과 AI ENGINE 혼동이 근본 원인.

## APP GitLab과 개발 저장소의 제품 경계
- GitLab 인증·push·LFS 검증 성공만으로 기본 개발 저장소나 배포 연결 전환을 추론하지 않는다. 실제 전환 범위는 별도 사용자 승인과 현재 작업 지침을 따른다.

**Why:** 최초 승인은 검증용이었고, 후속 승인은 기존 APP Render 서비스의 저장소 연결에 한정됐다. 두 승인을 합쳐 전체 개발 환경 이전이나 ENGINE 변경으로 확대하면 안 된다.

**How to apply:** 현재 연결과 branch는 `replit.md`를 확인한다. APP Render 연결 변경과 개발 origin·EAS·OTA 변경 승인을 분리한다.

## 검증 push의 LFS 전송 경계
검증 push에서 로컬 hook을 제외하면 Git LFS의 자동 pre-push 전송도 제외된다. 이를 인증 성공이나 Git 객체 전송 성공만으로 LFS 전송 완료로 판단하지 않는다.

**Why:** 이 저장소의 pre-push hook은 Git LFS 전송을 호출한다. 명령 한정으로 hook을 비활성화한 검증 push에서 대상 GitLab이 LFS 객체 누락을 이유로 거절했다.

**How to apply:** 자동 실행 방지를 위해 hook을 제외해야 한다면 승인 SHA에 필요한 LFS 객체만 별도로 전송하는 범위를 먼저 확인한다. 이력 재작성·LFS 검사 해제·ref 범위 없는 전체 업로드로 우회하지 않으며, 추가 push 횟수 제한을 준수한다.
