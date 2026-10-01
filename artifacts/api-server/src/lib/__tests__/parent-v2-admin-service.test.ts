import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { dbExecute, transaction } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: (...args: any[]) => dbExecute(...args),
    transaction: (callback: (tx: any) => Promise<any>) => transaction(callback),
  },
}));

import {
  confirmParentV2Pending,
  getParentV2ApprovalInfo,
  requestParentV2AdminHelp,
} from "../parent-v2-admin-service.js";

const pendingId = "pending_test";
const parentId = "parent_test";
const poolId = "pool_test";
const adminId = "admin_test";
const studentId = "student_target";
const phone = "01011112222";
const student = { id: studentId, swimming_pool_id: poolId, name: "박하윤", status: "active",
  deleted_at: null, withdrawn_at: null };

type PendingMetaSnapshot = { status: string; matched_student_id: string | null };

function setTransactionQueue(
  responses: Array<any | ((query: any, index: number) => any)>,
  initialPendingMeta: PendingMetaSnapshot = { status: "pending", matched_student_id: null },
) {
  const queries: any[] = [];
  const state = {
    committed: false,
    rolledBack: false,
    events: [] as string[],
    committedRelations: [] as any[],
    committedPendingMeta: { ...initialPendingMeta },
  };
  transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
    let cursor = 0;
    const transactionBuffer = {
      relations: [] as any[],
      pendingMeta: { ...state.committedPendingMeta },
    };
    const tx = {
      execute: vi.fn(async (query: any) => {
        queries.push(query);
        const response = responses[cursor];
        const index = cursor++;
        if (typeof response === "function") return response(query, index);
        if (response instanceof Error) throw response;
        const result = response ?? { rows: [] };
        const text = queryText(query);
        if (text.includes("INSERT INTO parent_students") && result.rows?.length) {
          transactionBuffer.relations.push(...result.rows);
        }
        if (text.includes("UPDATE parent_v2_pending") && result.rows?.length) {
          const params = new PgDialect().sqlToQuery(query).params;
          transactionBuffer.pendingMeta = {
            status: "matched",
            matched_student_id: String(params[0]),
          };
        }
        return result;
      }),
    };
    try {
      const result = await callback(tx);
      state.committed = true;
      state.events.push("COMMIT");
      state.committedRelations.push(...transactionBuffer.relations);
      state.committedPendingMeta = transactionBuffer.pendingMeta;
      return result;
    } catch (error) {
      state.rolledBack = true;
      state.events.push("ROLLBACK");
      throw error;
    }
  });
  return { queries, state };
}

function queryText(query: any): string {
  return new PgDialect().sqlToQuery(query).sql;
}

function validPrefix(
  pendingStatus = "pending",
  matchedStudentId: string | null = null,
  selectedStudent: typeof student = student,
) {
  const pending = { id: pendingId, parent_id: parentId, pool_id: poolId,
    status: pendingStatus, matched_student_id: matchedStudentId };
  return [
    { rows: [{ swimming_pool_id: poolId, role: "pool_admin", roles: ["pool_admin"], is_activated: true }] },
    { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId }] },
    { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
    { rows: [pending] },
    { rows: [selectedStudent] },
  ];
}

beforeEach(() => {
  dbExecute.mockReset();
  transaction.mockReset();
});

