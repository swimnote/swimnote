import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { signToken } from "../../lib/auth.js";

const {
  dbExecute,
  txExecute,
  parentPool,
  selectedPool,
  approvedLinkRows,
  parentPhone,
  proofVerified,
  linkStudents,
  nameMatches,
} = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  txExecute: vi.fn(),
  parentPool: { value: "pool_link_test" },
  selectedPool: { value: "pool_link_test" },
  approvedLinkRows: { value: [] as Array<{ id: string }> },
  parentPhone: { value: "01011112222" },
  proofVerified: { value: true },
  linkStudents: {
    value: [
      { id: "student_sibling_1", name: "박하윤" },
      { id: "student_sibling_2", name: "박유하" },
    ] as Array<{ id: string; name: string }>,
  },
  nameMatches: { value: [] as Array<{ id: string; name: string }> },
}));

function selectChain(rows: () => any[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows(),
      }),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    execute: (...args: any[]) => dbExecute(...args),
    transaction: (callback: (tx: any) => Promise<any>) =>
      callback({ execute: (...args: any[]) => txExecute(...args) }),
    select: () => selectChain(() => [{ swimming_pool_id: parentPool.value }]),
  },
  superAdminDb: {
    execute: (...args: any[]) => dbExecute(...args),
    select: () => selectChain(() => [{ id: selectedPool.value }]),
  },
}));

vi.mock("../../lib/parent-phone-proof.js", () => ({
  isParentPhoneVerified: vi.fn(async () => proofVerified.value),
}));

vi.mock("../../lib/push-service.js", () => ({
  sendPushToUser: vi.fn(),
  sendPushToPoolAdmins: vi.fn(async () => undefined),
}));

import parentRouter from "../parent.js";

const poolId = "pool_link_test";
const parentId = "parent_link_test";

function compiledSql(query: any): { sql: string; params: any[] } {
  return new PgDialect().sqlToQuery(query);
}

function configureDatabase() {
  dbExecute.mockImplementation(async (query: any) => {
    const q = compiledSql(query).sql.replace(/\s+/g, " ").toLowerCase();
    if (q.includes("select phone from parent_accounts")) {
      return { rows: [{ phone: parentPhone.value }] };
    }
    if (q.includes("select id from parent_students")) {
      return { rows: approvedLinkRows.value };
    }
    if (q.includes("select id, name from students")) {
      return { rows: nameMatches.value };
    }
    if (q.includes("from parent_v2_pending") && q.includes("select")) {
      return { rows: [] };
    }
    return { rows: [], rowCount: 1 };
  });

  txExecute.mockImplementation(async (query: any) => {
    const { sql: q, params } = compiledSql(query);
    const normalized = q.replace(/\s+/g, " ").toLowerCase();
    if (normalized.includes("from parent_accounts") && normalized.includes("for update")) {
      return { rows: [{ id: parentId, swimming_pool_id: poolId, phone: parentPhone.value }] };
    }
    if (normalized.includes("from students") && normalized.includes("parent_phone")) {
      return { rows: linkStudents.value };
    }
    if (normalized.includes("from parent_students") && normalized.includes("select")) {
      return { rows: [] };
    }
    if (normalized.includes("insert into parent_students")) {
      return { rows: [{ student_id: params[2] }] };
    }
    return { rows: [], rowCount: 1 };
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/parent", parentRouter);
  return app;
}

function parentToken(parentPhoneVerified?: string) {
  return signToken({
    userId: parentId,
    role: "parent_account",
    poolId,
    ...(parentPhoneVerified ? { parentPhoneVerified } : {}),
  } as any);
}

async function linkChild(token: string, targetPoolId = poolId) {
  return request(makeApp())
    .post("/parent/link-child")
    .set("Authorization", `Bearer ${token}`)
    .send({ swimming_pool_id: targetPoolId, child_name: "전혀 다른 이름" });
}

beforeEach(() => {
  dbExecute.mockReset();
  txExecute.mockReset();
  parentPool.value = poolId;
  selectedPool.value = poolId;
  approvedLinkRows.value = [];
  parentPhone.value = "01011112222";
  proofVerified.value = true;
  linkStudents.value = [
    { id: "student_sibling_1", name: "박하윤" },
    { id: "student_sibling_2", name: "박유하" },
  ];
  nameMatches.value = [];
  configureDatabase();
});

describe("POST /parent/link-child signed parent phone assurance", () => {
  it("verified phone assurance links all matching same-pool siblings and returns DB names", async () => {
    const response = await linkChild(parentToken(parentPhone.value));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      status: "linked",
      student: { id: "student_sibling_1", name: "박하윤" },
      students: [
        { id: "student_sibling_1", name: "박하윤" },
        { id: "student_sibling_2", name: "박유하" },
      ],
    });
    expect(txExecute).toHaveBeenCalledTimes(6);
  });

  it("unmarked/public-social signed JWT remains pending even when a durable proof row exists", async () => {
    const response = await linkChild(parentToken());

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("pending");
    expect(txExecute).not.toHaveBeenCalled();
  });

  it("mismatched JWT phone assurance remains pending", async () => {
    const response = await linkChild(parentToken("01099998888"));

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("pending");
    expect(txExecute).not.toHaveBeenCalled();
  });

  it("legacy account without a durable OTP ownership row remains pending", async () => {
    proofVerified.value = false;

    const response = await linkChild(parentToken(parentPhone.value));

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("pending");
    expect(txExecute).not.toHaveBeenCalled();
  });

  it("preserves the existing approved-link pool-switch guard", async () => {
    approvedLinkRows.value = [{ id: "existing_approved_link" }];
    const response = await linkChild(parentToken(parentPhone.value), "pool_other");

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("이미 연결된 수영장");
    expect(txExecute).not.toHaveBeenCalled();
    expect(dbExecute).toHaveBeenCalledTimes(1);
  });
});