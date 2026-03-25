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
  return r.json() as any;
}

async function main() {
  // 가장 최근 백업으로 pool별 복구 (데이터 변경 없으므로 0행 예상)
  const bkList = await api("GET", "/super/backups");
  const bk = (bkList.backups ?? [])[0];
  if (!bk) { console.log("백업 없음"); process.exit(0); }

  const pools = await api("GET", "/super/pools/search?q=");
  const pool = (pools.pools ?? [])[0];
  if (!pool) { console.log("수영장 없음"); process.exit(0); }

  console.log(`백업: ${bk.id}, 수영장: ${pool.name}`);

  console.log("\n=== [수영장 복구 — 0행 케이스 검증] ===");
  const restore = await api("POST", "/super/restore/pool", {
    pool_id: pool.id,
    backup_id: bk.id,
    confirmed_pool_name: pool.name,
  });

  console.log(JSON.stringify({
    ok: restore.ok,
    rows_restored: restore.rows_restored,
    warning_count: restore.warning_count,
    reason_message: restore.reason_message,
  }, null, 2));

  // isEmpty 로직 검증
  const isEmpty = restore.rows_restored === 0 && restore.warning_count === 0;
  console.log(`\n→ isEmpty: ${isEmpty}`);
  console.log(`→ 앱 표시: ${isEmpty ? "복구 대상 없음 (amber info)" : "복구 완료 (green)"}`);
  console.log(`→ 메시지: ${isEmpty ? (restore.reason_message ?? "해당 백업 시점에 변경된 데이터가 없습니다.") : `${restore.rows_restored}행 복구`}`);

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
