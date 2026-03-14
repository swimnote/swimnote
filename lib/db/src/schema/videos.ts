import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videoAlbumTypeEnum = pgEnum("video_album_type", ["class", "private"]);

export const videosTable = pgTable("videos", {
  id: text("id").primaryKey(),
  class_group_id: text("class_group_id").notNull(),
  student_id: text("student_id"),
  teacher_id: text("teacher_id").notNull(),
  swimming_pool_id: text("swimming_pool_id").notNull(),
  file_url: text("file_url").notNull(),
  album_type: videoAlbumTypeEnum("album_type").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({
  id: true,
  created_at: true,
});
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
