---
name: 사진 미디어 상태 고아 버그
description: 삭제된 일지에 연결된 사진이 media_status='attached'로 남아 "사용 중"으로 표시되는 패턴과 수정 방법
---

## 버그 패턴

일지(class_diaries) 삭제 후 photo_assets_meta의 journal_id/student_note_id가 NULL로 정리되지 않은 경우:
- `media_status = 'attached'` 유지
- `GET /photos/picker`에서 "사용 중"으로 반환 → 재사용 불가
- 전체앨범(`GET /photos/teacher-all`)에도 동일 문제

## 수정 방법

**피커/앨범 조회 시 CASE WHEN으로 실시간 보정 (photos.ts)**:
두 군데 적용: `GET /photos/picker` 및 `GET /photos/teacher-all` scope=group

**기존 고아 레코드 정리 엔드포인트**:
- `POST /diaries/repair-orphan-media` — pool_admin/super_admin 전용

**Why:** 이전 코드가 BEGIN/COMMIT 직접 SQL로 트랜잭션 처리 → 일부 상황에서 journal_id NULL 업데이트가 누락됨.
