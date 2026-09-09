/**
 * auth-identity-unique.ts
 *
 * P0 — AUTH IDENTITY INTEGRITY / GLOBAL LOGIN ID UNIQUE
 *
 * 목표:
 *  1. parent_accounts.login_id 에 전역 UNIQUE 제약 추가
 *     (pool-scoped 아님 — 전체 시스템에서 login_id 1개 = 사용자 1명)
 *
 * 전제 조건 (실행 전 반드시 확인):
 *  - Production DB에서 LOWER(TRIM(login_id)) 중복 row == 0
 *  - 조사 날짜: 2026-09-10 (116 rows, 75 has login_id, 0 duplicates)
 *
 * 정책:
 *  - normalization: TRIM only (case-sensitive). lowercase 아님.
 *    → 기존 75개 계정의 대소문자 유지.
 *  - users.email: 이미 users_email_unique UNIQUE 적용됨 (변경 없음)
 */

import { buildConfig } from "@workspace/db";
import { Pool } from "pg";

const pool = new Pool({ connectionString: buildConfig().connectionString });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. 실행 전 중복 확인 (안전장치) ───────────────────────────────────
    const dup = await client.query(`
      SELECT TRIM(login_id) AS nid, COUNT(*) AS cnt
      FROM parent_accounts
      WHERE login_id IS NOT NULL AND TRIM(login_id) != ''
      GROUP BY TRIM(login_id)
      HAVING COUNT(*) > 1
    `);
    if (dup.rows.length > 0) {
      console.error("[ABORT] Production에 중복 login_id가 존재합니다. migration 중단.");
      console.error("중복 그룹:", dup.rows.length, "개");
      dup.rows.forEach(r => console.error(" -", r.cnt, "rows for masked:", r.nid.slice(0,2) + "***"));
      process.exit(1);
    }
    console.log("[OK] 중복 login_id 없음. migration 진행.");

    // ── 2. UNIQUE INDEX 추가 (partial: login_id IS NOT NULL) ───────────────
    // NULL은 UNIQUE 제약에서 제외 (login_id optional 정책 유지).
    await client.query(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
        idx_parent_accounts_login_id_unique
        ON parent_accounts (login_id)
        WHERE login_id IS NOT NULL
    `);
    console.log("[OK] UNIQUE INDEX 생성: idx_parent_accounts_login_id_unique");

    await client.query("COMMIT");
    console.log("[DONE] auth-identity-unique migration 완료");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[ERROR] migration 실패:", e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
