/**
 * 학생 수업 시간표 관리
 * POST   /admin/students/:id/class-schedule - 선생님/관리자: 시간표 설정
 * GET    /admin/students/:id/class-schedule - 조회
 * PATCH  /admin/students/:id/class-schedule - 시간표 수정
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { studentsTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";

const router = Router();

interface ClassScheduleEntry { day: string; time: string; }

// ─── 시간표 설정 (선생님/관리자만 가능) ───────────────────────────────
router.post("/admin/students/:id/class-schedule", requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { class_schedule, frequency } = req.body;
      if (!Array.isArray(class_schedule) || class_schedule.length === 0) {
        res.status(400).json({ success: false, message: "유효한 시간표를 입력해주세요." }); return;
      }

      const [student] = await db.select({ swimming_pool_id: studentsTable.swimming_pool_id, class_schedule: studentsTable.class_schedule })
        .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
      
      if (!student) { res.status(404).json({ success: false, message: "학생을 찾을 수 없습니다." }); return; }

      await db.execute(sql`
        UPDATE students
        SET class_schedule = ${JSON.stringify(class_schedule)}, updated_at = NOW()
        WHERE id = ${req.params.id}
      `);

      logPoolEvent({
        pool_id: student.swimming_pool_id!, event_type: "schedule.change", entity_type: "student",
        entity_id: req.params.id, actor_id: req.user!.userId,
        payload: { class_schedule, frequency },
      }).catch(() => {});
      res.json({ success: true, data: { id: req.params.id, class_schedule, frequency } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 시간표 조회 ──────────────────────────────────────────────────────
router.get("/admin/students/:id/class-schedule", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const [student] = await db.select({ class_schedule: studentsTable.class_schedule, name: studentsTable.name })
        .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
      
      if (!student) { res.status(404).json({ success: false, message: "학생을 찾을 수 없습니다." }); return; }

      res.json({ success: true, data: { id: req.params.id, name: student.name, class_schedule: student.class_schedule || [] } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 시간표 수정 (선생님/관리자만 가능) ─────────────────────────────
router.patch("/admin/students/:id/class-schedule", requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { class_schedule } = req.body;
      if (!Array.isArray(class_schedule)) {
        res.status(400).json({ success: false, message: "유효한 시간표를 입력해주세요." }); return;
      }

      const [student] = await db.select({ id: studentsTable.id, swimming_pool_id: studentsTable.swimming_pool_id })
        .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
      
      if (!student) { res.status(404).json({ success: false, message: "학생을 찾을 수 없습니다." }); return; }

      await db.execute(sql`
        UPDATE students
        SET class_schedule = ${JSON.stringify(class_schedule)}, updated_at = NOW()
        WHERE id = ${req.params.id}
      `);

      logPoolEvent({
        pool_id: student.swimming_pool_id!, event_type: "schedule.change", entity_type: "student",
        entity_id: req.params.id, actor_id: req.user!.userId,
        payload: { class_schedule },
      }).catch(() => {});
      res.json({ success: true, data: { id: req.params.id, class_schedule } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

export default router;
