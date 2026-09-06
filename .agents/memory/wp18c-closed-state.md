---
name: WP18-C Production Backup CLOSED
description: Production→Backup DB 자동 일일 스냅샷 완료 상태 및 운영 정책
---

# WP18-C — CLOSED (2026-09-07)

## 완료 상태

- STATUS: CLOSED
- AUTOMATIC_BACKUP: ACTIVE
- CRON_RUNTIME: PASS (Render Cron Job `swimnote-production-backup` 실제 실행 성공 확인)
- LATEST_VERIFIED_SNAPSHOT: snap_b249344dcc3e
- 97 BACKUP_REQUIRED tables 전체 VERIFIED
- FK checks PASS
- BACKUP_METHOD: NODE_LOGICAL+ATOMIC_TX
- Production mutation: NONE

## 운영 구성

- 백업 실행 경로: Render Cron Job `swimnote-production-backup` 단독
- 스케줄: `0 19 * * *` UTC = 매일 04:00 KST
- Command: `npx pnpm@10 --filter @workspace/api-server run backup:production`
- Branch: `release/v2.0.0` (GitHub `swimnote/swimnote`)
- Env: `SUPABASE_DATABASE_URL` (prod, READ ONLY) + `SUPABASE_BACKUP_DATABASE_URL` (write target)

## swimnote-worker 정책

- `swimnote-worker` (srv-d9uc5hnlk1mc73efmnu0): 비활성/미사용 상태 유지
- WORKER_MODE=true 14개 job 재기동 금지

## R2 Safety Guard (영구 적용)

- MEDIA_ORIGINAL_BACKUP: NO — 사진/영상 원본 R2에만 존재, 별도 백업 없음
- MEDIA_RECOVERY_GUARANTEE: NO — R2 object 유실 시 원본 복구 불가
- DB_MEDIA_METADATA_BACKUP: YES — photo/video metadata 및 object_key는 Backup DB에 포함
- Production R2 object/bucket deletion, bulk delete, lifecycle 변경, cleanup script 실행 금지
- 기존 사용자 앱 내 사진/영상 정상 삭제 기능은 변경하지 않음

**Why:** 실제 Cron Job 실행으로 자동화 검증 완료. swimnote-worker는 crashlooping/dead service.
