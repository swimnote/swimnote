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
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";

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
  const tomorrowDayKr    = DAY_NAMES_KR[tomorrow.getDay()];
  const todayDateStr     = kstDateStr(now);
  const tomorrowDateStr  = kstDateStr(tomorrow); // 휴무일 체크용

  try {
    // 전날 알림 설정이 있는 수영장 목록 (설정 없으면 기본값 20:00)
    const pools = await superAdminDb.execute(sql`
      SELECT DISTINCT sp.id AS pool_id,
        COALESCE(pps.prev_day_push_time, '20:00') AS push_time,
        COALESCE(pps.tpl_prev_day, '내일 수업이 있습니다. 준비하세요!') AS template
      FROM swimming_pools sp
      LEFT JOIN pool_push_settings pps ON pps.pool_id = sp.id
      WHERE sp.approval_status = 'approved'
    `);

    for (const pool of pools.rows as any[]) {
      const { pool_id, push_time, template } = pool;
      if (push_time !== currentTime) continue;

      // 내일이 휴무일이면 전체 건너뜀 (pool별 1회 조회)
      const holidayCheck = await db.execute(sql`
        SELECT id FROM pool_holidays
        WHERE pool_id = ${pool_id} AND holiday_date = ${tomorrowDateStr}
        LIMIT 1
      `);
      if (holidayCheck.rows.length > 0) continue;

      // 중복 발송 방지
      const alreadySent = await superAdminDb.execute(sql`
        SELECT id FROM push_scheduled_sent
        WHERE pool_id = ${pool_id} AND type = 'prev_day'
          AND sent_date = ${todayDateStr} AND sent_time = ${currentTime}
        LIMIT 1
      `);
      if (alreadySent.rows.length > 0) continue;

      // 내일 요일에 수업이 있는 반 목록 (삭제되지 않은 반만)
      const classes = await db.execute(sql`
        SELECT DISTINCT cg.id AS class_id, cg.name AS class_name
        FROM class_groups cg
        WHERE cg.swimming_pool_id = ${pool_id}
          AND cg.is_deleted = false
          AND cg.schedule_days LIKE ${"%" + tomorrowDayKr + "%"}
      `);

      for (const cls of classes.rows as any[]) {
        const body = `${cls.class_name} 수업이 내일 있어요. 준비물 챙기는 거 잊지 마세요!`;
        await sendPushToClassParents(
          cls.class_id,
          "class_reminder",
          "내일 수업이 있어요",
          body,
          { type: "prev_day_reminder", classId: cls.class_id },
          `prev_day_${pool_id}_${todayDateStr}`,
          false,
          { subtitle: "SwimNote", channelId: "class_reminder", ttl: 43200 }
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
  const todayDayKr   = DAY_NAMES_KR[now.getDay()];
  const todayDateStr = kstDateStr(now);

  try {
    const pools = await superAdminDb.execute(sql`
      SELECT DISTINCT sp.id AS pool_id,
        COALESCE(pps.same_day_push_offset, 1) AS offset_hours,
        COALESCE(pps.tpl_same_day, '오늘 수업 {offset}시간 전입니다.') AS template
      FROM swimming_pools sp
      LEFT JOIN pool_push_settings pps ON pps.pool_id = sp.id
      WHERE sp.approval_status = 'approved'
    `);

    for (const pool of pools.rows as any[]) {
      const { pool_id, offset_hours, template } = pool;

      // 오늘이 휴무일이면 전체 건너뜀 (pool별 1회 조회)
      const holidayCheck = await db.execute(sql`
        SELECT id FROM pool_holidays
        WHERE pool_id = ${pool_id} AND holiday_date = ${todayDateStr}
        LIMIT 1
      `);
      if (holidayCheck.rows.length > 0) continue;

      // 오늘 이 수영장의 수업 목록 (시작 시간) — 삭제되지 않은 반만
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

        // ── 중복 방지 핵심 수정 ──────────────────────────────────────────
        // sent_time을 현재 분(cron 실행 시각)이 아니라 예정 발송 시각(수업시각 - offset)으로 고정.
        // 예: 15:00 수업, offset=1h → scheduledSendTime='14:00'
        //   13:59 실행 → scheduledSendTime='14:00'  ← 동일 키
        //   14:00 실행 → scheduledSendTime='14:00'  ← 동일 키 → UNIQUE 충돌 → 차단
        //   14:01 실행 → scheduledSendTime='14:00'  ← 동일 키 → UNIQUE 충돌 → 차단
        const scheduledSendTime = kstTimeStr(
          new Date(classTime.getTime() - offset_hours * 60 * 60 * 1000)
        );

        // ── INSERT 선점 후 발송 (INSERT-first 패턴) ─────────────────────
        // SELECT → 발송 → INSERT 구조는 두 실행이 동시에 SELECT를 통과하면
        // DB 기록은 1건이어도 실제 푸시가 2회 발송될 수 있는 경쟁 조건이 있음.
        // INSERT RETURNING 결과가 있을 때만 발송하여 원자적으로 처리.
        const sentId = `pss_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const claimResult = await superAdminDb.execute(sql`
          INSERT INTO push_scheduled_sent (id, pool_id, class_id, type, sent_date, sent_time)
          VALUES (${sentId}, ${pool_id}, ${cls.class_id}, 'same_day', ${todayDateStr}, ${scheduledSendTime})
          ON CONFLICT ON CONSTRAINT push_scheduled_unique DO NOTHING
          RETURNING id
        `);
        // 0행 반환 = 이미 다른 실행이 선점 → 발송 없이 skip
        if (claimResult.rows.length === 0) continue;

        // 선점 성공 → 실제 발송
        const hourLabel = offset_hours === 1 ? "1시간" : `${offset_hours}시간`;
        const body = `${cls.class_name} 수업 시작까지 ${hourLabel} 남았어요`;
        await sendPushToClassParents(
          cls.class_id,
          "class_reminder",
          "곧 수업이 시작돼요",
          body,
          { type: "same_day_reminder", classId: cls.class_id },
          `same_day_${pool_id}_${todayDateStr}`,
          false,
          { subtitle: "SwimNote", channelId: "class_reminder", priority: "high", ttl: 3600 }
        );
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
    // 오늘 배정된 보강 세션 조회 (superAdminDb)
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
          "오늘 보충 수업이 있습니다",
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

// ── 일지 푸시 예약 큐 처리 ───────────────────────────────────────────
function formatDateKrSched(dateStr: string): string {
  try {
    const [, m, d] = dateStr.split("-");
    return `${parseInt(m)}월 ${parseInt(d)}일`;
  } catch { return dateStr; }
}

async function runDiaryPushQueue(): Promise<void> {
  try {
    const items = (await db.execute(sql`
      SELECT * FROM diary_push_queue
      WHERE scheduled_at <= now() AND sent_at IS NULL
      ORDER BY scheduled_at
      LIMIT 50
    `)).rows as any[];

    for (const item of items) {
      try {
        const dateLabel = item.lesson_date ? ` (${formatDateKrSched(item.lesson_date)})` : "";

        if (item.is_individual) {
          // 개인 일지: student_ids 기반 학부모 조회 (일지 작성 시 소속 학생 ID가 이미 저장됨)
          const studentIds: string[] = item.student_ids || [];
          if (studentIds.length > 0) {
            const idsLiteral = studentIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(",");
            const parentRows = (await db.execute(sql.raw(`
              SELECT DISTINCT pa.id AS parent_account_id, s.name AS student_name
              FROM students s
              JOIN parent_students ps ON ps.student_id = s.id
              JOIN parent_accounts pa ON pa.id = ps.parent_id
              WHERE s.id IN (${idsLiteral})
                AND s.deleted_at IS NULL AND ps.status = 'approved'
            `))).rows as any[];

            for (const p of parentRows) {
              const studentLabel = p.student_name ? `${p.student_name}의 ` : "";
              const notifBody = `${item.class_name}${dateLabel} ${studentLabel}개인 수업 일지가 도착했어요`;
              await sendPushToUser(
                p.parent_account_id, true, "diary_upload",
                "수업 일지가 도착했어요", notifBody,
                { type: "diary_upload", diaryId: item.diary_id },
                `diary_${item.diary_id}_${p.parent_account_id}`,
                { subtitle: "SwimNote", channelId: "diary", priority: "high", ttl: 86400 }
              ).catch(() => {});
            }
          }
        } else {
          // 공통 일지: lesson_date 기준 student_class_history에 유효한 학부모에게만 발송
          if (!item.lesson_date) {
            console.error(`[push-scheduler] 공통 일지 예약에 lesson_date 없음, 건너뜀: ${item.id}`);
          } else {
            const classIdSafe = (item.class_id || "").replace(/'/g, "''");
            const lessonDateSafe = item.lesson_date.replace(/'/g, "''");
            // student_class_history 기준 유효 학부모 조회
            // — 해당 날짜 결석(absent) 학생의 학부모는 발송 제외
            const parentRows2 = (await db.execute(sql.raw(`
              SELECT DISTINCT pa.id AS parent_account_id
              FROM parent_students ps
              JOIN parent_accounts pa ON pa.id = ps.parent_id
              JOIN student_class_history sch
                ON sch.student_id = ps.student_id
                AND sch.class_group_id = '${classIdSafe}'
                AND sch.enrolled_at <= '${lessonDateSafe}'
                AND (sch.left_at IS NULL OR sch.left_at > '${lessonDateSafe}')
              JOIN students s ON s.id = ps.student_id
              WHERE ps.status = 'approved' AND s.deleted_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM attendance a
                  WHERE a.student_id = ps.student_id
                    AND a.class_group_id = '${classIdSafe}'
                    AND a.date = '${lessonDateSafe}'
                    AND a.status = 'absent'
                )
            `))).rows as any[];
            const notifBody = `${item.class_name}${dateLabel} 수업 일지가 도착했어요. 지금 확인해보세요`;
            for (const p of parentRows2) {
              await sendPushToUser(
                p.parent_account_id, true, "diary_upload",
                "수업 일지가 도착했어요", notifBody,
                { type: "diary_upload", diaryId: item.diary_id, classId: item.class_id },
                `diary_${item.diary_id}_${p.parent_account_id}`,
                { subtitle: "SwimNote", channelId: "diary", priority: "high", ttl: 86400 }
              ).catch(() => {});
            }
          }
        }

        // 발송 완료 표시
        await db.execute(sql`
          UPDATE diary_push_queue SET sent_at = now() WHERE id = ${item.id}
        `);
        console.log(`[push-scheduler] 일지 푸시 예약 발송 완료:`, item.id);
      } catch (e) {
        console.error("[push-scheduler] 일지 큐 항목 발송 오류:", item.id, e);
      }
    }
  } catch (e) {
    console.error("[push-scheduler] diary_queue 처리 오류:", e);
  }
}

// ── 스케줄러 등록 ────────────────────────────────────────────────────
export function startPushScheduler(): void {
  // 매 분 실행 (전날 알림 + 당일 알림 시간 체크 + 일지 예약 큐)
  // DB 락으로 서버 여러 대에서 중복 발송 방지
  cron.schedule("* * * * *", async () => {
    const locked = await acquireLock("push-minute", 90); // 1분30초 TTL
    if (!locked) return;
    try {
      await runPrevDaySchedule();
      await runSameDaySchedule();
      await runDiaryPushQueue();
      await recordHeartbeat("push-minute", { ran: true, at: new Date().toISOString() });
    } finally {
      await releaseLock("push-minute");
    }
  });
  // 매일 오전 8시 보강 당일 알림
  cron.schedule("0 8 * * *", async () => {
    const locked = await acquireLock("push-makeup", 1800); // 30분 TTL
    if (!locked) return;
    try {
      await runMakeupDaySchedule();
      await recordHeartbeat("push-makeup", { ran: true, at: new Date().toISOString() });
    } finally {
      await releaseLock("push-makeup");
    }
  }, { timezone: "Asia/Seoul" });
  console.log("[push-scheduler] 예약 푸시 스케줄러 시작");
}
