/**
 * Media Engine Phase 1 — Cleanup 실행 계획 (Phase B)
 * 
 * 주의: 이 스크립트는 실제 DB를 수정합니다.
 * Dry-Run 결과를 기반으로 작성되었습니다.
 * 반드시 승인 후 실행하세요.
 * 
 * 수정 대상:
 *   체크 #2: 32건 — student_id NULL → note에서 조회 후 복구
 *   체크 #3/#13: 5건 — journal_id → note.diary_id로 동기화
 * 
 * 실행: npx tsx src/scripts/media-cleanup-plan.ts [--dry-run | --execute]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const DRY_RUN = !process.argv.includes("--execute");

async function q(query: string, params: any[] = []): Promise<any[]> {
  try {
    const res = await db.execute(sql.raw(query));
    return res.rows as any[];
  } catch (e: any) {
    console.error(`  [SQL ERROR] ${e.message?.split("\n")[0]}`);
    return [];
  }
}

async function main() {
  const mode = DRY_RUN ? "DRY-RUN (읽기 전용)" : "EXECUTE (실제 수정)";
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Media Engine Phase 1 — Cleanup 실행`);
  console.log(`  모드: ${mode}`);
  console.log(`  ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  console.log("════════════════════════════════════════════════════════════\n");

  if (DRY_RUN) {
    console.log("⚠️  DRY-RUN 모드: DB를 수정하지 않습니다.");
    console.log("   실제 실행하려면 --execute 플래그를 사용하세요.\n");
  }

  // ─── STEP 1: audit 백업 생성 ──────────────────────────────────────────────
  console.log("── STEP 1: 수정 전 audit 백업 조회 ──────────────────────────");

  const beforeCheck2 = await q(`
    SELECT pam.id, pam.student_id AS current_student_id,
           sn.student_id AS note_student_id, pam.student_note_id
    FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    WHERE pam.student_note_id IS NOT NULL AND pam.student_id IS NULL
  `);
  console.log(`  체크 #2 대상: ${beforeCheck2.length}건`);
  for (const r of beforeCheck2.slice(0, 3)) {
    console.log(`    photo=${r.id}  →  student_id 설정 예정: ${r.note_student_id}`);
  }

  const beforeCheck3 = await q(`
    SELECT pam.id, pam.journal_id AS current_journal_id,
           sn.diary_id AS note_diary_id, pam.student_note_id
    FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    WHERE pam.student_note_id IS NOT NULL
      AND pam.journal_id IS NOT NULL
      AND pam.journal_id != sn.diary_id
  `);
  console.log(`  체크 #3 (journal_id 불일치) 대상: ${beforeCheck3.length}건`);
  for (const r of beforeCheck3.slice(0, 3)) {
    console.log(`    photo=${r.id}  journal_id: ${r.current_journal_id} → ${r.note_diary_id}`);
  }

  // ─── STEP 2: 체크 #2 — student_id 복구 ──────────────────────────────────
  console.log("\n── STEP 2: 체크 #2 — student_note_id 기반 student_id 복구 ──");

  const step2sql = `
    UPDATE photo_assets_meta pam
    SET student_id = sn.student_id
    FROM class_diary_student_notes sn
    WHERE pam.student_note_id IS NOT NULL
      AND pam.student_id IS NULL
      AND sn.id = pam.student_note_id
      AND sn.student_id IS NOT NULL
  `;

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] 실행할 SQL:\n${step2sql}`);
    console.log(`  예상 수정: ${beforeCheck2.length}건`);
  } else {
    try {
      await db.execute(sql.raw(step2sql));
      const after2 = await q(`
        SELECT COUNT(*) AS cnt FROM photo_assets_meta pam
        WHERE pam.student_note_id IS NOT NULL AND pam.student_id IS NULL
      `);
      const remaining = Number((after2[0] as any)?.cnt ?? 0);
      console.log(`  ✅ 실행 완료. 잔여: ${remaining}건`);
    } catch (e: any) {
      console.error(`  ❌ STEP 2 실패: ${e.message}`);
      process.exit(1);
    }
  }

  // ─── STEP 3: 체크 #3 — journal_id를 note.diary_id로 동기화 ──────────────
  console.log("\n── STEP 3: 체크 #3 — journal_id → note.diary_id 동기화 ────");

  // 안전 체크: note.diary_id가 실제 활성 일지인지 확인
  const journalSafetyCheck = await q(`
    SELECT pam.id, sn.diary_id AS target_diary_id, cd.is_deleted AS target_deleted
    FROM photo_assets_meta pam
    JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
    LEFT JOIN class_diaries cd ON cd.id = sn.diary_id
    WHERE pam.student_note_id IS NOT NULL
      AND pam.journal_id IS NOT NULL
      AND pam.journal_id != sn.diary_id
  `);

  const safeToFix = journalSafetyCheck.filter(r => !r.target_deleted);
  const skipped = journalSafetyCheck.filter(r => r.target_deleted);

  console.log(`  안전 수정 가능: ${safeToFix.length}건  (대상 diary가 활성 상태)`);
  if (skipped.length > 0) {
    console.log(`  ⚠️  건너뜀: ${skipped.length}건  (대상 diary가 삭제된 상태)`);
    for (const r of skipped) {
      console.log(`     photo=${r.id}  target_diary=${r.target_diary_id}  deleted=true`);
    }
  }

  const step3sql = `
    UPDATE photo_assets_meta pam
    SET journal_id = sn.diary_id
    FROM class_diary_student_notes sn
    JOIN class_diaries cd ON cd.id = sn.diary_id AND cd.is_deleted = false
    WHERE pam.student_note_id IS NOT NULL
      AND pam.journal_id IS NOT NULL
      AND pam.journal_id != sn.diary_id
      AND sn.id = pam.student_note_id
  `;

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] 실행할 SQL:\n${step3sql}`);
    console.log(`  예상 수정: ${safeToFix.length}건`);
  } else {
    try {
      await db.execute(sql.raw(step3sql));
      const after3 = await q(`
        SELECT COUNT(*) AS cnt
        FROM photo_assets_meta pam
        JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
        WHERE pam.student_note_id IS NOT NULL
          AND pam.journal_id IS NOT NULL
          AND pam.journal_id != sn.diary_id
      `);
      const remaining = Number((after3[0] as any)?.cnt ?? 0);
      console.log(`  ✅ 실행 완료. 잔여: ${remaining}건`);
    } catch (e: any) {
      console.error(`  ❌ STEP 3 실패: ${e.message}`);
      process.exit(1);
    }
  }

  // ─── 최종 검증 ────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log("\n── 최종 검증 ──────────────────────────────────────────────");

    const v2 = await q(`
      SELECT COUNT(*) AS cnt FROM photo_assets_meta pam
      WHERE pam.student_note_id IS NOT NULL AND pam.student_id IS NULL
    `);
    const v3 = await q(`
      SELECT COUNT(*) AS cnt FROM photo_assets_meta pam
      JOIN class_diary_student_notes sn ON sn.id = pam.student_note_id
      WHERE pam.student_note_id IS NOT NULL
        AND pam.journal_id IS NOT NULL
        AND pam.journal_id != sn.diary_id
    `);

    const check2pass = Number((v2[0] as any)?.cnt ?? 0) === 0;
    const check3pass = Number((v3[0] as any)?.cnt ?? 0) === 0;

    console.log(`  체크 #2 검증: ${check2pass ? "✅ PASS" : "❌ FAIL (잔여 " + (v2[0] as any)?.cnt + "건)"}`);
    console.log(`  체크 #3 검증: ${check3pass ? "✅ PASS" : "❌ FAIL (잔여 " + (v3[0] as any)?.cnt + "건)"}`);

    if (!check2pass || !check3pass) {
      console.log("\n⚠️  일부 항목이 수정되지 않았습니다. 수동 확인이 필요합니다.");
      process.exit(1);
    }
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(DRY_RUN ? "  DRY-RUN 완료. --execute로 실제 실행하세요." : "  ✅ Cleanup 완료.");
  console.log("════════════════════════════════════════════════════════════");
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
