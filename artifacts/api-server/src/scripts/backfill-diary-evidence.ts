/**
 * backfill-diary-evidence.ts
 *
 * 기존 수동 diary 342개에 curriculum evidence를 소급 생성.
 *
 * 사용법:
 *   DRY_RUN=true  pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-diary-evidence.ts
 *   DRY_RUN=false pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-diary-evidence.ts
 *
 * 원칙:
 *   - 기존 diary 본문 수정 금지 — derived evidence만 생성
 *   - AI curriculum_matches가 있는 diary (ai_generated=true) 스킵 (이미 처리됨)
 *   - ON CONFLICT DO NOTHING — 이미 growth_event 있는 note 스킵 (멱등)
 *   - 동일 normalized content → 캐시된 후보 재사용 (AI 호출 최소화)
 *   - dry-run: DB write 없이 통계만 출력
 */

import pg from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  resolveManualDiaryEvidence,
  type ManualEvidenceNote,
} from "../lib/curriculum-evidence-resolver.js";
import { upsertSessionObservation } from "../lib/curriculum-progress-mapper.js";
import { computeConfirmedProgress } from "../lib/curriculum-confirmation-engine.js";
import {
  searchCurriculumForDiary,
  getActiveCurriculumVersion,
} from "../lib/curriculum-diary-service.js";
import { extractMeaning } from "../lib/diary-parser.js";

const DRY_RUN = process.env.DRY_RUN !== "false";
const POOL_ID  = process.env.TARGET_POOL_ID ?? "pool_1780849364252_l9k44rbk3"; // 토이키즈스윔클럽

const pgUrl = process.env.SUPABASE_DATABASE_URL!;
const pgPool = new pg.Pool({ connectionString: pgUrl, max: 3 });
const db = drizzle(pgPool);

// ─────────────────────────────────────────────────────────────────────────────

interface DiaryNoteRow {
  diary_id:    string;
  note_id:     string;
  student_id:  string;
  note_content:string;
  lesson_date: string;
}

async function fetchManualDiaryNotes(): Promise<DiaryNoteRow[]> {
  const rows = await pgPool.query<DiaryNoteRow>(`
    SELECT
      cd.id          AS diary_id,
      csn.id         AS note_id,
      csn.student_id,
      csn.note_content,
      cd.lesson_date
    FROM class_diaries cd
    JOIN class_diary_student_notes csn ON csn.diary_id = cd.id
    WHERE cd.swimming_pool_id = $1
      AND cd.is_deleted       = false
      AND cd.ai_generated     = false
      AND csn.is_deleted      = false
      AND csn.note_content IS NOT NULL
      AND LENGTH(TRIM(csn.note_content)) >= 6
    ORDER BY cd.lesson_date DESC, cd.id, csn.student_id
  `, [POOL_ID]);
  return rows.rows;
}

