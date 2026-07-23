/**
 * comments.ts — 일지 댓글 & 반응 API
 *
 * 학부모: 자기 스레드만 조회/작성
 * 선생님/pool_admin: 해당 일지 전체 스레드 조회 + 답글 작성
 *
 * backing store: diary_messages (기존 테이블 재사용)
 *   parent_comment_id IS NULL  → 학부모 원댓글
 *   parent_comment_id IS NOT NULL → 선생님/학부모 답글
 */
import { Router, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { sendPushToUser } from "../lib/push-service.js";

const router = Router();

// ── 권한 헬퍼 ──────────────────────────────────────────────────────────────

/** 학부모가 해당 학생과 연결되어 있는지 확인 */
async function parentOwnsStudent(parentId: string, studentId: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT id FROM parent_students
    WHERE parent_id = ${parentId} AND student_id = ${studentId} AND status = 'approved'
  `);
  return r.rows.length > 0;
}

/** 일지가 해당 학생에게 공개돼 있는지 확인 (학생이 그 반에 속했었는지) */
async function diaryVisibleToStudent(diaryId: string, studentId: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT cd.id FROM class_diaries cd
    JOIN student_class_history sch ON sch.class_group_id = cd.class_group_id
    WHERE cd.id = ${diaryId}
      AND cd.is_deleted = false
      AND sch.student_id = ${studentId}
      AND sch.enrolled_at <= cd.lesson_date::date
      AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
    LIMIT 1
  `);
  return r.rows.length > 0;
}

