import { Router } from "express";
import { db, classChangeLogsTable, studentsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

// 날짜 유틸 (서버 사이드)
function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}
function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return toDateStr(d);
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}

// 미적용 pending 변경 이력 자동 적용 (effective_date <= today)
async function applyPendingChangeLogs(poolId: string) {
  const today = toDateStr(new Date());
  const pending = await db.select().from(classChangeLogsTable)
    .where(and(
      eq(classChangeLogsTable.pool_id, poolId),
      eq(classChangeLogsTable.is_applied, false),
      sql`${classChangeLogsTable.effective_date} <= ${today}`
    ));

  for (const log of pending) {
    try {
      if (log.change_type === "remove_from_class" && log.target_student_id) {
        const [stu] = await db.select({
          assigned_class_ids: studentsTable.assigned_class_ids,
          class_group_id: studentsTable.class_group_id,
        }).from(studentsTable).where(eq(studentsTable.id, log.target_student_id)).limit(1);

        if (stu) {
          const ids: string[] = Array.isArray(stu.assigned_class_ids) ? stu.assigned_class_ids as string[] : [];
          const newIds = ids.filter(id => id !== log.class_group_id);
          await db.update(studentsTable).set({
            assigned_class_ids: newIds as any,
            class_group_id: (stu.class_group_id === log.class_group_id ? null : stu.class_group_id),
            schedule_labels: null,
            updated_at: new Date(),
          }).where(eq(studentsTable.id, log.target_student_id));
        }
      }
      await db.update(classChangeLogsTable)
        .set({ is_applied: true })
        .where(eq(classChangeLogsTable.id, log.id));
    } catch (e) {
      console.error("[applyPendingChangeLogs] error:", e);
    }
  }
}

// GET /class-change-logs?week_start=YYYY-MM-DD
// week_start: 조회할 주차의 월요일 날짜
router.get("/", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const weekStartRaw = (req.query.week_start as string) || getMondayOf(toDateStr(new Date()));
    const weekStart = getMondayOf(weekStartRaw);

    // 미적용 pending 이력 자동 처리
    await applyPendingChangeLogs(poolId);

    const logs = await db.select().from(classChangeLogsTable)
      .where(and(
        eq(classChangeLogsTable.pool_id, poolId),
        eq(classChangeLogsTable.display_week_start, weekStart)
      ));

    return res.json({ logs, week_start: weekStart });
  } catch (e) {
    console.error(e);
    return err(res, 500, "서버 오류");
  }
});

// POST /class-change-logs (내부용 — 클라이언트 직접 사용 시 권한 있음)
router.post("/", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const { class_group_id, target_student_id, change_type, effective_date, note } = req.body;
    if (!class_group_id || !change_type || !effective_date) {
      return err(res, 400, "필수 필드 누락");
    }

    const displayWeekStart = getMondayOf(effective_date);
    const id = `ccl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const today = toDateStr(new Date());

    await db.insert(classChangeLogsTable).values({
      id,
      pool_id: poolId,
      class_group_id,
      target_student_id: target_student_id || null,
      change_type,
      effective_date,
      display_week_start: displayWeekStart,
      note: note || null,
      created_by: req.user!.userId,
      is_applied: effective_date <= today,
      created_at: new Date(),
    });

    return res.json({ success: true, id, display_week_start: displayWeekStart });
  } catch (e) {
    console.error(e);
    return err(res, 500, "서버 오류");
  }
});

export { getMondayOf, addDays, toDateStr };
export default router;
