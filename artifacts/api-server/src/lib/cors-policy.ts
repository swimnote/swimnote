import type { CorsOptions } from "cors";

export class OriginDeniedError extends Error {
  constructor() { super("허용되지 않은 Origin입니다."); }
}

const ALLOWED_ORIGINS = [
  "https://swimnote.kr",
  "https://www.swimnote.kr",
  "app://office",
  /^https:\/\/.*\.onrender\.com$/,
  /^https:\/\/[\w-]+\.replit\.app$/,
  /^https:\/\/.*\.expo\.dev$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.sisko\.replit\.dev$/,
  /^https:\/\/.*\.pike\.replit\.dev$/,
];

/** Preserve native/no-Origin and existing web policy; never accept opaque/null or other app origins. */
export function createCorsOptions(environment = process.env.NODE_ENV): CorsOptions {
  return {
    origin(origin, callback) {
      if (origin === undefined) return callback(null, true);
      if (origin === "null" || (/^app:/i.test(origin) && origin !== "app://office")) {
        return callback(new OriginDeniedError());
      }
      if (environment !== "production" || ALLOWED_ORIGINS.some(
        allowed => typeof allowed === "string" ? allowed === origin : allowed.test(origin),
      )) return callback(null, true);
      return callback(new OriginDeniedError());
    },
    // Keep the existing method defaults and requested-header reflection for Web/mobile APIs.
    credentials: true,
  };
}
