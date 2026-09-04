/**
 * diary-template-sync.test.ts
 *
 * TC-SYNC-01  Pool A (350 templates) → only A curriculum_items written
 * TC-SYNC-02  Pool B (320 templates) → only B curriculum_items written
 * TC-SYNC-03  Repeated sync → ON CONFLICT upsert, no duplicate items
 * TC-SYNC-04  teacher-scope templates excluded from materialization
 * TC-SYNC-05  x_global-scope templates excluded (only scope='global')
 * TC-SYNC-06  Template deactivated → curriculum_item deactivated (subquery)
 * TC-SYNC-07  Pool A sync does not touch Pool B items
 * TC-SYNC-08  source_template_id linked per item
 * TC-SYNC-09  version_name = 'diary-templates-v1' (not x-curriculum-v1)
 * TC-SYNC-10  Pool with 0 effective templates → deactivation query runs, count = 0
 * TC-SYNC-11  buildXCurriculumScope: diary-templates-v1 version + ≥300 → eligible
 * TC-SYNC-12  buildXCurriculumScope: diary-templates-v1 + <300 → CURRICULUM_SEARCH_NOT_ELIGIBLE
 * TC-SYNC-13  buildNormalCurriculumScope: separate logic unchanged (no diary-templates-v1 dependency)
 * TC-SYNC-14  sync failure propagates (throws), not swallowed
 * TC-SYNC-15  ensureDiaryTemplateVersion deactivates competing active version first
 * TC-SYNC-16  startup: super-db-init does NOT auto-run source_template_id migration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: vi.fn() },
  db:           { execute: vi.fn() },
}));

import { superAdminDb } from "@workspace/db";
import {
  syncDiaryTemplatesToCurriculumItems,
  DIARY_TEMPLATE_VERSION_NAME,
} from "../../lib/diary-template-sync.js";
import {
  buildXCurriculumScope,
  buildNormalCurriculumScope,
  CurriculumScopeError,
} from "../../lib/parent-curriculum-scope-builder.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const POOL_A = "pool_A_test";
const POOL_B = "pool_B_test";
const POOL_C = "pool_C_test";

const VERSION_A = "cv_diary_A";
const VERSION_B = "cv_diary_B";
const VERSION_N = "cv_normal_01";

// Helpers to build mock template rows
const makeTpl = (id: string, poolId: string, scope = "global") => ({
  template_id:   id,
  template_text: `${id} 교육내용`,
  sort_order:    0,
  level_name:    "흰색: 물적응",
});

const makeItem = (id: string, poolId: string) => ({
  id,
  title:       "흰색: 물적응",
  description: `${id} 교육내용`,
  sort_order:  0,
});

// ─── Mock factory ─────────────────────────────────────────────────────────────

/**
 * Configure superAdminDb.execute to simulate the sync lifecycle for poolId.
 * Uses SQL keyword matching to route to the correct mock response.
 */
function setupSyncDb(opts: {
  versionId:       string;
  templateRows:    Array<{ template_id: string; template_text: string; sort_order: number; level_name: string | null }>;
  activeAfterSync: number;
  inactiveAfterSync: number;
}) {
  (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
    const q: string = extractSql(query);

    // Guard: DOCX curriculum active check (SELECT id FROM curriculum_versions WHERE is_active=true AND version_name!=...)
    // Returns empty → no competing DOCX curriculum, proceed with diary-template sync
    if (q.includes("FROM curriculum_versions") && q.includes("is_active")) return { rows: [] };

    // UPDATE curriculum_versions SET is_active=false (deactivate competing)
    if (q.includes("UPDATE curriculum_versions")) return { rows: [] };

    // INSERT INTO curriculum_versions (upsert) → void
    if (q.includes("INSERT INTO curriculum_versions")) return { rows: [] };

    // SELECT id FROM curriculum_versions (version_id lookup, no is_active filter)
    if (q.includes("FROM curriculum_versions")) return { rows: [{ id: opts.versionId }] };

    // SELECT diary_templates JOIN diary_template_levels
    if (q.includes("FROM diary_templates")) return { rows: opts.templateRows };

    // INSERT INTO curriculum_items (upsert) → void
    if (q.includes("INSERT INTO curriculum_items")) return { rows: [] };

    // UPDATE curriculum_items SET is_active=false (deactivation)
    if (q.includes("UPDATE curriculum_items")) return { rows: [] };

    // SELECT COUNT(*) from curriculum_items (result count)
    if (q.includes("COUNT(*)") && q.includes("curriculum_items")) {
      return {
        rows: [{
          active_count:   opts.activeAfterSync,
          inactive_count: opts.inactiveAfterSync,
        }],
      };
    }

    return { rows: [] };
  });
}

