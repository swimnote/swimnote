/**
 * diagnose-diary-photos.ts — 7/23 일지 상세 + draft 사진 현황
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // 1. 7/23 일지 상세
  const diaries = await db.execute(sql`
    SELECT cd.id, cd.lesson_date, cd.swimming_pool_id, cd.created_at,
           cg.name AS class_name,
           COUNT(pam.id) AS total_photos,
           COUNT(CASE WHEN pam.student_note_id IS NULL AND pam.student_id IS NULL THEN 1 END) AS common_photos,
           COUNT(CASE WHEN pam.student_note_id IS NOT NULL THEN 1 END) AS individual_photos
    FROM class_diaries cd
    LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
    LEFT JOIN photo_assets_meta pam ON pam.journal_id = cd.id AND pam.media_status = 'attached'
    WHERE cd.is_deleted = false AND cd.lesson_date = '2026-07-23'
    GROUP BY cd.id, cd.lesson_date, cd.swimming_pool_id, cd.created_at, cg.name
    ORDER BY cd.created_at DESC
  `);

  console.log("=== 2026-07-23 일지 목록 ===");
  (diaries.rows as any[]).forEach(r => {
    console.log(`diary_id=${r.id} | 반=${r.class_name} | common=${r.common_photos} | individual=${r.individual_photos} | created=${new Date(r.created_at).toISOString().slice(0,16)}`);
  });

  // 2. 7/23 일지에 연결된 사진 상세
  const attachedPhotos = await db.execute(sql`
    SELECT pam.id, pam.album_type, pam.student_id, pam.student_note_id,
           pam.media_status, pam.uploaded_by_name, pam.created_at,
           s.name AS student_name,
           cd.lesson_date
    FROM photo_assets_meta pam
    JOIN class_diaries cd ON cd.id = pam.journal_id AND cd.lesson_date = '2026-07-23'
    LEFT JOIN students s ON s.id = pam.student_id
    WHERE pam.media_status = 'attached'
    ORDER BY pam.created_at
  `);
  console.log(`\n=== 7/23 연결된 사진 (${(attachedPhotos.rows as any[]).length}개) ===`);
  (attachedPhotos.rows as any[]).forEach(r => {
    const type = r.student_note_id ? "individual" : r.student_id ? "orphan" : "common";
    console.log(`  [${type}] id=${r.id.slice(0,12)} album=${r.album_type} student=${r.student_name ?? "NULL"} by=${r.uploaded_by_name}`);
  });

  // 3. draft 사진 중 7/23 즈음 업로드된 것
  const drafts = await db.execute(sql`
    SELECT pam.id, pam.album_type, pam.student_id, pam.class_id,
           pam.uploaded_by_name, pam.created_at, pam.media_status,
           cg.name AS class_name
    FROM photo_assets_meta pam
    LEFT JOIN class_groups cg ON cg.id = pam.class_id
    WHERE pam.media_status IN ('draft', 'detached')
      AND pam.created_at > NOW() - INTERVAL '2 days'
    ORDER BY pam.created_at DESC
    LIMIT 20
  `);
  console.log(`\n=== 최근 2일 미연결 사진 (${(drafts.rows as any[]).length}개) ===`);
  (drafts.rows as any[]).forEach(r => {
    console.log(`  id=${r.id.slice(0,12)} album=${r.album_type} class=${r.class_name ?? "없음"} student_id=${r.student_id ? r.student_id.slice(0,8) : "NULL"} status=${r.media_status} created=${new Date(r.created_at).toISOString().slice(0,16)}`);
  });

  // 4. 사진 재사용 정책 확인: 동일 pool_id에서 journal_id가 같은 사진이 있는지 (중복 연결 여부)
  const multiDiary = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM photo_assets_meta pam
    WHERE pam.media_status = 'attached'
      AND pam.journal_id IS NOT NULL
    GROUP BY pam.id
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  console.log(`\n=== 동일 사진이 여러 일지에 연결된 사례: ${(multiDiary.rows as any[]).length}건 ===`);
  console.log("→ 0이면 현재는 1사진=1일지 정책 (테이블 구조상 journal_id 1개 컬럼이므로 구조적으로 불가능)");

  console.log("\n=== 진단 완료 ===");
}

main().catch(e => { console.error(e); process.exit(1); });
