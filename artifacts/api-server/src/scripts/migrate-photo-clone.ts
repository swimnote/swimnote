/**
 * migrate-photo-clone.ts
 * photo_assets_meta에 clone 지원 컬럼 추가
 * - source_photo_id text NULL (self FK)
 * - is_clone boolean NOT NULL DEFAULT false
 * + 중복 방지 unique 인덱스
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== Phase 1 Photo Clone 마이그레이션 시작 ===\n");

  // 1. 컬럼 추가
  console.log("1. source_photo_id 컬럼 추가...");
  await db.execute(sql`
    ALTER TABLE photo_assets_meta
    ADD COLUMN IF NOT EXISTS source_photo_id text NULL
  `);
  console.log("   ✓ source_photo_id 컬럼 추가 완료");

  console.log("2. is_clone 컬럼 추가...");
  await db.execute(sql`
    ALTER TABLE photo_assets_meta
    ADD COLUMN IF NOT EXISTS is_clone boolean NOT NULL DEFAULT false
  `);
  console.log("   ✓ is_clone 컬럼 추가 완료");

  // 2. Self FK (source_photo_id → photo_assets_meta.id)
  console.log("3. Self FK 추가...");
  try {
    await db.execute(sql`
      ALTER TABLE photo_assets_meta
      ADD CONSTRAINT fk_photo_source
      FOREIGN KEY (source_photo_id)
      REFERENCES photo_assets_meta(id)
      ON DELETE SET NULL
    `);
    console.log("   ✓ Self FK 추가 완료");
  } catch (e: any) {
    if (e.message?.includes("already exists")) {
      console.log("   ℹ FK already exists, skip");
    } else {
      throw e;
    }
  }

  // 3. 중복 방지 unique 인덱스 (clone rows만)
  //    - 같은 원본 사진이 같은 student_note에 두 번 clone 되지 않도록
  console.log("4. idx_photo_clone_note_unique 인덱스 생성...");
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_clone_note_unique
    ON photo_assets_meta (source_photo_id, student_note_id)
    WHERE is_clone = true
      AND student_note_id IS NOT NULL
      AND source_photo_id IS NOT NULL
  `);
  console.log("   ✓ note unique 인덱스 완료");

  console.log("5. idx_photo_clone_common_unique 인덱스 생성...");
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_clone_common_unique
    ON photo_assets_meta (source_photo_id, journal_id)
    WHERE is_clone = true
      AND student_note_id IS NULL
      AND journal_id IS NOT NULL
      AND source_photo_id IS NOT NULL
  `);
  console.log("   ✓ common unique 인덱스 완료");

  // 4. 검증
  console.log("\n6. 마이그레이션 결과 검증...");
  const verifyRow = await db.execute(sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'photo_assets_meta'
      AND column_name IN ('source_photo_id', 'is_clone')
    ORDER BY column_name
  `);
  const cols = verifyRow.rows as any[];
  if (cols.length < 2) {
    throw new Error("컬럼 추가 실패: " + JSON.stringify(cols));
  }
  cols.forEach(c => {
    console.log(`   컬럼: ${c.column_name} | 타입: ${c.data_type} | nullable: ${c.is_nullable} | default: ${c.column_default}`);
  });

  const idxRow = await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'photo_assets_meta'
      AND indexname LIKE 'idx_photo_clone%'
  `);
  (idxRow.rows as any[]).forEach(i => {
    console.log(`   인덱스: ${i.indexname}`);
  });

  const countRow = await db.execute(sql`
    SELECT COUNT(*) AS total,
           COUNT(CASE WHEN is_clone = false THEN 1 END) AS originals,
           COUNT(CASE WHEN is_clone = true THEN 1 END) AS clones
    FROM photo_assets_meta
  `);
  const cnt = countRow.rows[0] as any;
  console.log(`\n   전체 row: ${cnt.total} | 원본: ${cnt.originals} | clone: ${cnt.clones}`);

  console.log("\n=== 마이그레이션 완료 ===");
}

main().catch(e => { console.error("마이그레이션 실패:", e); process.exit(1); });
