/**
 * toykids_audit.ts — READ ONLY
 * 토이키즈스윔클럽 Kakao 계정 전수조사
 * 실행: pnpm --filter @workspace/api-server exec tsx src/scripts/toykids_audit.ts
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const POOL_ID = "pool_1780849364252_l9k44rbk3";

function maskName(n: string) {
  if (!n || n.length < 2) return n[0] + "*";
  if (n.length === 2) return n[0] + "*";
  return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
}
function maskPhone(p: string) {
  if (!p) return "N";
  const d = p.replace(/[^0-9]/g, "");
  if (d.length >= 8) return d.slice(0, 3) + "-****-" + d.slice(-4);
  return "***-****-" + d.slice(-4);
}
function maskEmail(e: string) {
  if (!e) return "N";
  const [u, d] = e.split("@");
  return (u?.slice(0, 2) ?? "?") + "***@" + (d ?? "?");
}
function maskKakaoId(k: string) {
  if (!k) return "N";
  return "..."+k.slice(-4);
}
function normPhone(p: string) {
  if (!p) return "";
  return p.replace(/^\+82\s*/, "0").replace(/[^0-9]/g, "");
}

async function main() {
  const db = superAdminDb;

  // ── PARENTS ──────────────────────────────────────────────────────────────────
  // Note: apple_id / is_active may be migration-added; use COALESCE to be safe
  const parRes = await db.execute(sql`
    SELECT id, name, phone, login_id, kakao_id, pin_hash, created_at,
           withdrawal_requested_at,
           COALESCE(apple_id, NULL) AS apple_id,
           COALESCE(is_active::boolean, TRUE) AS is_active
    FROM parent_accounts
    WHERE swimming_pool_id = ${POOL_ID}
    ORDER BY created_at
  `);
  const parents: any[] = parRes.rows as any[];

  // ── TEACHERS ─────────────────────────────────────────────────────────────────
  // users: no username column; login via email
  const tRes = await db.execute(sql`
    SELECT id, name, phone, email, kakao_id, password_hash, is_activated, created_at
    FROM users
    WHERE swimming_pool_id = ${POOL_ID} AND role = 'teacher'
    ORDER BY created_at
  `);
  const teachers: any[] = tRes.rows as any[];

  // ── ADMINS ───────────────────────────────────────────────────────────────────
  const aRes = await db.execute(sql`
    SELECT id, name, phone, email, kakao_id, password_hash, is_activated, created_at
    FROM users
    WHERE swimming_pool_id = ${POOL_ID} AND role = 'pool_admin'
    ORDER BY created_at
  `);
  const admins: any[] = aRes.rows as any[];

  // ── RISK CLASSIFICATION ───────────────────────────────────────────────────────
  function parentRisk(r: any) {
    const hasLogin = !!r.login_id;
    const hasPin = !!r.pin_hash;
    const hasPhone = !!r.phone;
    if (hasLogin && hasPin) return "SAFE";
    if (hasLogin && !hasPin) return "RECOVERY_REQUIRED";
    if (!hasLogin && hasPhone) return "RECOVERY_REQUIRED";
    return "LOCKOUT_RISK";
  }
  function staffRisk(r: any) {
    const hasEmail = !!r.email;
    const hasPw = !!r.password_hash;
    const hasPhone = !!r.phone;
    if (hasEmail && hasPw) return "SAFE";
    if (hasEmail && !hasPw) return "RECOVERY_REQUIRED";
    if (hasPhone) return "RECOVERY_REQUIRED";
    return "LOCKOUT_RISK";
  }

  // ── DUPLICATE kakao_id ────────────────────────────────────────────────────────
  const dupParKakao = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM (
      SELECT kakao_id FROM parent_accounts
      WHERE kakao_id IS NOT NULL AND kakao_id != '' AND kakao_id != 'undefined'
      GROUP BY kakao_id HAVING COUNT(*) > 1
    ) x
  `);
  const dupUserKakao = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM (
      SELECT kakao_id FROM users
      WHERE kakao_id IS NOT NULL AND kakao_id != '' AND kakao_id != 'undefined'
      GROUP BY kakao_id HAVING COUNT(*) > 1
    ) x
  `);
  const parKakaoIds = parents.filter(r => r.kakao_id).map(r => r.kakao_id);
  const staffKakaoIds = [...teachers, ...admins].filter(r => r.kakao_id).map(r => r.kakao_id);
  const crossDup = parKakaoIds.filter(k => staffKakaoIds.includes(k));

  // ── PHONE DUPLICATES (normalized) ─────────────────────────────────────────────
  const allKakaoAccounts = [
    ...parents.filter(r => r.kakao_id).map(r => ({ role: "parent", norm: normPhone(r.phone) })),
    ...teachers.filter(r => r.kakao_id).map(r => ({ role: "teacher", norm: normPhone(r.phone) })),
    ...admins.filter(r => r.kakao_id).map(r => ({ role: "admin", norm: normPhone(r.phone) })),
  ].filter(r => r.norm);
  const phoneMap: Record<string, string[]> = {};
  for (const { role, norm } of allKakaoAccounts) {
    if (!phoneMap[norm]) phoneMap[norm] = [];
    phoneMap[norm].push(role);
  }
  const phoneDups = Object.entries(phoneMap).filter(([, roles]) => roles.length > 1);

  // ── PRINT REPORT ──────────────────────────────────────────────────────────────
  const kakaoParents = parents.filter(r => r.kakao_id);
  const noKakaoParents = parents.filter(r => !r.kakao_id);
  const pRisks = { SAFE: 0, RECOVERY_REQUIRED: 0, LOCKOUT_RISK: 0 } as any;
  const kakaoOnlyRisk = { SAFE: 0, RECOVERY_REQUIRED: 0, LOCKOUT_RISK: 0 } as any;
  for (const r of parents) { const ri = parentRisk(r); pRisks[ri]++; }
  for (const r of kakaoParents) { const ri = parentRisk(r); kakaoOnlyRisk[ri]++; }

  const kakaoTeachers = teachers.filter(r => r.kakao_id);
  const tRisks = { SAFE: 0, RECOVERY_REQUIRED: 0, LOCKOUT_RISK: 0 } as any;
  for (const r of teachers) { const ri = staffRisk(r); tRisks[ri]++; }

  const kakaoAdmins = admins.filter(r => r.kakao_id);
  const aRisks = { SAFE: 0, RECOVERY_REQUIRED: 0, LOCKOUT_RISK: 0 } as any;
  for (const r of admins) { const ri = staffRisk(r); aRisks[ri]++; }

  console.log("\n=== PARENTS ===");
  console.log("Total:", parents.length);
  console.log("Kakao linked:", kakaoParents.length);
  console.log("Kakao unlinked:", noKakaoParents.length);
  console.log("Active:", parents.filter(r => r.is_active).length);
  console.log("Inactive:", parents.filter(r => !r.is_active).length);
  console.log("SAFE:", pRisks.SAFE, "| RECOVERY_REQUIRED:", pRisks.RECOVERY_REQUIRED, "| LOCKOUT_RISK:", pRisks.LOCKOUT_RISK);
  console.log("(Kakao-linked only) SAFE:", kakaoOnlyRisk.SAFE, "| RECOVERY_REQUIRED:", kakaoOnlyRisk.RECOVERY_REQUIRED, "| LOCKOUT_RISK:", kakaoOnlyRisk.LOCKOUT_RISK);
  console.log("\n| # | Name | Kakao | AppleID | LoginID | PinHash | Phone | Active | Risk |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  parents.forEach((r, i) => {
    const risk = parentRisk(r);
    console.log(`| ${i+1} | ${maskName(r.name)} | ${r.kakao_id ? maskKakaoId(r.kakao_id) : "N"} | ${r.apple_id?"Y":"N"} | ${r.login_id ? r.login_id.slice(0,3)+"***" : "N"} | ${r.pin_hash?"Y":"N"} | ${r.phone ? maskPhone(r.phone) : "N"} | ${r.is_active?"Y":"N"} | ${risk} |`);
  });

  console.log("\n=== TEACHERS ===");
  console.log("Total:", teachers.length);
  console.log("Kakao linked:", kakaoTeachers.length);
  console.log("Kakao unlinked:", teachers.length - kakaoTeachers.length);
  console.log("Active:", teachers.filter(r => r.is_activated).length);
  console.log("Inactive:", teachers.filter(r => !r.is_activated).length);
  console.log("SAFE:", tRisks.SAFE, "| RECOVERY_REQUIRED:", tRisks.RECOVERY_REQUIRED, "| LOCKOUT_RISK:", tRisks.LOCKOUT_RISK);
  console.log("\n| # | Name | Kakao | Email | PwHash | Phone | Active | Risk |");
  console.log("|---|---|---|---|---|---|---|---|");
  teachers.forEach((r, i) => {
    const risk = staffRisk(r);
    console.log(`| ${i+1} | ${maskName(r.name)} | ${r.kakao_id ? maskKakaoId(r.kakao_id) : "N"} | ${r.email ? maskEmail(r.email) : "N"} | ${r.password_hash?"Y":"N"} | ${r.phone ? maskPhone(r.phone) : "N"} | ${r.is_activated?"Y":"N"} | ${risk} |`);
  });

  console.log("\n=== ADMINS ===");
  console.log("Total:", admins.length);
  console.log("Kakao linked:", kakaoAdmins.length);
  console.log("Kakao unlinked:", admins.length - kakaoAdmins.length);
  console.log("SAFE:", aRisks.SAFE, "| RECOVERY_REQUIRED:", aRisks.RECOVERY_REQUIRED, "| LOCKOUT_RISK:", aRisks.LOCKOUT_RISK);
  console.log("\n| # | Name | Kakao | Email | PwHash | Phone | Active | Risk |");
  console.log("|---|---|---|---|---|---|---|---|");
  admins.forEach((r, i) => {
    const risk = staffRisk(r);
    console.log(`| ${i+1} | ${maskName(r.name)} | ${r.kakao_id ? maskKakaoId(r.kakao_id) : "N"} | ${r.email ? maskEmail(r.email) : "N"} | ${r.password_hash?"Y":"N"} | ${r.phone ? maskPhone(r.phone) : "N"} | ${r.is_activated?"Y":"N"} | ${risk} |`);
  });

  console.log("\n=== DUPLICATES ===");
  console.log("Dup parent kakao_id groups:", (dupParKakao.rows[0] as any).cnt);
  console.log("Dup user kakao_id groups:", (dupUserKakao.rows[0] as any).cnt);
  console.log("Cross-role same kakao_id:", crossDup.length);
  if (crossDup.length > 0) crossDup.forEach(k => console.log("  cross-dup:", maskKakaoId(k)));
  console.log("Normalized phone dup groups (kakao-linked):", phoneDups.length);
  if (phoneDups.length > 0) phoneDups.forEach(([norm, roles]) => console.log("  phone:", maskPhone(norm), "roles:", roles.join(", ")));

  // ── KAKAO REMOVAL IMPACT SUMMARY ──────────────────────────────────────────────
  const kakaoRiskParents = { SAFE: 0, RECOVERY_REQUIRED: 0, LOCKOUT_RISK: 0 } as any;
  for (const r of kakaoParents) kakaoRiskParents[parentRisk(r)]++;
  const kakaoRiskTeachers = { SAFE: 0, RECOVERY_REQUIRED: 0, LOCKOUT_RISK: 0 } as any;
  for (const r of kakaoTeachers) kakaoRiskTeachers[staffRisk(r)]++;
  const kakaoRiskAdmins = { SAFE: 0, RECOVERY_REQUIRED: 0, LOCKOUT_RISK: 0 } as any;
  for (const r of kakaoAdmins) kakaoRiskAdmins[staffRisk(r)]++;

  console.log("\n=== KAKAO REMOVAL IMPACT ===");
  console.log("Parent SAFE:", kakaoRiskParents.SAFE, "RECOVERY:", kakaoRiskParents.RECOVERY_REQUIRED, "LOCKOUT:", kakaoRiskParents.LOCKOUT_RISK);
  console.log("Teacher SAFE:", kakaoRiskTeachers.SAFE, "RECOVERY:", kakaoRiskTeachers.RECOVERY_REQUIRED, "LOCKOUT:", kakaoRiskTeachers.LOCKOUT_RISK);
  console.log("Admin SAFE:", kakaoRiskAdmins.SAFE, "RECOVERY:", kakaoRiskAdmins.RECOVERY_REQUIRED, "LOCKOUT:", kakaoRiskAdmins.LOCKOUT_RISK);
  const totalLockout = kakaoRiskParents.LOCKOUT_RISK + kakaoRiskTeachers.LOCKOUT_RISK + kakaoRiskAdmins.LOCKOUT_RISK;
  const totalRecovery = kakaoRiskParents.RECOVERY_REQUIRED + kakaoRiskTeachers.RECOVERY_REQUIRED + kakaoRiskAdmins.RECOVERY_REQUIRED;
  const totalKakaoUsers = kakaoParents.length + kakaoTeachers.length + kakaoAdmins.length;
  console.log("Total kakao-linked users:", totalKakaoUsers);
  console.log("Total requiring recovery:", totalRecovery);
  console.log("Total at lockout risk:", totalLockout);

  process.exit(0);
}

main().catch(e => { console.error("AUDIT ERROR:", e); process.exit(1); });
