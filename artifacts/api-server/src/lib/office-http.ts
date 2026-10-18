import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { OfficeCommandService, OfficeError, type OfficeActor } from "./office-command.js";
import { interpretOffice, type OfficeModel } from "./office-interpret.js";

/** Injected boundary; fixture auth lives ONLY in scripts/office-stage3, never the product entrypoint. */
export function createOfficeRouter(deps: {
  service: OfficeCommandService; auth: RequestHandler[];
  actor: (req: any) => Promise<OfficeActor>; model: OfficeModel;
  canInterpret?: (actor: OfficeActor) => Promise<boolean>;
  notify: (actor: OfficeActor, memberId: string) => Promise<void>;
}) {
  const router = Router();
  router.use(...deps.auth);
  const failure = (res: any, e: unknown) => {
    if (e instanceof OfficeError) return res.status(e.status).json({ code: e.code, error: e.message });
    return res.status(500).json({ code: "RESULT_UNKNOWN", error: "결과 확인에 실패했습니다. 미처리로 해석하거나 재실행하지 마세요." });
  };
  const writes: RequestHandler = (_req, res, next) => {
    if (process.env.OFFICE_STAGE3_ENABLED !== "true") {
      res.status(503).json({ code: "NOT_ENABLED", error: "신규 실행은 비활성입니다. 기존 결과 조회는 별도입니다." }); return;
    }
    next();
  };
  router.post("/requests", writes, async (req, res) => {
    try { res.json(await deps.service.issue(await deps.actor(req), req.body)); }
    catch (e) { failure(res, e); }
  });
  router.post("/command", writes, async (req, res) => {
    try {
      const owner = await deps.actor(req), result = await deps.service.execute(owner, req.body);
      void deps.notify(owner, result.memberId).catch(() => {});
      res.json(result);
    } catch (e) { failure(res, e); }
  });
  // No execution/model gate here. Every lookup still requires current auth + current actor authority.
  router.get("/commands/:requestId", async (req, res) => {
    try {
      const result = await deps.service.status(await deps.actor(req), String(req.params.requestId));
      if (!result) { res.status(404).json({ code: "UNCONFIRMED", error: "기록이 확인되지 않았습니다. 미처리 증거가 아닙니다." }); return; }
      res.json(result);
    } catch (e) { failure(res, e); }
  });
  const limit = rateLimit({ windowMs: 600_000, limit: 6,
    keyGenerator: req => String((req as any).user?.userId ?? "unauthenticated"),
    standardHeaders: "draft-7", legacyHeaders: false,
    message: { code: "MODEL_LIMIT", error: "AI 해석 한도를 초과했습니다. 자동 재시도하지 마세요." } });
  // AI interpretation and new writes have independent switches; neither interprets+executes together.
  router.post("/interpret", limit, async (req, res) => {
    if (process.env.OFFICE_STAGE3_AI_ENABLED !== "true") {
      res.status(503).json({ code: "AI_NOT_ENABLED", error: "AI 해석은 비활성입니다." }); return;
    }
    try {
      const owner = await deps.actor(req);
      if (!deps.canInterpret || !await deps.canInterpret(owner)) {
        res.status(403).json({ code: "AI_ENTITLEMENT_REQUIRED", error: "일상 AI 작업창은 스윔노트 AI 이용권이 필요합니다. 일반 PC 업무와 무료 데이터 이전은 별개입니다." }); return;
      }
      res.json(await interpretOffice(deps.model, req.body));
    }
    catch (e) { failure(res, e); }
  });
  return router;
}
