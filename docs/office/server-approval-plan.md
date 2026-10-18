# OFFICE 잔여 서버 변경 — 적용 전 검토안

## 2026-10-19 승인분 실행 결과 / 다음 묶음 분리

- 승인 대상 `d8e77c91352e201e6eb5d2b6f5c6e18d26aeca05`: 같은 GitLab feature branch의 정상 push·원격 SHA 확인 후 명시 commitId 배포. Render `dep-dbae18e1egvs73ablc40` LIVE·실제 health commit 일치(HTTP 200). main/연결 branch/autoDeploy=no 보존.
- 직전 LIVE `65970347d33889c90e896ed2b236da45ac1ae290`과 복구 요청 body를 `generated-artifacts/office-approval-20261019/before.json`에 보존했다. 복구는 해당 commitId로 API 소스만 되돌리는 수동 배포이며 DB·처리 영수증 삭제/역 migration은 하지 않는다.
- 이번 승인 SHA에는 직전 LIVE 대비 신규 migration이 없어서 migration·schema 2 재적용을 하지 않았다. 모델 스위치/알림 OFF 유지. 실제 모델 4회는 합성 fixture·실제 SDK/helper의 독립 시험이며 운영 저장/발송을 실행하지 않았다. 실제 응답/usage/요청 전 예산 확인은 같은 디렉터리의 model-budget.json에 있다.
- **후속 무료 배차 준비 소스는 위 승인 SHA 밖이다.** 새로운 `office-transport-preparation.sql`은 새 레코드/불변 스냅샷 테이블·변경 차단 trigger를 위한 별도 승인 대상이며 작성만 했다. 기존 schema 2를 변경·재적용하는 방법으로 대체하지 않는다. 실제 migration/경쟁/trigger 적용 검증은 아직 없다.
- 후속 영향: 관리자 전용 무료 준비 CRUD/검수·스냅샷·서버 영수증 재사용. 기사/학부모 권한·APP·SSE·PUSH·가격·구독·용량·AI ENGINE 변경 없음. 향후 적용은 최종 보고의 새 source SHA와 새 migration을 묶어 별도 승인하며, 미적용 서버는 저장을 허위 성공 처리하지 않는다.

이 문서는 Agent의 후속 적용을 검토하기 위한 것이다. 사용자가 Windows에서 개발 도구·터미널·DB를 실행할 필요는 없다. 두 패치는 **실행 중인 API 소스에 적용하지 않았다.** 운영 배포·DB/schema 변경·운영 업로드/삭제/발송·유료 호출도 하지 않았다.

## 1. 관리자 보강: 최소 후보

파일: `candidates/admin-makeup-unapplied.patch`. 별도의 검증 환경이나 대체 서버를 만들지 않는다.

| 경로 | 현재 역할 | 후보 역할 | 범위 |
|---|---|---|---|
| PATCH /admin/makeups/:id/assign | super_admin | super_admin, pool_admin | 보강·학생·배정반·반 담당자의 Pool 일치 |
| PATCH /admin/makeups/:id/complete | super_admin | super_admin, pool_admin | 보강·학생 및 지정된 대리선생님의 Pool 일치 |
| PATCH /admin/makeups/:id/revert | super_admin | super_admin, pool_admin | 보강·학생 Pool 일치 |
| PATCH /admin/makeups/:id/cancel | super_admin | super_admin, pool_admin | 보강·학생 Pool 일치 |
| POST /admin/makeups/:id/extinguish | super_admin | super_admin, pool_admin | 보강·학생 Pool 일치 |

Pool은 인증된 요청의 기존 `getAdminPoolId`에서 얻으며 body의 role/Pool로 바꾸지 않는다. 새 가드는 보강과 학생을 JOIN하여 둘 다 같은 Pool인지 검사한다. 배정반과 담당자, 대리선생님도 같은 Pool에서만 선택한다. 같은 Pool의 자기 강사(pool_admin DB 역할)를 허용한다. 기존에 허용된 담당자 없는 반은 유지한다. 센터 경로의 ID 형식과 만료 허용 boolean을 확인한다. 확인 실패/DB 오류 때 handler로 진행하지 않는다.

기존 requireAuth/requireRole, 날짜 검증, 만료 확인, 조건부 상태 UPDATE, 활동 기록·시스템 메시지·기존 이벤트는 유지한다. teacher 경로·teacher 역할·완료 직접처리 계약은 변경하지 않는다. super_admin은 새 센터 가드를 우회하여 기존 정책을 유지한다. transfer/handover와 임의 최종 상태 변경 권한은 확대하지 않는다.

`candidates/makeup-scope.ts`는 미적용 서버 패치에 포함된 동일한 순수 가드의 검토용 소스다. 직접 관련 fixture는 소유 Pool 통과, 타 Pool 보강/학생/반/강사 거부, teacher/parent/sub_admin 거부, super_admin 기존 분기, 잘못된 ID/Pool/만료 동의 형식을 확인한다. 실제 DB SQL·경쟁 상태·활동 로그·알림 실행은 NOT RUN이다. 이 fixture를 운영 적용 검증으로 대신하지 않는다.

