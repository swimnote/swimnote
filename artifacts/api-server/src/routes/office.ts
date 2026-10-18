import { pool, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { OfficeCommandService, OfficeError, type OfficeActor } from "../lib/office-command.js";
import { notifyPoolEvent } from "../lib/pg-realtime.js";
import { AI_MODEL } from "../config/ai-model-config.js";
import { createOfficeRouter } from "../lib/office-http.js";
import { completeOfficeModel } from "../lib/office-model.js";
import { resolvePoolMode } from "../lib/xmode.js";
import { createOfficeOperationsRouter } from "./office-operations.js";

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
  canInterpret: async owner => {
    const mode = await resolvePoolMode(owner.poolId);
    return !!mode && (mode.mode === "x" || (mode.mode === "x_trial" && mode.x_trial_active));
  },
  notify: (owner, memberId) => notifyPoolEvent({ type: "member.changed", pool_id: owner.poolId, entity_id: memberId }),
  model: async input => {
      const { getOpenAI } = await import("./ai.js");
      return completeOfficeModel(getOpenAI(), AI_MODEL.SUPPORT, input);
  },
});
router.use("/operations", createOfficeOperationsRouter(pool, actor));
export default router;
