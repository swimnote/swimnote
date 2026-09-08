import pg from "pg";
const pgPool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL!,
  max: 2,
  ssl: { rejectUnauthorized: false },
});
async function main() {
  // 1. growth_events by source
  const ge = await pgPool.query(`SELECT source, COUNT(*) as cnt FROM growth_events GROUP BY source ORDER BY cnt DESC`);
  console.log("=== growth_events by source ===");
  for (const r of ge.rows) console.log(`  ${r.source}: ${r.cnt}`);

  // 2. CPO / SCP counts
  const cpo = await pgPool.query(`SELECT COUNT(*) as cnt FROM curriculum_progress_observations`);
  const scp = await pgPool.query(`SELECT COUNT(*) as cnt FROM student_curriculum_progress`);
  console.log(`=== CPO(observations): ${cpo.rows[0].cnt}  SCP: ${scp.rows[0].cnt} ===`);

  // 3. ai_generated=true
  const aiTrue = await pgPool.query(`
    SELECT id, ai_generated, ai_trace_id, created_at FROM class_diaries
    WHERE ai_generated = true ORDER BY created_at DESC LIMIT 5
  `);
  console.log("=== ai_generated=true class_diaries ===");
  for (const r of aiTrue.rows)
    console.log(`  id=${r.id.slice(0,8)} trace=${r.ai_trace_id?.slice(0,8)??"NULL"} at=${r.created_at}`);
  if (!aiTrue.rows.length) console.log("  (없음 — OTA 적용 후 실제 AI Diary 저장 필요)");

  // 4. 최근 class_diaries
  const recent = await pgPool.query(`
    SELECT id, ai_generated, ai_trace_id, created_at FROM class_diaries ORDER BY created_at DESC LIMIT 5
  `);
  console.log("=== 최근 class_diaries (all) ===");
  for (const r of recent.rows)
    console.log(`  id=${r.id.slice(0,8)} ai=${r.ai_generated} trace=${r.ai_trace_id?.slice(0,8)??"NULL"} at=${r.created_at}`);

  // 5. match_token growth_events
  const mt = await pgPool.query(`
    SELECT id, source, student_id, created_at, diary_note_id FROM growth_events
    WHERE source='match_token' ORDER BY created_at DESC LIMIT 5
  `);
  console.log("=== match_token growth_events ===");
  for (const r of mt.rows)
    console.log(`  ge=${r.id.slice(0,8)} note=${r.diary_note_id?.slice(0,8)??"?"} at=${r.created_at}`);
  if (!mt.rows.length) console.log("  (없음 — OTA 후 AI Diary 저장 전)");

  // 6. CPO columns (lesson_session_id, student_id)
  const cpoRecent = await pgPool.query(`
    SELECT id, student_id, lesson_session_id, swimming_pool_id, updated_at
    FROM curriculum_progress_observations
    ORDER BY updated_at DESC LIMIT 5
  `);
  console.log("=== 최근 CPO (observations) ===");
  for (const r of cpoRecent.rows)
    console.log(`  cpo=${r.id.slice(0,8)} student=${r.student_id.slice(0,8)} pool=${r.swimming_pool_id.slice(0,12)} at=${r.updated_at}`);
  if (!cpoRecent.rows.length) console.log("  (없음)");

  // 7. SCP recent
  const scpR = await pgPool.query(`
    SELECT id, student_id, swimming_pool_id, progress_label, updated_at
    FROM student_curriculum_progress ORDER BY updated_at DESC LIMIT 5
  `);
  console.log("=== 최근 SCP ===");
  for (const r of scpR.rows)
    console.log(`  scp=${r.id.slice(0,8)} student=${r.student_id.slice(0,8)} label=${r.progress_label??"-"} at=${r.updated_at}`);
  if (!scpR.rows.length) console.log("  (없음)");

  await pgPool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
