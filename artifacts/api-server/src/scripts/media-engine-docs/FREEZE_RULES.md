# Media Engine Freeze 선언 (RC-12)

> **Freeze 일자**: 2026-07-23  
> **버전**: Release Candidate (RC)

Media Engine Phase A → D → RC 완료.  
이 선언 이후 Media Engine 내부 구조는 **동결**됩니다.

---

## Freeze 규칙

### 1. photo_assets_meta 직접 접근 금지

```
❌ 금지
  db.execute(sql`UPDATE photo_assets_meta SET ...`)
  db.execute(sql`DELETE FROM photo_assets_meta ...`)
  db.execute(sql`SELECT * FROM photo_assets_meta ...` + 비즈니스 로직)

✅ 허용
  MediaService.attachPhotosToDiary()
  MediaService.getDiaryPhotos()
  MediaService.getDraftPhotosForClass()
  MediaService.detachPhotosFromDiary()
  MediaService.handleDiaryDeleted()
  MediaService.archiveMedia()

✅ 예외 허용 (읽기 전용 집계)
  Storage 사용량 계산 (SUM, COUNT)
  Dashboard 통계
```

### 2. Media Engine DB 구조 변경 금지

변경 금지 대상:
- `photo_assets_meta` 테이블 스키마
- `class_diary_audit_logs` 테이블 스키마
- `media_status` 허용값 (`draft|attached|detached|archived`)
- `MediaService` 함수 시그니처

### 3. 신규 기능은 Service Layer에서 구현

```
AI 분석     → AI Service → MediaService.getDiaryPhotos() 호출
영상 기능   → VideoService → photo_assets_meta 직접 접근 금지
공지        → NoticeService → MediaService API만 사용
채팅        → ChatService → MediaService API만 사용
앨범 기능   → AlbumService → MediaService API만 사용
```

### 4. 수정 허용 조건 (예외)

| 조건 | 수정 범위 |
|------|----------|
| Critical Bug | 최소 수정, 반드시 Phase C 테스트 재실행 |
| Security Issue | 보안 취약점 패치, 감사 로그 필수 |
| Performance | 쿼리 최적화만 (인터페이스 변경 금지) |

### 5. 변경 시 필수 검증

```bash
# 반드시 모두 PASS 후 배포
npx tsx src/scripts/phase-c-tests.ts   # 28/29 PASS 유지
npx tsx src/scripts/media-health-check.ts  # ERROR 0건
npx tsx src/scripts/media-diagnose.ts  # ERROR 0건
```

---

## 허용된 MediaService API 목록

```typescript
// 조회
getDiaryPhotos(diaryId, poolId, myStudentIds?)
getDraftPhotosForClass(classId, lessonDate, poolId, uploadedBy?)
runDataCleanupPreview(poolId)

// 쓰기 (반드시 actor 전달)
attachPhotosToDiary(diaryId, photoIds, poolId, actor?)
attachPhotosToStudentNote(diaryId, noteId, studentId, photoIds, poolId, actor?)
detachPhotosFromDiary(photoIds, poolId, actor?, diaryId?)
handleDiaryDeleted(diaryId, poolId, actor?)
archiveMedia(photoIds, poolId, actor?)
```

---

## 모니터링 주기

| 작업 | 주기 |
|------|------|
| `media-diagnose.ts` 실행 | 주 1회 이상 |
| Audit Log 검토 | 월 1회 |
| 30일+ draft/detached 정리 | 월 1회 |
| Health Check | 배포 전후 필수 |
