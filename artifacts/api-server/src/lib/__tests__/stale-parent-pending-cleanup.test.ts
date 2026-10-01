import { describe, expect, it, vi } from "vitest";

const { poolConnect } = vi.hoisted(() => ({ poolConnect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect: poolConnect } }));

import {
  assertCleanupApplyDisabled,
  eligibleExistingStudents,
} from "../../scripts/cleanup-stale-parent-pending.js";

const pending = {
  id: "pending",
  parent_id: "parent",
  pool_id: "pool",
  status: "pending",
  created_at: "2026-09-01T00:00:00Z",
  matched_student_id: "student",
};
const parent = {
  id: "parent",
  swimming_pool_id: "pool",
  is_active: true,
  withdrawal_requested_at: null,
};
const relation = {
  id: "relation",
  parent_id: "parent",
  student_id: "student",
  swimming_pool_id: "pool",
  status: "approved",
  student: {
    id: "student",
    swimming_pool_id: "pool",
    status: "active",
    deleted_at: null,
    withdrawn_at: null,
  },
};

describe("read-only stale parent pending cleanup guard", () => {
  it("accepts only a direct explicit-ID, approved, same-parent/same-pool live relation", () => {
    expect(eligibleExistingStudents(pending, parent, [relation])).toEqual(["student"]);
  });

  it("rejects missing or mismatched explicit stored student IDs", () => {
    expect(eligibleExistingStudents({ ...pending, matched_student_id: null }, parent, [relation])).toEqual([]);
    expect(eligibleExistingStudents({ ...pending, matched_student_id: "other" }, parent, [relation])).toEqual([]);
    expect(eligibleExistingStudents(pending, parent, [{ ...relation, student_id: "other" }])).toEqual([]);
    expect(eligibleExistingStudents(pending, parent, [{ ...relation, student: { ...relation.student, id: "other" } }])).toEqual([]);
  });

  it.each(["parent_id", "swimming_pool_id"])("rejects inconsistent relation %s", field => {
    expect(eligibleExistingStudents(pending, parent, [{ ...relation, [field]: "other" }])).toEqual([]);
  });

  it("rejects cross-pool, unapproved, deleted, withdrawn, and ineligible students", () => {
    expect(eligibleExistingStudents(pending, parent, [{ ...relation, student: { ...relation.student, swimming_pool_id: "other" } }])).toEqual([]);
    expect(eligibleExistingStudents(pending, parent, [{ ...relation, status: "pending" }])).toEqual([]);
    for (const field of ["deleted_at", "withdrawn_at"]) {
      expect(eligibleExistingStudents(pending, parent, [{
        ...relation, student: { ...relation.student, [field]: "2026-09-01" },
      }])).toEqual([]);
    }
    for (const status of ["deleted", "withdrawn", "archived", "unregistered", "pending_approval"]) {
      expect(eligibleExistingStudents(pending, parent, [{
        ...relation, student: { ...relation.student, status },
      }])).toEqual([]);
    }
  });

  it("rejects too-new pending rows and inactive, withdrawing, or cross-pool parent accounts", () => {
    expect(eligibleExistingStudents({ ...pending, created_at: "2026-10-01T10:00:00Z" }, parent, [relation])).toEqual([]);
    expect(eligibleExistingStudents(pending, undefined, [relation])).toEqual([]);
    for (const account of [
      { ...parent, is_active: false },
      { ...parent, withdrawal_requested_at: "2026-09-01" },
      { ...parent, swimming_pool_id: "other" },
    ]) {
      expect(eligibleExistingStudents(pending, account, [relation])).toEqual([]);
    }
  });

  it("permanently disables apply before opening a database connection", () => {
    expect(assertCleanupApplyDisabled).toThrow("STALE_PENDING_CLEANUP_APPLY_DISABLED");
    expect(poolConnect).not.toHaveBeenCalled();
  });
});