/**
 * 선생님 초대 및 승인 관리
 * POST /admin/teacher-invites         - 관리자: 초대 생성
 * GET  /admin/teacher-invites         - 관리자: 초대 목록
 * PATCH /admin/teacher-invites/:id    - 관리자: 승인/거절/비활성화
 * GET  /public/teacher-invite/:token  - 공개: 초대 토큰 검증
 * POST /public/teacher-invite/join    - 공개: 선생님 초대링크로 가입
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";

const router = Router();

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
function genToken() {
  return `tok_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
}

// ─── 관리자: 선생님 초대 생성 ────────────────────────────────────────
router.post("/admin/teacher-invites", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { name, phone, position, notes } = req.body;
      if (!name?.trim() || !phone?.trim()) {
        res.status(400).json({ success: false, message: "이름과 연락처는 필수입니다." }); return;
      }

      const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const token = genToken();
      const id = genId("ti");

      await db.execute(sql`
        INSERT INTO teacher_invites (id, swimming_pool_id, name, phone, position, invite_token, invite_status, invited_by, notes, created_at)
        VALUES (${id}, ${me.swimming_pool_id}, ${name.trim()}, ${phone.trim()},
                ${position?.trim() || null}, ${token}, 'invited', ${req.user!.userId},
                ${notes?.trim() || null}, NOW())
      `);

      const result = await db.execute(sql`SELECT * FROM teacher_invites WHERE id = ${id}`);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 초대 목록 ───────────────────────────────────────────────
router.get("/admin/teacher-invites", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { status } = req.query;
      const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const validStatuses = ["invited", "joinedPendingApproval", "approved", "rejected", "inactive"];
      let q = `SELECT ti.*, u.email as user_email FROM teacher_invites ti
               LEFT JOIN users u ON ti.user_id = u.id
               WHERE ti.swimming_pool_id = '${me.swimming_pool_id}'`;
      if (status && validStatuses.includes(status as string)) {
        q += ` AND ti.invite_status = '${status}'`;
      }
      q += ` ORDER BY ti.created_at DESC`;

      const result = await db.execute(sql.raw(q));
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 승인/거절/비활성화 ──────────────────────────────────────
router.patch("/admin/teacher-invites/:id", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { action, rejection_reason } = req.body;
      const validActions = ["approve", "reject", "deactivate", "reactivate"];
      if (!validActions.includes(action)) {
        res.status(400).json({ success: false, message: "유효하지 않은 action입니다." }); return;
      }

      const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const existing = await db.execute(sql`
        SELECT * FROM teacher_invites
        WHERE id = ${req.params.id} AND swimming_pool_id = ${me.swimming_pool_id}
        LIMIT 1
      `);
      if (!existing.rows.length) { res.status(404).json({ success: false, message: "초대 정보를 찾을 수 없습니다." }); return; }

      const invite = existing.rows[0] as any;

      if (action === "approve") {
        if (invite.invite_status !== "joinedPendingApproval") {
          res.status(409).json({ success: false, message: "승인 대기 상태인 초대만 승인할 수 있습니다." }); return;
        }
        // users 테이블에서 is_activated true로 변경
        if (invite.user_id) {
          await db.execute(sql`UPDATE users SET is_activated = true, updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await db.execute(sql`
          UPDATE teacher_invites
          SET invite_status = 'approved', approved_at = NOW(), approved_by = ${req.user!.userId}
          WHERE id = ${req.params.id}
        `);
        res.json({ success: true, message: "선생님이 승인되었습니다." });
      } else if (action === "reject") {
        if (invite.user_id) {
          await db.execute(sql`UPDATE users SET is_activated = false, updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await db.execute(sql`
          UPDATE teacher_invites
          SET invite_status = 'rejected', approved_at = NOW(), approved_by = ${req.user!.userId}
          WHERE id = ${req.params.id}
        `);
        res.json({ success: true, message: "거절되었습니다." });
      } else if (action === "deactivate") {
        if (invite.user_id) {
          await db.execute(sql`UPDATE users SET is_activated = false, updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await db.execute(sql`UPDATE teacher_invites SET invite_status = 'inactive' WHERE id = ${req.params.id}`);
        res.json({ success: true, message: "비활성화되었습니다." });
      } else if (action === "reactivate") {
        if (invite.user_id) {
          await db.execute(sql`UPDATE users SET is_activated = true, updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await db.execute(sql`UPDATE teacher_invites SET invite_status = 'approved' WHERE id = ${req.params.id}`);
        res.json({ success: true, message: "재활성화되었습니다." });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 공개: 초대 토큰 검증 ────────────────────────────────────────────
router.get("/public/teacher-invite/:token", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT ti.id, ti.name, ti.phone, ti.position, ti.invite_status,
             sp.name as pool_name
      FROM teacher_invites ti
      JOIN swimming_pools sp ON ti.swimming_pool_id = sp.id
      WHERE ti.invite_token = ${req.params.token}
      LIMIT 1
    `);

    if (!result.rows.length) {
      res.status(404).json({ success: false, message: "유효하지 않은 초대 링크입니다." }); return;
    }

    const invite = result.rows[0] as any;
    if (invite.invite_status === "rejected" || invite.invite_status === "inactive") {
      res.status(410).json({ success: false, message: "만료되었거나 취소된 초대 링크입니다." }); return;
    }
    if (invite.invite_status === "approved") {
      res.status(409).json({ success: false, message: "이미 완료된 초대입니다." }); return;
    }

    res.json({ success: true, data: invite });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

// ─── 공개: 선생님 초대링크로 가입 ────────────────────────────────────
router.post("/public/teacher-invite/join", async (req, res) => {
  try {
    const { token, email, password, name } = req.body;
    if (!token || !email?.trim() || !password || password.length < 6) {
      res.status(400).json({ success: false, message: "토큰, 이메일, 비밀번호(6자 이상)는 필수입니다." }); return;
    }

    // 초대 검증
    const inviteResult = await db.execute(sql`
      SELECT ti.*, sp.id as sp_id FROM teacher_invites ti
      JOIN swimming_pools sp ON ti.swimming_pool_id = sp.id
      WHERE ti.invite_token = ${token} AND ti.invite_status IN ('invited')
      LIMIT 1
    `);
    if (!inviteResult.rows.length) {
      res.status(404).json({ success: false, message: "유효하지 않거나 이미 사용된 초대 링크입니다." }); return;
    }

    const invite = inviteResult.rows[0] as any;

    // 이메일 중복 확인
    const dup = await db.execute(sql`SELECT id FROM users WHERE email = ${email.trim().toLowerCase()} LIMIT 1`);
    if (dup.rows.length) {
      res.status(409).json({ success: false, message: "이미 사용 중인 이메일입니다." }); return;
    }

    const passwordHash = await hashPassword(password);
    const userId = genId("user");

    // 사용자 계정 생성 (is_activated=false, 관리자 승인 대기)
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated, created_at, updated_at)
      VALUES (
        ${userId}, ${email.trim().toLowerCase()}, ${passwordHash},
        ${name?.trim() || invite.name}, ${invite.phone},
        'teacher', ${invite.swimming_pool_id}, false, NOW(), NOW()
      )
    `);

    // 초대 상태 업데이트
    await db.execute(sql`
      UPDATE teacher_invites
      SET invite_status = 'joinedPendingApproval', user_id = ${userId}, requested_at = NOW()
      WHERE id = ${invite.id}
    `);

    res.status(201).json({
      success: true,
      message: "가입이 완료되었습니다. 수영장 관리자 승인 후 로그인 가능합니다.",
      data: { user_id: userId }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

export default router;
