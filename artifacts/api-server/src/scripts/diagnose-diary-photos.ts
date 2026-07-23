/**
 * diagnose-diary-photos.ts
 * 최근 일지의 사진 연결 상태 전체 진단
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== 최근 일지 사진 연결 상태 진단 ===\n");

  // 1. 최근 30개 일지 중 사진이 있는 것
  const diaries = await db.execute(sql`
    SELECT cd.id, cd.lesson_date, cd.swimming_pool_id, cd.class_group_id,
           cg.name AS class_name,
           COUNT(pam.id) AS total_photos,
           COUNT(CASE WHEN pam.student_note_id IS NULL AND pam.student_id IS NULL THEN 1 END) AS common_photos,
           COUNT(CASE WHEN pam.student_note_id IS NOT NULL THEN 1 END) AS individual_photos,
           COUNT(CASE WHEN pam.student_note_id IS NULL AND pam.student_id IS NOT NULL THEN 1 END) AS orphan_photos
    FROM class_diaries cd
    LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
    LEFT JOIN photo_assets_meta pam ON pam.journal_id = cd.id AND pam.media_status = 'attached'
    WHERE cd.is_deleted = false
    GROUP BY cd.id, cd.lesson_date, cd.swimming_pool_id, cd.class_group_id, cg.name
    HAVING COUNT(pam.id) > 0
    ORDER BY cd.created_at DESC
    LIMIT 10
  `);

  console.log("=== 최근 일지 (사진 있는 것) ===");
  console.log("diary_id | 날짜 | 반 | 전체사진 | common | individual | orphan(invisible)");
  (diaries.rows as any[]).forEach(r => {
    const flag = r.orphan_photos > 0 ? " ⚠️ ORPHAN!" : "";
    const common = r.common_photos > 0 ? r.common_photos : "❌0";
    console.log(`${r.id.slice(0,8)}... | ${r.lesson_date} | ${r.class_name} | 총${r.total_photos} | common:${common} | indiv:${r.individual_photos}${flag}`);
  });

  // 2. orphan 사진 상세
  const orphans = await db.execute(sql`
    SELECT pam.id, pam.journal_id, pam.student_id, pam.student_note_id,
           pam.album_type, pam.media_status, pam.uploaded_by_name,
           s.name AS student_name, cd.lesson_date
    FROM photo_assets_meta pam
    JOIN class_diaries cd ON cd.id = pam.journal_id AND cd.is_deleted = false
    LEFT JOIN students s ON s.id = pam.student_id
    WHERE pam.journal_id IS NOT NULL
      AND pam.student_note_id IS NULL
      AND pam.student_id IS NOT NULL
      AND pam.media_status = 'attached'
    ORDER BY pam.created_at DESC
    LIMIT 10
  `);
  if ((orphans.rows as any[]).length > 0) {
    console.log("\n=== Orphan 사진 (학부모에게 보이지 않는 전체일지 사진) ===");
    (orphans.rows as any[]).forEach(r => {
      console.log(`  photo=${r.id.slice(0,8)} album_type=${r.album_type} student_id=${r.student_id?.slice(0,8)} diary=${r.journal_id?.slice(0,8)} date=${r.lesson_date}`);
    });
  } else {
    console.log("\n✅ Orphan 사진 없음 (student_id 문제는 아님)");
  }

  // 3. draft 상태로 남은 사진 (일지 저장 후에도 연결 안 된 것)
  const draftStuck = await db.execute(sql`
    SELECT pam.id, pam.album_type, pam.class_id, pam.student_id,
           pam.uploaded_by_name, pam.lesson_date, pam.created_at,
           cg.name AS class_name
    FROM photo_assets_meta pam
    LEFT JOIN class_groups cg ON cg.id = pam.class_id
    WHERE pam.media_status = 'draft'
      AND pam.created_at > NOW() - INTERVAL '7 days'
    ORDER BY pam.created_at DESC
    LIMIT 20
  `);
  console.log(`\n=== 최근 7일 draft 상태 사진 (일지 미연결) === (${(draftStuck.rows as any[]).length}개)`);
  (draftStuck.rows as any[]).forEach(r => {
    console.log(`  id=${r.id.slice(0,8)} album_type=${r.album_type} class=${r.class_name ?? "없음"} student_id=${r.student_id ? r.student_id.slice(0,8) : "NULL"} date=${r.lesson_date ?? "null"} created=${new Date(r.created_at).toISOString().slice(0,16)}`);
  });

  // 4. 학부모 일지 사진 API 검증 - 최근 일지 하나 골라서 시뮬레이션
  const sampleDiary = (diaries.rows as any[])[0];
  if (sampleDiary) {
    console.log(`\n=== getDiaryPhotos 시뮬레이션: diary=${sampleDiary.id.slice(0,8)} ===`);
    const photos = await db.execute(sql`
      SELECT pam.id, pam.student_id, pam.student_note_id, pam.album_type,
             pam.media_status, pam.journal_id
      FROM photo_assets_meta pam
      JOIN class_diaries cd ON cd.id = pam.journal_id AND cd.is_deleted = false
      WHERE pam.journal_id = ${sampleDiary.id}
        AND pam.pool_id = ${sampleDiary.swimming_pool_id}
        AND pam.media_status = 'attached'
    `);
    const rows = photos.rows as any[];
    const common = rows.filter(p => p.student_note_id === null && p.student_id === null);
    const individual = rows.filter(p => p.student_note_id !== null && p.student_id !== null);
    const orphan = rows.filter(p => p.student_note_id === null && p.student_id !== null);
    console.log(`  전체 첨부 사진: ${rows.length}개`);
    console.log(`  → common (학부모에 공통 전달): ${common.length}개`);
    console.log(`  → individual (자녀 일치 시 전달): ${individual.length}개`);
    console.log(`  → orphan (누구에게도 전달 안 됨): ${orphan.length}개`);
    if (orphan.length > 0) {
      console.log("  Orphan 상세:", orphan.map(p => `album_type=${p.album_type} student_id=${p.student_id?.slice(0,8)}`));
    }
  }

  console.log("\n=== 진단 완료 ===");
}

main().catch(e => { console.error(e); process.exit(1); });
