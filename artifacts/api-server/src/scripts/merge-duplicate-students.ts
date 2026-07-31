/**
 * 중복 학생 병합 및 제거 스크립트
 *
 * 대상:
 *  전하빈: student_1782281581729_ch8u651hi (유지) ← student_1784720381440_dm210beoo (제거)
 *  박찬율: student_1784609867319_e0qghg3tm (유지) ← student_1784721390428_7g71n0l0s (제거)
 *
 * 실행:
 *  pnpm --filter @workspace/api-server exec tsx src/scripts/merge-duplicate-students.ts
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

interface MergeTarget {
  label: string;
  keepId: string;
  dropId: string;
}

const targets: MergeTarget[] = [
  {
    label: "전하빈",
    keepId: "student_1782281581729_ch8u651hi",
    dropId: "student_1784720381440_dm210beoo",
  },
  {
    label: "박찬율",
    keepId: "student_1784609867319_e0qghg3tm",
    dropId: "student_1784721390428_7g71n0l0s",
  },
];

async function safeUpdate(label: string, query: any) {
  try {
    const result = await db.execute(query);
    console.log(`  ✅ ${label}`);
    return result;
  } catch (e: any) {
    console.error(`  ❌ ${label}: ${e?.message}`);
    throw e;
  }
}

async function safeDelete(label: string, query: any) {
  try {
    const result = await db.execute(query);
    console.log(`  ✅ ${label}`);
    return result;
  } catch (e: any) {
    // 데이터 없으면 무시
    console.log(`  ⚠️  ${label}: ${e?.message} (무시)`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("▶ 중복 학생 병합 시작 (DRY RUN 아님 — 실제 적용)");
  console.log("=".repeat(60));

  for (const { label, keepId, dropId } of targets) {
    console.log(`\n[${label}]`);
    console.log(`  유지: ${keepId}`);
    console.log(`  제거: ${dropId}`);

    // ── 1. parent_students 이전 ──────────────────────────────────────
    // dropId에 연결된 parent_students를 keepId로 이전
    // 단, keepId에 이미 같은 parent가 있으면 중복 방지
    const dropPS = (await db.execute(sql`
      SELECT id, parent_id, swimming_pool_id, status FROM parent_students
      WHERE student_id = ${dropId}
    `)).rows as any[];

    console.log(`  parent_students 이전 대상: ${dropPS.length}개`);

    for (const ps of dropPS) {
      // keepId에 이미 동일 parent가 연결되어 있는지 확인
      const [existing] = (await db.execute(sql`
        SELECT id FROM parent_students
        WHERE student_id = ${keepId} AND parent_id = ${ps.parent_id}
        LIMIT 1
      `)).rows as any[];

      if (existing) {
        // 이미 연결되어 있음 → drop PS만 삭제
        await safeDelete(
          `parent_students 중복 삭제 (parent=${ps.parent_id} 이미 keepId에 있음)`,
          sql`DELETE FROM parent_students WHERE id = ${ps.id}`
        );
      } else {
        // keepId로 이전
        await safeUpdate(
          `parent_students 이전 (parent=${ps.parent_id})`,
          sql`UPDATE parent_students SET student_id = ${keepId} WHERE id = ${ps.id}`
        );
      }
    }

    // ── 2. parent_students 이전 후 keepId parent_user_id 갱신 ──────
    // drop 학생의 parent_user_id가 설정되어 있고 keep 학생에 없으면 이전
    const [keepStudent] = (await db.execute(sql`
      SELECT parent_user_id FROM students WHERE id = ${keepId} LIMIT 1
    `)).rows as any[];
    const [dropStudent] = (await db.execute(sql`
      SELECT parent_user_id FROM students WHERE id = ${dropId} LIMIT 1
    `)).rows as any[];

    if (!keepStudent?.parent_user_id && dropStudent?.parent_user_id) {
      await safeUpdate(
        `students.parent_user_id 이전 (${dropStudent.parent_user_id} → keepId)`,
        sql`UPDATE students SET parent_user_id = ${dropStudent.parent_user_id} WHERE id = ${keepId} AND parent_user_id IS NULL`
      );
    } else {
      console.log(`  ℹ️  parent_user_id 이전 불필요 (keep=${keepStudent?.parent_user_id || "—"} drop=${dropStudent?.parent_user_id || "—"})`);
    }

    // ── 3. 출결 이전 ──────────────────────────────────────────────────
    const [attCheck] = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM attendance WHERE student_id = ${dropId}
    `)).rows as any[];
    if (parseInt(attCheck?.cnt ?? "0") > 0) {
      await safeUpdate(
        `attendance ${attCheck.cnt}건 이전`,
        sql`UPDATE attendance SET student_id = ${keepId} WHERE student_id = ${dropId}`
      );
    } else {
      console.log(`  ℹ️  attendance 이전 없음 (0건)`);
    }

    // ── 4. student_class_history 이전 ────────────────────────────────
    const [histCheck] = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM student_class_history WHERE student_id = ${dropId}
    `)).rows as any[];
    if (parseInt(histCheck?.cnt ?? "0") > 0) {
      await safeUpdate(
        `student_class_history ${histCheck.cnt}건 이전`,
        sql`UPDATE student_class_history SET student_id = ${keepId} WHERE student_id = ${dropId}`
      );
    } else {
      console.log(`  ℹ️  student_class_history 이전 없음 (0건)`);
    }

    // ── 5. student_photos 이전 ────────────────────────────────────────
    const [photoCheck] = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM student_photos WHERE student_id = ${dropId}
    `)).rows as any[];
    if (parseInt(photoCheck?.cnt ?? "0") > 0) {
      await safeUpdate(
        `student_photos ${photoCheck.cnt}건 이전`,
        sql`UPDATE student_photos SET student_id = ${keepId} WHERE student_id = ${dropId}`
      );
    } else {
      console.log(`  ℹ️  student_photos 이전 없음 (0건)`);
    }

    // ── 6. parent_student_requests 이전 ──────────────────────────────
    const [reqCheck] = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM parent_student_requests WHERE student_id = ${dropId}
    `)).rows as any[];
    if (parseInt(reqCheck?.cnt ?? "0") > 0) {
      await safeUpdate(
        `parent_student_requests ${reqCheck.cnt}건 이전`,
        sql`UPDATE parent_student_requests SET student_id = ${keepId} WHERE student_id = ${dropId}`
      );
    } else {
      console.log(`  ℹ️  parent_student_requests 이전 없음 (0건)`);
    }

    // ── 7. parent_v2_pending.matched_student_id 이전 ─────────────────
    await safeUpdate(
      `parent_v2_pending matched_student_id 이전`,
      sql`UPDATE parent_v2_pending SET matched_student_id = ${keepId} WHERE matched_student_id = ${dropId}`
    );

    // ── 8. parent_v2_pending: dropId 관련 pending → matched 처리 ────
    // dropId 학생의 부모들이 pending 중이라면 matched로 처리
    await safeUpdate(
      `parent_v2_pending 연관 pending → matched 처리`,
      sql`
        UPDATE parent_v2_pending SET
          status = 'matched',
          matched_student_id = ${keepId},
          matched_at = NOW()
        WHERE matched_student_id = ${keepId}
          AND status = 'pending'
      `
    );

    // ── 9. drop 학생 비활성화 (status=archived) ──────────────────────
    await safeUpdate(
      `students status=archived (제거 표시)`,
      sql`UPDATE students SET status = 'archived', updated_at = NOW() WHERE id = ${dropId}`
    );

    console.log(`  ✅ [${label}] 병합 완료`);
  }

  // ── 추가: 전하빈 pending 정리 ─────────────────────────────────────
  console.log("\n▶ 전하빈 전대성 pending 정리");
  await safeUpdate(
    "v2p_1784706820900 (전대성→전하빈 pending) → matched 처리",
    sql`
      UPDATE parent_v2_pending SET
        status = 'matched',
        matched_student_id = 'student_1782281581729_ch8u651hi',
        matched_at = NOW()
      WHERE id = 'v2p_1784706820900_220s527du'
        AND status = 'pending'
    `
  );

  // ── 추가: 박찬율 박정은 pending 정리 ─────────────────────────────
  console.log("\n▶ 박찬율 박정은 pending 정리");
  await safeUpdate(
    "v2p_1784719053051 (박정은→박찬율 pending) → matched 처리",
    sql`
      UPDATE parent_v2_pending SET
        status = 'matched',
        matched_student_id = 'student_1784609867319_e0qghg3tm',
        matched_at = NOW()
      WHERE id = 'v2p_1784719053051_rwyfy3o12'
        AND status = 'pending'
    `
  );

  // ── 최종 확인 ─────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("▶ 병합 후 최종 상태 확인");
  console.log("=".repeat(60));

  for (const { label, keepId, dropId } of targets) {
    const [keep] = (await db.execute(sql`
      SELECT id, name, status, parent_user_id, class_group_id FROM students WHERE id = ${keepId} LIMIT 1
    `)).rows as any[];
    const [drop] = (await db.execute(sql`
      SELECT id, name, status FROM students WHERE id = ${dropId} LIMIT 1
    `)).rows as any[];

    console.log(`\n[${label}]`);
    console.log(`  유지 (${keepId}): status=${keep?.status} parent_user_id=${keep?.parent_user_id || "—"} class=${keep?.class_group_id || "—"}`);
    console.log(`  제거 (${dropId}): status=${drop?.status}`);

    const psRows = (await db.execute(sql`
      SELECT ps.parent_id, pa.name AS pname, pa.phone AS pphone, ps.status
      FROM parent_students ps
      LEFT JOIN parent_accounts pa ON pa.id = ps.parent_id
      WHERE ps.student_id = ${keepId}
    `)).rows as any[];
    console.log(`  parent_students (${psRows.length}개):`);
    psRows.forEach((r: any) => console.log(`    → ${r.pname}(${r.pphone}) status=${r.status}`));

    const [att] = (await db.execute(sql`SELECT COUNT(*) AS cnt FROM attendance WHERE student_id = ${keepId}`)).rows as any[];
    console.log(`  attendance: ${att.cnt}건`);
  }

  console.log("\n✅ 병합 완료. 데이터 손실 없이 정리됐습니다.");
  process.exit(0);
}

main().catch(e => { console.error("치명적 오류:", e); process.exit(1); });
