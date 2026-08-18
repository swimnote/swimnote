/**
 * pool-db-cs-16.ts — WP-CS16: Human Review / Knowledge Approval Governance
 *
 * 추가:
 *   1. knowledge_approval_log — 승인/거절/수정/rollback 감사 이력 (§8)
 *   2. support_knowledge_items 컬럼 확장:
 *      - reject_reason TEXT (§11)
 *      - edit_note TEXT (§10)
 *      - approved_by TEXT, approved_at TIMESTAMPTZ (§20 audit trace)
 *      - rejected_by TEXT, rejected_at TIMESTAMPTZ
 *
 * 절대 원칙:
 *   - 이 migration은 status 변경을 수행하지 않는다.
 *   - PENDING → ACTIVE 자동 전환 코드 없음.
 *   - ACTIVE Knowledge 수정 없음.
 *   - Production DB write = NO (미배포).
 */

import { superAdminDb, sql } from "../db/superAdminDb.js";

let ran = false;

export async function runCs16Migration(): Promise<void> {
  if (ran) return;
  ran = true;

  try {
    // ── 1. knowledge_approval_log 테이블 ──────────────────────────────────────
    // 모든 승인/거절/수정/rollback 결정을 기록.
    // reviewer_id/role은 JWT actor 기준 (client body 신뢰 금지 §9).
    await superAdminDb.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS knowledge_approval_log (
        id                      TEXT PRIMARY KEY,
        candidate_id            TEXT        NOT NULL,
        previous_status         TEXT        NOT NULL,
        new_status              TEXT        NOT NULL,
        reviewer_id             TEXT        NOT NULL,   -- JWT req.user.id
        reviewer_role           TEXT        NOT NULL,   -- JWT req.user.role
        reviewed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decision                TEXT        NOT NULL
          CHECK (decision IN ('APPROVE', 'REJECT', 'REQUEST_EDIT', 'ROLLBACK')),
        review_notes            TEXT,
        reject_reason           TEXT
          CHECK (reject_reason IS NULL OR reject_reason IN (
            'UNSUPPORTED_SOURCE', 'NOT_IMPLEMENTED', 'WRONG_ROLE', 'WRONG_MODE',
            'POLICY_UNVERIFIED', 'DUPLICATE', 'CONFLICT', 'OUTDATED', 'SECURITY_RISK', 'OTHER'
          )),
        request_id              TEXT,                   -- CS15 traceability
        candidate_revision      INT         NOT NULL DEFAULT 1,
        resulting_knowledge_id  TEXT,                   -- approve 후 knowledge_id
        source_version          TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));

    // 검색 인덱스
    await superAdminDb.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_approval_log_candidate_id
        ON knowledge_approval_log (candidate_id)
    `));
    await superAdminDb.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_approval_log_reviewer_id
        ON knowledge_approval_log (reviewer_id)
    `));
    await superAdminDb.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_approval_log_reviewed_at
        ON knowledge_approval_log (reviewed_at DESC)
    `));

    // ── 2. support_knowledge_items 컬럼 확장 (IF NOT EXISTS — 멱등) ─────────

    // §11: 거절 이유 (REJECT_REASONS enum)
    await superAdminDb.execute(sql.raw(`
      ALTER TABLE support_knowledge_items
        ADD COLUMN IF NOT EXISTS reject_reason TEXT
          CHECK (reject_reason IS NULL OR reject_reason IN (
            'UNSUPPORTED_SOURCE', 'NOT_IMPLEMENTED', 'WRONG_ROLE', 'WRONG_MODE',
            'POLICY_UNVERIFIED', 'DUPLICATE', 'CONFLICT', 'OUTDATED', 'SECURITY_RISK', 'OTHER'
          ))
    `));

    // §10: 수정 요청 메모
    await superAdminDb.execute(sql.raw(`
      ALTER TABLE support_knowledge_items
        ADD COLUMN IF NOT EXISTS edit_note TEXT
    `));

    // §20: 승인 추적 (내부 audit; HTTP response에는 reviewer 정보 노출 안 함)
    await superAdminDb.execute(sql.raw(`
      ALTER TABLE support_knowledge_items
        ADD COLUMN IF NOT EXISTS approved_by TEXT
    `));
    await superAdminDb.execute(sql.raw(`
      ALTER TABLE support_knowledge_items
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
    `));

    // 거절 추적
    await superAdminDb.execute(sql.raw(`
      ALTER TABLE support_knowledge_items
        ADD COLUMN IF NOT EXISTS rejected_by TEXT
    `));
    await superAdminDb.execute(sql.raw(`
      ALTER TABLE support_knowledge_items
        ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ
    `));

    console.log("[cs-16] migration complete — approval governance schema added");
  } catch (e: any) {
    console.error("[cs-16] migration error:", e?.message);
  }
}
