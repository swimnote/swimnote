import { Router, Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable, studentsTable, parentAccountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename, sanitizePoolName } from "../utils/filename.js";
import { notifyDiaryUpload, notifyComment } from "../utils/notify.js";

const router = Router();
// 모바일 평균 사진 크기 기준 최대 8MB 제한
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client();
  return _client;
}

async function getPoolSlug(poolId: string): Promise<string> {
  const rows = await db.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${poolId}`);
  const pool = rows.rows[0] as any;
  return pool?.name_en || sanitizePoolName(pool?.name || "pool");
}

async function attachGroupNames(rows: any[]): Promise<any[]> {
  const ids = [...new Set(rows.map((r: any) => r.class_group_id).filter(Boolean))];
  if (!ids.length) return rows;
  const gs = await db.execute(sql`SELECT id, name, schedule_days, schedule_time FROM class_groups WHERE id = ANY(${ids}::text[])`);
  const map: Record<string, any> = {};
  for (const g of gs.rows as any[]) map[g.id] = g;
  return rows.map((r: any) => ({ ...r, class_group: map[r.class_group_id] || null }));
}

// ── 스케줄 그룹 목록 ──────────────────────────────────────────────────
router.get("/diary/class-groups", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(403).json({ error: "소속 수영장 없음" }); return; }
      const groups = await db.execute(sql`
        SELECT id, name, schedule_days, schedule_time, instructor, level,
          (SELECT COUNT(*) FROM students WHERE class_group_id = class_groups.id) AS student_count
        FROM class_groups WHERE swimming_pool_id = ${user.swimming_pool_id}
        ORDER BY name
      `);
      res.json(groups.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 일지 목록: 그룹 기준 (선생님/관리자) ─────────────────────────────
router.get("/diary", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_group_id } = req.query;
      const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(403).json({ error: "소속 수영장 없음" }); return; }

      const rows = class_group_id
        ? await db.execute(sql`
            SELECT sd.*,
              (SELECT COUNT(*) FROM diary_comments WHERE diary_id = sd.id) AS comment_count
            FROM swim_diary sd
            WHERE sd.swimming_pool_id = ${user.swimming_pool_id}
              AND sd.class_group_id = ${class_group_id as string}
            ORDER BY sd.created_at DESC
          `)
        : await db.execute(sql`
            SELECT sd.*,
              (SELECT COUNT(*) FROM diary_comments WHERE diary_id = sd.id) AS comment_count
            FROM swim_diary sd
            WHERE sd.swimming_pool_id = ${user.swimming_pool_id}
            ORDER BY sd.created_at DESC
          `);

      res.json(await attachGroupNames(rows.rows));
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 일지 목록: 학생 기준 (학부모 + 선생님) ───────────────────────────
router.get("/students/:studentId/diary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { studentId } = req.params;
    const { userId, role } = req.user!;

    if (role === "parent_account") {
      const ok = await db.execute(sql`
        SELECT 1 FROM parent_students
        WHERE parent_id = ${userId} AND student_id = ${studentId} AND status = 'approved'
      `);
      if (!ok.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    } else if (!["pool_admin", "teacher", "super_admin"].includes(role)) {
      res.status(403).json({ error: "접근 권한이 없습니다." }); return;
    }

    const [student] = await db.select({ class_group_id: studentsTable.class_group_id })
      .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
    if (!student?.class_group_id) { res.json([]); return; }

    const rows = await db.execute(sql`
      SELECT sd.*,
        (SELECT COUNT(*) FROM diary_comments WHERE diary_id = sd.id) AS comment_count
      FROM swim_diary sd
      WHERE sd.class_group_id = ${student.class_group_id}
      ORDER BY sd.created_at DESC
    `);
    res.json(await attachGroupNames(rows.rows));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 일지 작성: 여러 그룹 → 그룹별 독립 레코드 생성 ──────────────────
router.post("/diary", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("images", 5),
  async (req: AuthRequest, res: Response) => {
    try {
      const { title, lesson_content, practice_goals, good_points, next_focus } = req.body;
      let groupIds: string[] = [];
      try {
        const raw = req.body.class_group_ids;
        groupIds = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : []);
      } catch { groupIds = []; }

      if (!title?.trim()) { res.status(400).json({ error: "제목을 입력해주세요." }); return; }
      if (!groupIds.length) { res.status(400).json({ error: "스케줄 그룹을 하나 이상 선택해주세요." }); return; }

      const [user] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      // 이미지 업로드 (표준 파일명)
      const files = req.files as Express.Multer.File[] | undefined;
      const imageKeys: string[] = [];
      if (files?.length) {
        const client = getClient();
        const poolSlug = await getPoolSlug(user.swimming_pool_id);
        for (const file of files.slice(0, 5)) {
          const ext = file.originalname.split(".").pop() || "jpg";
          const filename = genFilename(poolSlug, ext);
          const key = `diary/group/${filename}`;
          const { ok, error } = await client.uploadFromBuffer(file.buffer, key, { contentType: file.mimetype });
          if (!ok) throw new Error(error?.message || "업로드 실패");
          imageKeys.push(key);
        }
      }

      // 그룹별 독립 레코드 생성
      const created: any[] = [];
      for (const groupId of groupIds) {
        const id = `diary_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const rows = await db.execute(sql`
          INSERT INTO swim_diary
            (id, swimming_pool_id, author_id, author_name, class_group_id,
             title, lesson_content, practice_goals, good_points, next_focus, image_urls)
          VALUES
            (${id}, ${user.swimming_pool_id}, ${req.user!.userId}, ${user.name}, ${groupId},
             ${title.trim()},
             ${lesson_content?.trim() || null},
             ${practice_goals?.trim() || null},
             ${good_points?.trim() || null},
             ${next_focus?.trim() || null},
             ${JSON.stringify(imageKeys)}::jsonb)
          RETURNING *
        `);
        created.push(rows.rows[0]);
        // 알림: 그룹 소속 학부모에게 업로드 알림 (비동기, 실패 무시)
        notifyDiaryUpload(user.swimming_pool_id, groupId, id, title.trim()).catch(() => {});
      }
      const result = await attachGroupNames(created);
      res.status(201).json(result);
    } catch (err) {
      console.error(err);
      const msg = (err as any)?.message || "";
      if (msg.includes("8MB") || msg.includes("too large") || msg.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "파일 크기 초과: 이미지는 장당 최대 8MB까지 업로드할 수 있습니다." });
        return;
      }
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── 일지 수정 (그룹별 독립 수정) ─────────────────────────────────────
router.put("/diary/:id", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("images", 5),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { title, lesson_content, practice_goals, good_points, next_focus, keep_image_urls } = req.body;

      const existing = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${id}`);
      const entry = existing.rows[0] as any;
      if (!entry) { res.status(404).json({ error: "일지를 찾을 수 없습니다." }); return; }

      let keptKeys: string[] = [];
      try { keptKeys = keep_image_urls ? JSON.parse(keep_image_urls) : []; } catch { keptKeys = []; }

      // 삭제된 이미지 스토리지에서 제거
      const allOld: string[] = Array.isArray(entry.image_urls) ? entry.image_urls : [];
      const removed = allOld.filter((k: string) => !keptKeys.includes(k));
      if (removed.length) {
        const client = getClient();
        for (const key of removed) await client.delete(key).catch(() => {});
      }

      // 새 이미지 업로드 (표준 파일명)
      const files = req.files as Express.Multer.File[] | undefined;
      const newKeys: string[] = [];
      if (files?.length) {
        const client = getClient();
        const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
          .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
        const poolSlug = await getPoolSlug(user?.swimming_pool_id || "");
        for (const file of files.slice(0, 5 - keptKeys.length)) {
          const ext = file.originalname.split(".").pop() || "jpg";
          const filename = genFilename(poolSlug, ext);
          const key = `diary/group/${filename}`;
          const { ok, error } = await client.uploadFromBuffer(file.buffer, key, { contentType: file.mimetype });
          if (!ok) throw new Error(error?.message || "업로드 실패");
          newKeys.push(key);
        }
      }
      const finalImages = [...keptKeys, ...newKeys];

      const rows = await db.execute(sql`
        UPDATE swim_diary SET
          title = ${title?.trim() || entry.title},
          lesson_content = ${lesson_content?.trim() || null},
          practice_goals = ${practice_goals?.trim() || null},
          good_points = ${good_points?.trim() || null},
          next_focus = ${next_focus?.trim() || null},
          image_urls = ${JSON.stringify(finalImages)}::jsonb
        WHERE id = ${id}
        RETURNING *
      `);
      const result = await attachGroupNames(rows.rows);
      res.json(result[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 일지 삭제 ─────────────────────────────────────────────────────────
router.delete("/diary/:id", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db.execute(sql`SELECT image_urls FROM swim_diary WHERE id = ${req.params.id}`);
      const entry = rows.rows[0] as any;
      if (entry?.image_urls?.length) {
        const client = getClient();
        for (const key of entry.image_urls) await client.delete(key).catch(() => {});
      }
      await db.execute(sql`DELETE FROM swim_diary WHERE id = ${req.params.id}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

// ── 일지 댓글 목록 (내 댓글만 내용 공개) ────────────────────────────
router.get("/diary/:id/comments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const rows = await db.execute(sql`
      SELECT * FROM diary_comments WHERE diary_id = ${req.params.id} ORDER BY created_at ASC
    `);
    const result = (rows.rows as any[]).map(c => ({
      id: c.id,
      diary_id: c.diary_id,
      author_name: c.author_id === userId ? c.author_name : null,
      author_role: c.author_role,
      content: c.author_id === userId ? c.content : null,
      is_mine: c.author_id === userId,
      created_at: c.created_at,
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 일지 댓글 작성 ────────────────────────────────────────────────────
router.post("/diary/:id/comments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "댓글 내용을 입력해주세요." }); return; }
    const { userId, role } = req.user!;

    let authorName = "알 수 없음";
    let poolId = "";
    if (role === "parent_account") {
      const [pa] = await db.select({ name: parentAccountsTable.name, swimming_pool_id: parentAccountsTable.swimming_pool_id })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, userId)).limit(1);
      authorName = pa?.name || "학부모";
      poolId = pa?.swimming_pool_id || "";
    } else {
      const [u] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      authorName = u?.name || "선생님";
      poolId = u?.swimming_pool_id || "";
    }

    const id = `dcmt_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const rows = await db.execute(sql`
      INSERT INTO diary_comments (id, diary_id, author_id, author_name, author_role, content)
      VALUES (${id}, ${req.params.id}, ${userId}, ${authorName}, ${role}, ${content.trim()})
      RETURNING *
    `);
    const c = rows.rows[0] as any;

    // 알림: 학부모가 댓글을 달면 선생님에게 알림 (비동기)
    if (role === "parent_account" && poolId) {
      const diary = await db.execute(sql`SELECT title FROM swim_diary WHERE id = ${req.params.id}`);
      const diaryTitle = (diary.rows[0] as any)?.title || "수영 일지";
      notifyComment(poolId, "diary_comment", authorName, req.params.id, diaryTitle).catch(() => {});
    }

    res.status(201).json({ ...c, is_mine: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 일지 댓글 삭제 (관리자만) ────────────────────────────────────────
router.delete("/diary/:id/comments/:commentId", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db.execute(sql`SELECT id FROM diary_comments WHERE id = ${req.params.commentId}`);
      if (!rows.rows.length) { res.status(404).json({ error: "댓글을 찾을 수 없습니다." }); return; }
      await db.execute(sql`DELETE FROM diary_comments WHERE id = ${req.params.commentId}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

export default router;
