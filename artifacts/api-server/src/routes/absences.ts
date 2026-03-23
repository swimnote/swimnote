/**
 * absences.ts — 선생님 결근 처리 API
 * 
 * POST /absences                     — 결근 등록 (미실시(선생님) 보강 생성)
 * GET  /absences/nearby?class_group_id=&date=&time=  — 같은 시간대 다른 반 목록
 * POST /absences/:id/transfer        — 임시이동 처리 (선택 학생 → 옆 반)
 * GET  /absences?pool_id=&month=     — 결근 이력
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

// ─── 결근 이력 조회 ──────────────────────────────────────────────────────
router.get("/absences", requireAuth, requireRole("pool_admin", "teacher", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    const { userId, role, poolId: tokenPoolId } = req.user!;
    const pool_id = (req.query.pool_id as string) || tokenPoolId || undefined;
    if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");

    const rows = await db.execute(sql`
      SELECT ta.*, 
        (SELECT count(*)::int FROM temp_class_transfers WHERE absence_id = ta.id) AS transfer_count,
        (SELECT count(*)::int FROM makeup_sessions WHERE absence_id = ta.id) AS makeup_count
      FROM teacher_absences ta
      WHERE ta.pool_id = ${pool_id}
        ${month ? sql`AND ta.absence_date LIKE ${month + '%'}` : sql``}
        ${role === "teacher" ? sql`AND ta.teacher_user_id = ${userId}` : sql``}
      ORDER BY ta.absence_date DESC, ta.absence_time
    `);
    return res.json({ success: true, absences: rows.rows });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// ─── 같은 시간대 다른 반 목록 (임시 이동 대상 검색) ────────────────────
router.get("/absences/nearby", requireAuth, requireRole("pool_admin", "teacher", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { class_group_id, date, time } = req.query as Record<string, string>;
    if (!class_group_id || !date || !time) return err(res, 400, "class_group_id, date, time이 필요합니다.");

    // 같은 시간대(±30분 이내) 다른 반 조회
    const [hh, mm] = time.split(":").map(Number);
    const totalMin = hh * 60 + mm;
    const dayOfWeek = new Date(date).getDay(); // 0=Sun,1=Mon,...6=Sat
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    const dayChar = weekdays[dayOfWeek];

    const rows = await db.execute(sql`
      SELECT cg.id, cg.name, cg.schedule_time, cg.schedule_days, cg.teacher_user_id,
        u.name AS teacher_name,
        (SELECT count(*)::int FROM students s WHERE s.class_group_id = cg.id AND s.status = 'active') AS student_count
      FROM class_groups cg
      LEFT JOIN users u ON u.id = cg.teacher_user_id
      WHERE cg.id != ${class_group_id}
        AND cg.is_deleted = false
        AND cg.schedule_days LIKE ${'%' + dayChar + '%'}
        AND cg.swimming_pool_id = (SELECT swimming_pool_id FROM class_groups WHERE id = ${class_group_id})
      ORDER BY cg.schedule_time
    `);

    // 시간대 필터링 (±60분)
    const nearby = (rows.rows as any[]).filter(cg => {
      if (!cg.schedule_time) return true;
      const [h2, m2] = (cg.schedule_time as string).split(":").map(Number);
      return Math.abs((h2 * 60 + m2) - totalMin) <= 60;
    });

    return res.json({ success: true, classes: nearby });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// ─── 결근 처리 (미실시(선생님) 생성 + 보강 자동 이월) ───────────────────
router.post("/absences", requireAuth, requireRole("pool_admin", "teacher"), async (req: AuthRequest, res: Response) => {
  try {
    const { pool_id, class_group_id, absence_date, absence_time } = req.body;
    const { userId, role } = req.user!;
    if (!class_group_id || !absence_date) return err(res, 400, "class_group_id, absence_date가 필요합니다.");

    const userPoolId = await getPoolId(userId!);
    const resolvedPoolId = pool_id || userPoolId;
    if (!resolvedPoolId) return err(res, 400, "pool_id를 찾을 수 없습니다.");
    if (role !== "super_admin" && userPoolId !== resolvedPoolId) return err(res, 403, "권한이 없습니다.");
    const pool_id_final = resolvedPoolId;

    // 반 정보 조회
    const cgRow = await db.execute(sql`SELECT * FROM class_groups WHERE id = ${class_group_id}`);
    const cg = cgRow.rows[0] as any;
    if (!cg) return err(res, 404, "반을 찾을 수 없습니다.");

    const teacherRow = await db.execute(sql`SELECT name FROM users WHERE id = ${cg.teacher_user_id}`);
    const teacherName = (teacherRow.rows[0] as any)?.name || "알 수 없음";
    const time = absence_time || cg.schedule_time || "09:00";

    // 결근 기록 생성
    const absenceRows = await db.execute(sql`
      INSERT INTO teacher_absences (id, pool_id, teacher_user_id, teacher_name, class_group_id, class_group_name, absence_date, absence_time, created_by)
      VALUES (gen_random_uuid()::text, ${pool_id_final}, ${cg.teacher_user_id}, ${teacherName}, ${class_group_id}, ${cg.name}, ${absence_date}, ${time}, ${userId})
      RETURNING *
    `);
    const absence = absenceRows.rows[0] as any;

    // 해당 반 학생 모두 조회
    const studentRows = await db.execute(sql`
      SELECT id, name FROM students WHERE class_group_id = ${class_group_id} AND status = 'active'
    `);
    const students = studentRows.rows as any[];

    // 출결 기록 + 보강(미실시_선생님) 생성
    const makeupIds: string[] = [];
    for (const student of students) {
      // 출결 기록 (absent)
      const attId = `att_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await db.execute(sql`
        INSERT INTO attendance (id, swimming_pool_id, class_group_id, student_id, date, status, session_type, teacher_user_id, teacher_name, created_by, created_by_name)
        VALUES (${attId}, ${pool_id_final}, ${class_group_id}, ${student.id}, ${absence_date}, 'absent', 'regular', ${cg.teacher_user_id}, ${teacherName}, ${userId}, ${teacherName})
        ON CONFLICT DO NOTHING
      `);

      // 미실시(선생님) 보강 생성
      const mkId = `mk_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await db.execute(sql`
        INSERT INTO makeup_sessions
          (id, swimming_pool_id, student_id, student_name, original_class_group_id, original_class_group_name, original_teacher_id, original_teacher_name, absence_date, absence_attendance_id, status, source_type, absence_id, can_expire)
        VALUES
          (${mkId}, ${pool_id_final}, ${student.id}, ${student.name}, ${class_group_id}, ${cg.name}, ${cg.teacher_user_id}, ${teacherName}, ${absence_date}, ${attId}, 'waiting', 'teacher_absence', ${absence.id}, false)
        ON CONFLICT DO NOTHING
      `);
      makeupIds.push(mkId);
    }

    return res.status(201).json({
      success: true,
      absence,
      affected_students: students.length,
      makeup_count: makeupIds.length,
    });
  } catch (e: any) {
    console.error("[absences POST]", e);
    return err(res, 500, e.message);
  }
});

// ─── 임시 이동 처리 (있음 선택 시) ─────────────────────────────────────
router.post("/absences/:id/transfer", requireAuth, requireRole("pool_admin", "teacher"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { transfer_student_ids, to_class_group_id } = req.body;
    // transfer_student_ids: 임시이동할 학생 ID 배열
    // to_class_group_id: 받을 반 ID
    const { userId } = req.user!;

    if (!Array.isArray(transfer_student_ids) || !to_class_group_id) {
      return err(res, 400, "transfer_student_ids 배열과 to_class_group_id가 필요합니다.");
    }

    const absRow = await db.execute(sql`SELECT * FROM teacher_absences WHERE id = ${id}`);
    const absence = absRow.rows[0] as any;
    if (!absence) return err(res, 404, "결근 기록을 찾을 수 없습니다.");

    const toClassRow = await db.execute(sql`SELECT cg.*, u.name AS teacher_name_from_user FROM class_groups cg LEFT JOIN users u ON u.id = cg.teacher_user_id WHERE cg.id = ${to_class_group_id}`);
    const toClass = toClassRow.rows[0] as any;
    if (!toClass) return err(res, 404, "대상 반을 찾을 수 없습니다.");

    const results = [];

    for (const studentId of transfer_student_ids) {
      const studentRow = await db.execute(sql`SELECT name FROM students WHERE id = ${studentId}`);
      const studentName = (studentRow.rows[0] as any)?.name || "알 수 없음";

      // 임시 이동 기록 생성
      const transferId = `tct_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await db.execute(sql`
        INSERT INTO temp_class_transfers
          (id, pool_id, absence_id, student_id, student_name, from_class_group_id, from_teacher_id, from_teacher_name, to_class_group_id, to_teacher_id, to_teacher_name, transfer_date, transfer_time)
        VALUES
          (${transferId}, ${absence.pool_id}, ${id}, ${studentId}, ${studentName}, ${absence.class_group_id}, ${absence.teacher_user_id}, ${absence.teacher_name}, ${to_class_group_id}, ${toClass.teacher_user_id}, ${toClass.teacher_name_from_user || toClass.instructor || "선생님"}, ${absence.absence_date}, ${absence.absence_time})
      `);

      // 기존 미실시 보강을 취소하고 임시이동으로 대체 (출결은 받는 선생님이 처리)
      await db.execute(sql`
        UPDATE makeup_sessions SET status = 'cancelled'
        WHERE absence_id = ${id} AND student_id = ${studentId} AND status = 'waiting'
      `);

      results.push({ studentId, studentName, transferId });
    }

    // 결근 기록에 임시이동 있음 표시
    await db.execute(sql`UPDATE teacher_absences SET has_temp_transfer = true WHERE id = ${id}`);

    return res.json({ success: true, transferred: results });
  } catch (e: any) {
    console.error("[absences/transfer POST]", e);
    return err(res, 500, e.message);
  }
});

export default router;
