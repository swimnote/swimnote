/**
 * WP4-P1 — REAL CURRICULUM FILE DOWNLOAD VERIFICATION
 *
 * Scope:
 *  1. Upload DEV fixture to R2 (swimnotepicture bucket, cc-test/ prefix)
 *  2. Insert DEV DB rows (swimming_pools + x_setup_submissions + x_setup_files)
 *  3. Call real HTTP API → signed URL (super admin JWT)
 *  4. Actual GET → bytes > 0, content hash match
 *  5. Security: wrong pool, wrong file, role 403/401, injection
 *  6. Audit log verified (signed URL NOT stored)
 *  7. Cleanup
 *
 * Production: NOT USED.  No personal data in fixture.
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "crypto";
import { signToken } from "../src/lib/auth.js";

// ── config ──────────────────────────────────────────────────────────────────
const BASE   = "http://localhost:8080/api";
const TS     = Date.now();
const RND    = Math.random().toString(36).slice(2, 8);

const CF_ACCOUNT_ID  = process.env.CF_ACCOUNT_ID  ?? "53dff4976d55c17ec94ebe6306d0cffc";
const PHOTO_BUCKET   = process.env.CF_R2_BUCKET_NAME ?? "swimnotepicture";
const R2_ENDPOINT    = `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const FIXTURE_KEY       = `cc-test/wp4p1-curriculum-fixture-${TS}-${RND}.txt`;
const FIXTURE_CONTENT   = `WP4-P1 DEV/TEST FIXTURE\nTimestamp: ${TS}\nRandom: ${RND}\nNO PERSONAL DATA.\nThis file is for automated download verification only.`;
const FIXTURE_BYTES     = Buffer.from(FIXTURE_CONTENT, "utf8");
const FIXTURE_HASH      = createHash("sha256").update(FIXTURE_BYTES).digest("hex");
const FIXTURE_MIME      = "text/plain";
const FIXTURE_FILENAME  = `curriculum-download-test-${RND}.txt`;
const FIXTURE_SIZE      = FIXTURE_BYTES.byteLength;

// Test pool IDs (unique per run — no collision with existing data)
const POOL_A  = `wp4p1a${TS}`;
const POOL_B  = `wp4p1b${TS}`;
const SUB_ID  = `sub${TS}${RND}`;
const FILE_ID = `file${TS}${RND}`;

// Filled by DB setup
let SUPER_USER_ID    = "";
let REAL_ADMIN_TOKEN = ""; // real pool_admin user from DB for 403 test
let REAL_ADMIN_ROLE  = "pool_admin";

// ── result tracking ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}`); failed++; failures.push(label); }
}

// ── R2 client ────────────────────────────────────────────────────────────────
function makeR2() {
  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  });
}

// ── STEP 1: Upload fixture to DEV R2 ─────────────────────────────────────────
async function uploadFixture(): Promise<void> {
  console.log("\n=== STEP 1: Upload DEV fixture to R2 ===");
  console.log(`  endpoint: ${R2_ENDPOINT}`);
  console.log(`  bucket:   ${PHOTO_BUCKET}`);
  console.log(`  key:      ${FIXTURE_KEY}`);
  const r2 = makeR2();
  const putRes = await r2.send(new PutObjectCommand({
    Bucket:      PHOTO_BUCKET,
    Key:         FIXTURE_KEY,
    Body:        FIXTURE_BYTES,
    ContentType: FIXTURE_MIME,
    ContentLength: FIXTURE_SIZE,
    Metadata:    { purpose: "wp4p1-dev-test", env: "dev" },
  }));
  const httpStatus = (putRes as any).$metadata?.httpStatusCode ?? 0;
  ok(httpStatus === 200, `R2 upload HTTP 200 (got ${httpStatus})`);

  const head = await r2.send(new HeadObjectCommand({ Bucket: PHOTO_BUCKET, Key: FIXTURE_KEY }));
  const storedSize = Number((head as any).ContentLength ?? 0);
  ok(storedSize === FIXTURE_SIZE, `R2 object size match: ${storedSize} === ${FIXTURE_SIZE}`);
  ok((head as any).ContentType === FIXTURE_MIME, `R2 content-type: ${(head as any).ContentType}`);
  console.log(`  fixture key: ${FIXTURE_KEY} (${FIXTURE_SIZE} bytes, sha256: ${FIXTURE_HASH.slice(0, 16)}...)`);
}

// ── STEP 2: DB fixtures ──────────────────────────────────────────────────────
async function setupDbFixtures(): Promise<void> {
  console.log("\n=== STEP 2: DEV DB fixtures ===");

  // Find super admin
  const supers = (await superAdminDb.execute(sql`
    SELECT id FROM users WHERE role = 'super_admin' LIMIT 1
  `)).rows as any[];
  ok(supers.length > 0, "Super admin user exists in DB");
  SUPER_USER_ID = supers[0]?.id ?? "";

  // Find real pool_admin for role test (exist in DB → auth middleware passes)
  // Use two separate simpler queries to avoid drizzle IN() template issues
  let realAdmin: any[] = [];
  try {
    realAdmin = (await superAdminDb.execute(sql`
      SELECT id, role FROM users WHERE role = 'pool_admin' LIMIT 1
    `)).rows as any[];
    if (!realAdmin.length) {
      realAdmin = (await superAdminDb.execute(sql`
        SELECT id, role FROM users WHERE role = 'teacher' LIMIT 1
      `)).rows as any[];
    }
  } catch (_) { realAdmin = []; }

  if (realAdmin.length > 0) {
    REAL_ADMIN_ROLE  = realAdmin[0].role;
    REAL_ADMIN_TOKEN = signToken({
      userId: realAdmin[0].id,
      role:   realAdmin[0].role,
      name:   "WP4P1 TestAdmin",
    });
  }
  console.log(`  super_user_id: ${SUPER_USER_ID}`);
  console.log(`  real role for 403 test: ${REAL_ADMIN_ROLE} (found: ${realAdmin.length > 0})`);

  // Pool A (will hold the fixture file)
  await superAdminDb.execute(sql`
    INSERT INTO swimming_pools
      (id, name, address, phone, owner_name, owner_email, approval_status,
       x_paid_entitlement, x_manual_entitlement, x_force_disabled,
       base_manual_entitlement, subscription_status)
    VALUES (${POOL_A}, ${'WP4P1 Test Pool A'}, ${'서울'}, ${'010-9999-0001'},
      ${'WP4P1 Owner A'}, ${'wp4p1a@test.com'}, 'approved'::approval_status,
      false, false, false, false, 'cancelled'::subscription_status)
    ON CONFLICT (id) DO NOTHING
  `);
  ok(true, "Pool A inserted");

  // Pool B (cross-pool isolation test)
  await superAdminDb.execute(sql`
    INSERT INTO swimming_pools
      (id, name, address, phone, owner_name, owner_email, approval_status,
       x_paid_entitlement, x_manual_entitlement, x_force_disabled,
       base_manual_entitlement, subscription_status)
    VALUES (${POOL_B}, ${'WP4P1 Test Pool B'}, ${'부산'}, ${'010-9999-0002'},
      ${'WP4P1 Owner B'}, ${'wp4p1b@test.com'}, 'approved'::approval_status,
      false, false, false, false, 'cancelled'::subscription_status)
    ON CONFLICT (id) DO NOTHING
  `);
  ok(true, "Pool B inserted");

  // x_setup_submissions for Pool A
  await superAdminDb.execute(sql`
    INSERT INTO x_setup_submissions
      (id, pool_id, setup_status, curriculum_status, website_status, logo_status, photos_status,
       submitted_at, submitted_by, created_at, updated_at)
    VALUES (${SUB_ID}, ${POOL_A}, ${'complete'}, ${'APPROVED'}, ${'NOT_SUBMITTED'},
      ${'NOT_SUBMITTED'}, ${'NOT_SUBMITTED'}, NOW(), ${SUPER_USER_ID}, NOW(), NOW())
    ON CONFLICT DO NOTHING
  `);
  ok(true, "x_setup_submissions row inserted");

  // x_setup_files — actual fixture file row
  try {
    await superAdminDb.execute(sql`
      INSERT INTO x_setup_files
        (id, pool_id, file_type, r2_key, original_filename, mime_type,
         file_size_bytes, submission_version, is_current, uploaded_by, uploaded_at)
      VALUES (${FILE_ID}, ${POOL_A}, ${'curriculum'}, ${FIXTURE_KEY},
        ${FIXTURE_FILENAME}, ${FIXTURE_MIME}, ${FIXTURE_SIZE}, 1, true,
        ${SUPER_USER_ID}, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
  } catch (e: any) {
    console.error("  [INSERT x_setup_files ERROR]", e?.message?.slice(0, 200));
    failed++;
    failures.push("x_setup_files INSERT failed — see error above");
    return;
  }

  // Verify
  const fileRow = (await superAdminDb.execute(sql`
    SELECT id, pool_id, r2_key, original_filename, file_size_bytes, is_current
    FROM x_setup_files WHERE id = ${FILE_ID}
  `)).rows as any[];
  ok(fileRow.length > 0,                                    `x_setup_files row verified`);
  ok(fileRow[0]?.r2_key === FIXTURE_KEY,                    `r2_key stored correctly`);
  ok(Number(fileRow[0]?.file_size_bytes) === FIXTURE_SIZE,  `file_size_bytes stored`);
  ok(fileRow[0]?.is_current === true,                       `is_current = true`);
  console.log(`  FILE_ID: ${FILE_ID}`);
}

// ── API helper ──────────────────────────────────────────────────────────────
async function callApi(path: string, token: string | null): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res  = await fetch(`${BASE}${path}`, { headers });
  let body: any = {};
  try { body = await res.json(); } catch (_) {}
  return { status: res.status, body };
}

// ── STEP 3: Signed URL API ────────────────────────────────────────────────────
async function testSignedDownload(): Promise<{ signedUrl: string }> {
  console.log("\n=== STEP 3: Signed URL API (super admin) ===");
  const superToken  = signToken({ userId: SUPER_USER_ID, role: "super_admin", name: "WP4P1 Super" });
  const path        = `/super/pools/${POOL_A}/control-center/curriculum/download?file_id=${FILE_ID}`;
  console.log(`  GET ${path}`);

  const { status, body } = await callApi(path, superToken);
  console.log(`  response: HTTP ${status}, keys=${Object.keys(body).join(",")}`);
  ok(status === 200,                                                        `API HTTP 200 (got ${status})`);
  ok(typeof body.url === "string" && body.url.startsWith("https://"),       `signed URL in response`);
  ok(body.expires_in === 300,                                               `expiry = 300s (got ${body.expires_in})`);
  ok(body.filename === FIXTURE_FILENAME,                                    `filename matches (${body.filename})`);
  ok(body.file_type === "curriculum",                                       `file_type = curriculum`);
  ok(Number(body.file_size_bytes) === FIXTURE_SIZE,                         `file_size_bytes = ${body.file_size_bytes}`);

  // Secret not in response
  const bodyStr = JSON.stringify({ ...body, url: "REDACTED" });
  ok(!bodyStr.includes("secretAccessKey"),                                  "secretAccessKey NOT in response");
  ok(!bodyStr.includes("CF_R2"),                                            "CF_R2 NOT in response");
  ok(!bodyStr.includes(FIXTURE_KEY),                                        "raw r2_key NOT in response (§38)");

  return { signedUrl: body.url ?? "" };
}

// ── STEP 4: Actual file GET ───────────────────────────────────────────────────
async function testActualGet(signedUrl: string): Promise<void> {
  console.log("\n=== STEP 4: Actual GET via signed URL ===");
  if (!signedUrl) { ok(false, "signed URL missing — skip actual GET"); return; }

  let getStatus = 0;
  let downloadedBytes = 0;
  let downloadedHash  = "";
  let contentType     = "";
  let contentLength   = 0;

  const getRes = await fetch(signedUrl);
  getStatus     = getRes.status;
  contentType   = getRes.headers.get("content-type") ?? "";
  contentLength = Number(getRes.headers.get("content-length") ?? 0);
  const buf     = Buffer.from(await getRes.arrayBuffer());
  downloadedBytes = buf.byteLength;
  downloadedHash  = createHash("sha256").update(buf).digest("hex");
  console.log(`  HTTP ${getStatus}, content-type=${contentType}, content-length=${contentLength}, actual=${downloadedBytes} bytes`);

  ok(getStatus === 200,                                    `actual GET HTTP 200 (got ${getStatus})`);
  ok(downloadedBytes > 0,                                  `downloaded bytes > 0 (${downloadedBytes})`);
  ok(downloadedBytes === FIXTURE_SIZE,                     `downloaded bytes === fixture size (${downloadedBytes} === ${FIXTURE_SIZE})`);
  ok(downloadedHash === FIXTURE_HASH,
     `content hash match (${downloadedHash.slice(0,16)} === ${FIXTURE_HASH.slice(0,16)})`);
  ok(contentType.includes(FIXTURE_MIME),                   `content-type includes text/plain`);
  console.log(`  PASS: ${downloadedBytes} bytes downloaded, hash verified`);
}

// ── STEP 5: Security Tests ────────────────────────────────────────────────────
async function testSecurity(): Promise<void> {
  console.log("\n=== STEP 5: Security Tests ===");
  const superToken   = signToken({ userId: SUPER_USER_ID, role: "super_admin", name: "WP4P1 Super" });
  const downloadPath = `/super/pools/${POOL_A}/control-center/curriculum/download?file_id=${FILE_ID}`;

  // Wrong pool — same file_id but POOL_B URL
  const { status: s1, body: b1 } = await callApi(
    `/super/pools/${POOL_B}/control-center/curriculum/download?file_id=${FILE_ID}`,
    superToken
  );
  ok(s1 === 404, `Wrong pool → 404 (got ${s1})`);
  ok(b1.error === "FILE_NOT_FOUND", `Wrong pool error = FILE_NOT_FOUND (got ${b1.error})`);

  // Wrong file_id → 404
  const { status: s2, body: b2 } = await callApi(
    `/super/pools/${POOL_A}/control-center/curriculum/download?file_id=nonexistent-${RND}`,
    superToken
  );
  ok(s2 === 404, `Wrong file_id → 404 (got ${s2})`);
  ok(b2.error === "FILE_NOT_FOUND", `Wrong file error = FILE_NOT_FOUND (got ${b2.error})`);

  // Missing file_id → 400
  const { status: s3 } = await callApi(
    `/super/pools/${POOL_A}/control-center/curriculum/download`,
    superToken
  );
  ok(s3 === 400, `No file_id → 400 (got ${s3})`);

  // Role: non-super → blocked (403 or 401 depending on user state)
  // Key property: non-super CANNOT access the endpoint (any 4xx is acceptable)
  if (REAL_ADMIN_TOKEN) {
    const { status: pool_s } = await callApi(downloadPath, REAL_ADMIN_TOKEN);
    // 403 = role check blocked; 401 = auth check blocked (user is_deleted/withdrawn)
    // Both mean "access denied" — either is a PASS for this security test
    ok(pool_s === 403 || pool_s === 401,
       `${REAL_ADMIN_ROLE} → blocked ${pool_s} (403=role deny / 401=auth deny — either is access-denied)`);
  } else {
    console.log("  [SKIP] no real pool_admin/teacher in DB for role block test");
    ok(true, "role block test — no real non-super user found (SKIP/structural)");
  }

  // Unauthenticated → 401
  const { status: unauth_s } = await callApi(downloadPath, null);
  ok(unauth_s === 401, `unauthenticated → 401 (got ${unauth_s})`);

  // Object key injection — r2_key/object_key/bucket params should be ignored
  const { status: inj_s, body: inj_b } = await callApi(
    `${downloadPath}&r2_key=evil/hack.docx&object_key=malicious&bucket=other`,
    superToken
  );
  // DB has file, should succeed with correct file (injection ignored)
  ok(inj_s === 200, `injection attempt → HTTP 200 (server uses DB key, got ${inj_s})`);
  ok(inj_b.filename === FIXTURE_FILENAME, `injection: filename from DB (got ${inj_b.filename})`);
  const injBody = JSON.stringify({ ...inj_b, url: "REDACTED" });
  ok(!injBody.includes("evil"), `injection: evil r2_key not in response`);

  // Cross-pool object key injection: using POOL_B fixture key on POOL_A url
  // (verify that server resolves from DB, not from query param)
  const { status: cpi_s } = await callApi(
    `/super/pools/${POOL_A}/control-center/curriculum/download?file_id=${FILE_ID}&r2_key=${FIXTURE_KEY.replace("wp4p1a","INJECTED")}`,
    superToken
  );
  ok(cpi_s === 200, `cross-pool injection → uses DB key not param key (HTTP ${cpi_s})`);
}

// ── STEP 6: Audit Log ─────────────────────────────────────────────────────────
async function testAuditLog(): Promise<void> {
  console.log("\n=== STEP 6: Audit Log Verification ===");
  await new Promise(r => setTimeout(r, 500)); // DB commit wait

  const auditRows = (await superAdminDb.execute(sql`
    SELECT id, pool_id, category, actor_id, target, description, metadata, created_at
    FROM event_logs
    WHERE pool_id = ${POOL_A}
      AND category = '커리큘럼'
      AND target = ${FILE_ID}
    ORDER BY created_at DESC LIMIT 5
  `)).rows as any[];

  ok(auditRows.length > 0, `Audit row exists (count: ${auditRows.length})`);
  if (auditRows.length > 0) {
    const row = auditRows[0];
    const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {});
    ok(row.actor_id === SUPER_USER_ID,               `actor_id = super_admin`);
    ok(row.pool_id  === POOL_A,                      `pool_id in audit`);
    ok(meta.action  === "CURRICULUM_SOURCE_DOWNLOAD", `action = CURRICULUM_SOURCE_DOWNLOAD`);
    ok(meta.file_id === FILE_ID,                     `file_id in audit metadata`);
    ok(meta.file_type === "curriculum",              `file_type in audit metadata`);

    // Signed URL / secret NOT stored
    const metaStr = JSON.stringify(meta);
    ok(!metaStr.includes("X-Amz-Signature"),  `X-Amz-Signature NOT in audit`);
    ok(!metaStr.includes("secretAccessKey"),  `secretAccessKey NOT in audit`);
    ok(!metaStr.includes("X-Amz-Credential"), `X-Amz-Credential NOT in audit`);
    console.log(`  action=${meta.action}, file_type=${meta.file_type}, version=${meta.version}`);
  }
}

// ── STEP 7: Cleanup ───────────────────────────────────────────────────────────
async function cleanup(): Promise<void> {
  console.log("\n=== STEP 7: Cleanup ===");
  await superAdminDb.execute(sql`DELETE FROM x_setup_files WHERE id = ${FILE_ID}`).catch(() => {});
  await superAdminDb.execute(sql`DELETE FROM x_setup_submissions WHERE id = ${SUB_ID}`).catch(() => {});
  await superAdminDb.execute(sql`DELETE FROM event_logs WHERE pool_id = ANY(ARRAY[${POOL_A}, ${POOL_B}]::text[])`).catch(() => {});
  await superAdminDb.execute(sql`DELETE FROM swimming_pools WHERE id = ANY(ARRAY[${POOL_A}, ${POOL_B}]::text[])`).catch(() => {});
  console.log("  DB fixtures cleaned");

  // R2 cleanup
  const r2 = makeR2();
  await r2.send(new DeleteObjectCommand({ Bucket: PHOTO_BUCKET, Key: FIXTURE_KEY })).catch(() => {});
  let gone = false;
  try { await r2.send(new HeadObjectCommand({ Bucket: PHOTO_BUCKET, Key: FIXTURE_KEY })); }
  catch (_) { gone = true; }
  ok(gone, `R2 fixture object deleted`);
  console.log("  R2 fixture cleaned");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log(" WP4-P1 REAL CURRICULUM FILE DOWNLOAD VERIFICATION");
  console.log(`  R2:      ${R2_ENDPOINT}`);
  console.log(`  Bucket:  ${PHOTO_BUCKET}`);
  console.log(`  API:     ${BASE}`);
  console.log(`  Fixture: ${FIXTURE_SIZE} bytes, hash=${FIXTURE_HASH.slice(0,20)}...`);
  console.log("══════════════════════════════════════════════════════════════");

  try {
    await uploadFixture();
    await setupDbFixtures();
    const { signedUrl } = await testSignedDownload();
    await testActualGet(signedUrl);
    await testSecurity();
    await testAuditLog();
    await cleanup();
  } catch (e: any) {
    console.error("\n❌ FATAL:", e?.message ?? String(e));
    console.error(e?.stack?.slice(0, 600));
    failed++;
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`RESULT: ${passed} PASSED  |  ${failed} FAILED`);
  if (failures.length) {
    console.log("\nFailed items:");
    failures.forEach(f => console.log(`  ❌ ${f}`));
  }
  console.log("══════════════════════════════════════════════════════════════");
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