// 이미 growth_event가 있는 (diary_note_id, student_id) 조합 조회
async function fetchAlreadyMapped(): Promise<Set<string>> {
  const rows = await pgPool.query(`
    SELECT DISTINCT ge.diary_note_id
    FROM growth_events ge
    WHERE ge.swimming_pool_id = $1
      AND ge.is_invalidated   = false
      AND ge.diary_note_id IS NOT NULL
  `, [POOL_ID]);
  return new Set(rows.rows.map((r: any) => r.diary_note_id));
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`BACKFILL DIARY EVIDENCE — DRY_RUN=${DRY_RUN} POOL=${POOL_ID}`);
  console.log(`${"=".repeat(60)}\n`);

  // 1. Active curriculum version 확인
  const version = await getActiveCurriculumVersion(POOL_ID);
  if (!version) {
    console.error("❌ No ACTIVE curriculum version found for pool. Aborting.");
    process.exit(1);
  }
  console.log(`✅ Active curriculum: ${version.id} (${version.version_name})\n`);

  // 2. 기존 수동 diary + student notes 조회
  const notes = await fetchManualDiaryNotes();
  console.log(`📋 Manual diary student_notes: ${notes.length} rows\n`);

  // 3. 이미 매핑된 notes 조회 (멱등 보장)
  const alreadyMapped = await fetchAlreadyMapped();
  console.log(`⏩ Already mapped note IDs: ${alreadyMapped.size}\n`);

  // 4. 그룹핑: diary_id별로 묶기
  const byDiary = new Map<string, DiaryNoteRow[]>();
  for (const note of notes) {
    if (!byDiary.has(note.diary_id)) byDiary.set(note.diary_id, []);
    byDiary.get(note.diary_id)!.push(note);
  }

  // 5. 통계
  let totalNotes   = 0;
  let alreadyDone  = 0;
  let toProcess    = 0;
  let tooShort     = 0;
  let strongNeg    = 0;
  let noCandidates = 0;
  let mapped       = 0;
  let errors       = 0;

  // 캐시: normalized content → candidate result (동일 텍스트 재사용)
  const searchCache = new Map<string, boolean>();

  // 6. 각 diary 처리
  let processedDiaries = 0;

  for (const [diaryId, diaryNotes] of byDiary) {
    const filtered: ManualEvidenceNote[] = [];
    for (const n of diaryNotes) {
      totalNotes++;
      if (alreadyMapped.has(n.note_id)) { alreadyDone++; continue; }
      filtered.push({ noteId: n.note_id, studentId: n.student_id, noteContent: n.note_content });
    }

    if (filtered.length === 0) continue;
    toProcess += filtered.length;

    const result = await resolveManualDiaryEvidence({
      db,
      poolId:  POOL_ID,
      diaryId,
      notes:   filtered,
      dryRun:  DRY_RUN,
    });

    mapped       += result.growthEventsInserted;
    errors       += result.skipReasons.filter(r => r.includes("ERROR")).length;
    noCandidates += result.skipReasons.filter(r => r.includes("NO_CANDIDATES")).length;
    tooShort     += result.skipReasons.filter(r => r.includes("TOO_SHORT")).length;
    strongNeg    += result.skipReasons.filter(r => r.includes("STRONG_NEGATIVE")).length;

    processedDiaries++;
    if (processedDiaries % 20 === 0) {
      process.stdout.write(`  ⏳ diaries processed: ${processedDiaries}/${byDiary.size}\r`);
    }
  }

  // 7. CPO/SCP 재계산 (실제 실행 시)
  if (!DRY_RUN && mapped > 0) {
    console.log(`\n\n🔄 Running CPO/SCP pipeline for affected students...`);
    const affectedStudents = new Set(
      notes
        .filter(n => !alreadyMapped.has(n.note_id))
        .map(n => n.student_id)
    );
    let cpoOk = 0, cpoFail = 0;
    for (const studentId of affectedStudents) {
      try {
        // diary별 CPO 재계산은 upsertSessionObservation에 diaryId 하나씩
        // 여기서는 backfill이므로 student 단위로 최신 diary를 기준으로 재계산
        await computeConfirmedProgress(db as any, studentId, POOL_ID);
        cpoOk++;
      } catch (e: any) {
        cpoFail++;
        console.error(`  CPO/SCP error student=${studentId}: ${e.message}`);
      }
    }
    console.log(`  CPO/SCP OK=${cpoOk} FAIL=${cpoFail} students=${affectedStudents.size}`);
  }

  // 8. Dry-run 후보 상세 출력
  if (DRY_RUN) {
    console.log("\n📊 DRY-RUN SAMPLE CANDIDATES (first 10):");
    // 수동으로 샘플 출력
    let sampleCount = 0;
    for (const [diaryId, diaryNotes] of byDiary) {
      if (sampleCount >= 10) break;
      for (const n of diaryNotes) {
        if (sampleCount >= 10) break;
        if (alreadyMapped.has(n.note_id)) continue;
        const trimmed = n.note_content?.trim() ?? "";
        if (trimmed.length < 6) continue;
        const meaning = extractMeaning(trimmed);
        try {
          const sr = await searchCurriculumForDiary(POOL_ID, meaning);
          const top = sr.usedTemplates[0];
          console.log(`  [${n.lesson_date}] student=${n.student_id.slice(-6)}`);
          console.log(`    note: "${trimmed.slice(0, 60)}..."`);
          if (top) {
            console.log(`    → item: "${top.template_text?.slice(0, 60) ?? top.level_name}" score=${top.score?.toFixed(3)}`);
          } else {
            console.log(`    → NO_CANDIDATES`);
          }
          sampleCount++;
        } catch (e: any) {
          console.log(`    → SEARCH_ERROR: ${e.message}`);
        }
      }
    }
  }

  // 9. 최종 보고
  console.log(`\n${"=".repeat(60)}`);
  console.log(`BACKFILL RESULT`);
  console.log(`${"=".repeat(60)}`);
  console.log(`total notes queried:    ${totalNotes}`);
  console.log(`already mapped (skip):  ${alreadyDone}`);
  console.log(`to process:             ${toProcess}`);
  console.log(`  mapped (evidence OK): ${mapped}`);
  console.log(`  skipped (too short):  ${tooShort}`);
  console.log(`  skipped (strong neg): ${strongNeg}`);
  console.log(`  skipped (no cands):   ${noCandidates}`);
  console.log(`  errors:               ${errors}`);
  console.log(`DRY_RUN:                ${DRY_RUN}`);
  if (DRY_RUN) {
    // 비용 추정: AI Engine call은 searchCurriculumForDiary (no GPT, 순수 룰 기반)
    // 실제 GPT 호출 없음 → 추가 비용 $0
    console.log(`\n💰 Estimated AI cost: $0.00 (searchCurriculumForDiary는 룰 기반, GPT 미사용)`);
  } else {
    console.log(`\n✅ Backfill complete. ${mapped} growth_events inserted.`);
  }
  console.log(`${"=".repeat(60)}\n`);

  await pgPool.end();
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e);
  process.exit(1);
});
