/**
 * 플랫폼 인프라 상태 API (슈퍼관리자 전용)
 *
 * GET /super/infra-usage/summary    — 전체 요약 (4개 핵심 자원)
 * GET /super/infra-usage/super-db   — 슈퍼관리자 DB 상세
 * GET /super/infra-usage/pool-db    — 수영장 운영 DB 상세
 * GET /super/infra-usage/storage    — 사진/영상 저장소 상세
 */
import { Router } from "express";
import { superAdminDb, isDbSeparated, getBackupDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requirePermission, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
router.use(requireAuth, requirePermission("canViewPools"));

// ── 상수 ────────────────────────────────────────────────────────────────────
const SUPER_DB_LIMIT_MB = Number(process.env.SUPER_DB_LIMIT_MB ?? 500);
const POOL_DB_LIMIT_MB  = Number(process.env.POOL_DB_LIMIT_MB  ?? 500);
const PHOTO_LIMIT_MB    = Number(process.env.PHOTO_LIMIT_MB    ?? 1024);
const VIDEO_LIMIT_MB    = Number(process.env.VIDEO_LIMIT_MB    ?? 10240);

// ── 임계치 계산 ─────────────────────────────────────────────────────────────
function usageStatus(pct: number): string {
  if (pct >= 100) return "full";
  if (pct >= 90)  return "danger";
  if (pct >= 80)  return "warning";
  return "normal";
}

function usageStatusLabel(pct: number): string {
  if (pct >= 100) return "가득 참";
  if (pct >= 90)  return "위험";
  if (pct >= 80)  return "임박";
  return "정상";
}

function latencyStatus(ms: number): string {
  if (ms >= 1000) return "critical_delay";
  if (ms >= 300)  return "delay";
  return "normal";
}

function latencyStatusLabel(ms: number): string {
  if (ms >= 1000) return "심각 지연";
  if (ms >= 300)  return "지연";
  return "정상";
}

function mergeStatus(...statuses: string[]): string {
  if (statuses.some(s => s === "error" || s === "full" || s === "critical_delay")) return "error";
  if (statuses.some(s => s === "danger"))  return "danger";
  if (statuses.some(s => s === "warning" || s === "delay")) return "warning";
  return "normal";
}

function mergeStatusLabel(s: string): string {
  if (s === "error")   return "오류";
  if (s === "danger")  return "위험";
  if (s === "warning") return "임박";
  return "정상";
}

// ── 헬퍼: DB 핑 + 응답속도 ──────────────────────────────────────────────────
async function pingDb(dbConn: typeof superAdminDb) {
  const t0 = Date.now();
  try {
    await dbConn.execute(sql`SELECT 1`);
    return { ok: true, latency_ms: Date.now() - t0, error: null };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, error: String(e) };
  }
}

// ── 헬퍼: DB 전체 크기 조회 ──────────────────────────────────────────────────
async function getDbSize(dbConn: typeof superAdminDb): Promise<{ used_mb: number; error: string | null }> {
  try {
    const [row] = (await dbConn.execute(sql`
      SELECT pg_database_size(current_database())::bigint AS bytes
    `)).rows as any[];
    const bytes = Number(row?.bytes ?? 0);
    return { used_mb: Math.round(bytes / 1024 / 1024 * 10) / 10, error: null };
  } catch (e) {
    return { used_mb: 0, error: String(e) };
  }
}

