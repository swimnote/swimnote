import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const r = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='swimming_pools' AND column_name ILIKE 'x%'
    ORDER BY ordinal_position`);
  console.log("X_COLS:", r.rows.map((x: any) => x.column_name).join(", "));

  const p = await pool.query(`
    SELECT subscription_tier, subscription_source, x_paid_entitlement, x_manual_entitlement,
           x_management_override, x_force_disabled, x_plan_key
    FROM swimming_pools WHERE id='pool_1775118427405_xs80lcdmo'`);
  console.log("DEMO_POOL_X:", JSON.stringify(p.rows[0]));

  const s = await pool.query(`
    SELECT pool_id, tier_key, status, franchise_number
    FROM x_subscription_slots WHERE pool_id='pool_1775118427405_xs80lcdmo' ORDER BY purchased_at DESC LIMIT 3`);
  console.log("X_SLOTS:", JSON.stringify(s.rows));

  const sp = await pool.query(`SELECT tier, name, price_per_month, member_limit, storage_mb, display_storage FROM subscription_plans WHERE tier ILIKE 'x%' OR tier ILIKE 'swim%' ORDER BY price_per_month`);
  console.log("X_PLANS:", JSON.stringify(sp.rows));
  await pool.end();
}
run().catch(e => { console.log("ERR:", e.message); pool.end(); });
