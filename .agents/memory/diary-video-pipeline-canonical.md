---
name: Diary Video Pipeline Canonical State
description: WP16 전수조사 후 확정된 Diary Video pipeline 구조, 결함 목록, 수정 이력
---

## Canonical Video State Variables

| State | Type | Purpose | Source of Truth |
|---|---|---|---|
| `groupMedia` | `UploadedMedia[]` | WRITE 공통 업로드 중 progress 추적 | NO (preview only) |
| `studentMedia` | `Record<string, UploadedMedia[]>` | WRITE 학생 업로드 중 progress 추적 | NO (preview only) |
| `mediaUploading` | `string\|null` | 업로드 lock ("group"\|studentId\|null) | - |
| `selectedAlbumVideos` | `AlbumVideoInfo[]` | **WRITE 공통 video IDs** — save attach 소스 | YES |
| `studentAlbumVideos` | `Record<string,AlbumVideoInfo[]>` | **WRITE+EDIT 학생별 video IDs** — note-attach 소스 | YES |
| `editLinkedVideos` | `AlbumVideoInfo[]` | EDIT 기존 공통 영상 (journal_id 기반) | YES |
| `editRemovedVideoIds` | `string[]` | EDIT 제거할 공통 영상 ID 목록 | YES |
| `editNewAlbumVideos` | `AlbumVideoInfo[]` | EDIT 새로 추가한 공통 영상 | YES |

## Write Pipeline
- **Common**: `uploadGroupMedia("video")` → `POST /videos/group` → `video.id` → `selectedAlbumVideos`
- **Student**: `uploadStudentMedia(student, "video")` → `POST /videos/private` → `video.id` → `studentAlbumVideos[student.id]`
- **Save**: common → `POST /videos/diary-attach`; student → `POST /videos/note-attach` with note_id from POST /diaries response

## Edit Pipeline
- **Load**: `GET /videos/diary/:diaryId` → 공통(`!student_note_id`) → `editLinkedVideos`; 학생별(`student_note_id`) → `studentAlbumVideos[student_id]`
- **Common Add**: 앨범픽커 또는 "내 영상앨범" 버튼 → `uploadGroupMedia("video")` (subView==="edit"이면 `editNewAlbumVideos`로 라우팅)
- **Student Add**: "내 영상앨범" → `uploadStudentMedia(student, "video")` → `studentAlbumVideos[student.id]`
- **Save**: detach removed + attach new common; per-note student video note-attach

## Endpoint Contract
| Endpoint | Method | Purpose | Response |
|---|---|---|---|
| `/videos/group` | POST | 공통 영상 업로드 | `{ video: { id, file_url, ... } }` |
| `/videos/private` | POST | 학생별 영상 업로드 | `{ video: { id, file_url, ... } }` |
| `/videos/diary-attach` | POST | journal_id 연결 | `{ updated: N }` |
| `/videos/diary-detach` | POST | journal_id 해제 | `{ updated: N }` |
| `/videos/note-attach` | POST | student_note_id 연결 | `{ updated: N }` |
| `/videos/diary/:diaryId` | GET | diary 영상 전체 (공통+학생) | `{ videos: [...], total }` |

## P0 Fix Applied: student_note_id read path (2026-09-06)
- `GET /videos/diary/:diaryId` — OR 조건 추가: `student_note_id IN (SELECT id FROM class_diary_student_notes WHERE diary_id = ...)`
- 응답에 `student_note_id` 필드 포함
- 클라이언트 `openEditDiary`: `student_note_id` 있는 영상은 `editLinkedVideos` 대신 `studentAlbumVideos[student_id]`에 귀속
- **Why:** 학생별 note video는 journal_id 없이 student_note_id만 가짐 → 기존 쿼리로 조회 불가 → edit 재진입 시 완전 소실

## P1 Fix Applied: edit common "내 영상앨범" 버튼 (2026-09-06)
- DiaryEditView common section에 "내 영상앨범" button 추가 (`onUploadGroupMedia` prop)
- `uploadGroupMedia` — `subView === "edit"`이면 `editNewAlbumVideos`로 라우팅, 아니면 `selectedAlbumVideos`

## Local Storage (5GB) Fix Applied (2026-09-06)
- `deleteTempFileAfterUpload`: ph://,assets-library:// 제외한 file:// URI 전부 삭제 (iOS symlink 불일치 우회)
- `MEDIA_CLEANUP_REVISION`: r1 → r2 (기기 재시작 시 V3 cleanup 재실행)
