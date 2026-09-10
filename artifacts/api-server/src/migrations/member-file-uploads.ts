import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * member_file_uploads — 엑셀 업로드 파일 이력
 * 수영장 원장이 회원 명단 엑셀을 올릴 때 파일을 R2에 보관하고
 * 업로드 성공/실패 여부를 기록한다.
 */
export async function up() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS member_file_uploads (
      id                TEXT        PRIMARY KEY,
      pool_id           TEXT        NOT NULL REFERENCES swimming_pools(id) ON DELETE CASCADE,
      r2_key            TEXT        NOT NULL,
      original_filename TEXT        NOT NULL,
      file_size_bytes   BIGINT,
      uploaded_by       TEXT        NOT NULL,
      status            TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'success', 'failed')),
      row_count         INTEGER,
      error_detail      TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_member_file_uploads_pool_id
      ON member_file_uploads (pool_id, created_at DESC);
  `);
  console.log("[migration] member_file_uploads 테이블 생성 완료");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  up().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
