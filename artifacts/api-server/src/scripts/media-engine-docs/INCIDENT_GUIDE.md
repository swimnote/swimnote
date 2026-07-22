# Media Engine — 장애 대응 가이드 (RC-5)

> **기준**: Media Engine RC 기준  
> **갱신**: 2026-07-23

---

## 공통 확인 사항

**가장 먼저 실행**
```bash
npx tsx src/scripts/media-diagnose.ts
```
출력된 ERROR/WARNING 항목부터 확인할 것.

**로그 위치**
- API 서버 콘솔: Replit Workflow 로그
- Audit Log: `class_diary_audit_logs` 테이블
- 업로드 실패: 클라이언트 콘솔 (`[UploadQueue] uploadOnce 실패`)

---

## 1. 사진이 안 보임

**원인 후보**

| 가능성 | 확인 방법 |
|--------|----------|
| media_status가 'attached'가 아님 | `SELECT media_status FROM photo_assets_meta WHERE id='<photo_id>'` |
| is_deleted=true인 diary에 연결됨 | `SELECT is_deleted FROM class_diaries WHERE id='<journal_id>'` |
| parent 조회 시 자녀 매핑 누락 | `SELECT * FROM parent_student_links WHERE parent_id='<userId>'` |
| presigned URL 만료 | 앱에서 사진 재조회 시 자동 갱신됨 |

**확인 순서**
1. `media-diagnose.ts` 실행 → HC-02(attached→삭제diary), HC-04(journal 불일치) 확인
2. `SELECT * FROM photo_assets_meta WHERE id='<photo_id>'` — media_status, journal_id 확인
3. Teacher: `GET /diaries/<id>/photos` API 직접 호출 → 빈 배열이면 media_status 문제
4. Parent: `GET /parent/swim-diary/<id>/photos` 호출 — myStudentIds 필터 확인

**복구 방법**
- media_status 이상: `MediaService.detachPhotosFromDiary` 후 재연결
- journal_id 이상: audit log에서 마지막 attach 확인 후 수동 복원

---

## 2. 사진 중복 표시

**원인 후보**

| 가능성 | 확인 방법 |
|--------|----------|
| object_key 중복 업로드 | `SELECT object_key, COUNT(*) FROM photo_assets_meta GROUP BY object_key HAVING COUNT(*)>1` |
| 같은 사진이 common + individual 모두 연결 | `getDiaryPhotos` 결과에서 common/individual 교집합 확인 |

**확인 순서**
1. `media-diagnose.ts` → HC-10(object_key 중복) 확인
2. 중복 업로드 차단은 서버에 없음 — R2 object_key 기준 덮어쓰기가 자동 dedup

**복구 방법**
- 중복 레코드 중 한 쪽을 `archiveMedia`로 보관 처리

---

## 3. 학부모 사진 누락

**원인 후보**

| 가능성 | 확인 방법 |
|--------|----------|
| media_status가 'attached'가 아님 | 사진 media_status 직접 확인 |
| parent_student_links 누락 | `SELECT * FROM parent_student_links WHERE parent_id='<userId>'` |
| 자녀 반 배정 누락 | `SELECT * FROM pool_students WHERE student_id='<studentId>'` |
| API 필터 오류 | parent.ts의 unread COUNT, 최근사진 UNION 쿼리 확인 |

**확인 순서**
1. 학부모 앱에서 `GET /parent/home` 응답 확인
2. 해당 학생의 사진: `SELECT * FROM photo_assets_meta WHERE student_id='<studentId>' AND media_status='attached'`
3. parent_student_links 유효 여부 확인

**복구 방법**
- parent_student_links 누락이면 DB에 링크 추가 (admin API 경유)
- media_status 이상이면 Section 1 참고

---

## 4. Teacher 사진 누락

**확인 순서**
1. `GET /diaries/<id>/photos` API 직접 호출
2. `SELECT * FROM photo_assets_meta WHERE journal_id='<diaryId>' AND media_status='attached'`
3. is_deleted 확인: `SELECT is_deleted FROM class_diaries WHERE id='<diaryId>'`

**복구 방법**
- diary가 삭제됨: 일지 복원 (is_deleted=false, 사진 re-attach) 또는 재작성
- 사진이 detached: audit log에서 삭제 시점 확인 후 재연결