현재 설치본의 pool_admin 배정/완료/취소/소멸 차단은 유지한다. **서버 패치 준비를 PC 실행 연결 완료로 계산하지 않는다.** 승인 후 서버 반영과 함께 기존 보강 화면의 해당 입력·native 허용 경로를 활성화하고 관련 제한 검사를 수행해야 한다.

## 2. 영상 재생주소: 별도 최소 후보

파일: `candidates/video-playback-unapplied.patch`.

기존 `/videos/group/:classId`, `/videos/private/:studentId`, `/videos/diary/:diaryId` 일부 SELECT에서 `object_key`가 빠져 기존 서명 함수가 영상 URL을 만들지 못한다. private 목록은 서명 함수 호출도 없다. 후보는 이 세 목록의 필요한 SELECT 필드와 private의 기존 batchVideoPresign 호출만 보완한다. 경로·역할·저장·보관·압축 계약을 새로 만들지 않는다. 기존 업로드/첨부의 권한 검사를 대체하는 보안 패치나 부모 조회 권한 감사로 해석하지 않는다.

PC는 현재 API로 원본 업로드·파일 ID 목록 재조회·공용/개인 노트 첨부·대상 일지 재조회를 수행한다. 주소가 없으면 메타데이터만 표시하고 재생 완료로 표시하지 않는다. 후보 승인 후 기존 R2 HTTPS allowlist 내 URL만 재생하며, codec 지원·만료 오류는 별도로 표시한다. 새 HTTP proxy/임의 도메인·변환 엔진은 추가하지 않는다.

## 3. 적용/복구 절차 — 명시 승인 후 Agent가 수행

1. 승인할 패치/소스 SHA와 대상 환경, 허용할 검증 대상·읽기/쓰기 범위를 확정한다. 현재 승인된 운영 연결 저장소·대상 SHA 기준을 별도로 확인한다.
2. 현재 소스에서 `git apply --check docs/office/candidates/admin-makeup-unapplied.patch` 및 영상 패치의 check만 수행해 문맥 일치를 확인한다. 문맥이 달라졌으면 강제 적용하지 않는다.
3. 적용 승인 후 해당 패치만 적용한다. 관리자 PC 버튼/native 허용 경로 활성화는 같은 후속 변경에서 처리한다. 최소 관련 검사와 제품 빌드 후 승인된 feature branch에 commit/push한다. schema 변경은 없다.
4. 별도 배포 승인 후 승인한 정확한 SHA만 기존 운영 절차로 배포한다. 실제 보강/영상 쓰기는 별도 승인한 대상만 실행한다. health SHA와 제한 검증을 확인한다.
5. 복구가 필요하면 먼저 실행 경로를 차단하고 승인된 직전 서버 SHA로 복구한다. 개발 소스의 역패치는 `git apply --reverse --check <해당 패치>`로 먼저 확인한다. 실제 역패치·신규 helper 삭제·운영 복구는 별도 승인 후 수행하며 reset/force push를 사용하지 않는다.
6. 이미 발생한 보강 상태·로그·영상 업로드/첨부는 코드 복구로 되돌아가지 않는다. DB 보정·파일 삭제·알림 재발송은 자동 실행하지 않으며 별도 검토/승인이 필요하다.

두 후보 모두 `git apply --check`까지만 수행한 상태다. 운영 반영이나 Windows 실행을 의미하지 않는다.

## 4. 2026-10-18 Smartro 전 운영 통합 — 한 번에 승인할 적용 묶음 (아직 미실행)

