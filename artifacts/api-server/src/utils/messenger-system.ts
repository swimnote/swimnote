/**
 * messenger-system.ts
 * 공지 채널 시스템 메시지 생성 유틸 (이동/보강 자동 메시지용)
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type SystemMsgType = "system_move" | "system_makeup";

export async function createSystemMessage(opts: {
  poolId: string;
  msgType: SystemMsgType;
  content: string;
}) {
  const { poolId, msgType, content } = opts;
  try {
    await db.execute(sql`
      INSERT INTO work_messages
        (pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content)
      VALUES
        (${poolId}, 'system', '시스템', 'system', 'text', 'notice', ${msgType}, ${content})
    `);
  } catch (e) {
    console.error("[createSystemMessage]", e);
  }
}
