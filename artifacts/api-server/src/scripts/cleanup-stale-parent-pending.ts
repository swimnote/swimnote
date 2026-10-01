/**
 * Explicit, operator-authorized metadata repair. Never imported by the server.
 * Capture is read-only. Apply requires the exact LIVE source and OTA receipt.
 * Neither mode creates relationships or updates students/accounts.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pool } from "@workspace/db";

const RELEASE_CUTOFF = "2026-10-01T09:28:37.451Z";
const EXPECTED_TARGETS = 9;
const FILE = "/tmp/swimnote-parent-pending-stale-allowlist.json";
const API_HEALTH = "https://swimnote-api.onrender.com/healthz";
// Frozen immediately after the authorized predeployment read-only capture.
// These hashes disclose no account IDs, database addresses, or credentials.
const ALLOWLIST_FINGERPRINT = "64b641990016260910cae83795a4993446518216ff84b57358edd134e02477fd";
const DATABASE_FINGERPRINT = "8bd33533de832592b055069741912e7edc1c40d00e53a876f23b11e680677109";
type Pending = { id: string; parent_id: string; pool_id: string; status: string; created_at: Date | string; parent_phone_normalized: string; matched_student_id: string | null };
type Parent = { id: string; swimming_pool_id: string; phone: string; is_active: boolean; withdrawal_requested_at: Date | string | null };
type Relation = { id: string; parent_id: string; student_id: string; swimming_pool_id: string; status: string; student: Record<string, unknown> };
type Target = { id: string; parent_id: string; pool_id: string; eligible_student_ids: string[] };
type Allowlist = { cutoff: string; source: string; captured_at: string; targets: Target[]; untouched_pending_ids: string[] };
const phone = (v: unknown) => typeof v === "string" ? v.replace(/[^0-9]/g, "") : "";
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

export function originalAllowlistIsTrusted(value: unknown): boolean {
  return digest(value) === ALLOWLIST_FINGERPRINT;
}

export function otaReceiptsMatch(updates: any[], sha: string, ios: string, android: string, group: string): boolean {
  if (!Array.isArray(updates) || !/^[a-f0-9]{40}$/.test(sha)) return false;
  return [["ios", ios], ["android", android]].every(([platform, id]) =>
    updates.some(u => u.id === id && u.platform === platform &&
      u.group === group && u.branch?.name === "production-v2" &&
      u.runtimeVersion === "2.2.0" && u.gitCommitHash === sha));
}

export function productionChannelMapsToUpdates(value: any, updates: any[]): boolean {
  try {
    const channel = value?.currentPage ?? value;
    if (channel?.name !== "production-v2" || channel.isPaused !== false ||
        !Array.isArray(updates) || updates.length < 2) return false;
    const mapping = JSON.parse(channel.branchMapping);
    if (mapping.version !== 0 || !Array.isArray(mapping.data) || mapping.data.length !== 1 ||
        mapping.data[0].branchMappingLogic !== "true") return false;
    const branchId = mapping.data[0].branchId;
    return typeof branchId === "string" &&
      channel.updateBranches?.some((b: any) => b.id === branchId && b.name === "production-v2") &&
      updates.every(u => u.branch?.id === branchId && u.branch?.name === "production-v2");
  } catch { return false; }
}

function assertProductionDatabase() {
  if (!process.env.SUPABASE_DATABASE_URL) throw new Error("EXPLICIT_PRODUCTION_DATABASE_REQUIRED");
  const { host, port, database, user } = pool.options;
  if (digest({ host, port, database, user }) !== DATABASE_FINGERPRINT) {
    throw new Error("PRODUCTION_DATABASE_TARGET_CHANGED");
  }
}

export function eligibleExistingStudents(p: Pending, a: Parent | undefined, rows: Relation[]): string[] {
  if (!a || p.status !== "pending" || !a.is_active || a.withdrawal_requested_at ||
      a.id !== p.parent_id || a.swimming_pool_id !== p.pool_id ||
      new Date(p.created_at).getTime() >= new Date(RELEASE_CUTOFF).getTime()) return [];
  const ph = phone(a.phone);
  if (!/^01[016789]\d{7,8}$/.test(ph) || phone(p.parent_phone_normalized) !== ph) return [];
  // Do not repair/ignore an inconsistent approved relation.
  if (rows.some(r => r.parent_id !== p.parent_id || r.swimming_pool_id !== p.pool_id ||
      r.student.swimming_pool_id !== p.pool_id || r.status !== "approved")) return [];
  const eligible = rows.filter(r => {
    const s = r.student;
    return ["active", "pending_parent_link"].includes(String(s.status)) &&
      s.deleted_at == null && s.withdrawn_at == null &&
      [s.parent_phone, s.parent_phone2, s.parent_phone3, s.parent_phone4].some(n => phone(n) === ph);
  }).map(r => r.student_id).sort();
  if (p.matched_student_id && !eligible.includes(p.matched_student_id)) return [];
  return [...new Set(eligible)];
}

async function counts(c: { query: Function }) {
  const { rows } = await c.query(`SELECT count(*)::int AS raw_pending,
    count(a.id)::int AS visible_pending FROM parent_v2_pending p
    LEFT JOIN parent_accounts a ON a.id=p.parent_id WHERE p.status='pending'`);
  return rows[0];
}

async function relations(c: { query: Function }, parentId: string, lock = false): Promise<Relation[]> {
  return (await c.query(`SELECT ps.*,row_to_json(s) AS student
    FROM parent_students ps JOIN students s ON s.id=ps.student_id
    WHERE ps.parent_id=$1 AND ps.status='approved' ORDER BY ps.id
    ${lock ? "FOR SHARE OF ps,s" : ""}`, [parentId])).rows;
}

async function capture() {
  assertProductionDatabase();
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const pending: Pending[] = (await c.query(`SELECT p.* FROM parent_v2_pending p
      JOIN parent_accounts a ON a.id=p.parent_id WHERE p.status='pending' ORDER BY p.id`)).rows;
    const targets: Target[] = [];
    for (const p of pending) {
      const a = (await c.query("SELECT * FROM parent_accounts WHERE id=$1", [p.parent_id])).rows[0];
      const eligible = eligibleExistingStudents(p, a, await relations(c, p.parent_id));
      if (eligible.length) targets.push({ id: p.id, parent_id: p.parent_id, pool_id: p.pool_id, eligible_student_ids: eligible });
    }
    if (targets.length !== EXPECTED_TARGETS) throw new Error("CAPTURE_TARGET_COUNT_CHANGED");
    const allowlist: Allowlist = {
      cutoff: RELEASE_CUTOFF, source: "authorized-existing-approved-stale-pending",
      captured_at: new Date().toISOString(), targets,
      untouched_pending_ids: pending.filter(p => !targets.some(t => t.id === p.id)).map(p => p.id),
    };
    await writeFile(FILE, JSON.stringify(allowlist), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ mode: "capture", transaction_read_only: "on", counts: await counts(c),
      target_count: targets.length, untouched_visible_pending: allowlist.untouched_pending_ids.length,
      allowlist_fingerprint: digest(allowlist), production_writes: 0 }));
    await c.query("ROLLBACK");
  } catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}

async function apply(expectedSha: string, iosUpdate: string, androidUpdate: string, group: string) {
  assertProductionDatabase();
  if (!/^[a-f0-9]{40}$/.test(expectedSha) || !/^[a-f0-9-]{36}$/.test(iosUpdate) ||
      !/^[a-f0-9-]{36}$/.test(androidUpdate) || !/^[a-f0-9-]{36}$/.test(group) ||
      iosUpdate === androidUpdate) throw new Error("DEPLOYMENT_RECEIPT_REQUIRED");
  const res = await fetch(API_HEALTH);
  const health = await res.json() as { commit?: string };
  if (!res.ok || health.commit !== expectedSha) throw new Error("PRODUCTION_SOURCE_NOT_LIVE");
  const appDir = fileURLToPath(new URL("../../../swim-app/", import.meta.url));
  const { stdout } = await promisify(execFile)(join(appDir, "node_modules/.bin/eas"),
    ["update:view", group, "--json"], {
      cwd: appDir, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
    });
  const remoteUpdates = JSON.parse(stdout);
  if (!otaReceiptsMatch(remoteUpdates, expectedSha, iosUpdate, androidUpdate, group)) {
    throw new Error("BOTH_SUCCESSFUL_SOURCE_BOUND_OTA_RELEASES_REQUIRED");
  }
  const { stdout: channelStdout } = await promisify(execFile)(join(appDir, "node_modules/.bin/eas"),
    ["channel:view", "production-v2", "--json", "--non-interactive"], {
      cwd: appDir, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" },
    });
  if (!productionChannelMapsToUpdates(JSON.parse(channelStdout), remoteUpdates)) {
    throw new Error("ACTIVE_PRODUCTION_CHANNEL_BINDING_REQUIRED");
  }
  const list = JSON.parse(await readFile(FILE, "utf8")) as Allowlist;
  if (!originalAllowlistIsTrusted(list) ||
      list.source !== "authorized-existing-approved-stale-pending" || list.cutoff !== RELEASE_CUTOFF ||
      list.targets.length !== EXPECTED_TARGETS || new Set(list.targets.map(t => t.id)).size !== EXPECTED_TARGETS) {
    throw new Error("INVALID_ORIGINAL_ALLOWLIST");
  }
  const c = await pool.connect();
  try {
    const before = await counts(c);
    let completed = 0, skipped = 0;
    for (const target of list.targets) {
      await c.query("BEGIN");
      try {
        const p: Pending | undefined = (await c.query("SELECT * FROM parent_v2_pending WHERE id=$1 FOR UPDATE", [target.id])).rows[0];
        if (!p || p.parent_id !== target.parent_id || p.pool_id !== target.pool_id) {
          await c.query("ROLLBACK"); skipped++; continue;
        }
        const a: Parent | undefined = (await c.query("SELECT * FROM parent_accounts WHERE id=$1 FOR SHARE", [p.parent_id])).rows[0];
        const oldRelations = await relations(c, p.parent_id, true);
        const candidates = eligibleExistingStudents(p, a, oldRelations)
          .filter(id => target.eligible_student_ids.includes(id));
        if (!candidates.length) { await c.query("ROLLBACK"); skipped++; continue; }
        const fingerprint = digest(oldRelations);
        const result = await c.query(`UPDATE parent_v2_pending SET status='matched',
          matched_student_id=$1,matched_at=NOW()
          WHERE id=$2 AND parent_id=$3 AND pool_id=$4 AND status='pending' RETURNING id`,
          [p.matched_student_id || candidates[0], p.id, p.parent_id, p.pool_id]);
        if (result.rowCount !== 1 || digest(await relations(c, p.parent_id)) !== fingerprint) {
          throw new Error("RELATION_OR_STUDENT_PRESERVATION_FAILED");
        }
        await c.query("COMMIT"); completed++;
      } catch (e) { await c.query("ROLLBACK"); throw e; }
    }
    const untouched = (await c.query("SELECT count(*)::int AS n FROM parent_v2_pending WHERE id=ANY($1::text[]) AND status='pending'", [list.untouched_pending_ids])).rows[0].n;
    if (untouched !== list.untouched_pending_ids.length) throw new Error("UNTOUCHED_REQUEST_STATE_CHANGED");
    console.log(JSON.stringify({ mode: "apply", source: expectedSha, before, after: await counts(c),
      completed, skipped, untouched_pending: untouched, production_updates: completed,
      relationship_writes: 0, student_writes: 0, account_writes: 0 }));
  } finally { c.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, sha, ios, android, group] = process.argv.slice(2);
  (async () => {
    if (mode === "capture") await capture();
    else if (mode === "apply") await apply(sha, ios, android, group);
    else throw new Error("EXPLICIT_CAPTURE_OR_APPLY_REQUIRED");
  })().catch(() => {
    // Never print SQL errors that may contain private values.
    console.error("STALE_PENDING_REPAIR_FAILED"); process.exitCode = 1;
  }).finally(() => pool.end());
}