- **대상:** 기존 운영 API의 승인된 소스 SHA. PC 일반 운영, 기존 Stage 3, 신규 operations/finance/import/intake/NFC/AI 초안 호환 라우트 및 성장리포트 `history=published` 조회. APP/AI ENGINE 배포는 없음.
- **DB:** 먼저 기존 `office-admin-core.sql`의 적용 여부/실제 테이블·컬럼·권한을 대조하고, 미적용이면 기본 migration → `office-finance-core.sql` 순으로 명시 승인 후 적용한다. 신규 기록·버전·멱등 영수증, ledger sequence/import-source unique, schema marker/NFC 알림 이력 범위다. 운영 학생/청구 대량 변경 또는 자동 이전을 포함하지 않는다.
- **활성화:** 새 유료 운영 AI `OFFICE_OPERATIONS_AI_ENABLED`, 무료 이전 모델 스위치, NFC 보호자 알림은 별도 명시 승인 전 OFF. 현재 소스 준비는 활성화/비밀값 변경 승인이 아니다. 새 모델은 단일 선택 자료의 제한된 초안만 처리하고 DB tool/자동 실행·자동 재시도 없음.
- **영향:** 새 기능은 기본/금융 marker 확인 전 503/적용 대기다. 공개 태블릿은 전용 만료 토큰만 사용하며 관리자 세션을 노출하지 않는다. 생성 문서는 양식/직접 서명/확정 메타데이터로 저장하고 파일 bytes/base64를 DB에 넣지 않는다. 인쇄/PDF 결과는 사용자 장치에서 확인한다.
- **적용 전 Gate:** 실제 운영 schema·SQL·센터/역할·동시 요청·rollback을 허용된 대상에서 검증해야 한다. 현재 순수 검사/Native/컴파일은 실제 PG SQL 트랜잭션·운영 권한·실장비 증거가 아니다. 자동 DB 초기화/로컬 업무 DB를 만들지 않았다.
- **배포:** 승인된 정확한 SHA만 기존 운영 절차로 반영, health SHA와 읽기 상태/권한을 확인한다. 운영 쓰기·원본 이전·알림·실발송·환불은 승인된 각 대상/범위 없이는 수행하지 않는다.
- **복구:** 우선 모델·NFC 알림을 OFF로 유지/차단하고 직전 승인 서버 SHA로 복구한다. 새 schema/기록은 보존하며 자동 DROP/데이터 역변환/환불·발송 재시도는 하지 않는다. 업무 기록 정정은 별도 사유 있는 원거래 정정으로 한다.
- **별도 외부 조건:** Windows 10/11 실기기/인쇄·태블릿·UID+Enter 리더, Smartro 계약/SDK/MID/실거래, 앱 입력·모바일 결제 후속 통합, 배차 원문, 미정 요금/법률 정책. GitLab 인증 복구와 원격 게시도 별도이며 다른 원격으로 우회하지 않는다.

## 5. 승인 후 운영 사전검사 — 2026-10-18 HOLD

사용자의 조건부 승인을 받았으나, 아래 호환성 Gate 실패로 migration과 배포를 실행하지 않았다.

### 고정 적용 대상
- 승인 소스: `f019fe8ec07ad6cd37cde955ac32943637bad939`.
- 기본 migration: `artifacts/api-server/src/migrations/office-admin-core.sql`
  - SHA-256: `80f5c104bd32e4ada84641118cb3b4d1838dae1b2630aa26178c2d4d2e13bc7b`
- 금융 migration: `artifacts/api-server/src/migrations/office-finance-core.sql`
  - SHA-256: `7703f09ee7f07bbfdd6749af9e1d80ef92b36436003bdd99d53532e2c272cde3`

### 확인 결과
- 실제 API: `https://swimnote-api.onrender.com/api`. Render 연결은 기존 GitLab 저장소/main, 자동 배포 OFF를 그대로 확인했다.
- 기존 LIVE/복구 기준: `e3018d51262091981b444fb30ab476520f45ddcd`, Render deploy `dep-db90le7f3r2c73fmgksg`. 실제 `/api/health`는 200이며 같은 commit을 반환했다. 기존 소스는 로컬 이력에 보존되어 있다. 복구 배포 자체를 시험하지는 않았다.
- 운영 PostgreSQL 17.6에서 `BEGIN READ ONLY`로 schema·관련 컬럼을 확인했다. OFFICE 기본/금융 테이블·marker는 없었으며, 적용 완료 증거로 간주하지 않았다.
- 기존 `attendance.date`는 `text`이다. 새 금융 `courseContext` 조회의 원문 조건 `a.date <= $2::date`를 실제 운영 DB에서 `EXPLAIN`했고, SQLSTATE `42883`, `operator does not exist: text <= date`를 확인했다. `ANALYZE`나 업무 데이터 쓰기는 실행하지 않았다. SAVEPOINT로 오류를 격리하고 전체 읽기 전용 transaction을 ROLLBACK했다.
- 따라서 새 수강권·금융 조회의 기존 앱 schema 호환성은 FAIL이다. 기존 날짜 컬럼의 형식 변환·강제 덮어쓰기로 우회하지 않는다.
- GitLab API 읽기는 정상이나 승인 commit 조회는 404였다. 원격 OFFICE branch는 `c3f9e6a975550e6d4d3ce595bc86c210d9dd561e`이며, Git의 기존 인증 경로 조회는 시간 초과로 끝났다. API 읽기 성공을 Git push 인증/게시 성공으로 해석하지 않는다. 원격 쓰기·다른 remote 우회는 하지 않았다.
- 새 복구용 DB 백업은 생성하지 않았다. 백업 테이블의 존재만 확인했으며, 기존 백업의 복구 가능성을 검증 완료로 표시하지 않는다. **복구 가능한 변경 전 백업 확보 전 migration 금지** 조건은 그대로 유지한다.
- 새 `OFFICE_OPERATIONS_AI_ENABLED`, `OFFICE_IMPORT_AI_ENABLED`, `OFFICE_NFC_NOTIFICATIONS_ENABLED`는 운영 서비스에 없으며 승인 소스에서 기본 OFF다. 기존 운영 설정은 변경하지 않았다.

