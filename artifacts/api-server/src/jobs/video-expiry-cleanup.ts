/**
 * video-expiry-cleanup.ts — 영상 14일 자동 만료 처리 스케줄러
 *
 * 서버 시작 시 즉시 1회 실행 + 이후 1시간마다 반복
 * 조건: status = 'active' AND expires_at < NOW()
 * 처리: R2 원본 영상 삭제 + R2 썸네일 삭제 + DB status='expired' 업데이트
 * 주의: DB 레코드는 삭제하지 않음 (일지 기록 보존)
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { deleteFromR2 } from "../lib/objectStorage.js";

const INTERVAL_MS = 60 * 60 * 1000; // 1시간

async function runVideoExpiryCleanup(): Promise<void> {
  try {
    const expiredRows = (await db.execute(sql`
      SELECT id, object_key, thumbnail_key
      FROM video_assets_meta
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
      LIMIT 200
    `)).rows as Array<{ id: string; object_key: string; thumbnail_key: string | null }>;

    if (expiredRows.length === 0) {
      console.log("[video-expiry] 만료 대상 없음");
      return;
    }

    console.log(`[video-expiry] 만료 처리 시작: ${expiredRows.length}개`);
    let processed = 0;

    for (const row of expiredRows) {
      try {
        await deleteFromR2(row.object_key, "video").catch((e: any) =>
          console.warn(`[video-expiry] R2 원본 삭제 실패 (${row.id}):`, e?.message)
        );

        if (row.thumbnail_key) {
          await deleteFromR2(row.thumbnail_key, "photo").catch((e: any) =>
            console.warn(`[video-expiry] R2 썸네일 삭제 실패 (${row.id}):`, e?.message)
          );
        }

        await db.execute(sql`
          UPDATE video_assets_meta
          SET status = 'expired'
          WHERE id = ${row.id}
        `);

        processed++;
        console.log(`[video-expiry] 처리 완료: ${row.id}`);
      } catch (e: any) {
        console.error(`[video-expiry] 처리 오류 (${row.id}):`, e?.message);
      }
    }

    console.log(`[video-expiry] 완료: ${processed}/${expiredRows.length}개 만료 처리`);
  } catch (e: any) {
    console.error("[video-expiry] 실행 오류:", e?.message);
  }
}

export function startVideoExpiryCleanup(): void {
  console.log("[video-expiry] 영상 만료 처리 스케줄러 시작 (1시간 주기, 초기 실행 15초 후)");

  setTimeout(runVideoExpiryCleanup, 15_000);

  setInterval(runVideoExpiryCleanup, INTERVAL_MS);
}
