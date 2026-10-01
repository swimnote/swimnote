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
const phone = "01011112222";

const student = {
  id: "student_target",
  swimming_pool_id: poolId,
  name: "박하윤",
  parent_name: "김보호",
  parent_phone: "010-1111-2222",
  parent_phone2: null,
  parent_phone3: null,
  parent_phone4: null,
  status: "active",
  deleted_at: null,
  withdrawn_at: null,
  parent_user_id: "another_parent",
};

function setTransactionQueue(
  responses: Array<any | ((query: any, index: number) => any)>,
  state: { committed: boolean; rolledBack: boolean } = { committed: false, rolledBack: false },
) {
  const queries: any[] = [];
  transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
    let cursor = 0;
    const tx = {
      execute: vi.fn(async (query: any) => {
        queries.push(query);
        const response = responses[cursor];
        const index = cursor++;
        if (typeof response === "function") return response(query, index);
        if (response instanceof Error) throw response;
        return response ?? { rows: [] };
      }),
    };
    try {
      const result = await callback(tx);
      state.committed = true;
      return result;
    } catch (error) {
      state.rolledBack = true;
      throw error;
    }
  });
  return { queries, state };
}

function queryText(query: any): string {
  return new PgDialect().sqlToQuery(query).sql;
}

function commonConfirmResponses(overrides: {
  proof?: any[];
  pending?: Record<string, any>;
  parent?: Record<string, any>;
  admin?: Record<string, any>;
  resolvedStudent?: Record<string, any>;
  lockedStudent?: Record<string, any>;
  savedStudent?: Record<string, any>;
  siblings?: Array<Record<string, any>>;
  existingLinks?: Array<Record<string, any>>;
  linkResponses?: any[][];
} = {}) {
  const resolved = overrides.resolvedStudent ?? student;
  const pending = {
      id: pendingId,
      parent_id: parentId,
      pool_id: poolId,
      child_name_raw: "박하윤",
      child_name_normalized: "박하윤",
      parent_phone_normalized: phone,
      matched_student_id: student.id,
      status: "pending",
      pending_reason: "phone_mismatch",
      ...overrides.pending,
    };
  return [
    { rows: [pending] },
    { rows: [{
      id: parentId,
      swimming_pool_id: poolId,
      phone,
      name: "김보호",
      is_active: true,
      withdrawal_requested_at: null,
      ...overrides.parent,
    }] },
    { rows: [pending] },
    { rows: [{
      swimming_pool_id: poolId,
      role: "pool_admin",
      roles: ["pool_admin"],
      is_activated: true,
      ...overrides.admin,
    }] },
    { rows: overrides.proof ?? [{ id: "verified_sms_row" }] },
    { rows: [resolved] },
    { rows: [overrides.lockedStudent ?? resolved] },
    { rows: [overrides.savedStudent ?? resolved] },
    { rows: overrides.siblings ?? [resolved] },
    { rows: overrides.existingLinks ?? [] },
    ...((overrides.linkResponses ?? [[]]).map(rows => ({ rows }))),
    { rows: [{ id: pendingId }] },
  ];
}

beforeEach(() => {
  dbExecute.mockReset();
  transaction.mockReset();
});

