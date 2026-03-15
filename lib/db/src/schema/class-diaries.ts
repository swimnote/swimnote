import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

function genId(prefix: string) {
  return sql`${prefix} || '_' || replace(gen_random_uuid()::text, '-', '')`;
}

// ── 공통 일지 (반 단위) ──────────────────────────────────────────────────
export const classDiariesTable = pgTable("class_diaries", {
  id:               text("id").primaryKey().default(sql`'cd_' || replace(gen_random_uuid()::text,'-','')`),
  class_group_id:   text("class_group_id").notNull(),
  teacher_id:       text("teacher_id").notNull(),
  teacher_name:     text("teacher_name").notNull(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  lesson_date:      text("lesson_date").notNull(),
  common_content:   text("common_content").notNull(),
  is_edited:        boolean("is_edited").notNull().default(false),
  edited_at:        timestamp("edited_at"),
  edited_by:        text("edited_by"),
  is_deleted:       boolean("is_deleted").notNull().default(false),
  deleted_at:       timestamp("deleted_at"),
  deleted_by:       text("deleted_by"),
  created_at:       timestamp("created_at").notNull().defaultNow(),
  updated_at:       timestamp("updated_at").notNull().defaultNow(),
});

// ── 학생별 추가 일지 ─────────────────────────────────────────────────────
export const classDiaryStudentNotesTable = pgTable("class_diary_student_notes", {
  id:           text("id").primaryKey().default(sql`'csn_' || replace(gen_random_uuid()::text,'-','')`),
  diary_id:     text("diary_id").notNull(),
  student_id:   text("student_id").notNull(),
  note_content: text("note_content").notNull(),
  is_edited:    boolean("is_edited").notNull().default(false),
  edited_at:    timestamp("edited_at"),
  edited_by:    text("edited_by"),
  is_deleted:   boolean("is_deleted").notNull().default(false),
  deleted_at:   timestamp("deleted_at"),
  deleted_by:   text("deleted_by"),
  created_at:   timestamp("created_at").notNull().defaultNow(),
  updated_at:   timestamp("updated_at").notNull().defaultNow(),
});

// ── 감사 기록 ────────────────────────────────────────────────────────────
export const classDiaryAuditLogsTable = pgTable("class_diary_audit_logs", {
  id:              text("id").primaryKey().default(sql`'cal_' || replace(gen_random_uuid()::text,'-','')`),
  diary_id:        text("diary_id"),
  student_note_id: text("student_note_id"),
  target_type:     text("target_type").notNull(),
  action_type:     text("action_type").notNull(),
  before_content:  text("before_content"),
  after_content:   text("after_content"),
  actor_id:        text("actor_id").notNull(),
  actor_name:      text("actor_name").notNull(),
  actor_role:      text("actor_role").notNull(),
  swimming_pool_id:text("swimming_pool_id").notNull(),
  created_at:      timestamp("created_at").notNull().defaultNow(),
});

// ── 일지 작성 템플릿 ─────────────────────────────────────────────────────
export const diaryTemplatesTable = pgTable("diary_templates", {
  id:              text("id").primaryKey().default(sql`'dt_' || replace(gen_random_uuid()::text,'-','')`),
  swimming_pool_id:text("swimming_pool_id").notNull(),
  category:        text("category").notNull().default("general"),
  level:           text("level"),
  template_text:   text("template_text").notNull(),
  created_by:      text("created_by").notNull(),
  is_active:       boolean("is_active").notNull().default(true),
  created_at:      timestamp("created_at").notNull().defaultNow(),
  updated_at:      timestamp("updated_at").notNull().defaultNow(),
});
