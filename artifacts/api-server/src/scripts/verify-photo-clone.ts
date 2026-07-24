/**
 * verify-photo-clone.ts — Production DB Photo Clone 마이그레이션 검증
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== Production DB Photo Clone 검증 ===\n");

  // 1. 컬럼 존재 확인
  const cols = await db.execute(sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'photo_assets_meta'
      AND column_name IN ('source_photo_id', 'is_clone')
    ORDER BY column_name
  `);
  console.log("1. 컬럼 상태:");
  (cols.rows as any[]).forEach(r =>
    console.log(`   ${r.column_name}: type=${r.data_type} nullable=${r.is_nullable} default=${r.column_default}`)
  );

  // 2. 인덱스 확인
  const idx = await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'photo_assets_meta'
      AND indexname LIKE 'idx_photo_clone%'
    ORDER BY indexname
  `);
  console.log("\n2. Unique 인덱스:");
  (idx.rows as any[]).forEach(r => console.log(`   ${r.indexname}`));

  // 3. Self FK 확인
  const fk = await db.execute(sql`
    SELECT constraint_name, delete_rule
    FROM information_schema.referential_constraints
    WHERE constraint_name = 'fk_photo_source'
  `);
  console.log("\n3. Self FK:");
  if ((fk.rows as any[]).length > 0) {
    const f = fk.rows[0] as any;
    console.log(`   ${f.constraint_name} ON DELETE ${f.delete_rule}`);
  } else {
    console.log("   (없음)");
  }

  // 4. Row 현황
  const cnt = await db.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(CASE WHEN is_clone = false THEN 1 END)::int AS originals,
           COUNT(CASE WHEN is_clone = true THEN 1 END)::int AS clones,
           COUNT(CASE WHEN source_photo_id IS NOT NULL THEN 1 END)::int AS with_source
    FROM photo_assets_meta
  `);
  const c = cnt.rows[0] as any;
  console.log(`\n4. Row 현황: 전체=${c.total} | 원본=${c.originals} | clone=${c.clones} | source_id있음=${c.with_source}`);

  // 5. 스토리지 계산 검증 (is_clone=false만 합산)
  const storage = await db.execute(sql`
    SELECT COALESCE(SUM(file_size), 0)::bigint AS used_bytes_total,
           COALESCE(SUM(CASE WHEN is_clone = false THEN file_size ELSE 0 END), 0)::bigint AS used_bytes_originals
    FROM photo_assets_meta
  `);
  const s = storage.rows[0] as any;
  console.log(`\n5. 스토리지: 전체합산=${Number(s.used_bytes_total).toLocaleString()}B | 원본만=${Number(s.used_bytes_originals).toLocaleString()}B`);

  console.log("\n=== 검증 완료 ===");
}

main().catch(e => { console.error("검증 실패:", e); process.exit(1); });
