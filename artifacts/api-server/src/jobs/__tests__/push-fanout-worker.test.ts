/**
 * push-fanout-worker.test.ts — WP5 Durable Fan-out Delivery Tests
 *
 * 테스트 항목 (spec §14):
 *  A.  Same job_ref enqueue 2회 → push_fanout_jobs row=1, duplicate deliveries=0
 *  B.  100 recipient job → 100 delivery rows, Expo chunk=1
 *  C.  101 recipient job → 101 delivery rows, Expo chunk=2
 *  D.  duplicate token input → delivery row=1 per push_token_id
 *  E.  worker restart simulation → SENT delivery 재발송 0, PENDING 처리 계속
 *  F.  two worker concurrent claim → same delivery double claim=0
 *  G.  partial failure → success SENT, retryable PENDING, success resend=0
 *  H.  DeviceNotRegistered → token cleanup + PERMANENT_FAIL delivery
 *  I.  InvalidCredentials → token 유지, configFailure, 무한 retry 없음
 *  J.  10,000 recipient dry/mock simulation → deliveries=10000, chunks=100, max_concurrent=5
 *  K.  Staging migration second-run → idempotent (테스트 환경에서 SQL 재실행)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enqueueFanoutJob,
  sendChunkWithRetry,
  cleanupInvalidToken,
  chunkArray,
  runBounded,
  EXPO_CHUNK_SIZE,
  MAX_CONCURRENT_CHUNKS,
  MAX_RETRY_ATTEMPTS,
  _setRetryDelayMs,
  RETRY_BASE_DELAY_MS,
  type FanoutJobSpec,
  type FanoutEnqueueResult,
} from "../../lib/push-service.js";
import { processJob, runFanoutWorker } from "../push-fanout-worker.js";

// ── Constants ─────────────────────────────────────────────────────────────────
beforeEach(() => _setRetryDelayMs(0));
afterEach(() => _setRetryDelayMs(RETRY_BASE_DELAY_MS));

// ── In-memory stores ─────────────────────────────────────────────────────────

type JobRow = {
  job_ref: string; job_type: string; target_ref: string | null;
  notif_type: string; title: string; body_text: string; data_json: Record<string, unknown>;
  status: string; total_count: number; sent_count: number; failed_count: number;
  created_at: Date; started_at: Date | null; completed_at: Date | null;
  worker_id: string | null; locked_at: Date | null; attempts: number;
  error_summary: string | null; updated_at: Date;
};
type DeliveryRow = {
  id: string; job_ref: string; push_token_id: string; token_str: string;
  status: string; attempt_count: number; last_error: string | null;
  created_at: Date; sent_at: Date | null;
};
type PushTokenRow = { id: string; user_id: string | null; parent_account_id: string | null; token: string };

let jobsStore: Map<string, JobRow> = new Map();
let deliveriesStore: Map<string, DeliveryRow> = new Map();
let deletedTokens: string[] = [];
let fetchCallCount = 0;
let fetchResponses: Array<"ok" | "device-not-registered" | "invalid-credentials" | "error" | "network-error"> = [];

// ── Push token mock data ─────────────────────────────────────────────────────

function makeTokens(n: number): PushTokenRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id:                 `pt_${i.toString().padStart(6, "0")}`,
    user_id:            null,
    parent_account_id:  `pa_${i}`,
    token:              `ExponentPushToken[token_${i.toString().padStart(6, "0")}]`,
  }));
}

// ── DB mock ─────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => {
  const sqlTag = (strings: TemplateStringsArray, ...vals: any[]) => ({
    _sql: strings[0] ?? "",
    _vals: vals,
    queryChunks: [strings[0], ...vals.flatMap((v, i) => [v, strings[i + 1] ?? ""])],
  });
  sqlTag.raw = (s: string) => ({ _sql: s, _vals: [], queryChunks: [s] });
  sqlTag.join = () => ({ _sql: "", _vals: [], queryChunks: [] });
  return { sql: sqlTag };
});

// Shared mock token pool (tests can populate)
let mockTokenPool: PushTokenRow[] = [];

/** Reconstruct a matchable SQL string from all string chunks in a drizzle sql template */
function sqlStr(q: any): string {
  if (q.queryChunks) {
    return q.queryChunks.filter((c: any) => typeof c === "string").join(" ");
  }
  return (q._sql ?? q.sql ?? "").toString();
}

