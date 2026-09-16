/**
 * settlement-service.ts — 정산 데이터 로드 + 계산 진입점
 *
 * DB에서 필요한 데이터를 로드하고 settlement-calculator 함수들을 호출합니다.
 * Route handler는 이 파일의 함수만 호출합니다.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  SCHRow,
  CGRow,
  StudentRow,
  PricingRow,
  MakeupRow,
  StudentCalculation,
  TeacherAggregation,
  PoolAggregation,
  computeTeacherSlots,
  computeStudentCalculation,
  aggregateByTeacher,
  aggregatePool,
} from "./settlement-calculator.js";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface CanonicalSettlementResult {
  month: string;
  pool_id: string;
  students: StudentCalculation[];
  unpriced_students: StudentCalculation[];
  teachers: TeacherAggregation[];
  pool_summary: PoolAggregation;
}

export interface TeacherSettlementResult {
  month: string;
  pool_id: string;
  teacher_id: string;
  students: StudentCalculation[];
  unpriced_students: StudentCalculation[];
  teacher_aggregation: TeacherAggregation | null;
  pool_summary: PoolAggregation;
}

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────

function monthBounds(month: string): { monthStart: Date; monthEnd: Date } {
  const [y, m] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 1)); // 다음 달 1일 (exclusive)
  return { monthStart, monthEnd };
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── DB 데이터 로드 ───────────────────────────────────────────────────────────

async function loadPoolData(poolId: string, month: string) {
  const { monthStart, monthEnd } = monthBounds(month);
  const monthStartStr = toYMD(monthStart);
  const monthEndStr = toYMD(monthEnd);

  // 1. 활성 학생 목록 (해당 pool의 삭제되지 않은 학생)
  const studentRows = await db.execute(sql`
    SELECT DISTINCT s.id AS student_id, s.name AS student_name, s.weekly_count
    FROM students s
    JOIN student_class_history h ON h.student_id = s.id
    JOIN class_groups cg ON cg.id = h.class_group_id
    WHERE s.swimming_pool_id = ${poolId}
      AND s.deleted_at IS NULL
      AND cg.is_deleted = false
      AND h.enrolled_at < ${monthEndStr}
      AND (h.left_at IS NULL OR h.left_at > ${monthStartStr})
    ORDER BY s.name
  `);

  // 2. 가격표
  const pricingRows = await db.execute(sql`
    SELECT type_key, monthly_fee, sessions_per_month
    FROM pool_class_pricing
    WHERE pool_id = ${poolId} AND is_active = true
  `);

  // 3. student_class_history (해당 월에 겹치는 이력)
  const schRows = await db.execute(sql`
    SELECT h.student_id, h.class_group_id, h.enrolled_at::text, h.left_at::text
    FROM student_class_history h
    JOIN class_groups cg ON cg.id = h.class_group_id
    WHERE cg.swimming_pool_id = ${poolId}
      AND cg.is_deleted = false
      AND h.enrolled_at < ${monthEndStr}
      AND (h.left_at IS NULL OR h.left_at > ${monthStartStr})
  `);

  // 4. class_groups (schedule_days, teacher_user_id, teacher_name)
  const cgRows = await db.execute(sql`
    SELECT cg.id, cg.teacher_user_id, cg.schedule_days,
           COALESCE(u.name, '선생님') AS teacher_name
    FROM class_groups cg
    LEFT JOIN users u ON u.id = cg.teacher_user_id
    WHERE cg.swimming_pool_id = ${poolId}
      AND cg.is_deleted = false
  `);

  // 5. 완료 보강 (해당 월)
  const makeupRows = await db.execute(sql`
    SELECT student_id, assigned_teacher_id
    FROM makeup_sessions
    WHERE swimming_pool_id = ${poolId}
      AND assigned_date >= ${monthStartStr}
      AND assigned_date < ${monthEndStr}
      AND status = 'completed'
  `);

  return {
    monthStart,
    monthEnd,
    students: studentRows.rows as unknown as StudentRow[],
    pricing: pricingRows.rows as unknown as PricingRow[],
    sch: schRows.rows as unknown as SCHRow[],
    cg: cgRows.rows as unknown as CGRow[],
    makeup: makeupRows.rows as unknown as MakeupRow[],
  };
}

// ─── 핵심 진입점 ──────────────────────────────────────────────────────────────

/**
 * pool 전체 정산 계산 (관리자용 / PC용)
 * GET /settlement/reports 등에서 사용
 */
