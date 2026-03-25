import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "swim-platform-secret-key-2024";
const BASE = "http://localhost:8080/api";
const token = jwt.sign(
  { userId: "test-super-admin", role: "super_admin", name: "테스트관리자" },
  JWT_SECRET, { expiresIn: "1h" }
);

async function api(method: string, path: string, body?: object) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 300) }; }
}

async function main() {
  // 수영장 검색
  const pools = await api("GET", "/super/pools/search?q=") as any;
  const pool = (pools.pools ?? [])[0];
  if (!pool) { console.log("수영장 없음"); process.exit(0); }
  console.log(`수영장: ${pool.name} (${pool.id})`);

  // 백업 목록
  const bkList = await api("GET", "/super/backups") as any;
  const bk = (bkList.backups ?? [])[0];
  if (!bk) { console.log("백업 없음"); process.exit(0); }
  console.log(`백업: ${bk.id}`);

  // 수영장별 복구
  console.log("\n=== 수영장별 복구 ===");
  const restore = await api("POST", "/super/restore/pool", {
    pool_id: pool.id,
    backup_id: bk.id,
    confirmed_pool_name: pool.name,
  }) as any;

  if (restore.error || restore._raw) { console.error("복구 실패:", restore); process.exit(1); }
  console.log(JSON.stringify({
    ok: restore.ok,
    pool_name: restore.pool_name,
    rows_restored: restore.rows_restored,
    warning_count: restore.warning_count,
  }, null, 2));
  console.log("\n--- warning_details ---");
  console.log(JSON.stringify(restore.warning_details, null, 2));

  const logs = await api("GET", "/super/restore/logs") as any;
  const entry = (logs.logs ?? []).find((l: any) => l.id === restore.log_id);
  if (entry) {
    console.log("\n=== restore_logs DB 저장값 ===");
    console.log(JSON.stringify({ status: entry.status, warning_count: entry.warning_count, warning_details: entry.warning_details }, null, 2));
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