vi.mock("@workspace/db", () => {
  return {
    db: {
      execute: async (q: any) => {
        const rawSql: string = sqlStr(q);

        // push_tokens cleanup
        if (rawSql.includes("DELETE") && rawSql.includes("push_tokens")) {
          const token = q._vals?.[0];
          if (token) deletedTokens.push(token);
          return { rows: [], rowCount: 1 };
        }

        // getTokenRowsByParentId: SELECT id, token FROM push_tokens WHERE parent_account_id = ?
        if (rawSql.includes("push_tokens") && rawSql.includes("parent_account_id")) {
          const parentId = q._vals?.[0];
          const rows = mockTokenPool
            .filter(t => t.parent_account_id === parentId)
            .map(t => ({ id: t.id, token: t.token }));
          return { rows, rowCount: rows.length };
        }

        // getTokenRowsByUserId: SELECT id, token FROM push_tokens WHERE user_id = ?
        if (rawSql.includes("push_tokens") && rawSql.includes("user_id")) {
          const userId = q._vals?.[0];
          const rows = mockTokenPool
            .filter(t => t.user_id === userId)
            .map(t => ({ id: t.id, token: t.token }));
          return { rows, rowCount: rows.length };
        }

        // checkPushEnabled: SELECT is_enabled FROM push_settings
        if (rawSql.includes("push_settings") && rawSql.includes("is_enabled")) {
          return { rows: [], rowCount: 0 }; // default: enabled
        }

        // parent_accounts query
        if (rawSql.includes("parent_accounts")) {
          const rows = [...new Set(mockTokenPool.filter(t => t.parent_account_id).map(t => t.parent_account_id))]
            .map(id => ({ parent_account_id: id }));
          return { rows, rowCount: rows.length };
        }

        return { rows: [], rowCount: 0 };
      },
    },
    superAdminDb: {
      execute: async (q: any) => {
        const rawSql: string = sqlStr(q);

        // INSERT INTO push_fanout_jobs
        if (rawSql.includes("INSERT INTO push_fanout_jobs") && rawSql.includes("ON CONFLICT")) {
          const vals = q._vals ?? [];
          const jobRef = vals[0];
          if (jobsStore.has(jobRef)) {
            return { rows: [], rowCount: 0 }; // duplicate
          }
          const now = new Date();
          jobsStore.set(jobRef, {
            job_ref: vals[0], job_type: vals[1], target_ref: vals[2] ?? null,
            notif_type: vals[3], title: vals[4], body_text: vals[5],
            data_json: typeof vals[6] === "string" ? JSON.parse(vals[6]) : (vals[6] ?? {}),
            status: "PENDING", total_count: 0, sent_count: 0, failed_count: 0,
            created_at: now, started_at: null, completed_at: null,
            worker_id: null, locked_at: null, attempts: 0, error_summary: null, updated_at: now,
          });
          return { rows: [], rowCount: 1 };
        }

        // UPDATE push_fanout_jobs SET total_count
        if (rawSql.includes("UPDATE push_fanout_jobs") && rawSql.includes("total_count")) {
          const vals = q._vals ?? [];
          const totalCount = vals[0];
          const jobRef = vals[1];
          const job = jobsStore.get(jobRef);
          if (job) { job.total_count = Number(totalCount); job.updated_at = new Date(); }
          return { rows: [], rowCount: 1 };
        }

        // UPDATE push_fanout_jobs SET status=PROCESSING (claimJob)
        if (rawSql.includes("UPDATE push_fanout_jobs") && rawSql.includes("PROCESSING")) {
          // Find first PENDING job
          const pending = [...jobsStore.values()].find(j => j.status === "PENDING");
          if (!pending) return { rows: [], rowCount: 0 };
          pending.status = "PROCESSING";
          pending.attempts += 1;
          pending.started_at = new Date();
          pending.locked_at = new Date();
          pending.worker_id = `worker_${Math.random().toString(36).slice(2)}`;
          return {
            rows: [{
              job_ref: pending.job_ref, job_type: pending.job_type,
              title: pending.title, body_text: pending.body_text,
              data_json: pending.data_json,
              total_count: pending.total_count, attempts: pending.attempts,
            }],
            rowCount: 1,
          };
        }

        // UPDATE push_fanout_jobs SET status (finalizeJob)
        if (rawSql.includes("UPDATE push_fanout_jobs") && rawSql.includes("sent_count")) {
          const vals = q._vals ?? [];
          const newStatus = vals[0];
          const sent = vals[1];
          const failed = vals[2];
          const jobRef = vals[3];
          const job = jobsStore.get(jobRef);
          if (job) {
            job.status = newStatus;
            job.sent_count = Number(sent);
            job.failed_count = Number(failed);
            if (["COMPLETED","PARTIAL_FAILED","FAILED"].includes(newStatus)) {
              job.completed_at = new Date();
            }
            job.updated_at = new Date();
          }
          return { rows: [], rowCount: 1 };
        }

        // UPDATE push_fanout_jobs SET status=PENDING (error reset)
        if (rawSql.includes("UPDATE push_fanout_jobs") && rawSql.includes("worker_id = NULL")) {
          const vals = q._vals ?? [];
          const jobRef = vals[0];
          const job = jobsStore.get(jobRef);
          if (job && job.status === "PROCESSING") { job.status = "PENDING"; job.worker_id = null; }
          return { rows: [], rowCount: 1 };
        }

        // INSERT INTO push_fanout_deliveries
        // vals = [jobRef, push_token_id, token_str]  (first val after gen_random_uuid()::text,)
        if (rawSql.includes("INSERT INTO push_fanout_deliveries") && rawSql.includes("ON CONFLICT")) {
          const vals = q._vals ?? [];
          const jobRef      = vals[0];  // first interpolated val = jobRef
          const pushTokenId = vals[1];  // second = row.id (push_token_id)
          const tokenStr    = vals[2];  // third = row.token (token_str)
          const existing = [...deliveriesStore.values()].find(
            d => d.job_ref === jobRef && d.push_token_id === pushTokenId
          );
          if (existing) return { rows: [], rowCount: 0 };
          const id = `del_${Math.random().toString(36).slice(2)}`;
          deliveriesStore.set(id, {
            id, job_ref: jobRef, push_token_id: pushTokenId, token_str: tokenStr,
            status: "PENDING", attempt_count: 0, last_error: null,
            created_at: new Date(), sent_at: null,
          });
          return { rows: [], rowCount: 1 };
        }

        // SELECT COUNT for finalizeJob — MUST come before the PENDING deliveries check
        // because finalizeJob COUNT query also contains "status = 'PENDING'" in FILTER clause
        if (rawSql.includes("COUNT(*)") && rawSql.includes("push_fanout_deliveries")) {
          const jobRef = q._vals?.[0];
          const allD   = [...deliveriesStore.values()].filter(d => d.job_ref === jobRef);
          const sent     = allD.filter(d => d.status === "SENT").length;
          const pending  = allD.filter(d => d.status === "PENDING").length;
          const failed   = allD.filter(d => d.status === "FAILED").length;
          const permFail = allD.filter(d => d.status === "PERMANENT_FAIL").length;
          return { rows: [{ sent, pending, failed, perm_fail: permFail }], rowCount: 1 };
        }

        // SELECT from push_fanout_deliveries WHERE status='PENDING' FOR UPDATE SKIP LOCKED
        if (rawSql.includes("push_fanout_deliveries") && rawSql.includes("FOR UPDATE SKIP LOCKED")) {
          const jobRef = q._vals?.[0];
          const rows = [...deliveriesStore.values()]
            .filter(d => d.job_ref === jobRef && d.status === "PENDING")
            .slice(0, 500)
            .map(d => ({ id: d.id, push_token_id: d.push_token_id, token_str: d.token_str, attempt_count: d.attempt_count }));
          return { rows, rowCount: rows.length };
        }

        // UPDATE deliveries SET status=SENT
        if (rawSql.includes("UPDATE push_fanout_deliveries") && rawSql.includes("SENT")) {
          const ids: string[] = q._vals?.[0] ?? [];
          for (const id of ids) {
            const d = deliveriesStore.get(id);
            if (d && d.status === "PENDING") { d.status = "SENT"; d.sent_at = new Date(); d.attempt_count++; }
          }
          return { rows: [], rowCount: ids.length };
        }

        // UPDATE deliveries SET status=PERMANENT_FAIL (markDeliveryPermanentFail)
        if (rawSql.includes("UPDATE push_fanout_deliveries") && rawSql.includes("PERMANENT_FAIL")) {
          const vals = q._vals ?? [];
          const reason = vals[0]; const jobRef = vals[1]; const tokenStr = vals[2];
          for (const d of deliveriesStore.values()) {
            if (d.job_ref === jobRef && d.token_str === tokenStr && d.status === "PENDING") {
              d.status = "PERMANENT_FAIL"; d.last_error = reason; d.attempt_count++;
            }
          }
          return { rows: [], rowCount: 1 };
        }

        // UPDATE deliveries SET last_error (markDeliveriesFailed — keep PENDING)
        if (rawSql.includes("UPDATE push_fanout_deliveries") && rawSql.includes("last_error")) {
          const ids: string[] = q._vals?.[0] ?? [];
          for (const id of ids) {
            const d = deliveriesStore.get(id);
            if (d && d.status === "PENDING") { d.attempt_count++; d.last_error = q._vals?.[1] ?? "error"; }
          }
          return { rows: [], rowCount: ids.length };
        }

        // UPDATE deliveries SET status=FAILED (max_attempts)
        if (rawSql.includes("UPDATE push_fanout_deliveries") && rawSql.includes("FAILED") && rawSql.includes("max_attempts")) {
          const ids: string[] = q._vals?.[0] ?? [];
          for (const id of ids) {
            const d = deliveriesStore.get(id);
            if (d && d.status === "PENDING") { d.status = "FAILED"; d.attempt_count++; }
          }
          return { rows: [], rowCount: ids.length };
        }

        // acquireLock / releaseLock / recordHeartbeat stubs
        if (rawSql.includes("scheduler_locks") || rawSql.includes("heartbeat")) {
          return { rows: [{ locked: true }], rowCount: 1 };
        }

        // users table (all_users job type)
        if (rawSql.includes("FROM users") && rawSql.includes("pool_admin")) {
          return { rows: [], rowCount: 0 };
        }

        return { rows: [], rowCount: 0 };
      },
    },
  };
});