/** 선생님이 해당 일지를 담당하는지 확인 (pool 소속) */
async function teacherCanAccessDiary(userId: string, role: string, diaryId: string): Promise<boolean> {
  if (role === "super_admin" || role === "platform_admin") return true;
  // pool_admin/teacher: pool 소속 일지인지 확인
  const r = await db.execute(sql`
    SELECT cd.id FROM class_diaries cd
    JOIN class_groups cg ON cg.id = cd.class_group_id
    JOIN swimming_pools sp ON sp.id = cg.swimming_pool_id
    LEFT JOIN users u ON u.id = ${userId}
    WHERE cd.id = ${diaryId}
      AND cd.is_deleted = false
      AND (
        cg.teacher_user_id = ${userId}
        OR u.swimming_pool_id = cg.swimming_pool_id
      )
    LIMIT 1
  `);
  return r.rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /diaries/:diaryId/comments
// 학부모: 내 스레드만 (내 원댓글 + 그 원댓글에 달린 모든 답글)
// 선생님/pool_admin: 전체 스레드
// ─────────────────────────────────────────────────────────────────────────
router.get("/diaries/:diaryId/comments",
  requireAuth,
  requireRole("parent_account", "teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { diaryId } = req.params;
      const { userId, role } = req.user!;
      const isParent = role === "parent_account";

      // 일지 존재 확인
      const [diary] = (await db.execute(sql`
        SELECT id, lesson_date, teacher_name FROM class_diaries WHERE id = ${diaryId} AND is_deleted = false LIMIT 1
      `)).rows as any[];
      if (!diary) { res.status(404).json({ error: "일지를 찾을 수 없습니다." }); return; }

      // 선생님 권한 확인
      if (!isParent) {
        const ok = await teacherCanAccessDiary(userId, role, diaryId);
        if (!ok) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      if (isParent) {
        // 학부모: 내가 작성한 원댓글 목록
        const rootRows = (await db.execute(sql`
          SELECT dm.id, dm.content AS body, dm.sender_name AS author_name,
                 dm.sender_role AS author_role, dm.student_id,
                 dm.is_deleted, dm.created_at,
                 s.name AS student_name
          FROM diary_messages dm
          LEFT JOIN students s ON s.id = dm.student_id
          WHERE dm.diary_id = ${diaryId}
            AND dm.sender_id = ${userId}
            AND dm.parent_comment_id IS NULL
          ORDER BY dm.created_at ASC
        `)).rows as any[];

        // 각 원댓글의 모든 답글 로드
        const threads = await Promise.all(rootRows.map(async (root) => {
          const replies = (await db.execute(sql`
            SELECT dm.id, dm.content AS body, dm.sender_name AS author_name,
                   dm.sender_role AS author_role, dm.is_deleted, dm.created_at
            FROM diary_messages dm
            WHERE dm.parent_comment_id = ${root.id}
            ORDER BY dm.created_at ASC
          `)).rows as any[];
          return { ...root, replies: replies.map(r => ({ ...r, body: r.is_deleted ? "(삭제된 댓글입니다)" : r.body })) };
        }));

        // 선생님 읽음 처리
        await db.execute(sql`
          UPDATE diary_messages SET read_at = now()
          WHERE diary_id = ${diaryId} AND sender_role != 'parent' AND read_at IS NULL
            AND parent_comment_id IN (
              SELECT id FROM diary_messages WHERE diary_id = ${diaryId} AND sender_id = ${userId} AND parent_comment_id IS NULL
            )
        `).catch(() => {});

        res.json({ threads, diary: { id: diary.id, lesson_date: diary.lesson_date, teacher_name: diary.teacher_name } });
      } else {
        // 선생님/pool_admin: 전체 학부모 원댓글 (스레드 구조)
        const rootRows = (await db.execute(sql`
          SELECT dm.id, dm.content AS body, dm.sender_id AS author_user_id,
                 dm.sender_name AS author_name, dm.sender_role AS author_role,
                 dm.student_id, dm.is_deleted, dm.created_at,
                 s.name AS student_name,
                 pa.phone AS parent_phone,
                 COALESCE(dm.sender_name, pa.name, '보호자') AS display_name
          FROM diary_messages dm
          LEFT JOIN students s ON s.id = dm.student_id
          LEFT JOIN parent_accounts pa ON pa.id = dm.sender_id
          WHERE dm.diary_id = ${diaryId}
            AND dm.parent_comment_id IS NULL
          ORDER BY dm.created_at ASC
        `)).rows as any[];

        const threads = await Promise.all(rootRows.map(async (root) => {
          const replies = (await db.execute(sql`
            SELECT dm.id, dm.content AS body, dm.sender_name AS author_name,
                   dm.sender_role AS author_role, dm.is_deleted, dm.created_at
            FROM diary_messages dm
            WHERE dm.parent_comment_id = ${root.id}
            ORDER BY dm.created_at ASC
          `)).rows as any[];

          // 선생님: 읽지 않은 학부모 댓글 읽음 처리
          await db.execute(sql`
            UPDATE diary_messages SET read_at = now()
            WHERE id = ${root.id} AND sender_role = 'parent' AND read_at IS NULL
          `).catch(() => {});

          return {
            ...root,
            body: root.is_deleted ? "(삭제된 댓글입니다)" : root.body,
            replies: replies.map(r => ({ ...r, body: r.is_deleted ? "(삭제된 댓글입니다)" : r.body })),
          };
        }));

        // 반응 집계
        const reactionRows = (await db.execute(sql`
          SELECT reaction_type, COUNT(*)::int AS cnt, array_agg(parent_id) AS parent_ids
          FROM diary_reactions WHERE diary_id = ${diaryId}
          GROUP BY reaction_type
        `)).rows as any[];

        const reactions: Record<string, { count: number; users: any[] }> = {};
        for (const row of reactionRows) {
          // 각 parent_id의 이름 조회 (최대 10명)
          const limit = row.parent_ids?.slice(0, 10) ?? [];
          const users: any[] = [];
          for (const pid of limit) {
            const [u] = (await db.execute(sql`
              SELECT pa.name AS parent_name, ps.student_id,
                     s.name AS student_name
              FROM parent_accounts pa
              LEFT JOIN parent_students ps ON ps.parent_id = pa.id AND ps.status = 'approved'
              LEFT JOIN students s ON s.id = ps.student_id
              WHERE pa.id = ${pid}
              LIMIT 1
            `)).rows as any[];
            if (u) users.push({ parent_name: u.parent_name, student_name: u.student_name ?? "" });
          }
          reactions[row.reaction_type] = { count: Number(row.cnt), users };
        }

        const comment_count = rootRows.filter(r => !r.is_deleted).length;
        res.json({ threads, diary: { id: diary.id, lesson_date: diary.lesson_date, teacher_name: diary.teacher_name }, reactions, comment_count });
      }
    } catch (err) { console.error("[comments GET]", err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /diaries/:diaryId/comments — 학부모 원댓글 작성
// ─────────────────────────────────────────────────────────────────────────
router.post("/diaries/:diaryId/comments",
  requireAuth,
  requireRole("parent_account"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { diaryId } = req.params;
      const { userId } = req.user!;
      const { studentId, body } = req.body as { studentId: string; body: string };
      console.log(`[COMMENT CREATE START] diaryId=${diaryId} parentUserId=${userId} studentId=${studentId} bodyLen=${body?.length ?? 0}`);

      if (!studentId || !body?.trim()) {
        console.log(`[COMMENT CREATE ERROR] 400 missing studentId or body diaryId=${diaryId}`);
        res.status(400).json({ error: "studentId와 본문이 필요합니다." }); return;
      }
      if (body.trim().length > 1000) {
        res.status(400).json({ error: "댓글은 1,000자 이내로 작성하세요." }); return;
      }

      // 학부모-학생 연결 확인
      const linked = await parentOwnsStudent(userId, studentId);
      if (!linked) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

      // 일지가 학생에게 공개됐는지 확인
      const visible = await diaryVisibleToStudent(diaryId, studentId);
      if (!visible) { res.status(403).json({ error: "이 일지에 댓글을 작성할 수 없습니다." }); return; }

      // 학부모 이름 조회
      const [pa] = (await db.execute(sql`SELECT name FROM parent_accounts WHERE id = ${userId} LIMIT 1`)).rows as any[];
      const [st] = (await db.execute(sql`SELECT name FROM students WHERE id = ${studentId} LIMIT 1`)).rows as any[];
      const senderName = `${st?.name ?? "학생"} 보호자`;
      console.log(`[COMMENT CREATE INSERT] diaryId=${diaryId} senderName=${senderName} senderRole=parent student=${st?.name ?? "?"}`);

      const id = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await db.execute(sql`
        INSERT INTO diary_messages (id, diary_id, sender_id, sender_name, sender_role, content, student_id, message_type)
        VALUES (${id}, ${diaryId}, ${userId}, ${senderName}, 'parent', ${body.trim()}, ${studentId}, 'diary_comment')
      `);
      console.log(`[COMMENT CREATE SUCCESS] diaryId=${diaryId} commentId=${id}`);

      // 선생님에게 푸시 알림
      const [d] = (await db.execute(sql`
        SELECT teacher_id, lesson_date FROM class_diaries WHERE id = ${diaryId} LIMIT 1
      `)).rows as any[];
      if (d?.teacher_id) {
        const lessonDate = d.lesson_date?.slice(0, 10) ?? "";
        sendPushToUser(
          d.teacher_id, false, "diary_comment",
          "새 댓글",
          `${senderName}이(가) ${lessonDate} 일지에 댓글을 남겼습니다.`,
          { type: "diary_comment", diaryId, commentId: id },
        ).catch(() => {});
      }

      res.status(201).json({
        id, body: body.trim(), author_name: senderName, author_role: "parent",
        student_id: studentId, student_name: st?.name ?? "", created_at: new Date().toISOString(),
        replies: [],
      });
    } catch (err: any) {
      const cause = err?.cause as any;
      console.error(`[COMMENT CREATE ERROR] diaryId=${req.params.diaryId} httpCode=${cause?.code ?? err?.code ?? "?"} constraint=${cause?.constraint ?? ""} detail=${cause?.detail ?? err?.message ?? String(err)}`);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// POST /diary-comments/:commentId/replies — 선생님 또는 학부모 답글
// ─────────────────────────────────────────────────────────────────────────
router.post("/diary-comments/:commentId/replies",
  requireAuth,
  requireRole("parent_account", "teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { commentId } = req.params;
      const { userId, role } = req.user!;
      const { body } = req.body as { body: string };

      if (!body?.trim()) { res.status(400).json({ error: "본문이 필요합니다." }); return; }
      if (body.trim().length > 1000) { res.status(400).json({ error: "답글은 1,000자 이내로 작성하세요." }); return; }

      // 원댓글 조회
      const [root] = (await db.execute(sql`
        SELECT dm.id, dm.diary_id, dm.sender_id, dm.student_id, dm.parent_comment_id,
               cd.teacher_id, cd.lesson_date
        FROM diary_messages dm
        JOIN class_diaries cd ON cd.id = dm.diary_id
        WHERE dm.id = ${commentId} AND dm.is_deleted = false
        LIMIT 1
      `)).rows as any[];
      if (!root) { res.status(404).json({ error: "댓글을 찾을 수 없습니다." }); return; }

      // 대댓글은 1단계만 — 이미 답글이면 원댓글의 id를 threadRoot로 사용
      const threadRoot = root.parent_comment_id ?? root.id;

      const isParent = role === "parent_account";
      console.log(`[REPLY CREATE START] commentId=${commentId} diaryId=${root.diary_id} userId=${userId} role=${role} isParent=${isParent}`);

      // 학부모라면 본인 스레드에만 답글 허용
      if (isParent && root.sender_id !== userId) {
        res.status(403).json({ error: "자신의 댓글에만 답글을 작성할 수 있습니다." }); return;
      }

      // 발신자 이름
      let senderName: string;
      let senderRole = isParent ? "parent" : "teacher";
      if (isParent) {
        const [st] = (await db.execute(sql`SELECT name FROM students WHERE id = ${root.student_id} LIMIT 1`)).rows as any[];
        senderName = `${st?.name ?? "학생"} 보호자`;
      } else {
        const [u] = (await db.execute(sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`)).rows as any[];
        senderName = `${u?.name ?? "선생님"} 선생님`;
      }

      const id = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      console.log(`[REPLY CREATE INSERT] commentId=${commentId} diaryId=${root.diary_id} senderName=${senderName} senderRole=${senderRole} replyId=${id}`);
      await db.execute(sql`
        INSERT INTO diary_messages (id, diary_id, sender_id, sender_name, sender_role, content, student_id, parent_comment_id, message_type)
        VALUES (${id}, ${root.diary_id}, ${userId}, ${senderName}, ${senderRole}, ${body.trim()}, ${root.student_id}, ${threadRoot}, 'diary_comment')
      `);
      console.log(`[REPLY CREATE SUCCESS] replyId=${id} senderRole=${senderRole}`);

      // 알림
      if (!isParent && root.sender_id) {
        const lessonDate = root.lesson_date?.slice(0, 10) ?? "";
        sendPushToUser(
          root.sender_id, true, "diary_comment_reply",
          "선생님 답글",
          `${senderName}이(가) ${lessonDate} 일지 댓글에 답변했습니다.`,
          { type: "diary_comment_reply", diaryId: root.diary_id, commentId: id },
        ).catch(() => {});
      }

      res.status(201).json({
        id, body: body.trim(), author_name: senderName, author_role: senderRole,
        created_at: new Date().toISOString(),
      });
    } catch (err: any) {
      const cause = err?.cause as any;
      console.error(`[REPLY CREATE ERROR] commentId=${req.params.commentId} httpCode=${cause?.code ?? err?.code ?? "?"} constraint=${cause?.constraint ?? ""} detail=${cause?.detail ?? err?.message ?? String(err)}`);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// DELETE /diary-comments/:commentId — soft delete
// ─────────────────────────────────────────────────────────────────────────
router.delete("/diary-comments/:commentId",
  requireAuth,
  requireRole("parent_account", "teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { commentId } = req.params;
      const { userId, role } = req.user!;

      const [msg] = (await db.execute(sql`
        SELECT id, sender_id FROM diary_messages WHERE id = ${commentId} LIMIT 1
      `)).rows as any[];
      if (!msg) { res.status(404).json({ error: "댓글을 찾을 수 없습니다." }); return; }

      if (role === "parent_account" && msg.sender_id !== userId) {
        res.status(403).json({ error: "자신의 댓글만 삭제할 수 있습니다." }); return;
      }

      await db.execute(sql`
        UPDATE diary_messages SET is_deleted = true, deleted_at = now() WHERE id = ${commentId}
      `);
      res.json({ success: true });
    } catch (err) { console.error("[comments DELETE]", err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// GET /diaries/:diaryId/reactions/summary — 선생님용 반응 요약
// ─────────────────────────────────────────────────────────────────────────
router.get("/diaries/:diaryId/reactions/summary",
  requireAuth,
  requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { diaryId } = req.params;
      const { userId, role } = req.user!;

      const ok = await teacherCanAccessDiary(userId, role, diaryId);
      if (!ok) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

      const rows = (await db.execute(sql`
        SELECT dr.reaction_type, pa.name AS parent_name,
               ps.student_id, s.name AS student_name
        FROM diary_reactions dr
        LEFT JOIN parent_accounts pa ON pa.id = dr.parent_id
        LEFT JOIN parent_students ps ON ps.parent_id = dr.parent_id AND ps.status = 'approved'
        LEFT JOIN students s ON s.id = ps.student_id
        WHERE dr.diary_id = ${diaryId}
        ORDER BY dr.created_at ASC
      `)).rows as any[];

      const like_users: any[] = [];
      const thank_users: any[] = [];
      for (const r of rows) {
        const entry = { parent_name: r.parent_name ?? "보호자", student_name: r.student_name ?? "" };
        if (r.reaction_type === "like") like_users.push(entry);
        if (r.reaction_type === "thanks") thank_users.push(entry);
      }

      const [cnt] = (await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM diary_messages
        WHERE diary_id = ${diaryId} AND is_deleted = false AND parent_comment_id IS NULL
      `)).rows as any[];

      res.json({
        like: { count: like_users.length, users: like_users },
        thank: { count: thank_users.length, users: thank_users },
        comment_count: Number(cnt?.cnt ?? 0),
      });
    } catch (err) { console.error("[reactions summary]", err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ─────────────────────────────────────────────────────────────────────────
// GET /diaries/:diaryId/comment-count — 일지별 댓글/반응 수 (목록용)
// ─────────────────────────────────────────────────────────────────────────
router.get("/diaries/:diaryId/comment-count",
  requireAuth,
  requireRole("teacher", "pool_admin", "super_admin", "parent_account"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { diaryId } = req.params;
      const { userId, role } = req.user!;
      const isParent = role === "parent_account";

      let comment_count = 0;
      let like_count = 0;
      let thank_count = 0;

      if (isParent) {
        const [c] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM diary_messages
          WHERE diary_id = ${diaryId} AND sender_id = ${userId} AND is_deleted = false AND parent_comment_id IS NULL
        `)).rows as any[];
        comment_count = Number(c?.cnt ?? 0);

        const [myR] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM diary_reactions
          WHERE diary_id = ${diaryId} AND parent_id = ${userId}
        `)).rows as any[];
      } else {
        const [c] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM diary_messages
          WHERE diary_id = ${diaryId} AND is_deleted = false AND parent_comment_id IS NULL
        `)).rows as any[];
        comment_count = Number(c?.cnt ?? 0);

        const rRows = (await db.execute(sql`
          SELECT reaction_type, COUNT(*)::int AS cnt FROM diary_reactions
          WHERE diary_id = ${diaryId} GROUP BY reaction_type
        `)).rows as any[];
        for (const r of rRows) {
          if (r.reaction_type === "like") like_count = Number(r.cnt);
          if (r.reaction_type === "thanks") thank_count = Number(r.cnt);
        }
      }

      res.json({ comment_count, like_count, thank_count });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

export default router;
