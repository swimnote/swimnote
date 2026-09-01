/**
 * diary.ts — 수영일지 API (v2)
 *
 * 신규 구조: class_diaries + class_diary_student_notes + class_diary_audit_logs + diary_templates
 * 레거시 구조: swim_diary (미디어 업로드 엔드포인트 유지)
 *
 * ⚠️ 마이그레이션 포인트:
 *   기존 swim_diary 테이블에 6건의 데이터가 있습니다.
 *   아래 SQL로 수동 마이그레이션 가능:
 *   INSERT INTO class_diaries(class_group_id, teacher_id, teacher_name, swimming_pool_id, lesson_date, common_content, created_at)
 *   SELECT class_group_id, author_id, author_name, swimming_pool_id,
 *          to_char(created_at, 'YYYY-MM-DD'), COALESCE(lesson_content, title, ''), created_at
 *   FROM swim_diary WHERE class_group_id IS NOT NULL;
 */
import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db, superAdminDb } from "@workspace/db";
import { sql, eq, and, desc, or } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";
import { SWIMNOTE_DEFAULT_TEMPLATES, insertDefaultTemplates } from "../lib/defaultTemplates.js";
import { resolvePoolMode } from "../lib/xmode.js";
import { insertGrowthEvents, type CurriculumMatchInput } from "../lib/growth-event-service.js";
import { syncDiaryTemplatesToCurriculumItems } from "../lib/diary-template-sync.js";
import {
  upsertSessionObservation,
  invalidateSessionObservation,
} from "../lib/curriculum-progress-mapper.js";
import { computeConfirmedProgress } from "../lib/curriculum-confirmation-engine.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ── 배포 식별자 (Render.com 재배포 시 이 값이 변경됨) ─────────────────────────
const DEPLOY_VERSION = "2026-07-23-v2";
const DB_HOST = (() => {
  try {
    const url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "";
    return new URL(url).hostname || "unknown";
  } catch { return "unknown"; }
})();


let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });
  return _client;
}

function apiErr(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, error: message });
}

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function getUserPoolId(userId: string): Promise<string | null> {
  const r = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (r.rows[0] as any)?.swimming_pool_id || null;
}

async function getUserDbRole(userId: string): Promise<string | null> {
  const r = await superAdminDb.execute(sql`SELECT role, roles FROM users WHERE id = ${userId} LIMIT 1`);
  const row = r.rows[0] as any;
  if (!row) return null;
  // roles 배열에 pool_admin이 있으면 pool_admin으로 취급 (선생님→관리자 권한 부여 케이스)
  if (Array.isArray(row.roles) && row.roles.includes("pool_admin")) return "pool_admin";
  return row.role || null;
}

async function getUserName(userId: string): Promise<string> {
  const r = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
  return (r.rows[0] as any)?.name || userId;
}

async function logAudit({
  diaryId, studentNoteId, targetType, actionType,
  beforeContent, afterContent, actorId, actorName, actorRole, poolId,
}: {
  diaryId?: string | null; studentNoteId?: string | null;
  targetType: "common" | "student_note"; actionType: "create" | "update" | "delete";
  beforeContent?: string | null; afterContent?: string | null;
  actorId: string; actorName: string; actorRole: string; poolId: string;
}) {
  const id = genId("cal");
  await db.execute(sql`
    INSERT INTO class_diary_audit_logs
      (id, diary_id, student_note_id, target_type, action_type,
       before_content, after_content, actor_id, actor_name, actor_role, swimming_pool_id)
    VALUES
      (${id}, ${diaryId ?? null}, ${studentNoteId ?? null}, ${targetType}, ${actionType},
       ${beforeContent ?? null}, ${afterContent ?? null},
       ${actorId}, ${actorName}, ${actorRole}, ${poolId})
  `);
}

// ── 날짜 포맷 헬퍼 (일지 알림용) ──────────────────────────────────────
function formatDateKr(dateStr: string): string {
  try {
    const [, m, d] = dateStr.split("-");
    return `${parseInt(m)}월 ${parseInt(d)}일`;
  } catch { return dateStr; }
}

// 일지 푸시 허용 시간대: KST 10:00 ~ 22:00
const DIARY_PUSH_START_H = 10;
const DIARY_PUSH_END_H   = 22;

function getKSTNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

/**
 * DB에서 lesson_date를 가져올 때 pg 드라이버가 Date 객체 또는 문자열로 반환할 수 있음.
 * 항상 "YYYY-MM-DD" 형식 문자열로 정규화.
 *
 * - string "2026-08-06" → "2026-08-06"
 * - string "2026-08-06T00:00:00.000Z" → "2026-08-06"
 * - Date object → toISOString().slice(0, 10)
 * - null/undefined → ""
 */
function normalizeLessonDate(raw: unknown): string {
  if (!raw) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw);
  // "YYYY-MM-DD..." 형식이면 앞 10자만
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Date.toString() 형식 "Thu Aug 06 2026 ..." → toISOString 변환
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback.toISOString().slice(0, 10);
  return "";
}

function isDiaryPushAllowed(kstNow: Date): boolean {
  const h = kstNow.getHours();
  return h >= DIARY_PUSH_START_H && h < DIARY_PUSH_END_H;
}