---

## 5. Upload 실패

**원인 후보**

| 가능성 | 확인 방법 |
|--------|----------|
| 네트워크 오류 | 클라이언트 `[UploadQueue] uploadOnce 실패` 로그 |
| 파일 크기 초과 | multer 설정 100MB 제한 |
| R2 Storage 오류 | API 서버 콘솔의 R2 관련 에러 |
| 인증 토큰 만료 | 401 응답 |

**확인 순서**
1. 클라이언트 콘솔에서 `[UploadQueue]` 로그 확인
2. API 서버 콘솔에서 `POST /photos/` 요청의 HTTP 상태코드 확인
3. R2 Storage 잔여 용량 확인

**복구 방법**
- 자동 Retry: UploadQueueContext가 2회 재시도 (2초 대기)
- 수동 Retry: 앱에서 사진 재선택 후 재업로드
- 토큰 만료: 앱 재시작

---

## 6. Attach 실패

**원인 후보**

| 가능성 | 확인 방법 |
|--------|----------|
| 사진이 이미 다른 일지에 attached | `SELECT media_status, journal_id FROM photo_assets_meta WHERE id='<photo_id>'` |
| 다른 pool의 사진 | pool_id 불일치 확인 |
| 삭제된 일지에 attach 시도 | is_deleted 확인 |

**확인 순서**
1. 에러 메시지 확인: "이미 다른 일지에 연결된 사진" / "접근 권한 없음"
2. 해당 사진의 current media_status 확인
3. audit log: `SELECT * FROM class_diary_audit_logs WHERE after_content LIKE '%<photo_id>%' ORDER BY created_at DESC LIMIT 5`

**복구 방법**
- 기존 연결 해제 후 재연결: `MediaService.detachPhotosFromDiary` 먼저 호출
- 권한 오류: pool_id 일치 여부 확인

---

## 7. Detach 실패

**확인 순서**
1. API 응답 에러 메시지 확인
2. `SELECT pool_id, media_status FROM photo_assets_meta WHERE id='<photo_id>'`
3. poolId가 actor의 pool과 일치하는지 확인

---

## 8. Rollback 발생

**확인 순서**
1. API 서버 콘솔: `ROLLBACK` 로그 확인
2. audit log에 create 기록 없는지 확인
3. 사진 상태: photo의 media_status가 'draft'로 유지되어 있으면 정상 롤백

**복구 방법**
- 트랜잭션 롤백은 자동 복구 (사진 draft 상태 유지)
- 사용자에게 재시도 안내

---

## 9. 권한 오류 (403)

**원인 후보**

| 에러 | 원인 |
|------|------|
| "일부 사진에 대한 접근 권한이 없습니다" | 다른 pool의 사진 접근 |
| "본인 반의 일지만 작성할 수 있습니다" | teacher가 타 반 일지 작성 시도 |
| "이미 다른 일지에 연결된 사진" | attached 사진 재연결 시도 |

**확인 순서**
1. 요청한 photo_ids의 pool_id가 현재 사용자의 pool과 일치하는지 확인
2. JWT token의 poolId 확인: `SELECT pool_id FROM photo_assets_meta WHERE id='<photo_id>'`

---

## 10. Storage 오류 (R2)

**확인 순서**
1. API 서버 콘솔에서 R2 관련 에러 확인
2. 환경변수 확인: `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`
3. R2 버킷 잔여 용량 확인

**복구 방법**
- 임시: 업로드 제한 안내
- 영구: R2 용량 확장 또는 오래된 사진 archived 처리

---

## 11. Health Check WARNING

**HC-04 (journal 불일치 2건)**: Phase B 수정불가 목록. 실서비스 영향 없음. 모니터링 유지.

**HC-09 (stale note 10건)**: 테스트 중 삭제된 일지 잔재. API에서 is_deleted=false JOIN으로 노출 차단. 조치 불필요.

**HC-08 등장 시 (자동복구 가능 stale note)**:
```bash
# 확인
npx tsx src/scripts/media-diagnose.ts

# 복구 스크립트 실행 (media-integrity-dryrun.ts의 Student Note Cleanup 로직 참고)
```

**WARNING이 ERROR로 증가 시**: 즉시 Section 1~11 절차 수행
