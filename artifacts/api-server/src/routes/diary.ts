/**
 * diary.ts — 수영일지 API
 *
 * 테이블: swim_diary
 * 컬럼: id, student_id(null), swimming_pool_id, author_id, author_name,
 *       created_at, title, lesson_content, practice_goals, good_points,
 *       next_focus, image_urls(jsonb), class_group_id
 *
 * 접근 권한:
 *   teacher      → 자신의 담당 반에만 작성/조회
 *   pool_admin   → 자기 풀 내 모든 반
 *   super_admin  → 전체
 *   parent_account → /parent 라우트에서 별도 처리
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getUserPoolId(userId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

async function getUserName(userId: string): Promise<string> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.name || userId;
}

async function teacherOwnsClass(teacherUserId: string, classId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM class_groups WHERE id = ${classId} AND teacher_user_id = ${teacherUserId}
  `);
  return rows.rows.length > 0;
}

// ── GET /diary ─────────────────────────────────────────────────────────
// ?date=YYYY-MM-DD   → 해당 날짜의 일지 목록 (WeeklySchedule 도트 표시용)
// ?class_group_id=ID → 특정 반의 전체 일지 목록 (내림차순)
router.get("/diary", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { date, class_group_id } = req.query as Record<string, string>;
    const { role, userId } = req.user!;

    const poolId = await getUserPoolId(userId);
    if (!poolId && role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    if (class_group_id) {
      // 특정 반의 일지 목록
      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, class_group_id);
        if (!ok) return err(res, 403, "담당 반이 아닙니다.");
      } else if (role === "pool_admin") {
        const classRows = await db.execute(sql`
          SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId}
        `);
        if (!classRows.rows.length) return err(res, 403, "접근 권한이 없습니다.");
      }

      const rows = await db.execute(sql`
        SELECT id, class_group_id, swimming_pool_id, author_id, author_name,
               title, lesson_content, practice_goals, good_points, next_focus,
               image_urls, created_at
        FROM swim_diary
        WHERE class_group_id = ${class_group_id}
        ORDER BY created_at DESC
      `);
      return res.json(rows.rows);
    }

    if (date) {
      // 날짜 기준 일지 (WeeklySchedule 상태 도트 표시용)
      let rows;
      if (role === "teacher") {
        // 선생님 담당 반의 일지만
        rows = await db.execute(sql`
          SELECT sd.id, sd.class_group_id, sd.title, sd.created_at
          FROM swim_diary sd
          JOIN class_groups cg ON cg.id = sd.class_group_id
          WHERE sd.swimming_pool_id = ${poolId}
            AND cg.teacher_user_id = ${userId}
            AND DATE(sd.created_at) = ${date}::date
          ORDER BY sd.created_at DESC
        `);
      } else if (role === "pool_admin") {
        rows = await db.execute(sql`
          SELECT id, class_group_id, title, created_at
          FROM swim_diary
          WHERE swimming_pool_id = ${poolId}
            AND DATE(created_at) = ${date}::date
          ORDER BY created_at DESC
        `);
      } else {
        rows = await db.execute(sql`
          SELECT id, class_group_id, title, created_at
          FROM swim_diary
          WHERE DATE(created_at) = ${date}::date
          ORDER BY created_at DESC
        `);
      }
      return res.json(rows.rows);
    }

    // 기본: 선생님 담당 반 전체 일지, pool_admin은 풀 전체
    if (role === "teacher") {
      const rows = await db.execute(sql`
        SELECT sd.id, sd.class_group_id, sd.title, sd.lesson_content, sd.next_focus,
               sd.author_name, sd.created_at
        FROM swim_diary sd
        JOIN class_groups cg ON cg.id = sd.class_group_id
        WHERE sd.swimming_pool_id = ${poolId}
          AND cg.teacher_user_id = ${userId}
        ORDER BY sd.created_at DESC
        LIMIT 50
      `);
      return res.json(rows.rows);
    }

    const rows = await db.execute(sql`
      SELECT id, class_group_id, title, lesson_content, next_focus, author_name, created_at
      FROM swim_diary
      WHERE swimming_pool_id = ${poolId}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    return res.json(rows.rows);
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST /diary ────────────────────────────────────────────────────────
// body: { title, lesson_content?, next_focus?, class_group_ids: string[] }
router.post("/diary", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { title, lesson_content, next_focus, practice_goals, good_points, class_group_ids } = req.body;
    if (!title?.trim()) return err(res, 400, "제목을 입력해주세요.");

    const classIds: string[] = Array.isArray(class_group_ids) ? class_group_ids : [];
    if (classIds.length === 0) return err(res, 400, "반(class_group_ids)을 선택해주세요.");

    const { role, userId } = req.user!;
    const poolId = await getUserPoolId(userId);
    if (!poolId && role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    const authorName = await getUserName(userId);
    const inserted: any[] = [];

    for (const classId of classIds) {
      // 권한 확인
      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, classId);
        if (!ok) return err(res, 403, `담당 반이 아닙니다: ${classId}`);
      } else if (role === "pool_admin") {
        const classRows = await db.execute(sql`
          SELECT id FROM class_groups WHERE id = ${classId} AND swimming_pool_id = ${poolId}
        `);
        if (!classRows.rows.length) return err(res, 403, "접근 권한이 없습니다.");
      }

      const id = `diary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const effectivePoolId = poolId || "super";

      const rows = await db.execute(sql`
        INSERT INTO swim_diary
          (id, student_id, swimming_pool_id, author_id, author_name,
           title, lesson_content, practice_goals, good_points, next_focus,
           image_urls, class_group_id)
        VALUES
          (${id}, NULL, ${effectivePoolId}, ${userId}, ${authorName},
           ${title?.trim() || null}, ${lesson_content || null},
           ${practice_goals || null}, ${good_points || null}, ${next_focus || null},
           '[]'::jsonb, ${classId})
        RETURNING *
      `);
      inserted.push(rows.rows[0]);
    }

    if (inserted.length === 1) return res.status(201).json({ success: true, ...inserted[0] });
    return res.status(201).json({ success: true, count: inserted.length, diaries: inserted });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── GET /diary/:id ─────────────────────────────────────────────────────
router.get("/diary/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { role, userId } = req.user!;
    const rows = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${req.params.id}`);
    const diary = rows.rows[0] as any;
    if (!diary) return err(res, 404, "일지를 찾을 수 없습니다.");

    if (role === "teacher") {
      const ok = await teacherOwnsClass(userId, diary.class_group_id);
      if (!ok) return err(res, 403, "접근 권한이 없습니다.");
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (diary.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    return res.json(diary);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PUT /diary/:id ─────────────────────────────────────────────────────
router.put("/diary/:id", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { title, lesson_content, next_focus, practice_goals, good_points } = req.body;
    const { role, userId } = req.user!;

    const rows = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${req.params.id}`);
    const diary = rows.rows[0] as any;
    if (!diary) return err(res, 404, "일지를 찾을 수 없습니다.");

    // teacher는 자기가 쓴 것만
    if (role === "teacher") {
      if (diary.author_id !== userId) return err(res, 403, "자신이 작성한 일지만 수정할 수 있습니다.");
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (diary.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    const updated = await db.execute(sql`
      UPDATE swim_diary SET
        title = COALESCE(${title?.trim() || null}, title),
        lesson_content = ${lesson_content ?? diary.lesson_content},
        practice_goals = ${practice_goals ?? diary.practice_goals},
        good_points = ${good_points ?? diary.good_points},
        next_focus = ${next_focus ?? diary.next_focus}
      WHERE id = ${req.params.id}
      RETURNING *
    `);
    return res.json({ success: true, ...updated.rows[0] });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /diary/:id ──────────────────────────────────────────────────
router.delete("/diary/:id", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { role, userId } = req.user!;

    const rows = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${req.params.id}`);
    const diary = rows.rows[0] as any;
    if (!diary) return err(res, 404, "일지를 찾을 수 없습니다.");

    if (role === "teacher") {
      if (diary.author_id !== userId) return err(res, 403, "자신이 작성한 일지만 삭제할 수 있습니다.");
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (diary.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.execute(sql`DELETE FROM swim_diary WHERE id = ${req.params.id}`);
    return res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