### 실행하지 않은 항목과 재개 조건
- 기본/금융 migration, 서버 배포, 실데이터 변경, 모델 호출, 발송/알림, 결제/환불, 가격·구독·용량 정책 변경은 모두 미실행이다. 직접 실행한 운영 작업은 읽기 전용 사전검사뿐이다.
- 배포 후 로그인·조회·새 업무 검증은 아직 수행 대상이 아니다. 기존 health 확인을 이 검사들의 PASS로 확대하지 않는다.
- 기존 DB 형식을 유지하는 서버 SQL 수정·관련 재검증, 수정 SHA 확정, 동일 GitLab 저장소 게시, 복구 가능한 백업 확인 후에만 적용을 재개한다. 승인 SHA를 임의로 다른 HEAD로 바꾸거나 migration 실패/호환성 실패 상태에서 배포하지 않는다.

## 6. 서버 SQL 수정 후보 준비 — 2026-10-18, 운영 적용은 계속 HOLD

- 사용자 승인 범위: 서버 SQL 수정·재검증·새 SHA 준비만 진행. migration·배포·설치본 재생성은 하지 않았다.
- **수정 서버 후보 SHA:** `65970347d33889c90e896ed2b236da45ac1ae290`. 기존 승인 소스 `f019fe8ec07ad6cd37cde955ac32943637bad939`를 자동 대체하거나 배포한 것이 아니다.
- 수정 범위: 금융 조회와 금융 이전 route 2개, 해당 route에서 사용하는 공통 SQL 모듈, SQL 계약 회귀 검사. PC·모바일·가격/구독/용량·DB schema는 변경하지 않았다.
- 수강권 출결 조회 `<=`, 휴회/취소 보호 `>=`, 기간 단축 보호 `>`, 이전 기준일 이후 출결 보호 `>`의 날짜 매개변수를 `text`로 비교한다. 기존 `attendance.date`를 DATE로 변환하지 않으며, 실제 DATE인 `student_class_history`의 날짜 처리와 기존 회원/계약/반/센터 범위는 유지한다.
- 두 migration 파일과 위 SHA-256은 변경 없음.

### 변경 범위 검사 결과
- SQL 계약 회귀 8건 + 기존 금융 순수 로직 29건 = 관련 검사 **37건 PASS**.
- 변경 소스 root 3개 타입 검사: 직접/전이 진단 0건. 이는 API 전체 타입 검사 PASS를 의미하지 않는다.
- 금융 route 2개 bundle 및 `git diff --check` PASS.
- 실제 운영 DB `BEGIN READ ONLY`에서 route가 사용하는 **동일한 exported SQL**을 EXPLAIN(ANALYZE 없음)했다:
  - 수강권 출결 조회·이전 기준일 보호 2개: 실제 기존 테이블을 대상으로 PASS.
  - 휴회/취소·기간 단축 보호 2개: 미생성 `office_operation_records`의 타입만 빈 CTE로 제공하여 PASS. 테이블 생성·업무 자료 삽입은 없었으며, 실제 신규 테이블/권한/저장 검증을 대신하지 않는다.
  - 같은 연결에서 이전 잘못된 비교는 SQLSTATE `42883`으로 거부되는 것을 재현하여 검사 민감도를 확인했다.
  - 기준일 전/당일/후·월/연도/윤년/다음 연도 경계 7건 PASS.
  - 검사 transaction은 ROLLBACK. OFFICE 기본/금융/NFC 테이블은 검사 전후 모두 미생성 상태였다.

### 계속 남는 적용 조건
새 후보 SHA 확정 승인, 동일 GitLab 원격 게시, 복구 가능한 변경 전 백업 확보, 실제 신규 테이블·권한·트랜잭션 적용 검증을 완료하기 전 운영 적용은 중지한다. GitLab 인증 복구·백업 생성·migration·배포·모델 호출·발송/자동 알림·결제/환불·기존 설정 변경은 이번 수정 작업에서 실행하지 않았다. 기존 통합 설치본은 보존하며 서버-only 수정 때문에 다시 만들지 않았다.

## 7. 새 SHA 조건부 운영 적용 — 2026-10-18

이 절은 위 HOLD 기록 이후의 새 승인·실행 기록이다. 사용자는 기존 안전 조건을 유지하여 아래 SHA의 운영 적용을 승인했으며, 같은 조건의 반복 승인이나 기능별 사용자 확인은 요구하지 않는다. 원격 게시·백업·schema 검증을 선행하고 기본 migration → 금융 migration → 지정 SHA 배포 순서로 진행한다. main 반영·강제 push·다른 원격·새 모델/무료 이전 모델 호출·실발송·자동 알림·실결제/환불·기존 구독/가격/청구/용량 정책 변경은 제외한다.

### 승인 소스와 게시
- **운영 대상 SHA:** `65970347d33889c90e896ed2b236da45ac1ae290`.
- 동일 `origin` GitLab `swimnote.admin/swimnote-app`의 `office/f02-foundation`에 정상 fast-forward push 성공. 기존 APP 전용 인증을 사용했고 Secret·전역 인증·원격 URL은 변경하지 않았다.
- 작업 시작 HEAD는 문서-only 후속 commit `00cbb2f1f8a9d23f53e7924348f81e2e58710820`이며, 이를 배포 대상으로 사용하지 않는다. 기존 `.replit` 작업 트리 변경도 보존한다.
- 사전 확인 main SHA: `04b120515c693f75a58ede06f74d2814ec1a099f`. main push/merge는 하지 않는다. API의 `main` 연결·자동 배포 OFF는 보존하고 Render `commitId`로 승인 SHA만 지정한다.

