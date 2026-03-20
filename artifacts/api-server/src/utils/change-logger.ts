/**
 * change-logger.ts
 *
 * 서버 기반 변경분 수집 유틸리티.
 * 주요 API 변경(create/update/delete) 직후 호출해
 * data_change_logs 테이블에 기록한다.
 *
 * 사용법:
 *   import { logChange } from "../utils/change-logger.js";
 *   await logChange({ tenantId, tableName: "students", recordId: id, changeType: "create", payload: newRow });
 */
import { db } from "@workspace/db";
import { dataChangeLogsTable } from "@workspace/db/schema";

export type ChangeType = "create" | "update" | "delete";

interface ChangeLogParams {
  tenantId: string;
  tableName: string;
  recordId: string;
  changeType: ChangeType;
  payload?: Record<string, unknown> | null;
}

/**
 * 변경분 로그 기록. 오류가 나더라도 메인 흐름에 영향 주지 않도록 catch 처리.
 */
export async function logChange(params: ChangeLogParams): Promise<void> {
  try {
    await db.insert(dataChangeLogsTable).values({
      id: crypto.randomUUID(),
      tenant_id: params.tenantId,
      table_name: params.tableName,
      record_id: params.recordId,
      change_type: params.changeType,
      payload: params.payload ?? null,
      sync_status: "pending",
    });
  } catch (err) {
    console.error("[change-logger] 로그 기록 실패:", err);
  }
}
