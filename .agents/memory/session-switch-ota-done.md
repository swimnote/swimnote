---
name: Session Switch OTA 배포 완료
description: diary session switcher + 3 defect fix + AI report btn 제거 OTA 배포 기록
---

## 배포 SHA
- app code: 970b25ab (attached_assets만 추가된 47f7bee7와 동일 앱코드)
- origin pushed: 47f7bee7

## iOS
- OLD_GROUP: 7b4e8733-775f-48ae-9b34-a094f7eb751b
- NEW_GROUP: 63f98081-3d4a-4a14-b7e1-c9ddf820a2de
- NEW_UPDATE_ID: 01a04ba3-4d6b-71d7-b3e2-f1d9664071dc
- runtimeVersion: 1.6.3
- branch: production / channel: production

## Android
- OLD_GROUP: (iOS only on branch, no previous Android entry)
- NEW_GROUP: 4aff8c80-5ee4-4c9b-8428-c35daa68a296
- NEW_UPDATE_ID: 01a04ba3-bb23-7acb-b020-b8608b1bdbbd
- runtimeVersion: 1.6.3
- branch: production / channel: production

## 포함된 변경
1. diary session switcher (header tappable → SessionSelectorSheet)
2. includeWritten=true API endpoint
3. loadClassStudents(classId, lessonDate?) — stale date fix
4. myDiaryExists: diaries.some() — race condition fix
5. replace target: slice(0,10) normalization
6. ClassDetailSheet: startTime param 추가
7. X 홈 AI 학생리포트 버튼 제거
