/**
 * marketing-audience.ts — WP12 Canonical Marketing Audience Resolver
 *
 * §20: Preview와 Send 모두 이 단일 resolver를 사용한다.
 * §8:  N+1 없음 — 단일 또는 최소 batch SQL만 사용한다.
 * §19: 빈 targeting을 accidental global send로 해석하지 않는다.
 */

import { sql } from "drizzle-orm";
import { superAdminDb, db } from "@workspace/db";

// ── Canonical valid values (§18 server validation) ────────────────────────────
export const VALID_PLAN_TYPES  = ["swimnote", "x300", "x500", "x1000"] as const;
export const VALID_TARGET_ROLES = ["ADMIN", "TEACHER", "PARENT"] as const;
export type MarketingPlanType  = typeof VALID_PLAN_TYPES[number];
export type MarketingRole      = typeof VALID_TARGET_ROLES[number];

export interface MarketingCriteria {
  /** null = all pools */
  poolIds:       string[] | null;
  /** null = all plans */
  planTypes:     MarketingPlanType[] | null;
  /** null = all roles */
  roles:         MarketingRole[] | null;
}

export interface AudiencePreview {
  pool_count:      number;
  user_count:      number;
  admin_count:     number;
  teacher_count:   number;
  parent_count:    number;
  push_token_count: number;
}

export interface TokenRow {
  id:    string;
  token: string;
}

/**
 * resolveTargetPoolIds — 계획 필터 + Pool ID 필터를 적용하여 대상 Pool ID 목록 반환.
 * §8: 500 pools → 단일 SQL, N+1 없음.
 * §5: Manual X / Management Override X 포함.
 */
export async function resolveTargetPoolIds(criteria: MarketingCriteria): Promise<string[]> {
  const { poolIds, planTypes } = criteria;

  // ── Plan filter fragments ────────────────────────────────────────────────
  let planCondition = "true"; // all plans
  if (planTypes && planTypes.length > 0) {
    const swimnotePlans = planTypes.filter(p => p === "swimnote");
    const xPlans        = planTypes.filter(p => p !== "swimnote");

    const clauses: string[] = [];

    if (swimnotePlans.length > 0) {
      clauses.push(`sp.subscription_tier = 'swimnote'`);
    }

    if (xPlans.length > 0) {
      // Build inline array literal — values validated against VALID_PLAN_TYPES
      const xLiteral = xPlans.map(p => `'${p}'`).join(",");
      clauses.push(
        `sp.subscription_tier = ANY(ARRAY[${xLiteral}])`,
        `(COALESCE(sp.x_manual_entitlement, false) = true AND sp.x_plan_key = ANY(ARRAY[${xLiteral}]))`,
        `(COALESCE(sp.x_management_override, false) = true AND sp.x_plan_key = ANY(ARRAY[${xLiteral}]))`,
      );
    }

    planCondition = clauses.length > 0 ? `(${clauses.join(" OR ")})` : "false";
  }

  // ── Pool ID filter ───────────────────────────────────────────────────────
  // Empty array = 0 pools selected (no pools); null = all pools (no filter).
  let poolCondition = "true";
  if (poolIds !== null) {
    if (poolIds.length === 0) return []; // explicit empty set → no pools
    const literal = poolIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    poolCondition = `sp.id = ANY(ARRAY[${literal}])`;
  }

  const rows = (await superAdminDb.execute(
    sql.raw(`SELECT sp.id FROM swimming_pools sp WHERE ${planCondition} AND ${poolCondition}`)
  )).rows as { id: string }[];

  return rows.map(r => r.id);
}

/**
 * resolveAudiencePreview — audience count를 반환 (실제 send 없음).
 * §7: target pool count, user count, role breakdown, push reachable.
 */
