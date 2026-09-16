/**
 * settlement.ts — 정산 API (V2)
 *
 * GET  /settlement/calculator?pool_id=&teacher_id=&month=YYYY-MM   정산 계산기 (선생님 전용)
 * GET  /settlement/pool-summary?pool_id=&month=YYYY-MM             Pool 전체 계산 (관리자)
 * POST /settlement/save                                             정산 저장 (서버 재계산 후 저장)
 * GET  /settlement/my-status?pool_id=&month=YYYY-MM                선생님 자신의 정산 상태
 * GET  /settlement/reports?pool_id=&month=YYYY-MM                  관리자: 선생님 전체 제출 현황
 * GET  /settlement/history?pool_id=&teacher_id=                    정산 이력
 * POST /settlement/finalize                                         정산 확정
 * POST /settlement/next-month-start                                 다음 달 시작 (미사용, 유지)
 *
 * 계산식은 모두 settlement-service.ts / settlement-calculator.ts에 위치합니다.
 * Route handler는 인증·권한·파라미터 검증·HTTP 응답만 담당합니다.
 */
import { Router, type Response } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logChange } from "../utils/change-logger.js";
import {
  calculateTeacherSettlement,
  calculatePoolSettlement,
} from "../lib/settlement-service.js";

const router = Router();

function err(res: Response, status: number, msg: string) {
  return res.status(status).json({ success: false, message: msg, error: msg });
}

async function getPoolId(userId: string): Promise<string | null> {
  const r = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (r.rows[0] as any)?.swimming_pool_id || null;
}

