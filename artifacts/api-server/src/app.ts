/**
 * PHASE B — Express 앱 설정
 *
 * 보안 설정:
 *   - helmet (보안 헤더)
 *   - CORS (허용 Origin 기반)
 *   - express-session + PostgreSQL 세션 스토어
 *   - CSRF 방어 (관리자 라우트)
 *   - Rate Limit (로그인)
 *   - Body 크기 제한
 *   - Stack Trace 비노출
 *   - SECRET 로그 마스킹
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { pool, runAdminMigration, runKfMigration } from "@workspace/db";
import { initKfJobQueue } from "./lib/kf/job-queue.js";
import { seedIfEmpty as seedMcIfEmpty } from "./lib/misconception/replitdb-repository.js";
import router from "./routes/index.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { aiJsonParseErrorHandler } from "./middlewares/ai-json-parse-error-handler.js";
import { logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 환경 변수 검증 ─────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  if (process.env.NODE_ENV === "production") {
    // 운영 환경에서 잘못된 설정이면 서버가 조용히 불안전하게 실행되지 않도록
    throw new Error(
      "SESSION_SECRET must be set and at least 32 characters in production. Server will not start.",
    );
  } else {
    logger.warn(
      "SESSION_SECRET is not set or too short. Using development fallback. DO NOT use this in production.",
    );
  }
}
const secret = SESSION_SECRET ?? "swimnote-dev-secret-min-32-chars-pad!!";

// ── CORS 허용 Origin 설정 ───────────────────────────────────────────────────
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
let allowedOrigins: string[];

if (process.env.NODE_ENV === "production" && !rawAllowedOrigins) {
  throw new Error(
    "ALLOWED_ORIGINS must be set in production. Server will not start.",
  );
}

if (rawAllowedOrigins) {
  allowedOrigins = rawAllowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
} else {
  // 개발 환경: Replit 도메인 동적 허용
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  allowedOrigins = replitDevDomain
    ? [
        `https://${replitDevDomain}`,
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1",      // playwright / headless browser
        "http://127.0.0.1:80",
      ]
    : [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1",
        "http://127.0.0.1:80",
      ];
  logger.info({ allowedOrigins }, "개발 모드 CORS 허용 Origin");
}

// ── 앱 생성 ────────────────────────────────────────────────────────────────────
const app: Express = express();

// Replit / Nginx 프록시 신뢰 (Cookie secure 설정 시 필요)
app.set("trust proxy", 1);

// ── 보안 헤더 (helmet) ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // API 서버 — CSP 불필요
  }),
);

// ── CORS ───────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // origin이 없으면 같은 서버 내 요청 (curl 등) → 허용
      if (!origin) return callback(null, true);
      if (allowedOrigins.some((o) => origin.startsWith(o))) {
        return callback(null, true);
      }
      return callback(new Error(`CORS 차단: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Organization-Id", "X-Actor-Id", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-CSRF-Token"],
  }),
);

// ── HTTP 요청 로깅 ─────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Body 파싱 (크기 제한) ───────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── AI JSON Parse Error → AIErrorResponse 변환 (express.json 직후, session 앞) ──
// /api/ai/* 경로의 잘못된 JSON만 포착하여 AI Contract 형식으로 변환합니다.
// 비-AI 경로의 Parse Error는 기존 전역 errorHandler 흐름으로 위임합니다.
app.use(aiJsonParseErrorHandler);

// ── 세션 설정 (PostgreSQL 스토어) ─────────────────────────────────────────────
const PgSession = ConnectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      schemaName: "admin",
      createTableIfMissing: false, // run-admin-migration에서 생성
    }),
    name: "swimnote.admin.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,               // Idle Timeout 갱신 (요청마다 만료 리셋)
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000, // 8시간 Idle Timeout
    },
  }),
);

// ── 일반 API Rate Limit (관리자 API 포함, IP당 200회/15분) ────────────────────
const isTest = process.env.NODE_ENV === "test";
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  // 테스트 환경: 공유 127.0.0.1 IP로 제한에 걸리지 않도록 전체 skip
  // 헬스체크도 항상 제외
  skip: (req) => isTest || req.path === "/api/health",
});
app.use(generalLimiter);

// ── 라우터 등록 ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── swimnote SPA 서빙 (/api 이외 모든 경로) ──────────────────────────────────
const webDistDir = path.join(__dirname, "../../swimnote/dist/public");
const webIndexPath = path.join(webDistDir, "index.html");
if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
}

// 404 핸들러 — SPA fallback 또는 JSON
app.use((_req: Request, res: Response) => {
  if (fs.existsSync(webIndexPath)) {
    res.sendFile(webIndexPath);
  } else {
    res.status(404).json({ success: false, message: "요청한 경로를 찾을 수 없습니다.", error: "Not Found" });
  }
});

// ── 오류 핸들러 (Stack Trace 비노출) ──────────────────────────────────────────
app.use(errorHandler);

// ── Admin Migration 실행 (서버 시작 시 1회, 멱등) ─────────────────────────────
runAdminMigration()
  .then(() => logger.info("Admin 스키마 마이그레이션 완료"))
  .catch((err: unknown) => logger.error(err, "Admin 스키마 마이그레이션 실패 (계속 실행)"));

// ── KF Migration 실행 (서버 시작 시 1회, 멱등) ────────────────────────────────
runKfMigration()
  .then(() => logger.info("KF 스키마 마이그레이션 완료"))
  .catch((err: unknown) => logger.error(err, "KF 스키마 마이그레이션 실패 (계속 실행)"));

// ── KF Job Queue 초기화 ────────────────────────────────────────────────────
// DISABLE_KF_WORKER=true  → Render API Server 배포 시 Worker 역할 분리
// NODE_ENV=test            → 테스트 환경에서 건너뜀
// 그 외 (Replit dev 등)    → 기존대로 API Server 내에서 Worker 실행
if (process.env.NODE_ENV !== "test" && process.env.DISABLE_KF_WORKER !== "true") {
  initKfJobQueue()
    .then(() => logger.info("KF Job Queue 초기화 완료"))
    .catch((err: unknown) => logger.error(err, "KF Job Queue 초기화 실패 (계속 실행)"));
}

// ── Misconception Hunter 시드 데이터 초기화 ────────────────────────────────────
// Render production에는 Replit DB가 없으므로 startup path에서 절대 로드하지 않는다.
if (process.env.NODE_ENV !== "production" || process.env.REPLIT_DB_URL) {
  seedMcIfEmpty()
    .then(() => logger.info("MC Hunter 시드 확인 완료"))
    .catch((err: unknown) => logger.warn(err, "MC Hunter 시드 실패 (계속 실행)"));
} else {
  logger.info("MC Hunter 시드 건너뜀: Replit DB 미구성 production runtime");
}

export default app;
