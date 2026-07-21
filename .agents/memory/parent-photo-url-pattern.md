---
name: 학부모 앨범 사진 URL 패턴
description: 학부모 앱에서 사진 URL을 구성하는 방식이 화면별로 다름; parent.ts에서 각 소비처에 맞는 형식 반환 필요
---

# 학부모 사진 URL 패턴

## API_BASE 값
`API_BASE = "https://swimnote.kr/api"` (AuthContext.tsx)

## 화면별 URL 구성 방식

### home.tsx (홈 요약) + swim-diary.tsx (일지 상세)
```javascript
source={{ uri: `${API_BASE}${p.file_url}` }}
// 예: "https://swimnote.kr/api" + "/photos/xxx/file" = "https://swimnote.kr/api/photos/xxx/file" ✅
```
→ **parent.ts에서 반환할 file_url 형식: `/photos/{id}/file` (앞에 /api 없음)**

### photos.tsx (앨범 화면)
```javascript
return `${API_BASE.replace(/\/api$/, "")}${fileUrl}`;
// 예: "https://swimnote.kr" + "/api/photos/xxx/file" = "https://swimnote.kr/api/photos/xxx/file" ✅
```
→ **photos.ts `/photos/parent-view`에서 반환할 file_url 형식: `/api/photos/{id}/file` (/api 포함)**

## parent.ts에서 수정된 라우트

- `GET /students/:id/home-summary` → `'/photos/' || id || '/file'` (home.tsx용)
- `GET /parent/diary/:diaryId/photos` → `'/photos/' || id || '/file'` (swim-diary.tsx용)

## 왜 불일치?
photos.tsx는 `API_BASE.replace(/\/api$/, "")` 패턴을 사용하고,
home.tsx/swim-diary.tsx는 `API_BASE + file_url` 패턴을 사용함.
나중에 추가된 코드가 일관성 없이 작성된 것.

**How to apply:** parent.ts에서 새 사진 URL 반환 라우트를 추가할 때,
어느 화면에서 소비하는지 확인하고 그 화면의 URL 구성 패턴에 맞는 형식 선택.