// ─── 정산 계산기 (선생님용) ───────────────────────────────────────────────────
// GET /settlement/calculator?pool_id=&teacher_id=&month=YYYY-MM
router.get("/settlement/calculator",
  requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
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

      const result = await calculateTeacherSettlement(pool_id, month, targetTeacherId);
      return res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[settlement/calculator]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── Pool 전체 계산 (관리자용) ────────────────────────────────────────────────
// GET /settlement/pool-summary?pool_id=&month=YYYY-MM
router.get("/settlement/pool-summary",
  requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, month } = req.query as Record<string, string>;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      const result = await calculatePoolSettlement(pool_id, month);
      return res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("[settlement/pool-summary]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 정산 저장 ───────────────────────────────────────────────────────────────
// POST /settlement/save
// body: { pool_id, month, student_adjustments[], extra_manual_amount, extra_manual_memo, status }
//
// 클라이언트는 사람이 입력한 값(adjustment)만 보냅니다.
// 서버가 Settlement Service로 AUTO 재계산 후 저장합니다.
router.post("/settlement/save",
  requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        pool_id: rawPoolId,
        month,
        student_adjustments = [],  // [{ student_id, adjustment_amount, adjustment_reason, adjustment_memo }]
        extra_manual_amount = 0,
        extra_manual_memo = null,
        status = "draft",
      } = req.body;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      // 1. 서버 재계산
      const result = await calculateTeacherSettlement(pool_id, month, userId!);

      // 2. adjustment Map
      const adjMap = new Map<string, { amount: number; reason?: string; memo?: string }>();
      for (const adj of student_adjustments) {
        adjMap.set(adj.student_id, {
          amount: Number(adj.adjustment_amount) || 0,
          reason: adj.adjustment_reason,
          memo: adj.adjustment_memo,
        });
      }

      // 3. student_details 스냅샷 생성 (priced + unpriced 모두 포함)
      const allStudents = [...result.students, ...result.unpriced_students];
      const studentDetails = allStudents.map(s => {
        const myAlloc = s.teacher_allocations.find(a => a.teacher_id === userId) ?? null;
        const adj = adjMap.get(s.student_id);
        const allocatedAmount = myAlloc?.allocated_auto_amount ?? 0;
        const adjustmentAmount = adj?.amount ?? 0;
        const finalAmount = allocatedAmount + adjustmentAmount;
        return {
          student_id: s.student_id,
          student_name: s.student_name,
          weekly_count: s.weekly_count,
          pricing_status: s.pricing_status,
          monthly_fee: s.monthly_fee,
          sessions_per_month: s.sessions_per_month,
          scheduled_regular_count: s.scheduled_regular_count,
          completed_makeup_count: s.completed_makeup_count,
          service_count: s.service_count,
          billable_count: s.billable_count,
          student_auto_amount: s.student_auto_amount,
          my_regular_slot_count: myAlloc?.regular_slot_count ?? 0,
          allocation_ratio: myAlloc?.allocation_ratio ?? 0,
          allocated_amount: allocatedAmount,
          adjustment_amount: adjustmentAmount,
          adjustment_reason: adj?.reason ?? null,
          adjustment_memo: adj?.memo ?? null,
          final_amount: finalAmount,
        };
      });

      // 4. 집계
      const autoAmountSnapshot = result.teacher_aggregation?.allocated_auto_amount ?? 0;
      const totalFinalRevenue = studentDetails.reduce((s, d) => s + d.final_amount, 0) + Number(extra_manual_amount);
      const totalSessions = result.teacher_aggregation?.regular_slot_count ?? 0;
      const totalMakeupSessions = result.teacher_aggregation?.completed_makeup_performed_count ?? 0;

      // 5. DB 저장
      const teacherRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const teacherName = (teacherRow.rows[0] as any)?.name || "선생님";

      const saved = await db.execute(sql`
        INSERT INTO monthly_settlements
          (id, pool_id, teacher_user_id, teacher_name, settlement_month,
           total_revenue, total_sessions, total_makeup_sessions,
           total_trial_sessions, total_temp_transfer_sessions,
           extra_manual_amount, extra_manual_memo, student_details,
           status, withdrawn_count, postpone_count,
           auto_amount_snapshot, updated_at)
        VALUES (
          gen_random_uuid()::text, ${pool_id}, ${userId}, ${teacherName}, ${month},
          ${totalFinalRevenue}, ${totalSessions}, ${totalMakeupSessions},
          0, 0,
          ${Number(extra_manual_amount)}, ${extra_manual_memo},
          ${JSON.stringify(studentDetails)},
          ${status}, 0, 0,
          ${autoAmountSnapshot}, now()
        )
        ON CONFLICT (pool_id, teacher_user_id, settlement_month) DO UPDATE SET
          total_revenue            = EXCLUDED.total_revenue,
          total_sessions           = EXCLUDED.total_sessions,
          total_makeup_sessions    = EXCLUDED.total_makeup_sessions,
          extra_manual_amount      = EXCLUDED.extra_manual_amount,
          extra_manual_memo        = EXCLUDED.extra_manual_memo,
          student_details          = EXCLUDED.student_details,
          status                   = EXCLUDED.status,
          auto_amount_snapshot     = EXCLUDED.auto_amount_snapshot,
          updated_at               = now()
        WHERE monthly_settlements.status != 'confirmed'
        RETURNING *
      `);

      await logChange({
        tenantId: pool_id,
        tableName: "monthly_settlements",
        recordId: (saved.rows[0] as any)?.id || `${pool_id}_${month}`,
        changeType: "update",
        payload: { month, status, teacher: userId },
      });
      return res.json({ success: true, settlement: saved.rows[0] });
    } catch (e: any) {
      console.error("[settlement/save]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 선생님 자신의 정산 상태 조회 ────────────────────────────────────────────
// GET /settlement/my-status?pool_id=&month=YYYY-MM
router.get("/settlement/my-status",
  requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, month } = req.query as Record<string, string>;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      const rows = await db.execute(sql`
        SELECT status, total_revenue, auto_amount_snapshot, extra_manual_amount, updated_at
        FROM monthly_settlements
        WHERE pool_id = ${pool_id} AND teacher_user_id = ${userId} AND settlement_month = ${month}
        LIMIT 1
      `);

      if (rows.rows.length === 0) {
        return res.json({ success: true, status: null });
      }
      const row = rows.rows[0] as any;
      return res.json({
        success: true,
        status: row.status,
        total_revenue: row.total_revenue,
        auto_amount_snapshot: row.auto_amount_snapshot,
        updated_at: row.updated_at,
      });
    } catch (e: any) {
      console.error("[settlement/my-status]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 관리자: 선생님별 제출 현황 ──────────────────────────────────────────────
// GET /settlement/reports?pool_id=&month=YYYY-MM
router.get("/settlement/reports",
  requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, month } = req.query as Record<string, string>;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      // 저장된 정산 레코드
      const settleRows = await db.execute(sql`
        SELECT
          ms.teacher_user_id    AS teacher_id,
          ms.teacher_name,
          ms.status,
          ms.total_revenue,
          ms.total_sessions,
          ms.total_makeup_sessions AS makeup_count,
          ms.extra_manual_amount,
          ms.auto_amount_snapshot,
          ms.updated_at,
          (SELECT COUNT(DISTINCT sd.value->>'student_id')
           FROM jsonb_array_elements(ms.student_details) AS sd
          )::int AS student_count
        FROM monthly_settlements ms
        WHERE ms.pool_id = ${pool_id} AND ms.settlement_month = ${month}
      `);

      // 현재 pool-level auto 계산 (has_changed 감지용)
      const currentResult = await calculatePoolSettlement(pool_id, month);
      const currentTeacherMap = new Map(currentResult.teachers.map(t => [t.teacher_id, t]));

      const reports = (settleRows.rows as any[]).map(r => {
        const currentTeacher = currentTeacherMap.get(r.teacher_id);
        const currentAuto = currentTeacher?.allocated_auto_amount ?? null;
        const savedAuto = r.auto_amount_snapshot;
        const hasChanged = savedAuto !== null && currentAuto !== null && savedAuto !== currentAuto;
        return {
          teacher_id: r.teacher_id,
          teacher_name: r.teacher_name,
          status: r.status,
          // 저장된 값
          saved_total_revenue: r.total_revenue,
          saved_auto_amount: savedAuto,
          // 현재 계산값
          current_auto_amount: currentAuto,
          has_changed: hasChanged,
          // 집계
          total_sessions: r.total_sessions,
          student_count: Number(r.student_count),
          makeup_count: r.makeup_count,
          extra_manual_amount: r.extra_manual_amount,
          updated_at: r.updated_at,
        };
      });

      // Pool 전체 집계 (현재 계산 기준)
      const poolSummary = currentResult.pool_summary;
      const savedTotalRevenue = (settleRows.rows as any[]).reduce((s, r) => s + (r.total_revenue || 0), 0);

      return res.json({
        success: true,
        reports,
        pool_summary: poolSummary,
        saved_total_revenue: savedTotalRevenue,
        unpriced_students: currentResult.unpriced_students,
      });
    } catch (e: any) {
      console.error("[settlement/reports]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 정산 이력 조회 ───────────────────────────────────────────────────────────
// GET /settlement/history?pool_id=&teacher_id=
router.get("/settlement/history",
  requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
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
      console.error("[settlement/history]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 정산 확정 ───────────────────────────────────────────────────────────────
// POST /settlement/finalize
router.post("/settlement/finalize",
  requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, month, teacher_id } = req.body;
      const { userId, role } = req.user!;

      // 업무 상태 Source of Truth = status 단일 컬럼
      // is_finalized/finalized_at은 deprecated (DB 컬럼 존재하나 업무 판단에 사용하지 않음)
      if (role === "pool_admin" || role === "super_admin") {
        if (teacher_id) {
          await db.execute(sql`
            UPDATE monthly_settlements
            SET status = 'confirmed', updated_at = now()
            WHERE pool_id = ${pool_id} AND teacher_user_id = ${teacher_id} AND settlement_month = ${month}
          `);
        } else {
          await db.execute(sql`
            UPDATE monthly_settlements
            SET status = 'confirmed', updated_at = now()
            WHERE pool_id = ${pool_id} AND settlement_month = ${month} AND status = 'submitted'
          `);
        }
      } else {
        await db.execute(sql`
          UPDATE monthly_settlements
          SET status = 'confirmed', updated_at = now()
          WHERE pool_id = ${pool_id} AND teacher_user_id = ${userId} AND settlement_month = ${month}
        `);
      }

      if (pool_id) await logChange({
        tenantId: pool_id,
        tableName: "monthly_settlements",
        recordId: `${pool_id}_${month}`,
        changeType: "update",
        payload: { month, status: "confirmed", finalized: true, teacher_id: teacher_id ?? "all" },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error("[settlement/finalize]", e);
      return err(res, 500, e.message);
    }
  }
);

export default router;