describe("explicit parent V2 admin confirmation", () => {
  it("links only the explicitly selected eligible student and never edits students or links siblings", async () => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix("pending", "stored_pointer_not_selected"),
      { rows: [] },
      { rows: [{ student_id: studentId }] },
      { rows: [{ id: pendingId }] },
    ]);

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({
      success: true,
      linkedCount: 1,
      newRelationCount: 1,
      relationCreated: true,
      students: [{ id: studentId, name: "박하윤" }],
    });
    expect(state).toMatchObject({ committed: true, rolledBack: false, events: ["COMMIT"] });
    expect(queryText(queries[0])).toContain("FROM users");
    expect(queryText(queries[1])).toContain("pool_id =");
    expect(queryText(queries[2])).toContain("parent_accounts");
    expect(queryText(queries[3])).toContain("FOR UPDATE");
    expect(queryText(queries[4])).toContain("s.swimming_pool_id =");
    expect(queryText(queries[4])).toContain("status IN ('active', 'pending_parent_link')");
    expect(queryText(queries[5])).toContain("student_id =");
    expect(queryText(queries[6])).toContain("INSERT INTO parent_students");
    expect(queryText(queries[6])).toContain("WHERE parent_students.status <> 'approved'");
    expect(queryText(queries[7])).toContain("UPDATE parent_v2_pending");
    const params = queries.map(query => new PgDialect().sqlToQuery(query).params);
    expect(params[0]).toContain(adminId);
    expect(params[1]).toEqual([pendingId, poolId]);
    expect(params[2]).toEqual([parentId]);
    expect(params[3]).toEqual([pendingId, poolId]);
    expect(params[4]).toEqual([studentId, poolId]);
    expect(params[5]).toEqual([parentId, studentId]);
    expect(params[6]).toEqual(expect.arrayContaining([parentId, studentId, poolId, adminId]));
    expect(params[7]).toEqual([studentId, pendingId, parentId, poolId]);
    expect("stored_pointer_not_selected").not.toBe(studentId);
    expect(queries.map(queryText).join("\n")).not.toContain("UPDATE students");
    expect(queries.map(queryText).join("\n")).not.toContain("phone_verifications");
    expect(queries.map(queryText).join("\n")).not.toContain("parent_phone");
  });

  it("rolls back a staged relation when the pending metadata write throws", async () => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix(),
      { rows: [] },
      { rows: [{ student_id: studentId }] },
      new Error("pending metadata write failed"),
    ]);

    await expect(confirmParentV2Pending(pendingId, poolId, adminId, studentId))
      .rejects.toThrow("pending metadata write failed");

    expect(state.events).toEqual(["ROLLBACK"]);
    expect(state.committed).toBe(false);
    expect(state.committedRelations).toEqual([]);
    expect(state.committedPendingMeta).toEqual({ status: "pending", matched_student_id: null });
    expect(queryText(queries[6])).toContain("INSERT INTO parent_students");
    expect(queryText(queries[7])).toContain("UPDATE parent_v2_pending");
  });

  it("rolls back a staged relation when pending metadata returns zero rows", async () => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix(),
      { rows: [] },
      { rows: [{ student_id: studentId }] },
      { rows: [] },
    ]);

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: false, code: "pending_state_changed" });
    expect(state.events).toEqual(["ROLLBACK"]);
    expect(state.committed).toBe(false);
    expect(state.committedRelations).toEqual([]);
    expect(state.committedPendingMeta).toEqual({ status: "pending", matched_student_id: null });
    expect(queryText(queries[6])).toContain("INSERT INTO parent_students");
    expect(queryText(queries[7])).toContain("UPDATE parent_v2_pending");
  });

  it("keeps an existing approved same-pool relation untouched and marks only this pending request", async () => {
    const existing = {
      student_id: studentId,
      swimming_pool_id: poolId,
      status: "approved",
      approved_at: "original-approved-at",
      approved_by: "original-approver",
    };
    const studentRecord = {
      ...student,
      name: "Existing name",
      parent_name: "Existing parent",
      parent_phone: "010-9999-8888",
      status: "active",
      parent_user_id: "existing-parent-pointer",
    };
    const studentSnapshot = { ...studentRecord };
    const relationSnapshot = { ...existing };
    const { queries, state } = setTransactionQueue([
      ...validPrefix("pending", null, studentRecord),
      { rows: [existing] },
      { rows: [{ id: pendingId }] },
    ]);

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: true, newRelationCount: 0, relationCreated: false });
    expect(state.committed).toBe(true);
    expect(queries).toHaveLength(7);
    expect(queries.some(query => queryText(query).includes("INSERT INTO parent_students"))).toBe(false);
    expect(queryText(queries[6])).toContain("SET status = 'matched'");
    expect(queries.map(queryText).join("\n")).not.toContain("UPDATE students");
    expect(queries.map(queryText).join("\n")).not.toContain("UPDATE parent_students");
    expect(studentRecord).toEqual(studentSnapshot);
    expect(existing).toEqual(relationSnapshot);
  });

  it("reactivates one existing nonapproved relation without changing any student data", async () => {
    const pendingRelation = {
      student_id: studentId,
      swimming_pool_id: poolId,
      status: "pending",
    };
    const { queries, state } = setTransactionQueue([
      ...validPrefix(),
      { rows: [pendingRelation] },
      { rows: [{ student_id: studentId }] },
      { rows: [{ id: pendingId }] },
    ]);

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: true, relationCreated: true, newRelationCount: 1 });
    expect(state.committed).toBe(true);
    expect(queryText(queries[6])).toContain("INSERT INTO parent_students");
    expect(queryText(queries[6])).toContain("status = 'approved'");
    expect(queryText(queries[6])).toContain("approved_by = EXCLUDED.approved_by");
    expect(new PgDialect().sqlToQuery(queries[6]).params)
      .toEqual(expect.arrayContaining([parentId, studentId, poolId, adminId]));
    expect(queries.map(queryText).join("\n")).not.toContain("UPDATE students");
  });

  it("allows idempotency only for the exact selected ID and a valid approved same-pool relation", async () => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix("matched", studentId),
      { rows: [{ student_id: studentId, swimming_pool_id: poolId, status: "approved" }] },
    ], { status: "matched", matched_student_id: studentId });

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({
      success: true,
      alreadyMatched: true,
      linkedCount: 1,
      newRelationCount: 0,
      relationCreated: false,
    });
    expect(state.committed).toBe(true);
    expect(state.committedPendingMeta).toEqual({ status: "matched", matched_student_id: studentId });
    expect(queries).toHaveLength(6);
    expect(queries.some(query => queryText(query).includes("INSERT INTO parent_students"))).toBe(false);
    expect(queries.some(query => queryText(query).includes("UPDATE parent_v2_pending"))).toBe(false);
  });

  it.each([
    ["wrong role", { swimming_pool_id: poolId, role: "teacher", roles: ["teacher"], is_activated: true }],
    ["inactive", { swimming_pool_id: poolId, role: "pool_admin", roles: ["pool_admin"], is_activated: false }],
    ["wrong pool", { swimming_pool_id: "other_pool", role: "pool_admin", roles: ["pool_admin"], is_activated: true }],
  ])("rejects a database administrator with %s", async (_case, databaseAdmin) => {
    const { queries, state } = setTransactionQueue([{ rows: [databaseAdmin] }]);
    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: false, code: "admin_pool_mismatch" });
    expect(new PgDialect().sqlToQuery(queries[0]).params).toEqual([adminId]);
    expect(queries).toHaveLength(1);
    expect(state.events).toEqual(["ROLLBACK"]);
    expect(state.committedRelations).toEqual([]);
  });

  it.each([
    ["inactive", { id: parentId, swimming_pool_id: poolId, is_active: false, withdrawal_requested_at: null }],
    ["withdrawing", { id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: "2026-10-01" }],
    ["cross-pool", { id: parentId, swimming_pool_id: "other_pool", is_active: true, withdrawal_requested_at: null }],
  ])("rejects an %s parent account", async (_case, databaseParent) => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix().slice(0, 2),
      { rows: [databaseParent] },
    ]);
    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: false, code: "parent_account_invalid" });
    expect(new PgDialect().sqlToQuery(queries[2]).params).toEqual([parentId]);
    expect(queries).toHaveLength(3);
    expect(state.events).toEqual(["ROLLBACK"]);
    expect(state.committedRelations).toEqual([]);
    expect(state.committedPendingMeta).toEqual({ status: "pending", matched_student_id: null });
  });

  it.each([
    ["cross-pool", "s.swimming_pool_id ="],
    ["deleted", "status IN ('active', 'pending_parent_link')"],
    ["withdrawn", "status IN ('active', 'pending_parent_link')"],
    ["pending_approval", "status IN ('active', 'pending_parent_link')"],
    ["soft-deleted", "deleted_at IS NULL"],
    ["soft-withdrawn", "withdrawn_at IS NULL"],
  ])(
    "does not select a %s student",
    async (_case, requiredPredicate) => {
      const { queries, state } = setTransactionQueue([
        ...validPrefix().slice(0, 4),
        { rows: [] },
      ]);
      const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

      expect(result).toMatchObject({ success: false, code: "student_not_eligible" });
      expect(new PgDialect().sqlToQuery(queries[4]).params).toEqual([studentId, poolId]);
      expect(queryText(queries[4])).toContain(requiredPredicate);
      expect(queryText(queries[4])).toContain("status IN ('active', 'pending_parent_link')");
      expect(queryText(queries[4])).toContain("deleted_at IS NULL");
      expect(queryText(queries[4])).toContain("withdrawn_at IS NULL");
      expect(queries).toHaveLength(5);
      expect(state.events).toEqual(["ROLLBACK"]);
      expect(state.committedRelations).toEqual([]);
    },
  );

  it("rejects rejected pending metadata on the new confirmation path", async () => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix("rejected"),
      { rows: [] },
    ]);
    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: false, code: "pending_not_approvable" });
    expect(state.events).toEqual(["ROLLBACK"]);
    expect(queries.some(query => queryText(query).includes("INSERT INTO parent_students"))).toBe(false);
    expect(queries.some(query => queryText(query).includes("UPDATE parent_v2_pending"))).toBe(false);
  });

  it("rejects a selected relation whose existing pool differs", async () => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix(),
      { rows: [{ student_id: studentId, swimming_pool_id: "other_pool", status: "approved" }] },
    ]);
    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: false, code: "relation_pool_mismatch" });
    expect(state.events).toEqual(["ROLLBACK"]);
    expect(queries.some(query => queryText(query).includes("INSERT INTO parent_students"))).toBe(false);
    expect(queries.some(query => queryText(query).includes("UPDATE parent_v2_pending"))).toBe(false);
  });

  it.each([
    ["missing", "matched", studentId, []],
    ["nonapproved", "matched", studentId, [{ student_id: studentId, swimming_pool_id: poolId, status: "pending" }]],
    ["wrong-pool", "matched", studentId, [{ student_id: studentId, swimming_pool_id: "other_pool", status: "approved" }]],
    ["different student", "matched", "another_student", [{ student_id: studentId, swimming_pool_id: poolId, status: "approved" }]],
  ])("rejects a matched retry with %s relation and performs no writes", async (_case, status, matchedId, relations) => {
    const { queries, state } = setTransactionQueue([
      ...validPrefix(status, matchedId),
      { rows: relations },
    ], { status: "matched", matched_student_id: matchedId });
    const result = await confirmParentV2Pending(pendingId, poolId, adminId, studentId);

    expect(result).toMatchObject({ success: false, code: "pending_not_approvable" });
    expect(state.events).toEqual(["ROLLBACK"]);
    expect(state.committedRelations).toEqual([]);
    expect(state.committedPendingMeta).toEqual({ status: "matched", matched_student_id: matchedId });
    expect(queries.some(query => queryText(query).includes("INSERT INTO parent_students"))).toBe(false);
    expect(queries.some(query => queryText(query).includes("UPDATE parent_v2_pending"))).toBe(false);
  });
});

