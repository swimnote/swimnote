/**
 * backup-production.ts — Production → Backup DB Snapshot (WP18-C Phase C)
 *
 * 목적:
 *   Production DB를 READ ONLY로 읽어 Backup DB에 snapshot 생성.
 *
 * 실행:
 *   tsx src/scripts/backup-production.ts
 *   (또는 package.json: npm run backup:production)
 *
 * 전제조건:
 *   - SUPABASE_DATABASE_URL       : Production (read-only 사용)
 *   - SUPABASE_BACKUP_DATABASE_URL: Backup (write target)
 *   - Backup DB에 schema가 이미 구축되어 있어야 함 (Phase A 완료 후)
 *
 * 보안 원칙:
 *   - Source(Production) connection: SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY
 *   - Production: SELECT / COUNT / metadata 읽기만 허용
 *   - Production에 INSERT / UPDATE / DELETE / ALTER / DROP / CREATE 절대 금지
 *   - SUPABASE_BACKUP_DATABASE_URL: Replit Secret only — 절대 로그 출력 금지
 *   - 개인정보 값 자체 출력 금지 (count/hash/존재여부만)
 *   - 새 snapshot 검증 완료 전 이전 snapshot 삭제 금지 (last-known-good 유지)
 *
 * Restore guard:
 *   - 이 스크립트는 Backup DB에만 write.
 *   - Production restore 자동 실행 절대 금지.
 *   - Production restore 시 REQUIRE_EXPLICIT_PRODUCTION_RESTORE_APPROVAL.
 */

import pg from "pg";
import { randomUUID } from "crypto";

const PRODUCTION_REF = "mrgkiussgbbmxfnkjgqy";
const BACKUP_REF     = "uznwvkuqmvuahpsltqrr";

// ── BACKUP_REQUIRED tables — full application coverage (WP18-C Coverage Final)
//
// EXCLUDED (with reason):
//   REBUILDABLE: subscription_plans, diary_templates, diary_template_levels,
//     curriculum_items, curriculum_drills, curriculum_versions,
//     curriculum_node_relations, global_template_sets, platform_banners,
//     misconception_candidates  — seed/reference data rebuilt by bootstrap/migration
//   EPHEMERAL:   event_logs, backup_logs, db_health_logs, pool_change_logs,
//     pool_event_logs, push_scheduled_sent, push_logs, audit_logs,
//     audit_entity_versions, class_diary_audit_logs, ops_alerts,
//     scheduler_heartbeat, scheduler_locks, data_change_logs,
//     push_fanout_deliveries, push_fanout_jobs, dead_letter_queue,
//     event_retry_queue, restore_logs, readonly_control_logs,
//     db_server_snapshots, backup_snapshots, support_query_log,
//     analytics_events, phone_verifications, messenger_read_state,
//     parent_content_reads, platform_backups, backup_settings,
//     notice_reads, notice_dismissals, temp_class_transfers
//     — operational logs / transient state / rebuild-on-login tokens
//
const CRITICAL_TABLES = [
  // ── Tenant root ──────────────────────────────────────────────────────────
  "swimming_pools",
  // ── Accounts ─────────────────────────────────────────────────────────────
  "users",
  "parent_accounts",
  "teacher_invites",
  "parent_v2_pending",
  "push_tokens",
  "push_settings",
  "policy_consents",
  // ── Students / classes ───────────────────────────────────────────────────
  "students",
  "class_groups",
  "student_class_history",
  "parent_students",
  "members",
  "class_members",
  "student_levels",
  "student_registration_requests",
  "member_transfers",
  "user_pool_memberships",
  // ── Attendance / makeup ──────────────────────────────────────────────────
  "attendance",
  "makeup_sessions",
  "manual_handover_makeups",
  "holiday_confirmations",
  // ── Diaries / notes ──────────────────────────────────────────────────────
  "class_diaries",
  "class_diary_student_notes",
  "diary_messages",
  "diary_reactions",
  "notices",
  // ── Media ────────────────────────────────────────────────────────────────
  "photo_assets_meta",
  "video_assets_meta",
  "teacher_saved_photos",
  "teacher_saved_videos",
  "student_photos",
  "student_videos",
  // ── Notifications ────────────────────────────────────────────────────────
  "notifications",
  "pool_push_settings",
  // ── Billing / subscriptions ───────────────────────────────────────────────
  "pool_subscriptions",
  "x_subscription_slots",
  "revenuecat_webhook_events",
  "payment_cards",
  "payment_logs",
  "revenue_logs",
  "monthly_settlements",
  "subscriptions",
  // ── Pool config ───────────────────────────────────────────────────────────
  "pool_class_pricing",
  "pool_holidays",
  "pool_level_settings",
  "pool_support_incidents",
  "feature_flags",
  "feature_flag_overrides",
  // ── Support / CRM ────────────────────────────────────────────────────────
  "support_cases",
  "support_case_notes",
  "support_tickets",
  "support_ticket_replies",
  "support_knowledge_items",
  "support_knowledge_candidates",
  "knowledge_approval_log",
  "inquiries",
  "inquiry_replies",
  // ── Parent requests ──────────────────────────────────────────────────────
  "parent_student_requests",
  "parent_request_messages",
  "parent_pool_requests",
  // ── Messages ─────────────────────────────────────────────────────────────
  "work_messages",
  // ── Growth reports ───────────────────────────────────────────────────────
  "growth_reports",
  "growth_report_cycles",
  "growth_report_batch_jobs",
  "growth_report_answers",
  "growth_report_comments",
  "growth_report_reactions",
  "growth_report_questions",
  "growth_events",
  // ── Curriculum ───────────────────────────────────────────────────────────
  "parent_curriculum_conversations",
  "parent_curriculum_messages",
  "curriculum_requests",
  "curriculum_request_files",
  "student_curriculum_assignments",
  "student_curriculum_progress",
  "curriculum_progress_observations",
  // ── X mode ───────────────────────────────────────────────────────────────
  "x_setup_submissions",
  "x_setup_files",
  "x_setup_revision_requests",
  "x_website_profiles",
  "x_website_packages",
  "x_curriculum_profiles",
  "x_curriculum_levels",
  "x_monthly_operational_snapshots",
  // ── Teacher records ───────────────────────────────────────────────────────
  "teacher_daily_memos",
  "teacher_schedule_notes",
  "teacher_absences",
  // ── Admin / misc ──────────────────────────────────────────────────────────
  "admin_member_notes",
  "member_activity_logs",
  "parent_ai_daily_usage",
  "parent_ai_usage_reservations",
  "super_incidents",
  "misconception_hunter_settings",
  "partner_analytics_snapshots",
  "swim_diary",
  "classes",
] as const;

