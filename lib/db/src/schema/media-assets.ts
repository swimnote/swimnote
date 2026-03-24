/**
 * media-assets.ts — 미디어 자산 메타데이터 (pool DB 전용)
 *
 * photo_assets_meta : 사진 앨범 메타 (실제 파일은 object storage)
 * video_assets_meta : 영상 앨범 메타 (실제 파일은 object storage)
 */
import { pgTable, text, timestamp, integer, bigint, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const photoAssetsMetaTable = pgTable("photo_assets_meta", {
  id:               text("id").primaryKey().default(sql`(gen_random_uuid())::text`),
  pool_id:          text("pool_id").notNull(),
  student_id:       text("student_id"),
  class_id:         text("class_id"),
  journal_id:       text("journal_id"),
  album_type:       text("album_type").notNull().default("group"),
  bucket_name:      text("bucket_name").notNull().default("photos"),
  object_key:       text("object_key").notNull(),
  file_type:        text("file_type"),
  file_size:        integer("file_size"),
  uploaded_by:      text("uploaded_by").notNull(),
  uploaded_by_name: text("uploaded_by_name"),
  uploaded_at:      timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  status:           text("status").notNull().default("active"),
  visibility:       text("visibility").notNull().default("class"),
  is_thumbnail:     boolean("is_thumbnail").notNull().default(false),
  is_compressed:    boolean("is_compressed").notNull().default(false),
  caption:          text("caption"),
  created_at:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videoAssetsMetaTable = pgTable("video_assets_meta", {
  id:               text("id").primaryKey().default(sql`(gen_random_uuid())::text`),
  pool_id:          text("pool_id").notNull(),
  student_id:       text("student_id"),
  class_id:         text("class_id"),
  journal_id:       text("journal_id"),
  album_type:       text("album_type").notNull().default("group"),
  bucket_name:      text("bucket_name").notNull().default("videos"),
  object_key:       text("object_key").notNull(),
  file_type:        text("file_type"),
  file_size:        bigint("file_size", { mode: "number" }),
  uploaded_by:      text("uploaded_by").notNull(),
  uploaded_by_name: text("uploaded_by_name"),
  uploaded_at:      timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  status:           text("status").notNull().default("active"),
  visibility:       text("visibility").notNull().default("class"),
  caption:          text("caption"),
  duration_sec:     integer("duration_sec"),
  codec:            text("codec"),
  resolution:       text("resolution"),
  created_at:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PhotoAssetMeta  = typeof photoAssetsMetaTable.$inferSelect;
export type VideoAssetMeta  = typeof videoAssetsMetaTable.$inferSelect;
