---
name: AlbumPicker 사진 중복사용 허용 (WP-DIARY-3A)
description: AlbumPickerModal에서 isAttached 차단 제거; 서버 clone 메커니즘이 이미 N:M 지원
---

## 규칙

AlbumPickerModal에서 `media_status === "attached"` 조건으로 선택을 막던 코드가 제거됨.
다른 일지에 이미 사용된 사진도 새 일지에서 재선택 가능.

**Why:** 서버 `attachPhotosToDiary`의 Case C가 이미 clone row를 생성해 N:M을 지원.
UI만 막고 있었음 → isAttached 조건, "사용 중" badge, attached 스타일 전부 제거.

## 서버 clone 동작 요약

```
Case A: photo.media_status = 'draft' → UPDATE journal_id, media_status = 'attached'
Case B: 이미 동일 diary에 attached → 멱등 성공
Case C: 다른 diary/note에 attached → INSERT clone row (source_photo_id + journal_id)
         ON CONFLICT (source_photo_id, journal_id) DO NOTHING
```

D1 삭제 시 D2 clone 영향 없음 (각자 독립 row).

## 제거된 코드 (AlbumPickerModal.tsx)

```js
// 제거됨
const isAttached = item.media_status === "attached";
if (!isAttached) togglePhoto(item.id);
isAttached && s.itemAttached  // style
isAttached && s.imageAttached  // style
{isAttached && <View style={s.attachedOverlay}><Text>사용 중</Text></View>}
{isSel && !isAttached && <checkOverlay>}  // → {isSel && <checkOverlay>}
```

StyleSheet에서도 `itemAttached`, `imageAttached`, `attachedOverlay`, `attachedText` 제거.

## 배포 정보

- commit: e6dbae54 (branch: deploy-photo-clone)
- Production OTA group: 00592405-a53f-4307-984d-20038cb0335c / iOS: 019fdf2d-031c-7994-aa56-6bd9daf3571c
- Preview OTA group: 1a0ed05d-467c-4c33-b542-5ab1624e2fb1 / iOS: 019fdf2d-3e5b-78f0-9125-aeeba442bc71
- Runtime version: 1.6.1
