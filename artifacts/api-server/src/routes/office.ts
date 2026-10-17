import { Router } from "express";
import { pool, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { OfficeCommandService, OfficeError, type OfficeActor } from "../lib/office-command.js";
import { interpretOffice } from "../lib/office-interpret.js";
import { notifyPoolEvent } from "../lib/pg-realtime.js";
import { AI_MODEL } from "../config/ai-model-config.js";

const router = Router();
const service = new OfficeCommandService(pool);
router.use(requireAuth, requireRole("pool_admin"));
router.use((_req, res, next) => {
  if (process.env.OFFICE_STAGE3_ENABLED !== "true") { res.status(503).json({ code: "NOT_ENABLED", error: "통합 배포 전 비활성입니다." }); return; }
  next();
});
async function actor(req: AuthRequest): Promise<OfficeActor> {
  const rows = await db.execute(sql`SELECT swimming_pool_id FROM users WHERE id=${req.user!.userId} AND role='pool_admin'`);
  const poolId = (rows.rows[0] as any)?.swimming_pool_id;
  if (!poolId) throw new OfficeError(403, "FORBIDDEN", "현재 소속 수영장을 확인할 수 없습니다.");
  return { userId: req.user!.userId, role: req.user!.role, poolId };
}
function failure(res: any, e: unknown) {
  if (e instanceof OfficeError) return res.status(e.status).json({ code: e.code, error: e.message });
  return res.status(500).json({ code: "RESULT_UNKNOWN", error: "결과를 확인할 수 없습니다. 같은 변경을 재전송하지 말고 요청 상태를 확인하세요." });
}
router.post("/command", async (req: AuthRequest, res) => {
  try {
    const owner = await actor(req), result = await service.execute(owner, req.body);
    // Commit + receipt precede SSE. No messages/push/provider calls.
    void notifyPoolEvent({ type: "member.changed", pool_id: owner.poolId, entity_id: result.memberId }).catch(() => {});
    res.json(result);
  } catch (e) { failure(res, e); }
});
router.get("/commands/:requestId", async (req: AuthRequest, res) => {
  try {
    const result = await service.status(await actor(req), String(req.params.requestId));
    if (!result) { res.status(404).json({ code: "UNCONFIRMED", error: "완료 기록이 확인되지 않았습니다. 재실행하지 마세요." }); return; }
    res.json(result);
  } catch (e) { failure(res, e); }
});
router.post("/interpret", async (req: AuthRequest, res) => {
  if (process.env.OFFICE_STAGE3_AI_ENABLED !== "true") { res.status(503).json({ code: "AI_NOT_ENABLED", error: "실제 AI 전송은 통합 배포 승인 전 비활성입니다." }); return; }
  try {
    await actor(req);
    const interpreted = await interpretOffice(async input => {
      const { getOpenAI } = await import("./ai.js");
      const response = await getOpenAI().chat.completions.create({
        model: AI_MODEL.SUPPORT, response_format: { type: "json_object" }, temperature: 0,
        messages: [
          { role: "system", content: 'Return JSON only. Allowed: {"kind":"search","search":"..."}, {"kind":"clarify","question":"..."}, {"kind":"command","command":{"action":"update","changes":{"name|phone|birth_date|birth_year|parent_name|memo":"value"}}}, or command action move with fromClassId,toClassId. Never invent IDs. If a member is not selected or source/destination class ID is unknown ask a question. Never output URLs, SQL, actor, pool, requestId, revision, approval. Commands are proposals, not execution.' },
          { role: "user", content: JSON.stringify(input) },
        ],
      });
      return JSON.parse(response.choices[0]?.message.content ?? "null");
    }, req.body);
    res.json(interpreted);
  } catch (e) { failure(res, e); }
});
export default router;
