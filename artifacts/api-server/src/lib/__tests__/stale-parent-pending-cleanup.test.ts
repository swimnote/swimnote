import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { eligibleExistingStudents, originalAllowlistIsTrusted, otaReceiptsMatch, productionChannelMapsToUpdates } from "../../scripts/cleanup-stale-parent-pending.js";

const p = { id: "pending", parent_id: "parent", pool_id: "pool", status: "pending",
  created_at: "2026-09-01T00:00:00Z", parent_phone_normalized: "01012345678", matched_student_id: null };
const a = { id: "parent", swimming_pool_id: "pool", phone: "010-1234-5678",
  is_active: true, withdrawal_requested_at: null };
const relation = { id: "relation", parent_id: "parent", student_id: "student",
  swimming_pool_id: "pool", status: "approved", student: { swimming_pool_id: "pool",
    status: "active", deleted_at: null, withdrawn_at: null, parent_phone: "01012345678" } };
describe("authorized stale pending metadata-only repair", () => {
  it("M: accepts existing normal approved relation without minting ownership or new approval", () => {
    expect(eligibleExistingStudents(p, a, [relation])).toEqual(["student"]);
  });
  it.each(["parent_id", "swimming_pool_id"])("rejects inconsistent relation %s", field => {
    expect(eligibleExistingStudents(p, a, [{ ...relation, [field]: "other" }])).toEqual([]);
  });
  it("rejects student cross-pool", () => {
    expect(eligibleExistingStudents(p, a, [{ ...relation, student: { ...relation.student, swimming_pool_id: "other" } }])).toEqual([]);
  });
  it.each(["deleted_at", "withdrawn_at"])("excludes even active students with %s", field => {
    expect(eligibleExistingStudents(p, a, [{ ...relation, student: { ...relation.student, [field]: "2026-09-01" } }])).toEqual([]);
  });
  it.each(["deleted", "withdrawn", "archived", "unregistered", "pending_approval"])("excludes %s", status => {
    expect(eligibleExistingStudents(p, a, [{ ...relation, student: { ...relation.student, status } }])).toEqual([]);
  });
  it("does not remove withdrawn approved sibling; chooses existing healthy sibling", () => {
    const withdrawn = { ...relation, id: "old", student_id: "old", student: { ...relation.student, withdrawn_at: "2026-09-01" } };
    const before = JSON.stringify([withdrawn, relation]);
    expect(eligibleExistingStudents(p, a, [withdrawn, relation])).toEqual(["student"]);
    expect(JSON.stringify([withdrawn, relation])).toBe(before);
  });
  it("skips a newly created pending rather than expanding approved allowlist", () => {
    expect(eligibleExistingStudents({ ...p, created_at: "2026-10-01T10:00:00Z" }, a, [relation])).toEqual([]);
  });
  it("skips nonexistent, inactive, withdrawing, and changed-pool parents", () => {
    expect(eligibleExistingStudents(p, undefined, [relation])).toEqual([]);
    for (const parent of [{ ...a, is_active: false }, { ...a, withdrawal_requested_at: "2026-09-01" }, { ...a, swimming_pool_id: "other" }])
      expect(eligibleExistingStudents(p, parent, [relation])).toEqual([]);
  });
  it("never considers missing or unapproved relations sufficient", () => {
    expect(eligibleExistingStudents(p, a, [])).toEqual([]);
    expect(eligibleExistingStudents(p, a, [{ ...relation, status: "pending" }])).toEqual([]);
  });
  it("skips a stale or mismatched phone and wrong stored student", () => {
    expect(eligibleExistingStudents({ ...p, parent_phone_normalized: "01000000000" }, a, [relation])).toEqual([]);
    expect(eligibleExistingStudents(p, a, [{ ...relation, student: { ...relation.student, parent_phone: "01000000000" } }])).toEqual([]);
    expect(eligibleExistingStudents({ ...p, matched_student_id: "other" }, a, [relation])).toEqual([]);
  });
  it("rejects a substituted nine-row allowlist instead of trusting count", () => {
    expect(originalAllowlistIsTrusted({ source: "authorized-existing-approved-stale-pending", targets: Array(9).fill({ id: "substituted" }) })).toBe(false);
  });
  it("requires actual remote platform, channel, runtime and reviewed source receipts", () => {
    const sha = "a".repeat(40);
    const updates = ["ios", "android"].map(platform => ({ id: platform, platform, group: "group",
      branch: { name: "production-v2" }, runtimeVersion: "2.2.0", gitCommitHash: sha }));
    expect(otaReceiptsMatch(updates, sha, "ios", "android", "group")).toBe(true);
    expect(otaReceiptsMatch([updates[0]], sha, "ios", "android", "group")).toBe(false);
    for (const change of [{ runtimeVersion: "2.1.0" }, { branch: { name: "production" } },
      { gitCommitHash: "b".repeat(40) }, { group: "other" }]) {
      expect(otaReceiptsMatch([updates[0], { ...updates[1], ...change }], sha, "ios", "android", "group")).toBe(false);
    }
    expect(otaReceiptsMatch([], sha, "ios", "android", "group")).toBe(false);
  });
  it("requires an active production channel routing both updates to the verified branch", () => {
    const branch = { id: "production-branch", name: "production-v2" };
    const updates = [{ platform: "ios", branch }, { platform: "android", branch }];
    const channel = { name: "production-v2", isPaused: false, updateBranches: [branch],
      branchMapping: JSON.stringify({ version: 0, data: [{ branchId: branch.id, branchMappingLogic: "true" }] }) };
    expect(productionChannelMapsToUpdates({ currentPage: channel }, updates)).toBe(true);
    expect(productionChannelMapsToUpdates({ ...channel, isPaused: true }, updates)).toBe(false);
    expect(productionChannelMapsToUpdates({ ...channel, name: "preview" }, updates)).toBe(false);
    expect(productionChannelMapsToUpdates(channel, [updates[0], { branch: { ...branch, id: "unmapped" } }])).toBe(false);
    expect(productionChannelMapsToUpdates({ ...channel, branchMapping: "invalid" }, updates)).toBe(false);
    expect(productionChannelMapsToUpdates({ ...channel, branchMapping: JSON.stringify({
      version: 0, data: [{ branchId: branch.id, branchMappingLogic: { clientKey: { lt: 50 } } }],
    }) }, updates)).toBe(false);
  });
});