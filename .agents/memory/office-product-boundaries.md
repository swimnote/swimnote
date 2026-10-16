---
name: SWIMNOTE OFFICE 제품 경계
description: 사용자가 정한 OFFICE의 공유 데이터, AI 작업창, Desktop 및 확장 원칙
---

OFFICE는 기존 APP·PC Dashboard·API·데이터를 공유하는 확장 제품이다. 이미 구현된 PC 화면을 이유 없이 복제하거나 운영 데이터 저장소를 별도로 만들지 않는다.

**Why:** 사용자가 2026-10-15 제공한 OFFICE Master Blueprint와 조사 지시문에서 동일 업무 의미와 기존 디자인 재사용을 절대 전제로 지정했다.

**How to apply:** 신규 구현 전에 실제 화면·API의 재사용 범위를 확인한다. 현재 OFFICE V1에서는 수영장 업무만 확장하고, 업종중립 Core나 미래 산업 Adapter를 선개발하지 않는다. 기존 테이블 일괄 개명을 전제하지 않는다.

OFFICE의 주 인터페이스는 AI 작업창이다. 모든 업무 기능은 메뉴와 AI가 동일한 Action·권한·검증을 사용해야 한다(Zero Orphan Feature). AI는 대상을 확인하고 계획을 제안하며 DB를 직접 변경하거나 실제 사용자 권한을 높이지 않는다.

**Why:** 사용자는 “일반 메뉴에서는 가능한데 AI 작업창에서는 불가능한 기능”을 허용하지 않으며, 거대한 AI 플랫폼 선행 개발이나 모든 화면 완성 뒤 AI 추가도 금지했다.

**How to apply:** 기존 업무부터 작은 Action wrapper와 Query Action으로 연결한다. 명확한 전화번호/ID 조회는 모델 없는 FAST PATH로 처리하고, 고위험 업무는 Preview·승인·Audit·멱등성을 함께 설계한다.

Windows 10/11 x64 설치형이 우선 목표다. 최소 Desktop Foundation과 전체 OFFICE는 별도 견적·검수 범위를 가진다. 향후 결제단말·프린터·파일·마이크·Kiosk·Dispatch 연동을 막지 않는 Shell 경계가 필요하다.

**Why:** 사용자는 단순 실행파일 크기만으로 Shell을 선택하지 말고, Signed Installer와 개발 실행파일을 구분하도록 요구했다.

**How to apply:** Shell 기술 추천은 승인된 기술 결정과 구분한다. Desktop Foundation에 금융·차량 전체 구현을 끼워 넣지 않으며, 공급업체 계약과 Windows 실장비 검증을 별도 의존성으로 둔다.

운영 메시지는 교육 메시지와 별도 Domain이다. AI 반영에는 텍스트뿐 아니라 회원·보호자·Thread·기존 업무 Context를 전달한다. 음성 비서는 유선전화 녹음이 아닌 직원의 Push-to-talk 업무메모다.

**Why:** 사용자가 두 메시지의 기록·권한을 분리하고, 회원 미확정 음성 업무도 계획을 유지한 채 부족한 대상만 질문하도록 명시했다.

**How to apply:** 기존 교육 Thread나 직원 메신저를 운영 Inbox로 단순 재명명하지 않는다. 관리자 일정 공유는 일상 출결이 아닌 중요 업무에 한해 제안한다.

## 현재 OFFICE V1의 축소 범위

APP의 필요한 운영기능을 PC에서 제공하되, 신규 PC 업무를 APP에도 추가하지 않는다. 현재 V1의 모바일 APP 코드와 UI 변경 목표는 0이다. 공통 Backend는 기존 APP 계약을 유지하는 호환 확장만 허용한다.

**Why:** 사용자가 2026-10-15 후속 지시에서 전체 Master Blueprint가 아닌 PC 전용 OFFICE V1로 범위를 축소하고, “APP → PC”와 “PC → APP”을 대칭으로 취급하지 말라고 명시했다.

**How to apply:** 상담 CRM·대기자·직원 관리·대량처리·통계·Audit 등은 PC 전용으로 구현할 수 있다. 새 학부모 Inbox나 모바일 결제 화면을 V1에 끼워 넣지 않는다. 학부모 소통은 현재 APP가 읽고 답할 수 있는 기존 계약을 활용한다.