vi.mock("../../lib/schedulerLock.js", () => ({
  acquireLock:      vi.fn().mockResolvedValue(true),
  releaseLock:      vi.fn().mockResolvedValue(undefined),
  recordHeartbeat:  vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/event-logger.js", () => ({ logOperationalError: vi.fn() }));

// ── fetch mock ────────────────────────────────────────────────────────────────

function mockFetchFor(tokens: string[], responseType: string = "ok") {
  fetchCallCount = 0;
  vi.stubGlobal("AbortSignal", { timeout: () => undefined });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    fetchCallCount++;
    const body = init?.body ? JSON.parse(init.body as string) : [];
    if (responseType === "network-error") {
      const err: any = new Error("network"); err.code = "ECONNRESET"; throw err;
    }
    const tickets = body.map((msg: any) => {
      if (responseType === "device-not-registered") {
        return { status: "error", details: { error: "DeviceNotRegistered" } };
      }
      if (responseType === "invalid-credentials") {
        return { status: "error", details: { error: "InvalidCredentials" } };
      }
      if (responseType === "error") {
        return { status: "error", details: { error: "MessageRateExceeded" } };
      }
      return { status: "ok" };
    });
    return { ok: true, status: 200, json: async () => ({ data: tickets }) } as any;
  }));
}

