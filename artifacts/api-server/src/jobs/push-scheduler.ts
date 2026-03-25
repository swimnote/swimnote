/**
 * push-scheduler.ts — 예약 푸시 알림 스케줄러
 *
 * 전날 수업 알림: 매일 특정 시간에 다음날 수업이 있는 학생의 학부모에게 발송
 * 당일 수업 알림: 매 분 체크 → 수업 X시간 전에 자동 발송 (중복 방지)
 */
import cron from "node-cron";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendPushToClassParents, sendPushToUser, sendRawPush, checkPushEnabled } from "../lib/push-service.js";

function getKSTNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function padZ(n: number): string { return n.toString().padStart(2, "0"); }
function kstTimeStr(d: Date): string { return `${padZ(d.getHours())}:${padZ(d.getMinutes())}`; }
function kstDateStr(d: Date): string {
  return `${d.getFullYear()}-${padZ(d.getMonth() + 1)}-${padZ(d.getDate())}`;
}

const DAY_NAMES_KR: Record<number, string> = {
  0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토",
};

// ── 전날 수업 알림 (매 분 체크, pool별 설정 시간에 맞춰 발송) ────────
async function runPrevDaySchedule(): Promise<void> {
  const now = getKSTNow();
  const currentTime = kstTimeStr(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDayKr = DAY_NAMES_KR[tomorrow.getDay()];
  const todayDateStr  = kstDateStr(now);

  try {
    // 전날 알림 설정이 있는 수영장 목록 (설정 없으면 기본값 20:00)
    const pools = await superAdminDb.execute(sql`
      SELECT DISTINCT sp.id AS pool_id,
        COALESCE(pps.prev_day_push_time, '20:00') AS push_time,
        COALESCE(pps.tpl_prev_day, '📅 내일 수업이 있습니다. 준비하세요!') AS template
      FROM swimming_pools sp
      LEFT JOIN pool_push_settings pps ON pps.pool_id = sp.id
      WHERE sp.approval_status = 'approved'
    `);

    for (const pool of pools.rows as any[]) {
      const { pool_id, push_time, template } = pool;
      if (push_time !== currentTime) continue;

      // 중복 발송 방지
      const alreadySent = await superAdminDb.execute(sql`
        SELECT id FROM push_scheduled_sent
        WHERE pool_id = ${pool_id} AND type = 'prev_day'
          AND sent_date = ${todayDateStr} AND sent_time = ${currentTime}
        LIMIT 1
      `);
      if (alreadySent.rows.length > 0) continue;

      // 내일 요일에 수업이 있는 반 목록
      const classes = await db.execute(sql`
        SELECT DISTINCT cg.id AS class_id, cg.name AS class_name
        FROM class_groups cg
        WHERE cg.swimming_pool_id = ${pool_id}
          AND cg.is_deleted = false
          AND cg.schedule_days LIKE ${"%" + tomorrowDayKr + "%"}
      `);

      for (const cls of classes.rows as any[]) {
        await sendPushToClassParents(
          cls.class_id,
          "class_reminder",
          "📅 내일 수업 알림",
          template,
          { type: "prev_day_reminder", classId: cls.class_id },
          `prev_day_${pool_id}_${todayDateStr}`
        );
      }

      // 발송 기록
      const sentId = `pss_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await superAdminDb.execute(sql`
        INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
        VALUES (${sentId}, ${pool_id}, 'all', 'prev_day', ${todayDateStr}, ${currentTime})
        ON CONFLICT ON CONSTRAINT push_scheduled_unique DO NOTHING
      `);
    }
  } catch (e) {
    console.error("[push-scheduler] prev_day 오류:", e);
  }
}

// ── 당일 수업 알림 (매 분 체크, 수업 X시간 전) ───────────────────────
async function runSameDaySchedule(): Promise<void> {
  const now = getKSTNow();
  const todayDayKr  = DAY_NAMES_KR[now.getDay()];
  const todayDateStr = kstDateStr(now);

  try {
    const pools = await superAdminDb.execute(sql`
      SELECT DISTINCT sp.id AS pool_id,
        COALESCE(pps.same_day_push_offset, 1) AS offset_hours,
        COALESCE(pps.tpl_same_day, '⏰ 오늘 수업 {offset}시간 전입니다.') AS template
      FROM swimming_pools sp
      LEFT JOIN pool_push_settings pps ON pps.pool_id = sp.id
      WHERE sp.approval_status = 'approved'
    `);

    for (const pool of pools.rows as any[]) {
      const { pool_id, offset_hours, template } = pool;

      // 오늘 이 수영장의 수업 목록 (시작 시간)
      const classes = await db.execute(sql`
        SELECT DISTINCT cg.id AS class_id, cg.name AS class_name,
               cg.schedule_time AS start_time
        FROM class_groups cg
        WHERE cg.swimming_pool_id = ${pool_id}
          AND cg.is_deleted = false
          AND cg.schedule_days LIKE ${"%" + todayDayKr + "%"}
      `);

      for (const cls of classes.rows as any[]) {
        const [hh, mm] = cls.start_time.split(":").map(Number);
        const classTime = new Date(now);
        classTime.setHours(hh, mm, 0, 0);
        const diffMs = classTime.getTime() - now.getTime();
        const diffMinutes = Math.round(diffMs / 60000);
        const targetMinutes = offset_hours * 60;

        // X시간 전 ±1분 이내
        if (Math.abs(diffMinutes - targetMinutes) > 1) continue;

        const sendTime = kstTimeStr(now);
        const alreadySent = await superAdminDb.execute(sql`
          SELECT id FROM push_scheduled_sent
          WHERE pool_id = ${pool_id} AND class_id = ${cls.class_id}
            AND type = 'same_day' AND sent_date = ${todayDateStr} AND sent_time = ${sendTime}
          LIMIT 1
        `);
        if (alreadySent.rows.length > 0) continue;

        const body = template.replace("{offset}", String(offset_hours));
        await sendPushToClassParents(
          cls.class_id,
          "class_reminder",
          "⏰ 오늘 수업 알림",
          body,
          { type: "same_day_reminder", classId: cls.class_id },
          `same_day_${pool_id}_${todayDateStr}`
        );

        const sentId = `pss_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await superAdminDb.execute(sql`
          INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
          VALUES (${sentId}, ${pool_id}, ${cls.class_id}, 'same_day', ${todayDateStr}, ${sendTime})
          ON CONFLICT ON CONSTRAINT push_scheduled_unique DO NOTHING
        `);
      }
    }
  } catch (e) {
    console.error("[push-scheduler] same_day 오류:", e);
  }
}

