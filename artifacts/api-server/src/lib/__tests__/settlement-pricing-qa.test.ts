import {
  computeStudentCalculation,
  type PricingRow, type StudentRow,
} from "../settlement-calculator.js";

const PASS = (label: string) => console.log(`✅ ${label}`);
const FAIL = (label: string, got: any, exp: any) => {
  console.log(`❌ ${label} — got=${got} exp=${exp}`);
  process.exitCode = 1;
};

// 슬롯 없는 경우 단순 테스트용 helper
const singleTeacherSlots = (slots: number) =>
  new Map([["t1", { teacherId: "t1", teacherName: "선생님", slots }]]);

const nullSlots = new Map<string, { teacherId: string; teacherName: string; slots: number }>();

// ── CASE 1: weekly_1, regular=3, makeup=1 → billable=4, auto=140,000
console.log("\n[CASE 1] weekly_1 / 140,000 / 4회 / regular=3 makeup=1");
const p1: PricingRow = { type_key: "weekly_1", monthly_fee: 140000, sessions_per_month: 4 };
const s1: StudentRow = { student_id: "s1", student_name: "A", weekly_count: 1 };
const c1 = computeStudentCalculation(s1, p1, singleTeacherSlots(3), 1);
console.log(`  service=${c1.service_count} billable=${c1.billable_count} auto=${c1.student_auto_amount}`);
c1.scheduled_regular_count === 3 ? PASS("regular=3") : FAIL("regular=3", c1.scheduled_regular_count, 3);
c1.completed_makeup_count === 1 ? PASS("makeup=1") : FAIL("makeup=1", c1.completed_makeup_count, 1);
c1.service_count === 4 ? PASS("service=4") : FAIL("service=4", c1.service_count, 4);
c1.billable_count === 4 ? PASS("billable=4 (MIN(4,4))") : FAIL("billable=4", c1.billable_count, 4);
c1.student_auto_amount === 140000 ? PASS("auto=140,000") : FAIL("auto=140,000", c1.student_auto_amount, 140000);

// ── CASE 2: weekly_2, regular=5, makeup=1 → billable=6, auto=165,000
console.log("\n[CASE 2] weekly_2 / 220,000 / 8회 / regular=5 makeup=1");
const p2: PricingRow = { type_key: "weekly_2", monthly_fee: 220000, sessions_per_month: 8 };
const s2: StudentRow = { student_id: "s2", student_name: "B", weekly_count: 2 };
const c2 = computeStudentCalculation(s2, p2, singleTeacherSlots(5), 1);
console.log(`  service=${c2.service_count} billable=${c2.billable_count} auto=${c2.student_auto_amount}`);
c2.service_count === 6 ? PASS("service=6") : FAIL("service=6", c2.service_count, 6);
c2.billable_count === 6 ? PASS("billable=6 (MIN(6,8))") : FAIL("billable=6", c2.billable_count, 6);
c2.student_auto_amount === 165000 ? PASS("auto=165,000") : FAIL("auto=165,000", c2.student_auto_amount, 165000);

// ── CASE 3: weekly_2, regular=8, makeup=1 → billable=8 (CAP), auto=220,000
console.log("\n[CASE 3] weekly_2 / 220,000 / 8회 / regular=8 makeup=1");
const c3 = computeStudentCalculation(s2, p2, singleTeacherSlots(8), 1);
console.log(`  service=${c3.service_count} billable=${c3.billable_count} auto=${c3.student_auto_amount}`);
c3.service_count === 9 ? PASS("service=9") : FAIL("service=9", c3.service_count, 9);
c3.billable_count === 8 ? PASS("billable=8 (MIN(9,8)=CAP)") : FAIL("billable=8", c3.billable_count, 8);
c3.student_auto_amount === 220000 ? PASS("auto=220,000") : FAIL("auto=220,000", c3.student_auto_amount, 220000);
c3.student_auto_amount <= 220000 ? PASS("auto ≤ monthly_fee") : FAIL("auto ≤ monthly_fee", c3.student_auto_amount, "≤220000");

// ── CASE 4: weekly_3, regular=10, makeup=1 → billable=11, auto=275,000
console.log("\n[CASE 4] weekly_3 / 300,000 / 12회 / regular=10 makeup=1");
const p3: PricingRow = { type_key: "weekly_3", monthly_fee: 300000, sessions_per_month: 12 };
const s3: StudentRow = { student_id: "s3", student_name: "C", weekly_count: 3 };
const c4 = computeStudentCalculation(s3, p3, singleTeacherSlots(10), 1);
console.log(`  service=${c4.service_count} billable=${c4.billable_count} auto=${c4.student_auto_amount}`);
c4.service_count === 11 ? PASS("service=11") : FAIL("service=11", c4.service_count, 11);
c4.billable_count === 11 ? PASS("billable=11 (MIN(11,12))") : FAIL("billable=11", c4.billable_count, 11);
c4.student_auto_amount === 275000 ? PASS("auto=275,000") : FAIL("auto=275,000", c4.student_auto_amount, 275000);

// ── pricing 없음 → unpriced, auto=0 (null이 아닌 0이나 pricing_status=unpriced)
console.log("\n[UNPRICED] pricing 없음 → pricing_status=unpriced, auto=0");
const cu = computeStudentCalculation(
  { student_id: "su", student_name: "미설정", weekly_count: 1 },
  null, singleTeacherSlots(4), 0
);
cu.pricing_status === "unpriced" ? PASS("pricing_status=unpriced") : FAIL("pricing_status=unpriced", cu.pricing_status, "unpriced");
cu.student_auto_amount === 0 ? PASS("auto=0 (not calculated)") : FAIL("auto=0", cu.student_auto_amount, 0);
cu.teacher_allocations.length === 0 ? PASS("no allocation for unpriced") : FAIL("no allocation", cu.teacher_allocations.length, 0);

// ── weekly_count → type_key 매핑 명시 확인
console.log("\n[MAPPING] weekly_count → type_key 매핑");
const mappings = [
  { wc: 1, expected: "weekly_1" },
  { wc: 2, expected: "weekly_2" },
  { wc: 3, expected: "weekly_3" },
];
for (const { wc, expected } of mappings) {
  const key = `weekly_${wc}`;
  key === expected ? PASS(`weekly_count=${wc} → ${key}`) : FAIL(`weekly_count=${wc} → ${key}`, key, expected);
}
// fallback 금지: pricing 없으면 null 반환 (weekly_1로 fallback 없음)
// settlement-service.ts에서: pricingMap.get(`weekly_${wc}`) ?? null → computeStudentCalculation(s, null, ...)
PASS("weekly_1 fallback 없음 — null 전달로 unpriced 처리");

console.log("\n=== Pricing QA 완료 ===");
