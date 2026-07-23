/**
 * fix-common-photo-student-id.ts
 *
 * 버그: attachPhotosToDiary가 student_id를 NULL로 초기화하지 않아
 * 전체일지에 첨부된 사진 중 일부가 student_id != NULL 상태로 남아있어
 * getDiaryPhotos에서 common도 individual도 아닌 "유령 사진"이 되어
 * 학부모에게 전달되지 않는 문제를 수정.
 *
 * 대상: journal_id IS NOT NULL AND student_note_id IS NULL AND student_id IS NOT NULL
 *       즉, 전체일지에 연결됐으나 학생노트가 없는데 student_id가 설정된 사진
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== 전체일지 사진 student_id 복구 시작 ===\n");

  const diagResult = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM photo_assets_meta
    WHERE journal_id IS NOT NULL
      AND student_note_id IS NULL
      AND student_id IS NOT NULL
      AND media_status = 'attached'
  `);
  const affected = (diagResult.rows[0] as any)?.cnt ?? 0;
  console.log(`복구 대상 사진: ${affected}장`);

  if (affected === 0) {
    console.log("수정할 데이터 없음. 종료.");
    process.exit(0);
  }

  const sample = await db.execute(sql`
    SELECT id, journal_id, student_id, student_note_id, album_type, media_status
    FROM photo_assets_meta
    WHERE journal_id IS NOT NULL
      AND student_note_id IS NULL
      AND student_id IS NOT NULL
      AND media_status = 'attached'
    LIMIT 5
  `);
  console.log("\n샘플 (최대 5개):");
  (sample.rows as any[]).forEach(r => {
    console.log(`  id=${r.id} journal_id=${r.journal_id} student_id=${r.student_id} album_type=${r.album_type}`);
  });

  const updateResult = await db.execute(sql`
    UPDATE photo_assets_meta
    SET student_id = NULL
    WHERE journal_id IS NOT NULL
      AND student_note_id IS NULL
      AND student_id IS NOT NULL
      AND media_status = 'attached'
  `);
  console.log(`\n✅ student_id → NULL 업데이트 완료 (${affected}장)`);

  const verify = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM photo_assets_meta
    WHERE journal_id IS NOT NULL
      AND student_note_id IS NULL
      AND student_id IS NOT NULL
      AND media_status = 'attached'
  `);
  const remaining = (verify.rows[0] as any)?.cnt ?? 0;
  console.log(`검증 - 남은 문제 사진: ${remaining}장`);

  if (remaining === 0) {
    console.log("\n✅ 복구 완료. 모든 전체일지 사진이 학부모에게 전달됩니다.");
  } else {
    console.error(`\n❌ 아직 ${remaining}장이 남아있습니다.`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
