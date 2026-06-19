---
name: 영상 다운로드 302 리다이렉트 패턴
description: expo-file-system downloadAsync는 302 리다이렉트를 따라가지 못함 — fetch로 먼저 resolve 필요
---

## 규칙
`/api/videos/:id/file` 엔드포인트는 R2 presigned URL로 302 리다이렉트를 반환한다.
`expo-file-system`의 `FileSystem.downloadAsync`는 302를 따라가지 않아 다운로드가 실패한다.

## 해결 패턴
```ts
// 1. fetch로 리다이렉트 따라가기
const resolved = await fetch(serverUrl, {
  headers: { Authorization: `Bearer ${token}` },
  redirect: "follow",
});
const finalUrl = resolved.url; // 실제 R2 URL

// 2. R2 URL로 직접 다운로드 (auth 헤더 불필요)
const dl = await FileSystem.downloadAsync(finalUrl, localPath);
```

**Why:** R2 presigned URL은 이미 서명이 포함되어 있어 Authorization 헤더 없이 직접 접근 가능.
`fetch`는 기본적으로 리다이렉트를 따라가며 `response.url`에 최종 URL을 반환한다.

**How to apply:** 영상 다운로드가 필요한 모든 컴포넌트(DiaryPhotoStrip, parent/photos.tsx 등)에 동일하게 적용.
