/**
 * opsAlerts.ts — 슈퍼관리자 운영 알림 생성 유틸리티
 *
 * ops_alerts 테이블에 알림을 삽입합니다.
 * dedupe_key가 있으면 동일 key가 있을 때 삽입을 건너뜁니다.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export type AlertSeverity = "info" | "success" | "warning" | "error";

export async function createOpsAlert(params: {
  type: string;
  title: string;
  message: string;
  severity?: AlertSeverity;
  relatedPoolId?: string | null;
  relatedUserId?: string | null;
  dedupeKey?: string | null;
}): Promise<string | null> {
  const { type, title, message, severity = "info", relatedPoolId, relatedUserId, dedupeKey } = params;
  try {
    if (dedupeKey) {
      const existing = await superAdminDb.execute(sql`
        SELECT id FROM ops_alerts WHERE dedupe_key = ${dedupeKey} LIMIT 1
      `);
      if ((existing.rows as any[]).length > 0) return null;
    }
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    await superAdminDb.execute(sql`
      INSERT INTO ops_alerts (id, type, title, message, severity, related_pool_id, related_user_id, dedupe_key, created_at)
      VALUES (${id}, ${type}, ${title}, ${message}, ${severity}, ${relatedPoolId ?? null}, ${relatedUserId ?? null}, ${dedupeKey ?? null}, NOW())
    `);
    return id;
  } catch (e: any) {
    console.error("[opsAlerts] 생성 오류:", e?.message);
    return null;
  }
}
