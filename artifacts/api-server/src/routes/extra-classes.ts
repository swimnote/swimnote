/**
 * extra-classes.ts — 기타 수업(5주차 포함) API
 * 
 * POST /extra-classes          — 기타 수업 생성 (선생님)
 * GET  /extra-classes          — 목록 조회
 * GET  /extra-classes/:id/students — 학생 목록
 * POST /extra-classes/:id/attendance — 출결 처리
 */
import { Router, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: Response, status: number, msg: string) {
  return res.status(status).json({ success: false, message: msg, error: msg });
}

async function getPoolId(userId: string): Promise<string | null> {
  const r = await db.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (r.rows[0] as any)?.swimming_pool_id || null;
}

// GET /extra-classes?pool_id=&teacher_id=&month=YYYY-MM
router.get("/extra-classes", requireAuth, requireRole("pool_admin", "teacher", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { teacher_id, month } = req.query as Record<string, string>;
    const { userId, role, poolId: tokenPoolId } = req.user!;
    const pool_id = (req.query.pool_id as string) || tokenPoolId || undefined;
    if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");

    let clause = sql`ec.pool_id = ${pool_id}`;
    if (teacher_id) clause = sql`${clause} AND ec.teacher_user_id = ${teacher_id}`;
    if (role === "teacher") clause = sql`${clause} AND ec.teacher_user_id = ${userId}`;
    if (month) clause = sql`${clause} AND ec.class_date LIKE ${month + '%'}`;

    const rows = await db.execute(sql`
      SELECT ec.*,
        (SELECT count(*)::int FROM attendance a WHERE a.extra_class_id = ec.id AND a.status = 'present') AS present_count,
        (SELECT count(*)::int FROM attendance a WHERE a.extra_class_id = ec.id) AS total_attendance
      FROM extra_classes ec
      WHERE ${clause}
      ORDER BY ec.class_date DESC, ec.class_time
    `);
    return res.json({ success: true, extra_classes: rows.rows });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// POST /extra-classes — 기타 수업 생성
router.post("/extra-classes", requireAuth, requireRole("pool_admin", "teacher"), async (req: AuthRequest, res: Response) => {
  try {
    const { pool_id, class_name, class_date, class_time, student_ids, unregistered_names, is_fifth_week, notes } = req.body;
    const { userId, role } = req.user!;

    if (!pool_id || !class_name || !class_date || !class_time) return err(res, 400, "pool_id, class_name, class_date, class_time이 필요합니다.");

    const userPoolId = await getPoolId(userId!);
    if (role !== "super_admin" && userPoolId !== pool_id) return err(res, 403, "권한이 없습니다.");

    const teacherRow = await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
    const teacherName = (teacherRow.rows[0] as any)?.name || "선생님";

    // 등록 학생 이름 조회
    let studentNames: string[] = [];
    if (Array.isArray(student_ids) && student_ids.length > 0) {
      const snRows = await db.execute(sql`SELECT id, name FROM students WHERE id = ANY(${student_ids})`);
      const nameMap: Record<string, string> = {};
      (snRows.rows as any[]).forEach(r => { nameMap[r.id] = r.name; });
      studentNames = student_ids.map((sid: string) => nameMap[sid] || "알 수 없음");
    }

    // 미등록 회원 이름 추가
    const extraNames: string[] = Array.isArray(unregistered_names) ? unregistered_names.filter(Boolean) : [];
    const allNames = [...studentNames, ...extraNames];

    const rows = await db.execute(sql`
      INSERT INTO extra_classes (id, pool_id, teacher_user_id, teacher_name, class_name, class_date, class_time, student_ids, student_names, is_fifth_week, notes)
      VALUES (gen_random_uuid()::text, ${pool_id}, ${userId}, ${teacherName}, ${class_name}, ${class_date}, ${class_time}, ${student_ids || []}, ${allNames}, ${!!is_fifth_week}, ${notes || null})
      RETURNING *
    `);

    return res.status(201).json({ success: true, extra_class: rows.rows[0] });
  } catch (e: any) {
    console.error("[extra-classes POST]", e);
    return err(res, 500, e.message);
  }
});

// POST /extra-classes/:id/attendance — 기타 수업 출결 처리
router.post("/extra-classes/:id/attendance", requireAuth, requireRole("pool_admin", "teacher"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { attendances } = req.body; // [{student_id, status: 'present'|'absent'}]
    const { userId } = req.user!;

    const ecRow = await db.execute(sql`SELECT * FROM extra_classes WHERE id = ${id}`);
    const ec = ecRow.rows[0] as any;
    if (!ec) return err(res, 404, "기타 수업을 찾을 수 없습니다.");

    const teacherRow = await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
    const teacherName = (teacherRow.rows[0] as any)?.name || "선생님";

    const results = [];
    for (const att of (attendances || [])) {
      const attId = `att_extra_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await db.execute(sql`
        INSERT INTO attendance (id, swimming_pool_id, student_id, date, status, session_type, teacher_user_id, teacher_name, extra_class_id, created_by, created_by_name)
        VALUES (${attId}, ${ec.pool_id}, ${att.student_id}, ${ec.class_date}, ${att.status || 'present'}, 'extra', ${ec.teacher_user_id}, ${ec.teacher_name}, ${id}, ${userId}, ${teacherName})
        ON CONFLICT (student_id, date) WHERE student_id IS NOT NULL
        DO UPDATE SET status = EXCLUDED.status, session_type = EXCLUDED.session_type, extra_class_id = EXCLUDED.extra_class_id, updated_at = now()
      `);
      results.push(attId);
    }

    return res.json({ success: true, count: results.length });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

export default router;
