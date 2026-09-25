/**
 * data-purge-worker.ts — DATA add-on EXPIRATION 시 초과 미디어 자동 삭제 worker
 *
 * 동작 원칙:
 *  - pool_data_purge_jobs 테이블에서 pending 상태의 job을 처리
 *  - 세 source 모두 대상: photo_assets_meta / student_photos / video_assets_meta
 *  - 전역 timestamp ASC + source_type ASC + id ASC 순서로 oldest-first 삭제
 *  - shared/clone R2 object: 기존 photos.ts canonical sibling 체크 재사용
 *  - R2 삭제 실패 시 silent orphan 금지 — last_error 기록 후 retry 허용
 *  - 삭제 후 canonical usage 재계산 → remainingBytes <= targetQuota 시 종료
 *  - 매 5분마다 실행 (acquireLock으로 중복 방지)
 */

import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";
import { deleteFromR2 } from "../lib/objectStorage.js";
import { getPoolStorageUsage } from "../lib/storageQuota.js";

const JOB_NAME   = "data-purge-worker";
const TTL_SECONDS = 300;
const BATCH_SIZE  = 20; // 한 번에 처리할 candidate 수
const MAX_ATTEMPTS = 5;

// ── 미디어 candidate 타입 ─────────────────────────────────────────────────
interface MediaCandidate {
  id:           string;
  source_type:  "photo_asset" | "student_photo" | "video_asset";
  file_size:    number;
  created_at:   Date;
  object_key:   string | null; // photo_assets_meta / video_assets_meta
  file_key:     string | null; // student_photos
}

/** pool의 세 source에서 오래된 순 BATCH_SIZE 개 candidate 조회 */
async function fetchOldestCandidates(poolId: string): Promise<MediaCandidate[]> {
  // UNION으로 세 source를 하나의 stream으로 병합, 전역 oldest-first
  const rows = (await db.execute(sql`
    (
      SELECT
        id,
        'photo_asset'::text   AS source_type,
        COALESCE(file_size, 0)::bigint AS file_size,
        created_at,
        object_key,
        NULL::text            AS file_key
      FROM photo_assets_meta
      WHERE pool_id = ${poolId}
        AND is_clone = false
      ORDER BY created_at ASC, id ASC
      LIMIT ${BATCH_SIZE}
    )
    UNION ALL
    (
      SELECT
        id,
        'student_photo'::text AS source_type,
        COALESCE(file_size_bytes, 0)::bigint AS file_size,
        created_at,
        NULL::text            AS object_key,
        file_key              AS file_key
      FROM student_photos
      WHERE swimming_pool_id = ${poolId}
      ORDER BY created_at ASC, id ASC
      LIMIT ${BATCH_SIZE}
    )
    UNION ALL
    (
      SELECT
        id,
        'video_asset'::text  AS source_type,
        COALESCE(file_size, 0)::bigint AS file_size,
        created_at,
        object_key           AS object_key,
        NULL::text           AS file_key
      FROM video_assets_meta
      WHERE pool_id = ${poolId}
        AND status = 'active'
      ORDER BY created_at ASC, id ASC
      LIMIT ${BATCH_SIZE}
    )
    ORDER BY created_at ASC, source_type ASC, id ASC
    LIMIT ${BATCH_SIZE}
  `)).rows as any[];

  return rows.map(r => ({
    id:          String(r.id),
    source_type: r.source_type as MediaCandidate["source_type"],
    file_size:   Number(r.file_size ?? 0),
    created_at:  new Date(r.created_at),
    object_key:  r.object_key ?? null,
    file_key:    r.file_key ?? null,
  }));
}

/**
 * photo_assets_meta 1건 안전 삭제.
 * sibling 있으면 R2 유지, DB row만 삭제.
 * Returns bytes freed (0 if R2 skipped, file_size if R2 deleted).
 */