describe("strict parent V2 admin confirmation", () => {
  it("saves only approved fields, rechecks durable proof, links same-pool eligible siblings and marks matched", async () => {
    const sibling = {
      ...student,
      id: "student_sibling",
      name: "박유하",
      parent_phone: phone,
      parent_user_id: "keep_existing_pointer",
    };
    const { queries, state } = setTransactionQueue(commonConfirmResponses({
      savedStudent: { ...student, parent_phone: phone },
      siblings: [{ ...student, parent_phone: phone }, sibling],
      existingLinks: [{
        student_id: sibling.id,
        swimming_pool_id: poolId,
        status: "approved",
        approved_at: "unchanged-approved-at",
        approved_by: "unchanged-approved-by",
      }],
      linkResponses: [[{ student_id: student.id }]],
    }));

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, {
      student_id: student.id,
      parent_phone: phone,
    });

    expect(result).toMatchObject({
      success: true,
      linkedCount: 2,
      newRelationCount: 1,
      newStudentIds: [student.id],
      students: [
        { id: student.id, name: student.name },
        { id: sibling.id, name: sibling.name },
      ],
    });
    expect(state.committed).toBe(true);
    expect(state.rolledBack).toBe(false);
    expect(queryText(queries[2])).toContain("FOR UPDATE");
    expect(queryText(queries[1])).toContain("parent_accounts");
    expect(queryText(queries[4])).toContain("phone_verifications");
    expect(queryText(queries[7])).toContain("UPDATE students");
    expect(queryText(queries[7])).toContain("parent_phone =");
    expect(queryText(queries[7])).not.toContain("parent_user_id =");
    expect(queryText(queries[7])).not.toContain("SET status =");
    expect(queryText(queries[8])).toContain("swimming_pool_id =");
    expect(queryText(queries[8])).toContain("parent_phone2");
    expect(queryText(queries[8])).toContain("parent_phone3");
    expect(queryText(queries[8])).toContain("parent_phone4");
    expect(queryText(queries[8])).toContain("status IN ('active', 'pending_parent_link')");
    expect(queryText(queries[8])).toContain("deleted_at IS NULL");
    expect(queryText(queries[8])).toContain("withdrawn_at IS NULL");
    expect(queryText(queries[9])).toContain("FROM parent_students");
    expect(queryText(queries[10])).toContain("ON CONFLICT (parent_id, student_id)");
    expect(queryText(queries[10])).toContain("WHERE parent_students.status <> 'approved'");
    expect(queryText(queries[10])).toContain("approved_by = EXCLUDED.approved_by");
    expect(new PgDialect().sqlToQuery(queries[10]).params).toContain(adminId);
    expect(queryText(queries[11])).toContain("status = 'matched'");
    expect(queryText(queries[9])).toContain("approved_at");
    expect(queryText(queries[9])).toContain("approved_by");
  });

  it("rolls back a student-phone edit when saved phone slots still do not match the verified phone", async () => {
    const state = { committed: false, rolledBack: false };
    const { queries } = setTransactionQueue(commonConfirmResponses({
      savedStudent: { ...student, parent_phone: "010-9999-8888" },
    }), state);

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, {
      parent_phone: "010-9999-8888",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("phone_mismatch");
    expect(result.message).toBe(
      "학부모 인증 전화번호와 등록된 보호자 전화번호가 일치하지 않습니다. 학부모에게 전화번호를 확인해 주세요.",
    );
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(queries.some(query => queryText(query).includes("UPDATE parent_v2_pending"))).toBe(false);
  });

  it("rejects a missing real durable SMS proof before editing student or relation data", async () => {
    const { queries } = setTransactionQueue(commonConfirmResponses({ proof: [] }));
    const result = await confirmParentV2Pending(pendingId, poolId, adminId, {
      parent_phone: phone,
    });

    expect(result).toMatchObject({ success: false, code: "phone_proof_missing" });
    expect(queries).toHaveLength(5);
    expect(queries.some(query => queryText(query).includes("UPDATE students"))).toBe(false);
  });

  it("does not let a client-provided student id override the server-resolved target", async () => {
    const { queries } = setTransactionQueue(commonConfirmResponses());
    const result = await confirmParentV2Pending(pendingId, poolId, adminId, {
      student_id: "student_from_another_pool",
    });

    expect(result).toMatchObject({ success: false, code: "student_id_not_resolved" });
    expect(queries).toHaveLength(6);
    expect(queries.some(query => queryText(query).includes("UPDATE students"))).toBe(false);
  });

  it("checks parent/admin pool identity and only links active, nonwithdrawn students in the pending pool", async () => {
    const parentMismatch = setTransactionQueue(commonConfirmResponses({
      parent: { swimming_pool_id: "other_pool" },
    }));
    const parentResult = await confirmParentV2Pending(pendingId, poolId, adminId, {});
    expect(parentResult).toMatchObject({ success: false, code: "parent_account_invalid" });
    expect(parentMismatch.queries).toHaveLength(2);

    const { queries } = setTransactionQueue(commonConfirmResponses({
      savedStudent: { ...student, parent_phone: phone },
      siblings: [{ ...student, parent_phone: phone }],
    }));
    await confirmParentV2Pending(pendingId, poolId, adminId, { parent_phone: phone });
    const siblingQuery = queryText(queries[8]);
    expect(siblingQuery).toContain("s.swimming_pool_id =");
    expect(siblingQuery).toContain("s.status IN ('active', 'pending_parent_link')");
    expect(siblingQuery).toContain("s.deleted_at IS NULL");
    expect(siblingQuery).toContain("s.withdrawn_at IS NULL");
  });

  it("holds and rolls back when an existing approved relation points at a different pool", async () => {
    const state = { committed: false, rolledBack: false };
    const { queries } = setTransactionQueue(commonConfirmResponses({
      savedStudent: { ...student, parent_phone: phone },
      siblings: [{ ...student, parent_phone: phone }],
      existingLinks: [{
        student_id: student.id,
        swimming_pool_id: "other_pool",
        status: "approved",
        approved_at: "must_remain",
        approved_by: "must_remain",
      }],
    }), state);

    const result = await confirmParentV2Pending(pendingId, poolId, adminId, { parent_phone: phone });

    expect(result).toMatchObject({ success: false, code: "approved_relation_pool_mismatch" });
    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(queries.some(query => queryText(query).includes("INSERT INTO parent_students"))).toBe(false);
    expect(queries.some(query => queryText(query).includes("UPDATE parent_v2_pending"))).toBe(false);
  });

  it("rolls back student edits when a relation upsert fails after the edit", async () => {
    const state = { committed: false, rolledBack: false };
    const responses: any[] = commonConfirmResponses({
      savedStudent: { ...student, parent_phone: phone },
      siblings: [{ ...student, parent_phone: phone }],
    });
    responses[10] = new Error("relation upsert failed");
    const { queries } = setTransactionQueue(responses, state);

    await expect(
      confirmParentV2Pending(pendingId, poolId, adminId, { parent_phone: phone }),
    ).rejects.toThrow("relation upsert failed");

    expect(state.committed).toBe(false);
    expect(state.rolledBack).toBe(true);
    expect(queryText(queries[7])).toContain("UPDATE students");
    expect(queries.some(query => queryText(query).includes("UPDATE parent_v2_pending"))).toBe(false);
  });
});

