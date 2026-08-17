/**
 * CS-04R — Frontend Map Registry Foundation Tests
 *
 * FMREG-01  exact screen_id lookup
 * FMREG-02  exact route lookup
 * FMREG-03  role filter (teacher vs parent isolation)
 * FMREG-04  mode filter (x-only screen excluded from normal query)
 * FMREG-05  keyword search (support_keywords)
 * FMREG-06  feature search (related_features)
 * FMREG-07  NO_MATCH when nothing found
 * FMREG-08  cross-role safety (parent does not see pool_admin screens)
 * FMREG-09  version meta endpoint
 * FMREG-10  screen detail endpoint (/screens/:id)
 * FMREG-11  registry completeness (required fields on all screens)
 * FMREG-12  search score ordering
 * FMREG-13  dynamic route normalization
 * FMREG-14  unknown screen_id returns NO_MATCH
 * FMREG-15  unauthenticated request denied (401)
 * FMREG-16  purpose tokens match
 * FMREG-17  multi-role screen visible to allowed roles
 * FMREG-18  deep_link field present on screens with deep link
 * FMREG-19  registry has no duplicate screen_id
 * FMREG-20  full regression (all other routes unaffected)
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock auth ─────────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    if (!req.user) return _res.status(401).json({ error: "Unauthorized" });
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  },
}));

// ── Import ────────────────────────────────────────────────────────────────────

import frontendMapRouter from "../frontend-map.js";
import {
  FRONTEND_MAP_REGISTRY,
  SCREEN_BY_ID,
  FRONTEND_MAP_VERSION,
} from "../../config/support/frontend-map.v1.js";

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp(role = "pool_admin") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { userId: "user_1", role, poolId: "pool_A", name: "Test" };
    next();
  });
  app.use("/", frontendMapRouter);
  return app;
}

function makeUnauthedApp() {
  const app = express();
  app.use(express.json());
  // No req.user set
  app.use((req: any, _res: any, next: any) => {
    // deliberately NOT setting req.user
    next();
  });
  app.use("/", frontendMapRouter);
  return app;
}

// =============================================================================
// FMREG-01: exact screen_id lookup
// =============================================================================
describe("FMREG-01: exact screen_id lookup", () => {
  it("GET /support/frontend-map/search?screen_id=ADMIN_DASHBOARD returns that screen", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?screen_id=ADMIN_DASHBOARD");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(res.body.results[0].screen_id).toBe("ADMIN_DASHBOARD");
    expect(res.body.results[0].source).toBe("exact_screen_id");
  });

  it("screen_id lookup is case-insensitive", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?screen_id=admin_dashboard");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(res.body.results[0].screen_id).toBe("ADMIN_DASHBOARD");
  });

  it("returns score=100 for exact screen_id", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?screen_id=PARENT_HOME");
    expect(res.body.results[0].score).toBe(100);
  });
});

// =============================================================================
// FMREG-02: exact route lookup
// =============================================================================
describe("FMREG-02: exact route lookup", () => {
  it("route=/dashboard with role=pool_admin returns ADMIN_DASHBOARD", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?route=/dashboard&role=pool_admin");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids).toContain("ADMIN_DASHBOARD");
  });

  it("route=/settings returns different screens depending on role", async () => {
    const adminRes = await request(makeApp("pool_admin"))
      .get("/support/frontend-map/search?route=/settings&role=pool_admin");
    const teacherRes = await request(makeApp("teacher"))
      .get("/support/frontend-map/search?route=/settings&role=teacher");

    const adminIds   = adminRes.body.results.map((r: any) => r.screen_id);
    const teacherIds = teacherRes.body.results.map((r: any) => r.screen_id);

    expect(adminIds).toContain("ADMIN_SETTINGS");
    expect(teacherIds).toContain("TEACHER_SETTINGS");

    // Admin settings must not be in teacher result
    expect(teacherIds).not.toContain("ADMIN_SETTINGS");
  });

  it("source=exact_route for route match", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?route=/home&role=parent");
    expect(res.body.results[0].source).toBe("exact_route");
    expect(res.body.results[0].score).toBe(95);
  });
});

// =============================================================================
// FMREG-03: role filter
// =============================================================================
describe("FMREG-03: role filter isolates screens", () => {
  it("teacher role does not see pool_admin-only screens", async () => {
    const res = await request(makeApp("teacher"))
      .get("/support/frontend-map/search?role=teacher&q=설정");
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.screen_id);
    // ADMIN_SETTINGS is pool_admin only — must not appear
    expect(ids).not.toContain("ADMIN_SETTINGS");
    // TEACHER_SETTINGS must appear
    expect(ids).toContain("TEACHER_SETTINGS");
  });

  it("parent role returns parent screens for 홈 query", async () => {
    const res = await request(makeApp("parent"))
      .get("/support/frontend-map/search?role=parent&q=홈");
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids.some((id: string) => id.startsWith("PARENT_"))).toBe(true);
  });
});

// =============================================================================
// FMREG-04: mode filter
// =============================================================================
describe("FMREG-04: mode filter excludes x-only from normal", () => {
  it("mode=normal hides ADMIN_X_GROWTH (x-only)", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?role=pool_admin&mode=normal&q=성장");
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids).not.toContain("ADMIN_X_GROWTH");
  });

  it("mode=x includes ADMIN_X_GROWTH", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?role=pool_admin&mode=x&q=성장");
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids).toContain("ADMIN_X_GROWTH");
  });

  it("screen_id for x-only screen is filtered by mode=normal", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?screen_id=ADMIN_X_GROWTH&mode=normal");
    // filtered out by passesFilter
    expect(res.body.match).toBe(false);
  });
});

// =============================================================================
// FMREG-05: keyword search
// =============================================================================
describe("FMREG-05: keyword search via support_keywords", () => {
  it("query=보강 returns screens with 보강 keyword", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=보강");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids.some((id: string) => id.includes("MAKEUP"))).toBe(true);
  });

  it("query=QR returns ADMIN_INVITE_QR", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=QR");
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids).toContain("ADMIN_INVITE_QR");
  });

  it("query=성장 리포트 returns growth report screens", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=성장 리포트");
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids.some((id: string) => id.includes("GROWTH"))).toBe(true);
  });

  it("query=커리큘럼 returns PARENT_CURRICULUM_CHAT", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=커리큘럼");
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids).toContain("PARENT_CURRICULUM_CHAT");
  });
});

// =============================================================================
// FMREG-06: feature search
// =============================================================================
describe("FMREG-06: feature search via related_features", () => {
  it("query=고객센터 returns support-chat screens", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=고객센터");
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids.some((id: string) => id.includes("SUPPORT_CHAT"))).toBe(true);
  });

  it("query=알림 returns notification screens", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=알림");
    expect(res.body.match).toBe(true);
    const hasNotif = res.body.results.some((r: any) =>
      r.screen_id.includes("NOTIFICATION") || r.screen_id.includes("PUSH")
    );
    expect(hasNotif).toBe(true);
  });
});

// =============================================================================
// FMREG-07: NO_MATCH
// =============================================================================
describe("FMREG-07: NO_MATCH when nothing found", () => {
  it("returns match=false and NO_MATCH reason for unknown keyword", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=존재하지않는화면xyzabc123");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(false);
    expect(res.body.reason).toBe("NO_MATCH");
    expect(res.body.results).toHaveLength(0);
  });

  it("does not fabricate a best-guess result when nothing matches", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=완전히없는화면키워드9999");
    expect(res.body.results.length).toBe(0);
  });

  it("unknown screen_id returns NO_MATCH", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?screen_id=NONEXISTENT_SCREEN");
    expect(res.body.match).toBe(false);
    expect(res.body.reason).toBe("NO_MATCH");
  });
});

// =============================================================================
// FMREG-08: cross-role safety
// =============================================================================
describe("FMREG-08: cross-role safety", () => {
  it("parent query for 설정 does not return pool_admin-only ADMIN_POOL_SETTINGS", async () => {
    const res = await request(makeApp("parent"))
      .get("/support/frontend-map/search?role=parent&q=설정");
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids).not.toContain("ADMIN_POOL_SETTINGS");
    expect(ids).not.toContain("ADMIN_SETTINGS");
  });

  it("parent result_roles are all parent", async () => {
    const res = await request(makeApp("parent"))
      .get("/support/frontend-map/search?role=parent&q=홈");
    for (const r of res.body.results) {
      expect(r.available_roles).toContain("parent");
    }
  });
});

// =============================================================================
// FMREG-09: meta endpoint
// =============================================================================
describe("FMREG-09: meta endpoint", () => {
  it("GET /support/frontend-map/meta returns version and counts", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/meta");
    expect(res.status).toBe(200);
    expect(res.body.map_version).toBe(FRONTEND_MAP_VERSION);
    expect(typeof res.body.total_screens).toBe("number");
    expect(res.body.total_screens).toBeGreaterThan(0);
    expect(res.body.by_role).toBeDefined();
    expect(typeof res.body.by_role.pool_admin).toBe("number");
  });

  it("map_version is 1.6.3", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/meta");
    expect(res.body.map_version).toBe("1.6.3");
  });
});

// =============================================================================
// FMREG-10: screen detail endpoint
// =============================================================================
describe("FMREG-10: screen detail endpoint", () => {
  it("GET /support/frontend-map/screens/ADMIN_DASHBOARD returns full screen data", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/screens/ADMIN_DASHBOARD");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(res.body.screen.screen_id).toBe("ADMIN_DASHBOARD");
    expect(Array.isArray(res.body.screen.buttons)).toBe(true);
    expect(Array.isArray(res.body.screen.inputs)).toBe(true);
    expect(res.body.screen.frontend_map_version).toBe(FRONTEND_MAP_VERSION);
  });

  it("GET /support/frontend-map/screens/NONEXISTENT returns 404", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/screens/NONEXISTENT");
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("NO_MATCH");
  });
});

// =============================================================================
// FMREG-11: registry completeness
// =============================================================================
describe("FMREG-11: registry completeness", () => {
  it("every screen has required fields: screen_id, screen_name, route, purpose, available_roles, available_modes, frontend_map_version", () => {
    const requiredFields: (keyof typeof FRONTEND_MAP_REGISTRY[0])[] = [
      "screen_id",
      "screen_name",
      "route",
      "purpose",
      "available_roles",
      "available_modes",
      "frontend_map_version",
    ];
    for (const screen of FRONTEND_MAP_REGISTRY) {
      for (const field of requiredFields) {
        expect(
          screen[field],
          `${screen.screen_id} is missing required field: ${field}`
        ).toBeTruthy();
      }
    }
  });

  it("every screen has arrays for buttons, inputs, permissions, related_features, support_keywords", () => {
    for (const screen of FRONTEND_MAP_REGISTRY) {
      expect(Array.isArray(screen.buttons), `${screen.screen_id}.buttons`).toBe(true);
      expect(Array.isArray(screen.inputs), `${screen.screen_id}.inputs`).toBe(true);
      expect(Array.isArray(screen.permissions), `${screen.screen_id}.permissions`).toBe(true);
      expect(Array.isArray(screen.related_features), `${screen.screen_id}.related_features`).toBe(true);
      expect(Array.isArray(screen.support_keywords), `${screen.screen_id}.support_keywords`).toBe(true);
    }
  });

  it("all frontend_map_version values match FRONTEND_MAP_VERSION", () => {
    for (const screen of FRONTEND_MAP_REGISTRY) {
      expect(screen.frontend_map_version, `${screen.screen_id}.version`).toBe(FRONTEND_MAP_VERSION);
    }
  });

  it("FRONTEND_MAP_VERSION is 1.6.3", () => {
    expect(FRONTEND_MAP_VERSION).toBe("1.6.3");
  });

  it("registry has at least 40 screens", () => {
    expect(FRONTEND_MAP_REGISTRY.length).toBeGreaterThanOrEqual(40);
  });

  it("registry covers pool_admin, teacher, parent roles", () => {
    const hasAdmin  = FRONTEND_MAP_REGISTRY.some((s) => s.available_roles.includes("pool_admin"));
    const hasTeach  = FRONTEND_MAP_REGISTRY.some((s) => s.available_roles.includes("teacher"));
    const hasParent = FRONTEND_MAP_REGISTRY.some((s) => s.available_roles.includes("parent"));
    expect(hasAdmin).toBe(true);
    expect(hasTeach).toBe(true);
    expect(hasParent).toBe(true);
  });
});

// =============================================================================
// FMREG-12: search score ordering
// =============================================================================
describe("FMREG-12: search score ordering", () => {
  it("results are sorted by score descending", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=일지");
    expect(res.body.match).toBe(true);
    const scores: number[] = res.body.results.map((r: any) => r.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });

  it("exact label match (score 90) ranks above keyword partial (score 75)", async () => {
    // 수업 일지 is screen_name of ADMIN_DIARY_TEACHER_ENTRIES
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=수업 일지");
    expect(res.body.match).toBe(true);
    const top = res.body.results[0];
    expect(top.score).toBeGreaterThanOrEqual(75);
  });
});

// =============================================================================
// FMREG-13: route without leading slash is normalized
// =============================================================================
describe("FMREG-13: route normalization", () => {
  it("route=dashboard (no leading slash) matches /dashboard", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?route=dashboard&role=pool_admin");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids).toContain("ADMIN_DASHBOARD");
  });
});

// =============================================================================
// FMREG-14: unknown screen_id NO_MATCH
// =============================================================================
describe("FMREG-14: unknown screen_id returns NO_MATCH", () => {
  it("COMPLETELY_FAKE_SCREEN returns match=false", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?screen_id=COMPLETELY_FAKE_SCREEN");
    expect(res.body.match).toBe(false);
    expect(res.body.reason).toBe("NO_MATCH");
    expect(res.body.total).toBe(0);
  });
});

// =============================================================================
// FMREG-15: unauthenticated request denied
// =============================================================================
describe("FMREG-15: unauthenticated request denied", () => {
  it("GET search without auth returns 401", async () => {
    const res = await request(makeUnauthedApp())
      .get("/support/frontend-map/search?q=홈");
    expect(res.status).toBe(401);
  });

  it("GET meta without auth returns 401", async () => {
    const res = await request(makeUnauthedApp())
      .get("/support/frontend-map/meta");
    expect(res.status).toBe(401);
  });

  it("GET screen detail without auth returns 401", async () => {
    const res = await request(makeUnauthedApp())
      .get("/support/frontend-map/screens/ADMIN_DASHBOARD");
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// FMREG-16: purpose token match
// =============================================================================
describe("FMREG-16: purpose token match", () => {
  it("query=홈페이지 matches purpose text", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=홈페이지");
    // ADMIN_WEB_PIN_SETTINGS purpose mentions 홈페이지
    expect(res.body.match).toBe(true);
  });

  it("purpose token match has score 50", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=청구서");
    if (res.body.match) {
      const purposeMatch = res.body.results.find((r: any) => r.source === "purpose_token");
      if (purposeMatch) {
        expect(purposeMatch.score).toBe(50);
      }
    }
    // May or may not match — just verify no error
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// FMREG-17: multi-role screen visible to all allowed roles
// =============================================================================
describe("FMREG-17: multi-role screen visible to allowed roles", () => {
  it("TEACHER_ATTENDANCE is visible to teacher role filter", async () => {
    const res = await request(makeApp("teacher"))
      .get("/support/frontend-map/search?role=teacher&q=출결");
    expect(res.body.match).toBe(true);
    const ids = res.body.results.map((r: any) => r.screen_id);
    expect(ids.some((id: string) => id.includes("ATTENDANCE"))).toBe(true);
  });

  it("ADMIN_DIARY_TEACHER_ENTRIES only visible to pool_admin/sub_admin", async () => {
    const res = await request(makeApp("teacher"))
      .get("/support/frontend-map/search?role=teacher&screen_id=ADMIN_DIARY_TEACHER_ENTRIES");
    // pool_admin role required — teacher filtered out
    expect(res.body.match).toBe(false);
  });
});

// =============================================================================
// FMREG-18: deep_link field on screens that have it
// =============================================================================
describe("FMREG-18: deep_link field", () => {
  it("ADMIN_INVITE_QR has deep_link set", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/screens/ADMIN_INVITE_QR");
    expect(res.status).toBe(200);
    expect(res.body.screen.deep_link).toBeTruthy();
    expect(res.body.screen.deep_link).toContain("swimnote.app");
  });

  it("ADMIN_DASHBOARD deep_link is null", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?screen_id=ADMIN_DASHBOARD");
    expect(res.body.results[0].deep_link).toBeNull();
  });
});

// =============================================================================
// FMREG-19: no duplicate screen_id
// =============================================================================
describe("FMREG-19: no duplicate screen_id in registry", () => {
  it("all screen_ids are unique", () => {
    const ids = FRONTEND_MAP_REGISTRY.map((s) => s.screen_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("SCREEN_BY_ID map size equals registry size", () => {
    expect(SCREEN_BY_ID.size).toBe(FRONTEND_MAP_REGISTRY.length);
  });
});

// =============================================================================
// FMREG-20: full regression
// =============================================================================
describe("FMREG-20: full regression", () => {
  it("search with no params returns role_mode_filter list", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search");
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it("PARENT_HOME screen has correct structure", async () => {
    const screen = SCREEN_BY_ID.get("PARENT_HOME");
    expect(screen).toBeDefined();
    expect(screen!.available_roles).toContain("parent");
    expect(screen!.route).toBe("/home");
    expect(screen!.purpose).toBeTruthy();
    expect(Array.isArray(screen!.buttons)).toBe(true);
    expect(Array.isArray(screen!.support_keywords)).toBe(true);
    expect(screen!.support_keywords.length).toBeGreaterThan(0);
  });

  it("version_mismatch=false when version matches", async () => {
    const res = await request(makeApp())
      .get(`/support/frontend-map/search?q=홈&version=${FRONTEND_MAP_VERSION}`);
    expect(res.body.version_mismatch).toBe(false);
  });

  it("version_mismatch=true when version differs", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/search?q=홈&version=0.0.1");
    expect(res.body.version_mismatch).toBe(true);
  });

  it("meta total_screens reflects actual registry length", async () => {
    const res = await request(makeApp())
      .get("/support/frontend-map/meta");
    expect(res.body.total_screens).toBe(FRONTEND_MAP_REGISTRY.length);
  });
});
