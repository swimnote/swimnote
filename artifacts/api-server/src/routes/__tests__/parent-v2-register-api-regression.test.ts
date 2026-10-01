import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  superAdminExecute: vi.fn(),
  transaction: vi.fn(),
  signToken: vi.fn(),
  activeProvider: vi.fn(),
  smsConfigured: vi.fn(),
  sendSms: vi.fn(),
  sendDevVerification: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: (...args: unknown[]) => doubles.dbExecute(...args),
    transaction: (...args: unknown[]) => doubles.transaction(...args),
  },
  superAdminDb: {
    execute: (...args: unknown[]) => doubles.superAdminExecute(...args),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  usersTable: {},
  parentAccountsTable: {},
  swimmingPoolsTable: {},
  studentRegistrationRequestsTable: {},
}));

vi.mock("../../lib/auth.js", () => ({
  hashPassword: async (password: string) => `test-hash:${password}`,
  comparePassword: async () => false,
  signToken: (payload: unknown) => doubles.signToken(payload),
  signTotpSession: () => "test-totp-session",
  verifyTotpSession: () => ({ userId: "test-user" }),
}));

vi.mock("../../lib/member-limit.js", () => ({
  assertMemberLimitInTx: vi.fn(),
  MemberLimitError: class MemberLimitError extends Error {},
  sendMemberLimitResponse: vi.fn(),
}));

vi.mock("../../middlewares/auth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireDbRoleCheck: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../middlewares/rate-limit.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    loginLimiter: pass,
    signupLimiter: pass,
    passwordLimiter: pass,
    verifyLimiter: pass,
  };
});

vi.mock("../../lib/sms/sendSms.js", () => ({
  sendSms: (...args: unknown[]) => doubles.sendSms(...args),
  sendDevVerification: (...args: unknown[]) => doubles.sendDevVerification(...args),
  getActiveProvider: () => doubles.activeProvider(),
  isSmsConfigured: () => doubles.smsConfigured(),
  getSmsConfigError: () => "test SMS provider unavailable",
}));

vi.mock("../../lib/parent-approval-hooks.js", () => ({
  onParentApproved: vi.fn(async () => undefined),
}));

vi.mock("../../lib/event-logger.js", () => ({
  logEvent: vi.fn(async () => undefined),
}));

vi.mock("../../lib/defaultTemplates.js", () => ({
  insertDefaultTemplates: vi.fn(async () => undefined),
}));

vi.mock("../../lib/push-service.js", () => ({
  sendPushToPoolAdmins: vi.fn(async () => undefined),
  sendPushToUser: vi.fn(async () => undefined),
}));

import authRouter from "../auth.js";
import {
  issueParentPhoneProof,
  PARENT_PHONE_PROOF_PURPOSE,
  verifyParentPhoneProof,
} from "../../lib/parent-phone-proof.js";

type Student = {
  id: string;
  name: string;
  swimming_pool_id: string;
  parent_phone?: string | null;
  parent_phone2?: string | null;
  parent_phone3?: string | null;
  parent_phone4?: string | null;
  status: string;
  deleted_at?: string | null;
  withdrawn_at?: string | null;
};

type Verification = {
  id: string;
  phone: string;
  code: string;
  purpose: string;
  code_hash: string | null;
  is_used: boolean;
  verified_at: string | null;
  ref_id: string | null;
  expires_at: string;
  attempt_count: number;
  created_at: string;
};

type DatabaseState = {
  pools: Array<{ id: string; name: string }>;
  students: Student[];
  parents: Array<Record<string, any>>;
  relations: Array<Record<string, any>>;
  pending: Array<Record<string, any>>;
  verifications: Verification[];
  queries: Array<{ target: string; sql: string; params: unknown[] }>;
  writes: Array<{ target: string; sql: string; params: unknown[] }>;
};

let state: DatabaseState;

function app() {
  const server = express();
  server.use(express.json());
  server.use("/auth", authRouter);
  return server;
}

function compileQuery(query: any): { sql: string; params: unknown[] } {
  return query.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => `$${index + 1}`,
    escapeString: (value: string) => `'${value.replace(/'/g, "''")}'`,
  });
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

