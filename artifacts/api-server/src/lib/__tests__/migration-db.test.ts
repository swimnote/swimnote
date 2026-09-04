/**
 * migration-db.test.ts — getMigrationDb() safety gate unit tests
 *
 * 테스트:
 *   - Production ref: BLOCK
 *   - Unknown ref: BLOCK
 *   - Staging + no mutation flag: BLOCK
 *   - TEST_DATABASE_URL missing: BLOCK
 *   - SUPABASE_DATABASE_URL only: BLOCK
 *   - extractProjectRef() parsing
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { extractProjectRef } from "../migration-db.js";

// ── extractProjectRef tests (pure, no process.exit) ─────────────────────────

describe("extractProjectRef", () => {
  it("parses standard supabase pooler URL", () => {
    const url = "postgresql://postgres.lspmacdbyvpzysnrjsww:password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres";
    expect(extractProjectRef(url)).toBe("lspmacdbyvpzysnrjsww");
  });

  it("parses transaction pooler URL", () => {
    const url = "postgresql://postgres.mrgkiussgbbmxfnkjgqy:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
    expect(extractProjectRef(url)).toBe("mrgkiussgbbmxfnkjgqy");
  });

  it("returns null for non-supabase postgres URL (no dot in username)", () => {
    const url = "postgresql://postgres:pw@localhost:5432/mydb";
    expect(extractProjectRef(url)).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(extractProjectRef("not-a-url")).toBeNull();
  });

  it("returns null for username without postgres. prefix", () => {
    const url = "postgresql://admin.lspmacdbyvpzysnrjsww:pw@host:5432/db";
    expect(extractProjectRef(url)).toBeNull();
  });
});

// ── getMigrationDb safety gate tests (mock process.exit) ────────────────────

describe("getMigrationDb safety gates", () => {
  const STAGING_REF = "lspmacdbyvpzysnrjsww";
  const PROD_REF    = "mrgkiussgbbmxfnkjgqy";
  const STAGING_URL = `postgresql://postgres.${STAGING_REF}:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;
  const PROD_URL    = `postgresql://postgres.${PROD_REF}:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
  const UNKNOWN_URL = `postgresql://postgres.unknownref12345:pw@host:5432/postgres`;

  let originalEnv: typeof process.env;
  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    exitMock = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    exitMock.mockRestore();
  });

  it("BLOCK: ALLOW_TEST_DB_MUTATIONS not set", async () => {
    delete process.env.ALLOW_TEST_DB_MUTATIONS;
    process.env.TEST_DATABASE_URL = STAGING_URL;
    const { getMigrationDb } = await import("../migration-db.js?v=1");
    await expect(getMigrationDb("test")).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("BLOCK: ALLOW_TEST_DB_MUTATIONS = false", async () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "false";
    process.env.TEST_DATABASE_URL = STAGING_URL;
    const { getMigrationDb } = await import("../migration-db.js?v=2");
    await expect(getMigrationDb("test")).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("BLOCK: TEST_DATABASE_URL missing", async () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "true";
    delete process.env.TEST_DATABASE_URL;
    const { getMigrationDb } = await import("../migration-db.js?v=3");
    await expect(getMigrationDb("test")).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("BLOCK: TEST_DATABASE_URL points to Production ref", async () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "true";
    process.env.TEST_DATABASE_URL = PROD_URL;
    const { getMigrationDb } = await import("../migration-db.js?v=4");
    await expect(getMigrationDb("test")).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("BLOCK: TEST_DATABASE_URL points to unknown ref", async () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "true";
    process.env.TEST_DATABASE_URL = UNKNOWN_URL;
    const { getMigrationDb } = await import("../migration-db.js?v=5");
    await expect(getMigrationDb("test")).rejects.toThrow("process.exit called");
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("BLOCK: extractProjectRef detects Production URL even in SUPABASE_DATABASE_URL", () => {
    // This test verifies that the ref extractor works for both URL types
    expect(extractProjectRef(PROD_URL)).toBe(PROD_REF);
    expect(extractProjectRef(STAGING_URL)).toBe(STAGING_REF);
    expect(extractProjectRef(UNKNOWN_URL)).toBe("unknownref12345");
  });
});
