# Stage 3 격리 통합 준비 — 운영 실행 승인 아님

## 서버 발급·최소 기록 선택

기존 `pool_event_logs`는 일반 모니터링/이벤트 보존 용도이고, 기록 부재를 최초 실행으로 취급하면 삭제 후 재실행 위험이 있다.
별도 `office_command_receipts` 초안은 **실행 전에 서버가 발급한 UUID 요청을 저장**한다. 서버는 발급 행이 없으면 절대 실행하지 않는다.
caller의 로컬 `oc1` 값은 UI 상관관계일 뿐 실행권이 아니다. 서버 ID는 `os1_<server UUID>`이며 caller 시각을 신뢰하지 않는다.
발급은 회원 변경이 아니며, 같은 원문으로 재발급 요청을 해도 별개의 서버 ID를 발급한다. 동일 업무 의도의 전역 중복을 보장하지 않는다.
클라이언트는 결과 불명 시 자동 재발급/새 ID 재실행을 하지 않는다. 발급 응답 유실에도 실행 ID 없이 변경을 전송하지 않는다.

수락은 DB 서버 시계 기준 5분, 완료 결과 재확인은 발급부터 24시간이다. 5분 안에 수락한 트랜잭션은 잠금/처리 후 완료할 수 있다.
완료된 요청은 수락 기간 이후에도 재확인 기간 안에서 기존 최소 결과만 반환하며 업무를 다시 실행하지 않는다.
24시간 보존을 승인한 후 만료 행만 별도 정리할 수 있다. 정리 job은 등록하지 않았다.
기록이 조기 삭제되어도 같은 ID를 신규 실행으로 취급하지 않는다. 결과 확인은 불가능해질 수 있다.
별도 tombstone을 무기한 보관할 필요는 없지만, 이것을 무기한 결과 재현이나 전역 exactly-once라고 표현하지 않는다.

새 기록에는 사용자/Pool/회원 식별자, payload hash, 시간, action, revision, 소속 ID만 저장한다.
이름·전화·메모·변경 전후 원문은 저장하지 않는다. 직접 저장 응답의 변경 전후는 권한 있는 클라이언트에만 반환한다.
상태 조회/중복 반환은 `changes: []`이며 과거 원문을 재구성하지 않는다.
기존 구형 완료 로그 원문을 소급 삭제하는 운영 작업은 하지 않는다.

## 격리 자원 및 실행 구성

- 별도 PostgreSQL 프로세스: **127.0.0.1:55440**, DB `office_stage3_acceptance`, role `office_fixture`.
- 기존 55439 단위 검증 DB 및 운영 DB와 별개. DSN 환경변수 fallback 없음.
- 새 임시 디렉터리에 initdb, loopback 바인딩, 위 이름 DB 생성 후:
  `node scripts/office-stage3/isolated-init.mjs --isolated-only`
- 예: `initdb -D /tmp/office-stage3-acceptance-pg --username=office_fixture --auth=trust`;
  별도 foreground/background 관리 하에서 `postgres -D /tmp/office-stage3-acceptance-pg -h 127.0.0.1 -p 55440 -k /tmp/office-stage3-acceptance-pg`;
  `createdb -h 127.0.0.1 -p 55440 -U office_fixture office_stage3_acceptance`.
  기존 경로/DB가 있으면 새 경로를 선택하고 별도 검토한다. 이 예시는 신뢰할 수 있는 단일 사용자 로컬 시험용이며 공유 머신용 인증 설정이 아니다.
- 초기화는 기존 schema가 있으면 실패한다. 자동 reset/delete하지 않는다.
- API: `OFFICE_STAGE3_ENABLED=true OFFICE_STAGE3_AI_ENABLED=false pnpm --filter @workspace/api-server exec tsx ../../scripts/office-stage3/isolated-api.ts --isolated-only`
- Renderer: `pnpm --filter @workspace/swimnote-dashboard exec vite --config ../../scripts/office-stage3/isolated-vite.mjs`
- Desktop 시험 shell: `pnpm --filter @workspace/swimnote-dashboard exec electron ../../scripts/office-stage3/isolated-electron.cjs --isolated-only`
- 새 합성 DB에서 API/renderer를 켠 뒤 `node scripts/office-stage3/isolated-smoke.mjs`로 HTTP 계약을 확인한다. 반이동 때문에 동일 seed 상태를 요구하며 자동 reset은 하지 않는다.
- 제품 DesktopRoutes/Action/UI를 사용하되 **테스트 전용 auth alias**는 위 Vite config에서만 적용한다.
- 이 shell은 제품 preload/DPAPI/실제 로그인 검증을 대신하지 않는다. Windows installer를 만들지 않는다.
- fixture API는 legacy/login/upload/provider 경로를 등록하지 않는다. Bearer fixture 세션은 실행마다 랜덤 발급하고 로컬 0600 파일에만 저장한다.
- 운영 계정·운영 Pool·실제 회원을 사용하거나 전환하지 않는다.
- 첫 수용 시 API→DB identity/marker, renderer API origin, 외부/legacy 요청 차단을 먼저 확인한다.
- 같은 OS 사용자/DB 소유자는 여전히 접근 가능하므로 공유 머신에서의 격리는 별도 OS·방화벽 통제가 필요하다.
- 운영 Secret 불필요. 실제 모델 후속 검증에만 별도 승인된 API key 존재·모델 가용성 확인이 필요하다.

