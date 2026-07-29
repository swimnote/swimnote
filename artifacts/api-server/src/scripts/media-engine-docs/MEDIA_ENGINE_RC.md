# Media Engine — Release Candidate (RC) 문서

> **Status: FROZEN**  
> Phase A → D → RC 완료. Media Engine 내부 구조 변경 금지.  
> 향후 기능 추가는 반드시 MediaService API만 사용할 것.

---

## 1. Architecture

```
클라이언트(App/Web)
    │
    ▼
API Server (Routes Layer)
    │  photos.ts      — 업로드 전용 (INSERT, media_status='draft')
    │  diary.ts       — 일지 CRUD + with-media 통합 저장
    │  parent.ts      — 학부모 조회 (READ-ONLY)
    │
    ▼
MediaService (services/mediaService.ts)   ← 단일 게이트
    │  attachPhotosToDiary()
    │  attachPhotosToStudentNote()
    │  detachPhotosFromDiary()
    │  handleDiaryDeleted()
    │  getDiaryPhotos()
    │  getDraftPhotosForClass()
    │  archiveMedia()
    │  runDataCleanupPreview()
    │
    ▼
DB: photo_assets_meta  ←  단일 Source of Truth
```

---

## 2. media_status 흐름

```
[업로드]
  → media_status = 'draft'

[일지/노트에 연결 (attach)]
  draft → attached
  journal_id 설정, student_note_id 설정(노트일 때)

[수동 분리 (detach)]
  attached → draft
  journal_id = NULL, student_note_id = NULL

[일지 삭제]
  attached → detached
  journal_id = NULL, student_note_id = NULL

[보관 처리]
  draft|detached → archived
```

**허용값**: `'draft' | 'attached' | 'detached' | 'archived'`

---

## 3. Upload Flow

```
1. 클라이언트: 사진 선택 (카메라/갤러리/앨범)
2. UploadQueueContext.tsx: CONCURRENCY=3, Retry=2
3. POST /photos/group|private|batch
   → photo_assets_meta INSERT (media_status='draft')
4. 업로드 완료 후 useDiaryMedia.tsx: serverPhotoId 수신
5. 일지 저장 시 with-media 엔드포인트로 photo_ids 전달
6. MediaService.attachPhotosToDiary/Note → media_status='attached'
```

---

## 4. Diary Flow (with-media)

```
POST /diaries/with-media
  BEGIN TRANSACTION
    1. class_diaries INSERT
    2. class_diary_student_notes INSERT (학생별)
    3. MediaService.attachPhotosToDiary (공통 사진)
    4. MediaService.attachPhotosToStudentNote (개인 사진)
  COMMIT
  
  5. logAudit (create — 트랜잭션 외부)
  6. logMediaAudit (attach — 비동기 fire-and-forget)
  7. Push 알림 발송
```

**실패 시**: 전체 롤백. 사진은 draft 상태 유지 (재시도 가능)

---

## 5. Parent Flow

```
GET /parent/home        → media_status='attached' + is_deleted=false 필터
GET /parent/swim-diary  → 자녀 일지 사진 (media_status='attached')
GET /parent/photos      → 앨범 사진 (media_status='attached')
GET /parent/unread      → COUNT (media_status='attached')
```

**부모 권한**: 본인 자녀 소속 pool 데이터만 접근

---

## 6. Cleanup 절차

### 자동복구 가능 (활성 대체 diary 존재)
```sql
-- 실행 전 반드시 dry-run 확인
UPDATE class_diary_student_notes
SET diary_id = '<new_diary_id>', updated_at = NOW()
WHERE id = '<note_id>';
```

### 수동 보관 처리 (30일+ 미사용 draft)
```typescript
import { archiveMedia } from "../services/mediaService.js";
const ids = ["photo_1234", "photo_5678"];
await archiveMedia(ids, poolId, actor);
```

---

## 7. Health Check / Auto-Diagnosis

```bash
# 기본 Health Check
npx tsx src/scripts/media-health-check.ts

# 통합 자동 진단 (RC-13)
npx tsx src/scripts/media-diagnose.ts

# JSON 출력 (모니터링 시스템 연동용)
npx tsx src/scripts/media-diagnose.ts --json
```

**종료코드**: 0=PASS, 1=WARNING, 2=ERROR

---

## 8. Rollback 절차

### Phase D Student Note Cleanup 롤백
```sql
BEGIN;
UPDATE class_diary_student_notes SET diary_id='cd_1784604187069_fq2nfsmpd' WHERE id='csn_1784604188150_ziibhuy1s';
UPDATE class_diary_student_notes SET diary_id='cd_1784735365234_guf0yftso' WHERE id='csn_1784735366265_ytleptpit';
UPDATE class_diary_student_notes SET diary_id='cd_1784739045597_4vojyacmw' WHERE id='csn_1784739046599_e7tzacv5o';
COMMIT;
```

### 일지 삭제 롤백 (is_deleted 복원)
```sql
BEGIN;
UPDATE class_diaries SET is_deleted=false, deleted_at=NULL, deleted_by=NULL WHERE id='<diary_id>';
UPDATE photo_assets_meta SET media_status='attached', journal_id='<diary_id>' WHERE media_status='detached' AND created_at > '<deleted_at>';
COMMIT;
```

### 사진 attach 롤백 (detach → draft)
```typescript
import { detachPhotosFromDiary } from "../services/mediaService.js";
await detachPhotosFromDiary(["photo_1234"], poolId, actor, diaryId);
```

---

## 9. Audit Log

**테이블**: `class_diary_audit_logs`

| action_type | target_type | 내용 |
|-------------|-------------|------|
| create | common / student_note | 일지/노트 생성 (본문 포함) |
| update | common / student_note | 일지/노트 수정 (before/after) |
| delete | common | 일지 삭제 |
| attach | media | 공통사진 연결 (photo_ids JSON) |
| note_attach | media | 학생사진 연결 (photo_ids JSON) |
| detach | media | 사진 분리 |
| detach_deleted | media | 일지 삭제로 인한 사진 해제 |
| archive | media | 사진 보관 처리 |
| cleanup | media | 정기 정합성 정리 |

---

## 10. Freeze 규칙 (RC-12)

1. `photo_assets_meta` 직접 접근 금지 — 반드시 `MediaService` 경유
2. `media_status` 허용값 변경 금지 (`draft|attached|detached|archived`)
3. `photo_assets_meta` 스키마 변경 금지
4. MediaService 함수 시그니처 변경 금지 (하위 호환성 유지)
5. 수정 가능한 경우: Critical Bug 또는 Security Issue만

새 기능(AI, 영상, 공지, 채팅, 앨범 기능 확장)은  
`MediaService` API를 호출하는 새 Service Layer에서 구현할 것.
