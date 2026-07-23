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
```sql
LEFT JOIN class_diaries cd_j ON cd_j.id = sp.journal_id
LEFT JOIN class_diary_student_notes csn ON csn.id = sp.student_note_id
LEFT JOIN class_diaries cd_sn ON cd_sn.id = csn.diary_id

CASE
  WHEN sp.media_status = 'attached' AND (
    (sp.journal_id IS NOT NULL AND COALESCE(cd_j.is_deleted, false) = true)
    OR (sp.student_note_id IS NOT NULL AND COALESCE(cd_sn.is_deleted, false) = true)
  ) THEN 'draft'
  ELSE sp.media_status
END AS media_status
```

두 군데 적용:
- `GET /photos/picker` (라인 ~896) — teacher, pool_admin 양쪽
- `GET /photos/teacher-all` scope=group (라인 ~648)

**기존 고아 레코드 정리 엔드포인트**:
- `POST /diaries/repair-orphan-media` — pool_admin/super_admin 전용
- photo_assets_meta + video_assets_meta 양쪽 정리
- 운영 환경에서 반드시 1회 실행 필요

**Why:** 이전 코드가 BEGIN/COMMIT 직접 SQL로 트랜잭션 처리 → 일부 상황에서 journal_id NULL 업데이트가 누락됨. drizzle db.transaction()으로 교체 후에는 새로 발생하지 않음.

**How to apply:** 조회 시 항상 CASE WHEN으로 보정. 기존 데이터는 repair 엔드포인트 1회 실행으로 정리.