// ── 헬퍼: super DB 운영 카운트 ───────────────────────────────────────────────
async function getSuperDbCounts() {
  try {
    const [row] = (await superAdminDb.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users)         AS user_count,
        (SELECT COUNT(*)::int FROM swimming_pools) AS pool_count,
        (SELECT COUNT(*)::int FROM subscriptions)  AS subscription_count,
        (SELECT COUNT(*)::int FROM information_schema.tables
          WHERE table_schema = 'public')           AS table_count
    `)).rows as any[];

    let revenue_log_count = 0;
    try {
      const [r2] = (await superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM revenue_logs
      `)).rows as any[];
      revenue_log_count = Number(r2?.cnt ?? 0);
    } catch {}

    let pool_event_log_count = 0;
    try {
      const [r3] = (await superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM pool_event_logs
      `)).rows as any[];
      pool_event_log_count = Number(r3?.cnt ?? 0);
    } catch {}

    return {
      table_count:        Number(row?.table_count        ?? 0),
      user_count:         Number(row?.user_count         ?? 0),
      pool_count:         Number(row?.pool_count         ?? 0),
      subscription_count: Number(row?.subscription_count ?? 0),
      revenue_log_count,
      pool_event_log_count,
    };
  } catch (e) {
    return { table_count: 0, user_count: 0, pool_count: 0, subscription_count: 0, revenue_log_count: 0, pool_event_log_count: 0, error: String(e) };
  }
}

// ── 헬퍼: pool DB 운영 카운트 (superAdminDb 단독 사용) ──────────────────────
async function getPoolDbCounts() {
  const targetDb = superAdminDb;
  try {
    const results: Record<string, number> = {};
    const tables = [
      ["students",             "student_count"],
      ["class_groups",         "class_count"],
      ["attendance",           "attendance_count"],
      ["class_diaries",        "journal_count"],
      ["photo_assets_meta",    "photo_meta_count"],
      ["video_assets_meta",    "video_meta_count"],
    ] as const;

    for (const [table, key] of tables) {
      try {
        const [r] = (await targetDb.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM ${table}`))).rows as any[];
        results[key] = Number(r?.cnt ?? 0);
      } catch {
        results[key] = 0;
      }
    }

    let parent_count = 0;
    let teacher_count = 0;
    try {
      const [pr] = (await targetDb.execute(sql`SELECT COUNT(*)::int AS cnt FROM parent_accounts`)).rows as any[];
      parent_count = Number(pr?.cnt ?? 0);
    } catch {
      try {
        const [pr2] = (await superAdminDb.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM users WHERE 'parent' = ANY(roles)
        `)).rows as any[];
        parent_count = Number(pr2?.cnt ?? 0);
      } catch {}
    }
    try {
      const [tr] = (await superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM users WHERE 'teacher' = ANY(roles)
      `)).rows as any[];
      teacher_count = Number(tr?.cnt ?? 0);
    } catch {}

    return { ...results, parent_count, teacher_count };
  } catch (e) {
    return {
      student_count: 0, parent_count: 0, teacher_count: 0,
      class_count: 0, attendance_count: 0, journal_count: 0,
      photo_meta_count: 0, video_meta_count: 0, error: String(e)
    };
  }
}