### 변경 전 복구 자료
- 기존 LIVE SHA `e3018d51262091981b444fb30ab476520f45ddcd`, deploy `dep-db90le7f3r2c73fmgksg` 및 해당 tracked source archive 보존.
- 운영 PostgreSQL 17.6 `pg_dump --format=custom --schema=public` 완료. 범위는 변경 대상 public 업무 schema·데이터·함수·권한이며 provider 관리 auth/storage schema·역할 password까지 포함한 전체 클러스터 백업은 아니다.
- DB dump는 평문 파일을 만들지 않고 AES-256-GCM으로 암호화했다. 복호화 후 dump SHA-256 대조 및 `pg_restore --file=/dev/null` 전체 archive member 읽기 성공. 별도 DB 실제 복원 시험은 미실행이며, 새 로컬 DB/서버를 만들지 않았다.
- 암호화 archive SHA-256: `3113d2ff02cffb2097b37deca0e8013eec3ba95528f169b33142d5698a944216`.
- 기존 서버 source archive SHA-256: `cb6c982c446a2945a1cdbe4c9b46f88331212572429a3bd815bb10b7a8ef2187`.
- 비공개 보존 위치: `generated-artifacts/office-production-apply-20261018/` (Git/배포 제외, 디렉터리 0700·파일 0600). dump는 `public-before.dump.aesgcm`, 복호화 metadata는 `backup-metadata.json`, 기존 소스는 `prior-server-source.tar.gz`. 공개 첨부/Library에 등록하지 않는다.
- 복구 키는 백업 당시 기존 `JWT_SECRET`에서 metadata의 salt/info로 HKDF-SHA256 도출한다. **복구 시 해당 Secret 버전이 필요하므로 키의 별도 안전한 보존 없이 rotation하지 않는다.** Secret 값은 문서·로그·archive metadata에 저장하지 않았다.

### 실제 schema·SQL·경쟁 보호 검사
- 새 5개 테이블을 실제 public schema에서 transaction 내 생성하고, 운영 앱과 동일한 DB role의 SELECT/INSERT/UPDATE 권한을 확인했다.
- 실제 route의 `readLedger`·`courseContext`, 과거 출결 보호 2종 및 이전 기준일 SQL 실행 성공. 빈 CTE로 대체하지 않았다. 이 검사는 실제 계약·수납 실행을 하지 않는다.
- 원장 순번·이전 원천·활성 카드·멱등 영수증의 중복을 SQLSTATE `23505`로 차단했다. 검증용 기록은 모두 rollback했다.
- 실제 동시 연결의 동일 수영장 `FOR UPDATE NOWAIT`가 `55P03`으로 차단됨을 확인했다. 이는 잠금·DB 제약 증거이며 모든 HTTP 업무의 commit 경쟁 E2E 완료를 의미하지 않는다.
- 다른 Pool 조건으로 fixture를 읽을 수 없음을 확인했다. HTTP 다른 역할 계정 전체 검증과 동일한 증거는 아니다.
- 전체 probe transaction rollback 후 OFFICE 테이블이 미생성 상태로 복귀했고 기존 업무 6개 테이블의 fingerprint가 일치했다.

### 적용된 migration
- 2026-10-18 18:35 KST 기본 → 금융 순서로 각각 COMMIT 성공. 위에 고정한 두 파일 hash는 동일하다.
- 수동 migration 이전에는 OFFICE 테이블/marker와 업무 migration 이력이 없었다. provider 관리 schema의 migration 이력을 OFFICE 이력으로 대체하지 않았다. 신규 금융 marker는 version=2, 1행이다.
- 신규 기록/버전/영수증/NFC 알림은 각 0행, 신규 index 전부 valid. 기존 날짜 컬럼 강제 변환·업무 자료 이전·학생/청구 변경은 하지 않았다.
- 기존 업무 6개 테이블의 migration 전후 전체 행 fingerprint 일치. 산식은 `encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\n' ORDER BY id),''),'UTF8')),'hex')`이며 각 public 테이블 전체 행, 동일 PostgreSQL JSONB text 직렬화·id 정렬·LF 구분을 사용한다.

