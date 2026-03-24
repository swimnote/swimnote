/**
 * 선생님 초대 및 승인 관리
 * POST /admin/teacher-invites         - 관리자: 초대 생성
 * GET  /admin/teacher-invites         - 관리자: 초대 목록
 * GET  /admin/teacher-invites/:id/detail - 관리자: 선생님 상세 정보
 * PATCH /admin/teacher-invites/:id    - 관리자: 승인/거절/비활성화/부관리자설정
 * POST /admin/teacher-invites/:id/transfer - 관리자: 수업 인수
 * GET  /public/teacher-invite/:token  - 공개: 초대 토큰 검증
 * POST /public/teacher-invite/join    - 공개: 선생님 초대링크로 가입
 */
import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";
import { logEvent } from "../lib/event-logger.js";
import { logChange } from "../utils/change-logger.js";

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

      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const token = genToken();
      const id = genId("ti");

      await superAdminDb.execute(sql`
        INSERT INTO teacher_invites (id, swimming_pool_id, name, phone, position, invite_token, invite_status, invited_by, notes, created_at)
        VALUES (${id}, ${me.swimming_pool_id}, ${name.trim()}, ${phone.trim()},
                ${position?.trim() || null}, ${token}, 'invited', ${req.user!.userId},
                ${notes?.trim() || null}, NOW())
      `);

      const result = await superAdminDb.execute(sql`SELECT * FROM teacher_invites WHERE id = ${id}`);
      await logChange({ tenantId: me.swimming_pool_id, tableName: "teacher_invites", recordId: id, changeType: "create", payload: { name: name.trim(), phone: phone.trim(), invite_status: "invited" } });
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
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const validStatuses = ["invited", "joinedPendingApproval", "approved", "rejected", "inactive"];
      let q = `SELECT ti.*, u.email as user_email, u.roles as user_roles FROM teacher_invites ti
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

// ─── 관리자: 선생님 상세 정보 ─────────────────────────────────────────
router.get("/admin/teacher-invites/:id/detail", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const result = await superAdminDb.execute(sql`
        SELECT
          ti.*,
          u.email as user_email,
          u.roles as user_roles,
          u.is_activated,
          (SELECT COUNT(DISTINCT cg.id)::int
           FROM class_groups cg
           WHERE cg.teacher_user_id = u.id AND cg.is_deleted = false) as class_count,
          (SELECT COUNT(DISTINCT cm.id)::int
           FROM class_groups cg
           JOIN class_members cm ON cm.class_id = cg.id
           WHERE cg.teacher_user_id = u.id AND cg.is_deleted = false) as member_count
        FROM teacher_invites ti
        LEFT JOIN users u ON ti.user_id = u.id
        WHERE ti.id = ${req.params.id}
          AND ti.swimming_pool_id = ${me.swimming_pool_id}
        LIMIT 1
      `);

      if (!result.rows.length) {
        res.status(404).json({ success: false, message: "선생님 정보를 찾을 수 없습니다." }); return;
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 승인/거절/비활성화/부관리자설정 ──────────────────────────
router.patch("/admin/teacher-invites/:id", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { action, rejection_reason, roles, grant } = req.body;
      const validActions = ["approve", "reject", "deactivate", "reactivate", "revoke", "set-sub-admin"];
      if (!validActions.includes(action)) {
        res.status(400).json({ success: false, message: "유효하지 않은 action입니다." }); return;
      }

      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id, name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const actorId   = req.user!.userId;
      const actorName = (me as any).name || "관리자";
      const poolId    = me.swimming_pool_id;

      const existing = await superAdminDb.execute(sql`
        SELECT ti.*, u.roles as user_roles FROM teacher_invites ti
        LEFT JOIN users u ON ti.user_id = u.id
        WHERE ti.id = ${req.params.id} AND ti.swimming_pool_id = ${poolId}
        LIMIT 1
      `);
      if (!existing.rows.length) { res.status(404).json({ success: false, message: "초대 정보를 찾을 수 없습니다." }); return; }

      const invite = existing.rows[0] as any;

      if (action === "approve") {
        const approvableStatuses = ["joinedPendingApproval", "rejected", "inactive"];
        if (!approvableStatuses.includes(invite.invite_status)) {
          res.status(409).json({ success: false, message: "승인 처리 가능한 상태가 아닙니다." }); return;
        }
        // 항상 일반 선생님으로 승인 (관리자 권한은 이후 "관리자 추가/승계" 화면에서 별도 부여)
        const approvedRoles: string[] = ["teacher"];
        if (invite.user_id) {
          const rolesLiteral = `{"teacher"}`;
          await superAdminDb.execute(sql`UPDATE users SET is_activated = true, roles = ${rolesLiteral}::TEXT[], updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await superAdminDb.execute(sql`
          UPDATE teacher_invites
          SET invite_status = 'approved', approved_at = NOW(), approved_by = ${actorId},
              approved_role = 'teacher'
          WHERE id = ${req.params.id}
        `);
        logEvent({ pool_id: poolId, category: "선생님", actor_id: actorId, actor_name: actorName, target: invite.name, description: `선생님 승인 — ${invite.name}` }).catch(console.error);
        res.json({ success: true, message: "선생님이 승인되었습니다.", roles: approvedRoles });

      } else if (action === "reject") {
        const rejectableStatuses = ["joinedPendingApproval", "invited", "inactive"];
        if (!rejectableStatuses.includes(invite.invite_status)) {
          res.status(409).json({ success: false, message: "현재 상태에서는 거절할 수 없습니다." }); return;
        }
        if (invite.user_id) {
          await superAdminDb.execute(sql`UPDATE users SET is_activated = false, updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await superAdminDb.execute(sql`
          UPDATE teacher_invites
          SET invite_status = 'rejected',
              rejected_at = NOW(), rejected_by = ${actorId},
              rejection_reason = ${rejection_reason || null}
          WHERE id = ${req.params.id}
        `);
        logEvent({ pool_id: poolId, category: "선생님", actor_id: actorId, actor_name: actorName, target: invite.name, description: `선생님 거절 — ${invite.name} (사유: ${rejection_reason || "없음"})` }).catch(console.error);
        res.json({ success: true, message: "거절되었습니다." });

      } else if (action === "deactivate" || action === "revoke") {
        if (invite.user_id) {
          await superAdminDb.execute(sql`UPDATE users SET is_activated = false, updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await superAdminDb.execute(sql`UPDATE teacher_invites SET invite_status = 'inactive' WHERE id = ${req.params.id}`);
        logEvent({ pool_id: poolId, category: "선생님", actor_id: actorId, actor_name: actorName, target: invite.teacher_name, description: `선생님 승인 해제 — ${invite.teacher_name}` }).catch(console.error);
        res.json({ success: true, message: "승인이 해제되었습니다." });

      } else if (action === "reactivate") {
        if (invite.user_id) {
          await superAdminDb.execute(sql`UPDATE users SET is_activated = true, updated_at = NOW() WHERE id = ${invite.user_id}`);
        }
        await superAdminDb.execute(sql`UPDATE teacher_invites SET invite_status = 'approved' WHERE id = ${req.params.id}`);
        logEvent({ pool_id: poolId, category: "선생님", actor_id: actorId, actor_name: actorName, target: invite.teacher_name, description: `선생님 재활성화 — ${invite.teacher_name}` }).catch(console.error);
        res.json({ success: true, message: "재활성화되었습니다." });

      } else if (action === "set-sub-admin") {
        if (!invite.user_id) {
          res.status(400).json({ success: false, message: "사용자 계정이 없습니다." }); return;
        }
        let currentRoles: string[] = Array.isArray(invite.user_roles)
          ? invite.user_roles
          : (invite.user_roles ? [invite.user_roles] : ["teacher"]);

        if (grant) {
          if (!currentRoles.includes("sub_admin")) currentRoles = [...currentRoles, "sub_admin"];
        } else {
          currentRoles = currentRoles.filter((r: string) => r !== "sub_admin");
          if (!currentRoles.includes("teacher")) currentRoles = ["teacher"];
        }

        const rolesLiteral = `{${currentRoles.map((r: string) => `"${r}"`).join(",")}}`;
        await superAdminDb.execute(sql`UPDATE users SET roles = ${rolesLiteral}::TEXT[], updated_at = NOW() WHERE id = ${invite.user_id}`);

        logEvent({
          pool_id: poolId, category: "권한", actor_id: actorId, actor_name: actorName,
          target: invite.teacher_name,
          description: grant ? `부관리자 지정 — ${invite.teacher_name}` : `부관리자 해제 — ${invite.teacher_name}`,
          metadata: { grant, teacher_name: invite.teacher_name },
        }).catch(console.error);

        res.json({ success: true, message: grant ? "부관리자로 지정되었습니다." : "부관리자 권한이 해제되었습니다.", roles: currentRoles });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 승인된 선생님 목록 (관리자 추가/승계 화면용) ──────────────
router.get("/admin/approved-teachers-for-grant", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const result = await superAdminDb.execute(sql`
        SELECT u.id, u.name, u.email, u.phone, u.roles,
               (u.roles @> ARRAY['pool_admin']::text[]) AS is_admin_granted,
               ti.invite_status, ti.approved_at
        FROM teacher_invites ti
        JOIN users u ON ti.user_id = u.id
        WHERE ti.swimming_pool_id = ${me.swimming_pool_id}
          AND ti.invite_status = 'approved'
          AND u.role = 'teacher'
        ORDER BY u.name
      `);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 선생님에게 관리자 권한 부여/회수 ──────────────────────────
router.post("/admin/grant-pool-admin", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { userId, grant } = req.body;
      if (!userId || typeof grant !== "boolean") {
        res.status(400).json({ success: false, message: "userId와 grant(boolean)가 필요합니다." }); return;
      }

      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id, name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      // 같은 수영장의 승인된 선생님인지 확인
      const targetRow = await superAdminDb.execute(sql`
        SELECT u.id, u.name, u.roles FROM users u
        JOIN teacher_invites ti ON ti.user_id = u.id
        WHERE u.id = ${userId}
          AND ti.swimming_pool_id = ${me.swimming_pool_id}
          AND ti.invite_status = 'approved'
          AND u.role = 'teacher'
        LIMIT 1
      `);
      if (!targetRow.rows.length) {
        res.status(404).json({ success: false, message: "해당 수영장의 승인된 선생님을 찾을 수 없습니다." }); return;
      }

      const target = targetRow.rows[0] as any;
      let currentRoles: string[] = Array.isArray(target.roles) ? target.roles : ["teacher"];

      if (grant) {
        if (!currentRoles.includes("pool_admin")) currentRoles = [...currentRoles, "pool_admin"];
        if (!currentRoles.includes("teacher"))    currentRoles = [...currentRoles, "teacher"];
      } else {
        currentRoles = currentRoles.filter((r: string) => r !== "pool_admin");
        if (!currentRoles.includes("teacher")) currentRoles = ["teacher"];
      }

      const rolesLiteral = `{${currentRoles.map((r: string) => `"${r}"`).join(",")}}`;
      await superAdminDb.execute(sql`UPDATE users SET roles = ${rolesLiteral}::TEXT[], updated_at = NOW() WHERE id = ${userId}`);

      const actorName = (me as any).name || "관리자";
      logEvent({
        pool_id: me.swimming_pool_id, category: "권한",
        actor_id: req.user!.userId, actor_name: actorName, target: target.name,
        description: grant
          ? `관리자 권한 부여 — ${target.name}`
          : `관리자 권한 회수 — ${target.name}`,
        metadata: { grant, target_name: target.name, roles: currentRoles },
      }).catch(console.error);

      res.json({ success: true, message: grant ? "관리자 권한이 부여되었습니다." : "관리자 권한이 회수되었습니다.", roles: currentRoles });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 수업 인수 (담당 반/회원 일괄 이전) ──────────────────────
router.post("/admin/teacher-invites/:id/transfer", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { target_user_id, target_teacher_name } = req.body;
      if (!target_user_id) {
        res.status(400).json({ success: false, message: "target_user_id가 필요합니다." }); return;
      }

      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id, name: usersTable.name })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const actorId   = req.user!.userId;
      const actorName = (me as any).name || "관리자";

      // 소스 선생님 invite 조회
      const inviteResult = await superAdminDb.execute(sql`
        SELECT ti.*, u.id as source_user_id, u.name as source_name
        FROM teacher_invites ti
        LEFT JOIN users u ON ti.user_id = u.id
        WHERE ti.id = ${req.params.id} AND ti.swimming_pool_id = ${me.swimming_pool_id}
        LIMIT 1
      `);
      if (!inviteResult.rows.length) {
        res.status(404).json({ success: false, message: "초대 정보를 찾을 수 없습니다." }); return;
      }
      const invite = inviteResult.rows[0] as any;
      const sourceUserId = invite.source_user_id;
      const sourceName   = invite.source_name || invite.teacher_name || "이전 선생님";
      if (!sourceUserId) {
        res.status(400).json({ success: false, message: "소스 선생님 계정이 없습니다." }); return;
      }

      // 대상 선생님 이름 조회
      const targetResult = await superAdminDb.execute(sql`
        SELECT name FROM users WHERE id = ${target_user_id} LIMIT 1
      `);
      const targetName = target_teacher_name || (targetResult.rows[0] as any)?.name || "미지정";

      // class_groups 일괄 이전
      const updateResult = await db.execute(sql`
        UPDATE class_groups
        SET teacher_user_id = ${target_user_id},
            instructor = ${targetName},
            updated_at = NOW()
        WHERE teacher_user_id = ${sourceUserId}
          AND swimming_pool_id = ${me.swimming_pool_id}
          AND is_deleted = false
      `);

      const transferredCount = (updateResult as any).rowCount ?? 0;

      logEvent({
        pool_id: me.swimming_pool_id,
        category: "선생님",
        actor_id: actorId,
        actor_name: actorName,
        target: `${sourceName} → ${targetName}`,
        description: `수업 인수 — ${sourceName} 담당 반 ${transferredCount}개 → ${targetName}에게 이전`,
        metadata: { source_name: sourceName, target_name: targetName, transferred_count: transferredCount },
      }).catch(console.error);

      res.json({
        success: true,
        message: `수업 인수가 완료되었습니다. 담당 수업이 ${targetName} 선생님에게 이전되었습니다.`,
        transferred_count: transferredCount,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 공개: 초대 토큰 검증 ────────────────────────────────────────────
router.get("/public/teacher-invite/:token", async (req, res) => {
  try {
    const result = await superAdminDb.execute(sql`
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

    const inviteResult = await superAdminDb.execute(sql`
      SELECT ti.*, sp.id as sp_id FROM teacher_invites ti
      JOIN swimming_pools sp ON ti.swimming_pool_id = sp.id
      WHERE ti.invite_token = ${token} AND ti.invite_status IN ('invited')
      LIMIT 1
    `);
    if (!inviteResult.rows.length) {
      res.status(404).json({ success: false, message: "유효하지 않거나 이미 사용된 초대 링크입니다." }); return;
    }

    const invite = inviteResult.rows[0] as any;

    const dup = await superAdminDb.execute(sql`SELECT id FROM users WHERE email = ${email.trim().toLowerCase()} LIMIT 1`);
    if (dup.rows.length) {
      res.status(409).json({ success: false, message: "이미 사용 중인 이메일입니다." }); return;
    }

    const passwordHash = await hashPassword(password);
    const userId = genId("user");

    await superAdminDb.execute(sql`
      INSERT INTO users (id, email, password_hash, name, phone, role, swimming_pool_id, is_activated, created_at, updated_at)
      VALUES (
        ${userId}, ${email.trim().toLowerCase()}, ${passwordHash},
        ${name?.trim() || invite.name}, ${invite.phone},
        'teacher', ${invite.swimming_pool_id}, false, NOW(), NOW()
      )
    `);

    await superAdminDb.execute(sql`
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
