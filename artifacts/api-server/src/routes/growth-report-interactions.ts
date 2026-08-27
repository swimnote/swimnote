/**
 * growth-report-interactions.ts — Growth Report 좋아요·댓글 API
 *
 * Routes:
 *   GET    /parent/growth-reports/:reportId/reactions               — 내 like 상태
 *   POST   /parent/growth-reports/:reportId/reactions               — like toggle
 *   GET    /parent/growth-reports/:reportId/comments                — 댓글 목록
 *   POST   /parent/growth-reports/:reportId/comments                — 댓글 작성
 *   DELETE /growth-report-comments/:commentId                       — 댓글 soft delete (본인만)
 *   POST   /growth-report-comments/:commentId/replies               — teacher reply
 *   GET    /teacher/growth-reports/:reportId/interactions           — teacher 조회
 *
 * 원칙:
 *   - 기존 diary_reactions / diary_messages / parent.ts / comments.ts 무수정
 *   - teacher resolve: students.current_class_id → class_groups.teacher_user_id (pool 검증 포함)
 *   - teacher_reviewed_by 사용 금지
 *   - recipient 없으면 notification/push 생략, interaction 저장은 정상
 *   - sender_id / sender_name / sender_role / student_id 는 서버에서 결정 (클라이언트 신뢰 금지)
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { sendPushToUser } from "../lib/push-service.js";

const router = Router();
const db = superAdminDb;

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────────

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function requireParent(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "parent_account") {
    res.status(403).json({ error: "학부모 계정만 접근 가능합니다." });
    return;
  }
  next();
}

/**
 * Growth Report 접근 검증 (Parent용)
 * - product_status = 'PUBLISHED' AND deleted_at IS NULL
 * - parent_students approved 관계 (parent ↔ report.student_id)
 * @returns report row | null (null이면 이미 응답 전송됨)
 */
async function resolveParentReportAccess(
  req: AuthRequest,
  res: any,
  reportId: string,
): Promise<{ id: string; student_id: string; swimming_pool_id: string } | null> {
  const parentId = req.user!.userId;

  // 1. report 존재 + PUBLISHED + not deleted
  const reportRes = await db.execute(sql`
    SELECT id, student_id, swimming_pool_id
    FROM growth_reports
    WHERE id = ${reportId}
      AND product_status = 'PUBLISHED'
      AND deleted_at IS NULL
    LIMIT 1
  `);
  const report = reportRes.rows[0] as any;
  if (!report) {
    res.status(404).json({ error: "리포트를 찾을 수 없습니다." });
    return null;
  }

  // 2. parent ↔ student approved 관계
  const linkRes = await db.execute(sql`
    SELECT id FROM parent_students
    WHERE parent_id = ${parentId}
      AND student_id = ${report.student_id}
      AND status = 'approved'
    LIMIT 1
  `);
  if (linkRes.rows.length === 0) {
    res.status(403).json({ error: "해당 리포트에 접근 권한이 없습니다." });
    return null;
  }

  return report as { id: string; student_id: string; swimming_pool_id: string };
}

/**
 * 담당선생님 resolve
 * student_id → students.current_class_id → class_groups.teacher_user_id
 * pool 검증 포함 (report.swimming_pool_id 와 동일한 pool인지)
 * recipient 없으면 null 반환 (임의 fallback 금지)
 */
async function resolveTeacherByStudent(
  studentId: string,
  poolId: string,
): Promise<{ teacher_id: string; swimming_pool_id: string } | null> {
  const res = await db.execute(sql`
    SELECT cg.teacher_user_id AS teacher_id, cg.swimming_pool_id
    FROM students s
    JOIN class_groups cg ON cg.id = s.class_group_id
    WHERE s.id = ${studentId}
      AND s.swimming_pool_id = ${poolId}
      AND cg.teacher_user_id IS NOT NULL
    LIMIT 1
  `);
  const row = res.rows[0] as any;
  if (!row || !row.teacher_id) return null;
  return { teacher_id: row.teacher_id, swimming_pool_id: row.swimming_pool_id };
}

// ── 1. GET /parent/growth-reports/:reportId/reactions ─────────────────────────

