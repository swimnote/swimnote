/**
 * schedulerLock.ts — 분산 스케줄러 락 (DB 기반)
 *
 * 서버 여러 대 또는 Worker 재시작 시에도 동일 job이 중복 실행되지 않도록
 * DB의 scheduler_locks 테이블을 이용해 분산 락을 구현합니다.
 *
 * 사용법:
 *   const locked = await acquireLock("auto-attendance", 600);
 *   if (!locked) return; // 다른 서버가 실행 중
 *   try { ... } finally { await releaseLock("auto-attendance"); }
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * 락 획득 시도.
 * @param jobName  job 식별자 (scheduler_locks PRIMARY KEY)
 * @param ttlSeconds TTL 초과 시 오래된 락을 자동 해제 (기본 300초)
 * @returns true = 락 획득 성공, false = 다른 서버가 이미 실행 중
 */
export async function acquireLock(jobName: string, ttlSeconds = 300): Promise<boolean> {
  try {
    // TTL 초과된 오래된 락 먼저 해제
    await superAdminDb.execute(sql`
      DELETE FROM scheduler_locks
      WHERE job_name = ${jobName}
        AND locked_at < NOW() - (${String(ttlSeconds)} || ' seconds')::interval
    `);

    // 락 INSERT 시도 (이미 있으면 DO NOTHING)
    const result = await superAdminDb.execute(sql`
      INSERT INTO scheduler_locks (job_name, locked_at)
      VALUES (${jobName}, NOW())
      ON CONFLICT (job_name) DO NOTHING
      RETURNING job_name
    `);

    return (result.rows as any[]).length > 0;
  } catch (e: any) {
    console.warn(`[scheduler-lock] acquireLock(${jobName}) 오류:`, e?.message);
    return true; // DB 오류 시 실행 허용 (단일 서버 환경 보호)
  }
}

/**
 * 락 연장 (장시간 실행되는 job에서 TTL 만료 방지)
 * @param jobName  job 식별자
 * @param ttlSeconds 새 TTL
 */
export async function refreshLock(jobName: string, ttlSeconds: number): Promise<void> {
  try {
    await superAdminDb.execute(sql`
      UPDATE scheduler_locks
      SET locked_at = NOW()
      WHERE job_name = ${jobName}
    `);
  } catch (e: any) {
    console.warn(`[scheduler-lock] refreshLock(${jobName}) 오류:`, e?.message);
  }
}

/**
 * 락 해제
 */
export async function releaseLock(jobName: string): Promise<void> {
  try {
    await superAdminDb.execute(sql`
      DELETE FROM scheduler_locks WHERE job_name = ${jobName}
    `);
  } catch (e: any) {
    console.warn(`[scheduler-lock] releaseLock(${jobName}) 오류:`, e?.message);
  }
}

/**
 * Heartbeat 기록 — job 정상 실행 시각과 결과를 DB에 저장
 */
export async function recordHeartbeat(jobName: string, result: object): Promise<void> {
  try {
    await superAdminDb.execute(sql`
      INSERT INTO scheduler_heartbeat (job_name, last_run_at, result)
      VALUES (${jobName}, NOW(), ${JSON.stringify(result)})
      ON CONFLICT (job_name) DO UPDATE
        SET last_run_at = NOW(), result = EXCLUDED.result
    `);
  } catch (e: any) {
    console.warn(`[scheduler-lock] recordHeartbeat(${jobName}) 오류:`, e?.message);
  }
}