| 전체 행 기준 테이블 | 행수 | SHA-256 |
|---|---:|---|
| students | 998 | `8c2c3ae4cebf524e50c70872972f7f23f7e5159586aee3f021c1f440fc4c49a9` |
| student_class_history | 409 | `1c13707db25aec453f310e2376c015d1b1db6fbcd276e8d832ce9cbc07160a0d` |
| class_groups | 131 | `ebdd13a35e633923b32d55de07fcda3d8d206ef917d8dfe15185ace697df6a76` |
| attendance | 2507 | `e49abf9058857645296d330783d7a4aedccb619e5d64c86fbb3096bcbe0c7d4b` |
| makeup_sessions | 405 | `7c99b66ce784ab19d45b4b14aaadb7db88f482125f1b1a267e74dc8fe03c021e` |
| swimming_pools | 18 | `3529d1d2247bcfc3a86b940550867d398d1512c4c59b828ec2dda8b787575ca0` |

### 배포 요청과 후속 검증
- 지정 SHA를 Render deploy `dep-dba9620m7kps73fv1ml0`로 1회 요청했다. 상태 불명 때 요청을 재전송하지 않는다. 아래 후속 결과가 기록되기 전 요청 수락을 LIVE/로그인/업무 조회 PASS로 해석하지 않는다.
- **최종 상태: LIVE 및 배포 후 검증 PASS.** Render는 2026-10-18 18:40:10 KST LIVE, 실제 `/api/health`는 HTTP 200·`ok=true`·commit `65970347d33889c90e896ed2b236da45ac1ae290`. boot ID `9d25d493-db07-459e-bcb2-e79cecf0f475`.
- 18:43 KST 기존 자격증명으로 실제 앱 통합 로그인 `/auth/unified-login` HTTP 200. 해당 계정의 기존 허용 역할을 `/auth/switch-role`로 전환한 후 `/auth/me`, `/students`, `/class-groups` 모두 200. 회원 233명·반 65개는 해당 계정의 기존 조회 범위이며 전체 DB 행수와 다른 scope이다. 회원 응답의 Pool 일치를 확인했다.
- 교사 활성 token의 OFFICE 접근은 403, 비로그인은 401. 관리자 token은 capabilities·기본 자원 11종 목록·금융 snapshot·접수 목록 조회 모두 200. 신규 업무 기록은 비어 있으며 임의 자료를 넣어 성공으로 꾸미지 않았다. 정상 20건 + 권한 거부 2건 = 22개 HTTP 검사 PASS.
- 첫 smoke에서 사용한 구형 `/auth/login`은 401이었다. 읽기 전용 진단에서 기존 비밀번호와 DB hash가 일치하고, 백업 전후 password hash·기본 역할 및 기존 인증 코드가 동일함을 확인했다. 실제 앱의 통합 로그인 경로를 사용하여 해결했으며 비밀번호 재설정·계정 역할/권한 변경·직접 JWT 생성·인증 우회는 하지 않았다. 첫 실패 증거는 별도 파일로 보존한다.
- 운영 repo/branch/자동 배포 OFF 설정과 세 OFFICE flag 부재/default OFF를 재확인했다. 모델/이전 AI/알림 경로를 실행하지 않고 capabilities와 설정의 비활성 상태를 확인했다.
- 배포 후 같은 산식으로 위 6개 테이블 전체 행 fingerprint 재측정·모두 일치. OFFICE 기록/버전/영수증/NFC 알림도 각각 0행이다. 이를 전체 DB 모든 테이블의 쓰기 0건으로 확대하지 않는다. 기존 로그인 활동 로그 및 기존 기동 초기화는 별개다.
- 새 target instance의 runtime log 372건에서 기동/DB 초기화 완료, SQL `42883`·OFFICE SQL 오류·error/fatal level 각각 0건 확인. 전체 조회 438건, 다음 페이지 없음.
- 적용·검증 evidence는 위 비공개 디렉터리의 `migration-application.json`, `deploy-terminal.json`, `postdeploy-verification-unified.json`, `runtime-log-summary.json`에 보존한다. 계정 식별자·비밀번호·token은 evidence에 저장하지 않는다.

### 최종 통합 체크리스트 — 기능별 사용자 재확인 요청 없이 모아서 수행
| 항목 | 현재 증거 / 후속 경계 |
|---|---|
| 지정 GitLab feature 게시·기본/금융 migration·실행 SHA/health | 이번 운영 적용 PASS; main 미반영 |
| 기존 앱 로그인·역할 전환·회원/반 조회 | 실제 운영 HTTP PASS; 휴대폰 UI 실행 검증과는 별개 |
| 관리자 신규 기본 목록·금융 snapshot·접수 목록·권한 거부 | 실제 운영 HTTP PASS; 실제 업무 저장/승인·원본 이전 완료는 아님 |
| 기존 데이터·설정 보존 | 위 6개 테이블 전체 행 일치·feature flag/서비스 설정 보존; DB 전체 무쓰기 주장 아님 |
| 암호화 업무 DB 백업·직전 서버 소스 | 전체 archive 읽기·복호화 hash PASS; 별도 DB 실제 복원 시험은 미실행 |
| 기존 통합 설치본의 신규 업무 화면·입력/저장/미리보기·인쇄/PDF | 최종 Windows 통합 검수에 모음; 이번 서버-only 작업에서 installer 재생성·Windows 실행 없음 |
| 실제 태블릿·NFC UID+Enter·카드·인쇄 장비 | 최종 실장비 검수; readerVerified=false를 PASS로 바꾸지 않음 |
| 모델·이전 AI·실발송/자동 알림·실결제/환불·Smartro | 이번 작업에서 미실행/비활성; 별도 허용된 최종 범위/외부 조건에 따름 |

