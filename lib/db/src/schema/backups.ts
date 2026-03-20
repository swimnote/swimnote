/**
 * 서버 기반 변경분 수집 + 스냅샷 테이블
 *
 * data_change_logs  : 테넌트별 변경분 (CDC)
 * backup_snapshots  : 전체/증분 스냅샷 메타
 */
import { pgTable, text, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const changeTypeEnum = pgEnum("change_type", ["create", "update", "delete"]);
export const syncStatusEnum = pgEnum("sync_status", ["pending", "synced", "error"]);
export const snapshotTypeEnum = pgEnum("snapshot_type", ["incremental", "full"]);

/** 테넌트별 변경분 로그 */
export const dataChangeLogsTable = pgTable("data_change_logs", {
  id:          text("id").primaryKey().default("gen_random_uuid()"),
  tenant_id:   text("tenant_id").notNull(),
  table_name:  text("table_name").notNull(),
  record_id:   text("record_id").notNull(),
  change_type: changeTypeEnum("change_type").notNull(),
  payload:     jsonb("payload"),
  sync_status: syncStatusEnum("sync_status").notNull().default("pending"),
  created_at:  timestamp("created_at").notNull().defaultNow(),
  synced_at:   timestamp("synced_at"),
});

/** 배치 스냅샷 메타 */
export const backupSnapshotsTable = pgTable("backup_snapshots", {
  id:               text("id").primaryKey().default("gen_random_uuid()"),
  tenant_id:        text("tenant_id"),
  snapshot_type:    snapshotTypeEnum("snapshot_type").notNull(),
  tables_included:  text("tables_included").notNull(),
  record_count:     integer("record_count").notNull().default(0),
  storage_key:      text("storage_key"),
  created_at:       timestamp("created_at").notNull().defaultNow(),
});

export type DataChangeLog    = typeof dataChangeLogsTable.$inferSelect;
export type BackupSnapshot   = typeof backupSnapshotsTable.$inferSelect;