describe("parent V2 approval-info resolver", () => {
  it("does not reveal parent or student information when the account is inactive or cross-pool", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [] });
    const info = await getParentV2ApprovalInfo(pendingId, poolId);

    expect(info).toBeNull();
    expect(dbExecute).toHaveBeenCalledTimes(1);
    expect(queryText(dbExecute.mock.calls[0][0])).toContain("pa.is_active = true");
    expect(queryText(dbExecute.mock.calls[0][0])).toContain("pa.swimming_pool_id = pvp.pool_id");
    expect(queryText(dbExecute.mock.calls[0][0])).toContain("pvp.status IN ('pending', 'rejected')");
  });

  it("counts live unregistered same-name candidates and never guesses from stale normalized-name data", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{
        id: pendingId,
        parent_id: parentId,
        pool_id: poolId,
        child_name_raw: "박하윤",
        child_name_normalized: "stale_wrong_name",
        parent_phone_normalized: phone,
        matched_student_id: null,
        pending_reason: null,
        parent_name: "김보호",
        parent_phone: phone,
        parent_pool_id: poolId,
      }] })
      .mockResolvedValueOnce({ rows: [{ id: "verified_sms_row" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { ...student, status: "active" },
        { ...student, id: "same_name_unregistered", status: "unregistered" },
      ] });

    const info = await getParentV2ApprovalInfo(pendingId, poolId);

    expect(info).toMatchObject({
      pending_id: pendingId,
      phone_verified: true,
      student: null,
      resolution: "unresolved",
      reason: "ambiguous_name_match",
    });
    const nameSql = queryText(dbExecute.mock.calls[3][0]);
    expect(nameSql).toContain("status NOT IN ('withdrawn', 'archived', 'deleted')");
    expect(new PgDialect().sqlToQuery(dbExecute.mock.calls[3][0]).params).toContain("박하윤");
    expect(nameSql).not.toContain("stale_wrong_name");
  });
});