async function deletePhotoAsset(candidate: MediaCandidate): Promise<number> {
  const { id, object_key, file_size } = candidate;

  // ── R2 sibling 체크 (기존 photos.ts 패턴) ──────────────────────────────
  let r2Freed = 0;
  if (object_key) {
    const [sibling] = (await db.execute(sql`
      SELECT id FROM photo_assets_meta
      WHERE object_key = ${object_key}
        AND id != ${id}
      LIMIT 1
    `)).rows as any[];

    if (!sibling) {
      // 마지막 reference → R2 삭제
      await deleteFromR2(object_key, "photo");
      r2Freed = file_size;
    }
    // sibling 있으면 R2 유지, DB row만 삭제
  }

  // diary_photo_attachments 연결 제거 (CASCADE가 없을 경우 명시적 삭제)
  await db.execute(sql`
    DELETE FROM diary_photo_attachments WHERE photo_id = ${id}
  `).catch(() => {}); // 테이블 없을 수 있음 — 무시

  // photo_assets_meta row 삭제
  await db.execute(sql`DELETE FROM photo_assets_meta WHERE id = ${id}`);

  return r2Freed > 0 ? file_size : (object_key ? 0 : file_size);
}

/**
 * student_photos 1건 안전 삭제.
 */
async function deleteStudentPhoto(candidate: MediaCandidate): Promise<number> {
  const { id, file_key, file_size } = candidate;

  if (file_key) {
    await deleteFromR2(file_key, "photo");
  }
  await db.execute(sql`DELETE FROM student_photos WHERE id = ${id}`);
  return file_size;
}

/**
 * video_assets_meta 1건 안전 삭제.
 */
async function deleteVideoAsset(candidate: MediaCandidate): Promise<number> {
  const { id, object_key, file_size } = candidate;

  if (object_key) {
    await deleteFromR2(object_key, "video");
  }
  // video 관련 relation 정리
  await db.execute(sql`
    DELETE FROM diary_video_attachments WHERE video_id = ${id}
  `).catch(() => {});

  await db.execute(sql`
    UPDATE video_assets_meta
    SET status = 'deleted', updated_at = NOW()
    WHERE id = ${id}
  `);
  return file_size;
}

/** 단일 candidate 삭제, 실패 시 throws */
async function deleteCandidate(c: MediaCandidate): Promise<number> {
  switch (c.source_type) {
    case "photo_asset":   return deletePhotoAsset(c);
    case "student_photo": return deleteStudentPhoto(c);
    case "video_asset":   return deleteVideoAsset(c);
    default: return 0;
  }
}

