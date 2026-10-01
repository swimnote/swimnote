import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";

const { dbExecute, txExecute, isPhoneVerified } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  txExecute: vi.fn(),
  isPhoneVerified: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: (...args: any[]) => dbExecute(...args),
    transaction: (callback: (tx: any) => Promise<any>) =>
      callback({ execute: (...args: any[]) => txExecute(...args) }),
  },
}));

vi.mock("../parent-phone-proof.js", () => ({
  isParentPhoneVerified: (...args: any[]) => isPhoneVerified(...args),
}));

import { linkVerifiedParentToRegisteredChildren } from "../auto-link-v2.js";

const parentId = "parent_test_only";
const poolId = "pool_test_only";
const phone = "01011112222";

function queueLinking({
  account = { id: parentId, swimming_pool_id: poolId, phone },
  students = [],
  existingLinks = [],
  insertRows = [{ student_id: "student_default" }],
}: {
  account?: Record<string, any> | null;
  students?: Array<{ id: string; name: string }>;
  existingLinks?: Array<{ student_id: string; status: string }>;
  insertRows?: Array<{ student_id: string }>;
} = {}) {
  txExecute
    .mockResolvedValueOnce({ rows: account ? [account] : [] })
    .mockResolvedValueOnce({ rows: students });
  if (students.length > 0) {
    txExecute.mockResolvedValueOnce({ rows: existingLinks });
    for (const row of insertRows) txExecute.mockResolvedValueOnce({ rows: [row] });
    txExecute.mockResolvedValueOnce({ rows: [] }); // same-pool pending cleanup
  }
}

beforeEach(() => {
  dbExecute.mockReset();
  txExecute.mockReset();
  isPhoneVerified.mockReset().mockResolvedValue(true);
});

