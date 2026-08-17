/**
 * CS-PA0 Migration — AI Customer Support + Partner Analytics Foundation
 *
 * 신규 테이블 3개 (idempotent):
 *   1. support_cases       — AI 고객센터 케이스 라이프사이클
 *   2. support_knowledge_items — FAQ/규칙/Known Issue/Solution 기반
 *   3. partner_analytics_snapshots — Partner 제출용 스냅샷
 *
 * 기존 schema 변경 없음.
 * 개인정보: support_cases에 원문/이름/전화/이메일 저장 금지
 *   (ticket_id → support_tickets 참조, pool_id만 직접 저장)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runCsPa0Migration(): Promise<void> {
  // ── 1. support_cases ────────────────────────────────────────────────────────
  // AI 고객센터 케이스 상태 추적. support_tickets와 1:1 연결 가능.
  // 원문/이름 저장 금지 — ticket_id FK로 기존 테이블 참조.
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS support_cases (
      id               TEXT PRIMARY KEY,
      pool_id          TEXT REFERENCES swimming_pools(id),
      ticket_id        TEXT,             -- support_tickets.id (nullable: AI 전용 케이스도 존재)
      actor_role       TEXT NOT NULL,    -- teacher / parent / pool_admin / anonymous
      mode             TEXT,            -- normal / x
      state            TEXT NOT NULL DEFAULT 'NEW',
        -- NEW / AI_PROCESSING / AI_RESPONDED / AI_RESOLVED /
        -- HUMAN_REQUIRED / HUMAN_RESPONDED / ESCALATED / RESOLVED / CLOSED
      escalation_reason TEXT,           -- NO_KNOWLEDGE / LOW_CONFIDENCE / ...
      resolution_source TEXT,           -- RULE / FAQ / SOLUTION_DB / LLM / HUMAN ...
      llm_used         BOOLEAN NOT NULL DEFAULT false,
      turn_count       INT NOT NULL DEFAULT 0,
      resolved_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_cases_pool_id_idx  ON support_cases(pool_id)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_cases_state_idx    ON support_cases(state)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_cases_created_idx  ON support_cases(created_at DESC)
  `);

  // ── 2. support_knowledge_items ───────────────────────────────────────────────
  // FAQ / 규칙 / Known Issue / Solution DB 공통 테이블.
  // Super Admin 검토 후 활성화. AI가 자동 production 승인 금지.
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS support_knowledge_items (
      id               TEXT PRIMARY KEY,
      item_type        TEXT NOT NULL,    -- FAQ / RULE / KNOWN_ISSUE / SOLUTION
      scope            TEXT NOT NULL DEFAULT 'global',  -- global / pool
      pool_id          TEXT,            -- scope=pool 일 때만
      category         TEXT,
      feature          TEXT,            -- 관련 AI feature (ai-feature-enum 값)
      affected_role    TEXT,            -- teacher / parent / all
      affected_mode    TEXT,            -- normal / x / all
      title            TEXT NOT NULL,
      content          TEXT NOT NULL,
      conditions       JSONB,          -- 적용 조건
      solution_steps   JSONB,          -- 해결 단계
      deep_link        TEXT,
      incident_id      TEXT REFERENCES super_incidents(id),  -- KNOWN_ISSUE인 경우 incidents 연결
      status           TEXT NOT NULL DEFAULT 'pending', -- pending / active / deprecated
      reviewed_by      TEXT,
      reviewed_at      TIMESTAMPTZ,
      usage_count      INT NOT NULL DEFAULT 0,
      success_count    INT NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_knowledge_type_idx   ON support_knowledge_items(item_type)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_knowledge_scope_idx  ON support_knowledge_items(scope, pool_id)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_knowledge_feature_idx ON support_knowledge_items(feature)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS support_knowledge_status_idx ON support_knowledge_items(status)
  `);

  // ── 3. partner_analytics_snapshots ──────────────────────────────────────────
  // Partner 제출 시점의 지표를 불변 기록으로 보존.
  // 생성 후 과거 snapshot 자동 갱신 금지 (append-only).
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS partner_analytics_snapshots (
      id           TEXT PRIMARY KEY,
      period_start DATE NOT NULL,
      period_end   DATE NOT NULL,
      metrics_json JSONB NOT NULL,
      label        TEXT,             -- 선택 레이블 (예: "OpenAI Partner 2026-Q2")
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by   TEXT              -- super_admin actor_id
    )
  `);

  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS partner_snapshots_period_idx ON partner_analytics_snapshots(period_end DESC)
  `);

  console.log("[cs-pa0-migration] support_cases, support_knowledge_items, partner_analytics_snapshots OK");
}