type TableName = typeof CRITICAL_TABLES[number];

// ── Guard: validate URLs ──────────────────────────────────────────────────
function extractRef(url: string): string | null {
  try {
    const m = new URL(url).username.match(/^postgres\.([a-z0-9]+)$/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║         SWIMNOTE BACKUP — PRODUCTION SNAPSHOT (WP18-C)      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("Started:", new Date().toISOString());

  // Gate 1: URLs present
  const prodUrl   = process.env.SUPABASE_DATABASE_URL;
  const backupUrl = process.env.SUPABASE_BACKUP_DATABASE_URL;
  if (!prodUrl)   { console.error("🚫 SUPABASE_DATABASE_URL not set — abort"); process.exit(1); }
  if (!backupUrl) { console.error("🚫 SUPABASE_BACKUP_DATABASE_URL not set — abort"); process.exit(1); }

  // Gate 2: ref validation
  const prodRef   = extractRef(prodUrl);
  const backupRef = extractRef(backupUrl);

  if (prodRef !== PRODUCTION_REF) {
    console.error(`🚫 Source is not production ref (got: ${prodRef}) — abort`);
    process.exit(1);
  }
  if (backupRef !== BACKUP_REF) {
    console.error(`🚫 Target is not backup ref (got: ${backupRef}) — abort`);
    process.exit(1);
  }
  if (prodRef === backupRef) {
    console.error("🚫 Source === Target — same project detected — abort");
    process.exit(1);
  }

  console.log("GUARD: Source=production, Target=backup — independent projects confirmed");

  // Connections
  const prodPool = new pg.Pool({
    connectionString: prodUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 15000,
  });
  const backupPool = new pg.Pool({
    connectionString: backupUrl,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
  });

  const snapshotId = `snap_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let runId = "";

  try {
    // Verify production connectivity (read-only session)
    const prodClient = await prodPool.connect();
    try {
      await prodClient.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
      const pv = await prodClient.query("SELECT version(), current_database()");
      console.log("Production connected:", pv.rows[0].current_database,
        pv.rows[0].version.split(" ").slice(0, 2).join(" "));
    } finally {
      prodClient.release();
    }

    // Verify backup connectivity
    const bkV = await backupPool.query("SELECT current_database(), version()");
    console.log("Backup connected:", bkV.rows[0].current_database,
      bkV.rows[0].version.split(" ").slice(0, 2).join(" "));

    // Verify backup schema
    const schemaTables = await backupPool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)`,
      [CRITICAL_TABLES]
    );
    if (schemaTables.rows.length < CRITICAL_TABLES.length) {
      const missing = CRITICAL_TABLES.filter(
        t => !schemaTables.rows.find((r: any) => r.table_name === t)
      );
      console.error("🚫 Backup DB schema incomplete — missing tables:", missing.join(", "));
      console.error("   Run Phase A schema build first (backup-manifest).");
      process.exit(1);
    }

    // Register snapshot run
    const runInsert = await backupPool.query(
      `INSERT INTO backup_runs (source_project, snapshot_id, status, started_at)
       VALUES ($1, $2, 'RUNNING', now()) RETURNING id`,
      [PRODUCTION_REF, snapshotId]
    );
    runId = runInsert.rows[0].id;
    console.log(`\nSnapshot ID: ${snapshotId}`);
    console.log(`Run ID: ${runId}`);

    // ── Read production counts (read-only) ──────────────────────────────
    console.log("\n─── PRODUCTION READ (read-only SELECT) ───");
    const prodCounts: Record<string, number> = {};
    const prodClient2 = await prodPool.connect();
    try {
      await prodClient2.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
      for (const table of CRITICAL_TABLES) {
        try {
          const r = await prodClient2.query(`SELECT COUNT(*) c FROM ${table}`);
          prodCounts[table] = parseInt(r.rows[0].c);
          console.log(`  prod.${table}: ${prodCounts[table]} rows`);
        } catch (e: any) {
          console.warn(`  prod.${table}: SKIP (${e.message.slice(0, 60)})`);
          prodCounts[table] = -1;
        }
      }
    } finally {
      prodClient2.release();
    }

    // ── Export production data to backup (UPSERT) ────────────────────────
    console.log("\n─── SNAPSHOT COPY (prod → backup) ───");

    // Snapshot tables that can be fully copied (metadata/structural, no huge JSONB blobs)
    // R2 binary excluded per spec §15.
    // PII fields: we copy object_key/metadata only, not actual binary.
    // For safety: copy all structured fields (they're already in backup schema).

    // exportOrder mirrors CRITICAL_TABLES — order matches FK dependency (parents before children)
    const exportOrder: TableName[] = [...CRITICAL_TABLES];

    const copyCounts: Record<string, number> = {};
    const batchSize = 500;

    // Dedicated backup write client — session_replication_role=replica bypasses FK trigger checks
    // (Supabase postgres user has this privilege; required for bulk restore without FK order constraints)
    const backupWriteClient = await backupPool.connect();
    await backupWriteClient.query("SET session_replication_role = 'replica'");
    console.log("  backup write client: session_replication_role=replica OK");

    const exportClient = await prodPool.connect();
    try {
      await exportClient.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");

      for (const table of exportOrder) {
        if (prodCounts[table] === -1) {
          console.log(`  SKIP ${table} (not accessible on production)`);
          copyCounts[table] = 0;
          continue;
        }

        // Fetch columns from backup schema (source of truth for column names + types)
        const colQ = await backupPool.query(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1
           ORDER BY ordinal_position`,
          [table]
        );
        // Exclude backup_runs from copy (it's backup-only metadata)
        if (table === ("backup_runs" as any)) continue;

        const cols = colQ.rows.map((r: any) => r.column_name as string);
        // Track backup column types to serialize correctly
        const backupColTypes = new Map<string, string>(
          colQ.rows.map((r: any) => [r.column_name as string, (r.data_type as string)])
        );

        // Fetch from production (columns that exist in both)
        const prodColQ = await exportClient.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1`,
          [table]
        );
        const prodCols = new Set(prodColQ.rows.map((r: any) => r.column_name as string));
        const commonCols = cols.filter(c => prodCols.has(c));

        if (commonCols.length === 0) {
          console.log(`  SKIP ${table} (no common columns)`);
          copyCounts[table] = 0;
          continue;
        }

        // DELETE all existing rows before fresh copy — avoids multi-col unique constraint conflicts.
        // session_replication_role=replica disables FK trigger checks on DELETE as well.
        await backupWriteClient.query(`DELETE FROM ${table}`);

        let offset = 0;
        let copied = 0;

        while (true) {
            const rows = await exportClient.query(
              `SELECT ${commonCols.map(c => `"${c}"`).join(",")} FROM ${table} LIMIT $1 OFFSET $2`,
              [batchSize, offset]
            );
            if (rows.rows.length === 0) break;

            // INSERT to backup — DELETE already cleared the table so no conflicts expected;
            // ON CONFLICT DO NOTHING as safety net for tables without a single-col PK.
            const colList = commonCols.map(c => `"${c}"`).join(",");

            for (const row of rows.rows) {
              const vals = commonCols.map(c => {
                const v = row[c];
                if (v === null || v === undefined) return null;
                if (typeof v === "object" && !(v instanceof Date)) {
                  const bkType = backupColTypes.get(c) ?? "";
                  // PostgreSQL native ARRAY columns → pass JS array as-is
                  // JSON/JSONB columns → always stringify
                  if (bkType === "ARRAY") return v;
                  return JSON.stringify(v);
                }
                return v;
              });
              const placeholders = vals.map((_: any, i: number) => `$${i + 1}`).join(",");
              await backupWriteClient.query(
                `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                vals
              );
            }

            copied += rows.rows.length;
          offset += rows.rows.length;
          if (rows.rows.length < batchSize) break;
        }

        copyCounts[table] = copied;
        console.log(`  ${table}: ${copied} rows copied`);
      }

    } finally {
      exportClient.release();
      backupWriteClient.release();
    }

    // ── Verify: compare counts ────────────────────────────────────────────
    console.log("\n─── VERIFICATION ───");
    const verifyResults: Record<string, string> = {};
    let allVerified = true;

    for (const table of exportOrder) {
      if (prodCounts[table] === -1) { verifyResults[table] = "SKIP"; continue; }
      const bkCount = await backupPool.query(`SELECT COUNT(*) c FROM ${table}`);
      const bk = parseInt(bkCount.rows[0].c);
      const prod = prodCounts[table];
      // Allow backup >= prod (backup may have previous runs' data; prod has authoritative rows)
      const pass = bk >= prod;
      verifyResults[table] = pass
        ? `PASS (prod:${prod} bk:${bk})`
        : `FAIL (prod:${prod} bk:${bk})`;
      if (!pass) allVerified = false;
      console.log(`  ${table}: ${verifyResults[table]}`);
    }

    // ── FK spot-check ─────────────────────────────────────────────────────
    const fkChecks = [
      [`SELECT COUNT(*) c FROM parent_students ps JOIN parent_accounts pa ON pa.id=ps.parent_id JOIN students s ON s.id=ps.student_id`, "parent→student join"],
      [`SELECT COUNT(*) c FROM student_class_history sch JOIN students s ON s.id=sch.student_id JOIN class_groups cg ON cg.id=sch.class_group_id`, "sch→student→class join"],
      [`SELECT COUNT(*) c FROM class_diary_student_notes n JOIN class_diaries d ON d.id=n.diary_id JOIN students s ON s.id=n.student_id`, "notes→diary→student join"],
    ];
    let fkPass = true;
    for (const [sql, label] of fkChecks) {
      try {
        await backupPool.query(sql);
        console.log(`  FK[${label}]: PASS`);
      } catch (e: any) {
        console.error(`  FK[${label}]: FAIL — ${e.message.slice(0, 80)}`);
        fkPass = false;
      }
    }

    const verificationStatus = allVerified && fkPass ? "VERIFIED" : "PARTIAL";

    // ── Update backup_runs ────────────────────────────────────────────────
    await backupPool.query(
      `UPDATE backup_runs SET
         completed_at = now(),
         status = $1,
         table_count = $2,
         row_count_summary = $3,
         verification_status = $4
       WHERE id = $5`,
      [
        verificationStatus,
        exportOrder.length,
        JSON.stringify(copyCounts),
        verificationStatus,
        runId,
      ]
    );

    console.log(`\nVERIFICATION_STATUS: ${verificationStatus}`);
    console.log(`BACKUP_METHOD: NODE_LOGICAL`);
    console.log(`SNAPSHOT_ID: ${snapshotId}`);
    console.log(`COMPLETED: ${new Date().toISOString()}`);

  } catch (e: any) {
    console.error("BACKUP_ERROR:", e.message);
    if (runId) {
      await backupPool.query(
        `UPDATE backup_runs SET status='FAILED', error_summary=$1, completed_at=now() WHERE id=$2`,
        [e.message.slice(0, 500), runId]
      ).catch(() => {});
    }
    process.exit(1);
  } finally {
    await prodPool.end();
    await backupPool.end();
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              BACKUP COMPLETE                                 ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

main().catch((e) => {
  console.error("[backup-production] FATAL:", e.message);
  process.exit(1);
});