describe("verified V2 phone-only relation matching", () => {
  it("CASE A/B/F: exact, misspelled, and unrelated child names do not affect a verified phone match", async () => {
    // The V2 relation linker intentionally takes no child-name matching key.
    queueLinking({
      students: [{ id: "student_real_name", name: "박하윤" }],
      insertRows: [{ student_id: "student_real_name" }],
    });

    const result = await linkVerifiedParentToRegisteredChildren(parentId, poolId, phone);

    expect(result).toEqual({
      linkedCount: 1,
      newCount: 1,
      studentIds: ["student_real_name"],
      students: [{ id: "student_real_name", name: "박하윤" }],
    });
    expect(isPhoneVerified).toHaveBeenCalledWith(parentId, phone);
  });

  it("CASE C/D: links every same-pool sibling regardless of a single submitted child name", async () => {
    queueLinking({
      students: [
        { id: "student_hayun", name: "박하윤" },
        { id: "student_yuha", name: "박유하" },
      ],
      insertRows: [{ student_id: "student_hayun" }, { student_id: "student_yuha" }],
    });

    const result = await linkVerifiedParentToRegisteredChildren(parentId, poolId, phone);

    expect(result.students).toEqual([
      { id: "student_hayun", name: "박하윤" },
      { id: "student_yuha", name: "박유하" },
    ]);
    expect(result.linkedCount).toBe(2);
    expect(result.newCount).toBe(2);
  });

  it("CASE H: preserves approved rows untouched and adds only the unlinked sibling", async () => {
    queueLinking({
      students: [
        { id: "student_already_approved", name: "박하윤" },
        { id: "student_new_sibling", name: "박유하" },
      ],
      existingLinks: [{ student_id: "student_already_approved", status: "approved" }],
      insertRows: [{ student_id: "student_new_sibling" }],
    });

    const result = await linkVerifiedParentToRegisteredChildren(parentId, poolId, phone);

    expect(result.linkedCount).toBe(2);
    expect(result.newCount).toBe(1);
    expect(txExecute).toHaveBeenCalledTimes(5); // account, candidates, existing links, insert, pending cleanup
    const insertSql = new PgDialect().sqlToQuery(txExecute.mock.calls[3][0]);
    expect(insertSql.sql).toContain("ON CONFLICT (parent_id, student_id)");
    expect(insertSql.sql).toContain("WHERE parent_students.status <> 'approved'");
    const cleanupSql = new PgDialect().sqlToQuery(txExecute.mock.calls[4][0]);
    expect(cleanupSql.sql).toContain("pool_id = $3");
    expect(cleanupSql.sql).not.toContain("child_name_normalized");
  });

  it("CASE E: refuses a verified phone that is no longer bound to the parent's current account phone", async () => {
    queueLinking({
      account: { id: parentId, swimming_pool_id: poolId, phone: "01099998888" },
    });

    const result = await linkVerifiedParentToRegisteredChildren(parentId, poolId, phone);

    expect(result.linkedCount).toBe(0);
    expect(txExecute).toHaveBeenCalledTimes(1);
  });

  it("CASE G: an unverified phone cannot enter the transaction or create relations", async () => {
    isPhoneVerified.mockResolvedValue(false);

    const result = await linkVerifiedParentToRegisteredChildren(parentId, poolId, phone);

    expect(result.linkedCount).toBe(0);
    expect(txExecute).not.toHaveBeenCalled();
  });

  it("CASE I/J: SQL scopes matches to the account pool, all four phone slots, and eligible active records", async () => {
    queueLinking({ students: [] });

    const result = await linkVerifiedParentToRegisteredChildren(parentId, poolId, phone);
    expect(result.linkedCount).toBe(0);
    const candidateSql = new PgDialect().sqlToQuery(txExecute.mock.calls[1][0]);
    expect(candidateSql.sql).toContain("swimming_pool_id = $1");
    expect(candidateSql.sql).toContain("parent_phone2");
    expect(candidateSql.sql).toContain("parent_phone3");
    expect(candidateSql.sql).toContain("parent_phone4");
    expect(candidateSql.sql).toContain("status IN ('active', 'pending_parent_link')");
    expect(candidateSql.sql).toContain("'unregistered'");
    expect(candidateSql.sql).toContain("'pending_approval'");
    expect(candidateSql.sql).toContain("deleted_at IS NULL");
    expect(candidateSql.sql).toContain("withdrawn_at IS NULL");
    expect(txExecute).toHaveBeenCalledTimes(2);
  });

  it("compiles relation lookup arrays as individual PostgreSQL IN parameters", async () => {
    queueLinking({
      students: [
        { id: "student_one", name: "박하윤" },
        { id: "student_two", name: "박유하" },
      ],
      insertRows: [{ student_id: "student_one" }, { student_id: "student_two" }],
    });

    await linkVerifiedParentToRegisteredChildren(parentId, poolId, phone);

    const relationLookup = new PgDialect().sqlToQuery(txExecute.mock.calls[2][0]);
    expect(relationLookup.sql).toContain("parent_id = $1");
    expect(relationLookup.sql).toContain("student_id IN ($2, $3)");
    expect(relationLookup.sql).not.toContain("ANY(");
    expect(relationLookup.params).toEqual([parentId, "student_one", "student_two"]);
  });

  it("propagates a relation-write error so the surrounding transaction rolls back", async () => {
    txExecute
      .mockResolvedValueOnce({ rows: [{ id: parentId, swimming_pool_id: poolId, phone }] })
      .mockResolvedValueOnce({ rows: [{ id: "student_one", name: "박하윤" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("relation write failed"));

    await expect(
      linkVerifiedParentToRegisteredChildren(parentId, poolId, phone)
    ).rejects.toThrow("relation write failed");
    expect(txExecute).toHaveBeenCalledTimes(4);
  });

  it("link-child only uses durable verification and keeps every unsuccessful request in pending", () => {
    const parentSource = fs.readFileSync(
      path.resolve(__dirname, "../../routes/parent.ts"),
      "utf8"
    );
    const routeStart = parentSource.indexOf('router.post("/link-child"');
    const routeEnd = parentSource.indexOf("// ═", routeStart);
    const route = parentSource.slice(routeStart, routeEnd);

    expect(route).toContain("paCheck?.swimming_pool_id === swimming_pool_id");
    expect(route).toContain("isParentPhoneVerified(parentId, parentPhone)");
    expect(route).toContain("linkVerifiedParentToRegisteredChildren");
    expect(route).toContain('status: "pending"');
    expect(route).not.toContain('status: "not_found"');
    expect(route).not.toContain("tryAutoLinkV2");
  });
});