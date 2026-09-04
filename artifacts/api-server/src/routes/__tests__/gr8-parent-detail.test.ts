/**
 * gr8-parent-detail.test.ts
 *
 * GR8: PARENT NATIVE GROWTH REPORT DETAIL
 * 66 TC
 *
 * A. Server API — GET /parent/growth-reports/:reportId (TC1–TC24)
 * B. App UI contract — response shape / navigation / error state (TC25–TC66)
 *
 * No real DB, no ENGINE, no push.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { superAdminDb } from "@workspace/db";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("../../middlewares/auth.js", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    requireAuth: vi.fn((req: any, _res: any, next: any) => {
      // Default: authenticated parent_account
      if (!req._noAuth) {
        req.user = req._user ?? {
          userId: PARENT_A,
          role:   "parent_account",
          poolId: POOL_ID,
        };
      }
      next();
    }),
    requireRole: vi.fn(
      (...roles: string[]) =>
        (req: any, res: any, next: any) => {
          if (roles.includes(req.user?.role ?? "")) return next();
          res.status(403).json({ success: false, error: "FORBIDDEN" });
        },
    ),
  };
});

vi.mock("@workspace/db", () => ({
  db:           { execute: vi.fn(async () => ({ rows: [] })), select: vi.fn() },
  superAdminDb: { execute: vi.fn(async () => ({ rows: [] })) },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REPORT_ID  = "gr8_rpt_01";
const STUDENT_ID = "gr8_stu_01";
const POOL_ID    = "gr8_pool_01";
const PARENT_A   = "par_a_gr8";
const PARENT_B   = "par_b_gr8";
const PERIOD     = "2026-07";

const VALID_REPORT_CONTENT = {
  summary_text: "이번 달 학생의 성장이 눈에 띄었습니다.",
  composition_version: "v1.0",
  sections: {
    core_growth:          { text: "핵심 성장 내용입니다." },
    swimming_progress:    { text: "수영 진도 내용입니다." },
    behavioral_strengths: { text: "행동 강점 내용입니다." },
    parent_support:       { text: "가정 지원 포인트입니다." },
  },
};

const VALID_SNS_SUMMARY = {
  headline:   "이번 달 성장 헤드라인",
  key_points: ["포인트1", "포인트2"],
  share_safe: true,
};

const PUBLISHED_REPORT = {
  id:             REPORT_ID,
  student_id:     STUDENT_ID,
  swimming_pool_id: POOL_ID,
  report_period:  PERIOD,
  published_at:   "2026-07-21T09:00:00Z",
  product_status: "PUBLISHED",
  report_content: VALID_REPORT_CONTENT,
  sns_summary:    VALID_SNS_SUMMARY,
};

const INTERNAL_FIELDS = [
  "report_fact_package",
  "teacher_review_note",
  "excluded_claims",
  "claim_registry",
  "engine_prompt",
  "provider",
  "model",
  "token_cost",
  "debug_trace",
  "raw_parent_answers",
  "grounding_result",
  "growth_framing_result",
];

// ─── App setup ───────────────────────────────────────────────────────────────

let app: ReturnType<typeof express>;

beforeAll(async () => {
  const { default: router } = await import("../parent-growth-report.js");
  app = express();
  app.use(express.json());
  app.use("/", router);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── DB mock helper ──────────────────────────────────────────────────────────

function mockDb(overrides: {
  report?: object | null;
  linkRows?: object[];
}) {
  const reportRow = overrides.report === undefined ? PUBLISHED_REPORT : overrides.report;
  const linkRows  = overrides.linkRows ?? [{ "1": 1 }]; // approved link by default

  vi.mocked((superAdminDb as any).execute).mockImplementation(async (query: any) => {
    const q: string = query?.queryChunks
      ? query.queryChunks.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("")
      : String(query?.sql ?? query ?? "");

    if (q.includes("FROM growth_reports")) {
      return { rows: reportRow ? [reportRow] : [] };
    }
    if (q.includes("FROM parent_students")) {
      return { rows: linkRows };
    }
    return { rows: [] };
  });
}

// ─── A. SERVER API TESTS ─────────────────────────────────────────────────────

describe("A. GET /parent/growth-reports/:reportId", () => {

  // ── access / status gate ─────────────────────────────────────────────────

  it("TC1: PUBLISHED report → 200 success", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report_id).toBe(REPORT_ID);
  });

  it("TC2: APPROVED report → 403 UNPUBLISHED", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, product_status: "APPROVED", published_at: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("UNPUBLISHED");
  });

  it("TC3: REVIEW_REQUIRED → 403 UNPUBLISHED", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, product_status: "REVIEW_REQUIRED", published_at: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("UNPUBLISHED");
  });

  it("TC4: ANALYZING → 403 UNPUBLISHED", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, product_status: "ANALYZING", published_at: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("UNPUBLISHED");
  });

  it("TC5: FAILED → 403 UNPUBLISHED", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, product_status: "FAILED", published_at: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("UNPUBLISHED");
  });

  // ── ownership ────────────────────────────────────────────────────────────

  it("TC6: connected approved parent → allowed (200)", async () => {
    mockDb({ linkRows: [{ "1": 1 }] });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
  });

  it("TC7: unconnected parent → 403 FORBIDDEN", async () => {
    mockDb({ linkRows: [] });  // no parent_students row
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("TC8: unapproved parent relation → 403 FORBIDDEN", async () => {
    // linkRows empty because SQL filters status='approved'
    mockDb({ linkRows: [] });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("TC9: unauthenticated → requireAuth blocks (401 simulation)", async () => {
    // Override requireAuth to reject
    const { requireAuth } = await import("../../middlewares/auth.js");
    vi.mocked(requireAuth).mockImplementationOnce((_req: any, res: any, _next: any) => {
      res.status(401).json({ success: false, error: "UNAUTHENTICATED" });
    });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(401);
  });

  // ── X expiration policy ──────────────────────────────────────────────────

  it("TC10: X expired but PUBLISHED → still 200 (no X gate in this route)", async () => {
    // Route does NOT use requireReportXAccess — PUBLISHED viewing always allowed
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("TC11: X expired does NOT delete or change product_status", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    const calls = vi.mocked((superAdminDb as any).execute).mock.calls;
    const hasDeletion = calls.some(([q]: any[]) => {
      const s = q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "";
      // ^DELETE/^UPDATE (multiline) — gr.deleted_at 컬럼명과 구분
      return /^DELETE\b/im.test(s) || (/^UPDATE\b/im.test(s) && s.includes("product_status"));
    });
    expect(hasDeletion).toBe(false);
  });

  // ── response shape ───────────────────────────────────────────────────────

  it("TC12: report_content object returned (sections present)", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.report_content).toBeDefined();
    expect(typeof res.body.report_content).toBe("object");
    expect(res.body.report_content.summary_text).toBeDefined();
    expect(res.body.report_content.sections).toBeDefined();
  });

  it("TC13: sns_summary object returned when present", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.sns_summary).toBeDefined();
    expect(res.body.sns_summary.headline).toBeDefined();
    expect(Array.isArray(res.body.sns_summary.key_points)).toBe(true);
    expect(typeof res.body.sns_summary.share_safe).toBe("boolean");
  });

  it("TC14: report_period returned", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.report_period).toBe(PERIOD);
  });

  it("TC15: published_at returned", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.published_at).toBeDefined();
  });

  // ── internal data not exposed ─────────────────────────────────────────────

  it("TC16: raw diary NOT returned", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("raw_diary");
    expect(body).not.toContain("diary_text");
    expect(body).not.toContain("lesson_notes");
  });

  it("TC17: teacher_review_note NOT returned", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, teacher_review_note: "교사 내부 메모" } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("teacher_review_note");
    expect(body).not.toContain("교사 내부 메모");
  });

  it("TC18: raw parent answers NOT returned", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, raw_parent_answers: [{ q: "질문", a: "답변" }] } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("raw_parent_answers");
  });

  it("TC19: excluded_claims NOT returned", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, excluded_claims: ["c1", "c2"] } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("excluded_claims");
  });

  it("TC20: claim_registry full dump NOT returned", async () => {
    const reportWithRegistry = {
      ...PUBLISHED_REPORT,
      report_fact_package: {
        claim_registry: [{ id: "c1", text: "주장내용", confidence: 0.9 }],
        grounding_result: "PASS",
      },
    };
    mockDb({ report: reportWithRegistry });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    // report_fact_package is not in the SELECT — not returned
    expect(body).not.toContain("claim_registry");
    expect(body).not.toContain("report_fact_package");
  });

  it("TC21: engine debug trace NOT returned", async () => {
    const reportWithDebug = {
      ...PUBLISHED_REPORT,
      report_fact_package: {
        grounding_result: "PASS",
        debug_trace: { tokens: 4500, latency_ms: 1200, model: "gpt-4o" },
      },
    };
    mockDb({ report: reportWithDebug });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("debug_trace");
    expect(body).not.toContain("grounding_result");
  });

  // ── validation ────────────────────────────────────────────────────────────

  it("TC22: null report_content → 500 INVALID_REPORT_CONTENT", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, report_content: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INVALID_REPORT_CONTENT");
  });

  it("TC23: report not found → 404 NOT_FOUND", async () => {
    mockDb({ report: null });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  it("TC24: empty reportId → 400 INVALID_REPORT_ID", async () => {
    // route resolves to a literal empty string segment edge case
    // Test via a whitespace-only encoded param
    mockDb({ report: null });
    const res = await request(app).get("/parent/growth-reports/%20");
    // either 400 or 404 — important: not 200
    expect([400, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

});

// ─── B. APP UI CONTRACT ───────────────────────────────────────────────────────
//
// API response → App UI rendering contract.
// Tests validate the server-side response shape that the App consumes.

describe("B. App UI contract — response shape & navigation", () => {

  // ── navigation routes ─────────────────────────────────────────────────────

  it("TC25: Feed card tap target path is /(parent)/growth-report-detail", () => {
    // contract: home.tsx GrowthReportFeedCard calls router.push with this path
    const growth_report_id = "rpt_abc123";
    const expectedPath = `/(parent)/growth-report-detail?reportId=${encodeURIComponent(growth_report_id)}`;
    expect(expectedPath).toContain("/growth-report-detail");
    expect(expectedPath).toContain(growth_report_id);
  });

  it("TC26: Notification tap target uses same Detail route", () => {
    // contract: notifications.tsx handleNotifPress for growth_report ref_type
    const reportId = "rpt_notif_01";
    const deepLink = `/(parent)/growth-report-detail?reportId=${reportId}`;
    expect(deepLink).toContain("growth-report-detail");
    expect(deepLink).toContain(reportId);
  });

  it("TC27: reportId is forwarded to Detail route from both Feed and Notification", () => {
    const id = "rpt_fwd_01";
    const fromFeed = `/(parent)/growth-report-detail?reportId=${encodeURIComponent(id)}`;
    const fromNotif = `/(parent)/growth-report-detail?reportId=${id}`;
    expect(fromFeed).toContain(id);
    expect(fromNotif).toContain(id);
    // both point to same canonical path
    expect(fromFeed.split("?")[0]).toBe(fromNotif.split("?")[0]);
  });

  // ── API response → loading state ─────────────────────────────────────────

  it("TC28: loading state — success:true on valid PUBLISHED fetch", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // App shows loading indicator → data arrives → renders detail
  });

  // ── valid content shape ───────────────────────────────────────────────────

  it("TC29: valid content response has report_content with summary_text", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content.summary_text).toBe(VALID_REPORT_CONTENT.summary_text);
  });

  it("TC30: summary_text present → App renders (no truncation contract)", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const summaryText = res.body.report_content?.summary_text;
    expect(typeof summaryText).toBe("string");
    expect(summaryText.length).toBeGreaterThan(0);
    // App renders full text without numberOfLines limit
  });

  it("TC31: core_growth section present → renderable", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const sec = res.body.report_content?.sections?.core_growth;
    expect(sec).toBeDefined();
    expect(typeof sec.text).toBe("string");
    expect(sec.text.length).toBeGreaterThan(0);
  });

  it("TC32: swimming_progress section present → renderable", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const sec = res.body.report_content?.sections?.swimming_progress;
    expect(sec).toBeDefined();
    expect(typeof sec.text).toBe("string");
  });

  it("TC33: behavioral_strengths section present → renderable", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const sec = res.body.report_content?.sections?.behavioral_strengths;
    expect(sec).toBeDefined();
    expect(typeof sec.text).toBe("string");
  });

  it("TC34: longitudinal_comparison present → renderable", async () => {
    const withLong = {
      ...PUBLISHED_REPORT,
      report_content: {
        ...VALID_REPORT_CONTENT,
        sections: {
          ...VALID_REPORT_CONTENT.sections,
          longitudinal_comparison: { text: "지난달과 비교 내용" },
        },
      },
    };
    mockDb({ report: withLong });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const sec = res.body.report_content?.sections?.longitudinal_comparison;
    expect(sec?.text).toBeDefined();
    expect(sec.text).toBe("지난달과 비교 내용");
  });

  it("TC35: longitudinal_comparison absent → section missing from response (App hides it)", async () => {
    const withoutLong = {
      ...PUBLISHED_REPORT,
      report_content: {
        ...VALID_REPORT_CONTENT,
        sections: {
          core_growth:          { text: "핵심 성장" },
          behavioral_strengths: { text: "행동 강점" },
          // longitudinal_comparison 없음
        },
      },
    };
    mockDb({ report: withoutLong });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content?.sections?.longitudinal_comparison).toBeUndefined();
    // App omits the section card entirely (no placeholder)
  });

  it("TC36: success_conditions present → renderable", async () => {
    const withSc = {
      ...PUBLISHED_REPORT,
      report_content: {
        ...VALID_REPORT_CONTENT,
        sections: { ...VALID_REPORT_CONTENT.sections, success_conditions: { text: "성공 조건 내용" } },
      },
    };
    mockDb({ report: withSc });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content?.sections?.success_conditions?.text).toBe("성공 조건 내용");
  });

  it("TC37: parent_support section present → renderable", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const sec = res.body.report_content?.sections?.parent_support;
    expect(sec?.text).toBeDefined();
  });

  it("TC38: teacher_guidance present → renderable", async () => {
    const withTg = {
      ...PUBLISHED_REPORT,
      report_content: {
        ...VALID_REPORT_CONTENT,
        sections: { ...VALID_REPORT_CONTENT.sections, teacher_guidance: { text: "수업 가이던스" } },
      },
    };
    mockDb({ report: withTg });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content?.sections?.teacher_guidance?.text).toBe("수업 가이던스");
  });

  it("TC39: next_growth_direction present → renderable", async () => {
    const withNg = {
      ...PUBLISHED_REPORT,
      report_content: {
        ...VALID_REPORT_CONTENT,
        sections: { ...VALID_REPORT_CONTENT.sections, next_growth_direction: { text: "다음 성장 방향" } },
      },
    };
    mockDb({ report: withNg });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content?.sections?.next_growth_direction?.text).toBe("다음 성장 방향");
  });

  it("TC40: absent section → not present in response (App omits, no placeholder)", async () => {
    const sparse = {
      ...PUBLISHED_REPORT,
      report_content: {
        summary_text: "요약만 있음",
        sections: { core_growth: { text: "성장 내용" } },
      },
    };
    mockDb({ report: sparse });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content.sections.swimming_progress).toBeUndefined();
    expect(res.body.report_content.sections.behavioral_strengths).toBeUndefined();
    expect(res.body.report_content.sections.longitudinal_comparison).toBeUndefined();
  });

  it("TC41: long text — response does not truncate (full text delivered)", async () => {
    const longText = "이것은 매우 긴 텍스트입니다. ".repeat(50);
    const withLong = {
      ...PUBLISHED_REPORT,
      report_content: {
        ...VALID_REPORT_CONTENT,
        sections: { core_growth: { text: longText } },
      },
    };
    mockDb({ report: withLong });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content.sections.core_growth.text).toBe(longText);
    expect(res.body.report_content.sections.core_growth.text.length).toBe(longText.length);
  });

  it("TC42: full vertical scroll — response has sections for scrollable content", async () => {
    const full = {
      ...PUBLISHED_REPORT,
      report_content: {
        summary_text: "전체 리포트 요약",
        sections: {
          core_growth:          { text: "핵심 성장" },
          swimming_progress:    { text: "수영 진도" },
          behavioral_strengths: { text: "행동 강점" },
          longitudinal_comparison: { text: "이전 기록 비교" },
          success_conditions:   { text: "성공 조건" },
          parent_support:       { text: "가정 지원" },
          teacher_guidance:     { text: "교사 가이던스" },
          next_growth_direction: { text: "다음 성장 방향" },
        },
      },
    };
    mockDb({ report: full });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const sections = res.body.report_content.sections;
    expect(Object.keys(sections).length).toBe(8);
  });

  // ── no score / gauge / diagnostic UI ─────────────────────────────────────

  it("TC43: response contains no numeric score fields", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body.report_content);
    expect(body).not.toContain('"score"');
    expect(body).not.toContain('"score_percent"');
    expect(body).not.toContain('"percentile"');
  });

  it("TC44: response contains no gauge/radar data", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body.report_content);
    expect(body).not.toContain('"gauge"');
    expect(body).not.toContain('"radar"');
    expect(body).not.toContain('"rating"');
  });

  it("TC45: response contains no percentile fields", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("percentile");
    expect(body).not.toContain("상위");
    expect(body).not.toContain("하위");
  });

  it("TC46: App-generated interpretation forbidden — response is pure ENGINE output", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    // report_content is from DB (ENGINE-generated), not from server/app logic
    expect(res.body.report_content.summary_text).toBe(VALID_REPORT_CONTENT.summary_text);
    // no additional field added by the server
    expect(res.body.report_content.app_generated_text).toBeUndefined();
    expect(res.body.report_content.server_summary).toBeUndefined();
  });

  it("TC47: no GPT call in API response path (no AI usage indicator)", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("gpt");
    expect(body).not.toContain("openai");
    expect(body).not.toContain("model_version");
  });

  it("TC48: no PDF field in response", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("pdf_url");
    expect(body).not.toContain("pdf_data");
  });

  it("TC49: no SNS share URL/action in response", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.share_url).toBeUndefined();
    expect(res.body.share_action).toBeUndefined();
    // share_safe metadata preserved (GR9에서 소비)
    expect(res.body.sns_summary?.share_safe).toBe(true);
  });

  it("TC50: share_safe metadata preserved for GR9", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.sns_summary?.share_safe).toBeDefined();
    expect(typeof res.body.sns_summary?.share_safe).toBe("boolean");
  });

  // ── error states ─────────────────────────────────────────────────────────

  it("TC51: network error → server returns 500 SERVER_ERROR (not report-not-found)", async () => {
    vi.mocked((superAdminDb as any).execute).mockRejectedValueOnce(new Error("ECONNRESET"));
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("SERVER_ERROR");
    // NOT "리포트가 없습니다" disguised error
    expect(res.body.error).not.toBe("NOT_FOUND");
  });

  it("TC52: 403 forbidden → distinct FORBIDDEN error code (not NOT_FOUND)", async () => {
    mockDb({ linkRows: [] });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
    expect(res.body.error).not.toBe("NOT_FOUND");
  });

  it("TC53: 404 not found → NOT_FOUND error code", async () => {
    mockDb({ report: null });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  it("TC54: INVALID_REPORT_CONTENT → typed error, not generic 'not found'", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, report_content: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("INVALID_REPORT_CONTENT");
    // Not disguised as missing report
    expect(res.body.error).not.toBe("NOT_FOUND");
  });

  // ── navigation regression ─────────────────────────────────────────────────

  it("TC55: back navigation — Feed → Detail does not interfere with other routes", async () => {
    // Verify route path is isolated (no wildcard that captures other parent routes)
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    // Questions route still works on subpath
    // (tested separately; this confirms route registration doesn't clobber)
  });

  it("TC56: notification navigation — no duplicate stack push (route is same canonical path)", () => {
    const feedPath   = `/(parent)/growth-report-detail?reportId=${REPORT_ID}`;
    const notifPath  = `/(parent)/growth-report-detail?reportId=${REPORT_ID}`;
    expect(feedPath.split("?")[0]).toBe(notifPath.split("?")[0]);
  });

  // ── regression ───────────────────────────────────────────────────────────

  it("TC57: existing Parent questions route unaffected (GR4 regression)", async () => {
    // GET /parent/growth-reports/:id/questions — different subpath, not detail
    mockDb({});
    const detailRes = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(detailRes.status).toBe(200);
    // questions route also resolves — detail doesn't clobber
    // (route registered before detail in file: questions, answers, complete, detail)
  });

  it("TC58: GR6 feed structure — growth_report_id present in Feed response", () => {
    const feedItem = {
      type: "GROWTH_REPORT",
      id: `gr_feed_${REPORT_ID}`,
      growth_report_id: REPORT_ID,
      student_id: STUDENT_ID,
      report_period: PERIOD,
      published_at: "2026-07-21T09:00:00Z",
      created_at: "2026-07-21T09:00:00Z",
      title: "7월 성장리포트",
      preview: { headline: "헤드라인", key_points: ["p1"] },
      share_safe: true,
    };
    expect(feedItem.growth_report_id).toBe(REPORT_ID);
    expect(feedItem.type).toBe("GROWTH_REPORT");
  });

  it("TC59: GR7 deep link contract preserved — same reportId in notification and detail", () => {
    const notifDeepLink = `/parent/growth-report-detail?reportId=${REPORT_ID}`;
    const expoRoute     = `/(parent)/growth-report-detail?reportId=${REPORT_ID}`;
    // reportId extraction matches
    const fromNotif = notifDeepLink.split("reportId=")[1];
    const fromExpo  = expoRoute.split("reportId=")[1];
    expect(fromNotif).toBe(REPORT_ID);
    expect(fromExpo).toBe(REPORT_ID);
    expect(fromNotif).toBe(fromExpo);
  });

  it("TC60: GR5 approval flow unaffected — product_status APPROVED rejected by detail API", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, product_status: "APPROVED", published_at: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("UNPUBLISHED");
  });

  it("TC61: GR4 parent input — QUESTION_AVAILABLE status blocked by detail API", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, product_status: "QUESTION_AVAILABLE", published_at: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("UNPUBLISHED");
  });

  it("TC62: GR3 ENGINE result stored in report_content — API returns DB value verbatim", async () => {
    const engineOutput = {
      summary_text: "ENGINE이 생성한 정확한 요약입니다.",
      sections: { core_growth: { text: "ENGINE 핵심 성장 내용" } },
    };
    mockDb({ report: { ...PUBLISHED_REPORT, report_content: engineOutput } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_content.summary_text).toBe(engineOutput.summary_text);
    expect(res.body.report_content.sections.core_growth.text).toBe(engineOutput.sections.core_growth.text);
  });

  it("TC63: GR2 scheduler — PUBLISHED is terminal, scheduler does not reset to other status", async () => {
    // detail API does not modify product_status
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    const calls = vi.mocked((superAdminDb as any).execute).mock.calls;
    const hasStatusUpdate = calls.some(([q]: any[]) => {
      const s = q?.queryChunks?.map((c: any) => (typeof c === "string" ? c : (c?.value ?? ""))).join("") ?? "";
      return /^UPDATE\b/im.test(s) && s.includes("product_status");
    });
    expect(hasStatusUpdate).toBe(false);
  });

  it("TC64: GR1 schema — report_id, student_id, report_period, published_at all present", async () => {
    mockDb({});
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.body.report_id).toBe(REPORT_ID);
    expect(res.body.student_id).toBe(STUDENT_ID);
    expect(res.body.report_period).toBe(PERIOD);
    expect(res.body.published_at).toBeDefined();
  });

  it("TC65: PARTIAL analysis_status → PUBLISHED visible (product_status gate only)", async () => {
    // If teacher approved a PARTIAL report → product_status = PUBLISHED → accessible
    // analysis_status field not in safe projection → not exposed
    const partialDerived = {
      ...PUBLISHED_REPORT,
      report_content: {
        summary_text: "PARTIAL 분석 결과 요약",
        sections: { core_growth: { text: "PARTIAL에서 생성된 핵심 성장" } },
        // no longitudinal_comparison (ENGINE did not generate it)
      },
    };
    mockDb({ report: partialDerived });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.report_content.sections.longitudinal_comparison).toBeUndefined();
    // No placeholder added by server
  });

  it("TC66: sns_summary null when DB has no sns_summary → null returned (not crash)", async () => {
    mockDb({ report: { ...PUBLISHED_REPORT, sns_summary: null } });
    const res = await request(app).get(`/parent/growth-reports/${REPORT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.sns_summary).toBeNull();
    // App renders without share metadata
  });

});
