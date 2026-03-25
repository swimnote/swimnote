export const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

export interface ScheduleItem {
  id: string; name: string; schedule_time: string; schedule_days: string;
  level?: string | null; student_count: number;
  att_total: number; att_present: number;
  diary_done: boolean; has_note: boolean;
  note_text: string | null; audio_file_url: string | null;
}
export interface DailyMemo {
  id?: string; note_text?: string | null; audio_file_url?: string | null;
}
export interface DailyMemoDateInfo { date: string; has_text: boolean; has_audio: boolean; }

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일","월","화","수","목","금","토"];
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}
export function getDaysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
export function getFirstDayOfMonth(year: number, month: number) { return new Date(year, month-1, 1).getDay(); }