/** 다음 발송 가능 시각 (KST 기준 다음날 10:00) → UTC ISO 문자열 반환 */
function nextDiaryPushTime(kstNow: Date): string {
  const next = new Date(kstNow);
  next.setDate(next.getDate() + 1);
  next.setHours(DIARY_PUSH_START_H, 0, 0, 0);
  // KST → UTC: -9시간
  return new Date(next.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

async function sendDiaryPush(classId: string, diaryId: string, className: string, poolId: string, lessonDate: string) {
  try {
    const dateLabel = ` (${formatDateKr(lessonDate)})`;
    const notifBody = `${className}${dateLabel} 수업 일지가 도착했어요. 지금 확인해보세요`;
    const classIdSafe = classId.replace(/'/g, "''");
    const lessonDateSafe = lessonDate.replace(/'/g, "''");

    // lesson_date 기준 student_class_history에 유효한 학부모 대상
    // — 해당 날짜 결석(absent) 학생의 학부모는 발송 제외
    const parentRows = await db.execute(sql.raw(`
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
    `));

    // 인앱 알림 생성 (시간대 무관 즉시)
    for (const p of parentRows.rows as any[]) {
      const nid = genId("notif");
      await db.execute(sql`
        INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
        VALUES (${nid}, ${p.parent_account_id}, 'parent_account', 'diary_upload',
                '수업 일지가 도착했어요',
                ${notifBody},
                ${diaryId}, 'class_diary', ${poolId}, false)
        ON CONFLICT DO NOTHING
      `);
    }

    const { sendPushToUser } = await import("../lib/push-service.js");
    const kstNow = getKSTNow();
    if (isDiaryPushAllowed(kstNow)) {
      // 허용 시간대 → lesson_date 기준 학부모에게 즉시 개별 발송
      for (const p of parentRows.rows as any[]) {
        await sendPushToUser(
          p.parent_account_id, true, "diary_upload",
          "수업 일지가 도착했어요", notifBody,
          { type: "diary_upload", diaryId, classId },
          `diary_${diaryId}_${p.parent_account_id}`,
          { subtitle: "SwimNote", channelId: "diary", priority: "high", ttl: 86400 }
        ).catch(() => {});
      }
    } else {
      // 비허용 시간대 → 다음날 10시 예약 (lesson_date 저장)
      const qid = genId("dpq");
      const scheduledAt = nextDiaryPushTime(kstNow);
      await db.execute(sql`
        INSERT INTO diary_push_queue (id, pool_id, class_id, diary_id, class_name, lesson_date, is_individual, scheduled_at)
        VALUES (${qid}, ${poolId}, ${classId}, ${diaryId}, ${className}, ${lessonDate}, false, ${scheduledAt})
      `);
      console.log(`[diary] 푸시 예약 등록 (${scheduledAt}):`, qid);
    }
  } catch (e) { console.error("[diary] 푸시 알림 오류:", e); }
}

// 공통 일지 없이 개인 일지만 있을 때: 해당 학생의 학부모에게만 발송
async function sendDiaryPushToStudents(studentIds: string[], diaryId: string, className: string, poolId: string, lessonDate?: string) {
  if (studentIds.length === 0) return;
  try {
    const dateLabel = lessonDate ? ` (${formatDateKr(lessonDate)})` : "";
    const idsLiteral = studentIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");
    const parentRows = await db.execute(sql.raw(`
      SELECT DISTINCT pa.id AS parent_account_id, s.name AS student_name
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id
      JOIN parent_accounts pa ON pa.id = ps.parent_id
      WHERE s.id IN (${idsLiteral})
        AND s.status != 'deleted' AND ps.status = 'approved'
    `));

    // 인앱 알림은 시간대 무관 즉시 생성
    for (const p of parentRows.rows as any[]) {
      const studentLabel = p.student_name ? `${p.student_name}의 ` : "";
      const notifBody = `${className}${dateLabel} ${studentLabel}개인 수업 일지가 도착했어요`;
      const nid = genId("notif");
      await db.execute(sql`
        INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
        VALUES (${nid}, ${p.parent_account_id}, 'parent_account', 'diary_upload',
                '수업 일지가 도착했어요',
                ${notifBody},
                ${diaryId}, 'class_diary', ${poolId}, false)
        ON CONFLICT DO NOTHING
      `);
    }

    const { sendPushToUser } = await import("../lib/push-service.js");
    const kstNow = getKSTNow();
    if (isDiaryPushAllowed(kstNow)) {
      // 허용 시간대 → 즉시 발송
      for (const p of parentRows.rows as any[]) {
        const studentLabel = p.student_name ? `${p.student_name}의 ` : "";
        const notifBody = `${className}${dateLabel} ${studentLabel}개인 수업 일지가 도착했어요`;
        await sendPushToUser(
          p.parent_account_id, true, "diary_upload",
          "수업 일지가 도착했어요", notifBody,
          { type: "diary_upload", diaryId },
          `diary_${diaryId}_${p.parent_account_id}`,
          { subtitle: "SwimNote", channelId: "diary", priority: "high", ttl: 86400 }
        ).catch(() => {});
      }
    } else {
      // 비허용 시간대 → 다음날 10시 예약
      const qid = genId("dpq");
      const scheduledAt = nextDiaryPushTime(kstNow);
      await db.execute(sql`
        INSERT INTO diary_push_queue (id, pool_id, class_id, diary_id, student_ids, class_name, lesson_date, is_individual, scheduled_at)
        VALUES (${qid}, ${poolId}, null, ${diaryId}, ${JSON.stringify(studentIds)}::jsonb, ${className}, ${lessonDate ?? null}, true, ${scheduledAt})
      `);
      console.log(`[diary] 개인일지 푸시 예약 등록 (${scheduledAt}):`, qid);
    }
  } catch (e) { console.error("[diary] 개인일지 푸시 알림 오류:", e); }
}

// ════════════════════════════════════════════════════════════════════════
// 1. 미디어 업로드 (레거시 호환 유지)
// ════════════════════════════════════════════════════════════════════════

router.post("/diary/upload",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  upload.single("file"),
  async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      if (!file) return apiErr(res, 400, "파일을 선택해주세요.");
      const ext = file.originalname.split(".").pop()?.toLowerCase() || "jpg";
      const isVideo = ["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(ext);
      const key = `diary/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
      const client = getClient();
      await client.uploadFromBytes(key, file.buffer, {});
      return res.json({ key, type: isVideo ? "video" : "image" });
    } catch (e) { console.error(e); return apiErr(res, 500, "업로드 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 2. 공통 일지 CRUD
// ════════════════════════════════════════════════════════════════════════

// ── GET /diaries/index — 학생 기준 통합 일지 이력 인덱스 ─────────────────
// 쿼리: student_name(선택), day(요일 한글 ex:월), time(시간 ex:14:00)
router.get("/diaries/index",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const { student_name, day, time, student_id: studentIdParam } = req.query as Record<string, string>;
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      // student_id 범위 제한: 지정된 학생이 같은 pool 소속인지 확인
      if (studentIdParam) {
        const chk = await db.execute(sql`SELECT 1 FROM students WHERE id = ${studentIdParam} AND swimming_pool_id = ${poolId} LIMIT 1`);
        if ((chk.rows as any[]).length === 0) return apiErr(res, 403, "접근 권한이 없습니다.");
      }

      // 선생님은 자신이 담당하는 반만
      let classFilter = sql`true`;
      if (role === "teacher") {
        const cgRows = await db.execute(sql`SELECT id FROM class_groups WHERE (teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text)) AND swimming_pool_id = ${poolId} AND is_deleted = false`);
        const ids = (cgRows.rows as any[]).map(r => `'${r.id}'`);
        if (ids.length === 0) return res.json([]);
        classFilter = sql.raw(`cd.class_group_id IN (${ids.join(",")})`);
      }

      // 요일 필터
      const dayFilter = day ? sql`AND cg.schedule_days ILIKE ${"%" + day + "%"}` : sql``;
      // 시간 필터 (앞 5자 비교: '14:00')
      const timeFilter = time ? sql`AND LEFT(cg.schedule_time, 5) = ${time}` : sql``;

      // 학생 이름 필터 (student_id가 있으면 name 검색 비활성)
      const nameSearchCommon = (!studentIdParam && student_name)
        ? sql`AND EXISTS (SELECT 1 FROM students s WHERE s.class_group_id = cd.class_group_id AND s.status NOT IN ('withdrawn','deleted') AND s.name ILIKE ${"%" + student_name + "%"})`
        : sql``;
      const nameSearchNote = (!studentIdParam && student_name) ? sql`AND s.name ILIKE ${"%" + student_name + "%"}` : sql``;

      // student_id 필터 — authoritative ID 기반, name search 대체
      // ① 공통 일지: 해당 학생이 속했던 반(class_group_id)으로 범위 제한
      const studentCommonFilter = studentIdParam
        ? sql`AND cd.class_group_id IN (SELECT class_group_id FROM student_class_history WHERE student_id = ${studentIdParam} AND is_deleted = false)`
        : sql``;
      // ② 학생 노트: cdn.student_id = :studentId 직접 필터
      const studentNoteFilter = studentIdParam
        ? sql`AND cdn.student_id = ${studentIdParam}`
        : sql``;

      // ① 반 공통 일지
      const commonRows = await db.execute(sql`
        SELECT
          cd.id AS diary_id,
          cd.lesson_date,
          cg.name AS class_name,
          cg.schedule_days,
          cg.schedule_time,
          cd.common_content AS content,
          cd.teacher_name,
          cd.created_at,
          'class_common' AS entry_type,
          NULL::text AS student_id,
          NULL::text AS student_name,
          NULL::text AS note_content,
          cd.id AS source_diary_id,
          NULL::text AS source_note_id
        FROM class_diaries cd
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.swimming_pool_id = ${poolId}
          AND cd.is_deleted = false
          AND (${classFilter})
          ${dayFilter}
          ${timeFilter}
          ${nameSearchCommon}
          ${studentCommonFilter}
        ORDER BY cd.lesson_date DESC, cd.created_at DESC
        LIMIT 200
      `);

      // ② 학생별 추가 일지 (student_note)
      const noteRows = await db.execute(sql`
        SELECT
          cd.id AS diary_id,
          cd.lesson_date,
          cg.name AS class_name,
          cg.schedule_days,
          cg.schedule_time,
          cdn.note_content AS content,
          cd.teacher_name,
          cdn.created_at,
          'student_note' AS entry_type,
          s.id AS student_id,
          s.name AS student_name,
          cdn.note_content,
          cd.id AS source_diary_id,
          cdn.id AS source_note_id
        FROM class_diary_student_notes cdn
        JOIN class_diaries cd ON cd.id = cdn.diary_id
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        LEFT JOIN students s ON s.id = cdn.student_id
        WHERE cd.swimming_pool_id = ${poolId}
          AND cdn.is_deleted = false
          AND cd.is_deleted = false
          AND (${classFilter})
          ${dayFilter}
          ${timeFilter}
          ${nameSearchNote}
          ${studentNoteFilter}
        ORDER BY cd.lesson_date DESC, cdn.created_at DESC
        LIMIT 200
      `);

      const entries = [...(commonRows.rows as any[]), ...(noteRows.rows as any[])]
        .sort((a, b) => new Date(b.lesson_date).getTime() - new Date(a.lesson_date).getTime() || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return res.json({ success: true, entries });
    } catch (e) { console.error("[diaries/index]", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ── GET /diaries ─────────────────────────────────────────────────────────
// 쿼리: class_group_id, lesson_date, include_deleted(admin only)
router.get("/diaries",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const { class_group_id, lesson_date, include_deleted } = req.query;
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      let whereClauses = [`cd.swimming_pool_id = ${db.execute(sql`${poolId}`)} `];

      // 역할별 제한
      if (role === "teacher") {
        // pool_admin이 teacher로 전환한 경우 → 수영장 전체 반 일지 접근 허용
        const dbRole = await getUserDbRole(userId);
        const isAdminAsTeacher = dbRole === "pool_admin";

        let classFilter: string;
        if (isAdminAsTeacher) {
          // pool_admin은 소속 수영장 전체 반 일지 조회 가능
          const poolRows = await db.execute(sql`SELECT id FROM class_groups WHERE swimming_pool_id = ${poolId} AND is_deleted = false`);
          const allIds = (poolRows.rows as any[]).map(r => r.id);
          if (allIds.length === 0) { res.json([]); return; }
          classFilter = allIds.map(id => `cd.class_group_id = '${id}'`).join(" OR ");
        } else {
          // 일반 선생님: 주담당 또는 co-teacher인 반 조회
          const rows = await db.execute(sql`SELECT id FROM class_groups WHERE teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text)`);
          const myClassIds = (rows.rows as any[]).map(r => r.id);
          if (myClassIds.length === 0) { res.json([]); return; }
          classFilter = myClassIds.map(id => `cd.class_group_id = '${id}'`).join(" OR ");
        }

        const rows2 = await db.execute(sql`
          SELECT
            cd.*,
            cg.name AS class_name,
            cg.schedule_days, cg.schedule_time,
            (SELECT COUNT(*) FROM class_diary_student_notes csn WHERE csn.diary_id = cd.id AND csn.is_deleted = false) AS note_count,
            (SELECT COUNT(*) FROM diary_reactions dr WHERE dr.diary_id = cd.id AND dr.reaction_type = 'like') AS like_count,
            (SELECT COUNT(*) FROM diary_reactions dr WHERE dr.diary_id = cd.id AND dr.reaction_type = 'thanks') AS thank_count,
            (SELECT COUNT(*) FROM diary_messages dm WHERE dm.diary_id = cd.id AND dm.is_deleted = false AND dm.parent_comment_id IS NULL AND dm.message_type = 'diary_comment') AS comment_count
          FROM class_diaries cd
          LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
          WHERE cd.swimming_pool_id = ${poolId}
            AND (${sql.raw(classFilter)})
            AND cd.is_deleted = false
            ${class_group_id ? sql`AND cd.class_group_id = ${class_group_id}` : sql``}
            ${lesson_date ? sql`AND cd.lesson_date = ${lesson_date}` : sql``}
          ORDER BY cd.lesson_date DESC, cd.created_at DESC
          LIMIT 100
        `);
        res.json(rows2.rows);
        return;
      }

      // pool_admin / super_admin: 전체 조회 + 삭제된 것도 볼 수 있음
      const showDeleted = include_deleted === "true";
      const rows3 = await db.execute(sql`
        SELECT
          cd.*,
          cg.name AS class_name,
          cg.schedule_days, cg.schedule_time,
          (SELECT COUNT(*) FROM class_diary_student_notes csn WHERE csn.diary_id = cd.id AND csn.is_deleted = false) AS note_count,
          (SELECT COUNT(*) FROM diary_reactions dr WHERE dr.diary_id = cd.id AND dr.reaction_type = 'like') AS like_count,
          (SELECT COUNT(*) FROM diary_reactions dr WHERE dr.diary_id = cd.id AND dr.reaction_type = 'thanks') AS thank_count,
          (SELECT COUNT(*) FROM diary_messages dm WHERE dm.diary_id = cd.id AND dm.is_deleted = false AND dm.parent_comment_id IS NULL AND dm.message_type = 'diary_comment') AS comment_count
        FROM class_diaries cd
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.swimming_pool_id = ${poolId}
          ${!showDeleted ? sql`AND cd.is_deleted = false` : sql``}
          ${class_group_id ? sql`AND cd.class_group_id = ${class_group_id}` : sql``}
          ${lesson_date ? sql`AND cd.lesson_date = ${lesson_date}` : sql``}
        ORDER BY cd.lesson_date DESC, cd.created_at DESC
        LIMIT 200
      `);
      res.json(rows3.rows);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ── POST /diaries ─────────────────────────────────────────────────────────
// Body: { class_group_id, lesson_date?, common_content, student_notes?: [{student_id, note_content}] }
router.post("/diaries",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const {
        class_group_id, lesson_date, common_content,
        student_notes, curriculum_matches, ai_request_id,
      } = req.body;

      const hasStudentNotes = Array.isArray(student_notes) && student_notes.some((n: any) => n.note_content?.trim());
      if (!class_group_id || (!common_content?.trim() && !hasStudentNotes)) {
        return apiErr(res, 400, "반 ID와 일지 내용은 필수입니다.");
      }

      // curriculum_matches 유효성 사전 검사 (길이·타입 체크만, match_token 검증은 TX 내부)
      const rawCurriculumMatches: CurriculumMatchInput[] = Array.isArray(curriculum_matches)
        ? (curriculum_matches as any[]).filter(
            (m): m is CurriculumMatchInput =>
              m !== null &&
              typeof m === "object" &&
              typeof m.student_ref   === "string" && m.student_ref &&
              typeof m.candidate_id  === "string" && m.candidate_id &&
              typeof m.match_token   === "string" && m.match_token &&
              typeof m.match_status  === "string",
          )
        : [];

      const [poolId, teacherName] = await Promise.all([
        getUserPoolId(userId),
        getUserName(userId),
      ]);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      // 선생님: 본인 반인지 확인 (pool_admin이 teacher로 전환한 경우 전체 접근 허용)
      if (role === "teacher") {
        const dbUserRow = await superAdminDb.execute(sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`);
        const dbRole = (dbUserRow.rows[0] as any)?.role;
        if (dbRole !== "pool_admin") {
          const r = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId} AND (teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text))`);
          if (r.rows.length === 0) return apiErr(res, 403, "본인 반의 일지만 작성할 수 있습니다.");
        } else {
          // pool_admin이 teacher 모드 → 풀 내 반인지만 확인
          const r = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId} AND is_deleted = false`);
          if (r.rows.length === 0) return apiErr(res, 403, "해당 반을 찾을 수 없습니다.");
        }
      }
      const dateStr = lesson_date || new Date().toISOString().slice(0, 10);
      const diaryId = genId("cd");

      // ── WP7: X mode 확인 (curriculum_matches 있을 때만 DB 조회) ──────────────
      let isXMode = false;
      if (rawCurriculumMatches.length > 0) {
        try {
          const pmResult = await resolvePoolMode(poolId!);
          isXMode = pmResult?.mode === "x";
          console.log(
            `[diary-create] X_MODE_CHECK poolId=${poolId} mode=${pmResult?.mode} isXMode=${isXMode}`,
          );
        } catch (e) {
          console.error(`[diary-create] X_MODE_CHECK_FAILED poolId=${poolId}`, e);
          // X mode 판정 실패 → growth_event 생성 안 함, diary 저장은 계속
        }
      }

      // 중복 방지: 같은 날 같은 반에 이미 일지 있으면 오류
      const dup = await db.execute(sql`
        SELECT id FROM class_diaries
        WHERE class_group_id = ${class_group_id} AND lesson_date = ${dateStr} AND is_deleted = false
      `);
      if (dup.rows.length > 0) {
        return apiErr(res, 409, "이미 해당 날짜에 일지가 작성되었습니다. 수정 기능을 사용해주세요.");
      }

      // 결석(absent) 학생 ID 조회 — 결석자는 개인 일지 저장 및 발송 대상에서 제외
      const absentRowsForDate = await db.execute(sql`
        SELECT student_id FROM attendance
        WHERE class_group_id = ${class_group_id}
          AND date = ${dateStr}
          AND status = 'absent'
      `);
      const absentStudentIds = new Set((absentRowsForDate.rows as any[]).map((r: any) => r.student_id));
      if (absentStudentIds.size > 0) {
        console.log(`[diary-create] 결석 학생 제외 count=${absentStudentIds.size} ids=[${[...absentStudentIds].join(",")}]`);
      }

      // 학생별 추가 일지 저장 — 결석 학생 제외
      const allNotes: any[] = Array.isArray(student_notes) ? student_notes : [];
      const notes: any[] = absentStudentIds.size > 0
        ? allNotes.filter((n: any) => !absentStudentIds.has(n.student_id))
        : allNotes;
      if (notes.length < allNotes.length) {
        console.log(`[diary-create] student_notes: input=${allNotes.length} after_absent_filter=${notes.length}`);
      }
      console.log(`[diary-create] student_notes input count=${notes.length}`);
      const savedNotes: any[] = [];

      // 트랜잭션: 일지 + 학생별 노트 원자적 생성
      await db.transaction(async (tx) => {
        console.log(`[diary-create] INSERT class_diaries id=${diaryId} swimming_pool_id=${poolId} lesson_date=${dateStr} class_group_id=${class_group_id}`);
        await tx.execute(sql`
          INSERT INTO class_diaries (id, class_group_id, teacher_id, teacher_name, swimming_pool_id, lesson_date, common_content)
          VALUES (${diaryId}, ${class_group_id}, ${userId}, ${teacherName}, ${poolId}, ${dateStr}, ${(common_content || "").trim()})
        `);
        console.log(`[diary-create] class_diaries INSERT done`);

        for (const n of notes) {
          if (!n.student_id || !n.note_content?.trim()) {
            console.log(`[diary-create] SKIP note student_id=${n.student_id} note_content=${n.note_content}`);
            continue;
          }
          const noteId = genId("csn");
          console.log(`[diary-create] INSERT student_note id=${noteId} diary_id=${diaryId} student_id=${n.student_id}`);
          await tx.execute(sql`
            INSERT INTO class_diary_student_notes (id, diary_id, student_id, note_content)
            VALUES (${noteId}, ${diaryId}, ${n.student_id}, ${n.note_content.trim()})
          `);
          console.log(`[diary-create] student_note INSERT done id=${noteId}`);
          savedNotes.push({ id: noteId, student_id: n.student_id, note_content: n.note_content.trim() });
        }

        // ── WP7: X mode growth_events insert (TX 내부) ──────────────────────
        if (isXMode && rawCurriculumMatches.length > 0) {
          const geResult = await insertGrowthEvents({
            tx,
            poolId:            poolId!,
            diaryId,
            savedNotes,
            curriculumMatches: rawCurriculumMatches,
            requestId:         typeof ai_request_id === "string" ? ai_request_id : undefined,
            contractVersion:   "1.3",
          });
          console.log(
            `[diary-create] GROWTH_EVENTS diary=${diaryId}` +
            ` inserted=${geResult.inserted} skipped=${geResult.skipped} errors=${geResult.errors}`,
          );
        }
      });
      console.log(`[diary-create] TX committed. savedNotes=${JSON.stringify(savedNotes.map(n => ({ id: n.id, student_id: n.student_id })))}`);

      // ── GAUGE-04/05: CPO 매핑 → SCP 재계산 (TX 외부 — fail-safe) ──────────
      // X mode일 때만 실행. 일지 저장은 항상 성공; CPO/SCP는 eventually consistent.
      if (isXMode && savedNotes.length > 0) {
        const uniqueStudentIds = [...new Set(savedNotes.map((n: any) => n.student_id))];
        for (const studentId of uniqueStudentIds) {
          upsertSessionObservation(db, { studentId, poolId: poolId!, lessonSessionId: diaryId })
            .then((r) => {
              console.log(`[diary-create] CPO mapper student=${studentId} status=${r.status} rank=${r.progressRank}`);
              return computeConfirmedProgress(db, studentId, poolId!);
            })
            .then((c) => console.log(`[diary-create] SCP confirmed student=${studentId} status=${c.status} display=${c.displayConfirmedPct}`))
            .catch((e) => console.error(`[diary-create] gauge pipeline error student=${studentId}:`, e));
        }
      }

      // 트랜잭션 외부: 감사 로그 (실패해도 일지 생성에 영향 없음)
      await logAudit({
        diaryId, targetType: "common", actionType: "create",
        afterContent: (common_content || "").trim(),
        actorId: userId, actorName: teacherName, actorRole: role, poolId,
      });
      for (const n of savedNotes) {
        await logAudit({
          diaryId, studentNoteId: n.id, targetType: "student_note", actionType: "create",
          afterContent: n.note_content,
          actorId: userId, actorName: teacherName, actorRole: role, poolId,
        });
      }

      // 학부모 푸시 알림
      const cgRow = await db.execute(sql`SELECT name FROM class_groups WHERE id = ${class_group_id}`);
      const className = (cgRow.rows[0] as any)?.name || "수업";
      if ((common_content || "").trim()) {
        // 공통 일지 있음 → 전체 반 학부모에게 발송
        sendDiaryPush(class_group_id, diaryId, className, poolId, dateStr);
      } else {
        // 공통 일지 없음 → 개인 일지가 있는 학생의 학부모에게만 발송
        const noteStudentIds = savedNotes.map((n: any) => n.student_id);
        sendDiaryPushToStudents(noteStudentIds, diaryId, className, poolId, dateStr);
      }

      logPoolEvent({
        pool_id: poolId!, event_type: "journal.create", entity_type: "class_diary",
        entity_id: diaryId, actor_id: userId,
        payload: { class_group_id, lesson_date: dateStr },
      }).catch(() => {});
      res.json({ success: true, diary_id: diaryId, student_notes: savedNotes });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ── GET /diaries/:id ─────────────────────────────────────────────────────
