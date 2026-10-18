# OFFICE 잔여 서버 변경 — 적용 전 검토안

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
