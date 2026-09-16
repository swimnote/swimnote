import {
  computeTeacherSlots, computeStudentCalculation,
  allocateToTeachers, aggregateByTeacher, aggregatePool,
  type SCHRow, type CGRow, type PricingRow, type StudentRow, type MakeupRow,
} from "../settlement-calculator.js";

const PASS = (label: string) => console.log(`✅ ${label}`);
const FAIL = (label: string, got: any, exp: any) => { console.log(`❌ ${label} — got=${got} exp=${exp}`); process.exitCode = 1; };

const monthStart = new Date(Date.UTC(2026, 8, 1));
const monthEnd   = new Date(Date.UTC(2026, 9, 1));
const p2: PricingRow = { type_key:"weekly_2", monthly_fee:220000, sessions_per_month:8 };
const p1: PricingRow = { type_key:"weekly_1", monthly_fee:140000, sessions_per_month:4 };

// ── CASE A: 주2 김선생(월수금) 박선생(화목) → CAP 8, student_auto=220,000
const schA: SCHRow[] = [
  { student_id:"s1", class_group_id:"cg1", enrolled_at:"2026-09-01", left_at:null },
  { student_id:"s1", class_group_id:"cg2", enrolled_at:"2026-09-01", left_at:null },
];
const cgMapA = new Map<string,CGRow>([
  ["cg1",{ id:"cg1", teacher_user_id:"tA", teacher_name:"김선생", schedule_days:"월수금" }],
  ["cg2",{ id:"cg2", teacher_user_id:"tB", teacher_name:"박선생", schedule_days:"화목" }],
]);
const slotsA = computeTeacherSlots("s1", schA, cgMapA, monthStart, monthEnd);
const calcA = computeStudentCalculation({ student_id:"s1", student_name:"홍길동", weekly_count:2 }, p2, slotsA, 0);
const sumA = calcA.teacher_allocations.reduce((s,a) => s+a.allocated_auto_amount, 0);
console.log(`\n[CASE A] 김선생(월수금) 박선생(화목)`);
console.log(`  scheduled_regular_count=${calcA.scheduled_regular_count} billable=${calcA.billable_count} auto=${calcA.student_auto_amount}`);
calcA.teacher_allocations.forEach(a => console.log(`  ${a.teacher_name}: slot=${a.regular_slot_count} amount=${a.allocated_auto_amount}`));
calcA.student_auto_amount === 220000 ? PASS("auto=220,000") : FAIL("auto=220,000", calcA.student_auto_amount, 220000);
sumA === calcA.student_auto_amount ? PASS(`SUM(alloc)=student_auto`) : FAIL("SUM(alloc)=student_auto", sumA, calcA.student_auto_amount);

// ── CASE B: 김5 박4 → 5:4 배분, SUM=220,000
const slotsB = new Map([
  ["tA",{ teacherId:"tA", teacherName:"김선생", slots:5 }],
  ["tB",{ teacherId:"tB", teacherName:"박선생", slots:4 }],
]);
const calcB = computeStudentCalculation({ student_id:"s2", student_name:"이도령", weekly_count:2 }, p2, slotsB, 0);
const sumB = calcB.teacher_allocations.reduce((s,a) => s+a.allocated_auto_amount, 0);
console.log(`\n[CASE B] 김5:박4 CAP=8`);
calcB.teacher_allocations.forEach(a => console.log(`  ${a.teacher_name}: ${a.allocated_auto_amount}`));
sumB === 220000 ? PASS("SUM=220,000") : FAIL("SUM=220,000", sumB, 220000);

// ── CASE D: 보강1 → service=6 billable=MIN(6,4)=4, 배분은 정규 3:2
const slotsD = new Map([
  ["tA",{ teacherId:"tA", teacherName:"김선생", slots:3 }],
  ["tB",{ teacherId:"tB", teacherName:"박선생", slots:2 }],
]);
const calcD = computeStudentCalculation({ student_id:"s3", student_name:"성춘향", weekly_count:1 }, p1, slotsD, 1);
const sumD = calcD.teacher_allocations.reduce((s,a) => s+a.allocated_auto_amount, 0);
console.log(`\n[CASE D] 정규3+2 보강1 → billable=4`);
console.log(`  service=${calcD.service_count} billable=${calcD.billable_count} auto=${calcD.student_auto_amount}`);
calcD.teacher_allocations.forEach(a => console.log(`  ${a.teacher_name}: slot=${a.regular_slot_count} amount=${a.allocated_auto_amount}`));
calcD.service_count === 6 ? PASS("service_count=6") : FAIL("service_count=6", calcD.service_count, 6);
calcD.billable_count === 4 ? PASS("billable_count=4") : FAIL("billable_count=4", calcD.billable_count, 4);
sumD === calcD.student_auto_amount ? PASS("SUM(alloc)=student_auto") : FAIL("SUM(alloc)=student_auto", sumD, calcD.student_auto_amount);

// ── ROUNDING: 220,000 × 5/9 + 4/9 = exactly 220,000
const slotsR = new Map([
  ["t1",{ teacherId:"t1", teacherName:"김", slots:5 }],
  ["t2",{ teacherId:"t2", teacherName:"박", slots:4 }],
]);
const allocsR = allocateToTeachers(220000, slotsR);
const sumR = allocsR.reduce((s,a) => s+a.allocated_auto_amount, 0);
console.log(`\n[ROUNDING] 220,000 × 5/9 + 4/9`);
allocsR.forEach(a => console.log(`  ${a.teacher_name}: ${a.allocated_auto_amount}`));
sumR === 220000 ? PASS("SUM=exactly 220,000") : FAIL("SUM=exactly 220,000", sumR, 220000);

// ── INVARIANT: auto ≤ monthly_fee (10회 수업해도 4회 CAP)
const slotsBig = new Map([["t1",{ teacherId:"t1", teacherName:"김", slots:10 }]]);
const calcBig = computeStudentCalculation({ student_id:"sB", student_name:"홍", weekly_count:1 }, p1, slotsBig, 0);
console.log(`\n[INVARIANT] 10회 수업 → billable=4, auto≤140,000`);
calcBig.billable_count === 4 ? PASS("billable=4 (CAP)") : FAIL("billable=4", calcBig.billable_count, 4);
(calcBig.student_auto_amount ?? 0) <= 140000 ? PASS("auto≤140,000") : FAIL("auto≤140,000", calcBig.student_auto_amount, "≤140000");

// ── POOL INVARIANT: student_auto_total === teacher_allocated_auto_total
const mkRows: MakeupRow[] = [{ student_id:"s3", assigned_teacher_id:"tC" }];
const teachers = aggregateByTeacher([calcA, calcB, calcD], mkRows);
const pool = aggregatePool([calcA, calcB, calcD], teachers);
console.log(`\n[POOL] student_auto_total=${pool.student_auto_total} teacher_alloc_total=${pool.teacher_allocated_auto_total}`);
pool.student_auto_total === pool.teacher_allocated_auto_total ? PASS("Pool invariant") : FAIL("Pool invariant", pool.student_auto_total, pool.teacher_allocated_auto_total);
console.log(`  unpriced=${pool.unpriced_student_count}`);

console.log("\n=== 테스트 완료 ===");
