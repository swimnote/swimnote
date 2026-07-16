---
name: 프로덕션 API 서버 배포 대기 항목
description: 개발(Replit)에만 반영되고 Render.com 프로덕션에 아직 미배포된 서버 변경사항
---

## 미배포 항목 (2026-07-16 기준)

- **attendance/makeup-students 확장** (2026-07-16): 배정(assigned)된 보충수업 학생도 일지 화면에서 표시되도록 makeup_sessions 테이블 조회 추가

## 최근 배포 완료 항목

- **미작성 일지 카운팅 수정** (2026-07-11): pending_diaries_today SQL에 오늘 요일 체크 추가
- **사진 multer 한도 10→100** (2026-07-02)
- **/photos/batch 엔드포인트** (2026-07-02)
- **multer 에러 미들웨어** (2026-07-02)

## 배포 방법
Render.com 대시보드 → API 서버 → Manual Deploy (또는 자동 배포 트리거)

**Why:** 앱은 `EXPO_PUBLIC_API_URL = https://swimnote-api.onrender.com/api` 로 하드코딩되어 있어 항상 Render.com 서버를 직접 호출함. 개발 서버 변경이 자동 반영되지 않음.