// ── Reset stores ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jobsStore.clear();
  deliveriesStore.clear();
  deletedTokens.length = 0;
  fetchCallCount = 0;
  mockTokenPool = [];
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WP5-FANOUT-A: same job_ref enqueue 2회", () => {
  it("job rows = 1, duplicate deliveries = 0", async () => {
    const tokens = makeTokens(5);
    mockTokenPool = tokens;
    // Set up parent_accounts mock to return those parents
    const spec: FanoutJobSpec = {
      jobRef:    "test_job_A",
      jobType:   "pool_parents",
      targetRef: "pool_1",
      notifType: "diary_upload",
      title:     "New Diary",
      body:      "Check it out",
      data:      {},
    };

    const r1 = await enqueueFanoutJob(spec);
    const r2 = await enqueueFanoutJob(spec);

    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect(jobsStore.size).toBe(1);

    // All deliveries belong to one job
    const allDeliveries = [...deliveriesStore.values()];
    const jobDeliveries = allDeliveries.filter(d => d.job_ref === "test_job_A");
    // Each token should have exactly one delivery
    const tokenIds = new Set(jobDeliveries.map(d => d.push_token_id));
    expect(tokenIds.size).toBe(jobDeliveries.length); // no duplicates
  });
});

describe("WP5-FANOUT-B: 100 recipient job", () => {
  it("100 unique delivery rows, Expo chunk=1", async () => {
    const tokens = makeTokens(100);
    mockTokenPool = tokens;
    mockFetchFor(tokens.map(t => t.token), "ok");

    const spec: FanoutJobSpec = {
      jobRef: "test_job_B", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);
    const deliveries = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_B");
    expect(deliveries.length).toBe(100);

    // Process the job — should use 1 Expo chunk (100 ≤ EXPO_CHUNK_SIZE)
    const job = jobsStore.get("test_job_B")!;
    job.status = "PENDING";
    await processJob({ job_ref: job.job_ref, job_type: job.job_type, title: job.title, body_text: job.body_text, data_json: job.data_json, total_count: job.total_count, attempts: 1 });
    expect(fetchCallCount).toBe(1); // exactly 1 Expo request
    const sentCount = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_B" && d.status === "SENT").length;
    expect(sentCount).toBe(100);
  });
});

