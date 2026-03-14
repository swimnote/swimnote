import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const teacherScheduleNotesTable = pgTable("teacher_schedule_notes", {
  id:               text("id").primaryKey(),
  teacher_id:       text("teacher_id").notNull(),
  class_group_id:   text("class_group_id").notNull(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  schedule_date:    text("schedule_date").notNull(),
  note_text:        text("note_text"),
  audio_file_url:   text("audio_file_url"),
  created_at:       timestamp("created_at").notNull().defaultNow(),
  updated_at:       timestamp("updated_at").notNull().defaultNow(),
});

export type TeacherScheduleNote = typeof teacherScheduleNotesTable.$inferSelect;
