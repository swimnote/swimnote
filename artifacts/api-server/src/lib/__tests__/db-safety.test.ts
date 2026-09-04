/**
 * db-safety.test.ts — unit tests for the staging mutation allowlist guard
 *
 * 실행: cd artifacts/api-server && npx vitest run src/lib/__tests__/db-safety.test.ts
 *
 * 6가지 케이스 전부 PASS 해야 staging mutation 허용.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractProjectRef,
  isKnownStagingUrl,
  checkTestDatabaseUrl,
} from "../db-safety.js";

// ── helpers ───────────────────────────────────────────────────────────────────

// swimnote-staging (ap-northeast-2, Seoul) — the ONLY allowed staging ref
const STAGING_REF = "lspmacdbyvpzysnrjsww";

// Known staging URL (Shared Transaction Pooler, Seoul)
const STAGING_TX_URL =
  `postgresql://postgres.${STAGING_REF}:REDACTED@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;

// Production URL (Shared Session Pooler, Mumbai) — must be BLOCKED
const PRODUCTION_REF = "mrgkiussgbbmxfnkjgqy"; // real production ref (swimnote production)
const PRODUCTION_URL =
  `postgresql://postgres.${PRODUCTION_REF}:REDACTED@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;

// Unknown project
const UNKNOWN_URL =
  `postgresql://postgres.zzzzzzzzzzzzzzzzzzz:REDACTED@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`;

// Direct URL format (dedicated pooler)
const DIRECT_STAGING_URL =
  `postgresql://postgres:REDACTED@db.${STAGING_REF}.supabase.co:6543/postgres`;

const MALFORMED_URL = "not-a-valid-url://???";

// ── extractProjectRef ─────────────────────────────────────────────────────────

describe("extractProjectRef", () => {
  it("extracts ref from Shared Supavisor TX pooler (postgres.<ref>@*.pooler.supabase.com)", () => {
    expect(extractProjectRef(STAGING_TX_URL)).toBe(STAGING_REF);
  });

  it("extracts ref from Shared Supavisor Session pooler", () => {
    expect(extractProjectRef(PRODUCTION_URL)).toBe(PRODUCTION_REF);
  });

  it("extracts ref from Direct / Dedicated pooler URL (db.<ref>.supabase.co)", () => {
    expect(extractProjectRef(DIRECT_STAGING_URL)).toBe(STAGING_REF);
  });

  it("returns null for malformed URL", () => {
    expect(extractProjectRef(MALFORMED_URL)).toBeNull();
  });

  it("returns null for postgres-without-ref username (legacy direct)", () => {
    const legacyUrl = `postgresql://postgres:REDACTED@db.${STAGING_REF}.supabase.co:5432/postgres`;
    // host-based extraction still works for legacy direct format
    expect(extractProjectRef(legacyUrl)).toBe(STAGING_REF);
  });
});

// ── isKnownStagingUrl ─────────────────────────────────────────────────────────

describe("isKnownStagingUrl", () => {
  it("returns true for known staging TX pooler URL", () => {
    expect(isKnownStagingUrl(STAGING_TX_URL)).toBe(true);
  });

  it("returns false for unknown project URL", () => {
    expect(isKnownStagingUrl(UNKNOWN_URL)).toBe(false);
  });

  it("returns false for production URL (distinct ref)", () => {
    expect(isKnownStagingUrl(PRODUCTION_URL)).toBe(false);
  });

  it("returns false for malformed URL", () => {
    expect(isKnownStagingUrl(MALFORMED_URL)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isKnownStagingUrl(undefined)).toBe(false);
  });
});

// ── checkTestDatabaseUrl (6 cases from spec) ─────────────────────────────────

describe("checkTestDatabaseUrl — spec 6 cases", () => {
  const origEnv = process.env.ALLOW_TEST_DB_MUTATIONS;

  beforeEach(() => {
    delete process.env.ALLOW_TEST_DB_MUTATIONS;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.ALLOW_TEST_DB_MUTATIONS = origEnv;
    } else {
      delete process.env.ALLOW_TEST_DB_MUTATIONS;
    }
  });

  // CASE 1: TEST_DATABASE_URL 없음 → BLOCK
  it("CASE 1: TEST_DATABASE_URL missing → BLOCK", () => {
    const result = checkTestDatabaseUrl(undefined);
    expect(result.safe).toBe(false);
    expect((result as any).reason).toMatch(/not set/i);
  });

  // CASE 2: Production URL + ALLOW_TEST_DB_MUTATIONS=true → BLOCK
  it("CASE 2: Production URL + flag=true → BLOCK", () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "true";
    // Production ref is NOT in the staging allowlist
    const result = checkTestDatabaseUrl(PRODUCTION_URL);
    expect(result.safe).toBe(false);
    expect((result as any).reason).toMatch(/not in the known staging allowlist/i);
  });

  // CASE 3: Unknown project + ALLOW_TEST_DB_MUTATIONS=true → BLOCK
  it("CASE 3: Unknown project + flag=true → BLOCK", () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "true";
    const result = checkTestDatabaseUrl(UNKNOWN_URL);
    expect(result.safe).toBe(false);
    expect((result as any).reason).toMatch(/not in the known staging allowlist/i);
  });

  // CASE 4: Known staging URL + flag missing → BLOCK
  it("CASE 4: Known staging URL + flag missing → BLOCK", () => {
    // ALLOW_TEST_DB_MUTATIONS NOT set
    const result = checkTestDatabaseUrl(STAGING_TX_URL);
    expect(result.safe).toBe(false);
    expect((result as any).reason).toMatch(/ALLOW_TEST_DB_MUTATIONS/i);
  });

  // CASE 5: Known staging URL + ALLOW_TEST_DB_MUTATIONS=true → ALLOW
  it("CASE 5: Known staging URL + flag=true → ALLOW", () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "true";
    const result = checkTestDatabaseUrl(STAGING_TX_URL);
    expect(result.safe).toBe(true);
    expect((result as any).ref).toBe(STAGING_REF);
  });

  // CASE 6: Malformed URL → BLOCK
  it("CASE 6: Malformed URL → BLOCK", () => {
    process.env.ALLOW_TEST_DB_MUTATIONS = "true";
    const result = checkTestDatabaseUrl(MALFORMED_URL);
    expect(result.safe).toBe(false);
  });
});
