import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("members", {
  id: text("id").primaryKey().default("gen_random_uuid()"),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  birth_date: text("birth_date"),
  parent_user_id: text("parent_user_id"),
  memo: text("memo"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
