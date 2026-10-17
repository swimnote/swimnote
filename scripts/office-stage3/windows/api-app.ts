/** Isolated diagnostic composition. Never imported by a product entrypoint. */
import express from "express";
import { OfficeCommandService, OfficeError } from "../../../artifacts/api-server/src/lib/office-command.js";
import { createOfficeRouter } from "../../../artifacts/api-server/src/lib/office-http.js";

export function diagnosticApp(pool: any, model: any, candidateId: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "12kb" }));
  app.use((req, res, next) => {
    if (req.headers.host !== "127.0.0.1:20411" ||
        req.headers.origin !== undefined && req.headers.origin !== "app://office")
      return void res.sendStatus(403);
    res.setHeader("Cache-Control", "no-store");
    if (req.headers.origin === "app://office") {
      res.setHeader("Access-Control-Allow-Origin", "app://office");
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      if (req.method === "OPTIONS") return void res.sendStatus(204);
    }
    next();
  });
  app.get("/isolation/status", (_req, res) => res.json({
    candidateId, isolated: true, db: "office_stage3_acceptance",
    normalAuthReady: false, executionReady: false, modelMode: "recorded-only", paidCalls: 0,
  }));
  // No substitute JWTs, bearer fixture, magic account or permissive auth alias.
  app.use("/api/office", createOfficeRouter({
    service: new OfficeCommandService(pool),
    auth: [(_req, res) => { res.status(503).json({ code: "ISOLATED_AUTH_NOT_READY", error: "정상 합성 인증이 준비되지 않아 업무 실행을 차단했습니다." }); }],
    actor: async () => { throw new OfficeError(403, "AUTH_NOT_READY", "No authenticated actor"); },
    model, notify: async () => { throw new Error("External notification prohibited"); },
  }));
  app.use("/api", (_req, res) => { res.status(503).json({
    success: false, code: "ISOLATED_AUTH_NOT_READY",
    error: "정상 로그인·JWT·Pool 권한 어댑터가 준비되지 않았습니다. 인증 우회는 제공하지 않습니다.",
  }); });
  app.use((_req, res) => { res.sendStatus(404); });
  return app;
}