export async function resolveAudiencePreview(criteria: MarketingCriteria): Promise<AudiencePreview> {
  const targetPoolIds = await resolveTargetPoolIds(criteria);

  if (targetPoolIds.length === 0) {
    return { pool_count: 0, user_count: 0, admin_count: 0, teacher_count: 0, parent_count: 0, push_token_count: 0 };
  }

  const { roles } = criteria;
  const needAdmin   = !roles || roles.includes("ADMIN");
  const needTeacher = !roles || roles.includes("TEACHER");
  const needParent  = !roles || roles.includes("PARENT");

  const poolLiteral = targetPoolIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");

  // ── Users (ADMIN + TEACHER) ──────────────────────────────────────────────
  let adminCount   = 0;
  let teacherCount = 0;

  if (needAdmin || needTeacher) {
    const roleFilter: string[] = [];
    if (needAdmin)   roleFilter.push("'pool_admin'");
    if (needTeacher) roleFilter.push("'teacher'");

    const rows = (await superAdminDb.execute(sql.raw(`
      SELECT role, COUNT(*)::int AS cnt
      FROM users
      WHERE swimming_pool_id = ANY(ARRAY[${poolLiteral}])
        AND role = ANY(ARRAY[${roleFilter.join(",")}])
      GROUP BY role
    `))).rows as { role: string; cnt: number }[];

    for (const r of rows) {
      if (r.role === "pool_admin") adminCount   = Number(r.cnt);
      if (r.role === "teacher")   teacherCount = Number(r.cnt);
    }
  }

  // ── Parents ──────────────────────────────────────────────────────────────
  let parentCount = 0;
  if (needParent) {
    const [pr] = (await db.execute(sql.raw(`
      SELECT COUNT(DISTINCT id)::int AS cnt
      FROM parent_accounts
      WHERE swimming_pool_id = ANY(ARRAY[${poolLiteral}])
    `))).rows as { cnt: number }[];
    parentCount = Number(pr?.cnt ?? 0);
  }

  // ── Push tokens (rough count — distinct tokens) ──────────────────────────
  const tokenParts: string[] = [];

  if (needAdmin || needTeacher) {
    const roleFilter: string[] = [];
    if (needAdmin)   roleFilter.push("'pool_admin'");
    if (needTeacher) roleFilter.push("'teacher'");
    tokenParts.push(`
      SELECT DISTINCT pt.token
      FROM push_tokens pt
      JOIN users u ON pt.user_id = u.id
      WHERE u.swimming_pool_id = ANY(ARRAY[${poolLiteral}])
        AND u.role = ANY(ARRAY[${roleFilter.join(",")}])
        AND pt.token IS NOT NULL AND pt.token != ''
    `);
  }

  if (needParent) {
    tokenParts.push(`
      SELECT DISTINCT pt.token
      FROM push_tokens pt
      JOIN parent_accounts pa ON pt.parent_account_id = pa.id
      WHERE pa.swimming_pool_id = ANY(ARRAY[${poolLiteral}])
        AND pt.token IS NOT NULL AND pt.token != ''
    `);
  }

  let pushTokenCount = 0;
  if (tokenParts.length > 0) {
    const tokenUnion = tokenParts.join(" UNION ");
    const [tr] = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM (${tokenUnion}) AS combined`))).rows as { cnt: number }[];
    pushTokenCount = Number(tr?.cnt ?? 0);
  }

  const userCount = adminCount + teacherCount + parentCount;

  return {
    pool_count:       targetPoolIds.length,
    user_count:       userCount,
    admin_count:      adminCount,
    teacher_count:    teacherCount,
    parent_count:     parentCount,
    push_token_count: pushTokenCount,
  };
}

/**
 * resolveMarketingTokens — 실제 발송용 push token rows를 반환.
 * §21: WP5 delivery 스냅샷에 사용.
 * §8:  2 queries (users + parents), N+1 없음.
 */
export async function resolveMarketingTokens(
  targetPoolIds: string[],
  roles: MarketingRole[] | null,
): Promise<TokenRow[]> {
  if (targetPoolIds.length === 0) return [];

  const needAdmin   = !roles || roles.includes("ADMIN");
  const needTeacher = !roles || roles.includes("TEACHER");
  const needParent  = !roles || roles.includes("PARENT");

  const poolLiteral = targetPoolIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
  const seenTokenIds = new Set<string>();
  const tokenRows: TokenRow[] = [];

  // ── User tokens (ADMIN + TEACHER) — single batch query ──────────────────
  if (needAdmin || needTeacher) {
    const roleFilter: string[] = [];
    if (needAdmin)   roleFilter.push("'pool_admin'");
    if (needTeacher) roleFilter.push("'teacher'");

    const rows = (await db.execute(sql.raw(`
      SELECT DISTINCT pt.id, pt.token
      FROM push_tokens pt
      JOIN users u ON pt.user_id = u.id
      WHERE u.swimming_pool_id = ANY(ARRAY[${poolLiteral}])
        AND u.role = ANY(ARRAY[${roleFilter.join(",")}])
        AND pt.token IS NOT NULL AND pt.token != ''
    `))).rows as { id: string; token: string }[];

    for (const r of rows) {
      if (!seenTokenIds.has(r.id)) {
        seenTokenIds.add(r.id);
        tokenRows.push({ id: r.id, token: r.token });
      }
    }
  }

  // ── Parent tokens — single batch query ───────────────────────────────────
  if (needParent) {
    const rows = (await db.execute(sql.raw(`
      SELECT DISTINCT pt.id, pt.token
      FROM push_tokens pt
      JOIN parent_accounts pa ON pt.parent_account_id = pa.id
      WHERE pa.swimming_pool_id = ANY(ARRAY[${poolLiteral}])
        AND pt.token IS NOT NULL AND pt.token != ''
    `))).rows as { id: string; token: string }[];

    for (const r of rows) {
      if (!seenTokenIds.has(r.id)) {
        seenTokenIds.add(r.id);
        tokenRows.push({ id: r.id, token: r.token });
      }
    }
  }

  return tokenRows;
}

/**
 * enqueueMarketingFanoutJob — WP5 push_fanout_jobs/deliveries 스키마를 직접 재사용.
 * job_type='marketing', deterministic jobRef → idempotent.
 * §12: duplicate send 0.
 */
export async function enqueueMarketingFanoutJob(opts: {
  jobRef:        string;
  noticeId:      string;
  title:         string;
  body:          string;
  deepLink?:     string | null;
  targetPoolIds: string[];
  roles:         MarketingRole[] | null;
}): Promise<{ duplicate: boolean; deliveriesAdded: number }> {
  const { jobRef, noticeId, title, body, deepLink, targetPoolIds, roles } = opts;

  // Step 1: Insert job (idempotent) ─────────────────────────────────────────
  const jobInsert = await superAdminDb.execute(sql`
    INSERT INTO push_fanout_jobs
      (job_ref, job_type, target_ref, notif_type, title, body_text, data_json, status, created_at, updated_at)
    VALUES
      (${jobRef}, 'marketing', ${noticeId}, 'notice',
       ${title}, ${body}, ${JSON.stringify({ noticeId, type: "notice", deepLink: deepLink ?? null })}::jsonb,
       'PENDING', NOW(), NOW())
    ON CONFLICT (job_ref) DO NOTHING
  `);

  if ((jobInsert as any).rowCount === 0) {
    console.log(`[marketing-audience] duplicate job_ref=${jobRef} — skipped`);
    return { duplicate: true, deliveriesAdded: 0 };
  }

  // Step 2: Resolve tokens (batch) ──────────────────────────────────────────
  const tokenRows = await resolveMarketingTokens(targetPoolIds, roles);

  if (!tokenRows.length) {
    console.log(`[marketing-audience] job=${jobRef} no eligible tokens`);
    return { duplicate: false, deliveriesAdded: 0 };
  }

  // Step 3: Insert deliveries (batch 500) ───────────────────────────────────
  let deliveriesAdded = 0;
  const INSERT_BATCH = 500;
  for (let i = 0; i < tokenRows.length; i += INSERT_BATCH) {
    const chunk = tokenRows.slice(i, i + INSERT_BATCH);
    for (const row of chunk) {
      const r = await superAdminDb.execute(sql`
        INSERT INTO push_fanout_deliveries
          (id, job_ref, push_token_id, token_str, status, created_at)
        VALUES
          (gen_random_uuid()::text, ${jobRef}, ${row.id}, ${row.token}, 'PENDING', NOW())
        ON CONFLICT (job_ref, push_token_id) DO NOTHING
      `);
      if ((r as any).rowCount > 0) deliveriesAdded++;
    }
  }

  // Step 4: Update total_count ──────────────────────────────────────────────
  await superAdminDb.execute(sql`
    UPDATE push_fanout_jobs
    SET total_count = ${deliveriesAdded}, updated_at = NOW()
    WHERE job_ref = ${jobRef}
  `);

  console.log(`[marketing-audience] job=${jobRef} deliveries=${deliveriesAdded}`);
  return { duplicate: false, deliveriesAdded };
}