describe("parent V2 administrator request notification", () => {
  it("notifies only pool-admin recipients after the durable notification transaction commits", async () => {
    const state = { committed: false, rolledBack: false };
    const { queries } = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, status: "pending" }] },
      { rows: [] },
      { rows: [{ recipient_id: "admin_a" }, { recipient_id: "admin_b" }] },
    ], state);
    const pushed: string[] = [];
    const result = await requestParentV2AdminHelp(undefined, parentId, async (userId, targetPool, id) => {
      expect(state.committed).toBe(true);
      expect(targetPool).toBe(poolId);
      expect(id).toBe(pendingId);
      pushed.push(userId);
      return true;
    });

    expect(result).toEqual({
      success: true,
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: 600,
      push_delivery_status: "delivered",
    });
    expect(pushed).toEqual(["admin_a", "admin_b"]);
    expect(queryText(queries[1])).toContain("parent_id =");
    expect(queryText(queries[1])).toContain("pool_id =");
    expect(queryText(queries[1])).toContain("status = 'pending'");
    const notificationSql = queryText(queries[3]);
    expect(notificationSql).toContain("u.swimming_pool_id =");
    expect(notificationSql).toContain("u.role::text = 'pool_admin'");
    expect(notificationSql).not.toContain("teacher");
    expect(notificationSql).toContain("'parent_v2_pending'");
    expect(new PgDialect().sqlToQuery(queries[3]).params).toContain(pendingId);
  });

  it("uses the durable ten-minute cooldown to suppress repeated pushes", async () => {
    const { queries } = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, status: "pending" }] },
      { rows: [{ cooldown_seconds: 431 }] },
    ]);
    const sendPush = vi.fn();
    const result = await requestParentV2AdminHelp(pendingId, parentId, sendPush);

    expect(result).toEqual({
      success: true,
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: 431,
      push_delivery_status: "not_retried",
    });
    expect(sendPush).not.toHaveBeenCalled();
    expect(queries).toHaveLength(3);
    expect(queryText(queries[2])).toContain("INTERVAL '10 minutes'");
  });

  it("scopes pending ownership to the parent JWT identity and rejects inactive/cross-pool parents", async () => {
    const { queries } = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [] },
    ]);
    const sendPush = vi.fn();
    const result = await requestParentV2AdminHelp(pendingId, "another_parent", sendPush);

    expect(result).toMatchObject({ success: false, code: "pending_not_found" });
    expect(sendPush).not.toHaveBeenCalled();
    expect(queries).toHaveLength(2);
    expect(queryText(queries[0])).toContain("parent_accounts");
    expect(queryText(queries[1])).toContain("parent_id =");
    expect(queryText(queries[1])).toContain("pool_id =");
    const pendingParams = new PgDialect().sqlToQuery(queries[1]).params;
    expect(pendingParams).toContain(pendingId);
    expect(pendingParams).toContain("another_parent");
    expect(pendingParams).toContain(poolId);
  });

  it("fails without active pool admins and independently attempts each recipient after push failure", async () => {
    const noAdmins = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, status: "pending" }] },
      { rows: [] },
      { rows: [] },
    ]);
    const noAdminResult = await requestParentV2AdminHelp(pendingId, parentId, vi.fn());
    expect(noAdminResult).toMatchObject({ success: false, code: "no_active_admins" });
    expect(noAdmins.queries[3] && queryText(noAdmins.queries[3])).toContain("u.is_activated = true");

    setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, status: "pending" }] },
      { rows: [] },
      { rows: [{ recipient_id: "admin_a" }, { recipient_id: "admin_b" }] },
    ]);
    const attempts: string[] = [];
    const result = await requestParentV2AdminHelp(undefined, parentId, async recipientId => {
      attempts.push(recipientId);
      if (recipientId === "admin_a") throw new Error("push transport failed");
      return true;
    });
    expect(attempts).toEqual(["admin_a", "admin_b"]);
    expect(result).toMatchObject({
      success: true,
      cooldown_seconds: 600,
      push_delivery_status: "partial",
    });
  });

  it("keeps durable success and cooldown after all pushes fail, without retrying or duplicating inbox rows", async () => {
    const first = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, status: "pending" }] },
      { rows: [] },
      { rows: [{ recipient_id: "admin_a" }, { recipient_id: "admin_b" }] },
    ]);
    const failedDeliveries = vi.fn(async () => false);
    const initial = await requestParentV2AdminHelp(undefined, parentId, failedDeliveries);
    expect(initial).toMatchObject({
      success: true,
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: 600,
      push_delivery_status: "failed",
    });
    expect(failedDeliveries).toHaveBeenCalledTimes(2);
    expect(new PgDialect().sqlToQuery(first.queries[3]).params).toContain(pendingId);

    const second = setTransactionQueue([
      { rows: [{ id: parentId, swimming_pool_id: poolId, is_active: true, withdrawal_requested_at: null }] },
      { rows: [{ id: pendingId, parent_id: parentId, pool_id: poolId, status: "pending" }] },
      { rows: [{ cooldown_seconds: 570 }] },
    ]);
    const retriedPush = vi.fn(async () => true);
    const retry = await requestParentV2AdminHelp(undefined, parentId, retriedPush);
    expect(retry).toMatchObject({
      success: true,
      message: "수영장에 승인 요청을 보냈습니다.",
      cooldown_seconds: 570,
      push_delivery_status: "not_retried",
    });
    expect(retriedPush).not.toHaveBeenCalled();
    expect(second.queries).toHaveLength(3);
    expect(new PgDialect().sqlToQuery(second.queries[2]).params).toContain(pendingId);
  });
});