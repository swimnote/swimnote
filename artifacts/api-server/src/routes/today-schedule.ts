/**
 * today-schedule.ts
 *
 * GET  /today-schedule          오늘 수업 스케쥴 (선생님 본인 / pool_admin 전체)
 * GET  /schedule-notes          메모 조회 (?date=YYYY-MM-DD&classGroupId=xxx)
 * GET  /schedule-notes/dates    메모 있는 날짜 목록 (?year=YYYY&month=M)
 * POST /schedule-notes          메모 저장/업서트
 * POST /schedule-notes/audio    음성파일 업로드
 */
import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });
  return _client;
}

/** KST 기준 오늘 날짜 문자열 YYYY-MM-DD */
function todayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** KST 기준 오늘 요일 한국어 단자 */
function todayDayKO(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
}

/** ─────────────────────────────────────────────────────────
 *  GET /today-schedule
 *  선생님: 자신이 담당하는 오늘 수업
 *  pool_admin: 풀 전체 오늘 수업
 * ───────────────────────────────────────────────────────── */
router.get("/today-schedule", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const role = user.role;
    const today = todayKST();
    const dayKO = todayDayKO();
    const dateParam = (req.query.date as string) || today;

    // UTC 정오 기준 파싱 → 어떤 서버 시간대에서도 올바른 요일 계산
    const targetDate = new Date(dateParam + "T12:00:00Z");
    const targetDayKO = ["일", "월", "화", "수", "목", "금", "토"][targetDate.getUTCDay()];

    let groups: any[];
    if (role === "teacher") {
      const rows = await db.execute(sql`
        SELECT * FROM class_groups
        WHERE teacher_user_id = ${user.userId}
        AND schedule_days LIKE ${"%" + targetDayKO + "%"}
        AND is_deleted = false
        ORDER BY schedule_time ASC
      `);
      groups = rows.rows as any[];
    } else if (role === "pool_admin") {
      const poolRow = await db.execute(sql`SELECT id FROM swimming_pools WHERE admin_user_id = ${user.userId}`);
      const poolId = (poolRow.rows[0] as any)?.id;
      if (!poolId) { res.json([]); return; }
      const rows = await db.execute(sql`
        SELECT * FROM class_groups
        WHERE swimming_pool_id = ${poolId}
        AND schedule_days LIKE ${"%" + targetDayKO + "%"}
        AND is_deleted = false
        ORDER BY schedule_time ASC
      `);
      groups = rows.rows as any[];
    } else {
      res.json([]); return;
    }

    if (groups.length === 0) { res.json([]); return; }

    const classIds = groups.map(g => g.id);

    // 학생 수 (assigned_class_ids 기반) — 같은 수영장의 학생 전체 조회 후 JS에서 필터
    const poolId = groups[0]?.swimming_pool_id || "";
    const studentRows = await db.execute(sql`
      SELECT id, assigned_class_ids FROM students
      WHERE swimming_pool_id = ${poolId}
      AND status = 'active'
    `);
    const studentCountMap: Record<string, number> = {};
    for (const st of studentRows.rows as any[]) {
      let ids: string[] = [];
      try { ids = JSON.parse(st.assigned_class_ids || "[]"); } catch { ids = []; }
      for (const cid of ids) {
        if (classIds.includes(cid)) studentCountMap[cid] = (studentCountMap[cid] || 0) + 1;
      }
    }

    // 출결 현황 — poolId 기반으로 조회 후 JS에서 필터
    const attRows = await db.execute(sql`
      SELECT a.class_group_id, COUNT(*) as cnt,
             COUNT(*) FILTER (WHERE a.status IN ('present', 'late')) as present_cnt
      FROM attendance a
      JOIN class_groups cg ON cg.id = a.class_group_id
      WHERE cg.swimming_pool_id = ${poolId}
      AND a.date = ${dateParam}
      GROUP BY a.class_group_id
    `);
    const attMap: Record<string, { total: number; present: number }> = {};
    for (const r of attRows.rows as any[]) {
      attMap[r.class_group_id] = { total: Number(r.cnt), present: Number(r.present_cnt) };
    }

    // 일지 작성 여부
    const diaryRows = await db.execute(sql`
      SELECT class_group_id FROM swim_diary
      WHERE swimming_pool_id = ${poolId}
      AND DATE(created_at) = ${dateParam}::date
    `);
    const diarySet = new Set((diaryRows.rows as any[]).map(r => r.class_group_id));

    // 메모 존재 여부
    const teacherId = user.userId;
    const noteRows = await db.execute(sql`
      SELECT class_group_id, note_text, audio_file_url FROM teacher_schedule_notes
      WHERE teacher_id = ${teacherId}
      AND swimming_pool_id = ${poolId}
      AND schedule_date = ${dateParam}
    `);
    const noteMap: Record<string, { note_text: string | null; audio_file_url: string | null }> = {};
    for (const r of noteRows.rows as any[]) {
      noteMap[r.class_group_id] = { note_text: r.note_text, audio_file_url: r.audio_file_url };
    }

    const result = groups.map(g => ({
      ...g,
      student_count: studentCountMap[g.id] || 0,
      att_total:     attMap[g.id]?.total || 0,
      att_present:   attMap[g.id]?.present || 0,
      diary_done:    diarySet.has(g.id),
      has_note:      !!noteMap[g.id]?.note_text || !!noteMap[g.id]?.audio_file_url,
      note_text:     noteMap[g.id]?.note_text || null,
      audio_file_url: noteMap[g.id]?.audio_file_url || null,
    }));

    res.json(result);
  } catch (e: any) {
    console.error("[today-schedule]", e);
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  GET /schedule-notes/dates
 *  해당 연월에 메모가 존재하는 날짜 목록 (선생님 본인만)
 * ───────────────────────────────────────────────────────── */
router.get("/schedule-notes/dates", requireAuth, requireRole("teacher", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const { year, month } = req.query;
    const teacherId = req.user!.userId;
    const prefix = `${year}-${String(month).padStart(2, "0")}`;

    const rows = await db.execute(sql`
      SELECT DISTINCT schedule_date FROM teacher_schedule_notes
      WHERE teacher_id = ${teacherId}
      AND schedule_date LIKE ${prefix + "-%"}
      ORDER BY schedule_date ASC
    `);
    res.json((rows.rows as any[]).map(r => r.schedule_date));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  GET /schedule-notes
 *  특정 날짜 메모 조회 (?date=YYYY-MM-DD&classGroupId=xxx optional)
 * ───────────────────────────────────────────────────────── */
router.get("/schedule-notes", requireAuth, requireRole("teacher", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const { date, classGroupId } = req.query as Record<string, string>;
    const teacherId = req.user!.userId;

    let rows: any;
    if (classGroupId) {
      rows = await db.execute(sql`
        SELECT tsn.*, cg.name as class_name, cg.schedule_time, cg.schedule_days
        FROM teacher_schedule_notes tsn
        LEFT JOIN class_groups cg ON cg.id = tsn.class_group_id
        WHERE tsn.teacher_id = ${teacherId}
        AND tsn.schedule_date = ${date}
        AND tsn.class_group_id = ${classGroupId}
      `);
    } else {
      rows = await db.execute(sql`
        SELECT tsn.*, cg.name as class_name, cg.schedule_time, cg.schedule_days
        FROM teacher_schedule_notes tsn
        LEFT JOIN class_groups cg ON cg.id = tsn.class_group_id
        WHERE tsn.teacher_id = ${teacherId}
        AND tsn.schedule_date = ${date}
        ORDER BY cg.schedule_time ASC
      `);
    }
    res.json(rows.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  POST /schedule-notes
 *  메모 저장 (upsert: 같은 teacher+class+date면 업데이트)
 * ───────────────────────────────────────────────────────── */
router.post("/schedule-notes", requireAuth, requireRole("teacher", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const { class_group_id, schedule_date, note_text, audio_file_url } = req.body;
    if (!class_group_id || !schedule_date) {
      res.status(400).json({ error: "class_group_id, schedule_date 필수" }); return;
    }
    const teacherId = req.user!.userId;

    // swimming_pool_id 조회
    const cgRow = await db.execute(sql`SELECT swimming_pool_id FROM class_groups WHERE id = ${class_group_id}`);
    const poolId = (cgRow.rows[0] as any)?.swimming_pool_id;
    if (!poolId) { res.status(404).json({ error: "반을 찾을 수 없습니다." }); return; }

    // 기존 레코드 확인
    const existing = await db.execute(sql`
      SELECT id FROM teacher_schedule_notes
      WHERE teacher_id = ${teacherId} AND class_group_id = ${class_group_id} AND schedule_date = ${schedule_date}
    `);

    if (existing.rows.length > 0) {
      await db.execute(sql`
        UPDATE teacher_schedule_notes
        SET note_text = ${note_text ?? null},
            audio_file_url = ${audio_file_url ?? null},
            updated_at = NOW()
        WHERE teacher_id = ${teacherId}
        AND class_group_id = ${class_group_id}
        AND schedule_date = ${schedule_date}
      `);
      const updated = await db.execute(sql`
        SELECT * FROM teacher_schedule_notes
        WHERE teacher_id = ${teacherId} AND class_group_id = ${class_group_id} AND schedule_date = ${schedule_date}
      `);
      res.json(updated.rows[0]);
    } else {
      const id = `tsn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await db.execute(sql`
        INSERT INTO teacher_schedule_notes (id, teacher_id, class_group_id, swimming_pool_id, schedule_date, note_text, audio_file_url)
        VALUES (${id}, ${teacherId}, ${class_group_id}, ${poolId}, ${schedule_date}, ${note_text ?? null}, ${audio_file_url ?? null})
      `);
      const inserted = await db.execute(sql`SELECT * FROM teacher_schedule_notes WHERE id = ${id}`);
      res.status(201).json(inserted.rows[0]);
    }
  } catch (e: any) {
    console.error("[schedule-notes POST]", e);
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  POST /schedule-notes/audio
 *  음성 메모 파일 업로드 → Object Storage → URL 반환
 * ───────────────────────────────────────────────────────── */
router.post(
  "/schedule-notes/audio",
  requireAuth,
  requireRole("teacher", "pool_admin"),
  upload.single("audio"),
  async (req: AuthRequest, res) => {
    try {
      const file = (req as any).file;
      if (!file) { res.status(400).json({ error: "파일이 없습니다." }); return; }

      const teacherId = req.user!.userId;
      const ext = file.originalname.split(".").pop() || "m4a";
      const key = `audio/teacher_${teacherId}_${Date.now()}.${ext}`;
      const client = getClient();

      const { ok, error } = await client.uploadFromBytes(key, file.buffer, { contentType: file.mimetype || "audio/m4a" });
      if (!ok) { res.status(500).json({ error: error?.message || "업로드 실패" }); return; }

      res.json({ audio_file_url: key });
    } catch (e: any) {
      console.error("[schedule-notes/audio]", e);
      res.status(500).json({ error: e.message });
    }
  }
);

/** ─────────────────────────────────────────────────────────
 *  GET /schedule-notes/audio
 *  음성 파일 스트리밍 (?key=audio/teacher_xxx.m4a)
 * ───────────────────────────────────────────────────────── */
router.get("/schedule-notes/audio", requireAuth, async (req: AuthRequest, res) => {
  try {
    const key = req.query.key as string;
    if (!key) { res.status(400).json({ error: "key 파라미터 필요" }); return; }
    const client = getClient();
    const { ok, value: bytes, error } = await client.downloadAsBytes(key);
    if (!ok || !bytes) { res.status(404).json({ error: "파일 없음" }); return; }

    const ext = key.split(".").pop() || "m4a";
    const mimeMap: Record<string, string> = { m4a: "audio/m4a", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg" };
    res.setHeader("Content-Type", mimeMap[ext] || "audio/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(bytes));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  GET /daily-memos/dates
 *  해당 월에 일간 메모가 있는 날짜 + 타입 목록 반환
 *  Response: Array<{ date: string; has_text: boolean; has_audio: boolean }>
 * ───────────────────────────────────────────────────────── */
router.get("/daily-memos/dates", requireAuth, requireRole("teacher", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const user  = req.user!;
    const year  = parseInt(req.query.year  as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const monthStr  = String(month).padStart(2, "0");
    const prefix    = `${year}-${monthStr}`;

    const rows = await db.execute(sql`
      SELECT
        schedule_date                   AS date,
        (note_text IS NOT NULL AND note_text <> '') AS has_text,
        (audio_file_url IS NOT NULL)    AS has_audio
      FROM teacher_daily_memos
      WHERE teacher_id = ${user.userId}
        AND schedule_date LIKE ${prefix + "-%"}
    `);
    res.json(rows.rows);
  } catch (e: any) {
    console.error("[daily-memos/dates]", e);
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  GET /daily-memos?date=YYYY-MM-DD
 *  특정 날짜 일간 메모 단건 조회
 * ───────────────────────────────────────────────────────── */
router.get("/daily-memos", requireAuth, requireRole("teacher", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const date = req.query.date as string;
    if (!date) { res.status(400).json({ error: "date 파라미터 필요" }); return; }

    const rows = await db.execute(sql`
      SELECT * FROM teacher_daily_memos
      WHERE teacher_id = ${user.userId} AND schedule_date = ${date}
      LIMIT 1
    `);
    res.json(rows.rows[0] || null);
  } catch (e: any) {
    console.error("[daily-memos GET]", e);
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  POST /daily-memos
 *  일간 메모 upsert  { date, note_text, audio_file_url }
 * ───────────────────────────────────────────────────────── */
router.post("/daily-memos", requireAuth, requireRole("teacher", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const user      = req.user!;
    const { date, note_text, audio_file_url } = req.body as {
      date: string; note_text?: string | null; audio_file_url?: string | null;
    };
    if (!date) { res.status(400).json({ error: "date 필드 필요" }); return; }

    const existing = await db.execute(sql`
      SELECT id FROM teacher_daily_memos
      WHERE teacher_id = ${user.userId} AND schedule_date = ${date}
      LIMIT 1
    `);

    if (existing.rows.length > 0) {
      const updated = await db.execute(sql`
        UPDATE teacher_daily_memos
        SET note_text = ${note_text ?? null},
            audio_file_url = ${audio_file_url ?? null},
            updated_at = now()
        WHERE teacher_id = ${user.userId} AND schedule_date = ${date}
        RETURNING *
      `);
      res.json(updated.rows[0]);
    } else {
      const id = `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const inserted = await db.execute(sql`
        INSERT INTO teacher_daily_memos
          (id, teacher_id, swimming_pool_id, schedule_date, note_text, audio_file_url)
        VALUES (${id}, ${user.userId}, ${user.poolId || ""}, ${date}, ${note_text ?? null}, ${audio_file_url ?? null})
        RETURNING *
      `);
      res.json(inserted.rows[0]);
    }
  } catch (e: any) {
    console.error("[daily-memos POST]", e);
    res.status(500).json({ error: e.message });
  }
});

/** ─────────────────────────────────────────────────────────
 *  POST /daily-memos/audio
 *  일간 메모 음성 파일 업로드
 * ───────────────────────────────────────────────────────── */
router.post(
  "/daily-memos/audio",
  requireAuth,
  requireRole("teacher", "pool_admin"),
  upload.single("audio"),
  async (req: AuthRequest, res) => {
    try {
      const file = (req as any).file;
      if (!file) { res.status(400).json({ error: "파일이 없습니다." }); return; }

      const teacherId = req.user!.userId;
      const ext = file.originalname.split(".").pop() || "m4a";
      const key = `audio/daily_${teacherId}_${Date.now()}.${ext}`;
      const client = getClient();

      const { ok, error } = await client.uploadFromBytes(key, file.buffer, { contentType: file.mimetype || "audio/m4a" });
      if (!ok) { res.status(500).json({ error: error?.message || "업로드 실패" }); return; }

      res.json({ audio_file_url: key });
    } catch (e: any) {
      console.error("[daily-memos/audio]", e);
      res.status(500).json({ error: e.message });
    }
  }
);

/** ─────────────────────────────────────────────────────────
 *  GET /daily-memos/audio
 *  일간 메모 음성 파일 스트리밍 (?key=...)
 * ───────────────────────────────────────────────────────── */
router.get("/daily-memos/audio", requireAuth, async (req: AuthRequest, res) => {
  try {
    const key = req.query.key as string;
    if (!key) { res.status(400).json({ error: "key 파라미터 필요" }); return; }
    const client = getClient();
    const { ok, value: bytes, error } = await client.downloadAsBytes(key);
    if (!ok || !bytes) { res.status(404).json({ error: "파일 없음" }); return; }

    const ext = key.split(".").pop() || "m4a";
    const mimeMap: Record<string, string> = { m4a: "audio/m4a", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg" };
    res.setHeader("Content-Type", mimeMap[ext] || "audio/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(bytes));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
