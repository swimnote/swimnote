---
name: 교사 일지 히스토리 사진 조회 경로
description: DiaryPhotoStrip이 teacher 모드에서 /photos/diary/:id가 아닌 /photos/group을 호출함; WP-DIARY-3B 조사로 확정
---

## 규칙

교사 일지 히스토리 카드(DiaryHistoryList)에서 사진이 표시되지 않을 때의 실제 조회 경로:

```
DiaryHistoryList
  → DiaryPhotoStrip (teacher 모드)
    → GET /photos/group/:classGroupId?date=:lessonDate
```

`/photos/diary/:id`는 이 화면의 직접 조회 경로가 **아님**.
(편집 화면 `openEditDiary`에서만 `/photos/diary/:id` 사용)

**Why:** DiaryPhotoStrip은 teacher/parent 모드를 구분한다.
- teacher 모드: `/photos/group/:classGroupId?date=:lessonDate` (라인 86)
- parent 모드: `/parent/diary/:diaryId/photos` (라인 68)

## 향후 "등록된 사진이 없습니다" 재발 시 추적 순서

1. 실제 diary_id 확보
2. `diary.class_group_id` + `lesson_date` 확보
3. Production DB READ:
   ```sql
   SELECT id, journal_id, pool_id, media_status, class_id, is_clone
   FROM photo_assets_meta
   WHERE journal_id = '<diary_id>';
   ```
4. DB 정상이면 API 직접 호출:
   ```
   GET /api/photos/group/<class_group_id>?date=<lesson_date>
   ```
5. API에 사진 있으면 → 앱 state/React Query 캐시 조사
6. API에 사진 없으면 → `/photos/group` attached 쿼리 조건 조사

## WP-DIARY-3B 조사 결과 (2026-08-08)

Production DB 전수 조회(최근 7일 15건):
- `photo_count = attached_count` 전건 일치 (attach 실패 0건)
- pool_id mismatch: 0건
- media_status != 'attached' with journal_id: 0건

→ 현재 Production 데이터 정상. 재현 불가로 수정 없이 종료.

## AlbumPicker 사진 특성 (확인된 사실)

`album_type='group'`으로 attach된 사진의 `photo_lesson_date = NULL`.
attached 쿼리는 `pam.lesson_date`가 아닌 `cd.lesson_date`를 체크하므로 null 여부 무관.
