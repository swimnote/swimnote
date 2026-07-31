/**
 * app-version.ts — 앱 버전 정책 API
 *
 * Public:
 *   GET /app-version-policy?platform=ios|android
 *   GET /app-version  (하위 호환 유지)
 *
 * 동작:
 * - DB `app_version_policy` 테이블에서 읽음
 * - 테이블 없거나 레코드 없으면 하드코딩 기본값 반환
 * - 서버 장애가 앱 전체 차단으로 이어지지 않도록 항상 응답 반환
 */
import { Router } from "express";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ── 기본값 (DB에 정책이 없을 때 폴백) ────────────────────────────
const DEFAULTS = {
  ios: {
    minimum_supported_version: "1.5.6",
    latest_version:            "1.5.6",
    force_update:              false,
    store_url:   "https://apps.apple.com/kr/app/%EC%8A%A4%EC%9C%94%EB%85%B8%ED%8A%B8/id6761360360",
    message:     "안정적인 서비스 이용을 위해 최신 버전으로 업데이트해 주세요.",
    ota_required: false,
  },
  android: {
    minimum_supported_version: "1.5.6",
    latest_version:            "1.5.6",
    force_update:              false,
    store_url:   "https://play.google.com/store/apps/details?id=com.swimnote.app",
    message:     "안정적인 서비스 이용을 위해 최신 버전으로 업데이트해 주세요.",
    ota_required: false,
  },
} as const;

// ── DB 테이블 초기화 (lazy, 최초 요청 시 1회) ────────────────────
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  try {
    await superAdminDb.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS app_version_policy (
        platform                  TEXT PRIMARY KEY,
        minimum_supported_version TEXT NOT NULL DEFAULT '1.5.6',
        latest_version            TEXT NOT NULL DEFAULT '1.5.6',
        force_update              BOOLEAN NOT NULL DEFAULT FALSE,
        store_url                 TEXT NOT NULL DEFAULT '',
        message                   TEXT NOT NULL DEFAULT '',
        ota_required              BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by                TEXT
      )
    `));

    // 기본값 시드 (레코드 없을 때만)
    for (const [platform, d] of Object.entries(DEFAULTS)) {
      await superAdminDb.execute(sql.raw(`
        INSERT INTO app_version_policy (platform, minimum_supported_version, latest_version, force_update, store_url, message, ota_required)
        VALUES ('${platform}', '${d.minimum_supported_version}', '${d.latest_version}', ${d.force_update}, '${d.store_url}', '${d.message}', ${d.ota_required})
        ON CONFLICT (platform) DO NOTHING
      `));
    }
    tableReady = true;
  } catch (e: any) {
    console.warn("[app-version-policy] 테이블 초기화 실패 (기본값 사용):", e.message);
  }
}

// ── 정책 읽기 헬퍼 ─────────────────────────────────────────────
async function readPolicy(platform: "ios" | "android") {
  try {
    await ensureTable();
    const rows = await superAdminDb.execute(sql.raw(
      `SELECT * FROM app_version_policy WHERE platform = '${platform}' LIMIT 1`
    ));
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    if (row) return row;
  } catch (e: any) {
    console.warn("[app-version-policy] DB 읽기 실패, 기본값 반환:", e.message);
  }
  return DEFAULTS[platform];
}

// ══════════════════════════════════════════════════════════════
// GET /app-version-policy?platform=ios|android
// 인증 불필요 — 앱 시작 시 호출
// ══════════════════════════════════════════════════════════════
router.get("/app-version-policy", async (req, res) => {
  const platform = (req.query.platform as string) === "android" ? "android" : "ios";
  try {
    const policy = await readPolicy(platform);
    res.json({
      platform,
      minimum_supported_version: policy.minimum_supported_version ?? DEFAULTS[platform].minimum_supported_version,
      latest_version:            policy.latest_version            ?? DEFAULTS[platform].latest_version,
      force_update:              policy.force_update              ?? DEFAULTS[platform].force_update,
      store_url:                 policy.store_url                 ?? DEFAULTS[platform].store_url,
      message:                   policy.message                   ?? DEFAULTS[platform].message,
      ota_required:              policy.ota_required              ?? DEFAULTS[platform].ota_required,
      updated_at:                policy.updated_at                ?? new Date().toISOString(),
    });
  } catch (e: any) {
    // 서버 장애 시에도 기본값 응답 — 절대 앱 차단 금지
    console.error("[app-version-policy] 예외:", e.message);
    const d = DEFAULTS[platform];
    res.json({ platform, ...d, updated_at: new Date().toISOString() });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /app-version  (하위 호환 — 기존 포맷 유지)
// ══════════════════════════════════════════════════════════════
router.get("/app-version", async (_req, res) => {
  try {
    const [ios, android] = await Promise.all([readPolicy("ios"), readPolicy("android")]);
    res.json({
      ios:     { min_version: ios.minimum_supported_version,     latest_version: ios.latest_version },
      android: { min_version: android.minimum_supported_version, latest_version: android.latest_version },
      store_urls: { ios: ios.store_url, android: android.store_url },
    });
  } catch {
    res.json({
      ios:     { min_version: DEFAULTS.ios.minimum_supported_version,     latest_version: DEFAULTS.ios.latest_version },
      android: { min_version: DEFAULTS.android.minimum_supported_version, latest_version: DEFAULTS.android.latest_version },
      store_urls: { ios: DEFAULTS.ios.store_url, android: DEFAULTS.android.store_url },
    });
  }
});

export default router;
