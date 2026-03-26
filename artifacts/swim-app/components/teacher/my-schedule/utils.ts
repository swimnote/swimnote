import { Dimensions } from "react-native";
import { TeacherClassGroup } from "@/components/teacher/WeeklySchedule";

export const SCREEN_W = Dimensions.get("window").width;
export const KO_DAY_ARR = ["일", "월", "화", "수", "목", "금", "토"];
export const TIMETABLE_COLS = ["월", "화", "수", "목", "금", "토", "일"];
export const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/** 기존 전체 시간축 (하위 호환, 더 이상 주간표에서 사용 안 함) */
export const FIXED_HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
export const WT_COL_W = 76;
export const WT_ROW_H = 60;
export const WT_TIME_W = 38;

/** 어린이 수영장 운영 시간 — 요일별 표시 시간축 */
export const WEEKDAY_HOURS = Array.from({ length: 10 }, (_, i) => i + 13); // 13~22시 (평일)
export const SAT_HOURS     = Array.from({ length: 10 }, (_, i) => i + 7);  // 7~16시 (토요일)

/**
 * 요일별 표시 시간 배열
 * - 월~금: 13~22시 (어린이 오후반 중심)
 * - 토:   7~16시 (오전오후 어린이반)
 * - 일:   [] → 휴무 처리
 */
export function getDayHours(koDay: string): number[] {
  if (koDay === "토") return SAT_HOURS;
  if (koDay === "일") return [];
  return WEEKDAY_HOURS;
}

export interface ChangeLogItem {
  id: string; class_group_id: string; change_type: string;
  display_week_start: string; effective_date: string;
  note?: string | null; target_student_id?: string | null;
}

export interface StudentItem {
  id: string; name: string; birth_year?: string | null;
  assigned_class_ids?: string[]; class_group_id?: string | null;
  weekly_count?: number; schedule_labels?: string | null;
  status?: string; parent_user_id?: string | null;
  updated_at?: string | null;
}

export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function parseHour(t: string): number { return parseInt(t.split(/[:-]/)[0]) || 0; }
export function parseScheduleMinutes(t: string): number {
  const parts = t.split(/[:-]/);
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
}
export function getKoDay(dateStr: string): string {
  return KO_DAY_ARR[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}
export function classesForDate(groups: TeacherClassGroup[], dateStr: string) {
  const koDay = getKoDay(dateStr);
  return groups
    .filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay))
    .sort((a, b) => parseHour(a.schedule_time) - parseHour(b.schedule_time));
}
export function fmtHour(t: string) {
  const h = parseHour(t);
  return `${h}시`;
}
export function dateLabelFull(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCMonth()+1}월 ${d.getUTCDate()}일 (${KO_DAY_ARR[d.getUTCDay()]})`;
}
export function getHourRange(groups: TeacherClassGroup[]): number[] {
  if (!groups.length) return Array.from({ length: 8 }, (_, i) => i + 9);
  const hours = groups.map(g => parseHour(g.schedule_time));
  const minH = Math.max(6, Math.min(...hours));
  const maxH = Math.min(22, Math.max(...hours));
  return Array.from({ length: maxH - minH + 1 }, (_, i) => i + minH);
}
export function getMondayStr(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split("T")[0];
}
export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}
export function getWeekDates(weekStart: string): { koDay: string; dateStr: string; label: string }[] {
  return TIMETABLE_COLS.map((koDay, i) => {
    const dateStr = addDaysStr(weekStart, i);
    const d = new Date(dateStr + "T12:00:00Z");
    const label = `${d.getUTCMonth()+1}/${d.getUTCDate()}`;
    return { koDay, dateStr, label };
  });
}

const COLORS = ["#4EA7D8","#2E9B6F","#E4A93A","#D96C6C","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
export function classColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}
