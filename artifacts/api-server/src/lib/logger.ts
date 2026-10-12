import pinoHttp from "pino-http";

// Reuse the existing pino-http dependency. Never log headers, queries or bodies.
export const requestLogger = pinoHttp({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
});
export const logger = requestLogger.logger;
