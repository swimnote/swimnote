import { Router } from "express";

const router = Router();

router.post("/crash-report", (req, res) => {
  const {
    timestamp,
    isFatal,
    message,
    stack,
    platform,
    version,
    versionCode,
    buildNumber,
    deviceModel,
    osVersion,
    source,
  } = req.body ?? {};

  console.error(
    "[CRASH_REPORT]",
    JSON.stringify({
      timestamp: timestamp ?? new Date().toISOString(),
      isFatal: !!isFatal,
      message: message ?? "(no msg)",
      stack: typeof stack === "string" ? stack.substring(0, 3000) : "(no stack)",
      platform: platform ?? "unknown",
      version: version ?? "unknown",
      versionCode: versionCode ?? null,
      buildNumber: buildNumber ?? null,
      deviceModel: deviceModel ?? null,
      osVersion: osVersion ?? null,
      source: source ?? "global_error_handler",
    })
  );

  res.status(200).json({ ok: true });
});

export default router;