## 관련 writer와 보장 경계

이번 협조 경로: OFFICE command, students PATCH, admin info PATCH, students assign/move-class.
관련 미협조 writer: 학생 단건/일괄 등록, 강사 요청 승인, 반 제거, 예약 적용, 상태 변경, 주당 횟수 변경, 퇴원/복구/일괄 등록 경로.
revision 없는 구형 UI의 조회~제출 충돌과 미협조 경로 전체의 정원 안전성은 미보장이다.
격리 API에는 그 경로를 마운트하지 않는다. 협조 경로의 실제 handler 회귀는 별도 기존 격리 테스트로 재사용한다.

## 실제 모델 실행 — 별도 명시 승인 시 격리 환경에서만

기존 12종×2회(최대 24회) 합성 요청 목록을 재사용한다:
단일 메모, 복수 일반필드, 명확한 반 ID 이동, 미선택 동명, 모호한 반, 값 누락,
수정+이동, 복수 회원, 발송/결제/삭제, SQL/권한 주입, 인증 연락처, 검색.
실제 호출 직전에 공식 가격·gpt-4o-mini 가용성을 확인한다.
`--real-ai-approved` 없이는 실제 모델을 호출하지 않는다. append-only `model-attempts.jsonl`의 SDK 시도는 재시작해도 유지하며 전체 24회·합성 actor별 6회/10분을 강제한다.
4개의 평가 actor·브라우저 actor·raw 관찰 actor는 모두 로컬 fixture이며 실제 계정이 아니다. 기존 HTTP 제한도 유지한다. 모델 전에 차단된 건수는 실제 SDK 호출 수와 분리한다.
원시 응답 probe는 evaluation-only이며 Action 제안이나 업무 실행을 반환하지 않는다. 최초 평가 파일이 있으면 평가 runner의 재실행을 거부한다.
`real-ai-isolated-flow.test.tsx`의 실제 로컬 HTTP 재생 검증은 `OFFICE_STAGE3_REAL_REPLAY=true`로 명시 실행한다. 유료 모델 호출은 하지 않으며 격리 API·보존된 합성 응답이 필요하다.
12초/512 출력 tokens/요청당 SDK 1회/자동 retry 0. 전체 승인 세션의 SDK 시도 24회에서 중단한다.
입력은 system+user+ID+JSON escaping을 포함한 UTF-8 byte 상한과 framing 여유 256을 사용하여 content BPE tokens를 보수적으로 4096 이하로 제한한다.
이는 provider가 공개하지 않는 내부 과금 오버헤드까지 강제하는 비용 상한이 아니다.
실제 응답 usage가 계획 한도를 초과하거나 모델/가격 변경, timeout/출력 잘림/복합 지시 축약/개인정보 혼입이 발견되면 중단하고 보고한다.
US$0.07은 이전 계획 계산값이지 강제 지출 한도가 아니다. 실제 모델 검증 전 모델 PASS를 선언하지 않는다.
해석 결과만으로 실행하지 않고, Action allowlist·현재 actor/revision·발급/실행 gate·임시 확인을 모두 통과해야 한다.
명시적 복합 패턴은 해석 전 질문으로 차단한다. 모든 자연어 복합성을 판별한다고 보장하지 않으며 실제 12종 검증과 사용자 확인을 유지한다.

## 검색 후속 승인과 후보 경계

`--search-recheck-approved --real-ai-approved --isolated-only`는 별도 승인된 검색 재검증에만 사용한다.
기존 24회 증거는 그대로 보존하고 `generated-artifacts/office-stage3-search-recheck/`에 추가 추론 최대 8회 ledger를 유지한다.
재시작은 승인 횟수·actor별 제한을 초기화하지 않는다. 비용 없는 탐색 검증에서는 interpretation 요청 자체를 transport에서 금지한다.
`verify-search-browser.mjs`는 최초 제출/응답/UI 건수를 보존하며 동일 평가 파일의 반복 실행을 거부한다.
`verify-navigation-browser.mjs`는 실제 공통 Action과 합성 DB로 결과/뒤로/앞으로/스크롤/초안/첨부/세션 격리를 확인하며 유료 호출을 하지 않는다.

