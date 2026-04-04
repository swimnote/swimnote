import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";

export const platformBannersTable = pgTable("platform_banners", {
  id:           text("id").primaryKey(),
  banner_type:  text("banner_type").notNull().default("slider"),
  title:        text("title").notNull(),
  description:  text("description"),
  image_url:    text("image_url"),
  image_key:    text("image_key"),
  link_url:     text("link_url"),
  link_label:   text("link_label"),
  color_theme:  text("color_theme").notNull().default("teal"),
  target:       text("target").notNull().default("all"),
  status:       text("status").notNull().default("inactive"),
  display_start: timestamp("display_start").notNull(),
  display_end:  timestamp("display_end").notNull(),
  sort_order:   integer("sort_order").notNull().default(0),
  created_by:   text("created_by"),
  created_at:   timestamp("created_at").notNull().defaultNow(),
  updated_at:   timestamp("updated_at").notNull().defaultNow(),
});