function rows<T>(values: T[]) {
  return { rows: values };
}

async function execute(target: "db" | "superAdminDb" | "transaction", query: any) {
  const compiled = compileQuery(query);
  const sql = compiled.sql.replace(/["`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const params = compiled.params;
  state.queries.push({ target, sql, params });
  if (/^(insert|update|delete)\b/.test(sql)) {
    state.writes.push({ target, sql, params });
  }

  if (sql.includes("from swimming_pools")) {
    return rows(state.pools.filter((pool) => pool.id === params[0]));
  }

  if (sql.startsWith("select count(*) as cnt from phone_verifications")) {
    return rows([{ cnt: 0 }]);
  }

  if (sql.startsWith("select") && sql.includes("from phone_verifications") && sql.includes("where phone =")) {
    const [phone, purpose] = params.map(String);
    const found = state.verifications
      .filter((verification) => verification.phone === phone && verification.purpose === purpose)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return rows(found ? [{
      id: found.id,
      code: found.code,
      code_hash: found.code_hash,
      expires_at: found.expires_at,
      is_used: found.is_used,
      attempt_count: found.attempt_count,
    }] : []);
  }

  if (sql.startsWith("update phone_verifications") && sql.includes("set ref_id =")) {
    const [parentId, purpose, verificationId, phone, otpPurpose] = params.map(String);
    const verification = state.verifications.find((row) => row.id === verificationId);
    if (
      verification &&
      verification.phone === phone &&
      verification.purpose === otpPurpose &&
      verification.code_hash !== null &&
      verification.is_used &&
      verification.verified_at !== null &&
      verification.ref_id === null
    ) {
      verification.ref_id = parentId;
      verification.purpose = purpose;
      return rows([{ id: verification.id }]);
    }
    return rows([]);
  }

  if (sql.startsWith("select") && sql.includes("from phone_verifications") && sql.includes("where ref_id =")) {
    const [parentId, phone, purpose] = params.map(String);
    return rows(state.verifications
      .filter((row) =>
        row.ref_id === parentId &&
        row.phone === phone &&
        row.purpose === purpose &&
        row.code_hash !== null &&
        row.is_used &&
        row.verified_at !== null
      )
      .slice(0, 1)
      .map((row) => ({ id: row.id })));
  }

  if (sql.startsWith("update phone_verifications") && sql.includes("set is_used = true, verified_at = now()")) {
    const verification = state.verifications.find((row) => row.id === String(params[0]));
    if (!verification || verification.is_used) return rows([]);
    verification.is_used = true;
    verification.verified_at = new Date().toISOString();
    return rows([{ id: verification.id }]);
  }

  if (sql.startsWith("update phone_verifications") && sql.includes("attempt_count = attempt_count + 1")) {
    const verification = state.verifications.find((row) => row.id === String(params[0]));
    if (verification) verification.attempt_count += 1;
    return rows([]);
  }

  if (sql.startsWith("insert into phone_verifications")) {
    const values = params.map(String);
    const [id, phone, code, codeHash, purpose, expiresAt] = values.length === 6
      ? [values[0], values[1], "", values[2], values[3], values[4]]
      : values;
    state.verifications.push({
      id,
      phone,
      code,
      purpose,
      code_hash: codeHash,
      is_used: false,
      verified_at: null,
      ref_id: null,
      expires_at: expiresAt,
      attempt_count: 0,
      created_at: new Date().toISOString(),
    });
    return rows([]);
  }

  if (sql.startsWith("select") && sql.includes("from parent_accounts") && sql.includes("regexp_replace")) {
    const [phone, poolId] = params.map(String);
    return rows(state.parents
      .filter((parent) => digits(parent.phone) === phone && parent.swimming_pool_id === poolId)
      .slice(0, 1)
      .map(({ id, kakao_id, is_active }) => ({ id, kakao_id, is_active })));
  }

  if (sql.startsWith("select") && sql.includes("from parent_accounts") && sql.includes("where id =")) {
    const parent = state.parents.find((row) => row.id === String(params[0]));
    return rows(parent ? [parent] : []);
  }

  if (sql.startsWith("select") && sql.includes("from parent_accounts") && sql.includes("where login_id =")) {
    return rows([]);
  }

  if (sql.startsWith("select") && sql.includes("from students")) {
    const poolId = String(params[0]);
    const phone = String(params[1]);
    return rows(state.students
      .filter((student) =>
        student.swimming_pool_id === poolId &&
        ["active", "pending_parent_link"].includes(student.status) &&
        !student.deleted_at &&
        !student.withdrawn_at &&
        [student.parent_phone, student.parent_phone2, student.parent_phone3, student.parent_phone4]
          .some((candidate) => digits(candidate) === phone)
      )
      .map(({ id, name }) => ({ id, name })));
  }

  if (sql.startsWith("select") && sql.includes("from parent_students")) {
    const parentId = String(params[0]);
    const ids = Array.isArray(params[1]) ? params[1].map(String) : [];
    return rows(state.relations
      .filter((relation) => relation.parent_id === parentId && ids.includes(relation.student_id))
      .map(({ student_id, status }) => ({ student_id, status })));
  }

  if (sql.startsWith("insert into parent_accounts")) {
    const [id, swimming_pool_id, phone, pin_hash, name, login_id, apple_id, kakao_id] = params;
    state.parents.push({ id, swimming_pool_id, phone, pin_hash, name, login_id, apple_id, kakao_id, is_active: true });
    return rows([]);
  }

  if (sql.startsWith("insert into parent_students")) {
    const [id, parent_id, student_id, swimming_pool_id] = params;
    const relation = state.relations.find((row) => row.parent_id === parent_id && row.student_id === student_id);
    if (relation?.status === "approved") return rows([]);
    if (relation) {
      Object.assign(relation, { swimming_pool_id, status: "approved" });
    } else {
      state.relations.push({ id, parent_id, student_id, swimming_pool_id, status: "approved" });
    }
    return rows([{ student_id }]);
  }

  if (sql.startsWith("select") && sql.includes("from parent_v2_pending")) {
    const pending = state.pending.find((row) => row.parent_id === String(params[0]) && row.status === "pending");
    return rows(pending ? [{ id: pending.id }] : []);
  }

  if (sql.startsWith("insert into parent_v2_pending")) {
    const [id, parent_id, pool_id, child_name_raw, child_name_normalized, parent_phone_normalized] = params;
    state.pending.push({
      id,
      parent_id,
      pool_id,
      child_name_raw,
      child_name_normalized,
      parent_phone_normalized,
      status: "pending",
    });
    return rows([]);
  }

  if (sql.startsWith("delete from parent_accounts")) {
    state.parents = state.parents.filter((parent) => parent.id !== String(params[0]));
    return rows([]);
  }

  return rows([]);
}

function makeOtp(phone: string, id: string, refId: string | null = null): Verification {
  return {
    id,
    phone,
    code: "",
    purpose: PARENT_PHONE_PROOF_PURPOSE,
    code_hash: "real-otp-verification-record",
    is_used: true,
    verified_at: new Date().toISOString(),
    ref_id: refId,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    attempt_count: 0,
    created_at: new Date().toISOString(),
  };
}

function addProof(phone: string, id: string, issuedAt = Date.now()) {
  state.verifications.push(makeOtp(phone, id));
  return issueParentPhoneProof(phone, id, PARENT_PHONE_PROOF_PURPOSE, issuedAt);
}

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "student-hayoon",
    name: "박하윤",
    swimming_pool_id: "pool-a",
    parent_phone: "01011112222",
    parent_phone2: null,
    parent_phone3: null,
    parent_phone4: null,
    status: "active",
    ...overrides,
  };
}

