# Media Engine Backup & Rollback 절차 (RC-4)

---

## 1. 정기 백업 절차

### DB 스냅샷 (Render.com 기준)
```
Render Dashboard → Database → Backups
- 자동 백업: 일 1회 (Render 관리형)
- 수동 백업: 중요 작업 전 Render에서 Manual Backup 생성
```

### 운영 전 스냅샷 (필수)
```bash
# Cleanup 실행 전 반드시 실행
npx tsx src/scripts/media-diagnose.ts --json > snapshots/pre-cleanup-$(date +%Y%m%d).json

# 영향받을 데이터 확인
npx tsx -e "
import { db } from '@workspace/db';
import { runDataCleanupPreview } from '../services/mediaService.js';
const preview = await runDataCleanupPreview('<poolId>');
console.log(JSON.stringify(preview, null, 2));
"
```

---

## 2. Rollback SQL

### 2-1. Phase D Student Note Cleanup 롤백
```sql
-- Phase D에서 수정된 3건을 이전 상태로 복원
BEGIN;
UPDATE class_diary_student_notes SET diary_id='cd_1784604187069_fq2nfsmpd', updated_at=NOW() WHERE id='csn_1784604188150_ziibhuy1s';
UPDATE class_diary_student_notes SET diary_id='cd_1784735365234_guf0yftso', updated_at=NOW() WHERE id='csn_1784735366265_ytleptpit';
UPDATE class_diary_student_notes SET diary_id='cd_1784739045597_4vojyacmw', updated_at=NOW() WHERE id='csn_1784739046599_e7tzacv5o';
COMMIT;
-- 주의: 롤백 시 이 note들은 다시 삭제된 diary를 참조하는 비정상 상태
```

### 2-2. 일지 소프트삭제 롤백
```sql
BEGIN;
-- 일지 복원
UPDATE class_diaries SET is_deleted=false, deleted_at=NULL, deleted_by=NULL, updated_at=NOW()
WHERE id='<diary_id>';

-- 연결 사진 복원 (detached → attached)
UPDATE photo_assets_meta
SET media_status='attached', journal_id='<diary_id>', updated_at=NOW()
WHERE media_status='detached'
  AND pool_id='<pool_id>'
  AND created_at BETWEEN '<upload_start>' AND '<diary_deleted_at>';
COMMIT;

-- 주의: 정확한 사진 범위 확인 후 실행
-- audit log 참고: SELECT * FROM class_diary_audit_logs WHERE diary_id='<diary_id>' ORDER BY created_at DESC;
```

### 2-3. 사진 연결 롤백 (attach → draft)
```typescript
// MediaService 경유
import { detachPhotosFromDiary } from "../services/mediaService.js";
const actor = { userId: "admin", userName: "관리자", role: "super_admin", poolId };
await detachPhotosFromDiary(["photo_1234", "photo_5678"], poolId, actor, diaryId);
```

### 2-4. media_status 수동 복원
```sql
-- 특정 사진 상태 복원 (최후 수단)
BEGIN;
UPDATE photo_assets_meta
SET media_status='draft', journal_id=NULL, student_note_id=NULL, updated_at=NOW()
WHERE id IN ('photo_1234', 'photo_5678')
  AND pool_id='<pool_id>';
COMMIT;
```

---

## 3. 비상복구 절차

### Step 1: 상태 파악
```bash
npx tsx src/scripts/media-diagnose.ts
```

### Step 2: 영향 범위 확인
```sql
-- 문제 사진 목록
SELECT id, media_status, journal_id, student_note_id, created_at
FROM photo_assets_meta
WHERE pool_id='<poolId>'
ORDER BY created_at DESC LIMIT 20;

-- 최근 Audit Log
SELECT action_type, target_type, after_content, actor_name, created_at
FROM class_diary_audit_logs
WHERE swimming_pool_id='<poolId>'
ORDER BY created_at DESC LIMIT 20;
```

### Step 3: 복구 실행
- 상황별 Rollback SQL (Section 2) 적용
- 실행 전 트랜잭션으로 감싸서 ROLLBACK 가능하게

### Step 4: 검증
```bash
npx tsx src/scripts/media-health-check.ts
# ERROR 0건 확인
```

---

## 4. 알려진 비정상 데이터 목록 (Phase B 수정불가)

| photo ID | 이슈 | 영향 |
|----------|------|------|
| photo_1784110503934 | journal_id ≠ note.diary_id | 실서비스 노출 없음 |
| photo_1784716754345 | journal_id ≠ note.diary_id | 실서비스 노출 없음 |

**처리 방침**: 수정 불가. API 쿼리 수준에서 이중 노출 차단 확인됨. 모니터링 유지.