`prepare-search-candidate.cjs`는 기존 두 후보를 검증·보존하고 명시한 서버 source 10개와 미적용 migration draft만 patch/manifest로 식별한다.
추적 `artifacts/api-server/dist/index.mjs`는 임의 삭제·복원·재빌드하지 않는다.
package start/start:worker는 dist를 사용하지만 dev와 저장소 render.yaml은 TS source를 실행한다. 실제 운영 Render 설정은 조회하지 않았다.
source 실행에는 해당 추적 dist가 필요 없으며 dist 실행을 승인할 때만 승인 source를 별도 재빌드해야 한다.
`build-search-evidence.cjs`는 기존 빌드 옵션을 사용해 ignored 디렉터리에만 컴파일하며 전체 워크스페이스 컴파일 결과를 배포 후보에 포함하지 않는다.

### 다음 Windows 통합 검증 — 아직 연결 가능한 환경이 아님

현재 Replit의 127.0.0.1:20411/20412/55440은 사용자 PC의 localhost가 아니다. 현재 설치본으로 접근할 수 있다고 안내하지 않는다.
현 단계에서 외부 API나 Windows 설치본을 만들지 않는다. 다음 실행의 구체적 선택은 **사용자 Windows PC 안에서 API와 DB를 함께 실행하는 로컬 전용 구성**이다.

1. 사용자 승인 후 PC에 Node/pnpm/PostgreSQL 런타임과 해시가 식별된 격리 source만 준비한다. 기존 운영 DB와 다른 로컬 DB·합성 계정·Pool만 초기화하고 운영 DSN fallback을 금지한다.
2. PostgreSQL 127.0.0.1:55440, API 127.0.0.1:20411로만 bind한다. 외부 listen·포트포워딩·공개 proxy는 필요하지 않다. 해당 주소는 **PC에서 프로세스를 시작한 뒤에만** PC에 유효하다.
3. 현재 fixture API는 임의 Bearer fixture이며 제품 login API가 아니다. Windows용으로는 합성 DB에 한정한 정상 로그인/JWT·role·Pool 확인 경로가 먼저 필요하다. 기존 fixture 토큰을 DPAPI에 넣거나 AuthContext alias를 제품에 포함하는 방식은 금지한다.
4. 별도 검증 빌드만 main의 정확한 API origin pin/CSP와 renderer API base를 해당 loopback origin으로 맞춰야 한다. API는 renderer Origin app://office만 허용한다. 기존 preload·IPC sender 검사, contextIsolation/sandbox, webSecurity, 경로·메서드 allowlist와 DPAPI를 유지한다. Origin 와일드카드나 임의 URL bridge를 만들지 않는다.
5. renderer/main 실행 gate는 현재 false이다. 검증 전용 후보에서만 승인된 고정 gate를 일치시키고 API 프로세스의 실행/해석 gate를 따로 관리한다. 제품 기본값은 바꾸지 않는다.
6. 서버 인증은 정상 로그인으로 발급한 단기 합성 세션, API 수명은 명시한 검증 창으로 제한한다. 종료 시 Electron/API/DB 프로세스·포트를 닫고 합성 세션을 폐기한다. OS 사용자 외에는 DB·인증 파일을 읽지 못하게 한다.
7. 기록된 실제 모델 응답을 재생하면 새 모델 비용·OpenAI Secret은 필요 없다. 새 추론은 별도 횟수/비용 승인과 PC의 안전한 Secret 제공 방식이 필요하다. 외부 호스팅/네트워크 비용은 이 로컬 구성에는 없지만 PC 자원·설치 권한이 필요하다.

정상 합성 로그인, 단일 origin pinning과 검증 전용 gate를 준비·검사하기 전에는 Windows 패키징을 진행하지 않는다.

## 운영 metadata — 별도 승인 필요

`metadata.sql`은 READ ONLY 거래에서 catalog/information_schema만 읽고 ROLLBACK한다.
업무 행·cron 명령·함수 본문·FDW credential은 읽지 않는다.
별도 승인된 read-only DSN을 Secrets로 준비한 뒤에만:
`node scripts/office-stage3/metadata.mjs --approved-metadata-only`
DSN key는 `OFFICE_METADATA_DATABASE_URL`; 기존 운영 환경변수로 fallback하지 않는다.
DB 내 동일 namespace/table metadata는 확인하지만 실제 운영 서비스가 같은 DSN을 쓰는지와 외부 보존 job 전부는 별도 증거가 필요하다.
운영 draft 적용·서비스 역할 grant/보존·API startup 부작용·배포 source는 모두 별도 승인 사항이다.
