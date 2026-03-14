import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const lessonDiariesTable = pgTable("lesson_diaries", {
  id: text("id").primaryKey(),
  class_group_id: text("class_group_id").notNull(),
  teacher_id: text("teacher_id").notNull(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  lesson_date: text("lesson_date").notNull(),
  content: text("content"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const insertLessonDiarySchema = createInsertSchema(lessonDiariesTable).omit({
  id: true,
  created_at: true,
});
export type InsertLessonDiary = z.infer<typeof insertLessonDiarySchema>;
export type LessonDiary = typeof lessonDiariesTable.$inferSelect;
