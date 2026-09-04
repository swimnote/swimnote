export interface UploadedMedia {
  uri: string;
  kind: "photo" | "video";
  uploading: boolean;
  uploaded: boolean;
  error?: string;
  /** Stable client-side ID used for direct-upload tracking and retry */
  clientId?: string;
  /** Original file name */
  fileName?: string;
  /** MIME type */
  mimeType?: string;
  /** Actual byte size (post-compression) */
  fileSize?: number;
  /** Upload progress 0–100 (photos only, during direct upload) */
  progress?: number;
}

export interface DiaryTemplateLevel { id: string; level_name: string; sort_order: number; template_count: number; }

// ── Curriculum-based diary types ─────────────────────────────────────────────

export interface CurriculumLevel {
  level_order: number;
  level_name:  string;
  node_count:  number;
  test_count:  number;
}

export interface CurriculumNode {
  id:               string;
  display_no:       string;
  level_order:      number;
  sequence_in_level: number;
  stroke:           string;
  domain:           string;
  skill_group:      string;
  atomic_skill:     string;
  title:            string;
  source_trace:     string;
  is_test_item:     boolean;
  goal?:            string;
  coaching_point?:  string;
}

export interface CurriculumLevelsResponse {
  has_curriculum: boolean;
  version_id?:    string;
  version_name?:  string;
  levels:         CurriculumLevel[];
}

export interface CurriculumNodesResponse {
  nodes: CurriculumNode[];
  total: number;
}

export interface DiaryTemplate {
  id: string; level_id?: string | null; category: string; level?: string | null;
  title?: string | null; template_text: string; sort_order: number; is_active: boolean;
  scope?: string; teacher_id?: string | null; source_template_id?: string | null;
  global_id?: string | null;
  is_overridden?: boolean;
  override_id?: string | null;
}
export interface StudentOption  { id: string; name: string; birth_year?: string | null; }
export interface StudentNote    { student_id: string; student_name: string; note_content: string; }
export interface ExistingNote   { id: string; student_id: string; student_name: string; note_content: string; _deleted?: boolean; _modified?: boolean; }
export interface DiaryEntry {
  id: string; class_group_id: string; lesson_date: string;
  common_content: string; teacher_name: string; teacher_id?: string;
  is_edited: boolean; is_deleted: boolean;
  note_count?: number; class_name?: string;
  like_count?: number; thank_count?: number; comment_count?: number;
  schedule_time?: string; schedule_days?: string;
  student_notes?: ExistingNote[];
}
export interface AuditLog {
  id: string; target_type: string; action_type: string;
  before_content?: string | null; after_content?: string | null;
  actor_name: string; actor_role: string; created_at: string;
}

export interface AlbumPhotoInfo {
  id: string;
  file_url: string;
  presigned_url?: string;
  created_at: string;
  uploaded_by_name?: string;
  class_name?: string;
  media_status?: string;
  journal_id?: string;
}

export interface AlbumVideoInfo {
  id: string;
  file_url: string;
  thumbnail_presigned_url?: string;
  created_at: string;
  uploaded_by_name?: string;
  class_name?: string;
  caption?: string;
  status?: string;
}

export type SubView = "write" | "history" | "edit";

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
