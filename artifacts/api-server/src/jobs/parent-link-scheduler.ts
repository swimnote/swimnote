/**
 * parent-link-scheduler.ts — 학부모↔학생 실시간 자동 연결 스케줄러
 *
 * 매 1분: 전체 parent_accounts 중 연결되지 않은 학생이 있거나
 *          수영장이 없는 학부모를 전화번호/이름으로 글로벌 매칭하여 자동 연결
 *
 * 연결 조건:
 *  - students.parent_phone == parent_accounts.phone (정규화 비교)
 *  - OR students.parent_name == parent_accounts.name (정규화 비교, 폴백)
 */
import cron from "node-cron";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";

const JOB_NAME = "parent-link";
const TTL_SECONDS = 120; // 2분

export async function runParentAutoLink(): Promise<{ checked: number; linked: number }> {
  const locked = await acquireLock(JOB_NAME, TTL_SECONDS);
  if (!locked) return { checked: 0, linked: 0 };

  let checked = 0;
  let linked = 0;

  try {
    // 미연결 학생이 있거나 수영장 미설정인 활성 학부모 전체 조회
    const parents = (await db.execute(sql`
      SELECT pa.id, pa.phone, pa.name, pa.swimming_pool_id
      FROM parent_accounts pa
      WHERE pa.is_active = true
        AND (
          pa.swimming_pool_id IS NULL
          OR EXISTS (
            SELECT 1 FROM students s
            WHERE REGEXP_REPLACE(COALESCE(s.parent_phone,''),'[^0-9]','','g')
                  = REGEXP_REPLACE(COALESCE(pa.phone,''),'[^0-9]','','g')
              AND s.parent_user_id IS NULL
              AND s.status NOT IN ('withdrawn','archived','deleted')
          )
        )
    `)).rows as any[];

    checked = parents.length;

    for (const pa of parents) {
      if (!pa.phone) continue;
      const normPhone = pa.phone.replace(/[^0-9]/g, "");
      const normName  = pa.name  ? pa.name.replace(/\s+/g, "").toLowerCase() : null;

      // 전화번호로 학생 검색 (전체 DB)
      let students = (await db.execute(sql`
        SELECT id, swimming_pool_id, name FROM students
        WHERE REGEXP_REPLACE(COALESCE(parent_phone,''),'[^0-9]','','g') = ${normPhone}
          AND (parent_user_id IS NULL OR parent_user_id = ${pa.id})
          AND status NOT IN ('withdrawn','archived','deleted')
          AND deleted_at IS NULL
        LIMIT 20
      `)).rows as any[];

      // 폴백: 학부모 이름으로도 검색
      if (students.length === 0 && normName) {
        students = (await db.execute(sql`
          SELECT id, swimming_pool_id, name FROM students
          WHERE REPLACE(LOWER(COALESCE(parent_name,'')),' ','') = ${normName}
            AND (parent_user_id IS NULL OR parent_user_id = ${pa.id})
            AND status NOT IN ('withdrawn','archived','deleted')
            AND deleted_at IS NULL
          LIMIT 20
        `)).rows as any[];
      }

      if (students.length === 0) continue;

      for (const stu of students) {
        const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // parent_students 연결 — 기존 레코드 있으면 approved로 강제 업데이트
        const existing = await db.execute(sql`
          SELECT id FROM parent_students
          WHERE parent_id = ${pa.id} AND student_id = ${stu.id} LIMIT 1
        `);
        if ((existing.rows as any[]).length > 0) {
          await db.execute(sql`
            UPDATE parent_students
            SET status = 'approved', approved_at = NOW()
            WHERE parent_id = ${pa.id} AND student_id = ${stu.id}
          `);
        } else {
          await db.execute(sql`
            INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at, created_at)
            VALUES (${psId}, ${pa.id}, ${stu.id}, ${stu.swimming_pool_id}, 'approved', NOW(), NOW())
          `);
        }

        // students.parent_user_id 강제 업데이트
        await db.execute(sql`
          UPDATE students
          SET parent_user_id = ${pa.id},
              parent_phone   = COALESCE(NULLIF(parent_phone,''), ${normPhone}),
              status         = CASE WHEN status IN ('unregistered','pending_approval') THEN 'active' ELSE status END,
              updated_at     = NOW()
          WHERE id = ${stu.id}
        `);

        // 학부모 계정에 수영장 자동 세팅 (미설정 시)
        if (!pa.swimming_pool_id) {
          await db.execute(sql`
            UPDATE parent_accounts
            SET swimming_pool_id = ${stu.swimming_pool_id}, updated_at = NOW()
            WHERE id = ${pa.id} AND swimming_pool_id IS NULL
          `);
          pa.swimming_pool_id = stu.swimming_pool_id; // 로컬 캐시 업데이트
        }

        linked++;
      }
    }
  } catch (e) {
    console.error("[parent-link] 오류:", e);
  } finally {
    await recordHeartbeat(JOB_NAME, { checked, linked });
    await releaseLock(JOB_NAME);
  }

  if (linked > 0) {
    console.log(`[parent-link] 자동 연결 완료: ${linked}건 (체크: ${checked}명)`);
  }
  return { checked, linked };
}

export function startParentLinkScheduler() {
  // 매 1분 실행 — 학부모↔학생 실시간 자동 연결
  cron.schedule("* * * * *", () => {
    runParentAutoLink().catch(e => console.error("[parent-link] 스케줄 오류:", e));
  });
  console.log("[parent-link] 학부모↔학생 자동 연결 스케줄러 시작 (매 1분)");

  // 서버 시작 직후 즉시 1회 실행
  setTimeout(() => {
    runParentAutoLink().catch(e => console.error("[parent-link] 초기 실행 오류:", e));
  }, 5000);
}