// ── 보강 당일 알림 (매일 오전 8시) ──────────────────────────────────
async function runMakeupDaySchedule(): Promise<void> {
  const now = getKSTNow();
  const todayDateStr = kstDateStr(now);

  try {
    // 오늘 배정된 보강 세션 조회 (poolDb)
    const makeups = (await db.execute(sql`
      SELECT ms.id, ms.student_id, ms.student_name,
             ms.swimming_pool_id,
             ms.assigned_class_group_name, ms.assigned_date
      FROM makeup_sessions ms
      WHERE ms.assigned_date = ${todayDateStr}
        AND ms.status = 'assigned'
        AND ms.cancelled_at IS NULL
    `)).rows as any[];

    for (const mk of makeups) {
      // 중복 방지: push_scheduled_sent에 기록
      const alreadySent = (await superAdminDb.execute(sql`
        SELECT id FROM push_scheduled_sent
        WHERE class_id = ${mk.id} AND type = 'makeup_day_of' AND sent_date = ${todayDateStr}
        LIMIT 1
      `)).rows;
      if (alreadySent.length > 0) continue;

      // 학부모 목록 조회
      const parents = (await db.execute(sql`
        SELECT ps.parent_account_id
        FROM parent_students ps
        WHERE ps.student_id = ${mk.student_id} AND ps.status = 'approved'
      `)).rows as any[];

      for (const p of parents) {
        await sendPushToUser(
          p.parent_account_id, true,
          "makeup_schedule",
          "📅 오늘 보충 수업이 있습니다",
          `${mk.student_name}의 보충 수업이 오늘 있습니다.\n${mk.assigned_class_group_name}`,
          { type: "makeup_day_of", makeupId: mk.id, date: mk.assigned_date },
          `makeup_day_${mk.id}`
        );
      }

      // 발송 기록 저장 (superAdminDb - push_scheduled_sent는 superAdminDb 테이블)
      const sentId = `pss_mk_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await superAdminDb.execute(sql`
        INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
        VALUES (${sentId}, ${mk.swimming_pool_id}, ${mk.id}, 'makeup_day_of', ${todayDateStr}, '08:00')
        ON CONFLICT DO NOTHING
      `);
    }
  } catch (e) {
    console.error("[push-scheduler] makeup_day_of 오류:", e);
  }
}

// ── 스케줄러 등록 ────────────────────────────────────────────────────
export function startPushScheduler(): void {
  // 매 분 실행 (전날 알림 + 당일 알림 시간 체크)
  cron.schedule("* * * * *", async () => {
    await runPrevDaySchedule();
    await runSameDaySchedule();
  });
  // 매일 오전 8시 보강 당일 알림
  cron.schedule("0 8 * * *", async () => {
    await runMakeupDaySchedule();
  }, { timezone: "Asia/Seoul" });
  console.log("[push-scheduler] 예약 푸시 스케줄러 시작");
}
