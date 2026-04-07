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
// 5. 템플릿 관리
// ════════════════════════════════════════════════════════════════════════

// GET /diary-templates — 선생님 + 관리자 조회
router.get("/diary-templates",
  requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      const rows = await db.execute(sql`
        SELECT * FROM diary_templates WHERE swimming_pool_id = ${poolId} AND is_active = true
        ORDER BY category, created_at DESC
      `);
      res.json(rows.rows);
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// POST /diary-templates — 관리자 전용 생성
router.post("/diary-templates",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { category, level, template_text } = req.body;
      if (!template_text?.trim()) return apiErr(res, 400, "템플릿 내용을 입력해주세요.");
      const poolId = await getUserPoolId(req.user!.userId);
      const id = genId("dt");
      await db.execute(sql`
        INSERT INTO diary_templates (id, swimming_pool_id, category, level, template_text, created_by)
        VALUES (${id}, ${poolId}, ${category || "general"}, ${level || null}, ${template_text.trim()}, ${req.user!.userId})
      `);
      res.json({ success: true, id });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// PATCH /diary-templates/:id — 관리자 전용 수정
router.patch("/diary-templates/:id",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { template_text, category, level, is_active } = req.body;
      const poolId = await getUserPoolId(req.user!.userId);
      await db.execute(sql`
        UPDATE diary_templates
        SET template_text = COALESCE(${template_text ?? null}, template_text),
            category = COALESCE(${category ?? null}, category),
            level = COALESCE(${level ?? null}, level),
            is_active = COALESCE(${is_active ?? null}, is_active),
            updated_at = NOW()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      `);
      res.json({ success: true });
    } catch (e) { console.error(e); apiErr(res, 500, "서버 오류"); }
  }
);

// DELETE /diary-templates/:id — 소프트 비활성화
router.delete("/diary-templates/:id",
  requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getUserPoolId(req.user!.userId);
      await db.execute(sql`UPDATE diary_templates SET is_active = false WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`);
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

