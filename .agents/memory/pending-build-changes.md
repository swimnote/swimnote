---
name: 다음 빌드 포함 변경 사항
description: 마지막 스토어 빌드 이후 코드에 반영됐으나 아직 배포 안 된 변경 목록
---

## 마지막 빌드 기준
- 앱 버전: 1.5.5 (iOS buildNumber 238 / Android versionCode 229)
- 이전 바이너리: iOS 빌드 236/237, Android versionCode 227/228 (1.5.1)

## 1.5.5 빌드에 포함된 수정 사항

### ① 선생님 모드 — 담당 반만 표시 (my-schedule.tsx)
- `myGroups` 필터: `groups.filter(g => g.teacher_user_id === adminUser?.id || co_teacher_ids.includes(...))`
- weekly/monthly/daily 모든 뷰에 `myGroups` 적용
- daily view 반이동 패널 `otherGroups`도 `myGroups.filter(...)` 로 수정
- 서버(class-groups.ts): tokenRole=teacher이면 `WHERE teacher_user_id = userId` 자동 필터

### ② 관리자 주간뷰 compactMode=false
- `(admin)/classes.tsx` 724번 줄: `compactMode={false}` 명시

### ③ 관리자 일지 전체보기 서버 404 수정
- 프로덕션 서버에 3개 엔드포인트 배포 완료 (Render.com)

### ④ OTA 코드 개선 (_layout.tsx)
- `useUpdates()` 제거, `checkForUpdateAsync → fetchUpdateAsync → reloadAsync` 단순화
- 앱 시작 + 포그라운드 복귀 시 체크
