/**
 * 킬 스위치 (영구 삭제 도구) + 이벤트 로그 조회
 *
 * POST /admin/kill-switch/preview  — 삭제 대상 미리보기 (개수/용량)
 * POST /admin/kill-switch/execute  — 비밀번호 인증 후 영구 삭제 + 로그
 * GET  /admin/event-logs           — 이벤트 기록 타임라인 조회
 */
import { Router } from "express";
import { db, superAdminDb , superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Client } from "@replit/object-storage";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { comparePassword } from "../lib/auth.js";
import { logEvent } from "../lib/event-logger.js";

const router = Router();

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });
  return _client;
}

async function getPoolId(userId: string): Promise<string | null> {
  const [r] = (await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1`)).rows as any[];
  return r?.swimming_pool_id ?? null;
}

function cutoffDate(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

// ════════════════════════════════════════════════════════════════
// POST /admin/kill-switch/preview
// Body: { months: number, types: ("photo"|"video"|"record")[] }
// ════════════════════════════════════════════════════════════════
router.post(
  "/admin/kill-switch/preview",
  requireAuth,
  requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { months, types } = req.body as { months: number; types: string[] };
      if (!months || months < 1 || !Array.isArray(types) || types.length === 0) {
        res.status(400).json({ error: "기간(개월)과 데이터 종류를 선택해주세요." }); return;
      }

      const poolId = await getPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "수영장 정보 없음" }); return; }

      const cutoff = cutoffDate(months);
      const result: Record<string, number> = {
        photo_count: 0, photo_bytes: 0,
        video_count: 0, video_bytes: 0,
        record_count: 0, record_bytes: 0,
      };

      if (types.includes("photo")) {
        const [r] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt, COALESCE(SUM(file_size_bytes),0)::bigint AS bytes
          FROM student_photos
          WHERE swimming_pool_id = ${poolId} AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        result.photo_count = Number(r?.cnt ?? 0);
        result.photo_bytes = Number(r?.bytes ?? 0);
      }

      if (types.includes("video")) {
        const [r] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt, COALESCE(SUM(file_size_bytes),0)::bigint AS bytes
          FROM student_videos
          WHERE swimming_pool_id = ${poolId} AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        result.video_count = Number(r?.cnt ?? 0);
        result.video_bytes = Number(r?.bytes ?? 0);
      }

      if (types.includes("record")) {
        const [cd] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt,
                 COALESCE(SUM(OCTET_LENGTH(COALESCE(common_content,''))),0)::bigint AS bytes
          FROM class_diaries
          WHERE swimming_pool_id = ${poolId}
            AND is_deleted = false
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        const [sd] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt,
                 COALESCE(SUM(
                   OCTET_LENGTH(COALESCE(title,'')) +
                   OCTET_LENGTH(COALESCE(lesson_content,'')) +
                   OCTET_LENGTH(COALESCE(practice_goals,'')) +
                   OCTET_LENGTH(COALESCE(good_points,'')) +
                   OCTET_LENGTH(COALESCE(next_focus,''))
                 ),0)::bigint AS bytes
          FROM swim_diary
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        const [tm] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt,
                 COALESCE(SUM(OCTET_LENGTH(COALESCE(note_text,''))),0)::bigint AS bytes
          FROM teacher_daily_memos
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        result.record_count = Number(cd?.cnt ?? 0) + Number(sd?.cnt ?? 0) + Number(tm?.cnt ?? 0);
        result.record_bytes = Number(cd?.bytes ?? 0) + Number(sd?.bytes ?? 0) + Number(tm?.bytes ?? 0);
      }

      result.total_bytes = result.photo_bytes + result.video_bytes + result.record_bytes;
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /admin/kill-switch/execute
// Body: { months, types, password }
// ════════════════════════════════════════════════════════════════
router.post(
  "/admin/kill-switch/execute",
  requireAuth,
  requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { months, types, password } = req.body as {
        months: number; types: string[]; password: string;
      };

      if (!months || months < 1 || !Array.isArray(types) || types.length === 0) {
        res.status(400).json({ error: "기간과 데이터 종류를 선택해주세요." }); return;
      }
      if (!password) {
        res.status(400).json({ error: "비밀번호를 입력해주세요." }); return;
      }

      const userId = req.user!.userId;
      const poolId = await getPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "수영장 정보 없음" }); return; }

      // 관리자 비밀번호 검증
      const [userRow] = (await superAdminDb.execute(sql`
        SELECT password_hash, name FROM users WHERE id = ${userId} LIMIT 1
      `)).rows as any[];
      if (!userRow) { res.status(403).json({ error: "사용자 정보 없음" }); return; }

      const valid = await comparePassword(password, userRow.password_hash);
      if (!valid) {
        res.status(401).json({ error: "비밀번호가 일치하지 않습니다." }); return;
      }

      const actorName = userRow.name || "관리자";
      const cutoff = cutoffDate(months);

      const deleted = {
        photo_count: 0, photo_bytes: 0,
        video_count: 0, video_bytes: 0,
        record_count: 0, record_bytes: 0,
      };

      // ── 사진 영구 삭제 ───────────────────────────────────────
      if (types.includes("photo")) {
        const photos = (await db.execute(sql`
          SELECT id, storage_key, file_size_bytes
          FROM student_photos
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];

        const client = getClient();
        for (const p of photos) {
          await client.delete(p.storage_key).catch(() => {});
          deleted.photo_bytes += Number(p.file_size_bytes ?? 0);
        }
        if (photos.length > 0) {
          const ids = photos.map(p => p.id);
          await db.execute(sql`
            DELETE FROM student_photos WHERE id = ANY(${ids}::text[])
          `);
        }
        deleted.photo_count = photos.length;
      }

      // ── 영상 영구 삭제 ───────────────────────────────────────
      if (types.includes("video")) {
        const videos = (await db.execute(sql`
          SELECT id, storage_key, file_size_bytes
          FROM student_videos
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];

        const client = getClient();
        for (const v of videos) {
          await client.delete(v.storage_key).catch(() => {});
          deleted.video_bytes += Number(v.file_size_bytes ?? 0);
        }
        if (videos.length > 0) {
          const ids = videos.map(v => v.id);
          await db.execute(sql`
            DELETE FROM student_videos WHERE id = ANY(${ids}::text[])
          `);
        }
        deleted.video_count = videos.length;
      }

      // ── 수업기록 영구 삭제 ──────────────────────────────────
      if (types.includes("record")) {
        // class_diaries + student_notes
        const diaries = (await db.execute(sql`
          SELECT id FROM class_diaries
          WHERE swimming_pool_id = ${poolId}
            AND is_deleted = false
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        const diaryIds = diaries.map(d => d.id);
        if (diaryIds.length > 0) {
          await db.execute(sql`
            DELETE FROM class_diary_student_notes WHERE diary_id = ANY(${diaryIds}::text[])
          `);
          await db.execute(sql`
            DELETE FROM class_diaries WHERE id = ANY(${diaryIds}::text[])
          `);
        }

        // swim_diary
        const [sdR] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM swim_diary
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        await db.execute(sql`
          DELETE FROM swim_diary
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `);

        // teacher_daily_memos
        const [tmR] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM teacher_daily_memos
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `)).rows as any[];
        await db.execute(sql`
          DELETE FROM teacher_daily_memos
          WHERE swimming_pool_id = ${poolId}
            AND created_at < ${cutoff.toISOString()}::timestamptz
        `);

        deleted.record_count = diaryIds.length + Number(sdR?.cnt ?? 0) + Number(tmR?.cnt ?? 0);
      }

      const totalBytes = deleted.photo_bytes + deleted.video_bytes + deleted.record_count;
      const typeLabels = types.map(t =>
        t === "photo" ? "사진" : t === "video" ? "영상" : "수업기록"
      ).join(" + ");

      // ── 이벤트 로그 기록 ────────────────────────────────────
      await logEvent({
        pool_id: poolId,
        category: "삭제",
        actor_id: userId,
        actor_name: actorName,
        target: typeLabels,
        description: `${months}개월 이상 ${typeLabels} ${deleted.photo_count + deleted.video_count + deleted.record_count}개 삭제, ${fmtBytes(deleted.photo_bytes + deleted.video_bytes)} 절감`,
        metadata: {
          months,
          types,
          photo_count: deleted.photo_count,
          photo_bytes: deleted.photo_bytes,
          video_count: deleted.video_count,
          video_bytes: deleted.video_bytes,
          record_count: deleted.record_count,
          cutoff: cutoff.toISOString(),
        },
      });

      res.json({
        success: true,
        ...deleted,
        total_bytes: deleted.photo_bytes + deleted.video_bytes,
        message: `${deleted.photo_count + deleted.video_count + deleted.record_count}건 영구 삭제 완료`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /admin/event-logs?category=&limit=30&offset=0
// ════════════════════════════════════════════════════════════════
router.get(
  "/admin/event-logs",
  requireAuth,
  requireRole("pool_admin", "super_admin", "sub_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getPoolId(req.user!.userId);
      if (!poolId) { res.status(403).json({ error: "수영장 정보 없음" }); return; }

      const { category, limit = "50", offset = "0" } = req.query as any;
      const lim = Math.min(Number(limit) || 50, 100);
      const off = Number(offset) || 0;

      let rows: any[];
      if (category && category !== "전체") {
        rows = (await db.execute(sql`
          SELECT id, category, actor_id, actor_name, target, description, metadata, created_at
          FROM event_logs
          WHERE pool_id = ${poolId} AND category = ${category}
          ORDER BY created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `)).rows;
      } else {
        rows = (await db.execute(sql`
          SELECT id, category, actor_id, actor_name, target, description, metadata, created_at
          FROM event_logs
          WHERE pool_id = ${poolId}
          ORDER BY created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `)).rows;
      }

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default router;