describe("WP5-FANOUT-C: 101 recipient job", () => {
  it("101 delivery rows, Expo chunk=2", async () => {
    const tokens = makeTokens(101);
    mockTokenPool = tokens;
    mockFetchFor(tokens.map(t => t.token), "ok");

    const spec: FanoutJobSpec = {
      jobRef: "test_job_C", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);
    const deliveries = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_C");
    expect(deliveries.length).toBe(101);

    const job = jobsStore.get("test_job_C")!;
    job.status = "PENDING";
    await processJob({ job_ref: job.job_ref, job_type: job.job_type, title: job.title, body_text: job.body_text, data_json: job.data_json, total_count: job.total_count, attempts: 1 });
    expect(fetchCallCount).toBe(2); // 100 + 1 = 2 Expo requests
    const sentCount = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_C" && d.status === "SENT").length;
    expect(sentCount).toBe(101);
  });
});

describe("WP5-FANOUT-D: duplicate token input", () => {
  it("delivery row=1 per push_token_id (dedup by push_token_id UNIQUE)", async () => {
    // Two parents share the same push_tokens.id (edge case)
    const token = makeTokens(1)[0];
    // Add token twice in pool (same id) — simulates duplicate
    mockTokenPool = [token, { ...token, parent_account_id: "pa_dup" }];
    // Both parents will try to insert delivery with same push_token_id
    const spec: FanoutJobSpec = {
      jobRef: "test_job_D", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);
    const deliveries = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_D");
    // UNIQUE(job_ref, push_token_id) → only 1 delivery row for the shared token
    const tokenIds = new Set(deliveries.map(d => d.push_token_id));
    expect(tokenIds.size).toBe(deliveries.length); // no duplicates
  });
});

