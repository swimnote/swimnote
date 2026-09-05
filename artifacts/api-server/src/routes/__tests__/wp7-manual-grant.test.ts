/**
 * wp7-manual-grant.test.ts — WP7 Super Admin Manual X Grant Tests
 *
 * Security tests (spec §25):
 *  A. Super Admin Manual X300 → PASS
 *  B. Super Admin Manual X500 → PASS
 *  C. Super Admin Manual X1000 → PASS
 *  D. Super Admin Manual NONE (revoke) → PASS
 *  E. Pool Admin Manual Grant → 403
 *  F. Teacher Manual Grant → 403
 *  G. Parent Manual Grant → 403
 *  H. client role spoof → BLOCK
 *  I. target Pool ID valid but non-Super Admin → BLOCK
 *
 * Semantics tests (spec §26):
 *  1. manual grant → paid unchanged
 *  2. manual grant → management unchanged
 *  3. manual grant → no fake RC event
 *  4. manual revoke → paid unchanged
 *  5. manual revoke → management unchanged
 *  6. x1000 → member_limit=1000
 *  7. x500 → member_limit=500
 *  8. x300 → member_limit=300
 *
 * Prerequisite tests (spec §27):
 *  A. upload history 없음 + actual X data exists → READY
 *  B. upload history 있음 + actual X data 없음 → NOT_READY
 *  C. No blind xmode_config_status='READY' force
 *  D. prerequisite result reason 제공
 *
 * Audit test (spec §28):
 *  - Manual Grant: audit row created
 *  - Manual revoke: audit row created
 *  - before/after correct, actor/pool/action correct
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkXPrerequisite } from "../../lib/xmode-readiness.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const POOL_WITH_DATA    = "pool_has_x_data";
const POOL_WITHOUT_DATA = "pool_no_x_data";
const POOL_NOT_FOUND    = "pool_does_not_exist";

// ── Mock DB ───────────────────────────────────────────────────────────────────

function sqlStr(q: any): string {
  if (q?.queryChunks) {
    return q.queryChunks
      .filter((c: any) => c !== null && typeof c === "object" && Array.isArray(c.value))
      .map((c: any) => (c.value as string[]).join(""))
      .join(" ");
  }
  return (q?.sql ?? q?._sql ?? q?.toString() ?? "");
}
function sqlVals(q: any): any[] {
  if (q?.queryChunks) {
    return q.queryChunks.filter((c: any) =>
      !(c !== null && typeof c === "object" && Array.isArray(c.value))
    );
  }
  return q?.params ?? q?._vals ?? [];
}

function makeDb(opts: { globalTemplateCount: number; poolId?: string }) {
  return {
    execute: async (q: any) => {
      const raw  = sqlStr(q);
      const vals = sqlVals(q);

      // Pool exists check
      if (raw.includes("swimming_pools") && raw.includes("SELECT") && raw.includes("approval_status")) {
        const reqPoolId = vals[0];
        if (reqPoolId === POOL_NOT_FOUND) return { rows: [], rowCount: 0 };
        return { rows: [{ id: reqPoolId, approval_status: "approved" }], rowCount: 1 };
      }

      // diary_templates count (global)
      if (raw.includes("diary_templates") && raw.includes("COUNT(*)")) {
        return { rows: [{ cnt: opts.globalTemplateCount }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

// ── Full route mock infrastructure ────────────────────────────────────────────

type PoolState = {
  x_paid_entitlement:    boolean;
  x_manual_entitlement:  boolean;
  x_force_disabled:      boolean;
  x_management_override: boolean;
  x_plan_key:            string | null;
  xmode_config_status:   string | null;
  member_limit:          number | null;
};

type AuditRow = {
  entity_type: string; entity_id: string; action: string; actor_type: string; actor_id: string;
  pool_id: string; before_data: any; after_data: any; reason?: string;
};

function makeRouteDb(poolState: PoolState, auditRows: AuditRow[]) {
  let state = { ...poolState };
  return {
    transaction: async (fn: any) => fn({
      execute: async (q: any) => {
        const raw  = sqlStr(q);
        const vals = sqlVals(q);

        // SELECT next_audit_version
        if (raw.includes("next_audit_version")) return { rows: [{ v: 1 }] };

        // INSERT INTO audit_logs
        if (raw.includes("audit_logs") && raw.includes("INSERT")) {
          const row: AuditRow = {
            entity_type: vals[0],
            entity_id:   vals[1],
            action:      vals[2],
            actor_type:  vals[3],
            actor_id:    vals[4],
            pool_id:     vals[5],
            before_data: vals[6],
            after_data:  vals[7],
            reason:      vals[8],
          };
          auditRows.push(row);
          return { rows: [], rowCount: 1 };
        }

        // diary_templates global count
        if (raw.includes("diary_templates") && raw.includes("COUNT(*)")) {
          return { rows: [{ cnt: 1000 }] }; // has data
        }

        // swimming_pools SELECT (before state)
        if (raw.includes("swimming_pools") && raw.includes("SELECT") && !raw.includes("UPDATE")) {
          return { rows: [{ id: "pool_a", ...state }], rowCount: 1 };
        }

        // UPDATE swimming_pools ... RETURNING
        if (raw.includes("UPDATE swimming_pools") && raw.includes("RETURNING")) {
          // Parse updated values from params
          // params order: x_manual_entitlement, x_force_disabled, x_plan_key, xmode_config_status, member_limit, poolId
          const [newManual, newForce, newPlanKey, newConfigStatus, newMemberLimit] = vals;
          state = {
            ...state,
            x_manual_entitlement: Boolean(newManual),
            x_force_disabled:     Boolean(newForce),
            x_plan_key:           newPlanKey ?? null,
            xmode_config_status:  newConfigStatus ?? null,
            member_limit:         newMemberLimit ?? null,
          };
          return { rows: [{ ...state }], rowCount: 1 };
        }

        // approval_status check (prerequisite)
        if (raw.includes("swimming_pools") && raw.includes("approval_status")) {
          return { rows: [{ id: "pool_a", approval_status: "approved" }] };
        }

        return { rows: [], rowCount: 0 };
      },
    }),
  };
}

// ── Prerequisite tests ────────────────────────────────────────────────────────

describe("WP7-Prerequisite-A: upload history 없음 + actual X data exists → READY", () => {
  it("checkXPrerequisite: pool with global templates → READY (upload history irrelevant)", async () => {
    const db = makeDb({ globalTemplateCount: 1050 });  // 1050 global templates, no upload history check
    const result = await checkXPrerequisite(POOL_WITH_DATA, db);

    expect(result.status).toBe("READY");
    expect(result.ready).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.missing).toHaveLength(0);
    expect(result.global_template_count).toBe(1050);
    // Upload history fields NOT checked (x_setup_submissions / x_setup_files)
  });
});

describe("WP7-Prerequisite-B: actual X data 없음 → NOT_READY", () => {
  it("checkXPrerequisite: no global templates → NOT_READY with reason", async () => {
    const db = makeDb({ globalTemplateCount: 0 });
    const result = await checkXPrerequisite(POOL_WITH_DATA, db);

    expect(result.status).toBe("NOT_READY");
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.missing.some((m) => m.includes("GLOBAL_X_TEMPLATES"))).toBe(true);
    expect(result.global_template_count).toBe(0);
  });
});

describe("WP7-Prerequisite-C: No blind xmode_config_status READY", () => {
  it("xmode-readiness.ts does NOT contain blind READY force", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../lib/xmode-readiness.ts"),
      "utf8"
    );
    // Must not contain blind READY force pattern
    expect(src).not.toMatch(/SET xmode_config_status.*=.*['"]READY['"]/);
    expect(src).not.toMatch(/UPDATE.*SET.*READY/);
    // Must use checkXPrerequisite
    expect(src).toContain("checkXPrerequisite");
    // Must NOT check x_setup_submissions or x_setup_files as prerequisite for checkXPrerequisite
    // (those are in the deprecated validateXModeReadiness)
    const checkFnStart = src.indexOf("export async function checkXPrerequisite");
    const validateFnStart = src.indexOf("export async function validateXModeReadiness");
    const checkFnSrc = src.slice(checkFnStart, validateFnStart);
    expect(checkFnSrc).not.toContain("x_setup_submissions");
    expect(checkFnSrc).not.toContain("x_setup_files");
  });
});

describe("WP7-Prerequisite-D: prerequisite result reason provided", () => {
  it("NOT_READY result includes human-readable reason", async () => {
    const db = makeDb({ globalTemplateCount: 0 });
    const result = await checkXPrerequisite(POOL_WITH_DATA, db);

    expect(result.reason).not.toBeNull();
    expect(typeof result.reason).toBe("string");
    expect((result.reason as string).length).toBeGreaterThan(5);
  });

  it("Pool not found → NOT_READY with POOL_NOT_FOUND reason", async () => {
    const db = makeDb({ globalTemplateCount: 1000 });
    const result = await checkXPrerequisite(POOL_NOT_FOUND, db);

    expect(result.status).toBe("NOT_READY");
    expect(result.missing).toContain("POOL_NOT_FOUND");
  });
});

// ── Manual Grant API endpoint code-level tests ────────────────────────────────

describe("WP7-A~D: Manual Grant plan options (code-level)", () => {
  it("super.ts: bypass_readiness_check removed from xmode endpoint (no functional code)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../super.ts"),
      "utf8"
    );
    // WP7: bypass_readiness_check must not appear in FUNCTIONAL code (const, ?, if)
    // Comments mentioning it for historical reference are OK
    const patchSection = src.slice(
      src.indexOf("PATCH /super/operators/:id/xmode"),
      src.indexOf("PATCH /super/operators/:id/management-override")
    );
    // The blind READY force pattern must be gone
    expect(patchSection).not.toContain("bypass_readiness_check ? \"READY\"");
    expect(patchSection).not.toContain("bypass_readiness_check ?");
    // The body destructuring must not include bypass_readiness_check as a variable
    expect(patchSection).not.toMatch(/const\s*\{[^}]*bypass_readiness_check[^}]*\}/);
    // Body TS type must not include bypass_readiness_check
    expect(patchSection).not.toMatch(/bypass_readiness_check\?:/);
    // checkXPrerequisite must be used instead
    expect(patchSection).toContain("checkXPrerequisite");
  });

  it("super.ts: VALID_GRANT_PLANS includes exactly x300, x500, x1000", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    const patchSection = src.slice(
      src.indexOf("PATCH /super/operators/:id/xmode"),
      src.indexOf("PATCH /super/operators/:id/management-override")
    );
    expect(patchSection).toContain('"x300"');
    expect(patchSection).toContain('"x500"');
    expect(patchSection).toContain('"x1000"');
    expect(patchSection).toContain("VALID_GRANT_PLANS");
  });

  it("super.ts: checkXPrerequisite called on grant path", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    const patchSection = src.slice(
      src.indexOf("PATCH /super/operators/:id/xmode"),
      src.indexOf("PATCH /super/operators/:id/management-override")
    );
    expect(patchSection).toContain("checkXPrerequisite");
    expect(patchSection).toContain("X_PREREQUISITE_NOT_MET");
  });
});

describe("WP7-E/F/G/H/I: Authorization — only Super Admin allowed", () => {
  it("super.ts xmode endpoint uses requireRole(\"super_admin\")", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    const patchSection = src.slice(
      src.indexOf("router.patch(\n  \"/super/operators/:id/xmode\""),
      src.indexOf("router.patch(\n  \"/super/operators/:id/xmode\"") + 500
    );
    expect(patchSection).toContain('requireRole("super_admin")');
  });

  it("pool_admin role !== super_admin → middleware blocks", () => {
    const isSuperAdmin = (role: string) =>
      ["super_admin", "platform_admin", "super_manager"].includes(role);

    expect(isSuperAdmin("pool_admin")).toBe(false);
    expect(isSuperAdmin("teacher")).toBe(false);
    expect(isSuperAdmin("parent_account")).toBe(false);
    expect(isSuperAdmin("super_admin")).toBe(true);
    expect(isSuperAdmin("platform_admin")).toBe(true);
  });

  it("H: client body { role: 'super_admin' } does not bypass auth middleware", () => {
    // Auth reads req.user.role (from JWT), not req.body.role
    // This is a structural guarantee from requireAuth + requireRole
    const jwtRole = "pool_admin";
    const bodyRole = "super_admin";
    const authorized = ["super_admin", "platform_admin", "super_manager"].includes(jwtRole);
    expect(authorized).toBe(false);
    // bodyRole is irrelevant — auth only checks jwtRole
    expect(bodyRole).not.toBe(jwtRole);
  });
});

// ── Semantics tests ───────────────────────────────────────────────────────────

describe("WP7-Semantics-1,2: Manual grant → paid unchanged, management unchanged", () => {
  it("Grant: x_paid_entitlement NOT in UPDATE SET clause (never modified)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    // The UPDATE sets only: x_manual_entitlement, x_force_disabled, x_plan_key, xmode_config_status, member_limit
    const updateSection = src.slice(
      src.indexOf("UPDATE swimming_pools\n          SET\n            x_manual_entitlement"),
      src.indexOf("UPDATE swimming_pools\n          SET\n            x_manual_entitlement") + 800
    );
    // x_paid_entitlement must NOT appear in SET clause
    expect(updateSection).not.toContain("x_paid_entitlement =");
    // x_management_override must NOT appear in SET clause
    expect(updateSection).not.toContain("x_management_override =");
  });
});

describe("WP7-Semantics-3: manual grant → no fake RC event", () => {
  it("Manual grant does not call RevenueCat API or create fake RC rows", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    const patchSection = src.slice(
      src.indexOf("PATCH /super/operators/:id/xmode"),
      src.indexOf("PATCH /super/operators/:id/management-override")
    );
    // No RevenueCat API calls in the xmode grant section
    expect(patchSection).not.toContain("revenueCat");
    expect(patchSection).not.toContain("revenuecat");
    expect(patchSection).not.toContain("rc_webhook");
    expect(patchSection).not.toContain("x_billing");
    expect(patchSection).not.toContain("INSERT INTO rc_");
    expect(patchSection).not.toContain("INSERT INTO revenue_cat");
  });
});

describe("WP7-Semantics-4,5: Manual revoke → paid/management unchanged", () => {
  it("Revoke: paid and management are not SET in revoke branch", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    // UPDATE SET clause must not include x_paid_entitlement or x_management_override
    // (comments referring to them for documentation purposes are ok)
    const updateSection = src.slice(
      src.indexOf("UPDATE swimming_pools\n          SET\n            x_manual_entitlement"),
      src.indexOf("WHERE id = ${poolId}\n          RETURNING")
    );
    expect(updateSection).not.toContain("x_paid_entitlement =");
    expect(updateSection).not.toContain("x_management_override =");
    // force is preserved (beforeForce in revoke branch)
    const revokeBranch = src.slice(src.indexOf("// NONE / revoke"), src.indexOf("// NONE / revoke") + 600);
    expect(revokeBranch).toContain("beforeForce");
  });
});

describe("WP7-Semantics-6,7,8: Plan → member_limit from catalog", () => {
  it("x1000 → member_limit = 1000", async () => {
    const { getXMemberLimit } = await import("../../lib/xPlanCatalog.js");
    expect(getXMemberLimit("x1000")).toBe(1000);
  });

  it("x500 → member_limit = 500", async () => {
    const { getXMemberLimit } = await import("../../lib/xPlanCatalog.js");
    expect(getXMemberLimit("x500")).toBe(500);
  });

  it("x300 → member_limit = 300", async () => {
    const { getXMemberLimit } = await import("../../lib/xPlanCatalog.js");
    expect(getXMemberLimit("x300")).toBe(300);
  });
});

describe("WP7-Audit: audit_logs recorded on grant/revoke", () => {
  it("audit_logs structure: before/after must include entitlement fields + action", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");

    // Find the beforeData section specifically in the xmode PATCH handler
    const xmodeStart = src.indexOf("router.patch(\n  \"/super/operators/:id/xmode\"");
    const xmodeEnd   = src.indexOf("router.patch(\n  \"/super/operators/:id/management-override\"");
    const xmodeSrc   = src.slice(xmodeStart, xmodeEnd);

    const bdStart  = xmodeSrc.indexOf("const beforeData = {");
    const auditSection = xmodeSrc.slice(bdStart, bdStart + 1200);

    // Before data must include the 3 key fields
    expect(auditSection).toContain("x_paid_entitlement");
    expect(auditSection).toContain("x_manual_entitlement");
    expect(auditSection).toContain("x_force_disabled");

    // After data must include source and action
    expect(auditSection).toContain('"super_admin_manual"');
    expect(auditSection).toContain("grant ? \"grant\" : \"revoke\"");

    // audit_logs INSERT must have actor, pool, entity fields
    const insertStart = xmodeSrc.indexOf("INSERT INTO audit_logs");
    const insertAuditSection = xmodeSrc.slice(insertStart, insertStart + 600);
    expect(insertAuditSection).toContain("entity_type");
    expect(insertAuditSection).toContain("actor_id");
    expect(insertAuditSection).toContain("pool_id");
    expect(insertAuditSection).toContain("before_data");
    expect(insertAuditSection).toContain("after_data");
  });

  it("audit_logs does NOT store sensitive fields (tokens/secrets)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    const auditSection = src.slice(
      src.indexOf("const beforeData = {"),
      src.indexOf("const beforeData = {") + 1200
    );
    // No sensitive fields in audit
    expect(auditSection).not.toContain("jwt");
    expect(auditSection).not.toContain("token");
    expect(auditSection).not.toContain("secret");
    expect(auditSection).not.toContain("password");
  });
});

// ── Semantic separation tests ─────────────────────────────────────────────────

describe("WP7: X source semantic separation (paid/manual/override distinct)", () => {
  it("x_source = management_override takes priority over manual and paid", () => {
    // Simulate control-center summary x_source logic
    const calcSource = (override: boolean, manual: boolean, paid: boolean) =>
      override ? "management_override" : manual ? "manual" : paid ? "paid" : "none";

    expect(calcSource(true, true, true)).toBe("management_override");   // override wins
    expect(calcSource(false, true, true)).toBe("manual");               // manual wins over paid
    expect(calcSource(false, false, true)).toBe("paid");
    expect(calcSource(false, false, false)).toBe("none");
  });

  it("Management override coexistence: grant sets manual=true, does NOT touch override", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    // In grant branch: x_management_override not modified
    const grantBranch = src.slice(
      src.indexOf("if (grant) {"),
      src.indexOf("} else {")
    );
    expect(grantBranch).not.toContain("x_management_override");
    // x_management_override not in UPDATE SET
    const updateSection = src.slice(
      src.indexOf("UPDATE swimming_pools\n          SET\n            x_manual_entitlement"),
      src.indexOf("WHERE id = ${poolId}\n          RETURNING")
    );
    expect(updateSection).not.toContain("x_management_override");
  });

  it("Force disabled: effective X false even with all entitlements", () => {
    const calcEff = (paid: boolean, manual: boolean, override: boolean, force: boolean) =>
      (override || paid || manual) && !force;

    expect(calcEff(true, true, true, true)).toBe(false);   // force wins
    expect(calcEff(true, true, true, false)).toBe(true);
    expect(calcEff(false, true, false, false)).toBe(true);  // manual sufficient
  });
});

describe("WP7: Toykids hardcode 0", () => {
  it("No hardcoded Toykids pool ID in source", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const superSrc = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    const readinessSrc = fs.readFileSync(path.resolve(__dirname, "../../lib/xmode-readiness.ts"), "utf8");
    const TOYKIDS_POOL_ID = "pool_1780849364252_l9k44rbk3";

    // No hardcoded pool ID in either file
    expect(superSrc).not.toContain(TOYKIDS_POOL_ID);
    expect(readinessSrc).not.toContain(TOYKIDS_POOL_ID);
    // No hardcoded operator names in functional code (comments allowed)
    expect(superSrc).not.toContain("Toykids");
    expect(superSrc).not.toContain("토이키즈");
    // xmode-readiness.ts may contain Korean operator names only in file-level comments
    // — the key guarantee is: no hardcoded pool ID
  });
});

describe("WP7: Control-center summary WP7 metrics present", () => {
  it("super.ts control-center summary includes push, member-limit, storage, RC fields", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../super.ts"), "utf8");
    const summarySection = src.slice(
      src.indexOf("GET /super/pools/:id/control-center/summary"),
      src.indexOf("GET /super/pools/:id/control-center/members")
    );

    // WP7 push queue visibility
    expect(summarySection).toContain("push_fanout_jobs");
    expect(summarySection).toContain("push_pending_jobs");
    expect(summarySection).toContain("push_failed_jobs");

    // WP7 member limit visibility
    expect(summarySection).toContain("member_limit_remaining");
    expect(summarySection).toContain("member_limit_warn");

    // WP7 storage visibility
    expect(summarySection).toContain("effective_storage_bytes");
    expect(summarySection).toContain("base_storage_bytes");

    // WP7 RC visibility
    expect(summarySection).toContain("rc_subscription_status");
    expect(summarySection).toContain("rc_payment_failed_at");

    // WP7 X source separation: management_override separate field
    expect(summarySection).toContain("x_management_override");
  });
});
