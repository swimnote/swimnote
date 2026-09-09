---
name: P0/P1 X Gate Fix + P0 File Durability
description: P0/P1 release blocker fix + P0 file durability — X mode client guards + server X entitlement guards + atomic file upload
---

## SHA: 482a65f7 (X Gate Fix)
- (parent)/growth-report-paid.tsx: useMode + isXMode guard
- (admin)/x-hub.tsx: useMode guard
- (admin)/x-setup.tsx: useMode + isXMode guard (x_pending allowed)
- parent-paid-insight.ts: hasXEntitlement() on 4 routes
- x-setup.ts: hasXEntitlement() on 6 pool_admin routes
- iOS OTA: 01a08504

## SHA: b71a9a7a (P0 File Durability)
- x-setup.ts: DB transaction atomic (advisory lock + is_current + INSERT + submission)
- x-setup.ts: R2 compensating cleanup on DB failure
- x-setup.ts: raw_original_filename column added
- x-setup.ts: audit_logs for all upload/reupload/submit/approve/revision/activate/photo-delete
- admin.ts: pool_approve/pool_reject audit_logs with before/after
- migration: p0-file-durability.ts (raw_original_filename col + UNIQUE partial index)
- Tests: 14TC CASE A~G all passed
- Render LIVE: b71a9a7a
- OTA: 없음 (앱 화면 변경 없음)

## Key Patterns
- uploadVersionedFile(): advisory lock (pg_advisory_xact_lock(hashtext(poolId+fileType))) in transaction → version race 불가
- Compensating cleanup: deleteFromR2() on DB failure → orphan 방지; cleanup 실패도 audit_logs에 r2_orphan_cleanup_failed 기록
- UNIQUE partial index: (pool_id, file_type, submission_version) WHERE file_type != 'photo'
- photo: version=1 고정 유지 (multi-file), transaction 내 INSERT + submission update atomic
- raw_original_filename: file.originalname 그대로, original_filename은 sanitized
