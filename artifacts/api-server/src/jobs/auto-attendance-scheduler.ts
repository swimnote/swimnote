/**
 * auto-attendance-scheduler.ts — 자동 출석 스케줄러
 *
 * 동작 원칙:
 *  - 수업 시작 시각 + 60분이 지나면, 출석 미기록 학생을 자동으로 '출석(present)' 처리
 *  - 결석(absent) 버튼을 눌러 이미 기록된 학생은 건드리지 않음 (보강 리스트 유지)
 *  - 매 15분마다 실행, 한국 표준시(KST = UTC+9) 기준
 *  - 모든 수영장·모든 수업반에 공통 적용
 *  - DB 락으로 서버 여러 대에서 중복 실행 방지
 */
import cron from "node-cron";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";

const JOB_NAME = "auto-attendance";
const TTL_SECONDS = 600; // 10분

/** 현재 KST 날짜/시각/요일 반환 */
function getKST() {
  const now = new Date();
  // KST = UTC+9
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);

  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");

  const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
  const dayOfWeek = KO_DAYS[kst.getUTCDay()];

  const currentMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    dayOfWeek,
    currentMinutes,
  };
}

/** "HH:MM" 또는 "H:MM" 형식 → 분(number) */
function timeToMinutes(t: string): number {
  if (!t) return 0;
  const parts = t.split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  return h * 60 + m;
}

export async function runAutoAttendance(): Promise<{ processed: number; marked: number }> {
  const locked = await acquireLock(JOB_NAME, TTL_SECONDS);
  if (!locked) return { processed: 0, marked: 0 };

  let processed = 0;
  let marked = 0;

  try {
    const { dateStr, dayOfWeek, currentMinutes } = getKST();

    // ── 1. 오늘 수업이 있는 모든 활성 수업반 조회 ─────────────────────────
    const allGroups = (await db.execute(sql`
      SELECT id, swimming_pool_id, schedule_time, schedule_days, is_one_time, one_time_date
      FROM class_groups
      WHERE is_deleted = false
    `)).rows as Array<{
      id: string;
      swimming_pool_id: string;
      schedule_time: string;
      schedule_days: string;
      is_one_time: boolean;
      one_time_date: string | null;
    }>;

    // 오늘 수업이 있고, 시작 시각 + 60분 이상 지난 반만 처리
    const AUTO_DELAY_MINUTES = 60;

    const todayGroups = allGroups.filter((cg) => {
      const startMin = timeToMinutes(cg.schedule_time);
      const triggerMin = startMin + AUTO_DELAY_MINUTES;

      if (currentMinutes < triggerMin) return false; // 아직 수업 안 끝남

      if (cg.is_one_time) {
        // 특별(원타임) 수업: one_time_date === 오늘
        return cg.one_time_date === dateStr;
      } else {
        // 정규 수업: schedule_days에 오늘 요일 포함
        const days = cg.schedule_days.split(",").map((d) => d.trim());
        return days.includes(dayOfWeek);
      }
    });

    processed = todayGroups.length;
    if (processed === 0) return { processed: 0, marked: 0 };

    // ── 2. 각 수업반별 학생 처리 ───────────────────────────────────────────
    for (const cg of todayGroups) {
      const { id: cgId, swimming_pool_id: poolId } = cg;

      // 오늘 이 수업반에 이미 출결 기록이 있는 학생 ID 세트
      const existingRows = (await db.execute(sql`
        SELECT student_id FROM attendance
        WHERE class_group_id = ${cgId}
          AND date = ${dateStr}
          AND swimming_pool_id = ${poolId}
      `)).rows as Array<{ student_id: string }>;

      const alreadyMarked = new Set(existingRows.map((r) => r.student_id));

      // 이 수업반에 속한 활성 학생 조회
      // (class_group_id 직접 매핑 OR assigned_class_ids 배열 포함)
      const students = (await db.execute(sql`
        SELECT id, name
        FROM students
        WHERE swimming_pool_id = ${poolId}
          AND status NOT IN ('withdrawn', 'archived', 'deleted')
          AND deleted_at IS NULL
          AND (
            class_group_id = ${cgId}
            OR (assigned_class_ids IS NOT NULL
                AND assigned_class_ids @> ${JSON.stringify([cgId])}::jsonb)
          )
      `)).rows as Array<{ id: string; name: string }>;

      for (const student of students) {
        if (alreadyMarked.has(student.id)) continue; // 이미 출결 처리됨

        // 자동 출석(present) 삽입
        const attId = `att_auto_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        try {
          await db.execute(sql`
            INSERT INTO attendance (
              id, swimming_pool_id, class_group_id, student_id,
              date, status, session_type, created_by_name, created_at
            ) VALUES (
              ${attId}, ${poolId}, ${cgId}, ${student.id},
              ${dateStr}, 'present', 'regular', '자동출석', NOW()
            )
          `);
          marked++;
          // 중복 방지: 같은 학생이 복수 반에 속해도 첫 번째만 처리
          alreadyMarked.add(student.id);
        } catch (insertErr: any) {
          // 동시성으로 인한 중복 삽입 무시
          if (!String(insertErr?.message ?? "").includes("duplicate")) {
            console.error(`[auto-attendance] INSERT 오류 (${student.id}):`, insertErr?.message);
          }
        }
      }
    }
  } catch (e) {
    console.error("[auto-attendance] 실행 오류:", e);
  } finally {
    await recordHeartbeat(JOB_NAME, { processed, marked });
    await releaseLock(JOB_NAME);
  }

  if (marked > 0) {
    console.log(`[auto-attendance] 자동출석 완료: ${marked}명 처리 (${processed}개 수업반)`);
  }
  return { processed, marked };
}

export function startAutoAttendanceScheduler() {
  // 매 15분마다 실행 (0, 15, 30, 45분)
  cron.schedule("*/15 * * * *", () => {
    runAutoAttendance().catch((e) =>
      console.error("[auto-attendance] 스케줄 오류:", e)
    );
  });

  console.log("[auto-attendance] 자동출석 스케줄러 시작 (매 15분, 수업 시작 후 60분 경과 시 자동처리)");

  // 서버 시작 후 2분 뒤 초기 1회 실행 (서버 재시작 직후 처리 누락 방지)
  setTimeout(() => {
    runAutoAttendance().catch((e) =>
      console.error("[auto-attendance] 초기 실행 오류:", e)
    );
  }, 2 * 60 * 1000);
}
