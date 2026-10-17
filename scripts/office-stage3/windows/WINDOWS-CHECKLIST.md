# Windows 통합 수용 — 현재 전 항목 NOT RUN / 정상 인증 HOLD

정상 합성 인증과 새 고정 후보가 먼저 필요하다. 현재 후보로 업무 PASS를 만들려고 barrier를 제거하지 않는다.
Agent의 Linux 단위 HTTP·renderer 컴파일은 아래 Windows 증거가 아니다.
이미 수용된 Stage 2 UI/설치/아이콘 검사는 반복하지 않는다.

## 기록 방식

후보 ID·manifest/patch·standalone lock·build manifest 해시, Windows 버전/배율,
Electron 버전, run/session ID, 시작/종료 시각을 비밀값 없이 기록한다.
항목별 `NOT RUN / PASS / FAIL / HOLD`, 최초 결과와 수정 후 결과를 분리한다.
스크린샷에는 합성 회원만 포함한다. 로그인 입력·JWT/DPAPI blob·DB 비밀번호는 찍거나 공유하지 않는다.
receipt는 요청 ID·결과 status·revision·변경 필드명만 기록한다. 과거 개인정보 원문을 복원하지 않는다.
응답 재생/전송 전 차단/실제 신규 모델 호출을 구분하며 이번 신규 유료 호출은 0이다.

| 항목 | 조작·예상 결과 | 수집할 증거 |
|---|---|---|
| 정상 로그인 | 실제 login→필요한 PIN/TOTP→me/Pool 재검증. 잘못된 비밀번호·role·타 Pool 거부 | 인증 성공/실패 status와 UI. token 제외 |
| 저장·재실행·로그아웃 | 로그인 유지 ON/OFF 각각 종료/재실행. 로그아웃 후 반드시 재인증 | Windows 실행 영상/화면, 세션 격리. DPAPI 내부 증거와 구분 |
| 검색 0/1/동명이인 | 기록된 검색어로 각각 0·1·2명. 동명 자동 선택/변경 없음 | 실제 Electron 표 건수/선택·검색 카드 |
| 일반정보 수정 | 합성 회원 선택→메모 변경→임시 실행 확인→공통 Action | 전후 필드·receipt·최신 재조회 |
| 지정 소속 반이동 | 합성 A→C로 한 소속만 이동, B와 weekly_count=3 유지 | before/after 소속 IDs·history·주당 횟수 |
| 임시 확인 | AI 제안은 해석만으로 쓰지 않음. 취소 시 변경/receipt 실행 없음 | 확인 대화상자·실행/취소 차이 |
| 결과 보기 | 완료 카드 자동 이동 없음→결과 보기→최신 데이터→열람 | 카드/대상·read timestamp. 조회 실패는 미열람 |
| 뒤로/앞으로 | 검색·상태/반 필터·page·가로/세로 스크롤 설정 후 수정 결과 왕복 | 전후 값·실제 스크롤. 오래된 데이터 복원 금지 |
| 편집 보존 | AI 미전송 입력·로컬 첨부·미저장 일반 편집 상태에서 업무 이동/뒤로 | input/attachment 상태. 실제 업로드 금지 |
| stale revision | 상세 조회 후 승인된 로컬 다른 세션에서 같은 합성 필드 변경, 이전 revision 제출 | 충돌 status·덮어쓰기 없음·최신 재조회 |
| 응답 유실 | 전용 격리 transport에서 실행 응답 수신만 유실. 결과 불명 후 같은 receipt 조회 | 쓰기 1회·자동 재발급/재실행 없음·조회 결과 |
| 실행 OFF | 합성 명령 완료 후 API 실행 gate OFF, 기존 receipt GET 허용·새 실행 거부 | GET 기존 최소 결과/POST 차단. 현재 auth barrier와 혼동 금지 |
| 세션 교체 | 로그아웃/다른 합성 계정·Pool로 전환 | 이전 작업 카드·초안·첨부 격리, 이전 receipt 403/404 |
| preload/IPC·Origin | app://office 정상 sender만 허용, 잘못된 frame/Origin/host/다른 API 경로 거부 | 실제 Electron negative 결과·서버 403. wildcard/우회 없음 |
| 종료 | Stop으로 이번 서비스만 정리, 다른 프로세스 유지, 양쪽 포트 닫힘 | stopped.json·포트 상태·로그. 데이터 삭제는 별도 |

응답 유실·execution OFF·session replacement 등의 승인된 로컬 fault 주입 도구가 없으면
해당 항목은 HOLD다. OS 방화벽/운영 API 차단으로 오류를 만드는 방식은 사용하지 않는다.
현재 준비본은 위 fault 주입과 정상 인증까지 완성한 통합 runner가 아니며 이를 PASS로 표시하지 않는다.

## 실제 Windows 접근이 없을 때

체크리스트와 수집 위치만 전달하고 모두 NOT RUN으로 남긴다.
사용자가 실행한 증거는 사용자 보고로 식별한다. Linux Chromium·cross compile·정적 PowerShell 검사는
Windows 실행, native DPAPI, 세션 저장, 실제 Electron IPC 수용을 대신하지 않는다.