이번 완료 범위는 승인 서버 SHA의 운영 적용과 위 제한된 검증이다. OFFICE 전체 기능·실장비·실거래 완료를 의미하지 않는다.

## Smartro 전 잔여 통합 — 새 운영 적용 승인 요청 묶음 (미실행)

**서버·웹 소스 확정 SHA:** `f580b7a076cad009675a253ee1124ee8c26b0e0d`

이 SHA는 원래 GitLab 저장소의 `office/f02-foundation`에 보존한다. 이후 설치본 식별/승인 문서만 커밋한 HEAD와는 구분한다. 설치본 source identity의 HEAD·diff 및 payload 해시가 정확한 설치 후보 기준이다.

### 요청하는 변경만
1. 기존 API 서비스에 위 소스를 적용: `/office/operations/finance/batch/preview|execute`, 전체 원장 기반 회원/검색 보고서, 가맹점 수동 진행 메타데이터, 같은 이전 계약·시작일의 재등록 중복 방지.
2. 홈페이지 정적 소스의 `/merchant-application` 안내 페이지를 승인된 배포 경로로 반영. 개별 센터 상태 공개/공식 신청서 자동 전송은 없다. main merge·다른 원격·연결 저장소 변경은 이 요청에 포함하지 않는다.
3. **migration 없음.** 기존 schema 2와 `office_operation_records/versions/receipts`를 사용한다. 이미 적용한 `office-admin-core.sql`·`office-finance-core.sql`을 재적용하지 않는다.

운영 승인 전에는 1·2를 실행하지 않는다. 새 서버 capability는 `financeBatchVersion=1`, `merchantOnboardingVersion=1`로 명시되며 구 서버에서는 해당 새 쓰기 UI가 비활성이다. 보고서 `reportVersion=1`이 없으면 새 필터 합계를 성공처럼 표시하지 않는다.

### 앱·데이터 영향
- 모바일 앱·AI ENGINE·OTA·기존 가격/구독/저장량·알림/모델 스위치 변경 없음. 일반 업무 무료 정책 유지. 앱의 신청 진입/상품 안내 변경은 후속 통합 앱 빌드.
- 대량 발행도 기존 `invoice.issue` 원장 행이고 별도 결제 원장이 없다. Pool `FOR UPDATE`→원장 버전 확인→각 회원/계약 귀속·마감 검증→미리보기 해시 확인→같은 transaction에 모든 원장 행·버전·영수증 저장 순서다. 어느 실패든 ROLLBACK.
- 같은 요청의 영수증은 Pool·actor·input hash가 일치해야 재사용한다. 새 requestId로 결과 불명 재발행하지 않는다.
- 회원 합계는 전체 원장을 먼저 계산하므로 가족 간 배분이 소실되지 않는다. 회원 조회에 센터 공통 지출을 합산하지 않으며 목록/서버 표 합계/CSV가 같은 검색 조건을 사용한다.
- `merchant_application`은 support JSON 자료의 센터 수기 기록일 뿐이다. 준비/신청/계약/심사/활성화를 구분하지만 어떤 값도 PG 승인·결제 권한·정산을 활성화하지 않는다. 준비 이후 수기 확인에는 참조번호/확인일이 필요하다. 신분증·통장 보관 구조/업로드 없음.

### 적용·복구 절차
- 적용 직전 현행 운영 SHA/연결 원격과 승인 TARGET을 재확인하고, 기존 보호 백업·이전 서버 소스를 보존한다. 새로운 금융 행이 있다면 현 시점 백업을 확보한다. 기존 검사 결과를 이유 없이 전면 재실행하지 않는다.
- 승인 TARGET만 배포하고 Render LIVE와 실제 health SHA를 대조한다. 새 capability 및 비인증/타센터/강사 거부와 읽기 보고서만 우선 확인한다. 실제 대량 청구·환불·발송·유료 호출을 자동 실행하는 승인이 아니다.
- 홈페이지 페이지는 기존 정적 사이트 연결/배포 방식을 확인한 뒤 승인 경로로만 반영한다. 불가능하면 해당 웹 반영만 보류하고 API/PC와 구분한다.
- 장애 시 새 진입을 중단하고 앞선 정상 운영 소스 `65970347d33889c90e896ed2b236da45ac1ae290`로 서비스 소스만 복구한다. schema rollback·테이블 삭제·새 원장 행 삭제·영수증 삭제는 하지 않는다. 새 행은 기존 invoice 형식이므로 보존하며, 추가 가맹점 JSON도 그대로 남긴다.
- 이미 저장된 청구/이전 자료는 일괄 삭제·자동 역거래하지 않는다. 원거래·후속 배분/환불/출결을 확인하고 기존 정정 경로를 사용한다. UNKNOWN은 처리 영수증·원본 결과를 먼저 확인한다.

