import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "swim-platform-secret-key-2024";
const BASE = "http://localhost:8080/api";

const token = jwt.sign(
  { userId: "test-super-admin", role: "super_admin", name: "테스트관리자" },
  JWT_SECRET,
  { expiresIn: "1h" }
);

async function api(method: string, path: string, body?: object) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 200) }; }
}

async function main() {
  const BACKUP_ID = "bk_1774460556583_f9c0a0ff"; // 방금 생성한 백업

  console.log("\n=== [2] 전체 복구 ===");
  const restore = await api("POST", "/super/restore/full", {
    backup_id: BACKUP_ID,
    confirmed_text: "전체 복구",   // ← 실제 확인 문구
  }) as any;

  if (restore.error || restore._raw) { console.error("복구 실패:", restore); process.exit(1); }

  console.log(JSON.stringify({
    ok: restore.ok,
    tables_restored: restore.tables_restored,
    rows_restored: restore.rows_restored,
    warning_count: restore.warning_count,
  }, null, 2));
  console.log("\n--- warning_details ---");
  console.log(JSON.stringify(restore.warning_details, null, 2));
  const logId = restore.log_id;

  console.log("\n=== [3] restore_logs DB 저장값 ===");
  const logs = await api("GET", "/super/restore/logs") as any;
  const entry = (logs.logs ?? []).find((l: any) => l.id === logId);
  if (entry) {
    console.log(JSON.stringify({
      id: entry.id,
      status: entry.status,
      warning_count: entry.warning_count,
      warning_details: entry.warning_details,
    }, null, 2));
  } else {
    console.log("항목 없음. 로그:", JSON.stringify((logs.logs ?? []).slice(0, 1)));
  }
  process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
