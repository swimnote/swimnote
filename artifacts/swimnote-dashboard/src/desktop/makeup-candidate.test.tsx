import { expect, it, vi } from "vitest";
import { checkOfficeMakeupScope, type MakeupScopeReads } from "../../../../docs/office/candidates/makeup-scope";
const reads = (): MakeupScopeReads => ({ makeupAndStudentInPool: vi.fn().mockResolvedValue(true), classAndTeacherInPool: vi.fn().mockResolvedValue(true), teacherInPool: vi.fn().mockResolvedValue(true) });
it("admits only a pool admin's own makeup/student and target class/teacher", async () => {
  const db = reads();
  expect(await checkOfficeMakeupScope({ role: "pool_admin", poolId: "p1", makeupId: "m1", classId: "c1", teacherId: "t1", allowExpired: true }, db)).toEqual({ ok: true });
  expect(db.makeupAndStudentInPool).toHaveBeenCalledWith("m1", "p1");
  expect(db.classAndTeacherInPool).toHaveBeenCalledWith("c1", "p1");
  expect(db.teacherInPool).toHaveBeenCalledWith("t1", "p1");
});
it.each(["teacher", "parent_account", "sub_admin", "unknown"])("does not widen %s to an admin makeup role", async role => {
  const db = reads();
  expect((await checkOfficeMakeupScope({ role, poolId: "p1", makeupId: "m1" }, db)).ok).toBe(false);
  expect(db.makeupAndStudentInPool).not.toHaveBeenCalled();
});
it("preserves the existing super-admin branch without invoking new center lookups", async () => {
  const db = reads();
  expect(await checkOfficeMakeupScope({ role: "super_admin", poolId: null, makeupId: "m1" }, db)).toEqual({ ok: true });
  expect(db.makeupAndStudentInPool).not.toHaveBeenCalled();
});
it.each(["makeupAndStudentInPool", "classAndTeacherInPool", "teacherInPool"] as const)("rejects a foreign/missing %s", async key => {
  const db = reads(); vi.mocked(db[key]).mockResolvedValue(false);
  expect((await checkOfficeMakeupScope({ role: "pool_admin", poolId: "p1", makeupId: "m1", classId: "c1", teacherId: "t1" }, db)).ok).toBe(false);
});
it("rejects missing pool, injected identifiers and non-boolean expiry consent before querying", async () => {
  for (const input of [{ poolId: null }, { makeupId: "m1';DROP TABLE x" }, { allowExpired: "true" }]) {
    const db = reads();
    expect((await checkOfficeMakeupScope({ role: "pool_admin", poolId: "p1", makeupId: "m1", ...input }, db)).ok).toBe(false);
    expect(db.makeupAndStudentInPool).not.toHaveBeenCalled();
  }
});
