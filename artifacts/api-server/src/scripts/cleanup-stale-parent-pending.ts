/**
 * Read-only stale-pending audit. Apply is permanently disabled.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

const RELEASE_CUTOFF = "2026-10-01T09:28:37.451Z";
const EXPECTED_TARGETS = 0;
const FILE = "/tmp/swimnote-parent-pending-stale-allowlist.json";
const DATABASE_FINGERPRINT = "8bd33533de832592b055069741912e7edc1c40d00e53a876f23b11e680677109";
type Pending = { id: string; parent_id: string; pool_id: string; status: string; created_at: Date | string; matched_student_id: string | null };
type Parent = { id: string; swimming_pool_id: string; is_active: boolean; withdrawal_requested_at: Date | string | null };
type Relation = { id: string; parent_id: string; student_id: string; swimming_pool_id: string; status: string; student: Record<string, unknown> };
type Target = { id: string; parent_id: string; pool_id: string; eligible_student_ids: string[] };
type Allowlist = { cutoff: string; source: string; captured_at: string; targets: Target[]; untouched_pending_ids: string[] };
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

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
      new Date(p.created_at).getTime() >= new Date(RELEASE_CUTOFF).getTime() ||
      !p.matched_student_id) return [];
  const matches = rows.filter(r => {
    const s = r.student;
    return r.parent_id === p.parent_id
      && r.student_id === p.matched_student_id
      && r.swimming_pool_id === p.pool_id
      && r.status === "approved"
      && s.id === p.matched_student_id
      && s.swimming_pool_id === p.pool_id
      && ["active", "pending_parent_link"].includes(String(s.status))
      && s.deleted_at == null
      && s.withdrawn_at == null;
  });
  return matches.length === 1 ? [p.matched_student_id] : [];
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

export function assertCleanupApplyDisabled(): never {
  throw new Error("STALE_PENDING_CLEANUP_APPLY_DISABLED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode] = process.argv.slice(2);
  if (mode === "apply") {
    try {
      assertCleanupApplyDisabled();
    } catch {
      console.error("STALE_PENDING_CLEANUP_APPLY_DISABLED");
      process.exitCode = 1;
    }
  } else if (mode === "capture") {
    capture().catch(() => {
      console.error("STALE_PENDING_REPAIR_FAILED");
      process.exitCode = 1;
    }).finally(() => pool.end());
  } else {
    console.error("EXPLICIT_CAPTURE_OR_APPLY_REQUIRED");
    process.exitCode = 1;
  }
}