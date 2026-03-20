/**
 * 테스트 데이터 초기화 스크립트
 *
 * 실행: pnpm --filter @workspace/scripts run reset-test-data
 *
 * 처리 내용:
 * 1. 테스트 계정 비밀번호 업데이트 (1/111111, 2/222222, 3/333333)
 * 2. 학부모 계정 비밀번호 업데이트 (login_id=아이디4 또는 phone=4 → 444444)
 * 3. 학생 데이터 서태웅 외 전부 삭제
 * 4. 일지(class_diaries) 전체 삭제
 * 5. 쪽지(work_messages) 전체 삭제
 * 6. 출결(attendance) 전체 삭제
 * 7. 보강(makeup_sessions) 전체 삭제
 * 8. 알림(notifications) 전체 삭제
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const TAEWUNG_STUDENT_ID = "stu_seo_taewoong_004";
const PARENT_ACCOUNT_ID  = "pa_parent_004";

async function main() {
  console.log("===== 테스트 데이터 초기화 시작 =====\n");

  // ── 1. 관리자/선생님 계정 비밀번호 업데이트 ──────────────────────────
  console.log("1. 사용자 계정(users) 비밀번호 업데이트...");
  const adminAccounts = [
    { email: "1", pw: "111111" },
    { email: "2", pw: "222222" },
    { email: "3", pw: "333333" },
  ];
  for (const acc of adminAccounts) {
    const hash = await bcrypt.hash(acc.pw, 10);
    const r = await db.execute(sql`
      UPDATE users SET password_hash = ${hash}, updated_at = now()
      WHERE email = ${acc.email}
    `);
    const cnt = (r as any).rowCount ?? 0;
    console.log(cnt > 0
      ? `  ✓ email="${acc.email}" 비밀번호 → ${acc.pw}`
      : `  ⚠ email="${acc.email}" 계정 없음`);
  }

  // ── 2. 학부모 계정 비밀번호 업데이트 ─────────────────────────────────
  console.log("\n2. 학부모 계정(parent_accounts) 비밀번호 업데이트...");
  const parentHash = await bcrypt.hash("444444", 10);
  const pr = await db.execute(sql`
    UPDATE parent_accounts
    SET pin_hash = ${parentHash}, login_id = '4', updated_at = now()
    WHERE id = ${PARENT_ACCOUNT_ID}
  `);
  const pCnt = (pr as any).rowCount ?? 0;
  console.log(pCnt > 0
    ? "  ✓ pa_parent_004 비밀번호 → 444444, login_id → 4"
    : "  ⚠ pa_parent_004 계정 없음");

  // ── 3. 학생 데이터: 서태웅 외 전부 삭제 ─────────────────────────────
  console.log("\n3. 학생 데이터 정리 (서태웅만 유지)...");

  // parent_students: 서태웅 외 삭제
  const delPS = await db.execute(sql`
    DELETE FROM parent_students WHERE student_id != ${TAEWUNG_STUDENT_ID}
  `);
  console.log(`  ✓ parent_students 연결 ${(delPS as any).rowCount ?? 0}건 삭제`);

  // student_class_schedules 삭제
  try {
    const delSCS = await db.execute(sql`
      DELETE FROM student_class_schedules WHERE student_id != ${TAEWUNG_STUDENT_ID}
    `);
    console.log(`  ✓ student_class_schedules ${(delSCS as any).rowCount ?? 0}건 삭제`);
  } catch (e: any) {
    console.log(`  ⚠ student_class_schedules 삭제 스킵: ${e.message.split('\n')[0]}`);
  }

  // student_levels 삭제
  try {
    const delSL = await db.execute(sql`
      DELETE FROM student_levels WHERE student_id != ${TAEWUNG_STUDENT_ID}
    `);
    console.log(`  ✓ student_levels ${(delSL as any).rowCount ?? 0}건 삭제`);
  } catch (e: any) {
    console.log(`  ⚠ student_levels 삭제 스킵: ${e.message.split('\n')[0]}`);
  }

  // students 삭제
  const delStudents = await db.execute(sql`
    DELETE FROM students WHERE id != ${TAEWUNG_STUDENT_ID}
  `);
  console.log(`  ✓ 학생 ${(delStudents as any).rowCount ?? 0}명 삭제 (서태웅 유지)`);

  // ── 4. 일지 전체 삭제 ───────────────────────────────────────────────
  console.log("\n4. 일지 전체 삭제...");
  try {
    // audit logs 먼저 삭제
    const da = await db.execute(sql`DELETE FROM class_diary_audit_logs`);
    console.log(`  ✓ class_diary_audit_logs ${(da as any).rowCount ?? 0}건 삭제`);
  } catch {}
  try {
    const dn = await db.execute(sql`DELETE FROM class_diary_student_notes`);
    console.log(`  ✓ class_diary_student_notes ${(dn as any).rowCount ?? 0}건 삭제`);
  } catch {}
  try {
    const dc = await db.execute(sql`DELETE FROM diary_comments`);
    console.log(`  ✓ diary_comments ${(dc as any).rowCount ?? 0}건 삭제`);
  } catch {}
  try {
    const dr = await db.execute(sql`DELETE FROM diary_reactions`);
    console.log(`  ✓ diary_reactions ${(dr as any).rowCount ?? 0}건 삭제`);
  } catch {}
  try {
    const dm = await db.execute(sql`DELETE FROM diary_messages`);
    console.log(`  ✓ diary_messages ${(dm as any).rowCount ?? 0}건 삭제`);
  } catch {}
  try {
    const dcd = await db.execute(sql`DELETE FROM class_diaries`);
    console.log(`  ✓ class_diaries ${(dcd as any).rowCount ?? 0}건 삭제`);
  } catch (e: any) {
    console.log(`  ⚠ class_diaries 삭제 실패: ${e.message.split('\n')[0]}`);
  }
  try {
    const dsd = await db.execute(sql`DELETE FROM swim_diary`);
    console.log(`  ✓ swim_diary ${(dsd as any).rowCount ?? 0}건 삭제`);
  } catch {}

  // ── 5. 쪽지 전체 삭제 ───────────────────────────────────────────────
  console.log("\n5. 쪽지 전체 삭제...");
  try {
    const mrs = await db.execute(sql`DELETE FROM messenger_read_state`);
    console.log(`  ✓ messenger_read_state ${(mrs as any).rowCount ?? 0}건 삭제`);
  } catch {}
  try {
    const wm = await db.execute(sql`DELETE FROM work_messages`);
    console.log(`  ✓ work_messages ${(wm as any).rowCount ?? 0}건 삭제`);
  } catch (e: any) {
    console.log(`  ⚠ work_messages 삭제 실패: ${e.message.split('\n')[0]}`);
  }

  // ── 6. 출결 전체 삭제 ───────────────────────────────────────────────
  console.log("\n6. 출결 전체 삭제...");
  try {
    const att = await db.execute(sql`DELETE FROM attendance`);
    console.log(`  ✓ attendance ${(att as any).rowCount ?? 0}건 삭제`);
  } catch (e: any) {
    console.log(`  ⚠ attendance 삭제 실패: ${e.message.split('\n')[0]}`);
  }

  // ── 7. 보강 전체 삭제 ───────────────────────────────────────────────
  console.log("\n7. 보강 전체 삭제...");
  try {
    const mk = await db.execute(sql`DELETE FROM makeup_sessions`);
    console.log(`  ✓ makeup_sessions ${(mk as any).rowCount ?? 0}건 삭제`);
  } catch (e: any) {
    console.log(`  ⚠ makeup_sessions 삭제 실패: ${e.message.split('\n')[0]}`);
  }

  // ── 8. 알림 전체 삭제 ────────────────────────────────────────────────
  console.log("\n8. 알림 전체 삭제...");
  try {
    const nt = await db.execute(sql`DELETE FROM notifications`);
    console.log(`  ✓ notifications ${(nt as any).rowCount ?? 0}건 삭제`);
  } catch (e: any) {
    console.log(`  ⚠ notifications 삭제 실패: ${e.message.split('\n')[0]}`);
  }

  // ── 9. 기타 테스트 학부모 계정 정리 (서태웅 학부모만 유지) ──────────────
  console.log("\n9. 기타 테스트 학부모 계정 정리...");
  try {
    const delParents = await db.execute(sql`
      DELETE FROM parent_accounts WHERE id != ${PARENT_ACCOUNT_ID}
    `);
    console.log(`  ✓ 테스트 학부모 ${(delParents as any).rowCount ?? 0}건 삭제 (서태웅 학부모 유지)`);
  } catch (e: any) {
    console.log(`  ⚠ parent_accounts 삭제 실패: ${e.message.split('\n')[0]}`);
  }

  // ── 최종 상태 확인 ─────────────────────────────────────────────────
  console.log("\n===== 초기화 완료 =====");
  console.log("\n[테스트 로그인 계정]");
  console.log("  슈퍼관리자:        아이디 1  / 비밀번호 111111");
  console.log("  토이키즈관리자:    아이디 2  / 비밀번호 222222");
  console.log("  선생님:            아이디 3  / 비밀번호 333333");
  console.log("  서태웅학부모:      아이디 4  / 비밀번호 444444");

  const sc = await db.execute(sql`SELECT COUNT(*) as cnt FROM students`);
  const studentNames = await db.execute(sql`SELECT name FROM students`);
  console.log(`\n[학생] ${(sc.rows[0] as any)?.cnt ?? 0}명: ${studentNames.rows.map((r: any) => r.name).join(', ')}`);

  process.exit(0);
}

main().catch(e => {
  console.error("초기화 실패:", e.message || e);
  process.exit(1);
});
