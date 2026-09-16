/**
 * settlement-calculator.ts — 순수 계산 엔진 (DB 접근 없음)
 *
 * 규칙:
 * - DB 접근 금지. 입력 데이터만 받아 계산.
 * - student_auto_amount ≤ monthly_fee
 * - SUM(teacher allocated) === student_auto_amount (Largest-Remainder 보장)
 * - SUM(student auto) === SUM(teacher allocated) (Pool-level invariant)
 */

// ─── 입력 타입 ────────────────────────────────────────────────────────────────

export interface SCHRow {
  student_id: string;
  class_group_id: string;
  enrolled_at: string; // YYYY-MM-DD
  left_at: string | null;
}

export interface CGRow {
  id: string;
  teacher_user_id: string;
  teacher_name: string;
  schedule_days: string; // 예: "월수금", "화목", "월"
}

export interface PricingRow {
  type_key: string;
  monthly_fee: number;
  sessions_per_month: number;
}

export interface StudentRow {
  student_id: string;
  student_name: string;
  weekly_count: number; // 1 | 2 | 3
}

export interface MakeupRow {
  student_id: string;
  assigned_teacher_id: string;
}

// ─── 출력 타입 ────────────────────────────────────────────────────────────────

export interface TeacherAllocation {
  teacher_id: string;
  teacher_name: string;
  regular_slot_count: number;
  allocation_ratio: number; // 0~1, slot / total_regular_slots
  allocated_auto_amount: number; // 항상 SUM = student_auto_amount
}

export interface StudentCalculation {
  student_id: string;
  student_name: string;
  weekly_count: number;
  pricing_status: "priced" | "unpriced";
  monthly_fee: number;
  sessions_per_month: number;
  scheduled_regular_count: number; // 전체 정규 슬롯 (모든 선생님 합산)
  completed_makeup_count: number;
  service_count: number; // scheduled_regular_count + completed_makeup_count
  billable_count: number; // MIN(service_count, sessions_per_month)
  student_auto_amount: number; // ROUND(billable_count × per_session)
  teacher_allocations: TeacherAllocation[];
}

export interface TeacherAggregation {
  teacher_id: string;
  teacher_name: string;
  student_count: number;
  regular_slot_count: number; // 이 선생님이 담당한 전체 slot 수
  completed_makeup_performed_count: number; // 이 선생님이 진행한 보강 수
  allocated_auto_amount: number; // 배분 합계 (저장 전)
}

export interface PoolAggregation {
  student_count: number;
  priced_student_count: number;
  unpriced_student_count: number;
  student_auto_total: number;
  teacher_allocated_auto_total: number; // 항상 === student_auto_total
  allocated_teacher_count: number;
}

// ─── 요일 파싱 ────────────────────────────────────────────────────────────────

const DAY_MAP: Record<string, number> = {
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};

/**
 * "월수금" → [1, 3, 5]  (JS Date.getDay() 기준)
 */
function parseScheduleDays(scheduleDays: string): Set<number> {
  const result = new Set<number>();
  for (const ch of scheduleDays) {
    if (ch in DAY_MAP) result.add(DAY_MAP[ch]);
  }
  return result;
}

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────