현재 V1은 Desktop, 필요한 기존 업무 PC parity, 간소화한 학원 운영, PC Payment Core, Navigation/Dashboard, 얇은 Action Core, AI Workspace 및 실제 공개 업무의 AI 100% coverage가 대상이다. Smartro 실제 Production 결제·환불·등록카드는 별도 증분 범위다. 미래 모바일 결제는 공통 Invoice/Payment 계약만 열어두고 별도 개발한다.

**Why:** 사용자는 PC 기능 비용과 AI 호출 비용·coverage 자동검증 비용을 분리하고, engineering hour를 Agent 실제 실행시간처럼 표시하지 말라고 요구했다.

**How to apply:** 견적은 일반 PC 기능, AI 증분, Smartro 증분을 중복 없이 구분한다. Action은 V1 실제 업무에만 등록하고, 기존 검증을 AI용으로 복제하지 않는다. 메뉴·실행 Action·AI Tool 연결 누락을 출시 실패 조건으로 둔다.

Dispatch·차량 Navigation·Driver·지도·관제·Kiosk·출입·다업종 Adapter·고급 Vault·고급 Scheduler·완전 회계는 현재 V1에서 실제 구현하지 않는다. 필요한 Placeholder는 메뉴 ID·Route·feature flag·namespace 예약까지만 허용한다.

**Why:** 사용자는 “나중에 쉽게 붙일 수 있음”과 “미래 기능을 지금 미리 구현”을 분리하고, 미사용 API·미래 DB schema·빈 backend domain 생성을 금지했다.

**How to apply:** 이전 전체 Blueprint는 미래 방향으로만 참고한다. PC Breadcrumb/History/Side Workspace 같은 필수 화면 Navigation과 제외된 차량 Navigation을 혼동하지 않는다. 조사·견적만 요청된 턴에서는 제품 구현·DB write·배포·OTA·Windows build를 하지 않는다.

## Desktop 인증과 실제 실행 검증의 승인 경계

로그인 유지가 선택된 PC에서는 안전 저장된 최종 token을 복구하고 서버에서 사용자·Pool·권한을 재검증한 뒤 진입한다. 별도 시작 PIN은 추가하지 않으며 비밀번호·PIN·임시 web_session은 저장하지 않는다. 네트워크 오류와 인증 만료를 구분한다.

**Why:** 사용자가 로그인 유지 선택 PC의 자동 로그인을 명시 승인했다. Windows 시작 시 프로그램 자동 실행까지 승인한 것은 아니다.

**How to apply:** 인증 구현 단계에서 이 정책을 적용하고 Windows 자동 실행은 선개발하지 않는다. 로컬 renderer·로그인 화면 표시 단계에서는 실제 인증을 하지 않으며, 실제 인증 시작 전 계정의 TOTP·Pool·권한·X 준비 증거를 필수 Gate로 확인한다.

실제 인증은 renderer에서 기존 서버의 Origin·CORS 검증을 유지한다. main의 HTTP 요청으로 인증을 옮기거나 Origin을 위조하여 차단을 우회하지 않는다.

**Why:** 사용자가 인증·안전 저장 단계와 서버 Origin·연결 단계를 별도 승인 경계로 정했다. 격리 테스트 성공은 실제 계정 Gate 통과나 Windows DPAPI 검증 완료가 아니다.

**How to apply:** 서버 Origin 차단이 있으면 구현 가능한 인증·저장 부분을 격리 검증하고 실제 계정 상태는 UNKNOWN으로 보고한다. 서버 변경과 배포는 후속 승인 대상으로 남기며, 인증 단계만을 위한 Windows 패키지를 자동 생성하지 않는다.

열린 SSE의 인증 만료·권한 회수 처리와 재접속 후 재조회·편집 충돌 보호는 업무 화면의 실제 데이터 연결 전에 통과해야 하는 필수 Gate다.

**Why:** 사용자가 2026-10-16 두 항목을 단순 권장 backlog가 아닌 업무 데이터 연결 전 필수 조건으로 명시했다.

**How to apply:** CORS·source 준비·push 성공으로 이 Gate를 완료 처리하지 않는다. 별도 승인된 구현과 검증 증거를 확보하기 전 업무 화면의 실제 데이터 연결을 진행하지 않는다.

편집 화면이 아직 없으면 공통 편집 보호와 격리 fixture까지만 검증할 수 있다. 화면별 실제 적용과 저장 시 서버 버전 검증은 별도 필수 Gate로 남긴다. revision 계약이 없는 API에 임의 버전값을 추가하거나 입력 보존을 저장 충돌 안전성으로 표현하지 않는다.

