# Windows 정상 인증 후보 수용 체크리스트

준비 판정과 수용 판정은 별도다. 아래 실제 Windows 항목은 현재 모두 NOT RUN.
README-NORMAL의 정확한 명령을 사용하고 각 행에 실제 관찰·증거 경로를 기록한다.
Linux API 정상 인증 20항목 / 브라우저 5항목은 Windows 결과를 대신하지 않는다.

| 항목 | 기대 | Windows 결과 |
|---|---|---|
| 해시·원본 provenance | 새 후보 manifest/files/overlay/server/lock 일치 | NOT RUN |
| 수동 toolchain | Node 24.13+ 24.x / pnpm 10.26.1 / PG16.10+ / PS7.4+ | NOT RUN |
| frozen 설치·Electron binary | 고정 lock 설치, 명시적 binary 준비, host/embedded 구분 | NOT RUN |
| BuildDesktop | 새 build-evidence, 기존 출력 거부, 검증 ID 일치 | NOT RUN |
| Prepare ACL | 성공 후 새 비밀 생성, 실패 시 비밀 작성/시작 차단 | NOT RUN |
| 포트 점유 | 기존 점유자 유지·도구 시작 거부 | NOT RUN |
| Start schema | 단일 loopback DB, 실제 schema/marker/귀속, 실패 시 차단 | NOT RUN |
| Origin/security | app://office → 127.0.0.1:20411, sandbox/contextIsolation/webSecurity 유지 | NOT RUN |
| DPAPI/preload/IPC | 기존 제품 세션과 분리, 안전 저장과 조회 각각 확인 | NOT RUN |
| 정상 PIN 로그인 | fixture_pool 지정 ID, 새 PW/PIN, me/my-pools/x-mode 일치 | NOT RUN |
| 정상 TOTP 로그인 | 로컬 단기 OTP, 잘못된 OTP 거부 | NOT RUN |
| 인증 거부 | wrong PW / 누락·변조·만료 / teacher / 타 Pool | NOT RUN |
| 상태 경계 | inactive me401 / 탈퇴 GET 유지·write423 / offPool login403 | NOT RUN |
| 한글 왕복 | 합성 이름 seed/read + 한글 메모 write/read + DB 확인 | NOT RUN |
| 기록 기반 검색 | 기존 6개만 replay, 신규 유료 호출 0 | NOT RUN |
| 반이동 | 지정 한 소속만 변경, 다른 소속·weekly_count 3 보존 | NOT RUN |
| 응답 유실 | 실제 commit/event1/receipt1, UI unknown, 재발급/재실행 없음 | NOT RUN |
| 같은 receipt 복구 | 결과 확인만, 새 명령 실행 없음 | NOT RUN |
| 실행 OFF | 신규 NOT_ENABLED, 현재 권한으로 이전 결과 조회 가능 | NOT RUN |
| 세션 교체 | 실제 로그아웃·다른 Pool 로그인; 카드·초안·첨부·receipt 격리 | NOT RUN |
| stale writer | 편집 중 외부 합성 writer → 409, 변경 유실 없음 | NOT RUN |
| 결과 GET 실패 | 결과 미열람 유지, Clear 후 사용자가 열어 현재 자료 확인 | NOT RUN |
| 정상 종료 | Desktop 정상 닫기 → owned supervisor/PG/API 정리 | NOT RUN |
| 강제 종료 진단 | PID·path·creation·candidate·session·ports 소유권 증거 | NOT RUN |
| DeleteData | 별도 명시 승인, 이 run의 합성/비밀만 삭제 | NOT RUN |

운영 Gate: 운영 인증 PIN schema/조회 불일치 별도 검토, 운영 DB schema/권한/보존 정책,
유료 모델 운영 승인, 새 쓰기 gate 승인, Windows 실제 수용. 이번 후보는 운영 승인이 아니다.
