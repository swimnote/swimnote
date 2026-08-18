/**
 * pool-db-cs-15.ts — WP-CS15: Traceability, Incident & Knowledge Conflict Governance
 *
 * Schema additions:
 *   1. pool_support_incidents — 수영장별 운영 장애 기록 (§13-14)
 *   2. support_cases.origin_request_id — 최초 request_id 추적 (§19)
 *   3. support_knowledge_items.supersedes_id — 지식 supersede 관계 (§11)
 *   4. support_knowledge_items.superseded_by_id — 지식 supersede 관계 (§11)
 *   5. support_knowledge_items.conflict_group — conflict 탐지용 그룹 키 (§8)
 *
 * 원칙:
 *   - ACTIVE Knowledge AUTO 수정 없음
 *   - PENDING Candidate AUTO 승격 없음
 *   - AUTO DELETE 없음
 *   - Production write = NO (migration 코드만, 미배포)
 *   - Incident 생성 권한 = super_admin / platform_admin (NOT LLM/AI)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

let ran = false;

export async function runCs15Migration(): Promise<void> {
  if (ran) return;
  ran = true;

  // ── 1. pool_support_incidents ─────────────────────────────────────────────
  // KNOWN_ISSUE knowledge와 구분되는 실제 발생 운영 장애 (§13).
  // LLM/AI가 incident status를 변경하면 절대 안 됨 (§15).
  // incident_id는 pool-scoped (super_incidents는 global).
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS pool_support_incidents (
      id                TEXT PRIMARY KEY,
      pool_id           TEXT REFERENCES swimming_pools(id),   -- null = global
      category          TEXT NOT NULL,                         -- PUSH / AI_DIARY / SERVER_API 등
      status            TEXT NOT NULL
                          CHECK (status IN (
                            'INVESTIGATING',  -- 확인 중 (CONFIRMED와 동일 표현 금지)
                            'CONFIRMED',      -- 확인된 장애
                            'MONITORING',     -- 조치 후 모니터링
                            'RESOLVED',       -- 해결됨
                            'FALSE_ALARM'     -- 장애 아님
                          )),
      severity          TEXT NOT NULL CHECK (severity IN ('SEV1','SEV2','SEV3','SEV4')),
      started_at        TIMESTAMPTZ,
      resolved_at       TIMESTAMPTZ,
      affected_features TEXT[]  NOT NULL DEFAULT '{}',
      affected_modes    TEXT[]  NOT NULL DEFAULT '{}',
      affected_platforms TEXT[] NOT NULL DEFAULT '{}',
      affected_versions TEXT[]  NOT NULL DEFAULT '{}',
      confirmed_by      TEXT,                                  -- admin user id (NOT LLM)
      summary           TEXT    NOT NULL,                      -- internal summary
      safe_user_message TEXT    NOT NULL,                      -- client에 전달 가능한 메시지
      knowledge_item_ids TEXT[] NOT NULL DEFAULT '{}',         -- 연관 KNOWN_ISSUE knowledge id (§16)
      created_by        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS pool_support_incidents_pool_idx
      ON pool_support_incidents(pool_id)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS pool_support_incidents_status_idx
      ON pool_support_incidents(status)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS pool_support_incidents_category_idx
      ON pool_support_incidents(category)
  `);

  // ── 2. support_cases.origin_request_id ────────────────────────────────────
  // 케이스 최초 생성을 유발한 request_id 추적 (§19).
  // COALESCE로 첫 번째 요청만 설정 (이후 변경 금지).
  await superAdminDb.execute(sql`
    ALTER TABLE support_cases
    ADD COLUMN IF NOT EXISTS origin_request_id TEXT
  `);

  // ── 3. support_knowledge_items: supersede 관계 (§11) ─────────────────────
  // 구 knowledge가 ACTIVE로 남아 동시 retrieval되는 문제 방지.
  // AUTO ACTIVE→ARCHIVED 변경 금지 — review candidate 표시만.
  await superAdminDb.execute(sql`
    ALTER TABLE support_knowledge_items
    ADD COLUMN IF NOT EXISTS supersedes_id TEXT
      REFERENCES support_knowledge_items(id)
  `);
  await superAdminDb.execute(sql`
    ALTER TABLE support_knowledge_items
    ADD COLUMN IF NOT EXISTS superseded_by_id TEXT
      REFERENCES support_knowledge_items(id)
  `);

  // ── 4. support_knowledge_items: conflict_group ────────────────────────────
  // 동일 feature/category의 중복 ACTIVE 탐지 키 (§12).
  // 값 형식: "{feature}:{item_type}:{scope}" 예: "ai_diary:FAQ:global"
  await superAdminDb.execute(sql`
    ALTER TABLE support_knowledge_items
    ADD COLUMN IF NOT EXISTS conflict_group TEXT
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_knowledge_conflict_group_idx
      ON support_knowledge_items(conflict_group)
      WHERE status = 'active'
  `);

  // ── 5. pool_support_incidents ↔ support_cases linkage ─────────────────────
  // support_cases에서 incident 연결 (§16, §18).
  await superAdminDb.execute(sql`
    ALTER TABLE support_cases
    ADD COLUMN IF NOT EXISTS incident_id TEXT
      REFERENCES pool_support_incidents(id)
  `);
}
