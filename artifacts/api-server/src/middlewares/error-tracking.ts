/**
 * middlewares/error-tracking.ts — WP9 5xx Response Tracking
 *
 * res.on('finish') 훅으로 HTTP 5xx 응답을 감지하여 event_logs에 기록.
 * 요청 자체를 변경하지 않음. 로깅 실패가 요청 처리에 영향을 주지 않음.
 * Secret/PII: URL path만 기록, body/header/token 절대 포함 금지.
 */
import type { Request, Response, NextFunction } from "express";
import { logOperationalError } from "../lib/event-logger.js";

export function errorTrackingMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    if (res.statusCode >= 500) {
      // safe path only — no query string (may contain tokens)
      const safePath = (req.path ?? "").slice(0, 120);
      void logOperationalError({
        pool_id: "global",
        level: "ERROR",
        feature: "API",
        error_code: `HTTP_${res.statusCode}`,
        safe_message: `${req.method} ${safePath} → ${res.statusCode}`,
      }).catch(() => {/* 로깅 실패 무시 */});
    }
  });
  next();
}