function toDate(s: string): Date {
  // YYYY-MM-DD → Date (UTC midnight)
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/**
 * [start, end) 범위에서 targetWeekdays에 해당하는 날짜 수 계산
 */
function countWeekdays(start: Date, end: Date, targetWeekdays: Set<number>): number {
  if (start >= end) return 0;
  let count = 0;
  let cur = new Date(start);
  while (cur < end) {
    if (targetWeekdays.has(cur.getUTCDay())) count++;
    cur = addDays(cur, 1);
  }
  return count;
}

// ─── 핵심 계산 함수 ───────────────────────────────────────────────────────────

/**
 * 학생의 해당 월 반별 정규 슬롯 수 계산
 * 반환: Map<teacher_user_id, slot_count>
 */
export function computeTeacherSlots(
  studentId: string,
  schRows: SCHRow[],
  cgMap: Map<string, CGRow>,
  monthStart: Date, // inclusive
  monthEnd: Date,   // exclusive (다음 달 1일)
): Map<string, { teacherId: string; teacherName: string; slots: number }> {
  const result = new Map<string, { teacherId: string; teacherName: string; slots: number }>();

  for (const row of schRows) {
    if (row.student_id !== studentId) continue;
    const cg = cgMap.get(row.class_group_id);
    if (!cg || !cg.schedule_days) continue;

    // 유효 기간: [enrolled_at, left_at) ∩ [monthStart, monthEnd)
    const enrolledAt = toDate(row.enrolled_at);
    const leftAt = row.left_at ? toDate(row.left_at) : monthEnd;

    const effectiveStart = enrolledAt > monthStart ? enrolledAt : monthStart;
    const effectiveEnd   = leftAt < monthEnd ? leftAt : monthEnd;

    if (effectiveStart >= effectiveEnd) continue;

    const weekdays = parseScheduleDays(cg.schedule_days);
    const slots = countWeekdays(effectiveStart, effectiveEnd, weekdays);

    if (slots === 0) continue;

    const tid = cg.teacher_user_id;
    const existing = result.get(tid);
    if (existing) {
      existing.slots += slots;
    } else {
      result.set(tid, { teacherId: tid, teacherName: cg.teacher_name, slots });
    }
  }

  return result;
}

/**
 * Largest-Remainder 방식으로 teacher allocation 계산
 * 항상 SUM(allocated) === totalAmount 보장
 */
export function allocateToTeachers(
  totalAmount: number,
  teacherSlots: Map<string, { teacherId: string; teacherName: string; slots: number }>,
): TeacherAllocation[] {
  const entries = Array.from(teacherSlots.values());
  const totalSlots = entries.reduce((s, e) => s + e.slots, 0);
  if (totalSlots === 0 || totalAmount === 0) return [];

  // 각 선생님 raw 금액 계산
  const raws = entries.map(e => {
    const raw = (totalAmount * e.slots) / totalSlots;
    return {
      teacherId: e.teacherId,
      teacherName: e.teacherName,
      slots: e.slots,
      ratio: e.slots / totalSlots,
      floor: Math.floor(raw),
      remainder: raw - Math.floor(raw),
    };
  });

  // floor 합계 후 나머지 원 배분 (largest-remainder)
  const floorSum = raws.reduce((s, r) => s + r.floor, 0);
  let leftover = totalAmount - floorSum;

  // 나머지 내림차순 정렬
  raws.sort((a, b) => b.remainder - a.remainder || b.slots - a.slots);

  const result: TeacherAllocation[] = raws.map(r => ({
    teacher_id: r.teacherId,
    teacher_name: r.teacherName,
    regular_slot_count: r.slots,
    allocation_ratio: r.ratio,
    allocated_auto_amount: r.floor + (leftover-- > 0 ? 1 : 0),
  }));

  return result;
}

/**
 * 학생 1명의 정산 계산
 */
export function computeStudentCalculation(
  student: StudentRow,
  pricing: PricingRow | null,
  teacherSlots: Map<string, { teacherId: string; teacherName: string; slots: number }>,
  completedMakeupCount: number,
): StudentCalculation {
  const pricingStatus: "priced" | "unpriced" = pricing ? "priced" : "unpriced";
  const monthlyFee = pricing?.monthly_fee ?? 0;
  const sessionsPerMonth = pricing?.sessions_per_month ?? 0;

  const scheduledRegularCount = Array.from(teacherSlots.values()).reduce((s, e) => s + e.slots, 0);
  const serviceCount = scheduledRegularCount + completedMakeupCount;
  const billableCount = sessionsPerMonth > 0
    ? Math.min(serviceCount, sessionsPerMonth)
    : serviceCount;

  let studentAutoAmount = 0;
  if (pricing && sessionsPerMonth > 0) {
    const perSession = monthlyFee / sessionsPerMonth;
    studentAutoAmount = Math.round(billableCount * perSession);
    // INVARIANT: auto ≤ monthly_fee
    if (studentAutoAmount > monthlyFee) studentAutoAmount = monthlyFee;
  }

  // 매출 배분은 정규 슬롯 비율만 (makeup 진행 선생님 제외)
  const teacherAllocations = pricing
    ? allocateToTeachers(studentAutoAmount, teacherSlots)
    : [];

  return {
    student_id: student.student_id,
    student_name: student.student_name,
    weekly_count: student.weekly_count,
    pricing_status: pricingStatus,
    monthly_fee: monthlyFee,
    sessions_per_month: sessionsPerMonth,
    scheduled_regular_count: scheduledRegularCount,
    completed_makeup_count: completedMakeupCount,
    service_count: serviceCount,
    billable_count: billableCount,
    student_auto_amount: studentAutoAmount,
    teacher_allocations: teacherAllocations,
  };
}

/**
 * 선생님별 집계
 */
export function aggregateByTeacher(
  students: StudentCalculation[],
  makeupRows: MakeupRow[],
): TeacherAggregation[] {
  const map = new Map<string, TeacherAggregation>();

  for (const s of students) {
    for (const alloc of s.teacher_allocations) {
      const existing = map.get(alloc.teacher_id);
      if (existing) {
        existing.student_count++;
        existing.regular_slot_count += alloc.regular_slot_count;
        existing.allocated_auto_amount += alloc.allocated_auto_amount;
      } else {
        map.set(alloc.teacher_id, {
          teacher_id: alloc.teacher_id,
          teacher_name: alloc.teacher_name,
          student_count: 1,
          regular_slot_count: alloc.regular_slot_count,
          completed_makeup_performed_count: 0,
          allocated_auto_amount: alloc.allocated_auto_amount,
        });
      }
    }
  }

  // 완료 보강 진행 선생님 집계 (매출 배분 없음, 운영 지표만)
  for (const mk of makeupRows) {
    const tid = mk.assigned_teacher_id;
    if (!map.has(tid)) {
      // 정규 슬롯은 없고 보강만 진행한 선생님
      map.set(tid, {
        teacher_id: tid,
        teacher_name: "",
        student_count: 0,
        regular_slot_count: 0,
        completed_makeup_performed_count: 1,
        allocated_auto_amount: 0,
      });
    } else {
      map.get(tid)!.completed_makeup_performed_count++;
    }
  }

  return Array.from(map.values());
}

/**
 * Pool 전체 집계
 * INVARIANT: student_auto_total === teacher_allocated_auto_total
 */
export function aggregatePool(
  students: StudentCalculation[],
  teachers: TeacherAggregation[],
): PoolAggregation {
  const pricedStudents = students.filter(s => s.pricing_status === "priced");
  const unpricedStudents = students.filter(s => s.pricing_status === "unpriced");

  const studentAutoTotal = pricedStudents.reduce((s, st) => s + st.student_auto_amount, 0);
  const teacherAllocatedTotal = teachers.reduce((s, t) => s + t.allocated_auto_amount, 0);

  return {
    student_count: students.length,
    priced_student_count: pricedStudents.length,
    unpriced_student_count: unpricedStudents.length,
    student_auto_total: studentAutoTotal,
    teacher_allocated_auto_total: teacherAllocatedTotal,
    allocated_teacher_count: teachers.filter(t => t.allocated_auto_amount > 0).length,
  };
}
