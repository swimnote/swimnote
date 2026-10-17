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