**Why:** 사용자가 F04 보완에서 공통 보호 검증과 실제 화면·저장 충돌 검증을 명시적으로 구분했다.

**How to apply:** 재연결 성공, 재조회 완료, 입력 보존, 저장 경쟁 검증을 각각 보고한다. 실제 계정 TOTP·Pool·역할·X 및 Windows DPAPI는 격리 테스트 결과로 PASS 처리하지 않는다.

Windows 내부 검증 환경은 Windows 10 Pro x64이며 unsigned unpacked 검증이 승인됐다. Windows 11은 지원 목표이지 실제 실행 검증 완료가 아니다.

**Why:** 사용자는 패키지 생성과 실제 Windows 실행 증거를 구분하고, 사용자 PC에서 실행 결과를 확인하기 전 Desktop Foundation 최종 PASS를 금지했다.

**How to apply:** ZIP·SHA-256·실행 절차를 제공하되 패키징 성공이나 Linux 검증을 Windows 실행 성공으로 표현하지 않는다. 보안 기능을 끄도록 요구하지 않는다.

Electron 검증 ZIP의 첨부 등록에는 파일당 100 MiB 제한이 확인됐다. 패키징 횟수 제한과 다운로드용 분할을 구분한다.

**Why:** 완성된 Windows unpacked ZIP은 이 한도를 넘을 수 있으며, 재빌드해도 Electron 런타임 크기는 해결되지 않는다.

**How to apply:** 원본 ZIP·SHA-256을 유지하고 필요하면 다운로드 파일만 분할한다. Windows 기본 명령으로 합치는 안내와 재결합 해시 검증을 제공하며, 분할을 새 installer 생성으로 취급하지 않는다.

## Credit 절약형 개발 제약

Windows 전달 명령의 문자열·해시·안전 분기 정적 검사는 실제 `cmd.exe → PowerShell` 실행 검증을 대신하지 않는다. Windows 환경이 없으면 호출 경로는 미검증으로 명시한다.

**Why:** 정적 안전성 검사를 통과한 전달 명령도 PowerShell 문장 구분자 누락으로 사용자 Windows에서 ParserError가 발생한 사례가 있다.

**How to apply:** 새 전달 명령은 생성된 최종 파일을 기준으로 검증한다. 실행 환경이 없으면 구문·escaping·안전 분기 검토와 실제 실행 증거를 구분하고, 정적 검사만으로 Windows 실행 PASS를 선언하지 않는다.

OFFICE 개발은 관련 Backend·UI·Action·AI Tool·제한 테스트를 하나의 명확한 Vertical Slice로 처리한다. 완료된 조사·PASS/CLOSED 영역을 근거 없이 다시 감사하지 않고, 기존 Context·컴포넌트·service·테스트 결과를 재사용한다.

**Why:** 사용자가 2026-10-15 credit 절약을 최우선 개발 제약으로 명시하고, 전체 Repo 재조사·매 Slice 전체 suite/typecheck/build·불필요한 문서·중복 Agent 조사를 금지했다.

**How to apply:** Slice에서는 변경영역의 검증만 한다. WP Gate는 관련 회귀, Core/Release Gate는 승인된 통합 검증을 수행한다. installer는 Foundation·native 변경·통합/Release Gate에서만 빌드하고 Production 배포는 승인된 묶음으로 한다. 권한·금액·경쟁 조건 검증 자체를 절약 이유로 생략하지 않는다.

실제 계정 Billing/Usage 근거 없이 engineering hour·작업회차를 credit·USD·KRW로 환산하지 않는다. 외부 문서·권한·MID·서명·정책·migration 승인이 없으면 해당 Slice를 중단하고, 추측 개발이나 반복 조회를 하지 않는다.

**Why:** 사용자는 실제 과금정보나 calibration 없이 “1회당 금액”을 만들지 말고, blocker 및 예산 초과 시 승인받도록 요구했다.

**How to apply:** 계정 사용량과 작업별 비용이 확보된 뒤 위험별 예산을 잡는다. 80% 경고·100% 추가 작업 중지 원칙을 적용하되, 실시간 usage 접근이나 자동 집행이 없으면 자동중지를 보장하지 않는다. Provider 대기기간은 Agent 작업비로 계산하지 않는다.