describe("parent V2 approval-info candidates", () => {
  it.each(["pending", "rejected"])("returns read-only candidate information for %s requests", async status => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{
        id: pendingId,
        parent_id: parentId,
        pool_id: poolId,
        child_name_raw: "원본 자녀 이름",
        parent_phone_normalized: phone,
        pending_reason: "name_mismatch",
        parent_name: "김보호",
        parent_phone: "010-1111-2222",
        parent_pool_id: poolId,
        status,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: "proof" }] })
      .mockResolvedValueOnce({ rows: [{ ...student, parent_name: "보호자", parent_phone: "010-1111-2222",
        parent_phone2: null, parent_phone3: null, parent_phone4: null }] });

    const info = await getParentV2ApprovalInfo(pendingId, poolId);

    expect(info).toMatchObject({
      pending_id: pendingId,
      child_name_raw: "원본 자녀 이름",
      parent_name: "김보호",
      phone_verified: true,
      candidates: [{ id: studentId, name: "박하윤", parent_name: "보호자" }],
      reason: "name_mismatch",
    });
    expect(queryText(dbExecute.mock.calls[0][0])).toContain("pvp.status IN ('pending', 'rejected')");
    expect(queryText(dbExecute.mock.calls[2][0])).toContain("s.swimming_pool_id =");
    expect(queryText(dbExecute.mock.calls[2][0])).toContain("status IN ('active', 'pending_parent_link')");
  });

  it("does not return parent or candidate data for inactive or cross-pool accounts", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [] });
    expect(await getParentV2ApprovalInfo(pendingId, poolId)).toBeNull();
    expect(dbExecute).toHaveBeenCalledTimes(1);
    expect(queryText(dbExecute.mock.calls[0][0])).toContain("pa.is_active = true");
    expect(queryText(dbExecute.mock.calls[0][0])).toContain("pa.swimming_pool_id = pvp.pool_id");
  });
});

