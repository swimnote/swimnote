import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../lib/auth.js";

async function main() {
  const hash = await hashPassword("1111");
  await superAdminDb.execute(sql`UPDATE users SET web_pin_hash = ${hash} WHERE email = 'sample@swimnote.kr'`);
  console.log("✅ 웹 비밀번호 1111 설정 완료");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
