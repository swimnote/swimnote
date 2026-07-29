/**
 * Media Engine Health Check
 * 운영자가 언제든 실행 가능한 진단 도구
 *
 * 실행: npx tsx src/scripts/media-health-check.ts
 * 결과: PASS / WARNING / ERROR
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const BOLD  = "\x1b[1m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";

type Level = "PASS" | "WARNING" | "ERROR";
interface CheckResult {
  id: string;
  label: string;
  level: Level;
  count: number;
  detail?: string;
  items?: any[];
}

const results: CheckResult[] = [];

function icon(level: Level) {
  if (level === "PASS")    return `${GREEN}✅ PASS${RESET}`;
  if (level === "WARNING") return `${YELLOW}⚠️  WARN${RESET}`;
  return `${RED}❌ ERROR${RESET}`;
}

async function check(
  id: string,
  label: string,
  query: string,
  warnAt: number,
  errorAt: number,
  detailQuery?: string
): Promise<void> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM (${query}) _`));
  const cnt = Number((r.rows[0] as any)?.cnt ?? 0);

  let level: Level = "PASS";
  if (cnt >= errorAt) level = "ERROR";
  else if (cnt >= warnAt) level = "WARNING";

  let items: any[] | undefined;
  if (cnt > 0 && detailQuery) {
    const dr = await db.execute(sql.raw(detailQuery));
    items = dr.rows as any[];
  }

  const result: CheckResult = { id, label, level, count: cnt, items };
  results.push(result);

  const tag = icon(level);
  console.log(`  ${tag}  [${id}] ${label}: ${cnt}건`);
  if (items?.length) {
    for (const it of items.slice(0, 5)) {
      const keys = Object.entries(it).map(([k, v]) => `${k}=${String(v).slice(0, 20)}`).join("  ");
      console.log(`         → ${keys}`);
    }
    if (items.length > 5) console.log(`         ... 외 ${items.length - 5}건`);
  }
}

async function main() {
  const startedAt = Date.now();
  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}  Media Engine Health Check${RESET}`);
  console.log(`${BOLD}${CYAN}  ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}${RESET}`);
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}\n`);

  // ── 전체 통계 ────────────────────────────────────────────────────────
  const stats = await db.execute(sql.raw(`
    SELECT
      (SELECT COUNT(*)::int FROM photo_assets_meta) AS total_photos,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='draft') AS draft,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='attached') AS attached,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='detached') AS detached,
      (SELECT COUNT(*)::int FROM photo_assets_meta WHERE media_status='archived') AS archived,
      (SELECT COUNT(*)::int FROM class_diaries WHERE is_deleted=false) AS active_diaries,
      (SELECT COUNT(*)::int FROM class_diary_student_notes WHERE is_deleted=false) AS active_notes
  `));
  const s = stats.rows[0] as any;
  console.log(`  사진 총 ${s.total_photos}장  | draft=${s.draft}  attached=${s.attached}  detached=${s.detached}  archived=${s.archived}`);
  console.log(`  활성 일지 ${s.active_diaries}건  | 활성 노트 ${s.active_notes}건\n`);

  console.log("── 1. 상태 무결성 ────────────────────────────────────────────────\n");

  // HC-01: 허용 외 media_status
  await check(
    "HC-01", "허용 외 media_status",
    `SELECT id FROM photo_assets_meta WHERE media_status NOT IN ('draft','attached','detached','archived') OR media_status IS NULL`,
    1, 1,
    `SELECT id, media_status FROM photo_assets_meta WHERE media_status NOT IN ('draft','attached','detached','archived') OR media_status IS NULL LIMIT 10`
  );

  // HC-02: attached 상태인데 삭제된 diary 참조
  await check(
    "HC-02", "attached 사진 → 삭제된 diary 참조",
    `SELECT pam.id FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id AND cd.is_deleted=true WHERE pam.media_status='attached'`,
    1, 1,
    `SELECT pam.id, pam.journal_id FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id AND cd.is_deleted=true WHERE pam.media_status='attached' LIMIT 10`
  );

  // HC-03: student_note_id 있으나 student_id NULL
  await check(
    "HC-03", "student_note_id O + student_id NULL",
    `SELECT id FROM photo_assets_meta WHERE student_note_id IS NOT NULL AND student_id IS NULL`,
    1, 1,
    `SELECT id, student_note_id FROM photo_assets_meta WHERE student_note_id IS NOT NULL AND student_id IS NULL LIMIT 10`
  );

  // HC-04: photo.journal_id != note.diary_id (이중 노출 위험)
  await check(
    "HC-04", "photo journal_id vs note diary_id 불일치",
    `SELECT pam.id FROM photo_assets_meta pam JOIN class_diary_student_notes sn ON sn.id=pam.student_note_id WHERE pam.student_note_id IS NOT NULL AND pam.journal_id IS NOT NULL AND sn.diary_id != pam.journal_id`,
    1, 5,
    `SELECT pam.id, pam.journal_id AS photo_jnl, sn.diary_id AS note_diary FROM photo_assets_meta pam JOIN class_diary_student_notes sn ON sn.id=pam.student_note_id WHERE pam.student_note_id IS NOT NULL AND pam.journal_id IS NOT NULL AND sn.diary_id != pam.journal_id LIMIT 10`
  );

  console.log("\n── 2. Orphan 검사 ────────────────────────────────────────────────\n");

  // HC-05: 존재하지 않는 diary 참조
  await check(
    "HC-05", "orphan journal_id (diary 없음)",
    `SELECT pam.id FROM photo_assets_meta pam LEFT JOIN class_diaries cd ON cd.id=pam.journal_id WHERE pam.journal_id IS NOT NULL AND cd.id IS NULL`,
    1, 1,
    `SELECT id, journal_id FROM photo_assets_meta WHERE journal_id IS NOT NULL AND journal_id NOT IN (SELECT id FROM class_diaries) LIMIT 10`
  );

  // HC-06: 존재하지 않는 student_note 참조
  await check(
    "HC-06", "orphan student_note_id (note 없음)",
    `SELECT pam.id FROM photo_assets_meta pam LEFT JOIN class_diary_student_notes sn ON sn.id=pam.student_note_id WHERE pam.student_note_id IS NOT NULL AND sn.id IS NULL`,
    1, 1,
    `SELECT id, student_note_id FROM photo_assets_meta WHERE student_note_id IS NOT NULL AND student_note_id NOT IN (SELECT id FROM class_diary_student_notes) LIMIT 10`
  );

  // HC-07: 존재하지 않는 student 참조
  await check(
    "HC-07", "orphan student_id (student 없음)",
    `SELECT pam.id FROM photo_assets_meta pam LEFT JOIN students s ON s.id=pam.student_id WHERE pam.student_id IS NOT NULL AND s.id IS NULL`,
    1, 1,
    `SELECT id, student_id FROM photo_assets_meta WHERE student_id IS NOT NULL AND student_id NOT IN (SELECT id FROM students) LIMIT 10`
  );

  console.log("\n── 3. Student Note 정합성 ───────────────────────────────────────\n");

  // HC-08: 삭제된 diary 참조하는 활성 note (auto-fixable)
  await check(
    "HC-08", "활성 note → 삭제된 diary (자동복구 가능)",
    `SELECT sn.id FROM class_diary_student_notes sn JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true WHERE sn.is_deleted=false AND EXISTS (SELECT 1 FROM class_diaries cd2 WHERE cd2.class_group_id=cd.class_group_id AND cd2.lesson_date=cd.lesson_date AND cd2.is_deleted=false)`,
    1, 5,
    `SELECT sn.id, sn.diary_id, cd.lesson_date FROM class_diary_student_notes sn JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true WHERE sn.is_deleted=false AND EXISTS (SELECT 1 FROM class_diaries cd2 WHERE cd2.class_group_id=cd.class_group_id AND cd2.lesson_date=cd.lesson_date AND cd2.is_deleted=false) LIMIT 10`
  );

  // HC-09: 삭제된 diary 참조 활성 note (수정 불가)
  await check(
    "HC-09", "활성 note → 삭제된 diary (수정 불가)",
    `SELECT sn.id FROM class_diary_student_notes sn JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true WHERE sn.is_deleted=false AND NOT EXISTS (SELECT 1 FROM class_diaries cd2 WHERE cd2.class_group_id=cd.class_group_id AND cd2.lesson_date=cd.lesson_date AND cd2.is_deleted=false)`,
    1, 20,
    `SELECT sn.id, sn.diary_id, cd.lesson_date, cd.class_group_id FROM class_diary_student_notes sn JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.is_deleted=true WHERE sn.is_deleted=false AND NOT EXISTS (SELECT 1 FROM class_diaries cd2 WHERE cd2.class_group_id=cd.class_group_id AND cd2.lesson_date=cd.lesson_date AND cd2.is_deleted=false) LIMIT 10`
  );

  console.log("\n── 4. 중복 / 식별자 검사 ────────────────────────────────────────\n");

  // HC-10: object_key 중복
  await check(
    "HC-10", "object_key 중복",
    `SELECT object_key FROM photo_assets_meta GROUP BY object_key HAVING COUNT(*) > 1`,
    1, 1,
    `SELECT object_key, COUNT(*) AS cnt FROM photo_assets_meta GROUP BY object_key HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 5`
  );

  // HC-11: 같은 pool+class+lesson_date 활성 diary 중복
  await check(
    "HC-11", "같은 날짜 활성 diary 중복",
    `SELECT class_group_id, lesson_date FROM class_diaries WHERE is_deleted=false GROUP BY class_group_id, lesson_date HAVING COUNT(*) > 1`,
    1, 1,
    `SELECT class_group_id, lesson_date, COUNT(*) AS cnt FROM class_diaries WHERE is_deleted=false GROUP BY class_group_id, lesson_date HAVING COUNT(*) > 1 LIMIT 5`
  );

  console.log("\n── 5. 크로스풀 검사 ─────────────────────────────────────────────\n");

  // HC-12: photo.pool_id != diary.swimming_pool_id
  await check(
    "HC-12", "cross-pool (photo.pool_id != diary.pool_id)",
    `SELECT pam.id FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id WHERE pam.pool_id != cd.swimming_pool_id`,
    1, 1,
    `SELECT pam.id, pam.pool_id AS photo_pool, cd.swimming_pool_id AS diary_pool FROM photo_assets_meta pam JOIN class_diaries cd ON cd.id=pam.journal_id WHERE pam.pool_id != cd.swimming_pool_id LIMIT 5`
  );

  // HC-13: detached 사진이지만 journal_id 잔존
  await check(
    "HC-13", "detached 사진 journal_id 잔존",
    `SELECT id FROM photo_assets_meta WHERE media_status='detached' AND journal_id IS NOT NULL`,
    1, 1,
    `SELECT id, journal_id FROM photo_assets_meta WHERE media_status='detached' AND journal_id IS NOT NULL LIMIT 10`
  );

  // HC-14: draft 사진이지만 journal_id 존재
  await check(
    "HC-14", "draft 사진 journal_id 존재",
    `SELECT id FROM photo_assets_meta WHERE media_status='draft' AND journal_id IS NOT NULL`,
    1, 1,
    `SELECT id, journal_id FROM photo_assets_meta WHERE media_status='draft' AND journal_id IS NOT NULL LIMIT 10`
  );

  // ── 최종 요약 ────────────────────────────────────────────────────────
  const errors   = results.filter(r => r.level === "ERROR");
  const warnings = results.filter(r => r.level === "WARNING");
  const passes   = results.filter(r => r.level === "PASS");
  const elapsed  = Date.now() - startedAt;

  console.log(`\n${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  결과 요약  (${elapsed}ms)${RESET}`);
  console.log(`  ${GREEN}PASS${RESET} ${passes.length}건  |  ${YELLOW}WARNING${RESET} ${warnings.length}건  |  ${RED}ERROR${RESET} ${errors.length}건`);

  if (errors.length) {
    console.log(`\n${RED}  ERROR 항목 — 즉시 조치 필요:${RESET}`);
    for (const e of errors) console.log(`    ❌ [${e.id}] ${e.label}: ${e.count}건`);
  }
  if (warnings.length) {
    console.log(`\n${YELLOW}  WARNING 항목 — 검토 권장:${RESET}`);
    for (const w of warnings) console.log(`    ⚠️  [${w.id}] ${w.label}: ${w.count}건`);
  }

  const overallLevel = errors.length > 0 ? "ERROR" : warnings.length > 0 ? "WARNING" : "PASS";
  const overallText = overallLevel === "PASS"
    ? `${GREEN}${BOLD}PASS — Media Engine 정상${RESET}`
    : overallLevel === "WARNING"
    ? `${YELLOW}${BOLD}WARNING — 검토 권장 항목 있음${RESET}`
    : `${RED}${BOLD}ERROR — 즉시 조치 필요${RESET}`;
  console.log(`\n  전체 상태: ${overallText}`);
  console.log(`${BOLD}${CYAN}════════════════════════════════════════════════════════════${RESET}\n`);

  process.exit(errors.length > 0 ? 2 : warnings.length > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(2); });
