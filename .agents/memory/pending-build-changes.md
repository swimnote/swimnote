---
name: 다음 빌드 포함 변경 사항
description: 마지막 스토어 빌드 이후 코드에 반영됐으나 아직 배포 안 된 변경 목록
---

## 마지막 빌드 기준
- 앱 버전: 1.5.5 (iOS buildNumber 238 / Android versionCode 229)
- 이전 바이너리: iOS 빌드 236/237, Android versionCode 227/228 (1.5.1)

## OTA 배포 완료 (1.5.5 이후 코드 변경)

### ① 보강(makeups) 기능 (이전 세션 완료)
- makeup_sessions 테이블 기반 보강 수업 관리
- 선생님/관리자 보강 일지 작성 가능
- 학부모 일지 목록에 보강일지 is_makeup_diary 표시

### ② DiaryWriteView LucideIcon import 누락 수정 (2026-07-21 OTA)
- `components/teacher/diary/DiaryWriteView.tsx`: `LucideIcon` import 추가
- 증상: 교사 일지 저장 시 DiaryWriteView 렌더링 중 ReferenceError → ErrorFallback 표시
- iOS/Android production+preview 4채널 OTA 완료

### ③ 학부모 전화번호 관리 UI + 관리자 보호자 연결 상태 개선 (2026-07-22 OTA)
- teacher student-detail.tsx: "학부모 연락처" 섹션 신설 (보호자1/2 추가·수정·삭제 모달)
- API: `PATCH /students/:id/parent-phones` 엔드포인트 추가 (teacher+admin 접근 가능)
- API: `GET /admin/students/:id/detail` → parents 배열 추가 (전화번호별 연결 상태)
- MemberParentTab.tsx: 전화번호별 연결/가입대기 뱃지 + 연결된 학부모 계정 섹션 개선
- iOS/Android production+preview 4채널 OTA 완료

### ⑤ 수업일지 날짜 버그 수정 (2026-07-22 OTA)
- ClassDetailSheet.tsx: diary 이동 시 `lessonDate: effectiveDate` params 추가
- 과거 날짜 수업 선택 후 수업일지 클릭 시 해당 날짜로 diary 화면 열림
- iOS/Android production+preview 4채널 OTA 완료

### ④ 중복 학생 병합 + 학부모 연결 탭 + 서버측 중복 방지 (2026-07-22 OTA)
- 전하빈(dm210beoo→ch8u651hi), 박찬율(7g71n0l0s→e0qghg3tm) 병합 완료
- approvals.tsx: 학부모 연결 탭 분리 추가
- link-child.tsx: pending 상태 UI + 중복 클릭 방지
- students.ts POST /: phone1/2/3 교차 비교 중복 체크 강화
- students.ts teacher-request: 이름 중복 체크 신규 추가
- auth.ts simple-parent-register: 이름 중복 시 신규 학생 생성 금지
- iOS/Android production+preview 4채널 OTA 완료

## API 서버 변경 (재배포 후 적용)
- `parent.ts:732` — 학부모 일지 사진 URL: `/api/photos/` → `/photos/` (swim-diary.tsx 패턴 맞춤)
- `parent.ts:1236` — 홈 요약 사진 URL: 하드코딩 Render.com URL → `/photos/`
- `photos.ts:parent-view` — group 사진 쿼리: `sp.class_id` JOIN → `cd.class_group_id` JOIN (class_id=NULL 사진 포함)
- `photos.ts:diary-attach` — 앨범 사진 연결 시 `class_id` 자동 설정 (diary.class_group_id)
- DB backfill: 28개 기존 diary-linked 그룹 사진에 class_id 설정 완료
