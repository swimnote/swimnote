export const API_BASE = process.env.EXPO_PUBLIC_API_URL || "/api";

export interface UploadedMedia {
  uri: string;
  kind: "photo" | "video";
  uploading: boolean;
  uploaded: boolean;
  error?: string;
}

export interface DiaryTemplate { id: string; category: string; level?: string | null; template_text: string; }
export interface StudentOption  { id: string; name: string; birth_year?: string | null; }
export interface StudentNote    { student_id: string; student_name: string; note_content: string; }
export interface ExistingNote   { id: string; student_id: string; student_name: string; note_content: string; _deleted?: boolean; _modified?: boolean; }
export interface DiaryEntry {
  id: string; class_group_id: string; lesson_date: string;
  common_content: string; teacher_name: string; teacher_id?: string;
  is_edited: boolean; is_deleted: boolean;
  note_count?: number; class_name?: string;
  schedule_time?: string; schedule_days?: string;
  student_notes?: ExistingNote[];
}
export interface AuditLog {
  id: string; target_type: string; action_type: string;
  before_content?: string | null; after_content?: string | null;
  actor_name: string; actor_role: string; created_at: string;
}

export type SubView = "write" | "history" | "edit";

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