// ── GET /diaries/diagnostic/:id — 운영 DB 실제 상태 진단 (super_admin/pool_admin 전용) ──
// Issue 1 진단: DELETE 후 is_deleted 실제값, 동일 class+date 중복 row, 고아 row 여부를 반환
router.get("/diaries/diagnostic/:id",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const diaryId = req.params.id;
      const { userId, role } = req.user!;
      const poolId = role === "super_admin" ? null : await getUserPoolId(userId);

      // 1. 해당 diary row 직접 조회 (is_deleted 무관)
      const diaryRow = await db.execute(sql`
        SELECT id, is_deleted, deleted_at, updated_at, created_at,
               class_group_id, lesson_date, teacher_id, swimming_pool_id
        FROM class_diaries WHERE id = ${diaryId}
      `);
      const diary = diaryRow.rows[0] as any;
      if (!diary) return apiErr(res, 404, "diary_id not found in DB");

      if (poolId && diary.swimming_pool_id !== poolId)
        return apiErr(res, 403, "pool mismatch");

      // 2. 같은 class_group_id + lesson_date 조합 전체 row
      const siblings = await db.execute(sql`
        SELECT id, is_deleted, created_at, updated_at, deleted_at
        FROM class_diaries
        WHERE class_group_id = ${diary.class_group_id}
          AND lesson_date = ${diary.lesson_date}
        ORDER BY created_at ASC
      `);

      // 3. 현재 GET /diaries 응답에서 이 ID가 내려올 것인지 확인
      const activeForDate = await db.execute(sql`
        SELECT id, is_deleted FROM class_diaries
        WHERE class_group_id = ${diary.class_group_id}
          AND lesson_date = ${diary.lesson_date}
          AND is_deleted = false
      `);

      res.json({
        deploymentVersion: DEPLOY_VERSION,
        dbHost: DB_HOST,
        targetDiary: diary,
        siblingRows: siblings.rows,
        activeRowsForSameClassDate: activeForDate.rows,
        diagnosis: {
          isDeletedInDB: diary.is_deleted,
          totalRowsForClassDate: siblings.rows.length,
          activeRowsCount: activeForDate.rows.length,
          targetIdInActiveRows: (activeForDate.rows as any[]).some(r => r.id === diaryId),
        },
      });
    } catch (e) {
      console.error("[diagnostic]", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 미작성 수업 슬롯 목록 (선생님 모드 — 일지 작성 진입용)
// GET /diaries/unwritten-slots
// ⚠️ 반드시 /diaries/:id 보다 먼저 등록해야 함 (Express 라우트 순서)
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/unwritten-slots",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const reqId = Math.random().toString(36).slice(2, 9);
    const includeWritten = (req.query as any).includeWritten === "true";
    // ── entry log: DB query 이전 무조건 기록 ──────────────────────────────
    console.log(`[unwritten-slots-entry] { request_id: "${reqId}", includeWritten: ${includeWritten}, authenticated: true }`);
    let stage = "INIT";
    let teacherId = "";
    let poolId = "";
    let classGroupCount = 0;
    try {
      const { userId, role } = req.user!;
      teacherId = userId.slice(-8); // 개인정보 미포함 — 마지막 8자만
      stage = "RESOLVE_POOL";

      poolId = (await getUserPoolId(userId)) ?? "";
      if (!poolId) {
        console.warn(`[unwritten-slots] { request_id: "${reqId}", stage: "RESOLVE_POOL", role: "${role}", teacher_id: "${teacherId}", error: "pool_not_found" }`);
        return apiErr(res, 403, "수영장 정보가 없습니다.");
      }

      stage = "LOAD_CLASS_GROUPS";
      // 선생님: 본인 반만, 관리자: 전체
      let classRows;
      if (role === "teacher") {
        classRows = await db.execute(sql`
          SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time,
            (SELECT COUNT(*) FROM students s WHERE (s.class_group_id = cg.id OR s.assigned_class_ids @> to_jsonb(cg.id::text)) AND s.status NOT IN ('withdrawn','deleted')) AS student_count
          FROM class_groups cg
          WHERE (cg.teacher_user_id = ${userId} OR cg.co_teacher_ids @> to_jsonb(${userId}::text)) AND cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
        `);
      } else {
        classRows = await db.execute(sql`
          SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time,
            (SELECT COUNT(*) FROM students s WHERE (s.class_group_id = cg.id OR s.assigned_class_ids @> to_jsonb(cg.id::text)) AND s.status NOT IN ('withdrawn','deleted')) AS student_count
          FROM class_groups cg
          WHERE cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
        `);
      }
      classGroupCount = (classRows.rows as any[]).length;

      const DAY_MAP: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };
      const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

      stage = "KST_CLOCK";
      // KST 기준 현재 시각 — getKSTNow()는 이 파일 상단에 정의된 기존 헬퍼
      const now = getKSTNow();
      const todayMidnight = new Date(now);
      todayMidnight.setHours(0, 0, 0, 0);
      // 8주 전부터 오늘까지의 날짜를 생성 (오늘 회차는 startTime 기준 필터)
      const fromDate = new Date(todayMidnight);
      fromDate.setDate(fromDate.getDate() - 56);

      // 현재 시각을 "HH:MM" 문자열로 변환 (KST 기준)
      const nowTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const todayDateStr = `${todayMidnight.getFullYear()}-${String(todayMidnight.getMonth() + 1).padStart(2, "0")}-${String(todayMidnight.getDate()).padStart(2, "0")}`;

      const slots: any[] = [];

      stage = "GENERATE_SLOTS";
      for (const cg of classRows.rows as any[]) {
        const days: number[] = [];
        for (const ch of (cg.schedule_days || "")) {
          if (DAY_MAP[ch] !== undefined) days.push(DAY_MAP[ch]);
        }
        if (days.length === 0) continue;

        stage = "DIARY_LOOKUP";
        // 이 반의 기작성 일지 날짜 목록
        const writtenRows = await db.execute(sql`
          SELECT id, lesson_date FROM class_diaries
          WHERE class_group_id = ${cg.id} AND is_deleted = false
        `);
        stage = "NORMALIZE_DATES";
        // normalizeLessonDate: Date 객체/문자열 모두 "YYYY-MM-DD"로 정규화 (single source of truth)
        const writtenDates = new Set((writtenRows.rows as any[]).map((r: any) => normalizeLessonDate(r.lesson_date)));
        // diaryId 조회용 맵 (includeWritten 모드에서 사용)
        const writtenDateToId = new Map<string, string>();
        if (includeWritten) {
          for (const r of writtenRows.rows as any[]) {
            writtenDateToId.set(normalizeLessonDate(r.lesson_date), String(r.id));
          }
        }

        const scheduleTime = (cg.schedule_time || "").slice(0, 5); // "HH:MM"

        stage = "DATE_RANGE";
        // fromDate ~ 오늘까지 schedule_days에 해당하는 날짜 생성
        const cursor = new Date(fromDate);
        while (cursor <= todayMidnight) {
          if (days.includes(cursor.getDay())) {
            const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;

            // 오늘 회차: startTime이 현재 시각보다 미래이면 제외 (아직 시작 전)
            if (dateStr === todayDateStr && scheduleTime && scheduleTime > nowTimeStr) {
              cursor.setDate(cursor.getDate() + 1);
              continue;
            }

            const hasDiary = writtenDates.has(dateStr);
            if (includeWritten || !hasDiary) {
              slots.push({
                classGroupId: cg.id,
                className: cg.name,
                scheduleTime,
                lessonDate: dateStr,
                dayOfWeek: KO_DAYS[cursor.getDay()],
                studentCount: Number(cg.student_count) || 0,
                hasDiary,
                ...(includeWritten && hasDiary ? { diaryId: writtenDateToId.get(dateStr) ?? null } : {}),
              });
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      stage = "SORT_RESPONSE";
      // 날짜 오름차순, 같은 날짜면 시간 오름차순
      slots.sort((a, b) => {
        const dateCmp = a.lessonDate.localeCompare(b.lessonDate);
        if (dateCmp !== 0) return dateCmp;
        return a.scheduleTime.localeCompare(b.scheduleTime);
      });

      console.log(`[unwritten-slots] { request_id: "${reqId}", stage: "OK", role: "${role}", teacher_id: "${teacherId}", pool_id: "${poolId}", includeWritten: ${includeWritten}, class_group_count: ${classGroupCount}, slot_count: ${slots.length} }`);
      res.json({ success: true, slots, total: slots.length });
    } catch (e: any) {
      console.error(`[unwritten-slots] { request_id: "${reqId}", stage: "${stage}", teacher_id: "${teacherId}", pool_id: "${poolId}", includeWritten: ${includeWritten}, class_group_count: ${classGroupCount}, error_name: "${e?.name ?? "unknown"}", error_message: "${String(e?.message ?? "").slice(0, 120)}", stack_top: "${String(e?.stack ?? "").split("\n")[1]?.trim().slice(0, 120) ?? ""}" }`);
      apiErr(res, 500, "서버 오류");
    }
  }
);

router.get("/diaries/:id",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);

      const rows = await db.execute(sql`
        SELECT cd.*, cg.name AS class_name
        FROM class_diaries cd
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.id = ${req.params.id} AND cd.swimming_pool_id = ${poolId} AND cd.is_deleted = false
      `);
      const diary = rows.rows[0] as any;
      if (!diary) return apiErr(res, 404, "일지를 찾을 수 없습니다.");
      if (role === "teacher" && diary.teacher_id !== userId) {
        return apiErr(res, 403, "접근 권한이 없습니다.");
      }

      // 학생별 추가 일지
      const noteRows = await db.execute(sql`
        SELECT csn.*, s.name AS student_name
        FROM class_diary_student_notes csn
        JOIN students s ON s.id = csn.student_id
        WHERE csn.diary_id = ${req.params.id} AND csn.is_deleted = false
      `);

      res.json({ ...diary, student_notes: noteRows.rows });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ── PUT /diaries/:id ─────────────────────────────────────────────────────
router.put("/diaries/:id",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const { common_content } = req.body;
      if (!common_content?.trim()) return apiErr(res, 400, "내용을 입력해주세요.");

      const poolId = await getUserPoolId(userId);
      const rows = await db.execute(sql`SELECT * FROM class_diaries WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      const diary = rows.rows[0] as any;
      if (!diary) return apiErr(res, 404, "일지를 찾을 수 없습니다.");
      if (diary.is_deleted) return apiErr(res, 400, "삭제된 일지는 수정할 수 없습니다.");
      if (role === "teacher" && diary.teacher_id !== userId) return apiErr(res, 403, "본인 일지만 수정할 수 있습니다.");

      const actorName = await getUserName(userId);
      await db.execute(sql`
        UPDATE class_diaries
        SET common_content = ${common_content.trim()}, is_edited = true,
            edited_at = NOW(), edited_by = ${userId}, updated_at = NOW()
        WHERE id = ${req.params.id}
      `);
      await logAudit({
        diaryId: req.params.id, targetType: "common", actionType: "update",
        beforeContent: diary.common_content, afterContent: common_content.trim(),
        actorId: userId, actorName, actorRole: role, poolId: poolId!,
      });
      logPoolEvent({
        pool_id: poolId!, event_type: "journal.update", entity_type: "class_diary",
        entity_id: req.params.id, actor_id: userId,
        payload: { class_group_id: diary.class_group_id },
      }).catch(() => {});
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ── DELETE /diaries/:id (soft delete) ────────────────────────────────────
router.delete("/diaries/:id",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    const diaryId = req.params.id;
    const transactionId = genId("tx");
    console.log(`[DIARY DELETE START] diaryId=${diaryId} deploymentVersion=${DEPLOY_VERSION} dbHost=${DB_HOST} transactionId=${transactionId} userId=${req.user?.userId} role=${req.user?.role}`);
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);
      console.log(`[DIARY DELETE START] poolId=${poolId} transactionId=${transactionId}`);

      // ── 삭제 대상 조회 ──
      const rows = await db.execute(sql`
        SELECT id, is_deleted, teacher_id, class_group_id, common_content, swimming_pool_id
        FROM class_diaries
        WHERE id = ${diaryId} AND swimming_pool_id = ${poolId}
      `);
      const diary = rows.rows[0] as any;
      console.log(`[DELETE /diaries] SELECT: ${diary
        ? `found — is_deleted=${diary.is_deleted}, teacher_id=${diary.teacher_id}, pool=${diary.swimming_pool_id}`
        : "NOT FOUND (id or poolId mismatch)"}`);

      if (!diary) return apiErr(res, 404, "일지를 찾을 수 없습니다.");
      if (diary.is_deleted) {
        console.log(`[DELETE /diaries] already deleted — returning 200 idempotent`);
        return res.json({ success: true, alreadyDeleted: true, id: diaryId });
      }
      if (role === "teacher" && diary.teacher_id !== userId) {
        console.log(`[DELETE /diaries] REJECTED — not owner (diary.teacher_id=${diary.teacher_id} !== userId=${userId})`);
        return apiErr(res, 403, "본인 일지만 삭제할 수 있습니다.");
      }

      const actorName = await getUserName(userId);

      // ── 트랜잭션: db.transaction() 으로 동일 커넥션 보장 ──────────────────
      // ⚠️ 이전 방식(db.execute(BEGIN)/COMMIT)은 pg.Pool에서 커넥션이 달라져
      //    트랜잭션이 무효화되는 버그가 있었음. drizzle 정식 API 사용.
      let diaryRowCount = 0;
      let photoRowCount = 0;
      let noteCount = 0;

      console.log(`[DELETE /diaries] BEGIN transaction`);
      await db.transaction(async (tx) => {
        // 1. journals soft-delete
        console.log(`[DELETE /diaries] TX step1: UPDATE class_diaries SET is_deleted=true`);
        const diaryRes = await tx.execute(sql`
          UPDATE class_diaries
          SET is_deleted = true, deleted_at = NOW(), deleted_by = ${userId}, updated_at = NOW()
          WHERE id = ${diaryId} AND swimming_pool_id = ${poolId}
        `);
        diaryRowCount = (diaryRes as any).rowCount ?? 0;
        console.log(`[DELETE /diaries] TX step1: affectedRows=${diaryRowCount}`);
        if (diaryRowCount === 0) {
          throw new Error(`UPDATE class_diaries returned 0 rows — diaryId=${diaryId} poolId=${poolId}`);
        }

        // 2. student_notes 현황 로깅 (삭제는 별도 API, 여기서는 카운트만)
        const noteRes = await tx.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM class_diary_student_notes
          WHERE diary_id = ${diaryId} AND is_deleted = false
        `);
        noteCount = (noteRes.rows[0] as any)?.cnt ?? 0;
        console.log(`[DELETE /diaries] TX step2: student_notes(not deleted) count=${noteCount}`);

        // 3. photo_assets_meta 처리 — clone row는 삭제, 원본 row는 detached
        console.log(`[DELETE /diaries] TX step3: clone rows DELETE + original rows detach`);

        // 3-a. clone row 삭제 (journal_id 직접 연결)
        await tx.execute(sql`
          DELETE FROM photo_assets_meta
          WHERE journal_id = ${diaryId}
            AND pool_id = ${poolId}
            AND is_clone = true
        `);

        // 3-b. clone row 삭제 (student_note 경유)
        await tx.execute(sql`
          DELETE FROM photo_assets_meta
          WHERE student_note_id IN (
            SELECT id FROM class_diary_student_notes WHERE diary_id = ${diaryId}
          )
            AND pool_id = ${poolId}
            AND is_clone = true
        `);

        // 3-c. 원본 row detach (journal_id 직접 연결)
        const photoRes = await tx.execute(sql`
          UPDATE photo_assets_meta
          SET journal_id = NULL,
              student_note_id = NULL,
              media_status = 'detached'
          WHERE journal_id = ${diaryId}
            AND pool_id = ${poolId}
            AND is_clone = false
        `);
        photoRowCount = (photoRes as any).rowCount ?? 0;
        console.log(`[DELETE /diaries] TX step3: clone deleted, original detached=${photoRowCount}`);

        // 3-d. 원본 row detach (student_note 경유, journal_id 없이 student_note_id만 있는 경우)
        await tx.execute(sql`
          UPDATE photo_assets_meta
          SET student_note_id = NULL,
              student_id = NULL,
              media_status = 'detached'
          WHERE student_note_id IN (
            SELECT id FROM class_diary_student_notes WHERE diary_id = ${diaryId}
          )
            AND pool_id = ${poolId}
            AND is_clone = false
        `);

        // 4. WP7: growth_events soft-invalidation (diary note와 연결된 성장 이벤트)
        //    성장 이벤트는 hard-delete하지 않고 is_invalidated=true 로 무효화.
        //    diary FK(diary_note_id)는 보존됨.
        const geRes = await tx.execute(sql`
          UPDATE growth_events
          SET is_invalidated = true, invalidated_at = NOW()
          WHERE diary_note_id IN (
            SELECT id FROM class_diary_student_notes WHERE diary_id = ${diaryId}
          )
          AND is_invalidated = false
        `);
        const geRowCount = (geRes as any).rowCount ?? 0;
        console.log(`[DELETE /diaries] TX step4: growth_events invalidated=${geRowCount}`);

        // 5. video_assets_meta detach — journal_id 직접 연결 영상
        console.log(`[DELETE /diaries] TX step5: UPDATE video_assets_meta SET journal_id=NULL`);
        const videoRes1 = await tx.execute(sql`
          UPDATE video_assets_meta
          SET journal_id = NULL
          WHERE journal_id = ${diaryId} AND pool_id = ${poolId}
        `);
        console.log(`[DELETE /diaries] TX step5: video(journal) affectedRows=${(videoRes1 as any).rowCount ?? 0}`);

        // 6. video_assets_meta detach — student_note 경유 연결 영상
        console.log(`[DELETE /diaries] TX step6: UPDATE video_assets_meta SET student_note_id=NULL`);
        const videoRes2 = await tx.execute(sql`
          UPDATE video_assets_meta
          SET student_note_id = NULL
          WHERE student_note_id IN (
            SELECT id FROM class_diary_student_notes WHERE diary_id = ${diaryId}
          ) AND pool_id = ${poolId}
        `);
        console.log(`[DELETE /diaries] TX step6: video(note) affectedRows=${(videoRes2 as any).rowCount ?? 0}`);
      });
      // ── GAUGE-04/05: CPO invalidation → SCP 재계산 (TX 외부 — fail-safe) ──
      // 노트가 있는 학생들의 CPO를 무효화 후 SCP 재계산.
      {
        const noteStudentRes = await db.execute(sql`
          SELECT DISTINCT student_id FROM class_diary_student_notes WHERE diary_id = ${diaryId}
        `).catch(() => ({ rows: [] }));
        const noteStudentIds = (noteStudentRes.rows as any[]).map((r) => r.student_id).filter(Boolean);
        for (const studentId of noteStudentIds) {
          invalidateSessionObservation(db, { studentId, poolId: poolId!, lessonSessionId: diaryId })
            .then((r) => {
              console.log(`[diary-delete] CPO mapper student=${studentId} status=${r.status}`);
              return computeConfirmedProgress(db, studentId, poolId!);
            })
            .then((c) => console.log(`[diary-delete] SCP confirmed student=${studentId} status=${c.status} display=${c.displayConfirmedPct}`))
            .catch((e) => console.error(`[diary-delete] gauge pipeline error student=${studentId}:`, e));
        }
      }

      // ── POST-COMMIT 검증: 트랜잭션 커밋 후 실제 DB 상태 확인 ──────────────
      const verifyRow = await db.execute(sql`
        SELECT id, is_deleted, deleted_at, updated_at FROM class_diaries WHERE id = ${diaryId}
      `);
      const verified = verifyRow.rows[0] as any;
      console.log(`[DIARY DELETE COMMIT] diaryId=${diaryId} transactionId=${transactionId} isDeletedAfter=${verified?.is_deleted} deletedAtAfter=${verified?.deleted_at} updatedAt=${verified?.updated_at} diaryRows=${diaryRowCount} photoRows=${photoRowCount}`);

      // ── photo_assets_meta 검증 ──────────────────────────────────────────────
      const photoVerify = await db.execute(sql`
        SELECT COUNT(*) AS still_attached
        FROM photo_assets_meta
        WHERE journal_id = ${diaryId} AND media_status = 'attached'
      `);
      const stillAttached = (photoVerify.rows[0] as any)?.still_attached ?? '?';
      console.log(`[DELETE /diaries] POST-COMMIT photo verify: still_attached_count=${stillAttached}`);

      // ── 후처리: audit (트랜잭션 외부) ──────────────────────────────────────
      await logAudit({
        diaryId, targetType: "common", actionType: "delete",
        beforeContent: diary.common_content,
        actorId: userId, actorName, actorRole: role, poolId: poolId!,
      }).catch(e => console.error(`[DELETE /diaries] logAudit error:`, e));
      logPoolEvent({
        pool_id: poolId!, event_type: "journal.delete", entity_type: "class_diary",
        entity_id: diaryId, actor_id: userId,
        payload: { class_group_id: diary.class_group_id },
      }).catch(() => {});

      console.log(`[DELETE /diaries] ◀ RESPONSE 200 — diaryId=${diaryId}`);
      res.json({
        success: true,
        _verify: {
          is_deleted: verified?.is_deleted,
          deleted_at: verified?.deleted_at,
          still_attached_photos: stillAttached,
        },
      });
    } catch (e) {
      console.error(`[DELETE /diaries] ✖ ERROR — diaryId=${diaryId}:`, e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ── POST /diaries/repair-orphan-media — 삭제된 일지에 연결된 고아 미디어 정리 ──
// Issue 1: 이전 버전(BEGIN/COMMIT 버그)으로 생성된 고아 레코드를 수동 정리.
// pool_admin은 자신의 풀만, super_admin은 전체 정리.
router.post("/diaries/repair-orphan-media",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const poolId = role === "super_admin" ? null : await getUserPoolId(userId);
      if (role !== "super_admin" && !poolId) return apiErr(res, 403, "수영장 정보를 찾을 수 없습니다.");

      const poolFilter = poolId
        ? sql`AND pool_id = ${poolId}`
        : sql``;
      const diaryPoolFilter = poolId
        ? sql`AND swimming_pool_id = ${poolId}`
        : sql``;

      // 1. photo_assets_meta: journal_id 경유 고아 (삭제된 일지 직접 연결)
      const photo1 = await db.execute(sql`
        UPDATE photo_assets_meta
        SET journal_id = NULL, student_note_id = NULL, media_status = 'detached'
        WHERE media_status = 'attached'
          AND journal_id IS NOT NULL
          AND journal_id IN (
            SELECT id FROM class_diaries WHERE is_deleted = true ${diaryPoolFilter}
          )
          ${poolFilter}
      `);

      // 2. photo_assets_meta: student_note_id 경유 고아 (student_note → 삭제된 일지)
      const photo2 = await db.execute(sql`
        UPDATE photo_assets_meta
        SET student_note_id = NULL, media_status = 'detached'
        WHERE media_status = 'attached'
          AND student_note_id IS NOT NULL
          AND journal_id IS NULL
          AND student_note_id IN (
            SELECT csn.id FROM class_diary_student_notes csn
            JOIN class_diaries cd ON cd.id = csn.diary_id AND cd.is_deleted = true
            ${poolId ? sql`WHERE cd.swimming_pool_id = ${poolId}` : sql``}
          )
          ${poolFilter}
      `);

      // 3. video_assets_meta: journal_id 경유 고아
      const video1 = await db.execute(sql`
        UPDATE video_assets_meta
        SET journal_id = NULL
        WHERE journal_id IS NOT NULL
          AND journal_id IN (
            SELECT id FROM class_diaries WHERE is_deleted = true ${diaryPoolFilter}
          )
          ${poolFilter}
      `);

      // 4. video_assets_meta: student_note_id 경유 고아
      const video2 = await db.execute(sql`
        UPDATE video_assets_meta
        SET student_note_id = NULL
        WHERE student_note_id IS NOT NULL
          AND student_note_id IN (
            SELECT csn.id FROM class_diary_student_notes csn
            JOIN class_diaries cd ON cd.id = csn.diary_id AND cd.is_deleted = true
            ${poolId ? sql`WHERE cd.swimming_pool_id = ${poolId}` : sql``}
          )
          ${poolFilter}
      `);

      const result = {
        photos_repaired_journal:    (photo1 as any).rowCount ?? 0,
        photos_repaired_note:       (photo2 as any).rowCount ?? 0,
        videos_repaired_journal:    (video1 as any).rowCount ?? 0,
        videos_repaired_note:       (video2 as any).rowCount ?? 0,
      };
      console.log(`[repair-orphan-media] pool=${poolId ?? "ALL"} result=${JSON.stringify(result)}`);
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[repair-orphan-media] ERROR:", e);
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 3. 학생별 추가 일지 CRUD
// ── POST /diaries/with-media — 일지+사진 통합 저장 (단일 트랜잭션) ──────────
// 기존 POST /diaries + diary-attach + note-attach 분리 호출 대신 사용
router.post("/diaries/with-media",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const {
        class_group_id,
        lesson_date,
        common_content,
        common_photo_ids,
        student_notes,
      } = req.body as {
        class_group_id: string;
        lesson_date?: string;
        common_content?: string;
        common_photo_ids?: string[];
        student_notes?: Array<{
          student_id: string;
          note_content: string;
          photo_ids?: string[];
        }>;
      };

      if (!class_group_id) return apiErr(res, 400, "class_group_id는 필수입니다.");

      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보를 찾을 수 없습니다.");

      const teacherName = await getUserName(userId);

      // 권한 검증
      if (role === "teacher") {
        const dbUserRow = await db.execute(sql`SELECT role FROM users WHERE id = ${userId}`);
        const dbRole = (dbUserRow.rows[0] as any)?.role;
        if (dbRole !== "pool_admin") {
          const r = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId} AND (teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text))`);
          if (r.rows.length === 0) return apiErr(res, 403, "본인 반의 일지만 작성할 수 있습니다.");
        }
      } else {
        const r = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId} AND is_deleted = false`);
        if (r.rows.length === 0) return apiErr(res, 403, "해당 반을 찾을 수 없습니다.");
      }

      const dateStr = lesson_date || new Date().toISOString().slice(0, 10);

      // 중복 방지
      const dup = await db.execute(sql`
        SELECT id FROM class_diaries
        WHERE class_group_id = ${class_group_id} AND lesson_date = ${dateStr} AND is_deleted = false
      `);
      if (dup.rows.length > 0) {
        return apiErr(res, 409, "이미 해당 날짜에 일지가 작성되었습니다. 수정 기능을 사용해주세요.");
      }

      const notes: any[] = Array.isArray(student_notes) ? student_notes : [];
      const cPhotoIds = Array.isArray(common_photo_ids) ? common_photo_ids : [];

      // 트랜잭션 전 사진 소유권·중복 연결 검증
      const allPrePhotoIds = [...cPhotoIds];
      for (const n of notes) {
        if (Array.isArray(n.photo_ids)) allPrePhotoIds.push(...(n.photo_ids as string[]));
      }
      const uniquePrePhotoIds = [...new Set(allPrePhotoIds)];
      if (uniquePrePhotoIds.length > 0) {
        const preLiteral = `{${uniquePrePhotoIds.join(",")}}`;
        const checkRow = await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM photo_assets_meta
          WHERE id = ANY(${preLiteral}::text[]) AND pool_id = ${poolId}
        `);
        if (Number((checkRow.rows[0] as any)?.cnt ?? 0) !== uniquePrePhotoIds.length) {
          return apiErr(res, 403, "일부 사진에 대한 접근 권한이 없습니다.");
        }
        const alreadyAttachedCheck = await db.execute(sql`
          SELECT id FROM photo_assets_meta
          WHERE id = ANY(${preLiteral}::text[]) AND media_status = 'attached'
        `);
        if ((alreadyAttachedCheck.rows as any[]).length > 0) {
          const ids = (alreadyAttachedCheck.rows as any[]).map((r: any) => r.id).join(", ");
          return apiErr(res, 409, `이미 다른 일지에 연결된 사진이 포함되어 있습니다: ${ids}`);
        }
      }

      const diaryId = genId("cd");
      const savedNotes: any[] = [];

      // 단일 트랜잭션: 일지 + 노트 + 사진 연결 (db.transaction으로 동일 커넥션 보장)
      await db.transaction(async (tx) => {
        // 1. 일지 생성
        await tx.execute(sql`
          INSERT INTO class_diaries (id, class_group_id, teacher_id, teacher_name, swimming_pool_id, lesson_date, common_content)
          VALUES (${diaryId}, ${class_group_id}, ${userId}, ${teacherName}, ${poolId}, ${dateStr}, ${(common_content || "").trim()})
        `);

        // 2. 학생별 노트 생성
        for (const n of notes) {
          if (!n.student_id || !n.note_content?.trim()) continue;
          const noteId = genId("csn");
          await tx.execute(sql`
            INSERT INTO class_diary_student_notes (id, diary_id, student_id, note_content)
            VALUES (${noteId}, ${diaryId}, ${n.student_id}, ${n.note_content.trim()})
          `);
          savedNotes.push({ id: noteId, student_id: n.student_id, note_content: n.note_content.trim() });
        }

        // 3. 공통 사진 연결 (tx 내 인라인 SQL — mediaService db.execute() 대신 tx.execute() 사용)
        if (cPhotoIds.length > 0) {
          const literal = `{${cPhotoIds.join(",")}}`;
          await tx.execute(sql`
            UPDATE photo_assets_meta
            SET journal_id = ${diaryId},
                class_id = COALESCE(class_id, ${class_group_id}),
                media_status = 'attached'
            WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
          `);
        }

        // 4. 학생별 개인 사진 연결 (tx 내 인라인 SQL)
        for (const note of savedNotes) {
          const origNote = notes.find((n: any) => n.student_id === note.student_id);
          const photoIds: string[] = Array.isArray(origNote?.photo_ids) ? origNote.photo_ids : [];
          if (photoIds.length > 0) {
            const literal = `{${photoIds.join(",")}}`;
            await tx.execute(sql`
              UPDATE photo_assets_meta
              SET student_note_id = ${note.id},
                  student_id = ${note.student_id},
                  journal_id = COALESCE(journal_id, ${diaryId}),
                  class_id = COALESCE(class_id, ${class_group_id}),
                  media_status = 'attached'
              WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
            `);
          }
        }
      });

      // 5. 감사 로그 (트랜잭션 외부)
      await logAudit({
        diaryId, targetType: "common", actionType: "create",
        afterContent: (common_content || "").trim(),
        actorId: userId, actorName: teacherName, actorRole: role, poolId,
      });
      for (const n of savedNotes) {
        await logAudit({
          diaryId, studentNoteId: n.id, targetType: "student_note", actionType: "create",
          afterContent: n.note_content,
          actorId: userId, actorName: teacherName, actorRole: role, poolId,
        });
      }

      // 6. 학부모 푸시 알림
      const cgRow = await db.execute(sql`SELECT name FROM class_groups WHERE id = ${class_group_id}`);
      const className = (cgRow.rows[0] as any)?.name || "수업";
      if ((common_content || "").trim()) {
        sendDiaryPush(class_group_id, diaryId, className, poolId, dateStr);
      } else {
        const noteStudentIds = savedNotes.map((n: any) => n.student_id);
        sendDiaryPushToStudents(noteStudentIds, diaryId, className, poolId, dateStr);
      }

      logPoolEvent({
        pool_id: poolId, event_type: "journal.create", entity_type: "class_diary",
        entity_id: diaryId, actor_id: userId,
        payload: { class_group_id, lesson_date: dateStr, with_media: true },
      }).catch(() => {});

      res.json({ success: true, diary_id: diaryId, student_notes: savedNotes });
    } catch (e: any) {
      console.error(e);
      if (e.message?.includes("일지를") || e.message?.includes("학생") || e.message?.includes("접근")) {
        return apiErr(res, 400, e.message);
      }
      apiErr(res, 500, "서버 오류");
    }
  }
);

// ════════════════════════════════════════════════════════════════════════

// ── POST /diaries/:id/student-notes ──────────────────────────────────────
router.post("/diaries/:id/student-notes",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const { student_id, note_content } = req.body;
      if (!student_id || !note_content?.trim()) return apiErr(res, 400, "학생 ID와 내용은 필수입니다.");

      const poolId = await getUserPoolId(userId);
      const dRows = await db.execute(sql`SELECT * FROM class_diaries WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      const diary = dRows.rows[0] as any;
      if (!diary) return apiErr(res, 404, "일지를 찾을 수 없습니다.");
      if (diary.is_deleted) return apiErr(res, 400, "삭제된 일지에는 추가할 수 없습니다.");
      if (role === "teacher" && diary.teacher_id !== userId) return apiErr(res, 403, "본인 일지에만 추가할 수 있습니다.");

      // 중복 방지
      const dup = await db.execute(sql`
        SELECT id FROM class_diary_student_notes WHERE diary_id = ${req.params.id} AND student_id = ${student_id} AND is_deleted = false
      `);
      if (dup.rows.length > 0) return apiErr(res, 409, "이미 이 학생의 추가 일지가 존재합니다. 수정을 사용해주세요.");

      const noteId = genId("csn");
      const actorName = await getUserName(userId);
      await db.execute(sql`
        INSERT INTO class_diary_student_notes (id, diary_id, student_id, note_content)
        VALUES (${noteId}, ${req.params.id}, ${student_id}, ${note_content.trim()})
      `);
      await logAudit({
        diaryId: req.params.id, studentNoteId: noteId, targetType: "student_note", actionType: "create",
        afterContent: note_content.trim(),
        actorId: userId, actorName, actorRole: role, poolId: poolId!,
      });
      res.json({ success: true, note_id: noteId });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ── PUT /diaries/student-notes/:noteId ───────────────────────────────────
router.put("/diaries/student-notes/:noteId",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const { note_content } = req.body;
      if (!note_content?.trim()) return apiErr(res, 400, "내용을 입력해주세요.");

      const poolId = await getUserPoolId(userId);
      const nRows = await db.execute(sql`
        SELECT csn.*, cd.teacher_id, cd.swimming_pool_id
        FROM class_diary_student_notes csn
        JOIN class_diaries cd ON cd.id = csn.diary_id
        WHERE csn.id = ${req.params.noteId} AND cd.swimming_pool_id = ${poolId}
      `);
      const note = nRows.rows[0] as any;
      if (!note) return apiErr(res, 404, "추가 일지를 찾을 수 없습니다.");
      if (note.is_deleted) return apiErr(res, 400, "삭제된 추가 일지는 수정할 수 없습니다.");
      if (role === "teacher" && note.teacher_id !== userId) return apiErr(res, 403, "본인 일지만 수정할 수 있습니다.");

      const actorName = await getUserName(userId);
      await db.execute(sql`
        UPDATE class_diary_student_notes
        SET note_content = ${note_content.trim()}, is_edited = true,
            edited_at = NOW(), edited_by = ${userId}, updated_at = NOW()
        WHERE id = ${req.params.noteId}
      `);
      await logAudit({
        diaryId: note.diary_id, studentNoteId: req.params.noteId, targetType: "student_note", actionType: "update",
        beforeContent: note.note_content, afterContent: note_content.trim(),
        actorId: userId, actorName, actorRole: role, poolId: poolId!,
      });

      // ── GAUGE-04A/05: note 텍스트 변경 후 CPO 재계산 → SCP 재계산 ────────────
      // growth_events는 그대로 유지; mapper가 새 note_content로 재분류.
      upsertSessionObservation(db, {
        studentId: note.student_id,
        poolId:    poolId!,
        lessonSessionId: note.diary_id,
      })
        .then((r) => {
          console.log(`[student-note-edit] CPO mapper student=${note.student_id} diary=${note.diary_id} status=${r.status} rank=${r.progressRank}`);
          return computeConfirmedProgress(db, note.student_id, poolId!);
        })
        .then((c) => console.log(`[student-note-edit] SCP confirmed student=${note.student_id} status=${c.status} display=${c.displayConfirmedPct}`))
        .catch((e) => console.error(`[student-note-edit] gauge pipeline error student=${note.student_id}:`, e));

      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ── DELETE /diaries/student-notes/:noteId ────────────────────────────────
router.delete("/diaries/student-notes/:noteId",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);
      const nRows = await db.execute(sql`
        SELECT csn.*, cd.teacher_id, cd.swimming_pool_id
        FROM class_diary_student_notes csn
        JOIN class_diaries cd ON cd.id = csn.diary_id
        WHERE csn.id = ${req.params.noteId} AND cd.swimming_pool_id = ${poolId}
      `);
      const note = nRows.rows[0] as any;
      if (!note) return apiErr(res, 404, "추가 일지를 찾을 수 없습니다.");
      if (note.is_deleted) return apiErr(res, 400, "이미 삭제된 추가 일지입니다.");
      if (role === "teacher" && note.teacher_id !== userId) return apiErr(res, 403, "본인 일지만 삭제할 수 있습니다.");

      const actorName = await getUserName(userId);
      await db.execute(sql`
        UPDATE class_diary_student_notes
        SET is_deleted = true, deleted_at = NOW(), deleted_by = ${userId}, updated_at = NOW()
        WHERE id = ${req.params.noteId}
      `);
      await logAudit({
        diaryId: note.diary_id, studentNoteId: req.params.noteId, targetType: "student_note", actionType: "delete",
        beforeContent: note.note_content,
        actorId: userId, actorName, actorRole: role, poolId: poolId!,
      });

      // ── GAUGE-04A/05: note 삭제 후 CPO 재계산 → SCP 재계산 ──────────────────
      // 1. 삭제된 note에 연결된 growth_events invalidate (순서 보장 필요 → async chain)
      // 2. 나머지 유효 evidence 기준으로 CPO 재계산
      // 3. SCP confirmation 재계산
      // 실패해도 Diary 응답은 그대로 유지 (fire-and-forget).
      const noteId = req.params.noteId;
      const _noteStudentId = note.student_id;
      const _noteDiaryId   = note.diary_id;
      const _notePoolId    = poolId!;
      ;(async () => {
        await db.execute(sql`
          UPDATE growth_events
          SET is_invalidated = true, invalidated_at = NOW()
          WHERE diary_note_id = ${noteId} AND is_invalidated = false
        `);
        const r = await upsertSessionObservation(db, {
          studentId: _noteStudentId, poolId: _notePoolId, lessonSessionId: _noteDiaryId,
        });
        console.log(`[student-note-delete] CPO mapper student=${_noteStudentId} diary=${_noteDiaryId} status=${r.status} rank=${r.progressRank}`);
        const c = await computeConfirmedProgress(db, _noteStudentId, _notePoolId);
        console.log(`[student-note-delete] SCP confirmed student=${_noteStudentId} status=${c.status} display=${c.displayConfirmedPct}`);
      })().catch((e) => console.error(`[student-note-delete] gauge pipeline error student=${_noteStudentId}:`, e));

      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 4. 감사 기록 조회 (관리자 전용)
// ════════════════════════════════════════════════════════════════════════

router.get("/diaries/:id/audit-logs",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const poolId = await getUserPoolId(userId);
      const rows = await db.execute(sql`
        SELECT * FROM class_diary_audit_logs
        WHERE diary_id = ${req.params.id} AND swimming_pool_id = ${poolId}
        ORDER BY created_at ASC
      `);
      res.json(rows.rows);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 5. 일지 템플릿 레벨 관리
// ════════════════════════════════════════════════════════════════════════

// GET /diary-template-levels — 레벨 목록 (template_count 포함)
router.get("/diary-template-levels",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const rows = await db.execute(sql`
        SELECT dtl.id, dtl.level_name, dtl.sort_order,
               COUNT(dt.id) FILTER (WHERE dt.is_active = true) AS template_count
        FROM diary_template_levels dtl
        LEFT JOIN diary_templates dt ON dt.level_id = dtl.id AND dt.swimming_pool_id = ${poolId}
        WHERE dtl.swimming_pool_id = ${poolId}
        GROUP BY dtl.id, dtl.level_name, dtl.sort_order
        ORDER BY dtl.sort_order ASC, dtl.created_at ASC
      `);
      res.json(rows.rows.map((r: any) => ({ ...r, template_count: Number(r.template_count) })));
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-template-levels — 레벨 추가 (무제한)
router.post("/diary-template-levels",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const { level_name } = req.body;
      if (!level_name?.trim()) return apiErr(res, 400, "레벨 이름을 입력해주세요.");
      if (level_name.trim().length > 50) return apiErr(res, 400, "레벨 이름은 50자 이내로 입력해주세요.");
      const sortRow = await db.execute(sql`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM diary_template_levels WHERE swimming_pool_id = ${poolId}`);
      const sortOrder = Number((sortRow.rows[0] as any)?.next ?? 0);
      const id = genId("dtl");
      await db.execute(sql`INSERT INTO diary_template_levels (id, swimming_pool_id, level_name, sort_order) VALUES (${id}, ${poolId}, ${level_name.trim()}, ${sortOrder})`);
      res.json({ success: true, id });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-template-levels/reorder — 순서 일괄 변경
router.post("/diary-template-levels/reorder",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const { ordered_ids } = req.body;
      if (!Array.isArray(ordered_ids)) return apiErr(res, 400, "ordered_ids 필드 필요");
      for (let i = 0; i < ordered_ids.length; i++) {
        await db.execute(sql`UPDATE diary_template_levels SET sort_order = ${i} WHERE id = ${ordered_ids[i]} AND swimming_pool_id = ${poolId}`);
      }
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// PATCH /diary-template-levels/:id — 이름 변경
router.patch("/diary-template-levels/:id",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const { level_name } = req.body;
      if (!level_name?.trim()) return apiErr(res, 400, "레벨 이름을 입력해주세요.");
      if (level_name.trim().length > 50) return apiErr(res, 400, "레벨 이름은 50자 이내로 입력해주세요.");
      await db.execute(sql`UPDATE diary_template_levels SET level_name = ${level_name.trim()} WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// DELETE /diary-template-levels/:id — 레벨 삭제 (최소 1개 유지, 하위 템플릿 삭제)
router.delete("/diary-template-levels/:id",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const cntRow = await db.execute(sql`SELECT COUNT(*) AS cnt FROM diary_template_levels WHERE swimming_pool_id = ${poolId}`);
      if (Number((cntRow.rows[0] as any)?.cnt) <= 1) return apiErr(res, 400, "레벨이 1개 남았습니다. 최소 1개의 레벨은 유지되어야 합니다.");
      await db.execute(sql`DELETE FROM diary_templates WHERE level_id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      await db.execute(sql`DELETE FROM diary_template_levels WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-template-levels/:id/clear — 레벨 비우기 (이름 유지, 템플릿만 삭제)
router.post("/diary-template-levels/:id/clear",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      await db.execute(sql`DELETE FROM diary_templates WHERE level_id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 6. 일지 템플릿 관리 (scope: global=관리자공통 / teacher=선생님개인)
// ════════════════════════════════════════════════════════════════════════


const COL = `id, level_id, title, template_text, sort_order, is_active, category, level, scope, teacher_id`;

// GET /diary-templates — 템플릿 목록
// Admin: 모든 템플릿 / Teacher: global + 본인 teacher 템플릿
router.get("/diary-templates",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const levelId = req.query.level_id as string | undefined;
      const includeInactive = req.query.include_inactive === "true";
      const isAdmin = ["super_admin", "pool_admin"].includes(req.user!.role);
      const userId = req.user!.userId;

      const ORDER = sql`ORDER BY scope ASC, sort_order ASC, created_at ASC`;

      if (isAdmin) {
        // 관리자: scope='global' 원본 템플릿만 반환 (teacher override 제외)
        if (levelId) {
          const rows = includeInactive
            ? await db.execute(sql`SELECT ${sql.raw(COL)} FROM diary_templates WHERE swimming_pool_id = ${poolId} AND level_id = ${levelId} AND scope = 'global' ${ORDER}`)
            : await db.execute(sql`SELECT ${sql.raw(COL)} FROM diary_templates WHERE swimming_pool_id = ${poolId} AND level_id = ${levelId} AND scope = 'global' AND is_active = true ${ORDER}`);
          res.json(rows.rows);
        } else {
          const rows = await db.execute(sql`SELECT ${sql.raw(COL)} FROM diary_templates WHERE swimming_pool_id = ${poolId} AND scope = 'global' AND is_active = true ${ORDER}`);
          res.json(rows.rows);
        }
      } else {
        // Teacher: override 병합 뷰 (global LEFT JOIN teacher-override) + 선생님 신규 추가 항목
        const lvF   = levelId ? sql`AND g.level_id = ${levelId}`  : sql``;
        const lvFt  = levelId ? sql`AND level_id = ${levelId}` : sql``;
        // include_inactive=true: 선생님이 숨긴 항목도 관리 화면에 표시 (기본: 숨긴 항목 제외)
        const activeFilter = includeInactive ? sql`` : sql`AND COALESCE(ov.is_active, true) = true`;
        const merged = await db.execute(sql`
          SELECT
            g.id           AS global_id,
            g.id           AS id,
            COALESCE(ov.template_text, g.template_text) AS template_text,
            COALESCE(ov.title, g.title)                 AS title,
            g.level_id, g.sort_order,
            COALESCE(ov.is_active, g.is_active)         AS is_active,
            (ov.id IS NOT NULL)                         AS is_overridden,
            ov.id                                       AS override_id
          FROM diary_templates g
          LEFT JOIN diary_templates ov
            ON ov.source_template_id = g.id
           AND ov.scope = 'teacher'
           AND ov.teacher_id = ${userId}
           AND ov.swimming_pool_id = g.swimming_pool_id
          WHERE g.swimming_pool_id = ${poolId}
            AND g.scope = 'global'
            AND g.is_active = true
            ${lvF}
            ${activeFilter}
          ORDER BY g.sort_order ASC, g.created_at ASC
        `);
        const teacherNew = await db.execute(sql`
          SELECT
            NULL           AS global_id,
            id, template_text, title, level_id, sort_order, is_active,
            false          AS is_overridden,
            id             AS override_id
          FROM diary_templates
          WHERE swimming_pool_id = ${poolId}
            AND scope = 'teacher'
            AND teacher_id = ${userId}
            AND source_template_id IS NULL
            ${lvFt}
            ${includeInactive ? sql`` : sql`AND is_active = true`}
          ORDER BY sort_order ASC
        `);
        res.json([...merged.rows, ...teacherNew.rows]);
      }
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates/:id/override — 선생님 개인 override 생성/수정
router.post("/diary-templates/:id/override",
  requireAuth, requireRole("teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { template_text, title } = req.body;
      if (!template_text?.trim()) return apiErr(res, 400, "내용을 입력해주세요.");
      const globalId = req.params.id;
      const poolId   = await getUserPoolId(req.user!.userId);
      const userId   = req.user!.userId;

      const gCheck = await db.execute(sql`SELECT id, level_id, sort_order FROM diary_templates WHERE id = ${globalId} AND swimming_pool_id = ${poolId} AND scope = 'global'`);
      if (!gCheck.rows.length) return apiErr(res, 404, "원본 템플릿을 찾을 수 없습니다.");
      const g = gCheck.rows[0] as any;

      const existing = await db.execute(sql`SELECT id FROM diary_templates WHERE source_template_id = ${globalId} AND scope = 'teacher' AND teacher_id = ${userId} AND swimming_pool_id = ${poolId}`);
      if (existing.rows.length) {
        const ovId = (existing.rows[0] as any).id;
        await db.execute(sql`UPDATE diary_templates SET template_text = ${template_text.trim()}, title = ${title?.trim() || null}, updated_at = NOW() WHERE id = ${ovId}`);
        res.json({ success: true, id: ovId });
      } else {
        const newId = genId("dt");
        await db.execute(sql`INSERT INTO diary_templates (id, swimming_pool_id, template_text, title, level_id, sort_order, scope, teacher_id, source_template_id, created_by) VALUES (${newId}, ${poolId}, ${template_text.trim()}, ${title?.trim() || null}, ${g.level_id}, ${g.sort_order}, 'teacher', ${userId}, ${globalId}, ${userId})`);
        res.json({ success: true, id: newId });
      }
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates/:id/toggle-active — 선생님 개인 표시/숨기기
// global 템플릿: override에 is_active 저장 / teacher 본인 항목: 직접 업데이트
router.post("/diary-templates/:id/toggle-active",
  requireAuth, requireRole("teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { is_active } = req.body; // boolean
      if (typeof is_active !== "boolean") return apiErr(res, 400, "is_active(boolean) 필요");
      const templateId = req.params.id;
      const poolId = await getUserPoolId(req.user!.userId);
      const userId = req.user!.userId;

      const check = await db.execute(sql`
        SELECT id, scope, teacher_id, template_text, level_id, sort_order
        FROM diary_templates WHERE id = ${templateId} AND swimming_pool_id = ${poolId}
      `);
      if (!check.rows.length) return apiErr(res, 404, "템플릿을 찾을 수 없습니다.");
      const tpl = check.rows[0] as any;

      if (tpl.scope === "global") {
        // override 존재 여부 확인
        const existing = await db.execute(sql`
          SELECT id FROM diary_templates
          WHERE source_template_id = ${templateId} AND scope = 'teacher'
            AND teacher_id = ${userId} AND swimming_pool_id = ${poolId}
        `);
        if (existing.rows.length) {
          const ovId = (existing.rows[0] as any).id;
          await db.execute(sql`UPDATE diary_templates SET is_active = ${is_active}, updated_at = NOW() WHERE id = ${ovId}`);
        } else if (!is_active) {
          // 숨기는 경우에만 override 신규 생성
          const newId = genId("dt");
          await db.execute(sql`
            INSERT INTO diary_templates (id, swimming_pool_id, template_text, level_id, sort_order, scope, teacher_id, source_template_id, is_active, created_by)
            VALUES (${newId}, ${poolId}, ${tpl.template_text}, ${tpl.level_id}, ${tpl.sort_order}, 'teacher', ${userId}, ${templateId}, false, ${userId})
          `);
        }
        // is_active=true + override 없음 → 원래 표시 상태, 아무것도 안 해도 됨
      } else if (tpl.scope === "teacher" && tpl.teacher_id === userId) {
        await db.execute(sql`UPDATE diary_templates SET is_active = ${is_active}, updated_at = NOW() WHERE id = ${templateId} AND swimming_pool_id = ${poolId}`);
      } else {
        return apiErr(res, 403, "권한이 없습니다.");
      }
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// DELETE /diary-templates/:id/override — 선생님 override 초기화 (관리자 원본으로 복원)
router.delete("/diary-templates/:id/override",
  requireAuth, requireRole("teacher"),
  async (req: AuthRequest, res) => {
    try {
      const globalId = req.params.id;
      const poolId   = await getUserPoolId(req.user!.userId);
      const userId   = req.user!.userId;
      await db.execute(sql`DELETE FROM diary_templates WHERE source_template_id = ${globalId} AND scope = 'teacher' AND teacher_id = ${userId} AND swimming_pool_id = ${poolId}`);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates/restore-default — SwimNote 기본 템플릿 복원
router.post("/diary-templates/restore-default",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    console.log("[restore-default] 요청 수신 — userId:", req.user?.userId);
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      console.log("[restore-default] poolId:", poolId);
      if (!poolId) { apiErr(res, 403, "수영장 정보를 찾을 수 없습니다."); return; }
      await db.execute(sql`DELETE FROM diary_templates WHERE swimming_pool_id = ${poolId}`);
      await db.execute(sql`DELETE FROM diary_template_levels WHERE swimming_pool_id = ${poolId}`);
      await insertDefaultTemplates(poolId, req.user!.userId);
      console.log("[restore-default] 완료");
      // curriculum_items sync: 기본 템플릿 복원 후 재sync (await — 실패 시 500 전파)
      await syncDiaryTemplatesToCurriculumItems(poolId);
      res.json({ success: true });
    } catch (e) { console.error("[restore-default] 오류:", e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates/clear-all — 전체 초기화 (템플릿 + 레벨 모두 삭제)
router.post("/diary-templates/clear-all",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      await db.execute(sql`DELETE FROM diary_templates WHERE swimming_pool_id = ${poolId}`);
      await db.execute(sql`DELETE FROM diary_template_levels WHERE swimming_pool_id = ${poolId}`);
      // curriculum_items sync: 전체 삭제 후 모든 item 비활성화 (await — 실패 시 500 전파)
      if (poolId) await syncDiaryTemplatesToCurriculumItems(poolId);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates/reorder — 순서 일괄 변경
router.post("/diary-templates/reorder",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const { ordered_ids } = req.body;
      if (!Array.isArray(ordered_ids)) return apiErr(res, 400, "ordered_ids 필드 필요");
      const isAdmin = ["super_admin", "pool_admin"].includes(req.user!.role);
      const userId = req.user!.userId;
      for (let i = 0; i < ordered_ids.length; i++) {
        if (isAdmin) {
          await db.execute(sql`UPDATE diary_templates SET sort_order = ${i} WHERE id = ${ordered_ids[i]} AND swimming_pool_id = ${poolId}`);
        } else {
          await db.execute(sql`UPDATE diary_templates SET sort_order = ${i} WHERE id = ${ordered_ids[i]} AND swimming_pool_id = ${poolId} AND scope = 'teacher' AND teacher_id = ${userId}`);
        }
      }
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates — 템플릿 추가
// Admin → scope='global' / Teacher → scope='teacher'
router.post("/diary-templates",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { template_text, level_id, title, sort_order } = req.body;
      if (!template_text?.trim()) return apiErr(res, 400, "템플릿 내용을 입력해주세요.");
      const poolId = await getUserPoolId(req.user!.userId);
      const isAdmin = ["super_admin", "pool_admin"].includes(req.user!.role);
      const scope = isAdmin ? "global" : "teacher";
      const teacherId = isAdmin ? null : req.user!.userId;
      const id = genId("dt");
      await db.execute(sql`
        INSERT INTO diary_templates (id, swimming_pool_id, template_text, level_id, title, sort_order, scope, teacher_id, created_by)
        VALUES (${id}, ${poolId}, ${template_text.trim()}, ${level_id || null}, ${title?.trim() || null},
                ${sort_order ?? 0}, ${scope}, ${teacherId}, ${req.user!.userId})
      `);
      // curriculum_items sync: global template 추가 시만 (teacher 개인 추가는 제외, await — 실패 시 500 전파)
      if (scope === "global" && poolId) await syncDiaryTemplatesToCurriculumItems(poolId);
      res.json({ success: true, id });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates/:id/copy — 복사
router.post("/diary-templates/:id/copy",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const isAdmin = ["super_admin", "pool_admin"].includes(req.user!.role);
      const userId = req.user!.userId;
      const srcRows = await db.execute(sql`SELECT * FROM diary_templates WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      if (!srcRows.rows.length) return apiErr(res, 404, "템플릿을 찾을 수 없습니다.");
      const s = srcRows.rows[0] as any;
      const newId = genId("dt");
      const maxRow = await db.execute(sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM diary_templates WHERE level_id = ${s.level_id} AND swimming_pool_id = ${poolId}`);
      const newSort = Number((maxRow.rows[0] as any)?.next ?? 0);
      const newScope = isAdmin ? "global" : "teacher";
      const newTeacherId = isAdmin ? null : userId;
      await db.execute(sql`
        INSERT INTO diary_templates (id, swimming_pool_id, template_text, level_id, title, sort_order, scope, teacher_id, created_by)
        VALUES (${newId}, ${poolId}, ${s.template_text}, ${s.level_id}, ${s.title ? s.title + " 복사" : null},
                ${newSort}, ${newScope}, ${newTeacherId}, ${userId})
      `);
      res.json({ success: true, id: newId });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// PATCH /diary-templates/:id — 수정
// Admin: 모든 수정 가능 / Teacher: 본인 teacher 템플릿만
router.patch("/diary-templates/:id",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { template_text, is_active, level_id, title, sort_order } = req.body;
      const poolId = await getUserPoolId(req.user!.userId);
      const isAdmin = ["super_admin", "pool_admin"].includes(req.user!.role);
      const userId = req.user!.userId;
      if (!isAdmin) {
        const check = await db.execute(sql`SELECT scope, teacher_id FROM diary_templates WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
        const row = check.rows[0] as any;
        if (!row) return apiErr(res, 404, "템플릿을 찾을 수 없습니다.");
        if (row.scope === "global") return apiErr(res, 403, "공통 템플릿은 수정할 수 없습니다.");
        if (row.teacher_id !== userId) return apiErr(res, 403, "본인 템플릿만 수정할 수 있습니다.");
      }
      await db.execute(sql`
        UPDATE diary_templates
        SET template_text = COALESCE(${template_text?.trim() || null}, template_text),
            is_active     = COALESCE(${is_active ?? null}, is_active),
            level_id      = COALESCE(${level_id ?? null}, level_id),
            title         = COALESCE(${title?.trim() || null}, title),
            sort_order    = COALESCE(${sort_order ?? null}, sort_order),
            updated_at    = NOW()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      `);
      // curriculum_items sync: admin이 global 템플릿을 수정한 경우 (await — 실패 시 500 전파)
      if (isAdmin && poolId) await syncDiaryTemplatesToCurriculumItems(poolId);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// DELETE /diary-templates/:id — 삭제
// Admin: 모든 삭제 가능 / Teacher: 본인 teacher 템플릿만
router.delete("/diary-templates/:id",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const isAdmin = ["super_admin", "pool_admin"].includes(req.user!.role);
      const userId = req.user!.userId;
      let wasGlobal = false;
      if (!isAdmin) {
        const check = await db.execute(sql`SELECT scope, teacher_id FROM diary_templates WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
        const row = check.rows[0] as any;
        if (!row) return apiErr(res, 404, "템플릿을 찾을 수 없습니다.");
        if (row.scope === "global") return apiErr(res, 403, "공통 템플릿은 삭제할 수 없습니다.");
        if (row.teacher_id !== userId) return apiErr(res, 403, "본인 템플릿만 삭제할 수 있습니다.");
      } else {
        // admin 삭제: global 여부 확인 (curriculum sync 여부 결정)
        const check = await db.execute(sql`SELECT scope FROM diary_templates WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
        wasGlobal = (check.rows[0] as any)?.scope === "global";
      }
      await db.execute(sql`DELETE FROM diary_templates WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      // curriculum_items sync: global 템플릿 삭제 시 해당 item 비활성화 (await — 실패 시 500 전파)
      if (wasGlobal && poolId) await syncDiaryTemplatesToCurriculumItems(poolId);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 6. 레거시 diary 엔드포인트 유지 (swim_diary 테이블)
//    teacher/diary.tsx 의 기존 호출 대응용 — 신규 API 전환 전까지 유지
// ════════════════════════════════════════════════════════════════════════

router.get("/diary/class-groups",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);
      let rows;
      if (role === "teacher") {
        rows = await db.execute(sql`
          SELECT cg.*, (SELECT COUNT(*) FROM students s WHERE s.class_group_id = cg.id AND s.status != 'deleted') AS student_count
          FROM class_groups cg WHERE cg.teacher_user_id = ${userId} AND cg.swimming_pool_id = ${poolId}
          ORDER BY cg.schedule_days, cg.schedule_time
        `);
      } else {
        rows = await db.execute(sql`
          SELECT cg.*, (SELECT COUNT(*) FROM students s WHERE s.class_group_id = cg.id AND s.status != 'deleted') AS student_count
          FROM class_groups cg WHERE cg.swimming_pool_id = ${poolId}
          ORDER BY cg.schedule_days, cg.schedule_time
        `);
      }
      res.json(rows.rows);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// GET /diary — 레거시: class_diaries로 리다이렉트
router.get("/diary",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);
      const { class_group_id, date } = req.query;

      if (role === "teacher") {
        const myClasses = await db.execute(sql`SELECT id FROM class_groups WHERE teacher_user_id = ${userId}`);
        const classIds = (myClasses.rows as any[]).map(r => r.id);
        if (classIds.length === 0) { res.json([]); return; }
        const classFilter = classIds.map(id => `'${id}'`).join(",");
        const rows = await db.execute(sql`
          SELECT cd.*, cg.name AS class_name
          FROM class_diaries cd
          LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
          WHERE cd.swimming_pool_id = ${poolId}
            AND cd.class_group_id IN (${sql.raw(classFilter)})
            AND cd.is_deleted = false
            ${class_group_id ? sql`AND cd.class_group_id = ${class_group_id}` : sql``}
            ${date ? sql`AND cd.lesson_date = ${date}` : sql``}
          ORDER BY cd.lesson_date DESC, cd.created_at DESC
          LIMIT 50
        `);
        res.json(rows.rows);
      } else {
        const rows = await db.execute(sql`
          SELECT cd.*, cg.name AS class_name
          FROM class_diaries cd
          LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
          WHERE cd.swimming_pool_id = ${poolId} AND cd.is_deleted = false
          ORDER BY cd.lesson_date DESC, cd.created_at DESC
          LIMIT 100
        `);
        res.json(rows.rows);
      }
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 선생님 쪽지 (diary_messages) + overview API
// ════════════════════════════════════════════════════════════════════════

// GET /teacher/overview — 선생님 홈 대시보드 숫자
router.get("/teacher/overview",
  requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const poolId = await getUserPoolId(userId);
      const today = new Date().toISOString().slice(0, 10);

      // 내 반 목록
      const myClasses = await db.execute(sql`
        SELECT id FROM class_groups
        WHERE teacher_user_id = ${userId} AND swimming_pool_id = ${poolId}
      `);
      const classIds = (myClasses.rows as any[]).map(r => r.id);
      if (classIds.length === 0) {
        res.json({ unread_messages: 0, pending_diaries_today: 0, pending_diaries_past: 0, makeup_count: 0, unread_news: 0 });
        return;
      }

      const classIdList = classIds.map(id => `'${id}'`).join(",");

      // 안읽은 학부모 쪽지 수
      const unreadMsg = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM diary_messages dm
        JOIN class_diaries cd ON cd.id = dm.diary_id
        WHERE cd.class_group_id IN (${sql.raw(classIdList)})
          AND dm.sender_role = 'parent'
          AND dm.is_deleted = false
          AND dm.read_at IS NULL
      `).catch(() => ({ rows: [{ cnt: 0 }] }));

      // KST 기준 오늘 요일 (한글)
      const nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const dayNamesKr: Record<number, string> = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };
      const todayKr = dayNamesKr[nowKST.getDay()];

      // 오늘 미작성 수업일지 (오늘 요일에 실제 수업이 있는 반 중 diary 없는 것)
      const pendingToday = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM class_groups cg
        WHERE cg.id IN (${sql.raw(classIdList)})
          AND cg.is_deleted = false
          AND (
            (cg.is_one_time = false AND cg.schedule_days LIKE ${'%' + todayKr + '%'})
            OR (cg.is_one_time = true AND cg.one_time_date = ${today})
          )
          AND NOT EXISTS (
            SELECT 1 FROM class_diaries cd
            WHERE cd.class_group_id = cg.id AND cd.lesson_date = ${today} AND cd.is_deleted = false
          )
      `);

      // 지난 미작성 일지 수 — class_groups 스케줄 + lesson_date 기반 정확히 계산
      // unwritten-slots 엔드포인트와 동일한 로직 (single source of truth)
      const DAY_MAP_OV: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };
      const nowKSTOv = getKSTNow();
      const todayMidnightOv = new Date(nowKSTOv);
      todayMidnightOv.setHours(0, 0, 0, 0);
      const fromDateOv = new Date(todayMidnightOv);
      fromDateOv.setDate(fromDateOv.getDate() - 56);
      const todayStrOv = `${todayMidnightOv.getFullYear()}-${String(todayMidnightOv.getMonth() + 1).padStart(2, "0")}-${String(todayMidnightOv.getDate()).padStart(2, "0")}`;

      // co-teacher도 포함한 전체 담당 반
      const allMyClasses = await db.execute(sql`
        SELECT id, schedule_days FROM class_groups
        WHERE (teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text))
          AND swimming_pool_id = ${poolId} AND is_deleted = false
      `).catch(() => ({ rows: [] }));

      let pendingPastCount = 0;
      for (const cg of allMyClasses.rows as any[]) {
        const cgDays: number[] = [];
        for (const ch of (cg.schedule_days || "")) {
          if (DAY_MAP_OV[ch] !== undefined) cgDays.push(DAY_MAP_OV[ch]);
        }
        if (cgDays.length === 0) continue;
        const wRows = await db.execute(sql`
          SELECT lesson_date FROM class_diaries
          WHERE class_group_id = ${cg.id} AND is_deleted = false
        `).catch(() => ({ rows: [] }));
        const wDates = new Set((wRows.rows as any[]).map((r: any) => normalizeLessonDate(r.lesson_date)));
        const cur = new Date(fromDateOv);
        while (cur < todayMidnightOv) {
          if (cgDays.includes(cur.getDay())) {
            const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
            if (ds < todayStrOv && !wDates.has(ds)) pendingPastCount++;
          }
          cur.setDate(cur.getDate() + 1);
        }
      }

      // 보강 대기 수
      const makeupCount = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM makeup_sessions
        WHERE original_class_group_id IN (${sql.raw(classIdList)}) AND status = 'waiting'
      `);

      // 미처리 학부모 요청 수 (담당 선생님 기준)
      const pendingRequests = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM parent_student_requests
        WHERE teacher_user_id = ${userId} AND status = 'pending'
      `).catch(() => ({ rows: [{ cnt: 0 }] }));

      // 학부모 재회신 미읽음 (parent_request_messages — 선생님이 안 읽은 학부모 메시지)
      const unreadReqMsgs = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM parent_request_messages prm
        JOIN parent_student_requests psr ON psr.id = prm.request_id
        WHERE psr.teacher_user_id = ${userId}
          AND prm.sender_type = 'parent'
          AND prm.is_read_by_teacher = false
      `).catch(() => ({ rows: [{ cnt: 0 }] }));

      // 소식 unread (push-settings enabled type만)
      const psRows = await db.execute(sql`
        SELECT notification_type, is_enabled FROM push_settings
        WHERE user_id = ${userId} AND notification_type IN ('news_like', 'news_thanks', 'news_comment')
      `).catch(() => ({ rows: [] }));
      const newsSettings: Record<string, boolean> = {};
      for (const r of (psRows.rows as any[])) newsSettings[r.notification_type] = Boolean(r.is_enabled);
      // 기본값 ON
      // news_like: diary_like + growth_report_like 동일 preference 공유
      // news_comment: diary_comment + growth_report_comment 동일 preference 공유
      const enabledNewsTypes: string[] = [];
      if (newsSettings.news_like    !== false) enabledNewsTypes.push('diary_like', 'growth_report_like');
      if (newsSettings.news_thanks  !== false) enabledNewsTypes.push('diary_thanks');
      if (newsSettings.news_comment !== false) enabledNewsTypes.push('diary_comment', 'growth_report_comment');
      let unreadNews = 0;
      if (enabledNewsTypes.length > 0) {
        const typeList = enabledNewsTypes.map(t => `'${t}'`).join(",");
        const newsCount = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM notifications
          WHERE recipient_id = ${userId} AND recipient_type = 'user'
            AND type IN (${sql.raw(typeList)}) AND is_read = false
        `).catch(() => ({ rows: [{ cnt: 0 }] }));
        unreadNews = Number((newsCount.rows[0] as any)?.cnt ?? 0);
      }

      res.json({
        unread_messages: Number((unreadMsg.rows[0] as any)?.cnt ?? 0),
        pending_diaries_today: Number((pendingToday.rows[0] as any)?.cnt ?? 0),
        pending_diaries_past: pendingPastCount,
        makeup_count: Number((makeupCount.rows[0] as any)?.cnt ?? 0),
        pending_parent_requests: Number((pendingRequests.rows[0] as any)?.cnt ?? 0),
        unread_parent_request_messages: Number((unreadReqMsgs.rows[0] as any)?.cnt ?? 0),
        unread_news: unreadNews,
      });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// GET /teacher/messages — 안읽은 학부모 쪽지 목록
router.get("/teacher/messages",
  requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const poolId = await getUserPoolId(userId);
      const unreadOnly = req.query.unread === "true";

      const myClasses = await db.execute(sql`
        SELECT id FROM class_groups WHERE teacher_user_id = ${userId} AND swimming_pool_id = ${poolId}
      `);
      const classIds = (myClasses.rows as any[]).map(r => r.id);
      if (classIds.length === 0) { res.json([]); return; }

      const classIdList = classIds.map(id => `'${id}'`).join(",");
      const rows = await db.execute(sql`
        SELECT dm.id, dm.diary_id, dm.sender_name, dm.sender_role, dm.content,
               dm.is_deleted, dm.read_at, dm.created_at,
               cd.lesson_date, cd.class_group_id,
               cg.name AS class_name
        FROM diary_messages dm
        JOIN class_diaries cd ON cd.id = dm.diary_id
        JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.class_group_id IN (${sql.raw(classIdList)})
          AND dm.sender_role = 'parent'
          AND dm.is_deleted = false
          ${unreadOnly ? sql`AND dm.read_at IS NULL` : sql``}
        ORDER BY dm.created_at DESC
        LIMIT 50
      `);
      res.json(rows.rows);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /teacher/messages/read-all — 내 반 학부모 쪽지 전체 읽음 처리
router.post("/teacher/messages/read-all",
  requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const poolId = await getUserPoolId(userId);
      const myClasses = await db.execute(sql`
        SELECT id FROM class_groups WHERE teacher_user_id = ${userId} AND swimming_pool_id = ${poolId}
      `);
      const classIds = (myClasses.rows as any[]).map(r => r.id);
      if (classIds.length === 0) { res.json({ updated: 0 }); return; }
      const classIdList = classIds.map(id => `'${id}'`).join(",");
      const result = await db.execute(sql`
        UPDATE diary_messages SET read_at = NOW()
        WHERE read_at IS NULL
          AND sender_role = 'parent'
          AND is_deleted = false
          AND diary_id IN (
            SELECT id FROM class_diaries
            WHERE class_group_id IN (${sql.raw(classIdList)})
          )
      `);
      res.json({ updated: (result as any).rowCount ?? 0 });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /teacher/messages/:msgId/read — 메시지 읽음 처리
router.post("/teacher/messages/:msgId/read",
  requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await db.execute(sql`
        UPDATE diary_messages SET read_at = NOW()
        WHERE id = ${req.params.msgId} AND read_at IS NULL
      `);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// GET /teacher/diary/:diaryId/messages — 수업일지 쪽지 목록 (선생님용)
router.get("/teacher/diary/:diaryId/messages",
  requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      // 내 반 수업일지인지 확인 (선생님은 본인 반만, 관리자는 전체)
      const diary = role === "teacher"
        ? await db.execute(sql`
            SELECT cd.id FROM class_diaries cd
            JOIN class_groups cg ON cg.id = cd.class_group_id
            WHERE cd.id = ${req.params.diaryId} AND cg.teacher_user_id = ${userId}
          `)
        : await db.execute(sql`SELECT id FROM class_diaries WHERE id = ${req.params.diaryId}`);
      if (!diary.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

      // 읽음 처리 (학부모가 보낸 메시지)
      await db.execute(sql`
        UPDATE diary_messages SET read_at = NOW()
        WHERE diary_id = ${req.params.diaryId} AND sender_role = 'parent' AND read_at IS NULL
      `);

      const rows = await db.execute(sql`
        SELECT id, sender_id, sender_name, sender_role, content, is_deleted, created_at
        FROM diary_messages WHERE diary_id = ${req.params.diaryId}
        ORDER BY created_at ASC
      `);
      res.json(rows.rows);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /teacher/diary/:diaryId/messages — 선생님 쪽지 발송 (이미지 첨부 지원)
router.post("/teacher/diary/:diaryId/messages",
  requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { content, image_url } = req.body;
      if (!content?.trim() && !image_url) { res.status(400).json({ error: "내용을 입력해주세요." }); return; }
      const { userId, role } = req.user!;

      // 내 반 수업일지 확인 (선생님은 본인 반만, 관리자는 전체)
      const diary = role === "teacher"
        ? await db.execute(sql`
            SELECT cd.id FROM class_diaries cd
            JOIN class_groups cg ON cg.id = cd.class_group_id
            WHERE cd.id = ${req.params.diaryId} AND cg.teacher_user_id = ${userId}
          `)
        : await db.execute(sql`SELECT id FROM class_diaries WHERE id = ${req.params.diaryId}`);
      if (!diary.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

      const [user] = await superAdminDb.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, String(userId))).limit(1);
      const senderName = (user as any)?.name || "선생님";
      const msgContent = content?.trim() || "";

      const result = await db.execute(sql`
        INSERT INTO diary_messages (diary_id, sender_id, sender_name, sender_role, content, image_url)
        VALUES (${req.params.diaryId}, ${userId}, ${senderName}, 'teacher', ${msgContent}, ${image_url || null})
        RETURNING *
      `);
      res.status(201).json(result.rows[0]);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// GET /teacher/messages/threads — 쪽지 대화 목록 (일지별 그룹, 전체 보관함용)
router.get("/teacher/messages/threads",
  requireAuth, requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const poolId = await getUserPoolId(userId);

      const myClasses = await db.execute(sql`
        SELECT id FROM class_groups WHERE teacher_user_id = ${userId} AND swimming_pool_id = ${poolId}
      `);
      const classIds = (myClasses.rows as any[]).map(r => r.id);
      if (classIds.length === 0) { res.json([]); return; }

      const classIdList = classIds.map(id => `'${id}'`).join(",");
      const rows = await db.execute(sql`
        SELECT
          cd.id AS diary_id,
          cd.lesson_date,
          cg.name AS class_name,
          COUNT(dm.id) FILTER (WHERE dm.sender_role = 'parent' AND dm.is_deleted = false) AS parent_msg_count,
          COUNT(dm.id) FILTER (WHERE dm.sender_role = 'parent' AND dm.read_at IS NULL AND dm.is_deleted = false) AS unread_count,
          MAX(dm.created_at) AS last_msg_at,
          (SELECT dm2.content FROM diary_messages dm2
           WHERE dm2.diary_id = cd.id AND dm2.is_deleted = false
           ORDER BY dm2.created_at DESC LIMIT 1) AS last_content,
          (SELECT dm2.sender_role FROM diary_messages dm2
           WHERE dm2.diary_id = cd.id AND dm2.is_deleted = false
           ORDER BY dm2.created_at DESC LIMIT 1) AS last_sender_role,
          (SELECT dm2.sender_name FROM diary_messages dm2
           WHERE dm2.diary_id = cd.id AND dm2.is_deleted = false
           ORDER BY dm2.created_at DESC LIMIT 1) AS last_sender_name,
          (SELECT dm2.message_type FROM diary_messages dm2
           WHERE dm2.diary_id = cd.id AND dm2.is_deleted = false
           ORDER BY dm2.created_at DESC LIMIT 1) AS last_message_type,
          COUNT(dm.id) FILTER (WHERE dm.sender_role = 'parent' AND dm.read_at IS NULL AND dm.is_deleted = false AND dm.message_type = 'diary_comment') AS unread_comment_count
        FROM class_diaries cd
        JOIN class_groups cg ON cg.id = cd.class_group_id
        LEFT JOIN diary_messages dm ON dm.diary_id = cd.id
        WHERE cd.class_group_id IN (${sql.raw(classIdList)})
        GROUP BY cd.id, cd.lesson_date, cg.name
        HAVING COUNT(dm.id) FILTER (WHERE dm.sender_role = 'parent' AND dm.is_deleted = false) > 0
        ORDER BY last_msg_at DESC NULLS LAST
        LIMIT 100
      `);
      res.json(rows.rows);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 관리자 — 전체 일지 통합 목록 (저장 순, 선생님 정보 포함)
// GET /diaries/admin/all-entries?q=검색어&limit=100&offset=0
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/admin/all-entries",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      // teacher 토큰으로 접근 시 DB 역할이 pool_admin인지 검증
      if (role === "teacher") {
        const dbRole = await getUserDbRole(userId);
        if (dbRole !== "pool_admin") return apiErr(res, 403, "권한이 없습니다.");
      }
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      const { q = "", limit = "100", offset = "0" } = req.query as Record<string, string>;
      const lim = Math.min(parseInt(limit) || 100, 300);
      const off = parseInt(offset) || 0;

      const rows = await db.execute(sql`
        SELECT
          cd.id,
          cd.lesson_date,
          cd.common_content,
          cd.teacher_name,
          cd.teacher_id,
          cd.is_edited,
          cd.created_at,
          cg.name AS class_name,
          cg.schedule_days,
          cg.schedule_time,
          0 AS note_count
        FROM class_diaries cd
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.swimming_pool_id = ${poolId}
          AND cd.is_deleted = false
        ORDER BY cd.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `);

      const countRow = await db.execute(sql`
        SELECT COUNT(*)::int AS total FROM class_diaries
        WHERE swimming_pool_id = ${poolId} AND is_deleted = false
      `);

      res.json({
        success: true,
        entries: rows.rows,
        total: Number((countRow.rows[0] as any)?.total || 0),
      });
    } catch (e) { console.error("[diaries/admin/all-entries]", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 관리자 — 교사별 일지 통계 목록
// GET /diaries/admin/teachers
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/admin/teachers",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      console.log(`[diaries/admin/teachers] userId=${userId} role=${role}`);
      // teacher 토큰으로 접근 시 DB 역할이 pool_admin인지 검증
      if (role === "teacher") {
        const dbRole = await getUserDbRole(userId);
        if (dbRole !== "pool_admin") return apiErr(res, 403, "권한이 없습니다.");
      }
      const poolId = await getUserPoolId(userId);
      console.log(`[diaries/admin/teachers] poolId=${poolId}`);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      // 1단계: 선생님 목록 (단순 조회)
      const teacherRows = await superAdminDb.execute(sql`
        SELECT id AS teacher_id, name AS teacher_name
        FROM users
        WHERE swimming_pool_id = ${poolId}
          AND role = 'teacher'
          AND is_activated = true
        ORDER BY name ASC
      `);
      console.log(`[diaries/admin/teachers] teachers count=${teacherRows.rows.length}`);

      // 2단계: 각 선생님별 반·일지 카운트
      const teachers = await Promise.all(
        (teacherRows.rows as any[]).map(async (t) => {
          try {
            const [cgRow, cdRow] = await Promise.all([
              db.execute(sql`
                SELECT COUNT(*) AS class_count
                FROM class_groups
                WHERE teacher_user_id = ${t.teacher_id}
                  AND swimming_pool_id = ${poolId}
                  AND is_deleted = false
              `),
              db.execute(sql`
                SELECT COUNT(*) AS diary_count, MAX(lesson_date) AS last_diary_date
                FROM class_diaries
                WHERE teacher_id = ${t.teacher_id}
                  AND swimming_pool_id = ${poolId}
                  AND is_deleted = false
              `),
            ]);
            return {
              teacher_id: t.teacher_id,
              teacher_name: t.teacher_name,
              class_count: Number((cgRow.rows[0] as any)?.class_count ?? 0),
              diary_count: Number((cdRow.rows[0] as any)?.diary_count ?? 0),
              last_diary_date: (cdRow.rows[0] as any)?.last_diary_date ?? null,
            };
          } catch (inner) {
            console.error(`[diaries/admin/teachers] count error for ${t.teacher_id}:`, inner);
            return { teacher_id: t.teacher_id, teacher_name: t.teacher_name, class_count: 0, diary_count: 0, last_diary_date: null };
          }
        })
      );

      // diary_count 내림차순 정렬
      teachers.sort((a, b) => b.diary_count - a.diary_count);

      res.json({ success: true, teachers });
    } catch (e) { console.error("[diaries/admin/teachers] ERROR:", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 관리자 — 특정 교사의 일지 목록
// GET /diaries/admin/teacher/:teacherId/entries
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/admin/teacher/:teacherId/entries",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      if (role === "teacher") {
        const dbRole = await getUserDbRole(userId);
        if (dbRole !== "pool_admin") return apiErr(res, 403, "권한이 없습니다.");
      }
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      const { teacherId } = req.params;
      const { page = "1", limit = "30" } = req.query as any;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const rows = await db.execute(sql`
        SELECT
          cd.id, cd.lesson_date, cd.common_content, cd.teacher_name,
          cd.is_edited, cd.is_deleted, cd.created_at, cd.deleted_at,
          cg.name AS class_name,
          cg.schedule_days, cg.schedule_time,
          0 AS note_count
        FROM class_diaries cd
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.teacher_id = ${teacherId} AND cd.swimming_pool_id = ${poolId} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC, cd.created_at DESC
        LIMIT ${parseInt(limit)} OFFSET ${offset}
      `);

      const countRow = await db.execute(sql`
        SELECT COUNT(*) AS total FROM class_diaries
        WHERE teacher_id = ${teacherId} AND swimming_pool_id = ${poolId} AND is_deleted = false
      `);

      res.json({
        success: true,
        entries: rows.rows,
        total: Number((countRow.rows[0] as any)?.total || 0),
      });
    } catch (e) { console.error("[admin/teacher/entries]", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 관리자 — 일지 일괄 삭제
// POST /diaries/admin/bulk-delete
// Body: { ids: string[], mode: "photo_only" | "full" }
// ════════════════════════════════════════════════════════════════════════
router.post("/diaries/admin/bulk-delete",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      const { ids, mode } = req.body as { ids: string[]; mode: "photo_only" | "full" };
      if (!Array.isArray(ids) || ids.length === 0) return apiErr(res, 400, "삭제할 일지 ID 목록이 필요합니다.");
      if (!["photo_only", "full"].includes(mode)) return apiErr(res, 400, "mode는 photo_only 또는 full 이어야 합니다.");

      const actorName = await getUserName(userId);
      let deletedCount = 0;

      for (const diaryId of ids) {
        const diaryRows = await db.execute(sql`
          SELECT * FROM class_diaries WHERE id = ${diaryId} AND swimming_pool_id = ${poolId} AND is_deleted = false
        `);
        const diary = diaryRows.rows[0] as any;
        if (!diary) continue;

        if (mode === "full") {
          await db.execute(sql`
            UPDATE class_diaries
            SET is_deleted = true, deleted_at = NOW(), deleted_by = ${userId}, updated_at = NOW()
            WHERE id = ${diaryId}
          `);
          await logAudit({
            diaryId, targetType: "common", actionType: "delete",
            beforeContent: diary.common_content,
            actorId: userId, actorName, actorRole: role, poolId,
          });
        } else {
          // photo_only: 글은 유지, 이미지/미디어 URL 제거 (media_urls 컬럼이 있는 경우)
          // class_diaries 테이블에 media 필드가 없으면 아무것도 안 함 (no-op)
          // logAudit으로 기록만
          await logAudit({
            diaryId, targetType: "common", actionType: "delete",
            beforeContent: "(사진 삭제)",
            actorId: userId, actorName, actorRole: role, poolId,
          });
        }
        deletedCount++;
      }

      res.json({ success: true, deleted_count: deletedCount, mode });
    } catch (e) { console.error("[admin/bulk-delete]", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// RC-2 Media Dashboard (read-only, admin/pool_admin only)
// GET /diaries/media-dashboard
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/media-dashboard",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보를 찾을 수 없습니다.");

      const [snap, today, audit, cleanup] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total_photos,
            COUNT(*) FILTER (WHERE media_status='draft')::int AS draft,
            COUNT(*) FILTER (WHERE media_status='attached')::int AS attached,
            COUNT(*) FILTER (WHERE media_status='detached')::int AS detached,
            COUNT(*) FILTER (WHERE media_status='archived')::int AS archived,
            COALESCE(SUM(file_size), 0)::bigint AS storage_bytes,
            COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS uploaded_today,
            COUNT(DISTINCT uploaded_by) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS active_uploaders_7d
          FROM photo_assets_meta
          WHERE pool_id = ${poolId}
        `),
        db.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE action_type='attach' AND created_at::date = CURRENT_DATE)::int AS attached_today,
            COUNT(*) FILTER (WHERE action_type IN ('detach','detach_deleted') AND created_at::date = CURRENT_DATE)::int AS detached_today,
            COUNT(*) FILTER (WHERE action_type='delete' AND created_at::date = CURRENT_DATE)::int AS deleted_today,
            COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS audit_total_today
          FROM class_diary_audit_logs
          WHERE swimming_pool_id = ${poolId}
        `),
        db.execute(sql`
          SELECT
            (SELECT COUNT(*)::int FROM class_diaries WHERE swimming_pool_id=${poolId} AND is_deleted=false) AS active_diaries,
            (SELECT COUNT(*)::int FROM class_diary_student_notes sn
             JOIN class_diaries cd ON cd.id=sn.diary_id AND cd.swimming_pool_id=${poolId}
             WHERE sn.is_deleted=false) AS active_notes
        `),
        db.execute(sql`
          SELECT
            MAX(created_at) FILTER (WHERE action_type='cleanup')::text AS last_cleanup,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24h')::int AS errors_24h
          FROM class_diary_audit_logs
          WHERE swimming_pool_id = ${poolId}
        `),
      ]);

      const s = snap.rows[0] as any;
      const t = today.rows[0] as any;
      const a = audit.rows[0] as any;
      const c = cleanup.rows[0] as any;

      res.json({
        pool_id: poolId,
        snapshot: {
          total_photos: s.total_photos,
          by_status: {
            draft: s.draft,
            attached: s.attached,
            detached: s.detached,
            archived: s.archived,
          },
          storage_bytes: Number(s.storage_bytes),
          storage_mb: Math.round(Number(s.storage_bytes) / 1024 / 1024 * 10) / 10,
          active_uploaders_7d: s.active_uploaders_7d,
        },
        today: {
          uploaded: s.uploaded_today,
          attached: t.attached_today,
          detached: t.detached_today,
          deleted: t.deleted_today,
          audit_events: t.audit_total_today,
        },
        diaries: {
          active: a.active_diaries,
          active_notes: a.active_notes,
        },
        health: {
          last_cleanup: c.last_cleanup ?? null,
          errors_24h: c.errors_24h,
        },
        generated_at: new Date().toISOString(),
      });
    } catch (e) { console.error("[media-dashboard]", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 11. Curriculum Diary API — ACTIVE Curriculum 기반 일지 템플릿
// ════════════════════════════════════════════════════════════════════════

import {
  getActiveCurriculumVersion,
  getCurriculumLevels,
  getCurriculumNodes,
  getCurriculumFacets,
  STROKE_LABELS,
  DOMAIN_LABELS,
} from "../lib/curriculum-diary-service.js";

/**
 * GET /curriculum/diary/levels
 * ACTIVE curriculum의 레벨 목록 + node_count.
 * level_name은 pool_level_settings 기준.
 * ACTIVE curriculum이 없으면 { has_curriculum: false }.
 */
router.get(
  "/curriculum/diary/levels",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");
      const { version, levels } = await getCurriculumLevels(poolId);
      if (!version) {
        return res.json({ has_curriculum: false, levels: [] });
      }
      return res.json({
        has_curriculum: true,
        version_id:     version.id,
        version_name:   version.version_name,
        levels,
      });
    } catch (e) { console.error("[curriculum/diary/levels]", e); apiErr(res, 500, "서버 오류"); }
  },
);

/**
 * GET /curriculum/diary/nodes
 * ACTIVE curriculum의 노드 목록.
 * Query: level_order?, stroke?, domain?, skill_group?, is_test_item?, limit?, offset?
 */
router.get(
  "/curriculum/diary/nodes",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");
      const {
        level_order, stroke, domain, skill_group,
        is_test_item, limit, offset,
      } = req.query as Record<string, string | undefined>;

      const filters = {
        level_order:  level_order  != null ? parseInt(level_order,  10) : undefined,
        stroke:       stroke       || undefined,
        domain:       domain       || undefined,
        skill_group:  skill_group  || undefined,
        is_test_item: is_test_item != null ? is_test_item === "true" : false,
        limit:        limit  != null ? Math.min(parseInt(limit,  10), 500) : 200,
        offset:       offset != null ? parseInt(offset, 10)                : 0,
      };

      const { nodes, total } = await getCurriculumNodes(poolId, filters);
      return res.json({ nodes, total });
    } catch (e) { console.error("[curriculum/diary/nodes]", e); apiErr(res, 500, "서버 오류"); }
  },
);

/**
 * GET /curriculum/diary/facets
 * level_order별 distinct stroke/domain/skill_group 목록.
 * Query: level_order?
 * 한글 레이블 포함.
 */
router.get(
  "/curriculum/diary/facets",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");
      const { level_order } = req.query as Record<string, string | undefined>;
      const lo = level_order != null ? parseInt(level_order, 10) : undefined;
      const facets = await getCurriculumFacets(poolId, lo);

      return res.json({
        strokes:      facets.strokes.map(s => ({ value: s, label: STROKE_LABELS[s] ?? s })),
        domains:      facets.domains.map(d => ({ value: d, label: DOMAIN_LABELS[d] ?? d })),
        skill_groups: facets.skill_groups,
      });
    } catch (e) { console.error("[curriculum/diary/facets]", e); apiErr(res, 500, "서버 오류"); }
  },
);

/**
 * GET /curriculum/diary/teacher-templates
 * 교사 본인이 만든 scope='teacher' diary_templates.
 * Curriculum Nodes와 별도 영역으로 노출.
 */
router.get(
  "/curriculum/diary/teacher-templates",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId  = await getUserPoolId(req.user!.userId);
      const userId  = req.user!.userId;
      const rows = await db.execute(sql`
        SELECT dt.id, dt.level_id, dtl.level_name, dt.title, dt.template_text,
               dt.sort_order, dt.is_active, dt.scope, dt.teacher_id,
               dt.source_template_id, dt.created_at
        FROM diary_templates dt
        LEFT JOIN diary_template_levels dtl ON dtl.id = dt.level_id
        WHERE dt.swimming_pool_id = ${poolId}
          AND dt.scope = 'teacher'
          AND dt.teacher_id = ${userId}
          AND dt.is_active = true
        ORDER BY dt.sort_order ASC, dt.created_at ASC
      `);
      return res.json({ templates: rows.rows });
    } catch (e) { console.error("[curriculum/diary/teacher-templates]", e); apiErr(res, 500, "서버 오류"); }
  },
);

export default router;

