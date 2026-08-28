/**
 * kf/job-queue.ts — stub
 *
 * KF Job Queue는 별도 Worker 프로세스로 운영됩니다.
 * 이 파일은 API Server startup 시 import 오류를 방지하기 위한 no-op stub입니다.
 * 실제 KF Worker 로직은 DISABLE_KF_WORKER=true 환경 변수로 API Server에서 비활성화됩니다.
 */

export async function initKfJobQueue(): Promise<void> {
  // no-op: KF Worker is disabled on this process (DISABLE_KF_WORKER=true or not configured)
}
