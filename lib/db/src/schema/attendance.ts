import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceStatusEnum = pgEnum("attendance_status", ["present", "absent", "late"]);

export const attendanceTable = pgTable("attendance", {
  id: text("id").primaryKey(),
  class_group_id: text("class_group_id"),
  student_id: text("student_id"),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  date: text("date").notNull(),
  status: attendanceStatusEnum("status").notNull().default("absent"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  created_at: true,
});
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
