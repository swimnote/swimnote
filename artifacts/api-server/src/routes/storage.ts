/**
 * 저장공간 사용량 API
 *
 * GET /teacher/me/storage   — 선생님 본인 카테고리별 사용량
 * GET /admin/storage        — 관리자: 풀 전체 총합 + 선생님별 사용량
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── 시스템 기본 저장 바이트 (계정당 고정) ─────────────────────
const SYSTEM_BASE_BYTES = 2048; // 2 KB per account

// ── poolId 조회 헬퍼 ──────────────────────────────────────────
async function getPoolId(userId: string): Promise<string | null> {
  const [r] = (await db.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1`)).rows as any[];
  return r?.swimming_pool_id ?? null;
}

// ── 특정 user + pool 기준 카테고리별 사용량 계산 ──────────────
async function calcUserStorage(userId: string, poolId: string) {
  // 사진 (student_photos)
  const [photoRow] = (await db.execute(sql`
    SELECT
      COALESCE(SUM(file_size_bytes), 0)::bigint AS bytes,
      COUNT(*)::int                             AS cnt
    FROM student_photos
    WHERE uploader_id = ${userId} AND swimming_pool_id = ${poolId}
  `)).rows as any[];

  // 영상 (student_videos)
  const [videoRow] = (await db.execute(sql`
    SELECT
      COALESCE(SUM(file_size_bytes), 0)::bigint AS bytes,
      COUNT(*)::int                             AS cnt
    FROM student_videos
    WHERE uploader_id = ${userId} AND swimming_pool_id = ${poolId}
  `)).rows as any[];

  // 메신저 (work_messages — 텍스트 byte 길이)
  const [msgRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(OCTET_LENGTH(COALESCE(content,''))), 0)::bigint AS bytes
    FROM work_messages
    WHERE sender_id = ${userId} AND pool_id = ${poolId}
  `)).rows as any[];

  // 수업일지 본문 (class_diaries)
  const [cdRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(OCTET_LENGTH(COALESCE(common_content,''))), 0)::bigint AS bytes
    FROM class_diaries
    WHERE teacher_id = ${userId} AND swimming_pool_id = ${poolId} AND is_deleted = false
  `)).rows as any[];

  // 수업일지 학생별 메모 (class_diary_student_notes joined by diary → teacher)
  const [cdnRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(OCTET_LENGTH(COALESCE(n.note_content,''))), 0)::bigint AS bytes
    FROM class_diary_student_notes n
    JOIN class_diaries d ON d.id = n.diary_id
    WHERE d.teacher_id = ${userId}
      AND d.swimming_pool_id = ${poolId}
      AND n.is_deleted = false
  `)).rows as any[];

  // 수영일지 (swim_diary — 여러 텍스트 필드)
  const [sdRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(
      OCTET_LENGTH(COALESCE(title,''))          +
      OCTET_LENGTH(COALESCE(lesson_content,'')) +
      OCTET_LENGTH(COALESCE(practice_goals,'')) +
      OCTET_LENGTH(COALESCE(good_points,''))    +
      OCTET_LENGTH(COALESCE(next_focus,''))
    ), 0)::bigint AS bytes
    FROM swim_diary
    WHERE author_id = ${userId} AND swimming_pool_id = ${poolId}
  `)).rows as any[];

  // 선생님 메모 (teacher_daily_memos)
  const [memoRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(OCTET_LENGTH(COALESCE(note_text,''))), 0)::bigint AS bytes
    FROM teacher_daily_memos
    WHERE teacher_id = ${userId} AND swimming_pool_id = ${poolId}
  `)).rows as any[];

  // 공지사항 (notices — 제목+본문)
  const [noticeRow] = (await db.execute(sql`
    SELECT COALESCE(SUM(
      OCTET_LENGTH(COALESCE(title,'')) +
      OCTET_LENGTH(COALESCE(content,''))
    ), 0)::bigint AS bytes
    FROM notices
    WHERE author_id = ${userId} AND swimming_pool_id = ${poolId}
  `)).rows as any[];

  const photo_bytes    = Number(photoRow?.bytes   ?? 0);
  const photo_count    = Number(photoRow?.cnt     ?? 0);
  const video_bytes    = Number(videoRow?.bytes   ?? 0);
  const video_count    = Number(videoRow?.cnt     ?? 0);
  const messenger_bytes = Number(msgRow?.bytes    ?? 0);
  const diary_bytes    = Number(cdRow?.bytes      ?? 0)
                       + Number(cdnRow?.bytes     ?? 0)
                       + Number(sdRow?.bytes      ?? 0)
                       + Number(memoRow?.bytes    ?? 0);
  const notice_bytes   = Number(noticeRow?.bytes  ?? 0);
  const system_bytes   = SYSTEM_BASE_BYTES;

  const total_bytes = photo_bytes + video_bytes + messenger_bytes + diary_bytes + notice_bytes + system_bytes;

  return {
    photo_bytes, photo_count,
    video_bytes, video_count,
    messenger_bytes,
    diary_bytes,
    notice_bytes,
    system_bytes,
    total_bytes,
  };
}

// ── 구독 쿼터 조회 헬퍼 ──────────────────────────────────────
async function getQuotaBytes(poolId: string): Promise<number> {
  const [sub] = (await db.execute(sql`
    SELECT ps.tier,
           COALESCE(ps.extra_storage_gb, 0) AS extra_gb,
           sp.storage_gb
    FROM pool_subscriptions ps
    LEFT JOIN subscription_plans sp ON sp.tier = ps.tier
    WHERE ps.swimming_pool_id = ${poolId} LIMIT 1
  `)).rows as any[];

  const baseGb  = Number(sub?.storage_gb  ?? 5);
  const extraGb = Number(sub?.extra_gb    ?? 0);
  return (baseGb + extraGb) * 1024 * 1024 * 1024;
}

// ════════════════════════════════════════════════════════════════
// GET /teacher/me/storage — 선생님 본인 사용량
// ════════════════════════════════════════════════════════════════
router.get(
  "/teacher/me/storage",
  requireAuth,
  requireRole("teacher", "pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.userId;
      const poolId = await getPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

      const [usage, quota_bytes] = await Promise.all([
        calcUserStorage(userId, poolId),
        getQuotaBytes(poolId),
      ]);

      res.json({ ...usage, quota_bytes });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /admin/storage — 관리자: 전체 총합 + 선생님별 사용량
// ════════════════════════════════════════════════════════════════
router.get(
  "/admin/storage",
  requireAuth,
  requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const adminId = req.user!.userId;
      const poolId  = await getPoolId(adminId);
      if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

      // 해당 풀의 관리자 + 선생님 계정 전체
      const staffRows = (await db.execute(sql`
        SELECT id, name, role
        FROM users
        WHERE swimming_pool_id = ${poolId}
          AND role IN ('pool_admin', 'teacher')
        ORDER BY
          CASE role WHEN 'pool_admin' THEN 0 ELSE 1 END,
          name
      `)).rows as Array<{ id: string; name: string; role: string }>;

      // 각 계정별 사용량 병렬 계산
      const perUser = await Promise.all(
        staffRows.map(async (u) => {
          const usage = await calcUserStorage(u.id, poolId);
          return { id: u.id, name: u.name, role: u.role, ...usage };
        })
      );

      // 풀 전체 합산
      const totals = perUser.reduce(
        (acc, u) => {
          acc.photo_bytes     += u.photo_bytes;
          acc.video_bytes     += u.video_bytes;
          acc.messenger_bytes += u.messenger_bytes;
          acc.diary_bytes     += u.diary_bytes;
          acc.notice_bytes    += u.notice_bytes;
          acc.system_bytes    += u.system_bytes;
          acc.total_bytes     += u.total_bytes;
          return acc;
        },
        { photo_bytes: 0, video_bytes: 0, messenger_bytes: 0,
          diary_bytes: 0, notice_bytes: 0, system_bytes: 0, total_bytes: 0 }
      );

      const quota_bytes = await getQuotaBytes(poolId);

      res.json({
        ...totals,
        quota_bytes,
        staff: perUser,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

export default router;
