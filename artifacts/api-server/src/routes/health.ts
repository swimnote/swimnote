import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { BOOT_ID, COMMIT_SHA, SERVICE_VERSION } from "../lib/boot-state.js";

const router: IRouter = Router();

router.get(["/", "/healthz"], (_req, res) => {
  // status:"ok" — 기존 contract 유지 (1.6.3 및 기존 consumer 호환)
  const base = HealthCheckResponse.parse({ status: "ok" });
  // additive diagnostic fields — 기존 key 삭제/rename 없음
  res.json({
    ...base,
    uptime_seconds: Math.floor(process.uptime()),
    boot_id: BOOT_ID,
    commit: COMMIT_SHA,
    service_version: SERVICE_VERSION,
  });
});

export default router;
