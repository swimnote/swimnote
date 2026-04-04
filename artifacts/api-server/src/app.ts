import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { initPushTables } from "./lib/push-service.js";
import { startPushScheduler } from "./jobs/push-scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// ── CORS ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  // Replit 운영 도메인
  "https://swimnote-7.replit.app",
  // EAS 빌드 / 개발 Expo
  /^https:\/\/.*\.expo\.dev$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.sisko\.replit\.dev$/,
  /^https:\/\/.*\.pike\.replit\.dev$/,
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== "production") return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === "string" ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    return callback(new Error(`CORS 차단: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/store-assets", express.static(path.join(__dirname, "../public/store-assets")));
app.use("/api", router);

// 헬스체크 — /api/health 와 /health 모두 지원
app.get(["/health", "/api/health"], (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString(), version: "v2.1-2026-04-04" });
});

// 404 핸들러 — HTML 대신 JSON
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "요청한 경로를 찾을 수 없습니다.", error: "Not Found" });
});

// 전역 에러 핸들러 — 프로덕션에서는 내부 메시지 노출 안 함
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Global Error]", err);
  const isProd = process.env.NODE_ENV === "production";
  res.status(500).json({
    success: false,
    message: isProd ? "서버 오류가 발생했습니다." : (err.message || "서버 오류가 발생했습니다."),
    error:   isProd ? "Internal Server Error"   : err.message,
  });
});

// 푸시 알림 시스템 초기화
initPushTables()
  .then(() => {
    startPushScheduler();
    console.log("[app] 푸시 알림 시스템 초기화 완료");
  })
  .catch(e => console.error("[app] 푸시 초기화 오류:", e));

export default app;