async function register(
  childName: string,
  phone = "01011112222",
  proof = addProof(phone, `otp-${state.verifications.length + 1}`),
) {
  return request(app())
    .post("/auth/v2/parent-register")
    .send({
      parent_name: "학부모",
      phone,
      password: "1234",
      pool_id: "pool-a",
      child_name: childName,
      phone_proof: proof,
    });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("JWT_SECRET", "test-only-parent-phone-proof-signing-key");
  state = {
    pools: [{ id: "pool-a", name: "테스트 수영장" }],
    students: [],
    parents: [],
    relations: [],
    pending: [],
    verifications: [],
    queries: [],
    writes: [],
  };

  doubles.dbExecute.mockImplementation((query: any) => execute("db", query));
  doubles.superAdminExecute.mockImplementation((query: any) => execute("superAdminDb", query));
  doubles.transaction.mockImplementation((callback: (tx: { execute: typeof execute }) => unknown) =>
    callback({ execute: (query: any) => execute("transaction", query) }),
  );
  doubles.signToken.mockReturnValue("test-parent-token");
  doubles.activeProvider.mockReturnValue("coolsms");
  doubles.smsConfigured.mockReturnValue(true);
  doubles.sendSms.mockImplementation(async () => undefined);
  doubles.sendDevVerification.mockReset();
});