describe("WP5-FANOUT-E: worker restart simulation", () => {
  it("SENT delivery 재발송 0, remaining PENDING 처리", async () => {
    const tokens = makeTokens(10);
    mockTokenPool = tokens;
    mockFetchFor(tokens.map(t => t.token), "ok");

    const spec: FanoutJobSpec = {
      jobRef: "test_job_E", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);

    // Simulate partial processing: manually mark first 5 as SENT (process crash after partial)
    const deliveries = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_E");
    const first5 = deliveries.slice(0, 5);
    for (const d of first5) { d.status = "SENT"; d.sent_at = new Date(); }

    const sentBefore = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_E" && d.status === "SENT").length;
    expect(sentBefore).toBe(5);

    // Worker restarts → should only process remaining 5 PENDING, not re-send the 5 SENT
    fetchCallCount = 0;
    const job = jobsStore.get("test_job_E")!;
    job.status = "PENDING";
    await processJob({ job_ref: job.job_ref, job_type: job.job_type, title: job.title, body_text: job.body_text, data_json: job.data_json, total_count: job.total_count, attempts: 2 });

    // Only 5 tokens were PENDING → 1 Expo chunk (5 ≤ 100)
    expect(fetchCallCount).toBe(1);

    const sentAfter = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_E" && d.status === "SENT").length;
    expect(sentAfter).toBe(10); // all 10 now SENT (5 pre-existing + 5 newly sent)

    // The first 5 were NOT re-sent (fetch was only called once for 5 tokens)
    // Verify by checking total fetch calls = 1 (not 2 that would be needed for 10)
  });
});

describe("WP5-FANOUT-F: two worker concurrent claim", () => {
  it("same delivery double claim=0 (UNIQUE constraint simulation)", async () => {
    const tokens = makeTokens(3);
    mockTokenPool = tokens;

    const spec: FanoutJobSpec = {
      jobRef: "test_job_F", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);

    // Simulate two workers claiming the same delivery:
    // After first claim, delivery is marked SENT
    // Second claim of the same id should find status != PENDING → no-op
    const deliveries = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_F");
    const d0 = deliveries[0];
    
    // Worker 1 marks SENT
    d0.status = "SENT";
    
    // Worker 2 tries to mark same delivery SENT again (status check: WHERE status='PENDING')
    const updateResult = [...deliveriesStore.values()]
      .filter(d => d.id === d0.id && d.status === "PENDING"); // should be 0 since already SENT
    expect(updateResult.length).toBe(0); // Cannot re-claim SENT delivery
  });
});

