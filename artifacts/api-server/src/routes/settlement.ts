/**
 * settlement.ts — 정산 API
 *
 * GET  /settlement/calculator?pool_id=&teacher_id=&month=YYYY-MM   정산 계산기
 * POST /settlement/save                                             정산 저장 (draft/submitted)
 * GET  /settlement/my-status?pool_id=&month=YYYY-MM                선생님 자신의 정산 상태
 * GET  /settlement/reports?pool_id=&month=YYYY-MM                  관리자: 선생님 전체 제출 현황
 * GET  /settlement/history?pool_id=&teacher_id=                    정산 이력
 * POST /settlement/finalize                                         정산 확정
 * POST /settlement/next-month-start                                 다음 달 시작
 */
import { Router, type Response } from "express";
import { db, superAdminDb , superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logChange } from "../utils/change-logger.js";

const router = Router();

function err(res: Response, status: number, msg: string) {
  return res.status(status).json({ success: false, message: msg, error: msg });
}

async function getPoolId(userId: string): Promise<string | null> {
  const r = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (r.rows[0] as any)?.swimming_pool_id || null;
}

// ─── 정산 계산기 ─────────────────────────────────────────────────────────────
// GET /settlement/calculator?pool_id=&teacher_id=&month=YYYY-MM
router.get("/settlement/calculator", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, teacher_id, month } = req.query as Record<string, string>;
      const { userId, role } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      const targetTeacherId = teacher_id || userId!;
      if (role !== "super_admin" && role !== "pool_admin") {
        if (targetTeacherId !== userId) return err(res, 403, "본인 정산만 조회 가능합니다.");
      }

      // 단가표 조회
      const pricingRows = await db.execute(sql`
        SELECT * FROM pool_class_pricing WHERE pool_id = ${pool_id} AND is_active = true
      `);
      const pricing: Record<string, any> = {};
      (pricingRows.rows as any[]).forEach(p => { pricing[p.type_key] = p; });

      // 해당 선생님이 담당하는 반 조회
      const cgRows = await db.execute(sql`
        SELECT id, name FROM class_groups WHERE teacher_user_id = ${targetTeacherId} AND is_deleted = false
      `);
      const classGroups = cgRows.rows as any[];
      const classGroupIds = classGroups.map((c: any) => c.id);

      if (classGroupIds.length === 0) {
        return res.json({
          success: true,
          summary: {
            total_revenue: 0, total_sessions: 0, total_makeup_sessions: 0,
            total_trial_sessions: 0, total_temp_transfer_sessions: 0,
            withdrawn_count: 0, postpone_count: 0,
          },
          students: [], month,
        });
      }

      const startDate = month + "-01";
      const endDate   = month + "-31";

      // 정규 + 기타(extra) 수업 출석
      const attRows = await db.execute(sql`
        SELECT a.student_id, a.session_type, a.status, a.date, a.teacher_user_id,
          s.name AS student_name, s.class_type, s.is_trial, s.is_unregistered
        FROM attendance a
        JOIN students s ON s.id = a.student_id
        WHERE a.teacher_user_id = ${targetTeacherId}
          AND a.date >= ${startDate} AND a.date <= ${endDate}
          AND a.status = 'present'
          AND a.session_type IN ('regular','extra')
          AND a.swimming_pool_id = ${pool_id}
        ORDER BY a.date
      `);

      // 보강 완료
      const makeupRows = await db.execute(sql`
        SELECT ms.student_id, ms.student_name, ms.assigned_date, ms.source_type,
          s.class_type, s.is_trial
        FROM makeup_sessions ms
        JOIN students s ON s.id = ms.student_id
        WHERE ms.assigned_teacher_id = ${targetTeacherId}
          AND ms.assigned_date >= ${startDate} AND ms.assigned_date <= ${endDate}
          AND ms.status = 'completed'
          AND ms.swimming_pool_id = ${pool_id}
      `);

      // 임시이동 (이 선생님이 받은)
      const transferRows = await db.execute(sql`
        SELECT tct.student_id, tct.student_name, tct.transfer_date,
          s.class_type, s.is_trial
        FROM temp_class_transfers tct
        JOIN students s ON s.id = tct.student_id
        WHERE tct.to_teacher_id = ${targetTeacherId}
          AND tct.transfer_date >= ${startDate} AND tct.transfer_date <= ${endDate}
          AND tct.pool_id = ${pool_id}
          AND tct.attendance_id IS NOT NULL
      `);

      // 이 달 탈퇴 학생 (이 선생님 담당 반 기준)
      const withdrawnRows = await db.execute(sql`
        SELECT DISTINCT a.student_id
        FROM attendance a
        JOIN students s ON s.id = a.student_id
        WHERE a.teacher_user_id = ${targetTeacherId}
          AND a.date >= ${startDate} AND a.date <= ${endDate}
          AND a.swimming_pool_id = ${pool_id}
          AND s.is_unregistered = true
      `);
      const withdrawnCount = withdrawnRows.rows.length;

      // 학생별 집계
      const studentMap: Record<string, {
        student_id: string; student_name: string; class_type: string;
        is_trial: boolean; is_unregistered: boolean;
        regular_sessions: number; makeup_sessions: number; trial_sessions: number;
        temp_transfer_sessions: number; extra_sessions: number; total_sessions: number;
        monthly_fee: number; settlement_amount: number;
      }> = {};

      function ensureStudent(id: string, name: string, class_type: string, is_trial: boolean, is_unregistered: boolean) {
        if (!studentMap[id]) {
          const p = pricing[class_type] || pricing["weekly_1"] || { monthly_fee: 0, sessions_per_month: 4 };
          studentMap[id] = {
            student_id: id, student_name: name, class_type,
            is_trial, is_unregistered,
            regular_sessions: 0, makeup_sessions: 0, trial_sessions: 0,
            temp_transfer_sessions: 0, extra_sessions: 0, total_sessions: 0,
            monthly_fee: p.monthly_fee, settlement_amount: 0,
          };
        }
      }

      for (const att of (attRows.rows as any[])) {
        ensureStudent(att.student_id, att.student_name, att.class_type || "weekly_1", att.is_trial, att.is_unregistered);
        if (att.session_type === "extra") {
          studentMap[att.student_id].extra_sessions++;
        } else {
          if (att.is_trial) studentMap[att.student_id].trial_sessions++;
          else studentMap[att.student_id].regular_sessions++;
        }
      }
      for (const mk of (makeupRows.rows as any[])) {
        ensureStudent(mk.student_id, mk.student_name, mk.class_type || "weekly_1", mk.is_trial, false);
        studentMap[mk.student_id].makeup_sessions++;
      }
      for (const tf of (transferRows.rows as any[])) {
        ensureStudent(tf.student_id, tf.student_name, tf.class_type || "weekly_1", tf.is_trial, false);
        studentMap[tf.student_id].temp_transfer_sessions++;
      }

      // 정산 금액 계산
      let totalRevenue = 0, totalSessions = 0, totalMakeupSessions = 0;
      let totalTrialSessions = 0, totalTempTransferSessions = 0;

      for (const s of Object.values(studentMap)) {
        const p = pricing[s.class_type] || pricing["weekly_1"] || { monthly_fee: 0, sessions_per_month: 4 };
        const scheduledSessions = p.sessions_per_month || 4;
        const actualSessions = s.regular_sessions + s.extra_sessions;
        const perSession = scheduledSessions > 0 ? p.monthly_fee / scheduledSessions : 0;
        const regularAmount  = Math.min(actualSessions, scheduledSessions) * perSession;
        const makeupAmount   = s.makeup_sessions * perSession;
        const transferAmount = s.temp_transfer_sessions * perSession;

        s.settlement_amount = Math.round(regularAmount + makeupAmount + transferAmount);
        s.total_sessions = actualSessions + s.makeup_sessions + s.temp_transfer_sessions + s.trial_sessions;

        totalRevenue += s.settlement_amount;
        totalSessions += actualSessions;
        totalMakeupSessions += s.makeup_sessions;
        totalTrialSessions += s.trial_sessions;
        totalTempTransferSessions += s.temp_transfer_sessions;
      }

      const summary = {
        total_revenue: totalRevenue,
        total_sessions: totalSessions,
        total_makeup_sessions: totalMakeupSessions,
        total_trial_sessions: totalTrialSessions,
        total_temp_transfer_sessions: totalTempTransferSessions,
        withdrawn_count: withdrawnCount,
        postpone_count: 0,
        month,
      };

      return res.json({ success: true, summary, students: Object.values(studentMap), pricing: pricingRows.rows });
    } catch (e: any) {
      console.error("[settlement/calculator]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 정산 저장 ───────────────────────────────────────────────────────────────
// POST /settlement/save
// body: { pool_id, month, summary, students, extra_manual_amount, extra_manual_memo, status }
router.post("/settlement/save", requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        pool_id, month, summary, students,
        extra_manual_amount, extra_manual_memo,
        status = "draft",
      } = req.body;
      const { userId } = req.user!;
      if (!pool_id || !month) return err(res, 400, "pool_id, month가 필요합니다.");

      const teacherRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const teacherName = (teacherRow.rows[0] as any)?.name || "선생님";

      const withdrawnCount = summary?.withdrawn_count ?? (Array.isArray(students)
        ? students.filter((s: any) => s.is_unregistered).length : 0);
      const postponeCount = summary?.postpone_count ?? 0;

      const rows = await db.execute(sql`
        INSERT INTO monthly_settlements
          (id, pool_id, teacher_user_id, teacher_name, settlement_month, total_revenue, total_sessions,
           total_makeup_sessions, total_trial_sessions, total_temp_transfer_sessions,
           extra_manual_amount, extra_manual_memo, student_details,
           status, withdrawn_count, postpone_count, updated_at)
        VALUES (gen_random_uuid()::text, ${pool_id}, ${userId}, ${teacherName}, ${month},
          ${summary?.total_revenue || 0}, ${summary?.total_sessions || 0},
          ${summary?.total_makeup_sessions || 0}, ${summary?.total_trial_sessions || 0},
          ${summary?.total_temp_transfer_sessions || 0},
          ${extra_manual_amount || 0}, ${extra_manual_memo || null},
          ${JSON.stringify(students || [])},
          ${status}, ${withdrawnCount}, ${postponeCount}, now())
        ON CONFLICT (pool_id, teacher_user_id, settlement_month) DO UPDATE SET
          total_revenue = EXCLUDED.total_revenue,
          total_sessions = EXCLUDED.total_sessions,
          total_makeup_sessions = EXCLUDED.total_makeup_sessions,
          total_trial_sessions = EXCLUDED.total_trial_sessions,
          total_temp_transfer_sessions = EXCLUDED.total_temp_transfer_sessions,
          extra_manual_amount = EXCLUDED.extra_manual_amount,
          extra_manual_memo = EXCLUDED.extra_manual_memo,
          student_details = EXCLUDED.student_details,
          status = EXCLUDED.status,
          withdrawn_count = EXCLUDED.withdrawn_count,
          postpone_count = EXCLUDED.postpone_count,
          updated_at = now()
        RETURNING *
      `);

      const saved = rows.rows[0] as any;
      await logChange({ tenantId: pool_id, tableName: "monthly_settlements", recordId: saved?.id || `${pool_id}_${month}`, changeType: "update", payload: { month, status, teacher: userId } });
      return res.json({ success: true, settlement: saved });
    } catch (e: any) {
      console.error("[settlement/save]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 선생님 자신의 정산 상태 조회 ────────────────────────────────────────────
// GET /settlement/my-status?pool_id=&month=YYYY-MM
router.get("/settlement/my-status", requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, month } = req.query as Record<string, string>;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      const rows = await db.execute(sql`
        SELECT status, total_revenue, extra_manual_amount, updated_at
        FROM monthly_settlements
        WHERE pool_id = ${pool_id} AND teacher_user_id = ${userId} AND settlement_month = ${month}
        LIMIT 1
      `);

      if (rows.rows.length === 0) {
        return res.json({ success: true, status: null });
      }
      const row = rows.rows[0] as any;
      return res.json({ success: true, status: row.status, total_revenue: row.total_revenue, updated_at: row.updated_at });
    } catch (e: any) {
      console.error("[settlement/my-status]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 관리자: 선생님별 제출 현황 조회 ─────────────────────────────────────────
// GET /settlement/reports?pool_id=&month=YYYY-MM
router.get("/settlement/reports", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, month } = req.query as Record<string, string>;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      // 제출된 정산 레코드 가져오기
      const settleRows = await db.execute(sql`
        SELECT
          ms.teacher_user_id AS teacher_id,
          ms.teacher_name,
          ms.status,
          ms.total_revenue,
          ms.total_sessions,
          ms.total_makeup_sessions  AS makeup_count,
          ms.total_trial_sessions   AS trial_count,
          ms.total_temp_transfer_sessions AS transfer_count,
          ms.withdrawn_count,
          ms.postpone_count,
          ms.extra_manual_amount,
          ms.updated_at,
          (SELECT COUNT(DISTINCT sd.value->>'student_id')
           FROM jsonb_array_elements(ms.student_details) AS sd
          )::int AS student_count
        FROM monthly_settlements ms
        WHERE ms.pool_id = ${pool_id} AND ms.settlement_month = ${month}
      `);

      const reportMap: Record<string, any> = {};
      for (const r of (settleRows.rows as any[])) {
        reportMap[r.teacher_id] = {
          teacher_id:     r.teacher_id,
          teacher_name:   r.teacher_name,
          status:         r.status,               // "draft" | "submitted" | "confirmed"
          total_revenue:  r.total_revenue,
          total_sessions: r.total_sessions,
          student_count:  Number(r.student_count),
          makeup_count:   r.makeup_count,
          trial_count:    r.trial_count,
          transfer_count: r.transfer_count,
          withdrawn_count: r.withdrawn_count,
          postpone_count: r.postpone_count,
          extra_manual_amount: r.extra_manual_amount,
          updated_at:     r.updated_at,
        };
      }

      return res.json({ success: true, reports: Object.values(reportMap) });
    } catch (e: any) {
      console.error("[settlement/reports]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 정산 확정 ───────────────────────────────────────────────────────────────
// POST /settlement/finalize
router.post("/settlement/finalize", requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, month } = req.body;
      const { userId } = req.user!;
      await db.execute(sql`
        UPDATE monthly_settlements
        SET is_finalized = true, finalized_at = now(), status = 'confirmed'
        WHERE pool_id = ${pool_id} AND teacher_user_id = ${userId} AND settlement_month = ${month}
      `);
      if (pool_id) await logChange({ tenantId: pool_id, tableName: "monthly_settlements", recordId: `${pool_id}_${month}`, changeType: "update", payload: { month, status: "confirmed", finalized: true } });
      return res.json({ success: true });
    } catch (e: any) {
      return err(res, 500, e.message);
    }
  }
);

// ─── 정산 이력 조회 ───────────────────────────────────────────────────────────
// GET /settlement/history?pool_id=&teacher_id=
router.get("/settlement/history", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, teacher_id } = req.query as Record<string, string>;
      const { userId, role } = req.user!;
      const targetTeacherId = teacher_id || userId;
      if (role === "teacher" && targetTeacherId !== userId) return err(res, 403, "본인 정산만 조회 가능합니다.");
      const rows = await db.execute(sql`
        SELECT * FROM monthly_settlements
        WHERE pool_id = ${pool_id} AND teacher_user_id = ${targetTeacherId}
        ORDER BY settlement_month DESC
        LIMIT 12
      `);
      return res.json({ success: true, history: rows.rows });
    } catch (e: any) {
      return err(res, 500, e.message);
    }
  }
);

export default router;
