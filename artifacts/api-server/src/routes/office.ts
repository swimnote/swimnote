import { pool, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { OfficeCommandService, OfficeError, type OfficeActor } from "../lib/office-command.js";
import { notifyPoolEvent } from "../lib/pg-realtime.js";
import { AI_MODEL } from "../config/ai-model-config.js";
import { createOfficeRouter } from "../lib/office-http.js";
import { officeModelMessages } from "../lib/office-model.js";

const service = new OfficeCommandService(pool);
async function actor(req: AuthRequest): Promise<OfficeActor> {
  const rows = await db.execute(sql`SELECT u.swimming_pool_id FROM users u
    JOIN swimming_pools p ON p.id=u.swimming_pool_id
    WHERE u.id=${req.user!.userId} AND u.is_activated=true AND u.roles @> ARRAY['pool_admin']::text[]
      AND u.withdrawal_requested_at IS NULL AND p.deactivated_at IS NULL
      AND (${req.user!.poolId == null} OR u.swimming_pool_id=${req.user!.poolId ?? null})`);
  const poolId = (rows.rows[0] as any)?.swimming_pool_id;
  if (!poolId) throw new OfficeError(403, "FORBIDDEN", "현재 소속 수영장을 확인할 수 없습니다.");
  return { userId: req.user!.userId, role: req.user!.role, poolId };
}
const router = createOfficeRouter({ service, auth: [requireAuth as any, requireRole("pool_admin") as any], actor,
  notify: (owner, memberId) => notifyPoolEvent({ type: "member.changed", pool_id: owner.poolId, entity_id: memberId }),
  model: async input => {
      const messages = officeModelMessages(input);
      const { getOpenAI } = await import("./ai.js");
      const response = await getOpenAI().chat.completions.create({
        model: AI_MODEL.SUPPORT, response_format: { type: "json_object" }, temperature: 0, max_tokens: 512,
        messages,
      }, { timeout: 12_000, maxRetries: 0 });
      if ((response.choices[0]?.message.content?.length ?? 0) > 8000 ||
          response.choices[0]?.finish_reason !== "stop")
        throw new OfficeError(502, "MODEL_OUTPUT", "잘리거나 너무 긴 해석 결과입니다. 업무는 실행되지 않았습니다.");
      return JSON.parse(response.choices[0]?.message.content ?? "null");
  },
});
export default router;
