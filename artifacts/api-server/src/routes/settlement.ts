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
// V2 contract:
//   { month, adjustments?: [{ student_id, adjustment_amount, adjustment_reason?, adjustment_memo? }] }
// Legacy compat:
//   { pool_id?, month, student_adjustments?, extra_manual_amount?, extra_manual_memo? }
//
// 클라이언트는 사람이 입력한 adjustment만 보냅니다.
// 서버가 Settlement Service로 AUTO 재계산 후 저장합니다.
// 클라이언트가 보낸 allocated_amount / final_amount 등 계산값은 무시합니다.
router.post("/settlement/save",
  requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        pool_id: rawPoolId,
        month,
        // V2: adjustments
        adjustments,
        // Legacy compat: student_adjustments
        student_adjustments,
        // Legacy: extra_manual fields (보존, 이중합산 없음)
        extra_manual_amount = 0,
        extra_manual_memo = null,
      } = req.body;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      // [A] confirmed 보호: confirmed 정산은 재저장 불가
      const existing = await db.execute(sql`
        SELECT status FROM monthly_settlements
        WHERE pool_id = ${pool_id} AND teacher_user_id = ${userId} AND settlement_month = ${month}
        LIMIT 1
      `);
      if ((existing.rows[0] as any)?.status === "confirmed") {
        return res.status(409).json({
          success: false,
          error_code: "SETTLEMENT_CONFIRMED",
          message: "관리자가 확인한 정산은 수정할 수 없습니다.",
        });
      }

      // [B] 서버 재계산 (클라이언트 계산값 무시)
      const result = await calculateTeacherSettlement(pool_id, month, userId!);

      // [C] unpriced 학생 존재 시 저장 차단
      if (result.unpriced_students.length > 0) {
        return res.status(422).json({
          success: false,
          error_code: "PRICING_NOT_CONFIGURED",
          message: "센터 수업료 설정이 필요한 회원이 있습니다.",
          unpriced_count: result.unpriced_students.length,
          unpriced_students: result.unpriced_students.map(s => ({
            student_id: s.student_id,
            student_name: s.student_name,
          })),
        });
      }

      // [D] adjustment Map 구성 (V2: adjustments 우선, fallback: student_adjustments)
      const adjSource: any[] = adjustments ?? student_adjustments ?? [];
      const adjMap = new Map<string, { amount: number; reason?: string; memo?: string }>();
      for (const adj of adjSource) {
        const sid = adj.student_id;
        if (!sid) continue;
        // [E] student_id가 실제 해당 teacher settlement에 존재하는지 검증
        const validIds = new Set(result.students.map(s => s.student_id));
        if (!validIds.has(sid)) continue;
        adjMap.set(sid, {
          amount: Number(adj.adjustment_amount) || 0,
          reason: adj.adjustment_reason,
          memo: adj.adjustment_memo,
        });
      }

      // [F] student_details V2 snapshot — 서버 계산값만 사용
      const studentDetails = result.students.map(s => {
        const myAlloc = s.teacher_allocations.find(a => a.teacher_id === userId) ?? null;
        const adj = adjMap.get(s.student_id);
        const allocatedAmount = myAlloc?.allocated_auto_amount ?? 0;
        const adjustmentAmount = adj?.amount ?? 0;
        return {
          // 식별자
          student_id: s.student_id,
          student_name: s.student_name,
          weekly_count: s.weekly_count,
          // 가격정책 (서버 재계산값)
          pricing_status: s.pricing_status,
          monthly_fee: s.monthly_fee,
          sessions_per_month: s.sessions_per_month,
          // 시간표 (서버 재계산값)
          regular_slot_count: myAlloc?.regular_slot_count ?? 0,
          total_regular_slots: s.scheduled_regular_count,
          completed_makeup_count: s.completed_makeup_count,
          billable_count: s.billable_count,
          // 매출 (서버 재계산값)
          student_auto_amount: s.student_auto_amount,
          allocation_ratio: myAlloc?.allocation_ratio ?? 0,
          allocated_auto_amount: allocatedAmount,
          // 조정 (사용자 입력값)
          adjustment_amount: adjustmentAmount,
          adjustment_reason: adj?.reason ?? null,
          adjustment_memo: adj?.memo ?? null,
          // 최종 (서버 확정)
          final_amount: allocatedAmount + adjustmentAmount,
        };
      });

      // [G] 집계 — status는 항상 submitted (V2)
      const autoAmountSnapshot = result.teacher_aggregation?.allocated_auto_amount ?? 0;
      const totalFinalRevenue = studentDetails.reduce((s, d) => s + d.final_amount, 0);
      const totalSessions = result.teacher_aggregation?.regular_slot_count ?? 0;
      const totalMakeupSessions = result.teacher_aggregation?.completed_makeup_performed_count ?? 0;

      // [H] DB 저장
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
          'submitted', 0, 0,
          ${autoAmountSnapshot}, now()
        )
        ON CONFLICT (pool_id, teacher_user_id, settlement_month) DO UPDATE SET
          total_revenue            = EXCLUDED.total_revenue,
          total_sessions           = EXCLUDED.total_sessions,
          total_makeup_sessions    = EXCLUDED.total_makeup_sessions,
          extra_manual_amount      = EXCLUDED.extra_manual_amount,
          extra_manual_memo        = EXCLUDED.extra_manual_memo,
          student_details          = EXCLUDED.student_details,
          status                   = 'submitted',
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
        payload: { month, status: "submitted", teacher: userId },
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
// 반환: status, total_revenue, auto_amount_snapshot, current_auto_amount, has_changed, updated_at
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
        SELECT status, total_revenue, auto_amount_snapshot, updated_at
        FROM monthly_settlements
        WHERE pool_id = ${pool_id} AND teacher_user_id = ${userId} AND settlement_month = ${month}
        LIMIT 1
      `);

      if (rows.rows.length === 0) {
        return res.json({ success: true, status: null, has_changed: false });
      }
      const row = rows.rows[0] as any;

      // 현재 서버 AUTO 계산값 (has_changed 감지용)
      let currentAutoAmount: number | null = null;
      let hasChanged = false;
      try {
        const current = await calculateTeacherSettlement(pool_id, month, userId!);
        currentAutoAmount = current.teacher_aggregation?.allocated_auto_amount ?? 0;
        const savedAuto = row.auto_amount_snapshot;
        hasChanged = savedAuto !== null && currentAutoAmount !== null && savedAuto !== currentAutoAmount;
      } catch { /* has_changed 계산 실패 시 무시 */ }

      return res.json({
        success: true,
        status: row.status,
        total_revenue: row.total_revenue,
        auto_amount_snapshot: row.auto_amount_snapshot,
        current_auto_amount: currentAutoAmount,
        has_changed: hasChanged,
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

// ─── 관리자 전체 뷰 ──────────────────────────────────────────────────────────
// GET /settlement/admin-overview?pool_id=&month=YYYY-MM
// 반환: teachers(reflected_amount 포함), pool 집계, unpriced_students
router.get("/settlement/admin-overview",
  requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, month } = req.query as Record<string, string>;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      // 1. 현재 자동 계산 (Source of Truth)
      const current = await calculatePoolSettlement(pool_id, month);

      // 2. 저장된 정산 레코드
      const savedRows = await db.execute(sql`
        SELECT
          teacher_user_id AS teacher_id,
          teacher_name,
          status,
          total_revenue,
          auto_amount_snapshot,
          total_sessions,
          total_makeup_sessions AS makeup_count,
          updated_at
        FROM monthly_settlements
        WHERE pool_id = ${pool_id} AND settlement_month = ${month}
      `);
      const savedMap = new Map((savedRows.rows as any[]).map(r => [r.teacher_id, r]));

      // 3. Teacher별 병합 — 계산식 없음, 정책만 적용
      const teacherRows = current.teachers.map((t: any) => {
        const saved = savedMap.get(t.teacher_id) as any ?? null;
        const status: string | null = saved?.status ?? null;
        const currentAuto = t.allocated_auto_amount ?? 0;
        const savedAuto = saved?.auto_amount_snapshot ?? null;
        const savedTotal = saved?.total_revenue ?? null;
        const hasChanged = savedAuto !== null && currentAuto !== null && savedAuto !== currentAuto;

        // reflected_amount 정책: 저장 없음→currentAuto, submitted/confirmed→savedTotal
        const reflectedAmount = (status === "submitted" || status === "confirmed")
          ? (savedTotal ?? 0)
          : currentAuto;
        // adjustment = savedTotal - savedAuto (저장된 경우만)
        const adjustmentTotal = (savedTotal !== null && savedAuto !== null)
          ? (savedTotal - savedAuto)
          : 0;

        let statusLabel: string;
        if (status === "confirmed") statusLabel = "관리자 확인";
        else if (status === "submitted") statusLabel = "저장됨";
        else statusLabel = "정산 전";

        return {
          teacher_id: t.teacher_id,
          teacher_name: saved?.teacher_name || t.teacher_name || "",
          status,
          status_label: statusLabel,
          has_changed: hasChanged,
          student_count: t.student_count ?? 0,
          regular_slot_count: t.regular_slot_count ?? 0,
          makeup_count: t.completed_makeup_performed_count ?? 0,
          auto_amount: currentAuto,
          adjustment_total: adjustmentTotal,
          reflected_amount: reflectedAmount,
          updated_at: saved?.updated_at ?? null,
        };
      });

      // 4. Pool 집계 — server에서 반환 (frontend 계산 없음)
      const poolAutoTotal = current.pool_summary.teacher_allocated_auto_total ?? 0;
      const poolReflectedTotal = teacherRows.reduce((s: number, t: any) => s + t.reflected_amount, 0);
      const poolAdjustmentTotal = teacherRows.reduce((s: number, t: any) => s + t.adjustment_total, 0);

      return res.json({
        success: true,
        month,
        pool_id,
        teachers: teacherRows,
        pool_summary: {
          ...current.pool_summary,
          pool_auto_total: poolAutoTotal,
          pool_adjustment_total: poolAdjustmentTotal,
          pool_reflected_total: poolReflectedTotal,
        },
        unpriced_students: current.unpriced_students,
      });
    } catch (e: any) {
      console.error("[settlement/admin-overview]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 관리자 선생님 상세 ───────────────────────────────────────────────────────
// GET /settlement/admin-teacher-detail?pool_id=&teacher_id=&month=YYYY-MM
router.get("/settlement/admin-teacher-detail",
  requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id: rawPoolId, teacher_id, month } = req.query as Record<string, string>;
      const { userId } = req.user!;
      if (!month) return err(res, 400, "month가 필요합니다.");
      if (!teacher_id) return err(res, 400, "teacher_id가 필요합니다.");
      const pool_id = rawPoolId || (await getPoolId(userId!)) || "";
      if (!pool_id) return err(res, 400, "pool_id를 찾을 수 없습니다.");

      const savedRow = await db.execute(sql`
        SELECT status, total_revenue, auto_amount_snapshot, student_details, total_sessions, total_makeup_sessions, updated_at
        FROM monthly_settlements
        WHERE pool_id = ${pool_id} AND teacher_user_id = ${teacher_id} AND settlement_month = ${month}
        LIMIT 1
      `);
      const saved = (savedRow.rows[0] as any) ?? null;

      let students: any[] = [];
      let autoAmount = 0;

      if (saved && (saved.status === "submitted" || saved.status === "confirmed")) {
        // 저장된 student_details 사용
        const raw = saved.student_details;
        students = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : []);
        autoAmount = saved.auto_amount_snapshot ?? 0;
      } else {
        // 미저장: calculator로 현재 자동 계산
        const calc = await calculateTeacherSettlement(pool_id, month, teacher_id);
        autoAmount = calc.teacher_aggregation?.allocated_auto_amount ?? 0;
        students = (calc.students as any[]).map(s => {
          const myAlloc = (s.teacher_allocations as any[]).find((a: any) => a.teacher_id === teacher_id);
          return {
            student_id: s.student_id,
            student_name: s.student_name,
            weekly_count: s.weekly_count,
            pricing_status: s.pricing_status,
            monthly_fee: s.monthly_fee,
            sessions_per_month: s.sessions_per_month,
            regular_slot_count: myAlloc?.regular_slot_count ?? 0,
            total_regular_slots: s.scheduled_regular_count,
            completed_makeup_count: s.completed_makeup_count,
            billable_count: s.billable_count,
            student_auto_amount: s.student_auto_amount,
            allocation_ratio: myAlloc?.allocation_ratio ?? 0,
            allocated_auto_amount: myAlloc?.allocated_auto_amount ?? 0,
            adjustment_amount: 0,
            final_amount: myAlloc?.allocated_auto_amount ?? 0,
          };
        });
      }

      return res.json({
        success: true,
        teacher_id,
        month,
        status: saved?.status ?? null,
        auto_amount: autoAmount,
        students,
      });
    } catch (e: any) {
      console.error("[settlement/admin-teacher-detail]", e);
      return err(res, 500, e.message);
    }
  }
);

// ─── 정산 확정 ───────────────────────────────────────────────────────────────
// POST /settlement/finalize
// 관리자: submitted + has_changed=false인 경우만 confirmed 처리
router.post("/settlement/finalize",
  requireAuth, requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, month, teacher_id } = req.body;
      const { userId, role } = req.user!;

      // 업무 상태 Source of Truth = status 단일 컬럼
      if (role === "pool_admin" || role === "super_admin") {
        if (teacher_id) {
          // 단일 선생님 확정 — 상태 및 has_changed 검증
          const row = await db.execute(sql`
            SELECT status, auto_amount_snapshot FROM monthly_settlements
            WHERE pool_id = ${pool_id} AND teacher_user_id = ${teacher_id} AND settlement_month = ${month}
            LIMIT 1
          `);
          const r = row.rows[0] as any;
          if (!r) return res.status(404).json({ success: false, message: "정산 레코드가 없습니다.", error_code: "NOT_FOUND" });
          if (r.status !== "submitted") {
            return res.status(409).json({ success: false, message: "저장된 정산만 확인할 수 있습니다.", error_code: "NOT_SUBMITTED" });
          }
          // has_changed 검증: 현재 AUTO와 저장 snapshot 비교
          try {
            const currentCalc = await calculateTeacherSettlement(pool_id, month, teacher_id);
            const currentAuto = currentCalc.teacher_aggregation?.allocated_auto_amount ?? 0;
            if (r.auto_amount_snapshot !== null && r.auto_amount_snapshot !== currentAuto) {
              return res.status(409).json({
                success: false,
                message: "저장 후 회원/시간표 정보가 변경되었습니다. 선생님이 정산을 다시 저장해야 합니다.",
                error_code: "HAS_CHANGED",
              });
            }
          } catch { /* has_changed 계산 실패 시 무시하고 진행 */ }

          await db.execute(sql`
            UPDATE monthly_settlements
            SET status = 'confirmed', updated_at = now()
            WHERE pool_id = ${pool_id} AND teacher_user_id = ${teacher_id} AND settlement_month = ${month}
              AND status = 'submitted'
          `);
        } else {
          // 전체 확정 — submitted만, has_changed 검증 생략 (bulk)
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
