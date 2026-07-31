async function main() {
  const { superAdminDb } = await import("../../lib/db/src/index.js");
  const { sql } = await import("drizzle-orm");

  const rows = (await superAdminDb.execute(sql`
    SELECT
      id, name, owner_email,
      subscription_status, subscription_source, subscription_tier,
      subscription_end_at,
      deactivated_at, deletion_scheduled_at,
      is_readonly, upload_blocked, readonly_reason,
      approval_status, updated_at
    FROM swimming_pools
    ORDER BY created_at ASC
    LIMIT 20
  `)).rows;

  console.log("=== swimming_pools ===");
  for (const r of rows as any[]) {
    console.log(JSON.stringify({
      id: r.id,
      name: r.name,
      owner_email: r.owner_email,
      subscription_status: r.subscription_status,
      subscription_source: r.subscription_source,
      subscription_tier: r.subscription_tier,
      subscription_end_at: r.subscription_end_at,
      deactivated_at: r.deactivated_at,
      deletion_scheduled_at: r.deletion_scheduled_at,
      is_readonly: r.is_readonly,
      upload_blocked: r.upload_blocked,
      readonly_reason: r.readonly_reason,
      approval_status: r.approval_status,
      updated_at: r.updated_at,
    }));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
