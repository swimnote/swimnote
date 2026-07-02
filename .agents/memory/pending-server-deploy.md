---
name: 프로덕션 API 서버 배포 대기 항목
description: 개발(Replit)에만 반영되고 Render.com 프로덕션에 아직 미배포된 서버 변경사항
---

## 미배포 항목 (2026-07-02 기준)

1. **사진 multer 한도 10→100**
   - `photos.ts`: `upload.array("photos", 10)` → `upload.array("photos", 100)` (2곳)
   - 구 앱에서 11장 이상 업로드 시 LIMIT_UNEXPECTED_FILE → 500 에러 원인

2. **`/photos/batch` 엔드포인트 신규 추가**
   - 사진 1장 + student_ids JSON 배열 수신 → R2 1회 업로드 → 각 학생별 DB 레코드 생성
   - 어드민 photo-upload.tsx 백그라운드 큐에서 사용

3. **multer 전용 에러 미들웨어 (`app.ts`)**
   - LIMIT_FILE_SIZE → 413
   - LIMIT_UNEXPECTED_FILE → 400 "한 번에 최대 100장"
   - 기존 전역 핸들러가 500 "Internal Server Error" 뱉던 문제 해결

## 배포 방법
Render.com 대시보드 → API 서버 → Manual Deploy (또는 자동 배포 트리거)

**Why:** 앱은 `EXPO_PUBLIC_API_URL = https://swimnote-api.onrender.com/api` 로 하드코딩되어 있어 항상 Render.com 서버를 직접 호출함. 개발 서버 변경이 자동 반영되지 않음.
