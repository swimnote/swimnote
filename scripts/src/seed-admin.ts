import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function seedAdmin() {
  const email = "admin@swim.platform";
  const password = "admin1234!";
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    console.log("슈퍼관리자 계정이 이미 존재합니다:", email);
    process.exit(0);
  }
  const password_hash = await bcrypt.hash(password, 10);
  const id = `user_super_admin_${Date.now()}`;
  await db.insert(usersTable).values({
    id,
    email,
    password_hash,
    name: "슈퍼관리자",
    role: "super_admin",
    swimming_pool_id: null,
  });
  console.log("슈퍼관리자 계정 생성 완료!");
  console.log("이메일:", email);
  console.log("비밀번호:", password);
  process.exit(0);
}

seedAdmin().catch(console.error);
