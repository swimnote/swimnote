import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const makeupSessionsTable = pgTable("makeup_sessions", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  swimming_pool_id: text("swimming_pool_id").notNull(),

  student_id:            text("student_id").notNull(),
  student_name:          text("student_name"),

  original_class_group_id:   text("original_class_group_id"),
  original_class_group_name: text("original_class_group_name"),
  original_teacher_id:       text("original_teacher_id"),
  original_teacher_name:     text("original_teacher_name"),

  absence_date:          text("absence_date").notNull(),
  absence_attendance_id: text("absence_attendance_id"),

  status: text("status").notNull().default("waiting"),

  assigned_class_group_id:   text("assigned_class_group_id"),
  assigned_class_group_name: text("assigned_class_group_name"),
  assigned_teacher_id:       text("assigned_teacher_id"),
  assigned_teacher_name:     text("assigned_teacher_name"),
  assigned_date:             text("assigned_date"),

  is_substitute:         boolean("is_substitute").default(false),
  substitute_teacher_id:   text("substitute_teacher_id"),
  substitute_teacher_name: text("substitute_teacher_name"),

  completed_at:            timestamp("completed_at"),
  completed_attendance_id: text("completed_attendance_id"),

  transferred_to_teacher_id:   text("transferred_to_teacher_id"),
  transferred_to_teacher_name: text("transferred_to_teacher_name"),
  transferred_at:              timestamp("transferred_at"),
  transferred_by:              text("transferred_by"),
  transferred_by_name:         text("transferred_by_name"),

  note:       text("note"),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  updated_at: timestamp("updated_at").notNull().default(sql`now()`),
});
