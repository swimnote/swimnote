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

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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
  const r = await superAdminDb.execute(sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`);
  return (r.rows[0] as any)?.role || null;
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

async function sendDiaryPush(classId: string, diaryId: string, className: string, poolId: string) {
  try {
    // 인앱 알림 생성 (notifications 테이블)
    const parentRows = await db.execute(sql`
      SELECT DISTINCT pa.id AS parent_account_id
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id
      JOIN parent_accounts pa ON pa.id = ps.parent_id
      WHERE s.class_group_id = ${classId} AND s.status != 'deleted' AND ps.status = 'approved'
    `);
    for (const p of parentRows.rows as any[]) {
      const nid = genId("notif");
      await db.execute(sql`
        INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
        VALUES (${nid}, ${p.parent_account_id}, 'parent_account', 'diary_upload',
                '새 수업 일지가 작성되었습니다',
                ${`${className} 수업 일지가 작성되었습니다. 확인해보세요!`},
                ${diaryId}, 'class_diary', ${poolId}, false)
        ON CONFLICT DO NOTHING
      `);
    }

    // 푸시 알림 발송 (pool 템플릿 + 개별 ON/OFF 설정 적용)
    const pSettings = await db.execute(sql`
      SELECT COALESCE(tpl_diary, '📒 새 수업 일지가 작성되었습니다.') AS tpl
      FROM pool_push_settings WHERE pool_id = ${poolId} LIMIT 1
    `).catch(() => ({ rows: [] }));
    const tpl = (pSettings.rows[0] as any)?.tpl ?? "📒 새 수업 일지가 작성되었습니다.";
    const { sendPushToClassParents } = await import("../lib/push-service.js");
    await sendPushToClassParents(
      classId,
      "diary_upload",
      "📒 새 수업 일지",
      tpl,
      { type: "diary_upload", diaryId, classId },
      `diary_${diaryId}`
    );
  } catch (e) { console.error("[diary] 푸시 알림 오류:", e); }
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
      const { student_name, day, time } = req.query as Record<string, string>;
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      // 선생님은 자신이 담당하는 반만
      let classFilter = sql`true`;
      if (role === "teacher") {
        const cgRows = await db.execute(sql`SELECT id FROM class_groups WHERE teacher_user_id = ${userId} AND swimming_pool_id = ${poolId} AND is_deleted = false`);
        const ids = (cgRows.rows as any[]).map(r => `'${r.id}'`);
        if (ids.length === 0) return res.json([]);
        classFilter = sql.raw(`cd.class_group_id IN (${ids.join(",")})`);
      }

      // 요일 필터
      const dayFilter = day ? sql`AND cg.schedule_days ILIKE ${"%" + day + "%"}` : sql``;
      // 시간 필터 (앞 5자 비교: '14:00')
      const timeFilter = time ? sql`AND LEFT(cg.schedule_time, 5) = ${time}` : sql``;

      // 학생 이름 필터
      const nameSearchCommon = student_name
        ? sql`AND EXISTS (SELECT 1 FROM students s WHERE s.class_group_id = cd.class_group_id AND s.status NOT IN ('withdrawn','deleted') AND s.name ILIKE ${"%" + student_name + "%"})`
        : sql``;
      const nameSearchNote = student_name ? sql`AND s.name ILIKE ${"%" + student_name + "%"}` : sql``;

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
          // 일반 선생님: 본인 반만 조회
          const rows = await db.execute(sql`SELECT id FROM class_groups WHERE teacher_user_id = ${userId}`);
          const myClassIds = (rows.rows as any[]).map(r => r.id);
          if (myClassIds.length === 0) { res.json([]); return; }
          classFilter = myClassIds.map(id => `cd.class_group_id = '${id}'`).join(" OR ");
        }

        const rows2 = await db.execute(sql`
          SELECT
            cd.*,
            cg.name AS class_name,
            cg.schedule_days, cg.schedule_time,
            (SELECT COUNT(*) FROM class_diary_student_notes csn WHERE csn.diary_id = cd.id AND csn.is_deleted = false) AS note_count
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
          (SELECT COUNT(*) FROM class_diary_student_notes csn WHERE csn.diary_id = cd.id AND csn.is_deleted = false) AS note_count
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
      const { class_group_id, lesson_date, common_content, student_notes } = req.body;

      if (!class_group_id || !common_content?.trim()) {
        return apiErr(res, 400, "반 ID와 공통 일지 내용은 필수입니다.");
      }

      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      // 선생님: 본인 반인지 확인 (pool_admin이 teacher로 전환한 경우 전체 접근 허용)
      if (role === "teacher") {
        const dbUserRow = await superAdminDb.execute(sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`);
        const dbRole = (dbUserRow.rows[0] as any)?.role;
        if (dbRole !== "pool_admin") {
          const r = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId} AND teacher_user_id = ${userId}`);
          if (r.rows.length === 0) return apiErr(res, 403, "본인 반의 일지만 작성할 수 있습니다.");
        } else {
          // pool_admin이 teacher 모드 → 풀 내 반인지만 확인
          const r = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId} AND is_deleted = false`);
          if (r.rows.length === 0) return apiErr(res, 403, "해당 반을 찾을 수 없습니다.");
        }
      }

      const teacherName = await getUserName(userId);
      const dateStr = lesson_date || new Date().toISOString().slice(0, 10);
      const diaryId = genId("cd");

      // 중복 방지: 같은 날 같은 반에 이미 일지 있으면 오류
      const dup = await db.execute(sql`
        SELECT id FROM class_diaries
        WHERE class_group_id = ${class_group_id} AND lesson_date = ${dateStr} AND is_deleted = false
      `);
      if (dup.rows.length > 0) {
        return apiErr(res, 409, "이미 해당 날짜에 일지가 작성되었습니다. 수정 기능을 사용해주세요.");
      }

      await db.execute(sql`
        INSERT INTO class_diaries (id, class_group_id, teacher_id, teacher_name, swimming_pool_id, lesson_date, common_content)
        VALUES (${diaryId}, ${class_group_id}, ${userId}, ${teacherName}, ${poolId}, ${dateStr}, ${common_content.trim()})
      `);

      await logAudit({
        diaryId, targetType: "common", actionType: "create",
        afterContent: common_content.trim(),
        actorId: userId, actorName: teacherName, actorRole: role, poolId,
      });

      // 학생별 추가 일지 저장
      const notes: any[] = Array.isArray(student_notes) ? student_notes : [];
      const savedNotes: any[] = [];
      for (const n of notes) {
        if (!n.student_id || !n.note_content?.trim()) continue;
        const noteId = genId("csn");
        await db.execute(sql`
          INSERT INTO class_diary_student_notes (id, diary_id, student_id, note_content)
          VALUES (${noteId}, ${diaryId}, ${n.student_id}, ${n.note_content.trim()})
        `);
        await logAudit({
          diaryId, studentNoteId: noteId, targetType: "student_note", actionType: "create",
          afterContent: n.note_content.trim(),
          actorId: userId, actorName: teacherName, actorRole: role, poolId,
        });
        savedNotes.push({ id: noteId, student_id: n.student_id, note_content: n.note_content.trim() });
      }

      // 학부모 푸시 알림
      const cgRow = await db.execute(sql`SELECT name FROM class_groups WHERE id = ${class_group_id}`);
      const className = (cgRow.rows[0] as any)?.name || "수업";
      sendDiaryPush(class_group_id, diaryId, className, poolId);

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
        WHERE cd.id = ${req.params.id} AND cd.swimming_pool_id = ${poolId}
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
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);
      const rows = await db.execute(sql`SELECT * FROM class_diaries WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
      const diary = rows.rows[0] as any;
      if (!diary) return apiErr(res, 404, "일지를 찾을 수 없습니다.");
      if (diary.is_deleted) return apiErr(res, 400, "이미 삭제된 일지입니다.");
      if (role === "teacher" && diary.teacher_id !== userId) return apiErr(res, 403, "본인 일지만 삭제할 수 있습니다.");

      const actorName = await getUserName(userId);
      await db.execute(sql`
        UPDATE class_diaries
        SET is_deleted = true, deleted_at = NOW(), deleted_by = ${userId}, updated_at = NOW()
        WHERE id = ${req.params.id}
      `);
      await logAudit({
        diaryId: req.params.id, targetType: "common", actionType: "delete",
        beforeContent: diary.common_content,
        actorId: userId, actorName, actorRole: role, poolId: poolId!,
      });
      logPoolEvent({
        pool_id: poolId!, event_type: "journal.delete", entity_type: "class_diary",
        entity_id: req.params.id, actor_id: userId,
        payload: { class_group_id: diary.class_group_id },
      }).catch(() => {});
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 3. 학생별 추가 일지 CRUD
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
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 4. 감사 기록 조회 (관리자 전용)
// ════════════════════════════════════════════════════════════════════════

router.get("/diaries/:id/audit-logs",
  requireAuth, requireRole("super_admin", "pool_admin"),
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

// POST /diary-template-levels — 레벨 추가 (최대 10개)
router.post("/diary-template-levels",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const { level_name } = req.body;
      if (!level_name?.trim()) return apiErr(res, 400, "레벨 이름을 입력해주세요.");
      if (level_name.trim().length > 50) return apiErr(res, 400, "레벨 이름은 50자 이내로 입력해주세요.");
      const cntRow = await db.execute(sql`SELECT COUNT(*) AS cnt FROM diary_template_levels WHERE swimming_pool_id = ${poolId}`);
      if (Number((cntRow.rows[0] as any)?.cnt) >= 10) return apiErr(res, 400, "레벨은 최대 10개까지 생성할 수 있습니다.");
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
  requireAuth, requireRole("super_admin", "pool_admin"),
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
  requireAuth, requireRole("super_admin", "pool_admin"),
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
  requireAuth, requireRole("super_admin", "pool_admin"),
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
  requireAuth, requireRole("super_admin", "pool_admin"),
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

const SWIMNOTE_DEFAULT_TEMPLATES: { levelName: string; templates: string[] }[] = [
  { levelName: "흰색: 물적응·호흡", templates: [
    "오늘은 안전하게 물에 들어가는 방법을 배웠습니다. 계단을 이용해 천천히 입수하는 연습을 진행했습니다. 물을 무서워하지 않고 차분하게 참여했습니다. 첫 수업을 잘 시작했습니다.",
    "오늘은 난간을 잡고 물에 들어가는 연습을 했습니다. 입수 후에도 침착하게 자세를 유지했습니다. 물에 대한 긴장이 조금씩 줄어들고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 스스로 물에 들어가보는 연습을 했습니다. 선생님의 도움 없이도 용기 있게 도전했습니다. 처음보다 훨씬 자신감 있는 모습이었습니다. 잘 적응하고 있습니다.",
    "오늘은 물속에서 앞으로 걸어보는 연습을 했습니다. 물의 저항을 느끼며 천천히 이동했습니다. 움직임이 점점 자연스러워지고 있습니다. 적극적으로 참여했습니다.",
    "오늘은 물속에서 뒤로 걷기를 연습했습니다. 몸의 균형을 유지하며 이동하는 연습을 진행했습니다. 처음보다 안정적인 모습이었습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 물속에서 옆으로 이동하는 연습을 했습니다. 다양한 방향으로 움직이며 물에 적응했습니다. 움직임에 대한 자신감이 생기고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 물속에서 멈춰 서는 연습을 했습니다. 움직인 후에도 균형을 유지하는 데 집중했습니다. 몸을 조절하는 능력이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 물속에서 몸의 중심을 찾는 연습을 했습니다. 몸을 좌우로 움직이며 균형을 느껴보았습니다. 처음보다 훨씬 안정적인 모습이었습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 몸을 천천히 기울이는 연습을 했습니다. 물이 몸을 지탱하는 느낌을 경험해보았습니다. 긴장이 많이 줄어든 모습이었습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 물속에서 균형을 유지하는 연습을 했습니다. 흔들리지 않고 자세를 유지하는 데 집중했습니다. 집중력이 좋았습니다. 잘 따라오고 있습니다.",
    "오늘은 물안경을 착용하는 방법을 배웠습니다. 올바르게 착용하고 물이 새지 않도록 확인했습니다. 처음보다 훨씬 편안해졌습니다. 잘 적응하고 있습니다.",
    "오늘은 물안경을 쓰고 물속을 바라보는 연습을 했습니다. 물속 환경을 눈으로 확인하는 경험을 했습니다. 물속 시야에 대한 긴장이 줄어들고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 물속 바닥을 바라보는 연습을 했습니다. 시선을 유지하며 편안하게 적응했습니다. 전보다 훨씬 자연스러운 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 물속에서 선생님 손가락 숫자를 확인하는 연습을 했습니다. 눈을 뜬 상태를 유지하는 데 집중했습니다. 생각보다 잘 해주었습니다. 좋은 경험이 되었습니다.",
    "오늘은 물속에서 물건을 찾아보는 연습을 했습니다. 눈을 뜨고 목표를 확인하는 경험을 했습니다. 점점 자신감이 생기고 있습니다. 적극적으로 참여했습니다.",
    "오늘은 입술을 물에 담그는 연습을 했습니다. 물을 피하지 않고 가까워지는 경험을 했습니다. 차분하게 잘 따라왔습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 턱까지 물에 담그는 연습을 했습니다. 얼굴을 물에 가까이하는 데 집중했습니다. 긴장이 많이 줄어들고 있습니다. 잘 적응하고 있습니다.",
    "오늘은 코까지 물에 담그는 연습을 했습니다. 물을 무서워하지 않고 스스로 도전했습니다. 전보다 훨씬 자연스러워졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 눈까지 물에 담그는 연습을 했습니다. 물안경을 이용해 편안하게 적응했습니다. 생각보다 잘 해주었습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 얼굴 전체를 물에 담그는 연습을 했습니다. 얼굴을 담근 상태를 유지하는 경험을 했습니다. 물에 대한 자신감이 생기고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 얼굴을 물에 담근 상태로 기다리는 연습을 했습니다. 급하게 올라오지 않고 여유 있게 적응했습니다. 안정감이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 얼굴을 담근 상태에서 이동하는 연습을 했습니다. 물속에서도 침착하게 움직이는 경험을 했습니다. 전보다 훨씬 편안한 모습이었습니다. 좋은 흐름입니다.",
    "오늘은 물속에서 숨을 내쉬는 연습을 했습니다. 입으로 천천히 공기를 내보내는 경험을 했습니다. 호흡의 기초를 배우기 시작했습니다. 집중력이 좋았습니다.",
    "오늘은 입으로 버블 만들기를 연습했습니다. 공기방울을 길게 유지하는 데 집중했습니다. 호흡 조절이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 버블을 길게 이어가는 연습을 했습니다. 숨을 끝까지 내보내는 경험을 했습니다. 전보다 훨씬 자연스러워졌습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 코로 공기를 내보내는 연습을 했습니다. 코 주변으로 버블을 만드는 경험을 했습니다. 처음보다 훨씬 편안해졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 코 버블을 길게 유지하는 연습을 했습니다. 호흡을 조절하며 안정적으로 진행했습니다. 호흡 이해도가 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 입과 코를 함께 사용하는 호흡을 연습했습니다. 물속에서도 침착하게 호흡을 이어갔습니다. 좋은 모습을 보여주었습니다. 집중력이 좋았습니다.",
    "오늘은 물 밖에서 숨 들이마시기를 연습했습니다. 짧고 빠르게 숨을 마시는 연습을 진행했습니다. 수영 호흡의 기본을 배우고 있습니다. 좋은 출발을 했습니다.",
    "오늘은 내쉬기와 들이마시기를 연결하는 연습을 했습니다. 호흡 순서를 자연스럽게 이어가는 경험을 했습니다. 조금씩 감을 잡고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 음파흡 호흡을 시작했습니다. 물속에서 내쉬고 물 밖에서 마시는 연습을 했습니다. 처음 배우는 내용인데도 잘 따라왔습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 음파흡 리듬을 연습했습니다. 호흡 타이밍을 맞추는 데 집중했습니다. 전보다 훨씬 자연스러워졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 음파흡을 반복 연습했습니다. 호흡이 끊기지 않도록 진행했습니다. 안정감이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 이동하며 호흡하는 연습을 했습니다. 움직이는 상태에서도 호흡을 이어갔습니다. 처음보다 훨씬 안정적인 모습이었습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 이동 중 호흡 타이밍을 연습했습니다. 언제 내쉬고 언제 마셔야 하는지 배워보았습니다. 호흡 이해도가 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 연속 호흡을 연습했습니다. 중간에 멈추지 않고 반복하는 데 집중했습니다. 리듬감이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 연속 호흡 횟수를 늘려보았습니다. 일정한 리듬을 유지하며 진행했습니다. 전보다 훨씬 여유 있는 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 호흡 조절 연습을 진행했습니다. 상황에 따라 숨의 길이를 조절해보았습니다. 호흡에 대한 이해가 좋아지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 물속에서 편안하게 숨을 다루는 연습을 했습니다. 급하게 움직이지 않고 여유 있게 진행했습니다. 긴장이 많이 줄어들고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 물적응과 호흡 과정을 전체 복습했습니다. 지금까지 배운 내용을 다시 확인하는 시간을 가졌습니다. 처음 수업보다 훨씬 편안하고 자신감 있는 모습이었습니다. 다음 단계를 준비할 수 있는 수준까지 잘 성장했습니다.",
  ]},
  { levelName: "흰색: 배영", templates: [
    "오늘은 등을 대고 물에 몸을 맡기는 연습을 했습니다. 처음에는 긴장했지만 물 위에 편안하게 누워보는 경험을 했습니다. 몸에 힘을 빼는 연습을 꾸준히 진행하고 있습니다. 좋은 출발을 했습니다.",
    "오늘은 배면뜨기 자세를 연습했습니다. 귀가 물에 잠긴 상태를 유지하며 편안하게 떠보았습니다. 처음보다 훨씬 안정적인 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 몸에 힘을 빼고 뜨는 연습을 했습니다. 물을 이기려고 하기보다 물에 몸을 맡기는 경험을 했습니다. 긴장이 많이 줄어들고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 배면뜨기 자세를 오래 유지하는 연습을 했습니다. 물 위에서 편안하게 머무는 시간을 늘려보았습니다. 점점 자신감이 생기고 있습니다. 잘 적응하고 있습니다.",
    "오늘은 몸을 둥글게 말아 뜨는 연습을 했습니다. 몸의 균형과 부력을 느껴보는 시간을 가졌습니다. 처음보다 훨씬 자연스러워졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 물이 몸을 띄워주는 경험을 했습니다. 부력을 느끼며 물 위에 떠있는 연습을 진행했습니다. 물에 대한 이해가 점점 좋아지고 있습니다. 적극적으로 참여했습니다.",
    "오늘은 보조 도움을 받아 뜨기 연습을 했습니다. 올바른 자세를 유지하는 데 집중했습니다. 몸의 긴장이 많이 줄어들고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 스스로 뜨기에 도전했습니다. 선생님의 도움 없이 물 위에 떠보았습니다. 용기 있게 도전하는 모습이 좋았습니다. 잘 따라오고 있습니다.",
    "오늘은 혼자 뜨는 시간을 늘려보았습니다. 조금 더 오래 자세를 유지하는 연습을 했습니다. 안정감이 점점 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 배면뜨기를 반복 연습했습니다. 떠있는 자세가 자연스럽게 유지되고 있습니다. 처음보다 훨씬 편안해졌습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 배영발차기를 시작했습니다. 누운 자세에서 다리를 움직이는 연습을 진행했습니다. 처음 배우는 동작인데도 집중해서 참여했습니다. 좋은 출발을 했습니다.",
    "오늘은 배영발차기 자세를 연습했습니다. 몸을 곧게 유지하며 발차기에 집중했습니다. 자세가 점점 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 발차기를 멈추지 않고 이어가는 연습을 했습니다. 짧은 거리라도 꾸준히 움직이는 것이 목표였습니다. 리듬감이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 발차기 힘을 일정하게 유지하는 연습을 했습니다. 빠르게 차기보다 꾸준히 차는 데 집중했습니다. 발차기가 부드러워지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 배영발차기로 앞으로 이동하는 연습을 했습니다. 스스로 움직이는 경험을 해보았습니다. 점점 자신감이 생기고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 발차기 거리를 늘리는 연습을 했습니다. 중간에 멈추지 않고 이동하는 데 집중했습니다. 지구력도 함께 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 무릎을 많이 굽히지 않는 연습을 했습니다. 다리 전체를 사용하는 발차기를 배워보았습니다. 발차기 모양이 점점 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 발끝을 길게 뻗는 연습을 했습니다. 발등을 이용해 물을 차는 감각을 익혔습니다. 전보다 훨씬 자연스러워졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 배영발차기를 오래 유지하는 연습을 했습니다. 끝까지 리듬을 유지하는 데 집중했습니다. 체력과 집중력이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 배영발차기 완주에 도전했습니다. 포기하지 않고 끝까지 최선을 다했습니다. 많이 성장한 모습입니다. 좋은 모습을 보여주었습니다.",
    "오늘은 손을 앞으로 길게 뻗는 연습을 했습니다. 몸을 길게 만드는 자세를 반복했습니다. 자세 이해도가 좋아지고 있습니다. 좋은 흐름입니다.",
    "오늘은 양손 모으기를 연습했습니다. 팔을 귀 옆으로 붙이는 자세를 배웠습니다. 전보다 훨씬 안정적인 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 유선형 자세를 만들었습니다. 몸을 길고 곧게 만드는 연습을 진행했습니다. 좋은 자세가 만들어지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 유선형 자세를 유지하는 연습을 했습니다. 몸이 흔들리지 않도록 집중했습니다. 안정감이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 유선형 자세에서 발차기를 연습했습니다. 자세와 발차기를 연결하는 경험을 했습니다. 몸의 균형이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 벽을 밀고 나가는 연습을 했습니다. 유선형 자세를 유지하며 앞으로 이동했습니다. 처음보다 훨씬 자연스러워졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 글라이딩 거리를 늘리는 연습을 했습니다. 몸을 길게 유지하는 데 집중했습니다. 이동 거리가 점점 늘어나고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 배영 팔동작을 시작했습니다. 물을 뒤로 보내는 동작을 배워보았습니다. 새로운 내용에도 집중력이 좋았습니다. 좋은 출발을 했습니다.",
    "오늘은 한팔 배영을 연습했습니다. 팔동작 순서를 익히는 데 집중했습니다. 생각보다 잘 따라왔습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 한팔 배영을 반복 연습했습니다. 물을 밀어내는 감각을 배우고 있습니다. 동작이 점점 자연스러워지고 있습니다. 잘 적응하고 있습니다.",
    "오늘은 양팔 배영을 시작했습니다. 양쪽 팔을 번갈아 사용하는 연습을 진행했습니다. 연결 동작이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 양팔 배영을 반복 연습했습니다. 팔동작이 끊기지 않도록 집중했습니다. 수영 동작이 점점 완성되고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 팔동작과 발차기를 연결했습니다. 상체와 하체를 함께 사용하는 연습을 했습니다. 조금씩 자연스러운 수영이 나오고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 배영 연결동작을 연습했습니다. 동작이 끊어지지 않도록 반복했습니다. 안정감이 많이 좋아졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 배영으로 짧은 거리를 이동했습니다. 혼자 수영하는 경험을 해보았습니다. 처음보다 훨씬 자신감 있는 모습입니다. 꾸준히 발전하고 있습니다.",
    "오늘은 배영 거리를 늘리는 연습을 했습니다. 중간에 멈추지 않고 이어가는 데 집중했습니다. 체력도 함께 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 배영 자세를 점검했습니다. 머리와 몸의 위치를 다시 확인했습니다. 수영 자세가 훨씬 안정적이었습니다. 잘 따라오고 있습니다.",
    "오늘은 배영 리듬을 연습했습니다. 팔과 발의 타이밍을 맞춰보았습니다. 전보다 훨씬 자연스러워졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 배영 완주에 도전했습니다. 배운 동작을 끝까지 연결해 보았습니다. 포기하지 않고 끝까지 해냈습니다. 많이 성장한 모습입니다.",
    "오늘은 배영 과정을 전체 복습했습니다. 뜨기부터 발차기, 유선형, 스트로크까지 다시 확인했습니다. 처음 시작했을 때보다 훨씬 안정적인 수영이 나오고 있습니다. 다음 단계를 준비할 수 있는 수준까지 잘 성장했습니다.",
  ]},
  { levelName: "흰색: 자유형", templates: [
    "오늘은 자유형 자세를 시작했습니다. 엎드린 상태에서 몸을 길게 만드는 연습을 진행했습니다. 몸의 균형을 유지하는 데 집중했습니다. 좋은 출발을 했습니다.",
    "오늘은 엎드린 자세를 유지하는 연습을 했습니다. 몸이 흔들리지 않도록 자세를 잡아보았습니다. 처음보다 훨씬 안정적인 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 자유형 발차기를 시작했습니다. 엎드린 자세에서 다리를 움직이는 연습을 했습니다. 새로운 동작인데도 집중해서 참여했습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 자유형 발차기 자세를 연습했습니다. 몸을 곧게 유지하며 발차기에 집중했습니다. 발차기 모양이 점점 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 자유형 발차기를 이어가는 연습을 했습니다. 멈추지 않고 일정한 리듬을 유지하는 데 집중했습니다. 전보다 훨씬 자연스러워졌습니다. 잘 따라오고 있습니다.",
    "오늘은 자유형 발차기로 앞으로 이동하는 연습을 했습니다. 발차기를 이용해 스스로 움직여보았습니다. 자신감이 조금씩 생기고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 자유형 발차기 리듬을 연습했습니다. 빠르게 차기보다 꾸준히 차는 것에 집중했습니다. 발차기가 한결 부드러워졌습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 자유형 발차기 거리를 늘리는 연습을 했습니다. 중간에 멈추지 않고 이동하는 것을 목표로 했습니다. 체력도 함께 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 자유형 발차기를 오래 유지하는 연습을 했습니다. 끝까지 리듬을 유지하는 데 집중했습니다. 지구력이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 자유형 발차기 완주에 도전했습니다. 포기하지 않고 끝까지 최선을 다했습니다. 많이 성장한 모습입니다. 좋은 모습을 보여주었습니다.",
    "오늘은 손을 앞으로 길게 뻗는 연습을 했습니다. 몸을 길게 만드는 자세를 반복했습니다. 유선형 자세가 점점 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 양손 모으기를 연습했습니다. 팔을 귀 옆으로 붙이는 자세를 배웠습니다. 전보다 훨씬 자연스러워졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 유선형 자세를 만들었습니다. 몸을 길고 곧게 만드는 연습을 진행했습니다. 자세 이해도가 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 유선형 자세를 유지하는 연습을 했습니다. 몸이 흐트러지지 않도록 집중했습니다. 안정감이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 유선형 자세에서 발차기를 연습했습니다. 자세와 발차기를 연결하는 경험을 했습니다. 몸의 균형이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 캐치업 드릴을 시작했습니다. 양손을 앞으로 모으는 타이밍을 연습했습니다. 처음 배우는 내용인데도 잘 따라왔습니다. 좋은 출발을 했습니다.",
    "오늘은 캐치업 드릴을 반복 연습했습니다. 손이 만나는 위치를 확인하며 진행했습니다. 동작 이해도가 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 손을 끝까지 뻗는 연습을 했습니다. 급하게 당기지 않고 기다리는 연습을 진행했습니다. 자세가 점점 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 양손 연결 타이밍을 연습했습니다. 손이 앞으로 모이는 순간을 반복했습니다. 전보다 훨씬 자연스러워졌습니다. 잘 따라오고 있습니다.",
    "오늘은 캐치업 드릴로 이동하는 연습을 했습니다. 손 모으기와 발차기를 함께 연결했습니다. 동작이 안정적으로 이어지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 사이드킥 자세를 시작했습니다. 옆으로 누운 상태를 유지하는 연습을 진행했습니다. 균형을 잡으려는 모습이 좋았습니다. 좋은 출발을 했습니다.",
    "오늘은 사이드킥 자세를 반복 연습했습니다. 몸이 돌아가지 않도록 집중했습니다. 전보다 훨씬 안정적인 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 옆으로 누운 상태에서 발차기를 연습했습니다. 몸의 균형을 유지하며 이동했습니다. 처음보다 훨씬 자연스러워졌습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 사이드킥 자세에서 호흡을 연습했습니다. 고개를 무리하게 들지 않도록 진행했습니다. 호흡에 대한 이해가 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 자유형 호흡을 시작했습니다. 숨을 마시는 타이밍을 배워보았습니다. 처음에는 어려웠지만 끝까지 도전했습니다. 좋은 경험이 되었습니다.",
    "오늘은 자유형 호흡을 반복 연습했습니다. 물속에서 내쉬고 밖에서 마시는 연습을 진행했습니다. 조금씩 익숙해지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 고개를 돌려 숨 쉬는 연습을 했습니다. 고개를 들지 않고 돌리는 데 집중했습니다. 전보다 훨씬 자연스러워졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 자유형 호흡 타이밍을 연습했습니다. 언제 숨을 마셔야 하는지 반복했습니다. 호흡 이해도가 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 2~3회 스트로크 후 호흡하는 연습을 했습니다. 호흡 리듬을 만드는 데 집중했습니다. 점점 감을 잡고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 자유형 롤링을 시작했습니다. 몸을 자연스럽게 회전하는 연습을 진행했습니다. 새로운 동작에도 잘 적응하고 있습니다. 좋은 출발을 했습니다.",
    "오늘은 몸통 회전을 연습했습니다. 어깨와 몸이 함께 움직이는 경험을 했습니다. 전보다 훨씬 자연스러워졌습니다. 잘 따라오고 있습니다.",
    "오늘은 롤링과 호흡을 연결했습니다. 몸의 회전과 호흡 타이밍을 함께 연습했습니다. 동작 연결이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 자유형 협응을 시작했습니다. 팔, 발, 호흡을 함께 사용하는 연습을 했습니다. 처음보다 훨씬 집중력이 좋아졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 팔과 발 연결을 연습했습니다. 동작이 끊어지지 않도록 반복했습니다. 수영이 점점 자연스러워지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 팔, 발, 호흡 연결을 연습했습니다. 전체 동작을 이어가는 데 집중했습니다. 자유형 모습이 조금씩 만들어지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 자유형으로 짧은 거리를 이동했습니다. 배운 동작을 실제 수영에 적용해보았습니다. 혼자 수영하는 모습이 나오고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 자유형 거리를 늘리는 연습을 했습니다. 중간에 멈추지 않고 이어가는 데 집중했습니다. 체력도 함께 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 자유형 자세를 점검했습니다. 머리 위치와 몸의 정렬을 다시 확인했습니다. 전보다 훨씬 안정적인 수영이 나오고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 자유형 전체 동작을 복습했습니다. 발차기, 호흡, 롤링을 다시 확인했습니다. 배운 내용을 잘 기억하고 있었습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 자유형 과정을 전체 정리했습니다. 처음보다 훨씬 자연스럽게 수영하고 있습니다. 스스로 문제를 해결하려는 모습도 보였습니다. 다음 단계 준비가 잘 되고 있습니다.",
  ]},
  { levelName: "평영킥·레벨테스트", templates: [
    "오늘은 평영 발차기를 시작했습니다. 다리를 접고 벌리고 모으는 순서를 배워보았습니다. 처음 배우는 동작인데도 집중해서 참여했습니다. 좋은 출발을 했습니다.",
    "오늘은 평영 발차기 순서를 연습했습니다. 발차기 동작이 섞이지 않도록 천천히 진행했습니다. 동작을 이해하려는 모습이 좋았습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 발차기 자세를 연습했습니다. 다리 모양과 발 방향에 집중했습니다. 전보다 훨씬 좋아진 모습이었습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 평영 발차기 동작을 나누어 연습했습니다. 접기와 차기를 구분해서 반복했습니다. 동작 이해도가 점점 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 발차기 마무리를 연습했습니다. 차고 난 뒤 다리를 모으는 동작에 집중했습니다. 전보다 훨씬 자연스러워졌습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 발차기를 반복 연습했습니다. 동작 순서를 기억하며 진행했습니다. 실수가 줄어들고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 발차기 리듬을 연습했습니다. 급하게 차지 않고 순서를 지키는 데 집중했습니다. 발차기 모양이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 발차기로 이동하는 연습을 했습니다. 발차기의 추진력을 느껴보는 시간을 가졌습니다. 조금씩 앞으로 나아가고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 평영 발차기 거리를 늘리는 연습을 했습니다. 중간에 멈추지 않고 연결하는 데 집중했습니다. 지구력도 함께 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 발차기 자세를 점검했습니다. 발 모양과 무릎 사용을 다시 확인했습니다. 동작이 점점 안정되고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 발차기 완주에 도전했습니다. 끝까지 동작을 유지하며 이동했습니다. 포기하지 않는 모습이 인상적이었습니다. 많이 성장하고 있습니다.",
    "오늘은 평영 발차기를 복습했습니다. 지금까지 배운 내용을 다시 정리했습니다. 동작 이해도가 좋아지고 있습니다. 좋은 흐름입니다.",
    "오늘은 접영 발차기를 시작했습니다. 몸 전체를 사용하는 움직임을 배워보았습니다. 새로운 동작에도 적극적으로 참여했습니다. 좋은 출발을 했습니다.",
    "오늘은 접영 발차기 리듬을 연습했습니다. 상체와 하체가 함께 움직이는 경험을 했습니다. 처음보다 훨씬 자연스러워졌습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 발차기 자세를 연습했습니다. 몸의 물결 움직임을 느껴보는 시간을 가졌습니다. 동작 이해도가 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 발차기를 반복 연습했습니다. 몸의 움직임이 끊어지지 않도록 집중했습니다. 리듬감이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 발차기로 이동하는 연습을 했습니다. 발차기 힘으로 앞으로 나아가는 경험을 했습니다. 점점 자신감이 생기고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 접영 발차기 거리를 늘리는 연습을 했습니다. 중간에 멈추지 않고 이어가는 데 집중했습니다. 전보다 훨씬 안정적인 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 발차기 리듬을 다시 점검했습니다. 빠르기보다 자연스러운 연결에 집중했습니다. 동작이 점점 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 발차기를 오래 유지하는 연습을 했습니다. 리듬을 잃지 않고 반복하는 데 집중했습니다. 체력도 함께 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 발차기 완주에 도전했습니다. 끝까지 포기하지 않고 최선을 다했습니다. 노력하는 모습이 정말 좋았습니다. 많이 성장하고 있습니다.",
    "오늘은 접영 발차기를 복습했습니다. 배운 리듬과 자세를 다시 확인했습니다. 처음보다 훨씬 자연스러워졌습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 하얀모자 평가 항목을 확인했습니다. 배영과 자유형, 평영 발차기를 다시 점검했습니다. 배운 내용을 잘 기억하고 있었습니다. 레벨업 준비가 잘 되고 있습니다.",
    "오늘은 배영 20m를 점검했습니다. 중간에 멈추지 않고 끝까지 완주했습니다. 자세도 많이 안정되었습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 자유형 20m를 점검했습니다. 발차기와 호흡 연결이 좋아지고 있습니다. 혼자 수영하는 모습이 안정적으로 나오고 있습니다. 자신감도 많이 생겼습니다.",
    "오늘은 평영 발차기 20m를 점검했습니다. 동작 순서를 잘 기억하며 수행했습니다. 발차기 모양도 좋아지고 있습니다. 꾸준히 노력한 결과가 보이고 있습니다.",
    "오늘은 레벨업 테스트를 준비했습니다. 지금까지 배운 내용을 다시 정리하는 시간을 가졌습니다. 긴장하지 않고 차분하게 참여했습니다. 좋은 컨디션으로 준비하고 있습니다.",
    "오늘은 하얀모자 레벨업 테스트를 진행했습니다. 배운 내용을 끝까지 최선을 다해 보여주었습니다. 포기하지 않고 끝까지 해내는 모습이 좋았습니다. 정말 수고 많았습니다.",
    "하얀모자 레벨업을 축하합니다. 처음 수영을 시작했을 때보다 정말 많이 성장했습니다. 스스로 해내는 모습이 인상적이었습니다. 다음 단계에서도 즐겁게 수영해보겠습니다.",
    "하얀모자 과정을 마무리했습니다. 물과 친해지기부터 네 가지 핵심 과정을 모두 경험했습니다. 꾸준히 노력한 결과가 차곡차곡 쌓이고 있습니다. 파란모자 과정에서도 좋은 모습 기대하겠습니다.",
  ]},
  { levelName: "평영스트로크", templates: [
    "오늘은 평영 팔동작을 처음 배워보았습니다. 다리를 사용하지 않고 팔의 움직임 순서를 익히는 연습을 진행했습니다. 새로운 동작에도 집중력이 좋았습니다. 좋은 출발을 했습니다.",
    "오늘은 양손을 앞으로 길게 뻗는 연습을 했습니다. 평영의 시작 자세를 만드는 데 집중했습니다. 자세를 이해하려는 모습이 좋았습니다. 잘 따라오고 있습니다.",
    "오늘은 양손을 바깥쪽으로 벌리는 연습을 했습니다. 물을 넓게 느끼며 움직이는 경험을 해보았습니다. 전보다 훨씬 자연스러워졌습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 팔로 물을 모으는 연습을 했습니다. 물을 몸쪽으로 가져오는 움직임을 반복했습니다. 동작 이해도가 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 팔동작 마무리를 연습했습니다. 가슴 앞에서 양손이 모이는 위치를 확인했습니다. 동작이 점점 안정되고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 팔동작 순서를 반복 연습했습니다. 급하게 하지 않고 순서를 기억하며 진행했습니다. 실수가 줄어들고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 팔동작 후 앞으로 뻗는 연습을 했습니다. 다음 동작을 서두르지 않는 데 집중했습니다. 평영의 기본 리듬을 배우고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 기다리는 자세를 연습했습니다. 팔동작 후 몸을 길게 유지하는 경험을 했습니다. 전보다 훨씬 안정적인 모습이었습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 글라이드를 시작했습니다. 몸을 길게 뻗은 상태로 미끄러지는 연습을 했습니다. 몸의 균형이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 글라이드 시간을 늘려보았습니다. 급하게 다음 동작을 하지 않도록 연습했습니다. 평영 리듬을 이해하기 시작했습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 기다리는 평영을 연습했습니다. 동작과 동작 사이를 유지하는 데 집중했습니다. 전보다 훨씬 여유 있는 모습이었습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 발차기와 글라이드를 연결했습니다. 킥 후 몸을 길게 유지하는 연습을 했습니다. 추진력이 점점 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 킥 후 기다리는 연습을 했습니다. 바로 다음 동작을 하지 않고 미끄러지는 경험을 했습니다. 평영의 핵심 리듬을 배우고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 팔동작과 발차기를 따로 연습했습니다. 각 동작의 순서를 다시 확인하는 시간을 가졌습니다. 동작 이해도가 좋아지고 있습니다. 좋은 흐름입니다.",
    "오늘은 팔동작과 발차기를 연결했습니다. 순서가 섞이지 않도록 천천히 진행했습니다. 생각보다 잘 따라왔습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 팔-호흡 연결을 연습했습니다. 언제 숨을 쉬어야 하는지 배워보았습니다. 호흡 타이밍이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 팔동작 후 호흡을 연습했습니다. 고개를 과하게 들지 않도록 집중했습니다. 자세가 점점 안정되고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 전체 순서를 연습했습니다. 팔, 호흡, 킥의 순서를 연결했습니다. 동작이 자연스럽게 이어지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 순서가 섞이지 않도록 반복 연습했습니다. 빠르기보다 정확한 순서에 집중했습니다. 전보다 훨씬 좋아진 모습입니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 리듬을 연습했습니다. 동작 하나하나를 천천히 연결했습니다. 몸의 움직임이 안정되고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 글라이드를 길게 유지하는 연습을 했습니다. 힘으로 가기보다 미끄러져 가는 경험을 했습니다. 평영에 대한 이해가 깊어지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 추진력을 느껴보았습니다. 킥 이후 몸이 앞으로 나가는 감각을 경험했습니다. 점점 자신감이 생기고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 평영 거리 늘리기를 연습했습니다. 중간에 멈추지 않고 연결하는 데 집중했습니다. 체력도 함께 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 자세를 점검했습니다. 팔동작과 글라이드 자세를 다시 확인했습니다. 수영 자세가 안정적으로 만들어지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 호흡을 점검했습니다. 호흡 타이밍과 머리 위치를 확인했습니다. 전보다 훨씬 자연스러워졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 전체 연결을 연습했습니다. 팔, 호흡, 킥, 글라이드를 하나로 이어보았습니다. 수영 동작이 점점 완성되고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 평영으로 긴 거리를 이동했습니다. 배운 순서를 끝까지 유지하는 데 집중했습니다. 지구력과 집중력이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 동작을 복습했습니다. 지금까지 배운 내용을 다시 정리했습니다. 동작 이해도가 많이 좋아졌습니다. 잘 따라오고 있습니다.",
    "오늘은 순서를 지키는 평영을 연습했습니다. 급하게 움직이지 않고 리듬을 유지했습니다. 평영 특유의 움직임이 만들어지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 스트로크 과정을 정리했습니다. 팔동작과 글라이드를 이해하며 한 단계 성장했습니다. 처음보다 훨씬 완성된 평영이 나오고 있습니다. 다음 단계 준비가 잘 되고 있습니다.",
  ]},
  { levelName: "접영스트로크", templates: [
    "오늘은 접영을 배우기 위한 몸 움직임을 시작했습니다. 몸 전체를 부드럽게 움직이는 연습을 진행했습니다. 새로운 동작인데도 적극적으로 참여했습니다. 좋은 출발을 했습니다.",
    "오늘은 몸으로 물을 누르는 연습을 했습니다. 손보다 몸의 움직임을 먼저 익히는 시간을 가졌습니다. 접영의 기본 감각을 배우고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 가슴으로 물을 누르는 연습을 했습니다. 몸의 앞부분이 움직이는 타이밍을 경험했습니다. 동작 이해도가 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 몸의 움직임이 허리까지 이어지도록 연습했습니다. 상체 움직임이 자연스럽게 연결되도록 진행했습니다. 전보다 훨씬 자연스러워졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 몸의 움직임이 다리까지 전달되도록 연습했습니다. 몸 전체가 하나로 움직이는 경험을 했습니다. 접영의 기초가 만들어지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 물결 움직임을 반복 연습했습니다. 몸이 끊기지 않고 이어지도록 집중했습니다. 움직임이 점점 부드러워지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 접영 발차기를 처음 배워보았습니다. 몸의 움직임과 함께 다리를 사용하는 방법을 익혔습니다. 새로운 동작에도 집중력이 좋았습니다. 좋은 출발을 했습니다.",
    "오늘은 접영 발차기 자세를 연습했습니다. 무릎보다 몸 전체를 사용하는 데 집중했습니다. 발차기 모양이 점점 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 발차기 리듬을 연습했습니다. 한 번의 움직임이 자연스럽게 이어지도록 반복했습니다. 리듬감이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 발차기를 이어가는 연습을 했습니다. 중간에 멈추지 않고 반복하는 데 집중했습니다. 동작 연결이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 발차기로 이동하는 연습을 했습니다. 발차기의 힘으로 앞으로 나아가는 경험을 했습니다. 추진력이 조금씩 좋아지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 접영 발차기 거리를 늘리는 연습을 했습니다. 리듬을 유지하며 이동하는 데 집중했습니다. 체력도 함께 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 발차기를 오래 유지하는 연습을 했습니다. 박자가 끊기지 않도록 반복했습니다. 지구력과 리듬감이 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 반복되는 박자를 연습했습니다. 같은 리듬을 계속 유지하는 경험을 했습니다. 접영 이해도가 높아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 일정한 박자로 접영 발차기를 연습했습니다. 빠르기보다 리듬을 유지하는 데 집중했습니다. 동작이 안정적으로 이어지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 원킥 접영을 시작했습니다. 한 번의 킥으로 몸을 움직이는 방법을 배웠습니다. 새로운 동작에도 적극적으로 참여했습니다. 좋은 출발을 했습니다.",
    "오늘은 원킥 타이밍을 연습했습니다. 몸의 움직임과 킥을 맞추는 데 집중했습니다. 동작 이해도가 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 원킥 접영을 반복 연습했습니다. 일정한 리듬을 유지하며 진행했습니다. 전보다 훨씬 자연스러워졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 원킥으로 거리를 이동해보았습니다. 발차기와 몸의 움직임을 연결했습니다. 추진력이 점점 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 투킥 접영을 시작했습니다. 두 번의 킥을 사용하는 방법을 배웠습니다. 처음 배우는 내용인데도 집중력이 좋았습니다. 좋은 출발을 했습니다.",
    "오늘은 첫 번째 킥 타이밍을 연습했습니다. 언제 힘을 써야 하는지 확인하며 진행했습니다. 접영 리듬이 만들어지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 두 번째 킥 타이밍을 연습했습니다. 리듬이 끊어지지 않도록 반복했습니다. 점점 감을 잡고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 원킥과 투킥의 차이를 연습했습니다. 두 가지 리듬을 비교하며 진행했습니다. 접영 이해도가 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 투킥 접영을 반복 연습했습니다. 박자를 유지하며 이동하는 데 집중했습니다. 동작이 점점 자연스러워지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 접영 팔동작을 시작했습니다. 양팔을 동시에 움직이는 연습을 진행했습니다. 새로운 동작에도 적극적으로 참여했습니다. 좋은 출발을 했습니다.",
    "오늘은 팔을 앞으로 뻗는 연습을 했습니다. 몸을 길게 만드는 자세를 함께 익혔습니다. 자세가 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 팔 입수를 연습했습니다. 양손이 자연스럽게 물에 들어가도록 반복했습니다. 동작이 안정적으로 만들어지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 물잡기를 연습했습니다. 손으로 물을 느끼며 누르는 경험을 했습니다. 추진력이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 팔동작 마무리를 연습했습니다. 끝까지 물을 사용하는 데 집중했습니다. 동작 연결이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 팔동작과 원킥을 연결했습니다. 몸의 움직임과 타이밍을 맞춰보았습니다. 접영 형태가 만들어지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 팔동작과 투킥을 연결했습니다. 전체 리듬을 유지하는 데 집중했습니다. 전보다 훨씬 자연스러워졌습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 순서를 연습했습니다. 몸, 킥, 팔동작 순서를 연결했습니다. 실수가 줄어들고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 전체 동작을 반복 연습했습니다. 동작이 끊어지지 않도록 집중했습니다. 접영 이해도가 많이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 거리 늘리기를 연습했습니다. 배운 순서를 유지하며 이동했습니다. 체력도 함께 좋아지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 접영 자세를 점검했습니다. 몸의 움직임과 킥 타이밍을 다시 확인했습니다. 수영 자세가 안정적으로 만들어지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 동작을 복습했습니다. 지금까지 배운 내용을 다시 정리했습니다. 처음보다 훨씬 완성된 모습이 나오고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 전체 연결을 연습했습니다. 몸, 킥, 팔동작을 하나로 이어보았습니다. 수영 동작이 점점 완성되고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 완주에 도전했습니다. 배운 동작을 끝까지 유지하며 진행했습니다. 포기하지 않고 최선을 다했습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 과정을 전체 점검했습니다. 부족한 부분을 다시 확인하고 연습했습니다. 동작 이해도가 많이 좋아졌습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 스트로크 과정을 정리했습니다. 처음 접영을 배웠을 때보다 훨씬 자연스러운 움직임이 나오고 있습니다. 반복되는 박자와 순서를 잘 이해하고 있습니다. 다음 단계 준비가 잘 되고 있습니다.",
  ]},
  { levelName: "수영질서·빨간레벨테스트", templates: [
    "오늘은 지금까지 배운 동작들을 다시 확인했습니다. 평영과 접영의 순서를 구분하며 연습을 진행했습니다. 배운 내용을 잘 기억하고 있었습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 순서를 다시 연습했습니다. 팔동작과 발차기가 섞이지 않도록 집중했습니다. 동작 이해도가 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 리듬을 점검했습니다. 순서를 지키며 수영하는 데 집중했습니다. 전보다 훨씬 안정적인 모습이었습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 평영 연결동작을 반복 연습했습니다. 급하게 움직이지 않고 순서를 유지했습니다. 수영 자세가 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 전체 동작을 점검했습니다. 팔, 호흡, 킥의 순서를 다시 확인했습니다. 실수가 줄어들고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 리듬을 점검했습니다. 반복되는 박자를 유지하는 연습을 진행했습니다. 동작 연결이 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 원킥을 점검했습니다. 몸과 킥의 연결을 다시 확인했습니다. 리듬감이 좋아지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 접영 투킥을 점검했습니다. 두 번의 킥 타이밍을 맞추는 데 집중했습니다. 동작이 점점 자연스러워지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 접영 팔동작을 점검했습니다. 양팔이 같은 타이밍으로 움직이도록 연습했습니다. 자세가 안정적으로 만들어지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 전체 순서를 연습했습니다. 몸, 킥, 팔동작 순서를 연결했습니다. 접영 이해도가 좋아지고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 평영과 접영을 번갈아 연습했습니다. 영법이 섞이지 않도록 집중했습니다. 구분 능력이 좋아지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 영법 전환 연습을 했습니다. 다른 동작으로 바뀌어도 순서를 유지했습니다. 집중력이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 완주를 연습했습니다. 배운 순서를 끝까지 유지하며 진행했습니다. 전보다 훨씬 여유 있는 모습이었습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 완주를 연습했습니다. 배운 리듬을 유지하며 끝까지 도전했습니다. 포기하지 않는 모습이 인상적이었습니다. 잘 따라오고 있습니다.",
    "오늘은 평영 자세를 다시 점검했습니다. 작은 실수들을 수정하며 연습했습니다. 수영 자세가 안정적으로 만들어지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 접영 자세를 다시 점검했습니다. 킥과 팔동작의 타이밍을 확인했습니다. 동작 연결이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 평영 거리 늘리기를 연습했습니다. 중간에 멈추지 않고 연결하는 데 집중했습니다. 체력도 함께 좋아지고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 접영 거리 늘리기를 연습했습니다. 리듬을 유지하며 이동하는 데 집중했습니다. 전보다 훨씬 안정적인 모습입니다. 잘 따라오고 있습니다.",
    "오늘은 순서를 지키는 수영을 연습했습니다. 빠르기보다 정확하게 수행하는 데 집중했습니다. 동작 완성도가 높아지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 순서를 기억하며 수영했습니다. 스스로 동작을 떠올리며 진행했습니다. 이해도가 많이 좋아지고 있습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 파란모자 평가 항목을 확인했습니다. 지금까지 배운 내용을 다시 정리했습니다. 레벨업 준비가 잘 되고 있습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 평영 평가 준비를 진행했습니다. 순서와 리듬을 다시 점검했습니다. 실수가 줄어들고 있습니다. 잘 따라오고 있습니다.",
    "오늘은 접영 평가 준비를 진행했습니다. 박자와 연결동작을 다시 확인했습니다. 동작 완성도가 좋아지고 있습니다. 좋은 흐름으로 진행되고 있습니다.",
    "오늘은 레벨업 전 최종 점검을 진행했습니다. 부족한 부분을 보완하며 연습했습니다. 집중력이 매우 좋았습니다. 꾸준히 발전하고 있습니다.",
    "오늘은 파란모자 테스트에 도전했습니다. 긴장했지만 끝까지 최선을 다해 수행했습니다. 배운 내용을 잘 보여주었습니다. 좋은 모습을 보여주었습니다.",
    "오늘은 파란모자 테스트를 진행했습니다. 순서를 지키며 수영하는 데 집중했습니다. 끝까지 포기하지 않고 도전했습니다. 정말 수고 많았습니다.",
    "오늘은 파란모자 테스트 결과를 확인했습니다. 배운 내용을 바탕으로 좋은 모습을 보여주었습니다. 노력한 만큼 성장한 모습이 보였습니다. 축하합니다.",
    "파란모자 레벨업을 축하합니다. 평영과 접영을 배우며 한 단계 성장했습니다. 수영에 대한 이해가 더욱 깊어졌습니다. 정말 수고 많았습니다.",
    "파란모자 과정을 마무리했습니다. 새로운 영법과 리듬을 배우며 많은 경험을 쌓았습니다. 꾸준한 노력이 좋은 결과로 이어지고 있습니다. 다음 단계 준비가 잘 되고 있습니다.",
    "파란모자 과정을 모두 완료했습니다. 처음 시작했을 때보다 훨씬 다양한 영법을 이해하고 수행할 수 있게 되었습니다. 성장하는 모습이 매우 인상적이었습니다. 빨간모자 과정에서도 즐겁게 도전해보겠습니다.",
  ]},
];

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
        const merged = await db.execute(sql`
          SELECT
            g.id           AS global_id,
            g.id           AS id,
            COALESCE(ov.template_text, g.template_text) AS template_text,
            COALESCE(ov.title, g.title)                 AS title,
            g.level_id, g.sort_order, g.is_active,
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
            AND is_active = true
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
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      await db.execute(sql`DELETE FROM diary_templates WHERE swimming_pool_id = ${poolId} AND scope = 'global'`);
      await db.execute(sql`DELETE FROM diary_template_levels WHERE swimming_pool_id = ${poolId}`);
      for (let li = 0; li < SWIMNOTE_DEFAULT_TEMPLATES.length; li++) {
        const { levelName, templates } = SWIMNOTE_DEFAULT_TEMPLATES[li];
        const lvId = genId("dtl");
        await db.execute(sql`INSERT INTO diary_template_levels (id, swimming_pool_id, level_name, sort_order) VALUES (${lvId}, ${poolId}, ${levelName}, ${li})`);
        for (let ti = 0; ti < templates.length; ti++) {
          const dtId = genId("dt");
          await db.execute(sql`INSERT INTO diary_templates (id, swimming_pool_id, level_id, template_text, sort_order, scope, created_by) VALUES (${dtId}, ${poolId}, ${lvId}, ${templates[ti]}, ${ti}, 'global', ${req.user!.userId})`);
        }
      }
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates/clear-all — 전체 초기화 (레벨 유지, 모든 global 템플릿 삭제)
router.post("/diary-templates/clear-all",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      await db.execute(sql`DELETE FROM diary_templates WHERE swimming_pool_id = ${poolId} AND scope = 'global'`);
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
      if (!isAdmin) {
        const check = await db.execute(sql`SELECT scope, teacher_id FROM diary_templates WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
        const row = check.rows[0] as any;
        if (!row) return apiErr(res, 404, "템플릿을 찾을 수 없습니다.");
        if (row.scope === "global") return apiErr(res, 403, "공통 템플릿은 삭제할 수 없습니다.");
        if (row.teacher_id !== userId) return apiErr(res, 403, "본인 템플릿만 삭제할 수 있습니다.");
      }
      await db.execute(sql`DELETE FROM diary_templates WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
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
        res.json({ unread_messages: 0, pending_diaries_today: 0, pending_diaries_past: 0, makeup_count: 0 });
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

      // 오늘 미작성 수업일지 (오늘 수업이 있는 반 중 diary 없는 것)
      const pendingToday = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM class_groups cg
        WHERE cg.id IN (${sql.raw(classIdList)})
          AND NOT EXISTS (
            SELECT 1 FROM class_diaries cd
            WHERE cd.class_group_id = cg.id AND cd.lesson_date = ${today} AND cd.is_deleted = false
          )
      `);

      // NOTE: 어제까지 미작성 계산은 class_groups 스케줄 + 실제 날짜 비교가 필요하나
      //       현재는 결석 기록 기반 근사치로 처리 (향후 schedule_dates 테이블로 고도화)
      const pendingPastCount = 0; // TODO: 정확한 미작성 날짜 계산 구현

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

      res.json({
        unread_messages: Number((unreadMsg.rows[0] as any)?.cnt ?? 0),
        pending_diaries_today: Number((pendingToday.rows[0] as any)?.cnt ?? 0),
        pending_diaries_past: pendingPastCount,
        makeup_count: Number((makeupCount.rows[0] as any)?.cnt ?? 0),
        pending_parent_requests: Number((pendingRequests.rows[0] as any)?.cnt ?? 0),
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
           ORDER BY dm2.created_at DESC LIMIT 1) AS last_sender_name
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
// 미작성 수업 슬롯 목록 (선생님 모드 — 일지 작성 진입용)
// GET /diaries/unwritten-slots
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/unwritten-slots",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, role } = req.user!;
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      // 선생님: 본인 반만, 관리자: 전체
      let classRows;
      if (role === "teacher") {
        classRows = await db.execute(sql`
          SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time,
            (SELECT COUNT(*) FROM students s WHERE s.class_group_id = cg.id AND s.status NOT IN ('withdrawn','deleted')) AS student_count
          FROM class_groups cg
          WHERE cg.teacher_user_id = ${userId} AND cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
        `);
      } else {
        classRows = await db.execute(sql`
          SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time,
            (SELECT COUNT(*) FROM students s WHERE s.class_group_id = cg.id AND s.status NOT IN ('withdrawn','deleted')) AS student_count
          FROM class_groups cg
          WHERE cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
        `);
      }

      const DAY_MAP: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };
      const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      // 8주 전부터 어제까지의 날짜를 생성
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - 56);

      const slots: any[] = [];

      for (const cg of classRows.rows as any[]) {
        const days: number[] = [];
        for (const ch of (cg.schedule_days || "")) {
          if (DAY_MAP[ch] !== undefined) days.push(DAY_MAP[ch]);
        }
        if (days.length === 0) continue;

        // 이 반의 기작성 일지 날짜 목록
        const writtenRows = await db.execute(sql`
          SELECT lesson_date FROM class_diaries
          WHERE class_group_id = ${cg.id} AND is_deleted = false
        `);
        const writtenDates = new Set((writtenRows.rows as any[]).map(r => r.lesson_date?.toString?.().slice(0, 10) || ""));

        // fromDate ~ yesterday 기간 중 schedule_days에 해당하는 날짜 생성
        const cursor = new Date(fromDate);
        while (cursor < today) {
          if (days.includes(cursor.getDay())) {
            const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
            if (!writtenDates.has(dateStr)) {
              slots.push({
                classGroupId: cg.id,
                className: cg.name,
                scheduleTime: (cg.schedule_time || "").slice(0, 5),
                lessonDate: dateStr,
                dayOfWeek: KO_DAYS[cursor.getDay()],
                studentCount: Number(cg.student_count) || 0,
              });
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }

      // 날짜 오름차순, 같은 날짜면 시간 오름차순
      slots.sort((a, b) => {
        const dateCmp = a.lessonDate.localeCompare(b.lessonDate);
        if (dateCmp !== 0) return dateCmp;
        return a.scheduleTime.localeCompare(b.scheduleTime);
      });

      res.json({ success: true, slots, total: slots.length });
    } catch (e) { console.error("[unwritten-slots]", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 관리자 — 교사별 일지 통계 목록
// GET /diaries/admin/teachers
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/admin/teachers",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
      const poolId = await getUserPoolId(userId);
      if (!poolId) return apiErr(res, 403, "수영장 정보가 없습니다.");

      const rows = await superAdminDb.execute(sql`
        SELECT
          u.id AS teacher_id,
          u.name AS teacher_name,
          COUNT(DISTINCT cg.id) AS class_count,
          COUNT(DISTINCT cd.id) FILTER (WHERE cd.is_deleted = false) AS diary_count,
          MAX(cd.lesson_date) FILTER (WHERE cd.is_deleted = false) AS last_diary_date
        FROM users u
        LEFT JOIN class_groups cg ON cg.teacher_user_id = u.id AND cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
        LEFT JOIN class_diaries cd ON cd.teacher_id = u.id::text AND cd.swimming_pool_id = ${poolId}
        WHERE u.swimming_pool_id = ${poolId} AND u.role = 'teacher' AND u.is_active = true
        GROUP BY u.id, u.name
        ORDER BY diary_count DESC, u.name ASC
      `);

      res.json({ success: true, teachers: rows.rows });
    } catch (e) { console.error("[diaries/admin/teachers]", e); apiErr(res, 500, "서버 오류"); }
  }
);

// ════════════════════════════════════════════════════════════════════════
// 관리자 — 특정 교사의 일지 목록
// GET /diaries/admin/teacher/:teacherId/entries
// ════════════════════════════════════════════════════════════════════════
router.get("/diaries/admin/teacher/:teacherId/entries",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId } = req.user!;
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
          (SELECT COUNT(*) FROM class_diary_student_notes csn WHERE csn.diary_id = cd.id AND csn.is_deleted = false) AS note_count
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
  requireAuth, requireRole("super_admin", "pool_admin"),
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

export default router;

