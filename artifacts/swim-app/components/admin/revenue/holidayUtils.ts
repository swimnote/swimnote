export const LUNAR_HOLIDAYS: Record<number, string[]> = {
  2025: ["2025-01-28","2025-01-29","2025-01-30","2025-05-05","2025-10-05","2025-10-06","2025-10-07"],
  2026: ["2026-02-16","2026-02-17","2026-02-18","2026-05-24","2026-09-24","2026-09-25","2026-09-26"],
  2027: ["2027-02-07","2027-02-08","2027-02-09","2027-05-13","2027-09-14","2027-09-15","2027-09-16"],
  2028: ["2028-01-26","2028-01-27","2028-01-28","2028-05-02","2028-10-02","2028-10-03","2028-10-04"],
  2029: ["2029-02-12","2029-02-13","2029-02-14","2029-05-21","2029-10-02","2029-10-03","2029-10-04"],
  2030: ["2030-02-02","2030-02-03","2030-02-04","2030-05-11","2030-09-21","2030-09-22","2030-09-23"],
};

export const FIXED_HOLIDAYS: [number, number][] = [
  [1,1],[3,1],[5,5],[6,6],[8,15],[10,3],[10,9],[12,25],
];

export function getPublicHolidaysForMonth(year: number, month: number): string[] {
  const mm = String(month).padStart(2, "0");
  const result: string[] = [];
  for (const [fm, fd] of FIXED_HOLIDAYS) {
    if (fm === month) result.push(`${year}-${mm}-${String(fd).padStart(2,"0")}`);
  }
  for (const d of (LUNAR_HOLIDAYS[year] || [])) {
    if (d.startsWith(`${year}-${mm}`)) result.push(d);
  }
  return result;
}

export function getSundaysInMonth(year: number, month: number): string[] {
  const mm = String(month).padStart(2, "0");
  const total = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= total; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) {
      out.push(`${year}-${mm}-${String(d).padStart(2,"0")}`);
    }
  }
  return out;
}

export function getWeekdayDatesInMonth(year: number, month: number, weekday: number): string[] {
  const mm = String(month).padStart(2, "0");
  const total = new Date(year, month, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= total; d++) {
    if (new Date(year, month - 1, d).getDay() === weekday) {
      out.push(`${year}-${mm}-${String(d).padStart(2,"0")}`);
    }
  }
  return out;
}