// ── 헬퍼: 사진 저장소 집계 ───────────────────────────────────────────────────
async function getPhotoStorageStats() {
  try {
    const [row] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*)::int                                AS file_count,
        COALESCE(SUM(file_size), 0)::bigint          AS total_bytes,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS upload_count_24h,
        COUNT(*) FILTER (WHERE status = 'deleted' AND created_at >= NOW() - INTERVAL '24 hours')::int AS delete_count_24h
      FROM photo_assets_meta
    `)).rows as any[];
    const total_bytes = Number(row?.total_bytes ?? 0);
    return {
      file_count:       Number(row?.file_count       ?? 0),
      used_mb:          Math.round(total_bytes / 1024 / 1024 * 10) / 10,
      upload_count_24h: Number(row?.upload_count_24h ?? 0),
      delete_count_24h: Number(row?.delete_count_24h ?? 0),
      error: null,
    };
  } catch (e) {
    return { file_count: 0, used_mb: 0, upload_count_24h: 0, delete_count_24h: 0, error: String(e) };
  }
}

// ── 헬퍼: 영상 저장소 집계 ───────────────────────────────────────────────────
async function getVideoStorageStats() {
  try {
    const [row] = (await superAdminDb.execute(sql`
      SELECT
        COUNT(*)::int                                AS file_count,
        COALESCE(SUM(file_size), 0)::bigint          AS total_bytes,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS upload_count_24h
      FROM video_assets_meta
    `)).rows as any[];
    const total_bytes = Number(row?.total_bytes ?? 0);

    let enabled_pool_count = 0;
    try {
      const [ep] = (await superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools
        WHERE video_storage_limit_mb > 0
      `)).rows as any[];
      enabled_pool_count = Number(ep?.cnt ?? 0);
    } catch {}

    return {
      file_count:         Number(row?.file_count   ?? 0),
      used_mb:            Math.round(total_bytes / 1024 / 1024 * 10) / 10,
      upload_count_24h:   Number(row?.upload_count_24h ?? 0),
      enabled_pool_count,
      error: null,
    };
  } catch (e) {
    return { file_count: 0, used_mb: 0, upload_count_24h: 0, enabled_pool_count: 0, error: String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /super/infra-usage/summary
// ═══════════════════════════════════════════════════════════════════════════
router.get("/summary", async (_req: AuthRequest, res) => {
  try {
    const now = new Date().toISOString();

    const [superPing, poolPing, superSize, poolSize, photoStats, videoStats, superCounts] = await Promise.all([
      pingDb(superAdminDb),
      pingDb(superAdminDb),
      getDbSize(superAdminDb),
      getDbSize(superAdminDb),
      getPhotoStorageStats(),
      getVideoStorageStats(),
      getSuperDbCounts(),
    ]);

    const superPct  = superSize.used_mb  / SUPER_DB_LIMIT_MB  * 100;
    const poolPct   = poolSize.used_mb   / POOL_DB_LIMIT_MB   * 100;
    const photoPct  = photoStats.used_mb / PHOTO_LIMIT_MB     * 100;
    const videoPct  = videoStats.used_mb / VIDEO_LIMIT_MB     * 100;

    const superSt  = mergeStatus(usageStatus(superPct),  latencyStatus(superPing.latency_ms));
    const poolSt   = mergeStatus(usageStatus(poolPct),   latencyStatus(poolPing.latency_ms));
    const photoSt  = photoStats.error ? "error" : usageStatus(photoPct);
    const videoSt  = videoStats.error ? "error" : usageStatus(videoPct);

    const allStatuses = [superSt, poolSt, photoSt, videoSt];
    const ok_count      = allStatuses.filter(s => s === "normal").length;
    const warning_count = allStatuses.filter(s => s === "warning" || s === "delay").length;
    const error_count   = allStatuses.filter(s => s === "error" || s === "danger" || s === "full" || s === "critical_delay").length;

    res.json({
      checked_at: now,
      totals: { ok_count, warning_count, error_count },
      super_db: {
        status:       superSt,
        status_label: mergeStatusLabel(superSt),
        used_mb:      superSize.used_mb,
        limit_mb:     SUPER_DB_LIMIT_MB,
        usage_percent: Math.round(superPct * 10) / 10,
        latency_ms:   superPing.latency_ms,
        table_count:  superCounts.table_count,
        last_checked_at: now,
      },
      pool_db: {
        status:       poolSt,
        status_label: mergeStatusLabel(poolSt),
        used_mb:      poolSize.used_mb,
        limit_mb:     POOL_DB_LIMIT_MB,
        usage_percent: Math.round(poolPct * 10) / 10,
        latency_ms:   poolPing.latency_ms,
        last_checked_at: now,
      },
      photo_storage: {
        status:       photoSt,
        status_label: usageStatusLabel(photoPct),
        used_mb:      photoStats.used_mb,
        limit_mb:     PHOTO_LIMIT_MB,
        usage_percent: Math.round(photoPct * 10) / 10,
        file_count:   photoStats.file_count,
        last_checked_at: now,
      },
      video_storage: {
        status:       videoSt,
        status_label: usageStatusLabel(videoPct),
        used_mb:      videoStats.used_mb,
        limit_mb:     VIDEO_LIMIT_MB,
        usage_percent: Math.round(videoPct * 10) / 10,
        file_count:   videoStats.file_count,
        enabled_pool_count: videoStats.enabled_pool_count,
        last_checked_at: now,
      },
    });
  } catch (err) {
    console.error("[infra-usage/summary]", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /super/infra-usage/super-db
// ═══════════════════════════════════════════════════════════════════════════
router.get("/super-db", async (_req: AuthRequest, res) => {
  try {
    const now = new Date().toISOString();
    const [ping, size, counts] = await Promise.all([
      pingDb(superAdminDb),
      getDbSize(superAdminDb),
      getSuperDbCounts(),
    ]);

    const usage_percent = Math.round(size.used_mb / SUPER_DB_LIMIT_MB * 100 * 10) / 10;
    const capSt  = usageStatus(usage_percent);
    const latSt  = latencyStatus(ping.latency_ms);
    const status = mergeStatus(capSt, latSt, ping.ok ? "normal" : "error");

    const recent_errors: string[] = [];
    if (!ping.ok)         recent_errors.push(`DB 응답 실패: ${ping.error}`);
    if (size.error)       recent_errors.push(`크기 조회 실패: ${size.error}`);
    if ((counts as any).error) recent_errors.push(`카운트 조회 실패: ${(counts as any).error}`);

    res.json({
      service_key:  "super_db",
      label:        "슈퍼관리자 DB",
      status,
      status_label: mergeStatusLabel(status),
      message:      ping.ok
        ? `응답 ${ping.latency_ms}ms · 사용률 ${usage_percent}%`
        : "DB 연결 실패",
      region:       "ap-south-1 (Supabase)",
      latency_ms: {
        current:  ping.latency_ms,
        avg_1h:   null,
        max_24h:  null,
      },
      usage: {
        used_mb:       size.used_mb,
        limit_mb:      SUPER_DB_LIMIT_MB,
        usage_percent,
      },
      counts: {
        table_count:        counts.table_count,
        user_count:         counts.user_count,
        pool_count:         counts.pool_count,
        subscription_count: counts.subscription_count,
        revenue_log_count:  counts.revenue_log_count,
        pool_event_log_count: counts.pool_event_log_count,
      },
      health: {
        recent_error_count:   recent_errors.length,
        recent_warning_count: 0,
        last_success_at:      ping.ok ? now : null,
        last_failure_at:      ping.ok ? null : now,
      },
      recent_errors,
      thresholds: {
        warning_percent: 80,
        danger_percent:  90,
        critical_percent: 100,
      },
      checked_at: now,
    });
  } catch (err) {
    console.error("[infra-usage/super-db]", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /super/infra-usage/pool-db
// ═══════════════════════════════════════════════════════════════════════════
router.get("/pool-db", async (_req: AuthRequest, res) => {
  try {
    const now = new Date().toISOString();
    const backupDb = getBackupDb();

    if (!isDbSeparated || !backupDb) {
      return res.json({
        ok: true,
        timestamp: now,
        status: "not_configured",
        note: "백업 DB(POOL_DATABASE_URL) 미설정 — 단일 DB 아키텍처 운영 중",
        is_separated: false,
      });
    }

    const [ping, size, counts] = await Promise.all([
      pingDb(backupDb),
      getDbSize(backupDb),
      getPoolDbCounts(),
    ]);

    const usage_percent = Math.round(size.used_mb / POOL_DB_LIMIT_MB * 100 * 10) / 10;
    const capSt  = usageStatus(usage_percent);
    const latSt  = latencyStatus(ping.latency_ms);
    const status = mergeStatus(capSt, latSt, ping.ok ? "normal" : "error");

    const recent_errors: string[] = [];
    if (!ping.ok)   recent_errors.push(`DB 응답 실패: ${ping.error}`);
    if (size.error) recent_errors.push(`크기 조회 실패: ${size.error}`);

    res.json({
      service_key:  "pool_db",
      label:        "수영장 운영 DB",
      status,
      status_label: mergeStatusLabel(status),
      message:      ping.ok
        ? `응답 ${ping.latency_ms}ms · 사용률 ${usage_percent}%`
        : "DB 연결 실패",
      region:       "ap-northeast-2 (Supabase)",
      latency_ms: {
        current:  ping.latency_ms,
        avg_1h:   null,
        max_24h:  null,
      },
      usage: {
        used_mb:       size.used_mb,
        limit_mb:      POOL_DB_LIMIT_MB,
        usage_percent,
      },
      counts: {
        student_count:    (counts as any).student_count    ?? 0,
        parent_count:     (counts as any).parent_count     ?? 0,
        teacher_count:    (counts as any).teacher_count    ?? 0,
        class_count:      (counts as any).class_count      ?? 0,
        attendance_count: (counts as any).attendance_count ?? 0,
        journal_count:    (counts as any).journal_count    ?? 0,
        photo_meta_count: (counts as any).photo_meta_count ?? 0,
        video_meta_count: (counts as any).video_meta_count ?? 0,
      },
      health: {
        recent_error_count:   recent_errors.length,
        recent_warning_count: 0,
        last_success_at:      ping.ok ? now : null,
        last_failure_at:      ping.ok ? null : now,
      },
      recent_errors,
      thresholds: {
        warning_percent: 80,
        danger_percent:  90,
        critical_percent: 100,
      },
      checked_at: now,
    });
  } catch (err) {
    console.error("[infra-usage/pool-db]", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /super/infra-usage/storage
// ═══════════════════════════════════════════════════════════════════════════
router.get("/storage", async (_req: AuthRequest, res) => {
  try {
    const now = new Date().toISOString();
    const [photoStats, videoStats] = await Promise.all([
      getPhotoStorageStats(),
      getVideoStorageStats(),
    ]);

    const photoPct = Math.round(photoStats.used_mb / PHOTO_LIMIT_MB * 100 * 10) / 10;
    const videoPct = Math.round(videoStats.used_mb / VIDEO_LIMIT_MB * 100 * 10) / 10;

    const photoStatus = photoStats.error ? "error" : usageStatus(photoPct);
    const videoStatus = videoStats.error ? "error" : usageStatus(videoPct);

    res.json({
      checked_at: now,
      photo_storage: {
        service_key:  "photo_storage",
        label:        "사진 저장소",
        status:       photoStatus,
        status_label: photoStats.error ? "오류" : usageStatusLabel(photoPct),
        message:      photoStats.error
          ? `조회 오류: ${photoStats.error}`
          : `파일 ${photoStats.file_count}개 · 사용률 ${photoPct}%`,
        provider:     "Cloudflare R2",
        bucket_name:  process.env.R2_PHOTO_BUCKET ?? "swimnote-photos",
        usage: {
          used_mb:       photoStats.used_mb,
          limit_mb:      PHOTO_LIMIT_MB,
          usage_percent: photoPct,
        },
        counts: {
          file_count:            photoStats.file_count,
          upload_count_24h:      photoStats.upload_count_24h,
          delete_count_24h:      photoStats.delete_count_24h,
          failed_upload_count_24h: null,
        },
        performance: {
          avg_upload_ms: null,
          max_upload_ms: null,
        },
        health: {
          recent_error_count: photoStats.error ? 1 : 0,
          last_success_at:    photoStats.error ? null : now,
          last_failure_at:    photoStats.error ? now  : null,
        },
        thresholds: {
          warning_percent: 80,
          danger_percent:  90,
          critical_percent: 100,
        },
      },
      video_storage: {
        service_key:  "video_storage",
        label:        "영상 저장소",
        status:       videoStatus,
        status_label: videoStats.error ? "오류" : usageStatusLabel(videoPct),
        message:      videoStats.error
          ? `조회 오류: ${videoStats.error}`
          : videoStats.enabled_pool_count === 0
          ? "비활성 — 유료 플랜 활성 수영장 없음"
          : `파일 ${videoStats.file_count}개 · 활성 수영장 ${videoStats.enabled_pool_count}개`,
        provider:     "Cloudflare R2",
        bucket_name:  process.env.R2_VIDEO_BUCKET ?? "swimnote-videos",
        feature_status: videoStats.enabled_pool_count > 0 ? "active" : "inactive",
        usage: {
          used_mb:       videoStats.used_mb,
          limit_mb:      VIDEO_LIMIT_MB,
          usage_percent: videoPct,
        },
        counts: {
          file_count:              videoStats.file_count,
          enabled_pool_count:      videoStats.enabled_pool_count,
          upload_count_24h:        videoStats.upload_count_24h,
          failed_upload_count_24h: null,
        },
        health: {
          recent_error_count: videoStats.error ? 1 : 0,
          last_success_at:    videoStats.error ? null : now,
          last_failure_at:    videoStats.error ? now  : null,
        },
        thresholds: {
          warning_percent: 80,
          danger_percent:  90,
          critical_percent: 100,
        },
      },
    });
  } catch (err) {
    console.error("[infra-usage/storage]", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
