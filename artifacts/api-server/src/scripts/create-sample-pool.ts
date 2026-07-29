import { superAdminDb, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "../lib/auth.js";
import { insertDefaultTemplates } from "../lib/defaultTemplates.js";

const POOL_NAME    = "샘플수영장";
const POOL_NAME_EN = "sample_pool";
const ADMIN_EMAIL  = "sample@swimnote.kr";
const ADMIN_PW     = "swim1234";
const ADMIN_NAME   = "샘플관리자";
const ADMIN_PHONE  = "010-0000-0000";
const POOL_PHONE   = "02-0000-0000";
const POOL_ADDRESS = "서울시 샘플구 샘플동 1-1";
const POOL_OWNER   = "샘플원장";

async function main() {
  console.log("── 샘플 수영장 생성 시작 ──────────────────────");

  // 중복 확인
  const existing = (await superAdminDb.execute(
    sql`SELECT id FROM users WHERE email = ${ADMIN_EMAIL} LIMIT 1`
  )).rows as any[];

  if (existing.length > 0) {
    console.log(`⚠️  이미 존재하는 이메일: ${ADMIN_EMAIL}`);
    console.log("   삭제 후 재실행하거나 다른 이메일을 사용하세요.");
    process.exit(1);
  }

  const now   = Date.now();
  const rand  = () => Math.random().toString(36).substr(2, 9);
  const poolId   = `pool_${now}_${rand()}`;
  const userId   = `user_${now}_${rand()}`;
  const inviteId = `tinv_${now}_${rand()}`;

  // 1) swimming_pools
  await superAdminDb.execute(sql`
    INSERT INTO swimming_pools
      (id, name, name_en, address, phone, owner_name, owner_email,
       admin_name, admin_email, admin_phone, approval_status, subscription_status, trial_end_at)
    VALUES
      (${poolId}, ${POOL_NAME}, ${POOL_NAME_EN}, ${POOL_ADDRESS},
       ${POOL_PHONE}, ${POOL_OWNER}, ${ADMIN_EMAIL},
       ${ADMIN_NAME}, ${ADMIN_EMAIL}, ${ADMIN_PHONE},
       'approved', 'trial', NOW() + INTERVAL '365 days')
  `);
  console.log(`✅ 수영장 생성: ${poolId}`);

  // 2) users (pool_admin)
  const password_hash = await hashPassword(ADMIN_PW);
  await superAdminDb.execute(sql`
    INSERT INTO users
      (id, email, password_hash, name, phone, role,
       swimming_pool_id, is_activated, is_admin_self_teacher,
       phone_verified, roles, created_at, updated_at)
    VALUES
      (${userId}, ${ADMIN_EMAIL}, ${password_hash}, ${ADMIN_NAME},
       ${ADMIN_PHONE}, 'pool_admin'::user_role,
       ${poolId}, true, true,
       true, '{"pool_admin","teacher"}'::TEXT[], now(), now())
  `);
  console.log(`✅ 관리자 계정 생성: ${userId}`);

  // 3) teacher_invites (관리자 선생님)
  await db.execute(sql`
    INSERT INTO teacher_invites
      (id, swimming_pool_id, name, phone, position,
       invite_token, invite_status, invited_by, user_id,
       approved_at, approved_by, approved_role, created_at, requested_at)
    VALUES
      (${inviteId}, ${poolId}, '관리자선생님', ${ADMIN_PHONE}, '관리자',
       ${inviteId}, 'approved', ${userId}, ${userId},
       now(), ${userId}, 'teacher', now(), now())
  `);
  console.log(`✅ 선생님 엔티티 생성`);

  // 4) 기본 레벨 설정
  const levels = [
    { name: "기초반", color: "#60A5FA", sort: 1 },
    { name: "초급반", color: "#34D399", sort: 2 },
    { name: "중급반", color: "#FBBF24", sort: 3 },
    { name: "고급반", color: "#F87171", sort: 4 },
    { name: "선수반", color: "#A78BFA", sort: 5 },
  ];
  for (const lv of levels) {
    const lvId = `lvl_${Date.now()}_${rand()}`;
    await db.execute(sql`
      INSERT INTO level_settings (id, swimming_pool_id, name, color, sort_order, is_active, created_at)
      VALUES (${lvId}, ${poolId}, ${lv.name}, ${lv.color}, ${lv.sort}, true, now())
    `).catch(() => {});
  }
  console.log(`✅ 기본 레벨 5개 생성`);

  // 5) 기본 수업 3개
  const classes = [
    { name: "화목 18:00반", days: "화목", time: "18:00", capacity: 10 },
    { name: "월수금 07:00반", days: "월수금", time: "07:00", capacity: 8 },
    { name: "토 10:00반", days: "토", time: "10:00", capacity: 12 },
  ];
  for (const cls of classes) {
    const cgId = `cg_${Date.now()}_${rand()}`;
    await db.execute(sql`
      INSERT INTO class_groups
        (id, swimming_pool_id, name, schedule_days, schedule_time,
         capacity, teacher_user_id, is_deleted, created_at, updated_at)
      VALUES
        (${cgId}, ${poolId}, ${cls.name}, ${cls.days}, ${cls.time},
         ${cls.capacity}, ${userId}, false, now(), now())
    `).catch(() => {});
  }
  console.log(`✅ 샘플 수업 3개 생성`);

  // 6) 기본 일지 템플릿
  await insertDefaultTemplates(poolId, userId);
  console.log(`✅ 기본 일지 템플릿 삽입 완료`);

  console.log("\n══════════════════════════════════════════");
  console.log("  샘플 수영장 생성 완료!");
  console.log(`  수영장 ID : ${poolId}`);
  console.log(`  이메일    : ${ADMIN_EMAIL}`);
  console.log(`  비밀번호  : ${ADMIN_PW}`);
  console.log(`  슬러그    : ${POOL_NAME_EN}`);
  console.log("══════════════════════════════════════════\n");

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