describe("POST /auth/v2/parent-register — actual Express route, fake DB/SMS", () => {
  it("CASE A — exact child name links by verified phone and returns the registered student name", async () => {
    state.students.push(student());

    const response = await register("박하윤");

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.status).toBe("linked");
    expect(response.body.matched_students).toEqual([{ id: "student-hayoon", name: "박하윤" }]);
    expect(state.relations.map((relation) => relation.student_id)).toEqual(["student-hayoon"]);
    expect(doubles.signToken).toHaveBeenCalledWith(expect.objectContaining({
      parentPhoneVerified: "01011112222",
    }));
  });

  it("CASE B — typo child name does not prevent verified-phone approval", async () => {
    state.students.push(student());

    const response = await register("박하욘");

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("linked");
    expect(response.body.matched_students).toEqual([{ id: "student-hayoon", name: "박하윤" }]);
  });

  it("CASE C — combined sibling names link all same-phone students and return roster names", async () => {
    state.students.push(
      student(),
      student({ id: "student-yuha", name: "박유하", parent_phone: null, parent_phone3: "010-1111-2222" }),
      student({ id: "unregistered-sibling", name: "미등록", status: "unregistered" }),
    );

    const response = await register("박하윤 박유하");

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("linked");
    expect(response.body.matched_students).toEqual([
      { id: "student-hayoon", name: "박하윤" },
      { id: "student-yuha", name: "박유하" },
    ]);
    expect(state.relations.map((relation) => relation.student_id).sort()).toEqual(["student-hayoon", "student-yuha"]);
    expect(state.students.find((row) => row.id === "unregistered-sibling")?.status).toBe("unregistered");
    expect(state.relations.some((relation) => relation.student_id === "unregistered-sibling")).toBe(false);
    expect(state.writes.some((write) => write.sql.startsWith("update students"))).toBe(false);
  });

  it("CASE D — one entered sibling name still links every matching sibling", async () => {
    state.students.push(
      student(),
      student({ id: "student-yuha", name: "박유하", parent_phone2: "01011112222" }),
    );

    const response = await register("박하윤");

    expect(response.status).toBe(201);
    expect(response.body.matched_students.map((row: { name: string }) => row.name)).toEqual(["박하윤", "박유하"]);
  });

  it("CASE E — exact name with a different guardian phone remains pending", async () => {
    state.students.push(student());

    const response = await register("박하윤", "01099998888");

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("waiting");
    expect(response.body.matched_students).toEqual([]);
    expect(state.relations).toHaveLength(0);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]).toMatchObject({
      child_name_raw: "박하윤",
      parent_phone_normalized: "01099998888",
      status: "pending",
    });
  });

  it("CASE F — wholly unrelated child text still auto-approves by verified phone", async () => {
    state.students.push(student());

    const response = await register("전혀 다른 이름");

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("linked");
    expect(response.body.matched_students).toEqual([{ id: "student-hayoon", name: "박하윤" }]);
  });

  it.each([
    ["missing proof", async () => undefined],
    ["forged proof", async () => "v1.eyJmb28iOiJiYXIifQ.not-a-real-signature"],
    ["phone-mismatched proof", async () => addProof("01011112222", "mismatch-proof")],
    ["expired proof", async () => addProof("01011112222", "expired-proof", Date.now() - 11 * 60_000)],
  ])("CASE G — %s is rejected before account, relation, or pending writes", async (_label, proofFactory) => {
    const proof = await proofFactory();
    const response = await request(app())
      .post("/auth/v2/parent-register")
      .send({
        parent_name: "학부모",
        phone: _label === "phone-mismatched proof" ? "01099998888" : "01011112222",
        password: "1234",
        pool_id: "pool-a",
        child_name: "박하윤",
        ...(proof ? { phone_proof: proof } : {}),
      });

    expect(response.status).toBe(403);
    expect(state.parents).toHaveLength(0);
    expect(state.relations).toHaveLength(0);
    expect(state.pending).toHaveLength(0);
    expect(state.writes.some((write) =>
      write.sql.includes("parent_accounts") ||
      write.sql.includes("parent_students") ||
      write.sql.includes("parent_v2_pending")
    )).toBe(false);
  });

  it("CASE G — replayed proof is rejected without creating another account or relation", async () => {
    const proof = issueParentPhoneProof("01011112222", "already-claimed");
    state.verifications.push(makeOtp("01011112222", "already-claimed", "existing-parent"));

    const response = await request(app())
      .post("/auth/v2/parent-register")
      .send({
        parent_name: "학부모",
        phone: "01011112222",
        password: "1234",
        pool_id: "pool-a",
        child_name: "박하윤",
        phone_proof: proof,
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("parent_phone_proof_invalid_or_used");
    expect(state.parents).toHaveLength(0);
    expect(state.relations).toHaveLength(0);
    expect(state.pending).toHaveLength(0);
    expect(state.verifications[0].ref_id).toBe("existing-parent");
  });

  it("CASE J — zero phone candidates retains the V2 pending-approval flow", async () => {
    const response = await register("이름은 정확히 입력");

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("waiting");
    expect(response.body.matched_student).toBeNull();
    expect(response.body.matched_students).toEqual([]);
    expect(state.parents).toHaveLength(1);
    expect(state.relations).toHaveLength(0);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].status).toBe("pending");
  });
});

