/**
 * Media Engine Auto-Diagnosis — RC-13
 * 운영자가 버튼 한 번으로 전체 진단을 수행하는 통합 스크립트
 *
 * 실행: npx tsx src/scripts/media-diagnose.ts [--json]
 * 종료코드: 0=PASS, 1=WARNING, 2=ERROR
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const useJson = process.argv.includes("--json");

const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";

function log(msg: string) { if (!useJson) console.log(msg); }
function section(title: string) { log(`\n${BOLD}── ${title} ${DIM}${"─".repeat(50 - title.length)}${RESET}\n`); }

type Level = "PASS" | "WARNING" | "ERROR";
interface Item { id: string; label: string; level: Level; count: number; detail?: any[] }

async function q(label: string, query: string, warn: number, error: number, detailSql?: string): Promise<Item> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM (${query}) _`));
  const count = Number((r.rows[0] as any)?.n ?? 0);
  const level: Level = count >= error ? "ERROR" : count >= warn ? "WARNING" : "PASS";
  let detail: any[] | undefined;
  if (count > 0 && detailSql) {
    const dr = await db.execute(sql.raw(detailSql));
    detail = dr.rows as any[];
  }
  const icon = level === "PASS" ? `${GREEN}✅ PASS${RESET}` : level === "WARNING" ? `${YELLOW}⚠️  WARN${RESET}` : `${RED}❌ ERROR${RESET}`;
  log(`  ${icon}  ${label}: ${count}건`);
  if (detail) for (const d of detail.slice(0, 3)) log(`         → ${Object.entries(d as object).map(([k,v]) => `${k}=${String(v).slice(0,18)}`).join("  ")}`);
  return { id: label, label, level, count, detail };
}

async function main() {
  const start = Date.now();
  const results: Item[] = [];

  log(`\n${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════╗${RESET}`);
  log(`${BOLD}${CYAN}║  Media Engine Auto-Diagnosis (RC-13)                      ║${RESET}`);
  log(`${BOLD}${CYAN}║  ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }).padEnd(54)}║${RESET}`);
  log(`${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════╝${RESET}`);

  // ── 1. Dashboard 스냅샷 ───────────────────────────────────────
  section("1. 현황 스냅샷");
  const snap = await db.execute(sql.raw(`
    SELECT
      (SELECT COUNT(*)::int FROM photo_assets_meta) AS total_photos,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='draft') AS draft,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='attached') AS attached,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='detached') AS detached,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='archived') AS archived,
      (SELECT COALESCE(SUM(file_size),0)::bigint FROM photo_assets_meta) AS storage_bytes,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE created_at::date = CURRENT_DATE) AS uploaded_today,
      (SELECT COUNT(*)::int FROM class_diaries WHERE is_deleted=false) AS active_diaries,
      (SELECT COUNT(*)::int FROM class_diary_student_notes WHERE is_deleted=false) AS active_notes,
      (SELECT COUNT(*)::int FROM class_diary_audit_logs WHERE created_at::date = CURRENT_DATE) AS audit_today,
      (SELECT MAX(created_at)::text FROM class_diary_audit_logs WHERE action_type='cleanup') AS last_cleanup
  `));
  const s = snap.rows[0] as any;
  const mb = (Number(s.storage_bytes) / 1024 / 1024).toFixed(1);
  log(`  사진 총 ${s.total_photos}장  | draft=${s.draft}  attached=${s.attached}  detached=${s.detached}  archived=${s.archived}`);
  log(`  Storage ${mb} MB  |  오늘 업로드 ${s.uploaded_today}장  |  활성 일지 ${s.active_diaries}건  |  활성 노트 ${s.active_notes}건`);
  log(`  오늘 감사로그 ${s.audit_today}건  |  최근 cleanup: ${s.last_cleanup ?? "미실행"}`);

  // ── 2. Health Check (photo_assets_meta) ───────────────────────
  section("2. Photo 무결성 검사");
  results.push(await q("허용 외 media_status",
    `SELECT id FROM photo_assets_meta WHERE media_status NOT IN ('draft','attached','detached','archived') OR media_status IS NULL`, 1, 1,
    `SELECT id, media_status FROM photo_assets_meta WHERE media_status NOT IN ('draft','attached','detached','archived') OR media_status IS NULL LIMIT 5`));

  results.push(await q("attached 사진 → 삭제된 diary",
    `SELECT pam.id FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id AND cd.is_deleted=true WHERE pam.media_status='attached'`, 1, 1,
    `SELECT pam.id, pam.journal_id FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id AND cd.is_deleted=true WHERE pam.media_status='attached' LIMIT 5`));

  results.push(await q("orphan journal_id",
    `SELECT id FROM photo_assets_meta WHERE journal_id IS NOT NULL AND journal_id NOT IN (SELECT id FROM class_diaries)`, 1, 1,
    `SELECT id, journal_id FROM photo_assets_meta WHERE journal_id IS NOT NULL AND journal_id NOT IN (SELECT id FROM class_diaries) LIMIT 5`));

  results.push(await q("orphan student_note_id",
    `SELECT id FROM photo_assets_meta WHERE student_note_id IS NOT NULL AND student_note_id NOT IN (SELECT id FROM class_diary_student_notes)`, 1, 1,
    `SELECT id, student_note_id FROM photo_assets_meta WHERE student_note_id IS NOT NULL AND student_note_id NOT IN (SELECT id FROM class_diary_student_notes) LIMIT 5`));

  results.push(await q("orphan student_id",
    `SELECT id FROM photo_assets_meta WHERE student_id IS NOT NULL AND student_id NOT IN (SELECT id FROM students)`, 1, 1,
    `SELECT id, student_id FROM photo_assets_meta WHERE student_id IS NOT NULL AND student_id NOT IN (SELECT id FROM students) LIMIT 5`));

  results.push(await q("pool 불일치 (photo vs diary)",
    `SELECT pam.id FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id WHERE pam.pool_id != cd.swimming_pool_id`, 1, 1,
    `SELECT pam.id, pam.pool_id AS p_pool, cd.swimming_pool_id AS d_pool FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id WHERE pam.pool_id != cd.swimming_pool_id LIMIT 5`));

  results.push(await q("object_key 중복",
    `SELECT object_key FROM photo_assets_meta GROUP BY object_key HAVING COUNT(*)>1`, 1, 1,
    `SELECT object_key, COUNT(*) AS cnt FROM photo_assets_meta GROUP BY object_key HAVING COUNT(*)>1 LIMIT 5`));

  results.push(await q("detached 사진 journal_id 잔존",
    `SELECT id FROM photo_assets_meta WHERE media_status='detached' AND journal_id IS NOT NULL`, 1, 1,
    `SELECT id, journal_id FROM photo_assets_meta WHERE media_status='detached' AND journal_id IS NOT NULL LIMIT 5`));

  results.push(await q("draft 사진 journal_id 존재",
    `SELECT id FROM photo_assets_meta WHERE media_status='draft' AND journal_id IS NOT NULL`, 1, 1));

  results.push(await q("student_note_id O + student_id NULL",
    `SELECT id FROM photo_assets_meta WHERE student_note_id IS NOT NULL AND student_id IS NULL`, 1, 1));

  results.push(await q("photo journal_id vs note.diary_id 불일치",
    `SELECT pam.id FROM photo_assets_meta pam JOIN class_diary_student_notes sn ON sn.id=pam.student_note_id WHERE pam.student_note_id IS NOT NULL AND pam.journal_id IS NOT NULL AND sn.diary_id != pam.journal_id`, 1, 5,
    `SELECT pam.id, pam.journal_id AS p_jnl, sn.diary_id AS n_diary FROM photo_assets_meta pam JOIN class_diary_student_notes sn ON sn.id=pam.student_note_id WHERE pam.student_note_id IS NOT NULL AND pam.journal_id IS NOT NULL AND sn.diary_id != pam.journal_id LIMIT 5`));

  // ── 3. Diary 무결성 ───────────────────────────────────────────
  section("3. Diary 무결성 검사");
  results.push(await q("같은 날짜 활성 diary 중복",
    `SELECT class_group_id, lesson_date FROM class_diaries WHERE is_deleted=false GROUP BY class_group_id, lesson_date HAVING COUNT(*)>1`, 1, 1,
    `SELECT class_group_id, lesson_date, COUNT(*) AS cnt FROM class_diaries WHERE is_deleted=false GROUP BY class_group_id, lesson_date HAVING COUNT(*)>1 LIMIT 5`));

  results.push(await q("orphan diary — 삭제된 pool 참조 (활성)",
    `SELECT cd.id FROM class_diaries cd LEFT JOIN swimming_pools sp ON sp.id=cd.swimming_pool_id WHERE sp.id IS NULL AND cd.swimming_pool_id NOT LIKE 'sim_%' AND cd.is_deleted=false`, 1, 20,
    `SELECT cd.id, cd.swimming_pool_id, cd.lesson_date FROM class_diaries cd LEFT JOIN swimming_pools sp ON sp.id=cd.swimming_pool_id WHERE sp.id IS NULL AND cd.swimming_pool_id NOT LIKE 'sim_%' AND cd.is_deleted=false LIMIT 5`));

  // ── 4. Student Note 무결성 ────────────────────────────────────
  section("4. Student Note 무결성 검사");
  results.push(await q("stale note (자동복구 가능)",
    `SELECT sn.id FROM class_diary_student_notes sn JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true WHERE sn.is_deleted=false AND EXISTS (SELECT 1 FROM class_diaries r WHERE r.class_group_id=cd.class_group_id AND r.lesson_date=cd.lesson_date AND r.is_deleted=false)`, 1, 5,
    `SELECT sn.id, sn.diary_id, cd.lesson_date FROM class_diary_student_notes sn JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true WHERE sn.is_deleted=false AND EXISTS (SELECT 1 FROM class_diaries r WHERE r.class_group_id=cd.class_group_id AND r.lesson_date=cd.lesson_date AND r.is_deleted=false) LIMIT 5`));

  results.push(await q("stale note (수정 불가)",
    `SELECT sn.id FROM class_diary_student_notes sn JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true WHERE sn.is_deleted=false AND NOT EXISTS (SELECT 1 FROM class_diaries r WHERE r.class_group_id=cd.class_group_id AND r.lesson_date=cd.lesson_date AND r.is_deleted=false)`, 1, 20));

  results.push(await q("note-photo student_id 불일치",
    `SELECT pam.id FROM photo_assets_meta pam JOIN class_diary_student_notes sn ON sn.id=pam.student_note_id WHERE pam.student_note_id IS NOT NULL AND pam.student_id IS NOT NULL AND sn.student_id IS NOT NULL AND pam.student_id != sn.student_id`, 1, 1));

  // ── 5. Storage / UUID ─────────────────────────────────────────
  section("5. Storage / UUID 검사");
  const largeFiles = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS cnt FROM photo_assets_meta WHERE file_size > 52428800
  `));
  const largeCnt = Number((largeFiles.rows[0] as any)?.cnt ?? 0);
  log(`  ${largeCnt > 0 ? `${YELLOW}⚠️  WARN${RESET}` : `${GREEN}✅ PASS${RESET}`}  50MB 초과 사진: ${largeCnt}건`);
  if (largeCnt > 0) results.push({ id: "large_files", label: "50MB 초과 사진", level: "WARNING", count: largeCnt });

  const nullSize = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM photo_assets_meta WHERE file_size IS NULL`));
  const nullCnt = Number((nullSize.rows[0] as any)?.cnt ?? 0);
  log(`  ${nullCnt > 0 ? `${YELLOW}⚠️  WARN${RESET}` : `${GREEN}✅ PASS${RESET}`}  file_size NULL: ${nullCnt}건`);
  if (nullCnt > 0) results.push({ id: "null_size", label: "file_size NULL", level: "WARNING", count: nullCnt });

  // ── 6. Cleanup 필요 여부 ──────────────────────────────────────
  section("6. Cleanup 필요 여부");
  const old = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS detach30, (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='draft' AND created_at < NOW() - INTERVAL '30 days') AS draft30
    FROM photo_assets_meta WHERE media_status='detached' AND created_at < NOW() - INTERVAL '30 days'
  `));
  const o = old.rows[0] as any;
  log(`  ${Number(o.detach30) > 10 ? `${YELLOW}⚠️  WARN${RESET}` : `${GREEN}✅ PASS${RESET}`}  30일 이상 detached 사진: ${o.detach30}건`);
  log(`  ${Number(o.draft30) > 50 ? `${YELLOW}⚠️  WARN${RESET}` : `${GREEN}✅ PASS${RESET}`}  30일 이상 미사용 draft 사진: ${o.draft30}건`);
  if (Number(o.detach30) > 10) results.push({ id: "cleanup_detach", label: "30일+ detached", level: "WARNING", count: Number(o.detach30) });
  if (Number(o.draft30) > 50) results.push({ id: "cleanup_draft", label: "30일+ draft", level: "WARNING", count: Number(o.draft30) });

  // ── 최종 요약 ────────────────────────────────────────────────
  const errors   = results.filter(r => r.level === "ERROR");
  const warnings = results.filter(r => r.level === "WARNING");
  const passes   = results.filter(r => r.level === "PASS");
  const elapsed  = Date.now() - start;
  const overall: Level = errors.length ? "ERROR" : warnings.length ? "WARNING" : "PASS";

  if (useJson) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), overall, elapsed, stats: s, results }, null, 2));
  } else {
    log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════${RESET}`);
    log(`${BOLD}  Auto-Diagnosis 결과  (${elapsed}ms)${RESET}`);
    log(`  ${GREEN}PASS${RESET} ${passes.length}건  |  ${YELLOW}WARNING${RESET} ${warnings.length}건  |  ${RED}ERROR${RESET} ${errors.length}건`);
    if (errors.length) { log(`\n${RED}  ERROR — 즉시 조치 필요:${RESET}`); errors.forEach(e => log(`    ❌ ${e.label}: ${e.count}건`)); }
    if (warnings.length) { log(`\n${YELLOW}  WARNING — 검토 권장:${RESET}`); warnings.forEach(w => log(`    ⚠️  ${w.label}: ${w.count}건`)); }
    const txt = overall === "PASS" ? `${GREEN}${BOLD}PASS — Media Engine 정상 운영 가능${RESET}` : overall === "WARNING" ? `${YELLOW}${BOLD}WARNING — 검토 권장 항목 있음${RESET}` : `${RED}${BOLD}ERROR — 즉시 조치 필요${RESET}`;
    log(`\n  전체 상태: ${txt}`);
    log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════${RESET}\n`);
  }

  process.exit(errors.length ? 2 : warnings.length ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(2); });