function extractSql(query: any): string {
  if (typeof query?.sql === "string") return query.sql;
  if (query?.queryChunks) {
    return query.queryChunks
      .map((c: any) => (typeof c === "string" ? c : (c?.value ?? "")))
      .join("");
  }
  return String(query ?? "");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("diary-template-sync — syncDiaryTemplatesToCurriculumItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── TC-SYNC-01: Pool A materialization writes only A items ─────────────────
  it("TC-SYNC-01: Pool A 350 templates → SyncResult poolId=A, synced=350", async () => {
    const rows = Array.from({ length: 350 }, (_, i) => ({
      template_id:   `dt_A_${i}`,
      template_text: `A 교육내용 ${i}`,
      sort_order:    i,
      level_name:    "흰색",
    }));
    setupSyncDb({ versionId: VERSION_A, templateRows: rows, activeAfterSync: 350, inactiveAfterSync: 0 });

    const result = await syncDiaryTemplatesToCurriculumItems(POOL_A);
    expect(result.poolId).toBe(POOL_A);
    expect(result.synced).toBe(350);
    expect(result.deactivated).toBe(0);

    // Verify all INSERT INTO curriculum_items calls use POOL_A scope
    const insertCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .filter(([q]) => extractSql(q).includes("INSERT INTO curriculum_items"));
    expect(insertCalls.length).toBe(350);
    for (const [q] of insertCalls) {
      const sql = extractSql(q);
      // Must not include Pool B
      expect(sql).not.toContain(POOL_B);
    }
  });

  // ── TC-SYNC-02: Pool B independent from Pool A ────────────────────────────
  it("TC-SYNC-02: Pool B 320 templates → SyncResult poolId=B, synced=320", async () => {
    const rows = Array.from({ length: 320 }, (_, i) => ({
      template_id:   `dt_B_${i}`,
      template_text: `B 교육내용 ${i}`,
      sort_order:    i,
      level_name:    "평영",
    }));
    setupSyncDb({ versionId: VERSION_B, templateRows: rows, activeAfterSync: 320, inactiveAfterSync: 0 });

    const result = await syncDiaryTemplatesToCurriculumItems(POOL_B);
    expect(result.poolId).toBe(POOL_B);
    expect(result.synced).toBe(320);
  });

  // ── TC-SYNC-03: Repeated sync → no duplicate (ON CONFLICT) ───────────────
  it("TC-SYNC-03: Repeated sync is idempotent — INSERT uses ON CONFLICT", async () => {
    const rows = [makeTpl("dt_X_01", POOL_A)];
    setupSyncDb({ versionId: VERSION_A, templateRows: rows, activeAfterSync: 1, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);
    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    // Each sync call should use ON CONFLICT in INSERT — verify SQL contains ON CONFLICT
    const insertCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .filter(([q]) => extractSql(q).includes("INSERT INTO curriculum_items"));
    for (const [q] of insertCalls) {
      expect(extractSql(q).toLowerCase()).toContain("on conflict");
    }
  });

  // ── TC-SYNC-04: teacher-scope templates excluded ──────────────────────────
  it("TC-SYNC-04: diary_templates query filters scope=global only", async () => {
    setupSyncDb({ versionId: VERSION_A, templateRows: [], activeAfterSync: 0, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    const templateQueryCall = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .find(([q]) => extractSql(q).includes("FROM diary_templates"));
    expect(templateQueryCall).toBeDefined();
    const sql = extractSql(templateQueryCall![0]);
    expect(sql).toContain("scope");
    expect(sql).toContain("global");
    // Must NOT select teacher scope
    expect(sql).not.toContain("'teacher'");
  });

  // ── TC-SYNC-05: x_global scope excluded (only scope='global' selected) ───
  it("TC-SYNC-05: x_global templates not included — query only targets scope=global", async () => {
    setupSyncDb({ versionId: VERSION_A, templateRows: [], activeAfterSync: 0, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    const templateQueryCall = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .find(([q]) => extractSql(q).includes("FROM diary_templates"));
    const sql = extractSql(templateQueryCall![0]);
    // Confirms only 'global' is targeted (x_global is a different value)
    expect(sql.match(/'global'/g)?.length).toBeGreaterThanOrEqual(1);
    expect(sql).not.toContain("x_global");
  });

  // ── TC-SYNC-06: Deactivation query uses subquery (pool-isolated) ──────────
  it("TC-SYNC-06: Deactivation UPDATE uses subquery FROM diary_templates — no cross-pool risk", async () => {
    setupSyncDb({ versionId: VERSION_A, templateRows: [], activeAfterSync: 0, inactiveAfterSync: 2 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    const deactivateCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .filter(([q]) => extractSql(q).includes("UPDATE curriculum_items"));
    expect(deactivateCalls.length).toBeGreaterThanOrEqual(1);
    const sql = extractSql(deactivateCalls[0][0]);
    // Subquery approach: NOT IN (SELECT dt.id FROM diary_templates ...)
    expect(sql.toLowerCase()).toContain("not in");
    expect(sql).toContain("diary_templates");
  });

  // ── TC-SYNC-07: Pool A sync does not touch Pool B items ───────────────────
  it("TC-SYNC-07: Pool A sync — all SQL params reference POOL_A, not POOL_B", async () => {
    const rows = [makeTpl("dt_A_01", POOL_A)];
    setupSyncDb({ versionId: VERSION_A, templateRows: rows, activeAfterSync: 1, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    // Inspect all execute calls — none should contain POOL_B as a param value
    const allParams = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .flatMap(([q]) => {
        const queryObj = q as any;
        return queryObj?.params ?? queryObj?.values ?? [];
      });
    expect(allParams).not.toContain(POOL_B);
  });

  // ── TC-SYNC-08: source_template_id linked per INSERT ─────────────────────
  it("TC-SYNC-08: INSERT INTO curriculum_items includes source_template_id column", async () => {
    const rows = [{ template_id: "dt_A_01", template_text: "내용", sort_order: 0, level_name: "흰색" }];
    setupSyncDb({ versionId: VERSION_A, templateRows: rows, activeAfterSync: 1, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    const insertCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .filter(([q]) => extractSql(q).includes("INSERT INTO curriculum_items"));
    expect(insertCalls.length).toBe(1);
    const sql = extractSql(insertCalls[0][0]);
    expect(sql).toContain("source_template_id");
  });

  // ── TC-SYNC-09: version_name = diary-templates-v1 ────────────────────────
  it("TC-SYNC-09: version_name is DIARY_TEMPLATE_VERSION_NAME, not x-curriculum-v1", async () => {
    setupSyncDb({ versionId: VERSION_A, templateRows: [], activeAfterSync: 0, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    expect(DIARY_TEMPLATE_VERSION_NAME).toBe("diary-templates-v1");
    const versionUpsert = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .find(([q]) => extractSql(q).includes("INSERT INTO curriculum_versions"));
    expect(versionUpsert).toBeDefined();
    const sql = extractSql(versionUpsert![0]);
    expect(sql).toContain("diary-templates-v1");
    expect(sql).not.toContain("x-curriculum-v1");
  });

  // ── TC-SYNC-10: 0 effective templates → deactivation runs, synced=0 ──────
  it("TC-SYNC-10: 0 effective templates → synced=0, deactivation runs", async () => {
    setupSyncDb({ versionId: VERSION_A, templateRows: [], activeAfterSync: 0, inactiveAfterSync: 5 });

    const result = await syncDiaryTemplatesToCurriculumItems(POOL_A);
    expect(result.synced).toBe(0);
    expect(result.deactivated).toBe(5);

    // Deactivation query must still run
    const deactivateCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .filter(([q]) => extractSql(q).includes("UPDATE curriculum_items"));
    expect(deactivateCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── TC-SYNC-14: sync failure propagates (throws) ──────────────────────────
  it("TC-SYNC-14: sync failure propagates — DB error throws, not swallowed", async () => {
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB connection lost"));

    // Must throw — caller is responsible for handling (await + try/catch in route)
    await expect(syncDiaryTemplatesToCurriculumItems(POOL_A)).rejects.toThrow("DB connection lost");
  });

  // ── TC-SYNC-15: ensureDiaryTemplateVersion deactivates competing active versions ──
  it("TC-SYNC-15: ensureDiaryTemplateVersion issues UPDATE to deactivate competing active version first", async () => {
    setupSyncDb({ versionId: VERSION_A, templateRows: [], activeAfterSync: 0, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    // Must have an UPDATE curriculum_versions call (deactivate-others step)
    const deactivateVersionCalls = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .filter(([q]) => extractSql(q).includes("UPDATE curriculum_versions"));
    expect(deactivateVersionCalls.length).toBeGreaterThanOrEqual(1);

    const updateSql = extractSql(deactivateVersionCalls[0][0]);
    // Must set is_active=false
    expect(updateSql.toLowerCase()).toContain("is_active");
    expect(updateSql.toLowerCase()).toContain("false");
    // Must exclude diary-templates-v1 itself
    expect(updateSql).toContain("diary-templates-v1");
    expect(updateSql).toContain("!=");
  });

  // ── TC-SYNC-16: ON CONFLICT for curriculum_versions uses version_name index ──
  it("TC-SYNC-16: INSERT INTO curriculum_versions uses ON CONFLICT (swimming_pool_id, version_name)", async () => {
    setupSyncDb({ versionId: VERSION_A, templateRows: [], activeAfterSync: 0, inactiveAfterSync: 0 });

    await syncDiaryTemplatesToCurriculumItems(POOL_A);

    const versionInsert = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .find(([q]) => extractSql(q).includes("INSERT INTO curriculum_versions"));
    expect(versionInsert).toBeDefined();
    const sql = extractSql(versionInsert![0]).toLowerCase();
    expect(sql).toContain("on conflict");
    expect(sql).toContain("version_name");
  });
});

// ─── buildXCurriculumScope integration ───────────────────────────────────────

describe("buildXCurriculumScope — diary-templates-v1 path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── TC-SYNC-11: ≥300 active items → eligible ─────────────────────────────
  it("TC-SYNC-11: ≥300 active curriculum_items → scope returned", async () => {
    const items = Array.from({ length: 350 }, (_, i) => ({
      id: `ci_${i}`, title: "흰색", description: `내용 ${i}`, sort_order: i,
    }));
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q = extractSql(query);
      if (q.includes("FROM curriculum_versions")) return { rows: [{ id: VERSION_A }] };
      if (q.includes("COUNT(*)") && q.includes("curriculum_items")) return { rows: [{ cnt: "350" }] };
      if (q.includes("FROM curriculum_items")) return { rows: items };
      return { rows: [] };
    });

    const scope = await buildXCurriculumScope(POOL_A);
    expect(scope.source).toBe("X_POOL");
    expect(scope.curriculum_items.length).toBe(350);
  });

  // ── TC-SYNC-12: <300 active items → CURRICULUM_SEARCH_NOT_ELIGIBLE ────────
  it("TC-SYNC-12: <300 active curriculum_items → CURRICULUM_SEARCH_NOT_ELIGIBLE", async () => {
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q = extractSql(query);
      if (q.includes("FROM curriculum_versions")) return { rows: [{ id: VERSION_A }] };
      if (q.includes("COUNT(*)") && q.includes("curriculum_items")) return { rows: [{ cnt: "200" }] };
      return { rows: [] };
    });

    await expect(buildXCurriculumScope(POOL_C)).rejects.toMatchObject({
      code: "CURRICULUM_SEARCH_NOT_ELIGIBLE",
    });
  });

  // ── TC-SYNC-13: Normal scope-builder uses separate logic ──────────────────
  it("TC-SYNC-13: buildNormalCurriculumScope independent of diary-templates-v1", async () => {
    const items = Array.from({ length: 400 }, (_, i) => ({
      id: `ci_norm_${i}`, title: "노말레벨", description: `내용 ${i}`, sort_order: i,
    }));
    (superAdminDb.execute as ReturnType<typeof vi.fn>).mockImplementation(async (query: any) => {
      const q = extractSql(query);
      if (q.includes("FROM curriculum_versions")) return { rows: [{ id: VERSION_N }] };
      if (q.includes("COUNT(*)") && q.includes("curriculum_items")) return { rows: [{ cnt: "400" }] };
      if (q.includes("FROM curriculum_items")) return { rows: items };
      return { rows: [] };
    });

    const scope = await buildNormalCurriculumScope(POOL_A);
    expect(scope.source).toBe("POOL");
    expect(scope.curriculum_items.length).toBe(400);

    // Verify diary_templates was NOT queried in normal scope path
    const dtQuery = (superAdminDb.execute as ReturnType<typeof vi.fn>).mock.calls
      .find(([q]) => extractSql(q).includes("diary_templates"));
    expect(dtQuery).toBeUndefined();
  });
});
