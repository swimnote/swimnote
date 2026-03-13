import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const classesTable = pgTable("classes", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  name: text("name").notNull(),
  instructor: text("instructor").notNull(),
  schedule: text("schedule").notNull(),
  capacity: integer("capacity"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const classMembersTable = pgTable("class_members", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  class_id: text("class_id").notNull(),
  member_id: text("member_id").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const insertClassSchema = createInsertSchema(classesTable).omit({
  id: true,
  created_at: true,
});
export type InsertClass = z.infer<typeof insertClassSchema>;
export type Class = typeof classesTable.$inferSelect;
export type ClassMember = typeof classMembersTable.$inferSelect;
