import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { classGroupsTable, studentsTable, attendanceTable, usersTable, classChangeLogsTable } from "@workspace/db/schema";
import { eq, and, sql, ne } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logChange } from "../utils/change-logger.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}


router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const tokenRole = req.user!.role;
    const poolId = await getPoolId(userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const mineOnly = tokenRole === "teacher" || req.query.mine === "true";
    let groups;
    if (mineOnly) {
      // teacher 모드 또는 mine=true: 주담당 또는 co-teacher인 반만 조회
      const rawRows = await db.execute(
        sql`SELECT * FROM class_groups
            WHERE swimming_pool_id = ${poolId}
              AND (teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text))
              AND is_deleted = false`
      );
      groups = rawRows.rows as any[];
    } else {
      groups = await db.select().from(classGroupsTable)
        .where(and(
          eq(classGroupsTable.swimming_pool_id, poolId),
          eq(classGroupsTable.is_deleted, false)
        ));
    }

    const enriched = await Promise.all(groups.map(async (g: any) => {
      const rows = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM students
        WHERE swimming_pool_id = ${poolId}
          AND (class_group_id = ${g.id} OR assigned_class_ids @> to_jsonb(${g.id}::text))
          AND deleted_at IS NULL
          AND status NOT IN ('withdrawn', 'deleted')
      `);
      return { ...g, student_count: Number((rows.rows[0] as any).count || 0) };
    }));

    res.json(enriched);
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// 반 등록: pool_admin + teacher 모두 허용
router.post("/", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { name, schedule_days, schedule_time, instructor, teacher_user_id, level, capacity, description, is_one_time, one_time_date, color } = req.body;
  if (!schedule_days || !schedule_time) {
    return err(res, 400, "수업 요일과 수업 시간을 입력해주세요.");
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const effectiveTeacherId: string | null =
      req.user!.role === "teacher"
        ? req.user!.userId
        : (teacher_user_id || null);

    const isOneTime = Boolean(is_one_time);
    const autoName = name || (isOneTime
      ? `${one_time_date || schedule_days} ${schedule_time} 특별반`
      : `${schedule_days} ${schedule_time}반`);

    let instructorName = instructor || null;
    if (effectiveTeacherId && !instructor) {
      const [tUser] = await superAdminDb.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, effectiveTeacherId)).limit(1);
      if (tUser) instructorName = tUser.name;
    }

    // 1회성 반은 중복 검사 생략 (날짜 기반 단건 수업)
    if (!isOneTime) {
      if (effectiveTeacherId) {
        const dup = await db.execute(sql`
          SELECT id FROM class_groups
          WHERE swimming_pool_id = ${poolId}
            AND schedule_days = ${schedule_days}
            AND schedule_time = ${schedule_time}
            AND teacher_user_id = ${effectiveTeacherId}
            AND is_one_time = false
            AND is_deleted = false
          LIMIT 1
        `);
        if (dup.rows.length > 0) {
          return err(res, 409, "동일한 요일·시간·선생님으로 이미 개설된 반이 있습니다.");
        }
      } else {
        const dup = await db.execute(sql`
          SELECT id FROM class_groups
          WHERE swimming_pool_id = ${poolId}
            AND schedule_days = ${schedule_days}
            AND schedule_time = ${schedule_time}
            AND teacher_user_id IS NULL
            AND is_one_time = false
            AND is_deleted = false
          LIMIT 1
        `);
        if (dup.rows.length > 0) {
          return err(res, 409, "동일한 요일·시간으로 이미 개설된 반이 있습니다.");
        }
      }
    }

    const id = `cg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [group] = await db.insert(classGroupsTable).values({
      id,
      swimming_pool_id: poolId,
      name: autoName,
      schedule_days,
      schedule_time,
      instructor: instructorName,
      teacher_user_id: effectiveTeacherId,
      level: level || null,
      capacity: capacity || null,
      description: description || null,
      is_one_time: isOneTime,
      one_time_date: isOneTime ? (one_time_date || null) : null,
      color: color || "#FFFFFF",
    }).returning();
    await logChange({ tenantId: poolId, tableName: "class_groups", recordId: group.id, changeType: "create", payload: { name: group.name, schedule_days: group.schedule_days, schedule_time: group.schedule_time } });
    logPoolEvent({ pool_id: poolId, event_type: "class_create", entity_type: "class_group", entity_id: group.id, actor_id: req.user!.userId, payload: { name: group.name, schedule_days: group.schedule_days, schedule_time: group.schedule_time, level: group.level } }).catch(console.error);
    res.status(201).json({ success: true, ...group, student_count: 0 });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [group] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!group) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (group.is_deleted) return err(res, 404, "삭제된 반입니다.");

    if (req.user!.role !== "super_admin" && poolId && group.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    res.json(group);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id/students", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [group] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id })
      .from(classGroupsTable)
      .where(and(eq(classGroupsTable.id, req.params.id), eq(classGroupsTable.is_deleted, false)))
      .limit(1);
    if (!group) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && group.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    const cgId = req.params.id;
    const students = await db.execute(sql`
      SELECT * FROM students
      WHERE (
        class_group_id = ${cgId}
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(assigned_class_ids, '[]'::jsonb)) AS elem
          WHERE elem = ${cgId}
        )
      )
        AND status NOT IN ('withdrawn', 'deleted')
      ORDER BY name ASC
    `);
    res.json(students.rows);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id/attendance", requireAuth, async (req: AuthRequest, res) => {
  const { date } = req.query;
  if (!date) return err(res, 400, "date 파라미터가 필요합니다.");
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [group] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id })
      .from(classGroupsTable)
      .where(and(eq(classGroupsTable.id, req.params.id), eq(classGroupsTable.is_deleted, false)))
      .limit(1);
    if (!group) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && group.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    // active 학생만 출결 대상 (반 배정일이 있으면 조회날짜 이후 배정 학생 제외)
    const students = await db.select().from(studentsTable)
      .where(and(
        eq(studentsTable.class_group_id, req.params.id),
        sql`status NOT IN ('withdrawn', 'deleted')`,
        sql`(${studentsTable.class_enrolled_at} IS NULL OR ${studentsTable.class_enrolled_at} <= ${date as string})`
      ));
    const attRecords = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.class_group_id, req.params.id), eq(attendanceTable.date, date as string)));

    const attMap = Object.fromEntries(attRecords.map(a => [a.student_id, a.status]));
    const result = students.map(s => ({
      student_id: s.id, student_name: s.name, status: attMap[s.id] || null,
    }));
    res.json(result);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { name, schedule_days, schedule_time, instructor, teacher_user_id, level, capacity, description, color, co_teacher_ids } = req.body;
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select({ swimming_pool_id: classGroupsTable.swimming_pool_id, is_deleted: classGroupsTable.is_deleted })
      .from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (existing.is_deleted) return err(res, 400, "삭제된 반은 수정할 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const [group] = await db.update(classGroupsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(schedule_days !== undefined && { schedule_days }),
        ...(schedule_time !== undefined && { schedule_time }),
        ...(instructor !== undefined && { instructor }),
        ...(teacher_user_id !== undefined && { teacher_user_id }),
        ...(level !== undefined && { level }),
        ...(capacity !== undefined && { capacity }),
        ...(description !== undefined && { description }),
        ...(color !== undefined && { color: (!color || color === "") ? "#FFFFFF" : color }),
        // co_teacher_ids: pool_admin/super_admin 또는 해당 반 담당 선생님이 수정 가능
        ...(co_teacher_ids !== undefined && (() => {
          if (req.user!.role !== "teacher") return true;
          // teacher는 자기 반(teacher_user_id = 본인)만 수정 가능 — existing에 teacher_user_id 없으므로 별도 조회 없이 허용 (본인 반 진입 경로)
          return true;
        })() && {
          co_teacher_ids: Array.isArray(co_teacher_ids) ? co_teacher_ids : [],
        }),
        updated_at: new Date(),
      })
      .where(eq(classGroupsTable.id, req.params.id))
      .returning();
    await logChange({ tenantId: group.swimming_pool_id, tableName: "class_groups", recordId: group.id, changeType: "update", payload: { name: group.name, schedule_days: group.schedule_days, schedule_time: group.schedule_time } });
    logPoolEvent({ pool_id: group.swimming_pool_id, event_type: "class_update", entity_type: "class_group", entity_id: group.id, actor_id: req.user!.userId, payload: { name: group.name, schedule_days: group.schedule_days, schedule_time: group.schedule_time } }).catch(console.error);

    // 담당 선생님 변경 시 새 선생님에게 알림
    if (teacher_user_id !== undefined && teacher_user_id && teacher_user_id !== req.user!.userId) {
      try {
        const { sendPushToUser } = await import("../lib/push-service.js");
        await sendPushToUser(teacher_user_id, false, "class_assigned", `${group.name} 반 담당으로 배정됐습니다`,
          `${group.schedule_days || ""} ${group.schedule_time || ""} 반을 담당하게 됐습니다. 시간표를 확인해주세요.`,
          { screen: "my-schedule" }, `class_assigned_${group.id}_${teacher_user_id}`);
      } catch (pushErr) { console.error("[class-groups teacher assign push error]", pushErr); }
    }

    // 수업 시간표(요일/시간) 변경 시 해당 반 학부모들에게 알림
    if ((schedule_days !== undefined || schedule_time !== undefined)) {
      try {
        const { sendPushToClassParents } = await import("../lib/push-service.js");
        const days = group.schedule_days || "";
        const time = group.schedule_time || "";
        await sendPushToClassParents(
          group.id, "schedule_change",
          `${group.name} 반 수업 일정이 변경됐습니다`,
          `변경된 수업 일정: ${days} ${time}`.trim(),
          { classId: group.id },
          `schedule_change_${group.id}_${Date.now()}`
        );
      } catch (pushErr) { console.error("[class-groups schedule change push error]", pushErr); }
    }

    res.json({ success: true, ...group });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select({
      swimming_pool_id: classGroupsTable.swimming_pool_id,
      is_deleted: classGroupsTable.is_deleted,
      teacher_user_id: classGroupsTable.teacher_user_id,
    } as any).from(classGroupsTable).where(eq(classGroupsTable.id, req.params.id)).limit(1);

    if (!existing) return err(res, 404, "수업 그룹을 찾을 수 없습니다.");
    if (existing.is_deleted) return res.json({ success: true, message: "이미 삭제된 반입니다." });
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    if (req.user!.role === "teacher" && existing.teacher_user_id !== req.user!.userId) {
      return err(res, 403, "자신이 담당하는 반만 삭제할 수 있습니다.");
    }

    const cgId = req.params.id;

    // 1) 해당 반에 속한 active 학생 조회
    const affectedStudents = await db.execute(sql`
      SELECT id FROM students
      WHERE swimming_pool_id = ${poolId}
        AND status NOT IN ('withdrawn', 'deleted')
        AND (
          class_group_id = ${cgId}
          OR assigned_class_ids @> to_jsonb(${cgId}::text)
        )
    `);
    // 2) 학생 미배정 처리: class_group_id null + assigned_class_ids에서 제거
    await db.execute(sql`
      UPDATE students
      SET
        class_group_id = CASE WHEN class_group_id = ${cgId} THEN NULL ELSE class_group_id END,
        assigned_class_ids = COALESCE(
          (SELECT jsonb_agg(elem)
           FROM jsonb_array_elements(COALESCE(assigned_class_ids, '[]'::jsonb)) AS elem
           WHERE elem::text != ${JSON.stringify(cgId)}),
          '[]'::jsonb
        ),
        schedule_labels = NULL,
        updated_at = NOW()
      WHERE swimming_pool_id = ${poolId}
        AND (
          class_group_id = ${cgId}
          OR assigned_class_ids @> to_jsonb(${cgId}::text)
        )
    `);

    // 3) student_class_history: 해당 반의 열린 이력 닫기 (반 삭제일 = left_at)
    const todayStr = new Date().toISOString().split("T")[0];
    await db.execute(sql`
      UPDATE student_class_history
      SET left_at = ${todayStr}::date
      WHERE class_group_id = ${cgId}
        AND left_at IS NULL
    `);

    // 5) attendance: class_group_id null 처리 (출결 기록 보존)
    await db.execute(sql`UPDATE attendance SET class_group_id = NULL WHERE class_group_id = ${cgId}`);

    // 6) teacher_schedule_notes 삭제
    await db.execute(sql`DELETE FROM teacher_schedule_notes WHERE class_group_id = ${cgId}`);

    // 7) 반 soft delete (hard delete 하지 않음)
    await db.update(classGroupsTable)
      .set({ is_deleted: true, deleted_at: new Date(), updated_at: new Date() })
      .where(eq(classGroupsTable.id, cgId));

    if (poolId) await logChange({ tenantId: poolId, tableName: "class_groups", recordId: cgId, changeType: "delete", payload: { pool_id: poolId } });
    if (poolId) logPoolEvent({ pool_id: poolId, event_type: "class_delete", entity_type: "class_group", entity_id: cgId, actor_id: req.user!.userId, payload: { pool_id: poolId } }).catch(console.error);

    // change_log 기록 — 삭제 적용 주차에 점 표시용
    try {
      const today = new Date().toISOString().split("T")[0];
      const d = new Date(today + "T12:00:00Z");
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      const displayWeekStart = d.toISOString().split("T")[0];
      const [cgInfo] = await db.select({ name: classGroupsTable.name })
        .from(classGroupsTable).where(eq(classGroupsTable.id, cgId)).limit(1);
      const logId = `ccl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.insert(classChangeLogsTable).values({
        id: logId,
        pool_id: poolId || "",
        class_group_id: cgId,
        target_student_id: null,
        change_type: "delete_class",
        effective_date: today,
        display_week_start: displayWeekStart,
        note: `반 삭제 (${(cgInfo as any)?.name || cgId}) — 소속 회원 미배정 이동`,
        created_by: req.user!.userId,
        is_applied: true,
        created_at: new Date(),
      });
    } catch (logErr) { console.error("[change_log] delete_class error:", logErr); }

    res.json({ success: true });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