### 이번 증거와 남은 확인
- 서버 관련 86건(신규 23건 포함), 최종 PC 연결/복구/설치 규칙 46건, Desktop main+renderer 및 신규 순수 모듈 타입 검사 PASS. 변경 route bundle 성공. 새 개발 batch 비인증 요청 401.
- 휴대폰 폭의 공개 안내 렌더/브라우저 로그 정상. 홈페이지 전체 타입 검사에는 이번 변경 외 기존 17개 오류가 있어 전체 PASS가 아니다.
- 실제 운영 쓰기/SQL 경쟁·인증 후 화면·Windows·인쇄/PDF·서명·NFC reader는 미검증. 운영 적용·실발송·실거래·실환불·모델 호출은 이번 개발에서 실행하지 않았다.
- 개발 API 재시작에서 기존 runtime DDL의 `superAdminDb is not defined` 로그가 있었으므로 개발 로그 전체 무오류를 주장하지 않는다. 새 OFFICE route bundle/순수 검사는 통과했으며, 이 로그의 범위 밖 수정이나 운영 적용을 진행하지 않았다.
- 최종 통합 사용자 검수는 `app-migration-status.md`의 기존 1~10과 추가 11~16을 한 번에 사용한다. 필수 외부 자료는 Smartro 제휴·공식 제출 경로와 배차 설계 원문이다.

## 최신 잔여 기능 소스 승인 묶음 — 아직 적용하지 않음

- **후보 SHA:** 이번 최종 채팅 보고의 확정 commit SHA만 후보이며 앞 절의 과거 후보/이전 installer SHA를 새 승인으로 간주하지 않는다. 원격 GitLab 인증 미해결 상태에서는 동일 실패 push 반복·다른 원격 우회·강제 push·main 반영하지 않는다. 로컬 commit과 증분 복구 bundle을 보존한다.
- **서버 delta:** 기존 workspace interpret에 공지/현재 요청 답장 텍스트 초안을 호환 추가한다. 현재 관리자·센터·X 자격/OFF gate를 유지하고 SELECT로 원문/최근 대화만 읽는다. 원문 변경 시 폐기하고 상태·대상·푸시·내부 메모·실행 도구를 모델 출력으로 허용하지 않는다. 무료 이전 열 해석과 운영 초안의 공통 모델 실행기에 고정 작은 모델, 전체 입력 상한, 출력 1,200 tokens, SDK 재시도 0회를 적용한다. 복합 문서는 별도 OFF gate이며 작은 모델로 자동 대체하지 않는다.
- **기존 계약/데이터:** APP 요청 필드·기존 SUPPORT 모델 설정·구독/가격/용량 정책은 변경하지 않는다. OFFICE용 모델 설정만 추가한다. 새 migration 없음, 적용된 schema 2 재적용 없음, 데이터 변환/정리·실발송·실거래·실환불 없음. 이번 개발에서 운영 적용·모델 호출·API 수동 재시작은 하지 않는다.
- **PC delta:** 공지/답장 동일 양식 연결·세션별 입력/늦은 응답 보호, 수납→배분 후속 보존·영수증 복구, 기존 리포트 ID/버전의 읽기 전용 인쇄/PDF 저장창이다. 현재 소스는 기존 전달 설치본과 다르며 새 설치본을 제작했다고 표시하지 않는다. 최종 통합 검수 17~20에 합친다.
- **적용 전:** GitLab 정상 인증/원격 반영을 먼저 확인하고 승인 SHA와 현재 Render 연결/직전 LIVE SHA를 보존한다. 승인은 이 최종 SHA의 소스 반영만 대상으로 하며 모델 스위치 ON·유료 4회 시험은 별도다.
- **복구:** 배포 직전 보존한 실제 직전 LIVE SHA로 서버 소스만 복구한다. OFFICE 신규 진입/모델 실행은 중지 상태를 유지하고 원장·처리 영수증·공지·대화·schema를 삭제/역변환하지 않는다. 이미 처리된 요청은 영수증·현재 원문을 확인하며 자동 재전송하지 않는다.
- **검사 경계:** 변경 범위 PC main/renderer 타입, mocked UI/SELECT·모델 정책/권한 계약, route bundle만 확인한다. 임시 ad-hoc 서버 tsc는 기존 ai.ts의 trace enum/미정의 completion 및 NodeNext 확장자 오류로 전체 PASS가 아니며 이번 범위 밖 공통 AI 코드를 수정하지 않는다. Windows 실제 인쇄·서명·reader·인증된 PC 실동작·실제 모델 출력은 아직 확인하지 않았다.
- **모델 시험 승인:** 정확한 4개 비식별 사례·모델·입출력 토큰 상한·공식 단가·합산 최대 $0.0149568 USD는 `app-migration-status.md` 최신 절의 요청을 따른다. 현재 승인 없음/실행 0회다. 글로벌 모델 스위치 활성화·운영 저장·알림 발송 승인을 포함하지 않는다.
