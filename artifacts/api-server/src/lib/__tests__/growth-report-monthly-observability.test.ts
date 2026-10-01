import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { up as initMonthlyAutomationSchema } from "../../migrations/growth-report-monthly-automation.js";
import {
  isMonthlyAutomationSchemaReady,
  recordMonthlyServiceOutcome,
  resumeMonthlyAutomationRun,
} from "../growth-report-monthly-run.js";

const dialect = new PgDialect();
const queryText = (query: unknown) => dialect.sqlToQuery(query as any).sql;

describe("monthly automation schema gate and observability", () => {
  it("uses a read-only schema check and fails closed before the approved migration", async () => {
    const statements: string[] = [];
    const ready = await isMonthlyAutomationSchemaReady({
      execute: async query => {
        statements.push(queryText(query));
        return { rows: [{ schema_ready: false }] };
      },
    });

    expect(ready).toBe(false);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("to_regclass");
    expect(statements[0]).not.toMatch(/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE)\b/i);
  });

  it("keeps provider failure state in the durable circuit record", async () => {
    const statements: string[] = [];
    const db: any = {
      execute: async (query: unknown) => {
        statements.push(queryText(query));
        return { rows: statements.at(-1)?.includes("AS schema_ready")
          ? [{ schema_ready: true }]
          : [{ report_period: "2026-10", preparation_status: "sealed",
              actual_cycle_id: "cycle-1", manifest_cycle_id: "cycle-1",
              circuit_state: {
                status: "CLOSED",
                recentFailures: [Date.now() - 10],
                probeReservations: [],
                probeSuccesses: 0,
                resumeHistory: [],
                config: {
                  failureThreshold: 2, windowMs: 60_000, probeCount: 1,
                  cooldownMs: 1_000, probeLeaseMs: 60_000,
                },
              },
            }] };
      },
      transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
    };

    const result = await recordMonthlyServiceOutcome(db, {
      cycleId: "cycle-1",
      errorCode: "NETWORK_ERROR",
      success: false,
    });

    expect(result.paused).toBe(true);
    const pause = statements.find(text => text.includes("pause_epoch = pause_epoch + 1"));
    expect(pause).toContain("paused_at = NOW()");
    expect(pause).toContain("circuit_state =");
  });

  it("does not resume before the configured cooldown", async () => {
    const statements: string[] = [];
    const pausedAt = new Date().toISOString();
    const db: any = {
      execute: async (query: unknown) => {
        const text = queryText(query);
        statements.push(text);
        if (text.includes("AS schema_ready")) return { rows: [{ schema_ready: true }] };
        if (text.includes("SELECT paused_at, pause_epoch")) {
          return { rows: [{
            paused_at: pausedAt,
            pause_epoch: 1,
            circuit_state: {
              status: "OPEN", recentFailures: [], probeReservations: [],
              probeSuccesses: 0, resumeHistory: [],
              openedAt: Date.now(),
              config: {
                failureThreshold: 2, windowMs: 60_000, probeCount: 1,
                cooldownMs: 60_000, probeLeaseMs: 60_000,
              },
            },
          }] };
        }
        return { rows: [] };
      },
      transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
    };

    const resumed = await resumeMonthlyAutomationRun(db, {
      reportPeriod: "2026-10",
      actorId: "admin-1",
      reason: "operator review",
    });

    expect(resumed).toBe(false);
    expect(statements.some(text => text.includes("SET paused_at = NULL"))).toBe(false);
  });

  it("adds scoped outbox uniqueness without backfilling historical rows", async () => {
    const statements: string[] = [];
    await initMonthlyAutomationSchema({
      execute: async query => {
        statements.push(queryText(query));
        return { rows: [] };
      },
    } as any);

    expect(statements.some(text => text.includes("uq_growth_report_outbox_admin_pool_period_recipient"))).toBe(true);
    expect(statements.some(text => text.includes("uq_growth_report_outbox_event_recipient"))).toBe(true);
    expect(statements.some(text => text.includes("event_scope TEXT NOT NULL DEFAULT 'pool'"))).toBe(true);
    expect(statements.some(text =>
      text.includes("CHECK (recovery_approved_at IS NULL") &&
      text.includes("recovery_approval_reason"),
    )).toBe(true);
    expect(statements.some(text => /^\s*UPDATE\s+growth_report_notification_outbox/im.test(text))).toBe(false);
    expect(statements.some(text => /^\s*INSERT\s+INTO\s+growth_report_monthly_runs/im.test(text))).toBe(false);
  });
});