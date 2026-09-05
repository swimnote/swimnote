import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { noticesTable, usersTable, studentsTable } from "@workspace/db/schema";
import { eq, and, ne, or, isNull, lte, gte, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import {
  sendPushToPoolParents, sendPushToClassParents,
  sendPushToPoolAdmins, sendPushToPoolTeachers,
  sendPushToAllUsers,
  enqueueFanoutJob,
} from "../lib/push-service.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";

const router = Router();

const SUPER_ROLES = ["super_admin", "platform_admin", "super_manager"] as const;
type Role = string;

function isSuperRole(role: Role): boolean {
  return (SUPER_ROLES as readonly string[]).includes(role);
}

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

/** Returns true if the notice is currently active (starts_at/ends_at window). */
function isNoticeActive(notice: { starts_at?: Date | null; ends_at?: Date | null }): boolean {
  const now = new Date();
  if (notice.starts_at && notice.starts_at > now) return false;
  if (notice.ends_at   && notice.ends_at   < now) return false;
  return true;
}

// ── GET /notices ──────────────────────────────────────────────────────────────
// 공지 목록 조회:
//  - super_admin: pool_id 파라미터로 수영장별 조회 OR audience_scope=global 필터
//  - pool_admin/sub_admin/teacher: 전체 공지(global) + 소속 수영장 공지(pool) 모두 반환
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const scopeFilter = req.query.scope as string | undefined; // 'global' | 'pool' | undefined(전체)

    if (isSuperRole(role)) {
      // 슈퍼관리자: scope=global → 전체 공지만, pool_id 있으면 해당 풀만, 없으면 전체
      const poolId = (req.query.pool_id as string) || null;

      let whereClause: any;
      if (scopeFilter === "global") {
        whereClause = and(
          eq(noticesTable.audience_scope, "global"),
          ne(noticesTable.status, "deleted"),
        );
      } else if (poolId) {
        whereClause = and(
          eq(noticesTable.swimming_pool_id, poolId),
          eq(noticesTable.audience_scope, "pool"),
          ne(noticesTable.status, "deleted"),
        );
      } else {
        // 전체 (global + pool 모두)
        whereClause = ne(noticesTable.status, "deleted");
      }

      // WP8: add LIMIT (notices dataset is admin-managed, bounded in practice)
    const notices = await db.select().from(noticesTable).where(whereClause).limit(200);
      return res.json(sortNotices(notices));
    }

    // pool 역할 (pool_admin, sub_admin, teacher): 전체 공지 + 소속 수영장 공지
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const notices = await db.select().from(noticesTable).where(
      and(
        ne(noticesTable.status, "deleted"),
        or(
          eq(noticesTable.audience_scope, "global"),
          and(
            eq(noticesTable.audience_scope, "pool"),
            eq(noticesTable.swimming_pool_id, poolId),
          ),
        ),
      )
    ).limit(200);
    return res.json(sortNotices(notices));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

function sortNotices(notices: any[]) {
  return notices.sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// ── POST /notices ─────────────────────────────────────────────────────────────
// 공지 등록
//  - audience_scope='global': 전체 공지 (swimming_pool_id 불필요)
//  - audience_scope='pool': 수영장별 공지 (swimming_pool_id 필수)
//  - send_push: true 이면 WP5 durable fan-out enqueue
//  - show_banner: true 이면 Banner 대상
//  - target_roles: ['ADMIN','TEACHER','PARENT'] 타겟 역할
//  - target_pools: 수영장 ID 배열 또는 null(전체)
//  - starts_at / ends_at: 노출 기간 (nullable)
//  - deep_link: 딥링크 URL (nullable)
router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const {
    title, content, is_pinned, notice_type, student_id, image_urls,
    pool_id: bodyPoolId,
    audience_scope: rawScope,
    // WP4 new fields
    show_banner   = false,
    send_push     = true,   // backward-compat: existing callers expect push to be sent
    target_roles  = null,
    target_pools  = null,
    starts_at     = null,
    ends_at       = null,
    deep_link     = null,
    target_plan_types = null,
  } = req.body;
  if (!title || !content) return err(res, 400, "제목과 내용을 입력해주세요.");

  const scope: "global" | "pool" = rawScope === "global" ? "global" : "pool";
  const imgs: string[] = Array.isArray(image_urls) ? image_urls.slice(0, 5) : [];
  const role = req.user!.role;

  // Validate target_roles
  const VALID_ROLES = ["ADMIN", "TEACHER", "PARENT"];
  const parsedTargetRoles: string[] | null = Array.isArray(target_roles)
    ? target_roles.filter((r: string) => VALID_ROLES.includes(r))
    : null;

  // Pool Admin authorization: cannot target other pools
  const parsedTargetPools: string[] | null = (() => {
    if (!Array.isArray(target_pools) || !target_pools.length) return null;
    return target_pools;
  })();

  try {
    let poolId: string | null = null;

    if (scope === "pool") {
      if (isSuperRole(role)) {
        poolId = bodyPoolId || null;
        if (!poolId) return err(res, 400, "수영장별 공지에는 pool_id가 필요합니다.");
      } else {
        // pool_admin: only their own pool
        poolId = await getPoolId(req.user!.userId);
        if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

        // Pool Admin cross-pool target guard
        if (parsedTargetPools && parsedTargetPools.some((p: string) => p !== poolId)) {
          return err(res, 403, "자기 수영장만 공지 대상으로 설정할 수 있습니다.");
        }
      }
    }
    // global이면 poolId = null

    const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);

    // 개인 공지 (수영장별만 허용)
    let studentName: string | null = null;
    if (scope === "pool" && notice_type === "individual" && student_id) {
      const [s] = await db.select({ name: studentsTable.name, swimming_pool_id: studentsTable.swimming_pool_id })
        .from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
      if (!s || s.swimming_pool_id !== poolId) return err(res, 403, "해당 학생은 이 수영장에 속하지 않습니다.");
      studentName = s.name;
    }

    const id = `notice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [notice] = await db.insert(noticesTable).values({
      id,
      audience_scope: scope,
      swimming_pool_id: poolId,   // global이면 null
      title, content,
      author_id: req.user!.userId,
      author_name: user?.name || "관리자",
      is_pinned: is_pinned === true,
      notice_type: ["individual", "update", "maintenance", "special"].includes(notice_type) ? notice_type : "general",
      student_id: scope === "pool" && notice_type === "individual" ? (student_id || null) : null,
      student_name: studentName,
      image_urls: imgs,
      // WP4 new fields
      show_banner:       show_banner   === true,
      send_push:         send_push     !== false,  // default true (backward compat)
      target_roles:      parsedTargetRoles,
      target_pools:      parsedTargetPools,
      starts_at:         starts_at  ? new Date(starts_at)  : null,
      ends_at:           ends_at    ? new Date(ends_at)    : null,
      deep_link:         deep_link  || null,
      target_plan_types: Array.isArray(target_plan_types) ? target_plan_types : null,
    }).returning();

    // 푸시 발송 (send_push=true일 때만 — WP5 durable fan-out)
    if (send_push !== false) {
      // Deterministic job_ref: same notice create action → same job_ref → idempotent
      const jobRef = `notice:${id}:send`;

      setImmediate(async () => {
        try {
          if (scope === "global") {
            // WP5 durable fan-out: all users (already uses enqueueFanoutJob internally)
            await sendPushToAllUsers("notice", "[스윔노트] 공지사항", title, { noticeId: id, type: "notice", deepLink: deep_link }, jobRef);

          } else if (poolId) {
            const poolInfoRows = await db.execute(sql`SELECT name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`).catch(() => null);
            const poolName = (poolInfoRows?.rows[0] as any)?.name || "수영장";
            const pushTitle = `[${poolName}] 공지사항`;

            if (notice_type === "individual" && student_id) {
              const parentRows = await db.execute(sql`
                SELECT parent_id AS parent_account_id FROM parent_students
                WHERE student_id = ${student_id} AND status = 'approved'
              `);
              const { sendPushToUser } = await import("../lib/push-service.js");
              const noticeOpts = { subtitle: "SwimNote", channelId: "notice" as const };
              for (const p of parentRows.rows as any[]) {
                await sendPushToUser(p.parent_account_id, true, "notice", pushTitle, title, { noticeId: id, type: "notice" }, jobRef, noticeOpts);
              }
            } else {
              // WP5 durable fan-out for pool parents
              await sendPushToPoolParents(poolId, "notice", pushTitle, title, { noticeId: id, type: "notice", deepLink: deep_link }, jobRef);
              // Admins + Teachers via direct push (small count, no fan-out needed)
              await Promise.allSettled([
                sendPushToPoolAdmins(poolId, "notice", pushTitle, title, { noticeId: id, type: "notice" }, `${jobRef}:admin`),
                sendPushToPoolTeachers(poolId, "notice", pushTitle, title, { noticeId: id, type: "notice" }, `${jobRef}:teacher`),
              ]);
            }
          }

          // push_sent_at 기록
          await db.execute(sql`
            UPDATE notices SET push_sent_at = NOW(), push_sent_count = COALESCE(push_sent_count, 0) + 1
            WHERE id = ${id}
          `).catch(console.error);
        } catch (e) {
          console.error("[notices] 푸시 발송 오류:", e);
        }
      });
    }

    const logPoolId = poolId || "global";
    logPoolEvent({ pool_id: logPoolId, event_type: "notice_create", entity_type: "notice", entity_id: notice.id, actor_id: req.user!.userId, actor_name: user?.name || "관리자", payload: { title, scope, notice_type: notice.notice_type, show_banner, send_push } }).catch(console.error);
    res.status(201).json({ success: true, ...notice });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── GET /notices/banners — Banner 후보 조회 ───────────────────────────────────
// 현재 사용자에게 표시할 Banner 후보를 반환합니다.
// 조건: show_banner=true, active period, not dismissed by this user
// 인증 필수 (§16 WP1 security 유지).
router.get("/banners", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId  = req.user!.userId;
    const role    = req.user!.role;
    const now     = new Date();

    // Banner candidates: show_banner=true, not deleted
    const candidates = await db.execute(sql`
      SELECT n.*
      FROM notices n
      WHERE n.show_banner = true
        AND (n.status IS NULL OR n.status != 'deleted')
        AND (n.starts_at IS NULL OR n.starts_at <= ${now})
        AND (n.ends_at   IS NULL OR n.ends_at   >= ${now})
        AND n.id NOT IN (
          SELECT notice_id FROM notice_dismissals WHERE user_id = ${userId}
        )
      ORDER BY n.is_pinned DESC, n.created_at DESC
      LIMIT 10
    `);

    const rows = candidates.rows as any[];

    // Filter by target_roles if present
    const filtered = rows.filter(n => {
      if (!n.target_roles || !n.target_roles.length) return true;
      // Map DB roles to spec roles
      const userSpecRole = roleToSpecRole(role);
      return n.target_roles.includes(userSpecRole);
    });

    res.json({ success: true, banners: filtered });
  } catch (e) {
    console.error("[notices/banners]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

/** Map DB role → spec target_role label */
function roleToSpecRole(role: string): string {
  if (role === "pool_admin" || role === "sub_admin") return "ADMIN";
  if (role === "teacher") return "TEACHER";
  if (role === "parent_account") return "PARENT";
  if (isSuperRole(role)) return "ADMIN";
  return role.toUpperCase();
}

// ── POST /notices/:id/dismiss — Banner 다시 보지 않기 ────────────────────────
// idempotent: 동일 (notice_id, user_id) 중복 요청 → 200, no error
router.post("/:id/dismiss", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId   = req.user!.userId;
    const noticeId = req.params.id;

    // Verify notice exists and has show_banner=true
    const rows = await db.execute(sql`SELECT id, show_banner FROM notices WHERE id = ${noticeId} LIMIT 1`);
    const notice = rows.rows[0] as any;
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (!notice.show_banner) return err(res, 400, "배너 공지가 아닙니다.");

    // Upsert: ON CONFLICT DO NOTHING — idempotent
    const dismId = `nd_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    await db.execute(sql`
      INSERT INTO notice_dismissals (id, notice_id, user_id, dismissed_at)
      VALUES (${dismId}, ${noticeId}, ${userId}, NOW())
      ON CONFLICT (notice_id, user_id) DO NOTHING
    `);

    res.json({ success: true });
  } catch (e) {
    console.error("[notices/dismiss]", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ── GET /:id/read-stats ───────────────────────────────────────────────────────
router.get("/:id/read-stats", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const poolId = isSuperRole(role) ? null : await getPoolId(req.user!.userId);

    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (poolId && notice.audience_scope === "pool" && notice.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const readCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM notice_reads WHERE notice_id = ${req.params.id}`);
    const read = Number((readCount.rows[0] as any).cnt);

    let totalParents = 0;
    if (notice.audience_scope === "global") {
      const all = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_accounts WHERE swimming_pool_id IS NOT NULL`);
      totalParents = Number((all.rows[0] as any).cnt);
    } else if (notice.notice_type === "individual" && notice.student_id) {
      const links = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_students WHERE student_id = ${notice.student_id} AND status = 'approved'`);
      totalParents = Number((links.rows[0] as any).cnt);
    } else {
      const all = await db.execute(sql`SELECT COUNT(*) as cnt FROM parent_accounts WHERE swimming_pool_id = ${notice.swimming_pool_id}`);
      totalParents = Number((all.rows[0] as any).cnt);
    }

    res.json({ read_count: read, unread_count: Math.max(0, totalParents - read), total: totalParents });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /:id — 소프트 삭제 ────────────────────────────────────────────────
router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const poolId = isSuperRole(role) ? null : await getPoolId(req.user!.userId);

    const [notice] = await db.select({ swimming_pool_id: noticesTable.swimming_pool_id, status: noticesTable.status, audience_scope: noticesTable.audience_scope })
      .from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (notice.status === "deleted") return err(res, 404, "이미 삭제된 공지입니다.");
    // pool_admin은 자기 수영장 pool 공지만 삭제 가능 (global 공지는 super_admin만)
    if (poolId) {
      if (notice.audience_scope === "global") return err(res, 403, "전체 공지는 슈퍼관리자만 삭제할 수 있습니다.");
      if (notice.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.update(noticesTable)
      .set({ status: "deleted", updated_at: new Date() })
      .where(eq(noticesTable.id, req.params.id));

    const logPoolId = notice.swimming_pool_id || "global";
    logPoolEvent({ pool_id: logPoolId, event_type: "notice_delete", entity_type: "notice", entity_id: req.params.id, actor_id: req.user!.userId, payload: { audience_scope: notice.audience_scope } }).catch(console.error);
    res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PATCH /:id — 수정 (재발송 포함) ─────────────────────────────────────────
router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { title, content, is_pinned, notice_type, resend_push,
          show_banner, send_push, target_roles, target_pools, starts_at, ends_at, deep_link } = req.body;
  try {
    const role = req.user!.role;
    const poolId = isSuperRole(role) ? null : await getPoolId(req.user!.userId);

    const [notice] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    if (!notice) return err(res, 404, "공지를 찾을 수 없습니다.");
    if (poolId && notice.audience_scope === "pool" && notice.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const updates: any = { updated_at: new Date() };
    if (title       !== undefined) updates.title       = title;
    if (content     !== undefined) updates.content     = content;
    if (is_pinned   !== undefined) updates.is_pinned   = is_pinned;
    if (notice_type !== undefined) updates.notice_type = ["individual", "update", "maintenance", "special"].includes(notice_type) ? notice_type : "general";
    if (show_banner !== undefined) updates.show_banner = show_banner === true;
    if (send_push   !== undefined) updates.send_push   = send_push !== false;
    if (starts_at   !== undefined) updates.starts_at   = starts_at ? new Date(starts_at) : null;
    if (ends_at     !== undefined) updates.ends_at     = ends_at   ? new Date(ends_at)   : null;
    if (deep_link   !== undefined) updates.deep_link   = deep_link || null;
    if (Array.isArray(target_roles))  updates.target_roles  = target_roles.filter((r: string) => ["ADMIN","TEACHER","PARENT"].includes(r));
    if (Array.isArray(target_pools))  updates.target_pools  = target_pools;

    await db.update(noticesTable).set(updates).where(eq(noticesTable.id, req.params.id));

    // 재발송 (스위치 ON 시에만, 기본 OFF)
    if (resend_push) {
      const finalTitle = title || notice.title;
      const jobRef = `notice:${req.params.id}:resend_${Date.now()}`;

      setImmediate(async () => {
        try {
          if (notice.audience_scope === "global") {
            await sendPushToAllUsers("notice", "[스윔노트] 공지사항 (수정)", finalTitle, { noticeId: req.params.id }, jobRef);
          } else if (notice.swimming_pool_id) {
            const targetPoolId = notice.swimming_pool_id;
            const poolInfoRows = await db.execute(sql`SELECT name FROM swimming_pools WHERE id = ${targetPoolId} LIMIT 1`).catch(() => null);
            const poolName = (poolInfoRows?.rows[0] as any)?.name || "수영장";
            const pushTitle = `[${poolName}] 공지사항 (수정)`;
            await Promise.allSettled([
              sendPushToPoolParents(targetPoolId, "notice", pushTitle, finalTitle, { noticeId: req.params.id }, jobRef),
              sendPushToPoolAdmins(targetPoolId, "notice", pushTitle, finalTitle, { noticeId: req.params.id }, `${jobRef}:admin`),
              sendPushToPoolTeachers(targetPoolId, "notice", pushTitle, finalTitle, { noticeId: req.params.id }, `${jobRef}:teacher`),
            ]);
          }
          await db.execute(sql`
            UPDATE notices SET push_sent_at = NOW(), push_sent_count = COALESCE(push_sent_count, 0) + 1
            WHERE id = ${req.params.id}
          `).catch(console.error);
        } catch (e) {
          console.error("[notices] 재발송 오류:", e);
        }
      });
    }

    const [updated] = await db.select().from(noticesTable).where(eq(noticesTable.id, req.params.id)).limit(1);
    res.json({ success: true, ...updated });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST /notices/ai-write — AI 공지 작성 보조 ────────────────────────────────
// 관리자 메모 또는 현재 초안을 받아 제목+본문 제안 반환.
// 관리자가 "적용" 확인 후 직접 게시 — AI 자동 발행 금지.
router.post("/ai-write", requireAuth, requireRole("pool_admin", "sub_admin"), async (req: AuthRequest, res) => {
  const { memo, currentTitle, currentContent } = req.body as {
    memo?: string; currentTitle?: string; currentContent?: string;
  };

  const parts = [
    memo          ? `관리자 메모: ${memo}`           : "",
    currentTitle  ? `현재 제목 초안: ${currentTitle}` : "",
    currentContent? `현재 내용 초안: ${currentContent}` : "",
  ].filter(Boolean);

  if (parts.length === 0) {
    return err(res, 400, "메모 또는 초안을 입력해주세요.");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return err(res, 503, "AI 서비스를 사용할 수 없습니다.");

  try {
    const { callGateway } = await import("../lib/runtime/ai-gateway.js");
    const reqId = `notice_ai_${Date.now()}_${req.user!.userId.slice(-6)}`;
    const result = await callGateway({
      request_id:    reqId,
      feature:       "notice_ai_write",
      model:         "gpt-4o-mini",
      system_prompt:
        "당신은 수영장 관리자를 위한 공지 작성 보조 도우미입니다.\n" +
        "관리자가 제공한 메모나 초안을 바탕으로 자연스럽고 명확한 공지 제목과 본문을 작성하세요.\n" +
        "규칙: 제목은 15자 이내, 본문은 학부모가 이해하기 쉬운 경어체, 필요 정보 포함.\n" +
        '반드시 JSON으로만 응답: {"title": "...", "content": "..."}',
      user_prompt:   parts.join("\n"),
      response_format: { type: "json_object" },
      max_tokens:    600,
      timeout_ms:    15000,
    });

    const parsed = result.content as { title?: string; content?: string };
    if (!parsed.title || !parsed.content) {
      return err(res, 500, "AI 응답 형식 오류가 발생했습니다.");
    }
    return res.json({ title: parsed.title, content: parsed.content });
  } catch (e: unknown) {
    console.error("[notices/ai-write]", e);
    return err(res, 500, "AI 작성 중 오류가 발생했습니다. 다시 시도해주세요.");
  }
});

export default router;