/** purge job 1개 실행 */
async function runPurgeJob(job: {
  id: string; pool_id: string; target_quota_bytes: number; attempts: number;
}): Promise<{ status: "completed" | "failed"; bytesFreed: number; itemsDeleted: number; error?: string }> {
  const { id: jobId, pool_id: poolId, target_quota_bytes: targetBytes } = job;

  // status = running, attempts++, started_at
  await superAdminDb.execute(sql`
    UPDATE pool_data_purge_jobs
    SET status = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, NOW()), updated_at = NOW()
    WHERE id = ${jobId}
  `);

  let totalBytesFreed  = 0;
  let totalItemDeleted = 0;
  let failedKeys: string[] = [];

  // ── 삭제 루프 ─────────────────────────────────────────────────────────────
  for (let iteration = 0; iteration < 5000; iteration++) {
    // 현재 사용량 재계산
    const usage = await getPoolStorageUsage(poolId).catch(() => null);
    if (!usage) break;

    if (usage.usedBytes <= targetBytes) {
      // 목표 달성
      console.log(
        `[data-purge] ✅ job=${jobId} pool=${poolId} ` +
        `used=${usage.usedBytes} <= target=${targetBytes} — 종료`,
      );
      break;
    }

    // candidate 조회
    const candidates = await fetchOldestCandidates(poolId);
    if (candidates.length === 0) {
      console.log(`[data-purge] ⚠️ job=${jobId} pool=${poolId} — candidate 없음. 종료.`);
      break;
    }

    for (const c of candidates) {
      // 현재 사용량 재확인 (매 파일마다)
      const latestUsage = await getPoolStorageUsage(poolId).catch(() => null);
      if (!latestUsage || latestUsage.usedBytes <= targetBytes) break;

      try {
        const freed = await deleteCandidate(c);
        totalBytesFreed  += freed;
        totalItemDeleted += 1;
      } catch (e: any) {
        const key = c.object_key ?? c.file_key ?? c.id;
        console.error(`[data-purge] ❌ 삭제 실패: ${c.source_type} id=${c.id} key=${key}:`, e?.message);
        failedKeys.push(key);
        // R2 실패 시에도 계속 진행 (다음 파일 시도)
      }
    }
  }

  // ── 완료 후 upload_blocked 재계산 ────────────────────────────────────────
  try {
    const finalUsage = await getPoolStorageUsage(poolId);
    if (finalUsage.usedBytes <= targetBytes) {
      // 목표 달성 → upload_blocked 해제 (is_readonly가 아닌 경우만)
      const [pool] = (await superAdminDb.execute(sql`
        SELECT is_readonly FROM swimming_pools WHERE id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (!pool?.is_readonly) {
        await superAdminDb.execute(sql`
          UPDATE swimming_pools SET upload_blocked = false, updated_at = NOW()
          WHERE id = ${poolId}
        `);
      }
    }
  } catch (e) {
    console.error("[data-purge] upload_blocked 재계산 오류:", e);
  }

  if (failedKeys.length > 0) {
    const errMsg = `R2 삭제 실패 ${failedKeys.length}건: ${failedKeys.slice(0, 3).join(",")}${failedKeys.length > 3 ? "..." : ""}`;
    await superAdminDb.execute(sql`
      UPDATE pool_data_purge_jobs
      SET status = 'failed', last_error = ${errMsg},
          bytes_freed = bytes_freed + ${totalBytesFreed},
          items_deleted = items_deleted + ${totalItemDeleted},
          updated_at = NOW()
      WHERE id = ${jobId}
    `);
    return { status: "failed", bytesFreed: totalBytesFreed, itemsDeleted: totalItemDeleted, error: errMsg };
  }

  await superAdminDb.execute(sql`
    UPDATE pool_data_purge_jobs
    SET status = 'completed', completed_at = NOW(),
        bytes_freed = bytes_freed + ${totalBytesFreed},
        items_deleted = items_deleted + ${totalItemDeleted},
        updated_at = NOW()
    WHERE id = ${jobId}
  `);
  return { status: "completed", bytesFreed: totalBytesFreed, itemsDeleted: totalItemDeleted };
}

/** pending/failed(재시도 가능) job 1개 실행 */
export async function runDataPurgeWorker(): Promise<{
  processed: number;
  completed: number;
  failed: number;
}> {
  const locked = await acquireLock(JOB_NAME, TTL_SECONDS);
  if (!locked) return { processed: 0, completed: 0, failed: 0 };

  let processed = 0;
  let completed = 0;
  let failed    = 0;

  try {
    // pending 또는 재시도 가능한 failed job 조회 (MAX_ATTEMPTS 미만)
    const jobs = (await superAdminDb.execute(sql`
      SELECT id, pool_id, target_quota_bytes, attempts
      FROM pool_data_purge_jobs
      WHERE status IN ('pending', 'failed')
        AND attempts < ${MAX_ATTEMPTS}
      ORDER BY created_at ASC
      LIMIT 5
    `)).rows as any[];

    for (const job of jobs) {
      processed++;
      try {
        const result = await runPurgeJob({
          id:                  String(job.id),
          pool_id:             String(job.pool_id),
          target_quota_bytes:  Number(job.target_quota_bytes),
          attempts:            Number(job.attempts ?? 0),
        });
        if (result.status === "completed") completed++;
        else failed++;
        console.log(
          `[data-purge] job=${job.id} pool=${job.pool_id} ` +
          `${result.status} freed=${result.bytesFreed} deleted=${result.itemsDeleted}`,
        );
      } catch (e: any) {
        failed++;
        console.error(`[data-purge] job=${job.id} 처리 오류:`, e?.message);
        await superAdminDb.execute(sql`
          UPDATE pool_data_purge_jobs
          SET status = 'failed', last_error = ${String(e?.message ?? "unknown")},
              updated_at = NOW()
          WHERE id = ${job.id}
        `).catch(() => {});
      }
    }

    await recordHeartbeat(JOB_NAME, { processed, completed, failed, at: new Date().toISOString() });
  } finally {
    await releaseLock(JOB_NAME);
  }

  return { processed, completed, failed };
}

/** 스케줄러 시작 — index.ts에서 호출 */
export function startDataPurgeWorker(): void {
  // 5분 간격
  setInterval(async () => {
    try {
      const result = await runDataPurgeWorker();
      if (result.processed > 0) {
        console.log(`[data-purge-worker] tick: processed=${result.processed} completed=${result.completed} failed=${result.failed}`);
      }
    } catch (e) {
      console.error("[data-purge-worker] tick 오류:", e);
    }
  }, 5 * 60 * 1000);

  console.log("[data-purge-worker] started (5min interval)");
}