describe("parent V2 administrator request notification", () => {
  it("suppresses a push only for the explicit matched ID with an approved live same-pool relation", async () => {
    const { queries, state } = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, matched_student_id: studentId, status: "pending" }] },
      { rows: [{ student_id: studentId }] },
    ]);
    const sendPush = vi.fn();
    const result = await requestParentV2AdminHelp(pendingId, parentId, sendPush);

    expect(state.committed).toBe(true);
    expect(result).toMatchObject({
      success: true,
      already_linked: true,
      push_delivery_status: "suppressed_already_linked",
    });
    expect(sendPush).not.toHaveBeenCalled();
    expect(queries).toHaveLength(3);
    expect(queryText(queries[2])).toContain("ps.student_id =");
    expect(queryText(queries[2])).toContain("ps.status = 'approved'");
    expect(queryText(queries[2])).toContain("s.swimming_pool_id =");
    expect(queries.some(query => queryText(query).includes("INSERT INTO notifications"))).toBe(false);
  });

  it("does not infer a linked student from phone data when no explicit matched ID exists", async () => {
    const { queries } = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, matched_student_id: null, status: "pending" }] },
      { rows: [] },
      { rows: [{ recipient_id: "admin_a" }] },
    ]);
    const sendPush = vi.fn(async () => true);
    const result = await requestParentV2AdminHelp(pendingId, parentId, sendPush);
    expect(result).toMatchObject({ success: true, push_delivery_status: "delivered" });
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(queryText(queries[3])).toContain("INSERT INTO notifications");
  });
});