router.get(
  "/parent/growth-reports/:reportId/reactions",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    try {
      const { reportId } = req.params;
      const parentId = req.user!.userId;

      const report = await resolveParentReportAccess(req, res, reportId);
      if (!report) return;

      const likeRes = await db.execute(sql`
        SELECT reaction_type FROM growth_report_reactions
        WHERE growth_report_id = ${reportId}
          AND parent_id = ${parentId}
      `);
      const myReactions = (likeRes.rows as any[]).map((r) => r.reaction_type);

      res.json({ myReactions });
    } catch (e: any) {
      console.error("[gr-reactions] GET 오류:", e.message);
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

// ── 2. POST /parent/growth-reports/:reportId/reactions ────────────────────────

router.post(
  "/parent/growth-reports/:reportId/reactions",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    try {
      const { reportId } = req.params;
      const parentId = req.user!.userId;
      const { reaction_type } = req.body;

      if (!reaction_type || reaction_type !== "like") {
        res.status(400).json({ error: "reaction_type은 'like'만 허용됩니다." });
        return;
      }

      const report = await resolveParentReportAccess(req, res, reportId);
      if (!report) return;

      // 현재 like 존재 여부 확인
      const existRes = await db.execute(sql`
        SELECT id FROM growth_report_reactions
        WHERE growth_report_id = ${reportId}
          AND parent_id = ${parentId}
          AND reaction_type = ${reaction_type}
        LIMIT 1
      `);
      const existing = existRes.rows[0] as any;

      if (existing) {
        // unlike: DELETE
        await db.execute(sql`
          DELETE FROM growth_report_reactions
          WHERE growth_report_id = ${reportId}
            AND parent_id = ${parentId}
            AND reaction_type = ${reaction_type}
        `);
        res.json({ active: false });
        return;
      }

      // like: INSERT (UNIQUE constraint가 race condition 방어)
      await db.execute(sql`
        INSERT INTO growth_report_reactions (id, growth_report_id, parent_id, reaction_type)
        VALUES (${genId("grr")}, ${reportId}, ${parentId}, ${reaction_type})
        ON CONFLICT (growth_report_id, parent_id, reaction_type) DO NOTHING
      `);

      res.json({ active: true });

      // 담당선생님 resolve + notification (비동기, non-blocking)
      ;(async () => {
        const teacher = await resolveTeacherByStudent(report.student_id, report.swimming_pool_id);
        if (!teacher) {
          console.log(`[gr-reactions] recipient_not_found: reportId=${reportId} studentId=${report.student_id}`);
          return;
        }

        // parent 이름 조회
        const pRes = await db.execute(sql`
          SELECT name FROM parent_accounts WHERE id = ${parentId} LIMIT 1
        `);
        const parentName = (pRes.rows[0] as any)?.name ?? "학부모";

        const bodyText = `${parentName}님이 AI 성장 리포트에 좋아요를 눌렀습니다.`;
        const notifId = genId("notif_grl");

        await db.execute(sql`
          INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
          VALUES (${notifId}, ${teacher.teacher_id}, 'user', 'growth_report_like',
            '새 좋아요', ${bodyText}, ${reportId}, 'growth_report', ${report.swimming_pool_id}, false)
          ON CONFLICT DO NOTHING
        `);

        sendPushToUser(
          teacher.teacher_id, false, "growth_report_like",
          "새 좋아요", bodyText,
          { type: "growth_report_like", reportId },
        ).catch(() => {});
      })().catch((e) => console.error("[gr-reactions] notification 오류:", e.message));
    } catch (e: any) {
      console.error("[gr-reactions] POST 오류:", e.message);
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

// ── 3. GET /parent/growth-reports/:reportId/comments ──────────────────────────

router.get(
  "/parent/growth-reports/:reportId/comments",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    try {
      const { reportId } = req.params;
      const parentId = req.user!.userId;

      const report = await resolveParentReportAccess(req, res, reportId);
      if (!report) return;

      // Root comments (본인 작성 기준 — diary 동일 패턴)
      const rootRes = await db.execute(sql`
        SELECT grc.id, grc.content AS body, grc.sender_name AS author_name,
               grc.sender_role AS author_role, grc.student_id,
               grc.is_deleted, grc.created_at,
               s.name AS student_name
        FROM growth_report_comments grc
        LEFT JOIN students s ON s.id = grc.student_id
        WHERE grc.growth_report_id = ${reportId}
          AND grc.sender_id = ${parentId}
          AND grc.parent_comment_id IS NULL
        ORDER BY grc.created_at ASC
      `);
      const roots = rootRes.rows as any[];

      const threads = await Promise.all(
        roots.map(async (root) => {
          const replyRes = await db.execute(sql`
            SELECT grc.id, grc.content AS body, grc.sender_name AS author_name,
                   grc.sender_role AS author_role, grc.is_deleted, grc.created_at
            FROM growth_report_comments grc
            WHERE grc.parent_comment_id = ${root.id}
            ORDER BY grc.created_at ASC
          `);
          const replies = (replyRes.rows as any[]).map((r) => ({
            ...r,
            body: r.is_deleted ? "(삭제된 댓글입니다)" : r.body,
          }));
          return {
            ...root,
            body: root.is_deleted ? "(삭제된 댓글입니다)" : root.body,
            replies,
          };
        }),
      );

      res.json({ threads });
    } catch (e: any) {
      console.error("[gr-comments] GET 오류:", e.message);
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

// ── 4. POST /parent/growth-reports/:reportId/comments ─────────────────────────

router.post(
  "/parent/growth-reports/:reportId/comments",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    try {
      const { reportId } = req.params;
      const parentId = req.user!.userId;
      const { body: content } = req.body;

      // 입력 검증
      if (!content || typeof content !== "string") {
        res.status(400).json({ error: "댓글 내용을 입력해주세요." });
        return;
      }
      const trimmed = content.trim();
      if (!trimmed) {
        res.status(400).json({ error: "댓글 내용을 입력해주세요." });
        return;
      }
      if (trimmed.length > 1000) {
        res.status(400).json({ error: "댓글은 최대 1000자까지 입력 가능합니다." });
        return;
      }

      const report = await resolveParentReportAccess(req, res, reportId);
      if (!report) return;

      // sender 정보 서버 결정
      const pRes = await db.execute(sql`
        SELECT name FROM parent_accounts WHERE id = ${parentId} LIMIT 1
      `);
      const senderName = (pRes.rows[0] as any)?.name ?? "학부모";

      const commentId = genId("grc");
      await db.execute(sql`
        INSERT INTO growth_report_comments
          (id, growth_report_id, sender_id, sender_name, sender_role, content, student_id)
        VALUES (${commentId}, ${reportId}, ${parentId}, ${senderName}, 'parent', ${trimmed}, ${report.student_id})
      `);

      const newComment = {
        id: commentId,
        body: trimmed,
        author_name: senderName,
        author_role: "parent",
        student_id: report.student_id,
        is_deleted: false,
        created_at: new Date().toISOString(),
        replies: [],
      };
      res.json({ comment: newComment });

      // 담당선생님 resolve + notification (비동기)
      ;(async () => {
        const teacher = await resolveTeacherByStudent(report.student_id, report.swimming_pool_id);
        if (!teacher) {
          console.log(`[gr-comments] recipient_not_found: reportId=${reportId} studentId=${report.student_id}`);
          return;
        }

        const pushBody = `${senderName}님이 AI 성장 리포트에 댓글을 남겼습니다.`;
        const newsId = genId("notif_grc");

        await db.execute(sql`
          INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
          VALUES (${newsId}, ${teacher.teacher_id}, 'user', 'growth_report_comment',
            '새 댓글', ${pushBody}, ${reportId}, 'growth_report', ${report.swimming_pool_id}, false)
          ON CONFLICT DO NOTHING
        `);

        sendPushToUser(
          teacher.teacher_id, false, "growth_report_comment",
          "새 댓글", pushBody,
          { type: "growth_report_comment", reportId, commentId },
        ).catch(() => {});
      })().catch((e) => console.error("[gr-comments] notification 오류:", e.message));
    } catch (e: any) {
      console.error("[gr-comments] POST 오류:", e.message);
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

// ── 5. DELETE /growth-report-comments/:commentId ──────────────────────────────

router.delete(
  "/growth-report-comments/:commentId",
  requireAuth,
  requireParent,
  async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      const parentId = req.user!.userId;

      // 존재 + 본인 확인
      const cRes = await db.execute(sql`
        SELECT id, sender_id, parent_comment_id, is_deleted
        FROM growth_report_comments
        WHERE id = ${commentId}
        LIMIT 1
      `);
      const comment = cRes.rows[0] as any;
      if (!comment) {
        res.status(404).json({ error: "댓글을 찾을 수 없습니다." });
        return;
      }
      if (comment.sender_id !== parentId) {
        res.status(403).json({ error: "본인 댓글만 삭제할 수 있습니다." });
        return;
      }
      if (comment.is_deleted) {
        res.json({ ok: true });
        return;
      }

      await db.execute(sql`
        UPDATE growth_report_comments
        SET is_deleted = true, deleted_at = now()
        WHERE id = ${commentId}
      `);

      res.json({ ok: true });
    } catch (e: any) {
      console.error("[gr-comments] DELETE 오류:", e.message);
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

// ── 6. POST /growth-report-comments/:commentId/replies (teacher) ──────────────

router.post(
  "/growth-report-comments/:commentId/replies",
  requireAuth,
  requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { commentId } = req.params;
      const senderId = req.user!.userId;
      const { body: content } = req.body;

      if (!content || typeof content !== "string" || !content.trim()) {
        res.status(400).json({ error: "답글 내용을 입력해주세요." });
        return;
      }
      const trimmed = content.trim();
      if (trimmed.length > 1000) {
        res.status(400).json({ error: "답글은 최대 1000자까지 입력 가능합니다." });
        return;
      }

      // root comment 존재 확인 (parent_comment_id IS NULL — reply에 reply 불가)
      // 다른 report의 comment를 parent_comment_id로 사용하는 것을 차단하기 위해 report pool도 검증
      const rootRes = await db.execute(sql`
        SELECT grc.id, grc.sender_id AS parent_sender_id, grc.growth_report_id,
               gr.swimming_pool_id, gr.student_id AS growth_report_student_id
        FROM growth_report_comments grc
        JOIN growth_reports gr ON gr.id = grc.growth_report_id
        WHERE grc.id = ${commentId}
          AND grc.parent_comment_id IS NULL
        LIMIT 1
      `);
      const root = rootRes.rows[0] as any;
      if (!root) {
        res.status(404).json({ error: "원본 댓글을 찾을 수 없습니다." });
        return;
      }

      // pool 권한 확인 + teacher는 담당선생님 본인 여부 검증
      if (req.user!.role !== "super_admin") {
        const userRes = await db.execute(sql`
          SELECT swimming_pool_id FROM users WHERE id = ${senderId} LIMIT 1
        `);
        const userPool = (userRes.rows[0] as any)?.swimming_pool_id;
        if (userPool !== root.swimming_pool_id) {
          res.status(403).json({ error: "해당 리포트에 접근 권한이 없습니다." });
          return;
        }
        // teacher role이면 반드시 담당선생님 본인이어야 함
        if (req.user!.role === "teacher") {
          const responsible = await resolveTeacherByStudent(
            root.growth_report_student_id ?? "",
            root.swimming_pool_id,
          );
          if (!responsible || responsible.teacher_id !== senderId) {
            res.status(403).json({ error: "담당 선생님만 답글을 작성할 수 있습니다." });
            return;
          }
        }
      }

      // teacher 이름 서버 결정
      const teacherRes = await db.execute(sql`
        SELECT name FROM users WHERE id = ${senderId} LIMIT 1
      `);
      const senderName = (teacherRes.rows[0] as any)?.name ?? "선생님";

      const replyId = genId("grc");
      await db.execute(sql`
        INSERT INTO growth_report_comments
          (id, growth_report_id, sender_id, sender_name, sender_role, content, parent_comment_id, student_id)
        VALUES (${replyId}, ${root.growth_report_id}, ${senderId}, ${senderName}, 'teacher',
                ${trimmed}, ${commentId}, null)
      `);

      const reply = {
        id: replyId,
        body: trimmed,
        author_name: senderName,
        author_role: "teacher",
        is_deleted: false,
        created_at: new Date().toISOString(),
      };
      res.json({ reply });

      // parent에게 push only (notifications INSERT 없음 — diary reply 동일 패턴)
      sendPushToUser(
        root.parent_sender_id, true, "growth_report_comment_reply",
        "선생님 답글",
        `${senderName}이(가) 성장리포트 댓글에 답변했습니다.`,
        { type: "growth_report_comment_reply", reportId: root.growth_report_id, commentId },
      ).catch(() => {});
    } catch (e: any) {
      console.error("[gr-comments] reply POST 오류:", e.message);
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

// ── 7. GET /teacher/growth-reports/:reportId/interactions ─────────────────────

router.get(
  "/teacher/growth-reports/:reportId/interactions",
  requireAuth,
  requireRole("teacher", "pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { reportId } = req.params;
      const userId = req.user!.userId;

      // report 존재 확인 (published 여부 무관 — teacher는 review 중에도 조회 가능)
      const rptRes = await db.execute(sql`
        SELECT id, student_id, swimming_pool_id
        FROM growth_reports
        WHERE id = ${reportId}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const report = rptRes.rows[0] as any;
      if (!report) {
        res.status(404).json({ error: "리포트를 찾을 수 없습니다." });
        return;
      }

      // pool 권한 검증 + teacher는 담당선생님 본인 여부 검증 (super_admin 제외)
      if (req.user!.role !== "super_admin") {
        const userRes = await db.execute(sql`
          SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
        `);
        const userPool = (userRes.rows[0] as any)?.swimming_pool_id;
        if (userPool !== report.swimming_pool_id) {
          res.status(403).json({ error: "해당 리포트에 접근 권한이 없습니다." });
          return;
        }
        // teacher role이면 반드시 담당선생님 본인이어야 함
        if (req.user!.role === "teacher") {
          const responsible = await resolveTeacherByStudent(report.student_id, report.swimming_pool_id);
          if (!responsible || responsible.teacher_id !== userId) {
            res.status(403).json({ error: "담당 선생님만 조회할 수 있습니다." });
            return;
          }
        }
      }

      // 좋아요 학부모 목록
      const likeRes = await db.execute(sql`
        SELECT grr.parent_id, pa.name AS parent_name, grr.created_at
        FROM growth_report_reactions grr
        LEFT JOIN parent_accounts pa ON pa.id = grr.parent_id
        WHERE grr.growth_report_id = ${reportId}
          AND grr.reaction_type = 'like'
        ORDER BY grr.created_at ASC
      `);
      const likes = likeRes.rows as any[];

      // 댓글 thread (teacher 전체 조회 — 모든 parent 댓글)
      const rootRes = await db.execute(sql`
        SELECT grc.id, grc.content AS body, grc.sender_id AS author_user_id,
               grc.sender_name AS author_name, grc.sender_role AS author_role,
               grc.student_id, grc.is_deleted, grc.created_at,
               s.name AS student_name,
               pa.name AS display_name
        FROM growth_report_comments grc
        LEFT JOIN students s ON s.id = grc.student_id
        LEFT JOIN parent_accounts pa ON pa.id = grc.sender_id
        WHERE grc.growth_report_id = ${reportId}
          AND grc.parent_comment_id IS NULL
        ORDER BY grc.created_at ASC
      `);
      const roots = rootRes.rows as any[];

      const threads = await Promise.all(
        roots.map(async (root) => {
          const replyRes = await db.execute(sql`
            SELECT grc.id, grc.content AS body, grc.sender_name AS author_name,
                   grc.sender_role AS author_role, grc.is_deleted, grc.created_at
            FROM growth_report_comments grc
            WHERE grc.parent_comment_id = ${root.id}
            ORDER BY grc.created_at ASC
          `);
          const replies = (replyRes.rows as any[]).map((r) => ({
            ...r,
            body: r.is_deleted ? "(삭제된 댓글입니다)" : r.body,
          }));
          return {
            ...root,
            body: root.is_deleted ? "(삭제된 댓글입니다)" : root.body,
            replies,
          };
        }),
      );

      res.json({
        reactions: { like: { count: likes.length, parents: likes } },
        threads,
      });
    } catch (e: any) {
      console.error("[gr-interactions] teacher GET 오류:", e.message);
      res.status(500).json({ error: "서버 오류" });
    }
  },
);

export default router;
