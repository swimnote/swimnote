/**
 * AI01-07 — R2 Usage Observability (FIX: HTTP-based actual_call_count)
 *
 * actual_call_count 규칙:
 *   success                        → 1
 *   confirmed HTTP/provider error  → 1  ($metadata.httpStatusCode 존재)
 *   pre-HTTP SDK failure           → absent (field omitted)
 *
 * TC1: R2 PUT 성공 → provider=cloudflare_r2 / service=r2_put / actual_call_count=1
 * TC2: PUT bytes를 실제로 아는 경우 → units.bytes 정확
 * TC3: R2 GET 성공 → service=r2_get / actual_call_count=1
 * TC4: R2 DELETE 성공 → service=r2_delete / actual_call_count=1
 * TC5: confirmed HTTP provider error → success=false / actual_call_count=1
 * TC6: pre-HTTP SDK/credentials failure → actual_call_count absent (field not recorded)
 * TC7: 단가 미확정 → estimated_cost_usd=null / cost_source=UNKNOWN
 * TC8: saveExternalUsage 실패 → R2 본 동작 결과 불변
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@smithy/util-stream";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// Mock superAdminDb to prevent real DB writes
vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn().mockResolvedValue({}),
  },
}));

// aws-sdk-client-mock
const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
  // Ensure env vars exist so S3Client constructor doesn't crash
  process.env["CF_R2_ACCESS_KEY_ID"]         = "test_ak";
  process.env["CF_R2_SECRET_ACCESS_KEY"]      = "test_sk";
  process.env["CF_R2_VIDEO_ACCESS_KEY_ID"]    = "test_vak";
  process.env["CF_R2_VIDEO_SECRET_ACCESS_KEY"] = "test_vsk";
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper: build a readable stream for GetObjectCommand mock
function makeBodyStream(data: Buffer) {
  const readable = new Readable({
    read() {
      this.push(data);
      this.push(null);
    },
  });
  return sdkStreamMixin(readable);
}

// Helper: extract SQL string from superAdminDb.execute mock call
async function getLastSqlStr(): Promise<string> {
  const { superAdminDb } = await import("@workspace/db");
  const executeMock = vi.mocked(superAdminDb.execute);
  const lastCall = executeMock.mock.calls[executeMock.mock.calls.length - 1]?.[0] as any;
  return (
    lastCall?.queryChunks
      ?.map((c: any) => (typeof c === "string" ? c : String(c?.value ?? "")))
      ?.join("") ?? ""
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1 — R2 PUT 성공: provider / service / actual_call_count
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1. R2 PUT 성공 → provider=cloudflare_r2, service=r2_put, actual_call_count=1", () => {
  it("uploadToR2 성공 시 event_logs에 r2_put 기록", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    const { uploadToR2 } = await import("../../lib/objectStorage.js");
    const result = await uploadToR2(
      "test/key.jpg",
      Buffer.from("hello"),
      "image/jpeg"
    );

    expect(result.ok).toBe(true);

    // wait a tick for the void .catch() finally branch
    await new Promise((r) => setTimeout(r, 20));

    expect(executeMock).toHaveBeenCalled();
    const sqlStr = await getLastSqlStr();
    expect(sqlStr).toContain("EXTERNAL_USAGE");
    expect(sqlStr).toContain("r2_put");
    expect(sqlStr).toContain("cloudflare_r2");
    expect(sqlStr).toContain('"actual_call_count":1');
    expect(sqlStr).toContain('"success":true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2 — PUT bytes: units.bytes 정확
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2. PUT bytes — units.bytes 정확", () => {
  it("buffer.length가 units.bytes에 정확히 기록된다", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    const payload = Buffer.from("payload-data-12345");
    const { uploadToR2 } = await import("../../lib/objectStorage.js");
    await uploadToR2("test/key2.jpg", payload, "image/jpeg");
    await new Promise((r) => setTimeout(r, 20));

    const sqlStr = await getLastSqlStr();
    // units: { bytes: 18 } serialized as part of metadata JSON
    expect(sqlStr).toContain(`"bytes":${payload.length}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3 — R2 GET 성공: service=r2_get / actual_call_count=1
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3. R2 GET 성공 → service=r2_get, actual_call_count=1", () => {
  it("downloadFromR2 성공 시 r2_get 기록", async () => {
    const fakeData = Buffer.from("file-content-xyz");
    s3Mock.on(GetObjectCommand).resolves({ Body: makeBodyStream(fakeData) });

    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    const { downloadFromR2 } = await import("../../lib/objectStorage.js");
    const result = await downloadFromR2("test/key3.jpg");
    await new Promise((r) => setTimeout(r, 20));

    expect(result.ok).toBe(true);
    expect(executeMock).toHaveBeenCalled();
    const sqlStr = await getLastSqlStr();
    expect(sqlStr).toContain("r2_get");
    expect(sqlStr).toContain('"actual_call_count":1');
    expect(sqlStr).toContain('"success":true');
    // bytes should be recorded after full read
    expect(sqlStr).toContain(`"bytes":${fakeData.length}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4 — R2 DELETE 성공: service=r2_delete / actual_call_count=1
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4. R2 DELETE 성공 → service=r2_delete, actual_call_count=1", () => {
  it("deleteFromR2 성공 시 r2_delete 기록", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});

    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    const { deleteFromR2 } = await import("../../lib/objectStorage.js");
    await deleteFromR2("test/key4.jpg");
    await new Promise((r) => setTimeout(r, 20));

    expect(executeMock).toHaveBeenCalled();
    const sqlStr = await getLastSqlStr();
    expect(sqlStr).toContain("r2_delete");
    expect(sqlStr).toContain('"actual_call_count":1');
    expect(sqlStr).toContain('"success":true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5 — confirmed HTTP provider error: success=false / actual_call_count=1
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5. confirmed HTTP provider error → success=false, actual_call_count=1", () => {
  it("S3 서버가 4xx 응답 시($metadata.httpStatusCode 존재) → actual_call_count=1 기록", async () => {
    // Simulate a provider error WITH an HTTP status code (e.g. 403 AccessDenied)
    // aws-sdk-client-mock: use `.rejects()` then attach $metadata manually via Error object
    const awsErr = Object.assign(new Error("AccessDenied"), {
      $metadata: { httpStatusCode: 403 },
    });
    s3Mock.on(PutObjectCommand).rejects(awsErr);

    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    const { uploadToR2 } = await import("../../lib/objectStorage.js");
    const result = await uploadToR2("test/fail5.jpg", Buffer.from("x"), "image/jpeg");
    await new Promise((r) => setTimeout(r, 20));

    // original behavior preserved: returns { ok: false }
    expect(result.ok).toBe(false);

    expect(executeMock).toHaveBeenCalled();
    const sqlStr = await getLastSqlStr();
    expect(sqlStr).toContain('"success":false');
    // HTTP was confirmed (403) → actual_call_count=1
    expect(sqlStr).toContain('"actual_call_count":1');
    expect(sqlStr).toContain('"error_type"');
    expect(sqlStr).toContain("AccessDenied");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6 — pre-HTTP SDK failure → actual_call_count absent (not recorded as 1)
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6. pre-HTTP SDK/credentials failure → actual_call_count field absent", () => {
  it("$metadata.httpStatusCode 없는 오류 → actual_call_count 기록 안 됨", async () => {
    // Simulate a credentials/serialization error WITHOUT $metadata.httpStatusCode
    const localErr = new Error("CredentialsProviderError: Could not load credentials");
    // No $metadata attached — mimics local SDK failure before HTTP
    s3Mock.on(DeleteObjectCommand).rejects(localErr);

    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    const { deleteFromR2 } = await import("../../lib/objectStorage.js");
    // deleteFromR2 swallows errors — should not throw
    await deleteFromR2("ghost/key6.jpg");
    await new Promise((r) => setTimeout(r, 20));

    expect(executeMock).toHaveBeenCalled();
    const sqlStr = await getLastSqlStr();
    expect(sqlStr).toContain('"success":false');
    // actual_call_count must be ABSENT — not "1" — because HTTP was not confirmed
    expect(sqlStr).not.toContain('"actual_call_count"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7 — 단가 미확정: estimated_cost_usd=null / cost_source=UNKNOWN
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7. 단가 미확정 → estimated_cost_usd=null, cost_source=UNKNOWN", () => {
  it("PUT 성공 시 estimated_cost_usd absent / cost_source=UNKNOWN", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    const { uploadToR2 } = await import("../../lib/objectStorage.js");
    await uploadToR2("test/key7.jpg", Buffer.from("abc"), "image/jpeg");
    await new Promise((r) => setTimeout(r, 20));

    const sqlStr = await getLastSqlStr();
    expect(sqlStr).toContain('"cost_source":"UNKNOWN"');
    // estimated_cost_usd=null → absent in metadata (per saveExternalUsage logic)
    expect(sqlStr).not.toContain('"estimated_cost_usd"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8 — saveExternalUsage 실패 → R2 본 동작 결과 불변
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8. saveExternalUsage DB 실패 → R2 본 동작 결과 불변", () => {
  it("execute 실패해도 uploadToR2 성공 결과 유지", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockRejectedValueOnce(new Error("DB down"));

    const { uploadToR2 } = await import("../../lib/objectStorage.js");
    const result = await uploadToR2("test/key8.jpg", Buffer.from("data"), "image/jpeg");

    // R2 upload succeeded; DB failure must not flip the result
    expect(result.ok).toBe(true);
  });

  it("execute 실패해도 deleteFromR2 정상 반환 (void)", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockRejectedValueOnce(new Error("DB timeout"));

    const { deleteFromR2 } = await import("../../lib/objectStorage.js");
    await expect(deleteFromR2("test/key8b.jpg")).resolves.toBeUndefined();
  });
});