describe("parent signup phone proof — actual SMS routes", () => {
  it("demo phone and dev SMS cannot issue or verify an ownership proof", async () => {
    const server = app();
    const demoSend = await request(server).post("/auth/send-sms-code").send({
      phone: "01000000000",
      purpose: PARENT_PHONE_PROOF_PURPOSE,
    });
    expect(demoSend.status).toBe(400);
    expect(demoSend.body.error).toBe("demo_phone_not_allowed");

    doubles.activeProvider.mockReturnValue("dev");
    const devSend = await request(server).post("/auth/send-sms-code").send({
      phone: "01011112222",
      purpose: PARENT_PHONE_PROOF_PURPOSE,
    });
    const devVerify = await request(server).post("/auth/verify-sms-code").send({
      phone: "01011112222",
      code: "123456",
      purpose: PARENT_PHONE_PROOF_PURPOSE,
    });
    expect(devSend.status).toBe(503);
    expect(devVerify.status).toBe(503);
    expect(state.verifications).toHaveLength(0);
    expect(doubles.sendDevVerification).not.toHaveBeenCalled();
  });

  it("a generic non-proof SMS verification yields no proof and cannot register", async () => {
    const server = app();
    const sent = await request(server).post("/auth/send-sms-code").send({
      phone: "01011112222",
      purpose: "parent_signup",
    });
    expect(sent.status).toBe(200);

    const smsCall = doubles.sendSms.mock.calls.at(-1)?.[0] as { message: string };
    const code = smsCall.message.match(/인증번호는 (\d{6})입니다/)?.[1];
    expect(code).toBeDefined();
    const verified = await request(server).post("/auth/verify-sms-code").send({
      phone: "01011112222",
      code,
      purpose: "parent_signup",
    });

    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.verified).toBe(true);
    expect(verified.body.phone_proof).toBeUndefined();
    expect(verifyParentPhoneProof(verified.body.phone_proof, "01011112222")).toBeNull();

    const registerResponse = await request(server)
      .post("/auth/v2/parent-register")
      .send({
        parent_name: "학부모",
        phone: "01011112222",
        password: "1234",
        pool_id: "pool-a",
        child_name: "박하윤",
      });
    expect(registerResponse.status).toBe(403);
    expect(state.parents).toHaveLength(0);
    expect(state.relations).toHaveLength(0);
    expect(state.pending).toHaveLength(0);
  });

  it("a proof-purpose OTP from the mocked real-SMS provider returns a test-key proof", async () => {
    const server = app();
    const sent = await request(server).post("/auth/send-sms-code").send({
      phone: "01011112222",
      purpose: PARENT_PHONE_PROOF_PURPOSE,
    });
    expect(sent.status).toBe(200);

    const smsCall = doubles.sendSms.mock.calls.at(-1)?.[0] as { message: string };
    const code = smsCall.message.match(/인증번호는 (\d{6})입니다/)?.[1];
    expect(code).toBeDefined();
    const verified = await request(server).post("/auth/verify-sms-code").send({
      phone: "01011112222",
      code,
      purpose: PARENT_PHONE_PROOF_PURPOSE,
    });

    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.verified).toBe(true);
    expect(verified.body.phone_proof).toEqual(expect.any(String));
    expect(verifyParentPhoneProof(verified.body.phone_proof, "01011112222")).not.toBeNull();
    expect(verifyParentPhoneProof(verified.body.phone_proof, "01099998888")).toBeNull();
  });

  it("a real legacy signup OTP returns a parent proof and can be claimed at registration", async () => {
    const server = app();
    const phone = "01011112222";
    const sent = await request(server).post("/auth/send-sms-code").send({
      phone,
      purpose: "signup",
    });
    expect(sent.status).toBe(200);
    expect(state.verifications[0].code).toBe("real_sms");

    const smsCall = doubles.sendSms.mock.calls.at(-1)?.[0] as { message: string };
    const code = smsCall.message.match(/인증번호는 (\d{6})입니다/)?.[1];
    const verified = await request(server).post("/auth/verify-sms-code").send({
      phone,
      code,
      purpose: "signup",
    });

    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.phone_proof).toEqual(expect.any(String));
    expect(verifyParentPhoneProof(verified.body.phone_proof, phone)).toMatchObject({ otpPurpose: "signup" });

    const registration = await register("박하윤", phone, verified.body.phone_proof);
    expect(registration.status, JSON.stringify(registration.body)).toBe(201);
    expect(state.verifications[0].purpose).toBe(PARENT_PHONE_PROOF_PURPOSE);
    expect(state.verifications[0].ref_id).toBe(registration.body.parent.id);
  });

  it("legacy signup demo and dev OTPs do not return ownership proof", async () => {
    const server = app();
    const demoSent = await request(server).post("/auth/send-sms-code").send({
      phone: "01000000000",
      purpose: "signup",
    });
    expect(demoSent.status).toBe(200);
    const demoVerified = await request(server).post("/auth/verify-sms-code").send({
      phone: "01000000000",
      code: "000000",
      purpose: "signup",
    });
    expect(demoVerified.status).toBe(200);
    expect(demoVerified.body.phone_proof).toBeUndefined();

    doubles.activeProvider.mockReturnValue("dev");
    doubles.sendDevVerification.mockImplementation(({ code }: { code: string }) => code);
    const devSent = await request(server).post("/auth/send-sms-code").send({
      phone: "01011112222",
      purpose: "signup",
    });
    expect(devSent.status).toBe(200);
    expect(state.verifications[1].code).toBe("");
    // A dev-origin row must stay ineligible if provider configuration changes.
    doubles.activeProvider.mockReturnValue("coolsms");
    const devVerified = await request(server).post("/auth/verify-sms-code").send({
      phone: "01011112222",
      code: devSent.body.dev_code,
      purpose: "signup",
    });
    expect(devVerified.status, JSON.stringify(devVerified.body)).toBe(200);
    expect(devVerified.body.phone_proof).toBeUndefined();
  });
});