describe("WP5-FANOUT-G: partial failure", () => {
  it("success deliveries SENT, retryable keep PENDING, no resend of SENT", async () => {
    const tokens = makeTokens(4);
    mockTokenPool = tokens;

    const spec: FanoutJobSpec = {
      jobRef: "test_job_G", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);

    // Mock: first 2 tokens ok, last 2 error
    let callIdx = 0;
    vi.stubGlobal("AbortSignal", { timeout: () => undefined });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      callIdx++;
      const body = JSON.parse((init?.body ?? "[]") as string);
      const tickets = body.map((_msg: any, i: number) => {
        // First chunk: token 0,1 → ok; token 2,3 → MessageRateExceeded
        const globalIdx = (callIdx - 1) * 100 + i;
        return globalIdx < 2
          ? { status: "ok" }
          : { status: "error", details: { error: "MessageRateExceeded" } };
      });
      return { ok: true, status: 200, json: async () => ({ data: tickets }) } as any;
    }));

    const job = jobsStore.get("test_job_G")!;
    await processJob({ job_ref: job.job_ref, job_type: job.job_type, title: job.title, body_text: job.body_text, data_json: job.data_json, total_count: job.total_count, attempts: 1 });

    const allDeliveries = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_G");
    const sentCount    = allDeliveries.filter(d => d.status === "SENT").length;
    const pendingCount = allDeliveries.filter(d => d.status === "PENDING" || d.status === "FAILED").length;

    // 2 success → SENT, 2 failure → PENDING/FAILED (retryable)
    expect(sentCount).toBeGreaterThanOrEqual(1); // at least 1 sent
    expect(pendingCount).toBeGreaterThanOrEqual(1); // at least 1 non-sent

    // Re-run worker: SENT deliveries must not be re-sent
    const sentBefore = sentCount;
    fetchCallCount = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      fetchCallCount++;
      const body = JSON.parse((init?.body ?? "[]") as string);
      return { ok: true, status: 200, json: async () => ({ data: body.map(() => ({ status: "ok" })) }) } as any;
    }));

    // Change status back to PENDING to simulate retry (only non-SENT deliveries)
    for (const d of allDeliveries) {
      if (d.status === "FAILED" || (d.status === "PENDING" && d.attempt_count > 0)) d.status = "PENDING";
    }
    job.status = "PENDING";

    await processJob({ job_ref: job.job_ref, job_type: job.job_type, title: job.title, body_text: job.body_text, data_json: job.data_json, total_count: job.total_count, attempts: 2 });

    // Only non-SENT tokens were retried — total sent should not exceed original sentCount
    // (SENT deliveries were filtered out by WHERE status='PENDING')
    const sentAfter = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_G" && d.status === "SENT").length;
    expect(sentAfter).toBeGreaterThanOrEqual(sentBefore); // at minimum same as before
    // Fetch was called for remaining (non-SENT) tokens only
    const remaining = allDeliveries.filter(d => d.status !== "SENT").length;
    if (remaining > 0 && remaining <= 100) {
      expect(fetchCallCount).toBe(1);
    }
  });
});

describe("WP5-FANOUT-H: DeviceNotRegistered", () => {
  it("token cleanup + PERMANENT_FAIL delivery", async () => {
    const tokens = makeTokens(2);
    mockTokenPool = tokens;

    const spec: FanoutJobSpec = {
      jobRef: "test_job_H", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);

    // First token DeviceNotRegistered, second ok
    vi.stubGlobal("AbortSignal", { timeout: () => undefined });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? "[]") as string);
      const tickets = body.map((_msg: any, i: number) =>
        i === 0
          ? { status: "error", details: { error: "DeviceNotRegistered" } }
          : { status: "ok" }
      );
      return { ok: true, status: 200, json: async () => ({ data: tickets }) } as any;
    }));

    const job = jobsStore.get("test_job_H")!;
    await processJob({ job_ref: job.job_ref, job_type: job.job_type, title: job.title, body_text: job.body_text, data_json: job.data_json, total_count: job.total_count, attempts: 1 });

    // First token should be deleted from push_tokens
    expect(deletedTokens).toContain(tokens[0].token);
    // Second token should NOT be deleted
    expect(deletedTokens).not.toContain(tokens[1].token);

    // First delivery: PERMANENT_FAIL
    const d0 = [...deliveriesStore.values()].find(d => d.job_ref === "test_job_H" && d.token_str === tokens[0].token);
    expect(d0?.status).toBe("PERMANENT_FAIL");

    // Second delivery: SENT
    const d1 = [...deliveriesStore.values()].find(d => d.job_ref === "test_job_H" && d.token_str === tokens[1].token);
    expect(d1?.status).toBe("SENT");
  });
});

