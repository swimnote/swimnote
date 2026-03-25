import { DAYS_KO } from "./attendanceTypes";

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

export function formatDateLabel(ds: string): string {
  const d = new Date(ds);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS_KO[d.getDay()]})`;
}

export function formatWeekRange(start: string): string {
  const end = addDays(start, 6);
  return `${start.slice(5).replace("-", "/")} ~ ${end.slice(5).replace("-", "/")}`;
}

export function formatMonthLabel(ds: string): string {
  const d = new Date(ds);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

export function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

export function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}
