/**
 * event-retry-job.ts
 *
 * super DB 복제 실패 이벤트를 재시도하는 크론 잡.
 *
 * 스케줄:
 *   - 매 5분마다 → event_retry_queue에서 pending 항목 재시도
 *
 * 흐름:
 *   1. event_retry_queue에서 next_retry_at <= NOW() 인 항목 최대 50건 조회
 *   2. super DB(pool_event_logs)에 복제 재시도
 *   3. 성공 → resolved = true
 *   4. max_retries 초과 → dead_letter_queue로 이동
 */
import cron from "node-cron";
import { processRetryQueue } from "../lib/pool-event-logger.js";

export function startEventRetryJob() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      await processRetryQueue();
    } catch (e) {
      console.error("[event-retry-job] 재시도 큐 처리 오류:", e);
    }
  });

  console.log("[event-retry-job] 재시도 큐 잡 등록 완료 (매 5분)");
}