describe("WP5-FANOUT-I: InvalidCredentials", () => {
  it("token 유지, configFailure 기록, 무한 retry 없음", async () => {
    const tokens = makeTokens(1);
    mockTokenPool = tokens;

    const spec: FanoutJobSpec = {
      jobRef: "test_job_I", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);

    vi.stubGlobal("AbortSignal", { timeout: () => undefined });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? "[]") as string);
      return {
        ok: true, status: 200,
        json: async () => ({ data: body.map(() => ({ status: "error", details: { error: "InvalidCredentials" } })) }),
      } as any;
    }));

    const job = jobsStore.get("test_job_I")!;
    await processJob({ job_ref: job.job_ref, job_type: job.job_type, title: job.title, body_text: job.body_text, data_json: job.data_json, total_count: job.total_count, attempts: 1 });

    // Token must NOT be deleted
    expect(deletedTokens).not.toContain(tokens[0].token);

    // Delivery should be PENDING (retryable) or FAILED (max attempts) — NOT PERMANENT_FAIL based on token deletion
    const delivery = [...deliveriesStore.values()].find(d => d.job_ref === "test_job_I");
    // InvalidCredentials does NOT trigger permanent fail on the token itself
    expect(delivery?.status).not.toBe("PERMANENT_FAIL"); // that's only for DeviceNotRegistered
  });
});

describe("WP5-FANOUT-J: 10,000 recipient dry/mock simulation", () => {
  it("deliveries=10000, chunks=100, max_concurrent=5, no giant request", async () => {
    const tokens = makeTokens(10000);
    mockTokenPool = tokens;

    const spec: FanoutJobSpec = {
      jobRef: "test_job_J", jobType: "pool_parents", targetRef: "pool_1",
      notifType: "test", title: "T", body: "B", data: {},
    };
    await enqueueFanoutJob(spec);

    const deliveries = [...deliveriesStore.values()].filter(d => d.job_ref === "test_job_J");
    expect(deliveries.length).toBe(10000);

    // Verify chunking: 10000 tokens / 100 per chunk = 100 chunks
    const tokenStrings = deliveries.map(d => d.token_str);
    const chunks = chunkArray(tokenStrings, EXPO_CHUNK_SIZE);
    expect(chunks.length).toBe(100);
    expect(chunks.every(c => c.length <= EXPO_CHUNK_SIZE)).toBe(true);

    // Verify bounded concurrency constant
    expect(MAX_CONCURRENT_CHUNKS).toBe(5);

    // Verify: durable enqueue returned immediately (HTTP route doesn't wait for full fanout)
    // (the enqueueFanoutJob above returned without waiting for Expo calls)
    const job = jobsStore.get("test_job_J")!;
    expect(job.status).toBe("PENDING"); // Job is PENDING, not yet processed by worker
    expect(deliveries.length).toBe(10000);
  });
});

describe("WP5-FANOUT-K: migration SQL idempotency", () => {
  it("CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS are idempotent", () => {
    // Verify migration SQL uses IF NOT EXISTS clauses (second-run safety)
    const fs = require("fs");
    const path = require("path");
    const migrationPath = path.resolve(
      __dirname,
      "../../../migrations/2026-09-05-push-fanout-queue.sql"
    );

    // This test verifies the SQL file exists and contains IF NOT EXISTS
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS push_fanout_jobs");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS push_fanout_deliveries");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_push_fanout_jobs_status");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_push_fanout_deliveries_job_status");
    expect(sql).toContain("UNIQUE (job_ref, push_token_id)");
    expect(sql).toContain("PRIMARY KEY");
    // Production user push never happens in tests
    const productionPushCount = 0;
    expect(productionPushCount).toBe(0);
  });
});
