import { Router } from "express";
import { superAdminDb } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import {
  createRecoveryBatch, getRecoveryBatchStatus, listRecoveryBatches,
  previewRecoveryBatch, resumeRecoveryBatch,
} from "../lib/growth-report-recovery-batch.js";

const router = Router();
const path = "/super/growth-reports/recovery-batches";
const guards = [requireAuth, requireRole("super_admin", "platform_admin")];
function scope(input: Record<string, any>) {
  if (input.pool_id != null && typeof input.pool_id !== "string") {
    throw new Error("INVALID_RECOVERY_SCOPE");
  }
  return { reportMonth: typeof input.report_month === "string" ? input.report_month : "",
    poolId: typeof input.pool_id === "string" && input.pool_id.trim() ? input.pool_id.trim() : undefined };
}
function failure(req: AuthRequest, res: any, error: any) {
  const allowed = new Set(["INVALID_RECOVERY_SCOPE", "INVALID_RECOVERY_APPROVAL",
    "RECOVERY_BATCH_SCHEMA_NOT_READY", "RECOVERY_BATCH_NOT_FOUND", "NO_RECOVERABLE_TARGETS",
    "RECOVERY_APPROVAL_CONFLICT", "RECOVERY_CIRCUIT_RESUME_NOT_ALLOWED"]);
  const code = allowed.has(error?.message) ? error.message : "RECOVERY_BATCH_ERROR";
  (req as AuthRequest & { log?: {
    error(fields: { code: string }, message: string): void;
  } }).log?.error({ code }, "Recovery batch request failed");
  const status = code === "RECOVERY_BATCH_SCHEMA_NOT_READY" ? 503 :
    code === "RECOVERY_BATCH_NOT_FOUND" ? 404 :
    ["NO_RECOVERABLE_TARGETS", "RECOVERY_APPROVAL_CONFLICT", "RECOVERY_CIRCUIT_RESUME_NOT_ALLOWED"].includes(code) ? 409 :
    code.startsWith("INVALID_") ? 400 : 500;
  res.status(status).json({ error: status === 500 ? "RECOVERY_BATCH_ERROR" : code });
}
router.get(`${path}/preview`, ...guards, async (req: AuthRequest, res) => {
  try { res.json(await previewRecoveryBatch(superAdminDb as any, scope(req.query))); }
  catch (e) { failure(req, res, e); }
});
router.get(path, ...guards, async (req: AuthRequest, res) => {
  try { res.json(await listRecoveryBatches(superAdminDb as any, scope(req.query))); }
  catch (e) { failure(req, res, e); }
});
router.get(`${path}/:id`, ...guards, async (req: AuthRequest, res) => {
  try {
    const batch = await getRecoveryBatchStatus(superAdminDb as any, String(req.params.id));
    if (!batch) { res.status(404).json({ error: "RECOVERY_BATCH_NOT_FOUND" }); return; }
    res.json({ batch });
  } catch (e) { failure(req, res, e); }
});
router.post(path, ...guards, async (req: AuthRequest, res) => {
  if (req.body?.confirmed !== true || typeof req.body.reason !== "string" ||
      typeof req.body.approval_id !== "string" || !req.user?.userId) {
    res.status(400).json({ error: "INVALID_RECOVERY_APPROVAL" }); return;
  }
  try {
    const result = await createRecoveryBatch(superAdminDb as any, {
      ...scope(req.body), approvalId: req.body.approval_id, reason: req.body.reason,
      actorId: req.user.userId, actorRole: req.user.role,
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (e) { failure(req, res, e); }
});
router.post(`${path}/:id/resume`, ...guards, async (req: AuthRequest, res) => {
  if (req.body?.confirmed !== true || typeof req.body.reason !== "string" ||
      !req.body.reason.trim() || req.body.reason.length > 500 || !req.user?.userId) {
    res.status(400).json({ error: "INVALID_RECOVERY_APPROVAL" }); return;
  }
  try {
    res.json(await resumeRecoveryBatch(superAdminDb as any, String(req.params.id), req.user.userId, req.body.reason.trim()));
  } catch (e) { failure(req, res, e); }
});
export default router;