export async function calculatePoolSettlement(
  poolId: string,
  month: string,
): Promise<CanonicalSettlementResult> {
  const { monthStart, monthEnd, students, pricing, sch, cg, makeup } =
    await loadPoolData(poolId, month);

  // pricing Map: type_key → PricingRow
  const pricingMap = new Map<string, PricingRow>();
  for (const p of pricing) pricingMap.set(p.type_key, p);

  // class_groups Map: id → CGRow
  const cgMap = new Map<string, CGRow>();
  for (const g of cg) cgMap.set(g.id, g);

  // makeup count per student
  const makeupCountMap = new Map<string, number>();
  for (const mk of makeup) {
    makeupCountMap.set(mk.student_id, (makeupCountMap.get(mk.student_id) ?? 0) + 1);
  }

  // 학생별 계산
  const allCalcs: StudentCalculation[] = [];
  for (const s of students) {
    const typeKey = `weekly_${s.weekly_count}`;
    const pricingRow = pricingMap.get(typeKey) ?? null;
    const teacherSlots = computeTeacherSlots(s.student_id, sch, cgMap, monthStart, monthEnd);
    const makeupCount = makeupCountMap.get(s.student_id) ?? 0;
    const calc = computeStudentCalculation(s, pricingRow, teacherSlots, makeupCount);
    allCalcs.push(calc);
  }

  const pricedStudents = allCalcs.filter(s => s.pricing_status === "priced");
  const unpricedStudents = allCalcs.filter(s => s.pricing_status === "unpriced");

  const teachers = aggregateByTeacher(allCalcs, makeup);
  const poolSummary = aggregatePool(allCalcs, teachers);

  return {
    month,
    pool_id: poolId,
    students: pricedStudents,
    unpriced_students: unpricedStudents,
    teachers,
    pool_summary: poolSummary,
  };
}

/**
 * 선생님 1명 기준 정산 계산 (선생님 자신용)
 * GET /settlement/calculator에서 사용
 */
export async function calculateTeacherSettlement(
  poolId: string,
  month: string,
  teacherId: string,
): Promise<TeacherSettlementResult> {
  const { monthStart, monthEnd, students, pricing, sch, cg, makeup } =
    await loadPoolData(poolId, month);

  // pricing Map
  const pricingMap = new Map<string, PricingRow>();
  for (const p of pricing) pricingMap.set(p.type_key, p);

  // class_groups Map
  const cgMap = new Map<string, CGRow>();
  for (const g of cg) cgMap.set(g.id, g);

  // makeup count per student (pool 전체)
  const makeupCountMap = new Map<string, number>();
  for (const mk of makeup) {
    makeupCountMap.set(mk.student_id, (makeupCountMap.get(mk.student_id) ?? 0) + 1);
  }

  // 이 선생님에게 배분이 있는 학생만 필터
  const allCalcs: StudentCalculation[] = [];
  for (const s of students) {
    const typeKey = `weekly_${s.weekly_count}`;
    const pricingRow = pricingMap.get(typeKey) ?? null;
    const teacherSlots = computeTeacherSlots(s.student_id, sch, cgMap, monthStart, monthEnd);

    // 이 선생님의 슬롯이 있는 학생만 포함
    if (!teacherSlots.has(teacherId)) continue;

    const makeupCount = makeupCountMap.get(s.student_id) ?? 0;
    const calc = computeStudentCalculation(s, pricingRow, teacherSlots, makeupCount);
    allCalcs.push(calc);
  }

  const pricedStudents = allCalcs.filter(s => s.pricing_status === "priced");
  const unpricedStudents = allCalcs.filter(s => s.pricing_status === "unpriced");

  // 이 선생님이 진행한 완료 보강
  const myMakeup = makeup.filter(mk => mk.assigned_teacher_id === teacherId);

  const teachers = aggregateByTeacher(allCalcs, myMakeup);
  const myAggregation = teachers.find(t => t.teacher_id === teacherId) ?? null;
  const poolSummary = aggregatePool(allCalcs, teachers);

  return {
    month,
    pool_id: poolId,
    teacher_id: teacherId,
    students: pricedStudents,
    unpriced_students: unpricedStudents,
    teacher_aggregation: myAggregation,
    pool_summary: poolSummary,
  };
}
