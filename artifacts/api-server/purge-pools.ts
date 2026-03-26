/**
 * purge-pools.ts — swimming_pools 및 하위 데이터 완전 삭제
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function count(tbl: string): Promise<number> {
  try {
    const r = await superAdminDb.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tbl}`));
    return Number((r.rows[0] as any).n ?? 0);
  } catch { return -1; }
}

async function del(tbl: string, where = ""): Promise<number> {
  try {
    const r = await superAdminDb.execute(sql.raw(`DELETE FROM ${tbl}${where ? " WHERE " + where : ""}`));
    return (r as any).rowCount ?? 0;
  } catch (e: any) {
    if (!e?.message?.includes("does not exist")) console.warn(`  ⚠ ${tbl}: ${e?.message?.slice(0, 80)}`);
    return 0;
  }
}

async function main() {
  console.log("═══════════════════════════════════════");
  console.log(" swimming_pools 완전 삭제");
  console.log("═══════════════════════════════════════\n");

  // 삭제 전 카운트
  const before = await count("swimming_pools");
  console.log(`[삭제 전] swimming_pools: ${before}건`);

  if (before === 0) {
    console.log("  → 이미 0건. 추가 삭제 없음.\n");
  }

  // 풀 ID 목록 수집
  const poolRows = await superAdminDb.execute(sql`SELECT id, name FROM swimming_pools`);
  const pools = poolRows.rows as any[];
  console.log(`대상 수영장: ${pools.map(p => p.name).join(", ") || "없음"}\n`);

  // 하위 데이터부터 삭제 (의존 순서)
  const deleted: Record<string, number> = {};

  const tables: string[] = [
    "push_logs",
    "push_scheduled_sent",
    "push_tokens",
    "pool_push_settings",
    "student_photos",
    "student_videos",
    "photo_assets_meta",
    "video_assets_meta",
    "attendance",
    "class_diary_student_notes",
    "class_diary_audit_logs",
    "class_diaries",
    "diary_templates",
    "teacher_schedule_notes",
    "teacher_daily_memos",
    "teacher_absences",
    "swim_diary",
    "makeup_sessions",
    "manual_handover_makeups",
    "notice_reads",
    "notices",
    "work_messages",
    "support_tickets",
    "class_change_logs",
    "class_groups",
    "class_members",
    "classes",
    "temp_class_transfers",
    "student_registration_requests",
    "parent_students",
    "students",
    "members",
    "member_activity_logs",
    "parent_pool_requests",
    "parent_accounts",
    "pool_level_settings",
    "pool_holidays",
    "pool_change_logs",
    "user_pools",
    "subscriptions",
    "payment_logs",
    "revenue_logs",
    "pool_event_logs",
    "event_retry_queue",
    "dead_letter_queue",
    "event_logs",
    "data_change_logs",
    "readonly_control_logs",
  ];

  console.log("[하위 테이블 삭제]");
  for (const tbl of tables) {
    const n = await del(tbl);
    if (n > 0) { deleted[tbl] = n; console.log(`  ✅ ${tbl}: ${n}건`); }
  }

  // swimming_pools 삭제
  const poolsDeleted = await del("swimming_pools");
  deleted["swimming_pools"] = poolsDeleted;
  console.log(`  ✅ swimming_pools: ${poolsDeleted}건`);

  // users 중 super_admin 외 모두 삭제
  const usersDeleted = await del("users", "role::TEXT != 'super_admin'");
  if (usersDeleted > 0) { deleted["users(비슈퍼)"] = usersDeleted; console.log(`  ✅ users(비슈퍼): ${usersDeleted}건`); }

  // 최종 확인
  console.log("\n[최종 상태 확인]");
  const afterPools   = await count("swimming_pools");
  const afterUsers   = await count("users");
  const afterStudents = await count("students");
  const afterParents = await count("parent_accounts");
  const afterMembers = await count("members");
  const afterClasses = await count("classes");

  console.log(`  swimming_pools:   ${afterPools}건`);
  console.log(`  users:            ${afterUsers}명`);
  console.log(`  students:         ${afterStudents}건`);
  console.log(`  parent_accounts:  ${afterParents}건`);
  console.log(`  members:          ${afterMembers}건`);
  console.log(`  classes:          ${afterClasses}건`);

  console.log("\n[삭제 요약]");
  for (const [k, v] of Object.entries(deleted)) {
    if (v > 0) console.log(`  ${k}: ${v}건`);
  }

  console.log("\n═══ 완료 ═══");
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
