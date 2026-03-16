import { Router } from "express";
import { db } from "@workspace/db";
import { swimmingPoolsTable, usersTable, subscriptionsTable, membersTable, parentAccountsTable, parentStudentsTable, studentsTable, studentRegistrationRequestsTable, classGroupsTable } from "@workspace/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, requirePermission, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword, DEFAULT_PLATFORM_ADMIN_PERMISSIONS, type PlatformPermissions } from "../lib/auth.js";

const router = Router();

/** 회원 수 기준 구독 단계 계산 */
function getSubscriptionTier(approved: boolean, count: number): { tier: string; label: string; isFree: boolean } {
  if (!approved) return { tier: "unapproved", label: "미승인", isFree: false };
  if (count <= 50) return { tier: "free", label: "무료 이용", isFree: true };
  if (count <= 100) return { tier: "paid_100", label: "유료 100명", isFree: false };
  if (count <= 300) return { tier: "paid_300", label: "유료 300명", isFree: false };
  if (count <= 500) return { tier: "paid_500", label: "유료 500명", isFree: false };
  if (count <= 1000) return { tier: "paid_1000", label: "유료 1000명", isFree: false };
  return { tier: "paid_enterprise", label: "유료 엔터프라이즈", isFree: false };
}

router.get("/pools", requireAuth, requirePermission("canViewPools"), async (req: AuthRequest, res) => {
  try {
    const pools = await db.select().from(swimmingPoolsTable).orderBy(swimmingPoolsTable.name);

    const poolsWithCount = await Promise.all(pools.map(async (pool) => {
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM students
        WHERE swimming_pool_id = ${pool.id} AND status = 'active'
      `);
      const count = Number((countResult.rows[0] as any)?.cnt || 0);
      const approved = pool.approval_status === "approved";
      const tier = getSubscriptionTier(approved, count);
      return { ...pool, member_count: count, subscription_tier: tier };
    }));

    res.json(poolsWithCount);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류가 발생했습니다.", error: String(err) });
  }
});

router.patch("/pools/:id/approve", requireAuth, requirePermission("canApprovePools"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    // 필수 서류 상태 확인
    const [pool] = await db.select().from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, id)).limit(1);
    if (!pool) return res.status(404).json({ success: false, message: "수영장을 찾을 수 없습니다.", error: "pool not found" });

    const businessLicenseOK = (pool as any).business_license_status === "uploaded" || (pool as any).business_license_status === "verified";
    const bankAccountOK = (pool as any).bank_account_verification_status === "uploaded" || (pool as any).bank_account_verification_status === "verified";
    
    if (!businessLicenseOK || !bankAccountOK) {
      return res.status(400).json({
        success: false,
        message: "필수 서류가 모두 업로드되어야 승인할 수 있습니다.",
        error: "required_documents_missing",
        document_status: {
          business_license: (pool as any).business_license_status,
          bank_account_verification: (pool as any).bank_account_verification_status,
        },
      });
    }

    // 승인 처리
    const [updated] = await db.update(swimmingPoolsTable)
      .set({ approval_status: "approved", subscription_status: "trial", updated_at: new Date() })
      .where(eq(swimmingPoolsTable.id, id))
      .returning();

    // 관리자 계정 활성화
    const adminEmail = (updated as any).admin_email || updated.owner_email;
    const [existingAdmin] = await db.select().from(usersTable)
      .where(eq(usersTable.email, adminEmail)).limit(1);
    
    if (existingAdmin && existingAdmin.swimming_pool_id === id) {
      console.log(`[INFO] 관리자 계정 활성화: ${adminEmail} (pool: ${id})`);
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다.", error: String(err) });
  }
});

router.patch("/pools/:id/reject", requireAuth, requirePermission("canApprovePools"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const [pool] = await db.update(swimmingPoolsTable)
      .set({ approval_status: "rejected", rejection_reason: reason || "기준 미달", updated_at: new Date() })
      .where(eq(swimmingPoolsTable.id, id))
      .returning();
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    res.json(pool);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.patch("/pools/:id/subscription", requireAuth, requirePermission("canManageSubscriptions"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { subscription_status, subscription_start_at, subscription_end_at, note } = req.body;
  try {
    const updateData: Record<string, unknown> = {
      subscription_status,
      updated_at: new Date(),
    };
    if (subscription_start_at) updateData.subscription_start_at = new Date(subscription_start_at);
    if (subscription_end_at) updateData.subscription_end_at = new Date(subscription_end_at);

    const [pool] = await db.update(swimmingPoolsTable)
      .set(updateData)
      .where(eq(swimmingPoolsTable.id, id))
      .returning();
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    const subId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.insert(subscriptionsTable).values({
      id: subId,
      swimming_pool_id: id,
      status: subscription_status,
      plan_name: "기본 플랜",
      amount: subscription_status === "active" ? 99000 : 0,
      start_at: subscription_start_at ? new Date(subscription_start_at) : null,
      end_at: subscription_end_at ? new Date(subscription_end_at) : null,
      note: note || null,
      created_by: req.user!.userId,
    });

    res.json(pool);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 학생 탈퇴 처리 ────────────────────────────────────────────────────
router.post("/students/:id/withdraw", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id: studentId } = req.params;

      // 권한: pool_admin은 자신의 수영장 학생만 처리 가능
      const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
      if (!student) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }

      if (req.user!.role === "pool_admin") {
        const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id }).from(usersTable)
          .where(eq(usersTable.id, req.user!.userId)).limit(1);
        if (me?.swimming_pool_id !== student.swimming_pool_id) {
          res.status(403).json({ error: "권한이 없습니다." }); return;
        }
      }

      if ((student as any).status === "withdrawn") {
        res.status(400).json({ error: "이미 탈퇴 처리된 학생입니다." }); return;
      }

      // 1. 개인 사진첩 삭제 (Object Storage + DB)
      const photos = await db.execute(sql`
        SELECT id, storage_key FROM student_photos WHERE student_id = ${studentId}
      `);
      if (photos.rows.length > 0) {
        try {
          const { Client } = await import("@replit/object-storage");
          const client = new Client();
          await Promise.allSettled(
            (photos.rows as any[]).map(p => client.delete(p.storage_key).catch(() => {}))
          );
        } catch { /* Object Storage 오류는 무시하고 DB 정리 진행 */ }
        await db.execute(sql`DELETE FROM student_photos WHERE student_id = ${studentId}`);
      }

      // 2. 마지막 반 이름 저장 후 탈퇴 처리 (출결 기록 유지)
      let lastClassName: string | null = null;
      if (student.class_group_id) {
        const cgResult = await db.execute(sql`
          SELECT name FROM class_groups WHERE id = ${student.class_group_id} LIMIT 1
        `);
        lastClassName = (cgResult.rows[0] as any)?.name ?? null;
      }
      await db.execute(sql`
        UPDATE students
        SET status = 'withdrawn', class_group_id = NULL, updated_at = now(),
            last_class_group_name = ${lastClassName}, withdrawn_at = now()
        WHERE id = ${studentId}
      `);

      // 3. 부모-학생 연결 해제
      await db.execute(sql`
        DELETE FROM parent_students WHERE student_id = ${studentId}
      `);

      // 4. 해당 반의 모든 학생이 탈퇴했으면 수영일지 삭제
      const classGroupId = student.class_group_id;
      if (classGroupId) {
        const remainingResult = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM students
          WHERE class_group_id = ${classGroupId} AND status = 'active'
        `);
        const remainCount = Number((remainingResult.rows[0] as any)?.cnt || 0);
        if (remainCount === 0) {
          // 수영일지 이미지도 Object Storage에서 삭제
          const diaries = await db.execute(sql`
            SELECT id, image_urls FROM swim_diary WHERE class_group_id = ${classGroupId}
          `);
          try {
            const { Client } = await import("@replit/object-storage");
            const client = new Client();
            for (const d of diaries.rows as any[]) {
              const urls: string[] = Array.isArray(d.image_urls) ? d.image_urls : [];
              await Promise.allSettled(urls.map((key: string) => client.delete(key).catch(() => {})));
            }
          } catch { /* 무시 */ }
          await db.execute(sql`DELETE FROM swim_diary WHERE class_group_id = ${classGroupId}`);
        }
      }

      res.json({ success: true, message: `${student.name} 학생이 탈퇴 처리되었습니다.` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

router.get("/users", requireAuth, requirePermission("canManagePlatformAdmins"), async (req: AuthRequest, res) => {
  try {
    const users = await db.execute(sql`
      SELECT id, email, name, phone, role, permissions, created_at
      FROM users
      WHERE role IN ('super_admin', 'platform_admin')
      ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END, created_at DESC
    `);
    res.json({ success: true, data: users.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다.", error: String(err) });
  }
});

router.post("/users", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { email, password, name, phone, permissions } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ success: false, message: "필수 정보를 입력해주세요.", error: "missing_required_fields" });
  }

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) return res.status(400).json({ success: false, message: "이미 사용 중인 이메일입니다.", error: "email_exists" });

    const perms: PlatformPermissions = {
      ...DEFAULT_PLATFORM_ADMIN_PERMISSIONS,
      ...(permissions || {}),
    };
    const password_hash = await hashPassword(password);
    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const result = await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, phone, role, permissions, swimming_pool_id)
      VALUES (${id}, ${email.trim().toLowerCase()}, ${password_hash}, ${name}, ${phone || null}, 'platform_admin', ${JSON.stringify(perms)}::jsonb, NULL)
      RETURNING id, email, name, phone, role, permissions, created_at
    `);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다.", error: String(err) });
  }
});

// ── 플랫폼 관리자 권한 수정 (super_admin 전용) ───────────────────────
router.patch("/users/:id/permissions", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  if (!permissions || typeof permissions !== "object") {
    return res.status(400).json({ success: false, message: "permissions 객체가 필요합니다.", error: "missing_permissions" });
  }
  try {
    const targetResult = await db.execute(sql`SELECT id, role FROM users WHERE id = ${id} LIMIT 1`);
    const user = (targetResult as any).rows?.[0];
    if (!user) {
      return res.status(404).json({ success: false, message: "사용자를 찾을 수 없습니다.", error: "user_not_found" });
    }
    if (user.role === "super_admin") {
      return res.status(400).json({ success: false, message: "슈퍼관리자 권한은 변경할 수 없습니다.", error: "cannot_modify_super_admin" });
    }

    const validKeys = ["canViewPools", "canEditPools", "canApprovePools", "canManageSubscriptions", "canManagePlatformAdmins"];
    const sanitized: Record<string, boolean> = {};
    for (const key of validKeys) {
      if (key in permissions) sanitized[key] = Boolean(permissions[key]);
    }

    const result = await db.execute(sql`
      UPDATE users
      SET permissions = permissions || ${JSON.stringify(sanitized)}::jsonb, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, email, name, phone, role, permissions, created_at
    `);
    res.json({ success: true, data: (result as any).rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다.", error: String(err) });
  }
});

// ── 수영장 상세 조회 (플랫폼 관리자, 권한 체크) ─────────────────────
router.get("/pools/:id/detail", requireAuth, requirePermission("canViewPools"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const poolResult = await db.execute(sql`SELECT * FROM swimming_pools WHERE id = ${id} LIMIT 1`);
    const pool = (poolResult as any).rows[0];
    if (!pool) return res.status(404).json({ success: false, message: "수영장을 찾을 수 없습니다.", error: "pool_not_found" });

    const [stats] = await Promise.all([
      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM students WHERE swimming_pool_id = ${id} AND status = 'active') AS student_count,
          (SELECT COUNT(*) FROM users WHERE swimming_pool_id = ${id} AND role = 'teacher') AS teacher_count,
          (SELECT COUNT(*) FROM class_groups WHERE swimming_pool_id = ${id}) AS class_count
      `)
    ]);

    const role = req.user!.role;
    const perms = req.user!.permissions;
    const canEdit = role === "super_admin" || perms?.canEditPools === true;

    res.json({ success: true, data: { ...pool, ...((stats as any).rows[0] || {}), canEdit } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다.", error: String(err) });
  }
});

router.get("/parents", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    let poolId: string | null = null;
    if (req.user!.role === "pool_admin") {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = u?.swimming_pool_id || null;
    } else {
      poolId = req.query.pool_id as string || null;
    }
    if (!poolId) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
    const parents = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.swimming_pool_id, poolId));
    const enriched = await Promise.all(parents.map(async (pa) => {
      const links = await db.select().from(parentStudentsTable).where(eq(parentStudentsTable.parent_id, pa.id));
      const linkedStudents = await Promise.all(links.map(async (l) => {
        const [s] = await db.select({ id: studentsTable.id, name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, l.student_id)).limit(1);
        return s ? { ...s, link_id: l.id, status: l.status, rejection_reason: l.rejection_reason, created_at: l.created_at } : null;
      }));

      // 학부모 가입 신청 시 입력한 자녀명 조회 (전화번호 기준 매칭, 최신 approved 요청)
      const reqRow = await db.execute(sql`
        SELECT child_name, children_requested FROM parent_pool_requests
        WHERE swimming_pool_id = ${poolId} AND phone = ${pa.phone}
        ORDER BY requested_at DESC LIMIT 1
      `);
      const reqData = reqRow.rows[0] as any;
      let requested_children: Array<{ childName: string; childBirthYear?: number | null }> = [];
      if (reqData) {
        const cr = typeof reqData.children_requested === "string"
          ? JSON.parse(reqData.children_requested || "[]")
          : (reqData.children_requested || []);
        if (cr.length > 0) {
          requested_children = cr;
        } else if (reqData.child_name) {
          requested_children = [{ childName: reqData.child_name }];
        }
      }

      return { ...pa, pin_hash: undefined, students: linkedStudents.filter(Boolean), requested_children };
    }));
    res.json(enriched);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/parents", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, pin } = req.body;
  if (!name || !phone || !pin) { res.status(400).json({ error: "이름, 전화번호, PIN을 입력해주세요." }); return; }
  if (pin.length < 4) { res.status(400).json({ error: "PIN은 4자리 이상이어야 합니다." }); return; }
  try {
    let poolId: string | null = null;
    if (req.user!.role === "pool_admin") {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = u?.swimming_pool_id || null;
    } else {
      poolId = req.body.swimming_pool_id || null;
    }
    if (!poolId) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
    const pin_hash = await hashPassword(pin);
    const id = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [pa] = await db.insert(parentAccountsTable).values({ id, swimming_pool_id: poolId, phone, pin_hash, name }).returning();
    res.status(201).json({ ...pa, pin_hash: undefined, students: [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique")) { res.status(400).json({ error: "이미 등록된 전화번호입니다." }); }
    else { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
  }
});

router.delete("/parents/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(parentStudentsTable).where(eq(parentStudentsTable.parent_id, req.params.id));
    await db.delete(parentAccountsTable).where(eq(parentAccountsTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/parents/:id/students", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { student_id } = req.body;
  if (!student_id) { res.status(400).json({ error: "student_id가 필요합니다." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.params.id)).limit(1);
    if (!pa) { res.status(404).json({ error: "학부모 계정을 찾을 수 없습니다." }); return; }
    const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
    const linkId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [link] = await db.insert(parentStudentsTable).values({
      id: linkId, parent_id: req.params.id, student_id, swimming_pool_id: pa.swimming_pool_id,
      status: "pending",
    }).returning();
    res.status(201).json({ ...link, student_name: s?.name || null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique")) { res.status(400).json({ error: "이미 연결 요청된 학생입니다." }); }
    else { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
  }
});

router.patch("/parents/:id/students/:link_id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { action, reason } = req.body;
  if (!["approve", "reject"].includes(action)) {
    res.status(400).json({ error: "action은 approve 또는 reject여야 합니다." }); return;
  }
  try {
    const [link] = await db.update(parentStudentsTable)
      .set({
        status: action === "approve" ? "approved" : "rejected",
        approved_by: action === "approve" ? req.user!.userId : null,
        approved_at: action === "approve" ? new Date() : null,
        rejection_reason: action === "reject" ? (reason || "관리자 거부") : null,
      })
      .where(eq(parentStudentsTable.id, req.params.link_id))
      .returning();
    if (!link) { res.status(404).json({ error: "연결 요청을 찾을 수 없습니다." }); return; }
    res.json(link);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.delete("/parents/:id/students/:link_id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(parentStudentsTable).where(eq(parentStudentsTable.id, req.params.link_id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/student-requests", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    let poolId: string | null = null;
    if (req.user!.role === "pool_admin") {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = u?.swimming_pool_id || null;
    } else {
      poolId = req.query.pool_id as string || null;
    }
    if (!poolId) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }

    const { status } = req.query;
    const requests = await db.select().from(studentRegistrationRequestsTable)
      .where(eq(studentRegistrationRequestsTable.swimming_pool_id, poolId));

    const filtered = status && status !== "all" ? requests.filter(r => r.status === status) : requests;
    const enriched = await Promise.all(filtered.map(async (r) => {
      const [pa] = await db.select({ id: parentAccountsTable.id, name: parentAccountsTable.name, phone: parentAccountsTable.phone })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, r.parent_id)).limit(1);
      return { ...r, parent: pa || null };
    }));
    res.json(enriched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/student-requests/:id/pool-students", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const [srr] = await db.select().from(studentRegistrationRequestsTable)
      .where(eq(studentRegistrationRequestsTable.id, req.params.id)).limit(1);
    if (!srr) { res.status(404).json({ error: "요청을 찾을 수 없습니다." }); return; }

    const [pa] = await db.select({ phone: parentAccountsTable.phone })
      .from(parentAccountsTable).where(eq(parentAccountsTable.id, srr.parent_id)).limit(1);
    const parentPhone = pa?.phone || null;

    const poolStudents = await db.select({
      id: studentsTable.id, name: studentsTable.name,
      birth_date: studentsTable.birth_date, phone: studentsTable.phone,
      class_group_id: studentsTable.class_group_id,
    }).from(studentsTable).where(eq(studentsTable.swimming_pool_id, srr.swimming_pool_id));

    const alreadyLinked = await db.select({ student_id: parentStudentsTable.student_id })
      .from(parentStudentsTable).where(eq(parentStudentsTable.parent_id, srr.parent_id));
    const linkedIds = new Set(alreadyLinked.map(l => l.student_id));

    const normalizePhone = (p: string | null) => (p || "").replace(/\D/g, "");
    const parentPhoneNorm = normalizePhone(parentPhone);

    const result = poolStudents.map(s => ({
      ...s,
      already_linked: linkedIds.has(s.id),
      phone_match: parentPhoneNorm.length > 0 && normalizePhone(s.phone) === parentPhoneNorm,
    })).sort((a, b) => {
      if (a.phone_match && !b.phone_match) return -1;
      if (!a.phone_match && b.phone_match) return 1;
      return a.name.localeCompare(b.name, "ko");
    });
    res.json({ parent_phone: parentPhone, students: result });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.patch("/student-requests/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { action, student_ids, reason } = req.body;
  if (!["link", "reject"].includes(action)) {
    res.status(400).json({ error: "action은 link 또는 reject여야 합니다." }); return;
  }
  try {
    const [srr] = await db.select().from(studentRegistrationRequestsTable)
      .where(eq(studentRegistrationRequestsTable.id, req.params.id)).limit(1);
    if (!srr) { res.status(404).json({ error: "요청을 찾을 수 없습니다." }); return; }
    if (srr.status !== "pending") { res.status(400).json({ error: "이미 처리된 요청입니다." }); return; }

    if (action === "link") {
      if (!Array.isArray(student_ids) || student_ids.length === 0) {
        res.status(400).json({ error: "연결할 학생을 1명 이상 선택해주세요." }); return;
      }
      for (const studentId of student_ids) {
        const existing = await db.select().from(parentStudentsTable)
          .where(and(eq(parentStudentsTable.parent_id, srr.parent_id), eq(parentStudentsTable.student_id, studentId))).limit(1);
        if (existing.length > 0) continue;
        const linkId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.insert(parentStudentsTable).values({
          id: linkId, parent_id: srr.parent_id, student_id: studentId,
          swimming_pool_id: srr.swimming_pool_id, status: "approved",
          approved_by: req.user!.userId, approved_at: new Date(),
        });
      }
      await db.update(studentRegistrationRequestsTable)
        .set({ status: "approved", reviewed_by: req.user!.userId, reviewed_at: new Date() })
        .where(eq(studentRegistrationRequestsTable.id, req.params.id));
      res.json({ linked: true, student_ids });
    } else {
      await db.update(studentRegistrationRequestsTable)
        .set({ status: "rejected", reviewed_by: req.user!.userId, reviewed_at: new Date(), rejection_reason: reason || "관리자 거부" })
        .where(eq(studentRegistrationRequestsTable.id, req.params.id));
      res.json({ linked: false });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 플랫폼 전체 통계 (super_admin) ───────────────────────────────────
router.get("/platform-stats", requireAuth, requireRole("super_admin"), async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                      AS total_pools,
        COUNT(*) FILTER (WHERE approval_status = 'approved')::int         AS approved_pools,
        COUNT(*) FILTER (WHERE approval_status = 'pending')::int          AS pending_pools,
        COUNT(*) FILTER (WHERE approval_status = 'rejected')::int         AS rejected_pools
      FROM swimming_pools
    `);
    const row = result.rows[0] as any;

    // 학생 수 기반 유료/무료 분류 (승인된 수영장만)
    const pools = await db.select({ id: swimmingPoolsTable.id, approval_status: swimmingPoolsTable.approval_status })
      .from(swimmingPoolsTable);
    let paidCount = 0;
    let freeCount = 0;
    await Promise.all(pools.map(async (p) => {
      if (p.approval_status !== "approved") return;
      const cnt = await db.execute(sql`
        SELECT COUNT(*) AS c FROM students WHERE swimming_pool_id = ${p.id} AND status = 'active'
      `);
      const n = Number((cnt.rows[0] as any)?.c ?? 0);
      if (n > 50) paidCount++;
      else freeCount++;
    }));

    res.json({
      total_pools:    row.total_pools,
      approved_pools: row.approved_pools,
      pending_pools:  row.pending_pools,
      rejected_pools: row.rejected_pools,
      paid_pools:     paidCount,
      free_pools:     freeCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 저장 용량 정책 조회 ───────────────────────────────────────────────
router.get("/storage-policy", requireAuth, requireRole("super_admin", "pool_admin"), async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM storage_policy ORDER BY quota_gb ASC
    `);
    res.json(rows.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 저장 용량 정책 수정 (super_admin 전용) ───────────────────────────
router.put("/storage-policy/:tier", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { quota_gb, per_member_mb, extra_price_per_gb, description } = req.body;
  try {
    const result = await db.execute(sql`
      UPDATE storage_policy
      SET quota_gb = ${quota_gb}, per_member_mb = ${per_member_mb},
          extra_price_per_gb = ${extra_price_per_gb}, description = ${description || null},
          updated_at = now()
      WHERE tier = ${req.params.tier}
      RETURNING *
    `);
    if (!result.rows.length) { res.status(404).json({ error: "해당 정책을 찾을 수 없습니다." }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 구독 상태 조회 (pool_admin용) ─────────────────────────────────────
router.get("/subscription-status", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      let poolId: string | null = null;
      if (req.user!.role === "pool_admin") {
        const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
          .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
        poolId = me?.swimming_pool_id ?? null;
      } else {
        const pid = req.query.pool_id as string | undefined;
        poolId = pid ?? null;
      }
      if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

      const [pool] = await db.select({ approval_status: swimmingPoolsTable.approval_status })
        .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, poolId)).limit(1);
      const approved = pool?.approval_status === "approved";

      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM students
        WHERE swimming_pool_id = ${poolId} AND status = 'active'
      `);
      const count = Number((countResult.rows[0] as any)?.cnt ?? 0);

      const tier = getSubscriptionTier(approved, count);
      const planLabels: Record<string, string> = {
        free: "무료 이용",
        paid_100: "100명 플랜",
        paid_300: "300명 플랜",
        paid_500: "500명 플랜",
        paid_1000: "1,000명 플랜",
        paid_enterprise: "엔터프라이즈 플랜",
        unapproved: "미승인",
      };

      res.json({
        member_count: count,
        tier: tier.tier,
        plan_label: planLabels[tier.tier] ?? tier.label,
        is_free: tier.isFree,
        is_paid: !tier.isFree && approved,
        status_label: !approved ? "미승인" : tier.isFree ? "무료 이용" : "유료 이용",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ── 탈퇴 회원 목록 조회 ──────────────────────────────────────────────
router.get("/withdrawn-members", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      let poolId: string | null = null;
      if (req.user!.role === "pool_admin") {
        const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
          .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
        poolId = me?.swimming_pool_id ?? null;
      } else {
        poolId = req.query.pool_id as string ?? null;
      }
      if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

      const students = await db.execute(sql`
        SELECT
          s.id, s.name, s.phone, s.last_class_group_name,
          s.withdrawn_at, s.deleted_at, s.archived_reason, s.status,
          COUNT(a.id)::int AS attendance_count
        FROM students s
        LEFT JOIN attendance a ON a.student_id = s.id
        WHERE s.swimming_pool_id = ${poolId}
          AND s.status IN ('withdrawn', 'deleted')
        GROUP BY s.id, s.name, s.phone, s.last_class_group_name,
                 s.withdrawn_at, s.deleted_at, s.archived_reason, s.status
        ORDER BY GREATEST(COALESCE(s.withdrawn_at, '1970-01-01'), COALESCE(s.deleted_at, '1970-01-01')) DESC
      `);
      res.json(students.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

router.get("/pending-connections", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    let poolId: string | null = null;
    if (req.user!.role === "pool_admin") {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = u?.swimming_pool_id || null;
    } else {
      poolId = req.query.pool_id as string || null;
    }
    if (!poolId) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
    const links = await db.select().from(parentStudentsTable).where(
      and(eq(parentStudentsTable.swimming_pool_id, poolId), eq(parentStudentsTable.status, "pending"))
    );
    const enriched = await Promise.all(links.map(async (l) => {
      const [pa] = await db.select({ id: parentAccountsTable.id, name: parentAccountsTable.name, phone: parentAccountsTable.phone }).from(parentAccountsTable).where(eq(parentAccountsTable.id, l.parent_id)).limit(1);
      const [s] = await db.select({ id: studentsTable.id, name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, l.student_id)).limit(1);
      return { link_id: l.id, status: l.status, created_at: l.created_at, parent: pa, student: s };
    }));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ════════════════════════════════════════════════════════════════════════
// 신규: 대시보드 통합 통계
// ════════════════════════════════════════════════════════════════════════
async function getAdminPoolId(req: AuthRequest): Promise<string | null> {
  if (req.user!.role === "pool_admin") {
    const [u] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    return u?.swimming_pool_id ?? null;
  }
  return req.query.pool_id as string ?? null;
}

async function writeActivityLog(opts: {
  poolId: string; studentId?: string | null; parentId?: string | null;
  targetName: string; actionType: string; targetType: string;
  beforeValue?: string | null; afterValue?: string | null;
  actorId: string; actorName: string; actorRole: string; note?: string | null;
}) {
  const id = `mal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await db.execute(sql`
    INSERT INTO member_activity_logs
      (id, swimming_pool_id, student_id, parent_id, target_name, action_type, target_type,
       before_value, after_value, actor_id, actor_name, actor_role, note)
    VALUES
      (${id}, ${opts.poolId}, ${opts.studentId ?? null}, ${opts.parentId ?? null},
       ${opts.targetName}, ${opts.actionType}, ${opts.targetType},
       ${opts.beforeValue ?? null}, ${opts.afterValue ?? null},
       ${opts.actorId}, ${opts.actorName}, ${opts.actorRole}, ${opts.note ?? null})
  `);
}

router.get("/dashboard-stats", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 정보가 없습니다." }); return; }

      const today = new Date().toISOString().split("T")[0];

      const [statsRow] = (await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('withdrawn','deleted'))::int AS total_members,
          COUNT(*) FILTER (WHERE status NOT IN ('withdrawn','deleted') AND (class_group_id IS NULL OR class_group_id = ''))::int AS unassigned_members,
          COUNT(*) FILTER (WHERE status = 'withdrawn')::int AS withdrawn_members,
          COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted_members,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND status NOT IN ('withdrawn','deleted'))::int AS new_this_week
        FROM students WHERE swimming_pool_id = ${poolId}
      `)).rows as any[];

      const [attRow] = (await db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'present')::int AS today_present
        FROM attendance WHERE date = ${today} AND swimming_pool_id = ${poolId}
      `)).rows as any[];

      const [pendingRow] = (await db.execute(sql`
        SELECT COUNT(*)::int AS pending_requests FROM student_registration_requests
        WHERE swimming_pool_id = ${poolId} AND status = 'pending'
      `)).rows as any[];

      const [parentPendingRow] = (await db.execute(sql`
        SELECT COUNT(*)::int AS parent_pending FROM parent_students
        WHERE swimming_pool_id = ${poolId} AND status = 'pending'
      `)).rows as any[];

      const [diaryRow] = (await db.execute(sql`
        SELECT COUNT(DISTINCT cg.id)::int AS total_classes,
               COUNT(DISTINCT cd.class_group_id) FILTER (WHERE cd.lesson_date = ${today})::int AS diary_done_today
        FROM class_groups cg
        LEFT JOIN class_diaries cd ON cd.class_group_id = cg.id AND cd.is_deleted = false
        WHERE cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
      `)).rows as any[];

      const [teacherRow] = (await db.execute(sql`
        SELECT COUNT(*)::int AS total_teachers
        FROM users WHERE swimming_pool_id = ${poolId} AND role = 'teacher'
      `)).rows as any[];

      // 최근 등록 회원 5명
      const recentMembers = (await db.execute(sql`
        SELECT id, name, status, class_group_id, created_at,
               (SELECT cg.name FROM class_groups cg WHERE cg.id = s.class_group_id LIMIT 1) AS class_name
        FROM students s
        WHERE swimming_pool_id = ${poolId} AND status NOT IN ('withdrawn','deleted')
        ORDER BY created_at DESC LIMIT 5
      `)).rows;

      // 최근 활동 로그 10건
      const activityLogs = (await db.execute(sql`
        SELECT * FROM member_activity_logs
        WHERE swimming_pool_id = ${poolId}
        ORDER BY created_at DESC LIMIT 10
      `)).rows;

      res.json({
        total_members:   statsRow?.total_members   ?? 0,
        unassigned:      statsRow?.unassigned_members ?? 0,
        withdrawn:       statsRow?.withdrawn_members ?? 0,
        deleted_members: statsRow?.deleted_members ?? 0,
        new_this_week:   statsRow?.new_this_week ?? 0,
        today_present:   attRow?.today_present ?? 0,
        pending_requests: Number(pendingRow?.pending_requests ?? 0) + Number(parentPendingRow?.parent_pending ?? 0),
        total_classes:   diaryRow?.total_classes ?? 0,
        diary_done_today: diaryRow?.diary_done_today ?? 0,
        total_teachers:  teacherRow?.total_teachers ?? 0,
        expiring_soon:   0,
        recent_members:  recentMembers,
        activity_logs:   activityLogs,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 통합 검색 ────────────────────────────────────────────────────────────
router.get("/search", requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      if (q.length < 1) { res.json({ students: [], teachers: [], classes: [], notices: [], parents: [] }); return; }
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 정보가 없습니다." }); return; }

      const pattern = `%${q}%`;
      const [students, teachers, classes, notices, parents] = await Promise.all([
        db.execute(sql`
          SELECT id, name, status, class_group_id, birth_year, parent_name,
                 (SELECT cg.name FROM class_groups cg WHERE cg.id = s.class_group_id LIMIT 1) AS class_name
          FROM students s
          WHERE swimming_pool_id = ${poolId} AND status NOT IN ('deleted')
            AND (name ILIKE ${pattern} OR parent_name ILIKE ${pattern})
          ORDER BY name LIMIT 10
        `),
        db.execute(sql`
          SELECT id, name, phone FROM users
          WHERE swimming_pool_id = ${poolId} AND role = 'teacher'
            AND name ILIKE ${pattern}
          LIMIT 5
        `),
        db.execute(sql`
          SELECT id, name, schedule_days, schedule_time, instructor
          FROM class_groups
          WHERE swimming_pool_id = ${poolId} AND is_deleted = false
            AND name ILIKE ${pattern}
          LIMIT 5
        `),
        db.execute(sql`
          SELECT id, title, notice_type, created_at FROM notices
          WHERE swimming_pool_id = ${poolId} AND title ILIKE ${pattern}
          ORDER BY created_at DESC LIMIT 5
        `),
        db.execute(sql`
          SELECT id, name, phone FROM parent_accounts
          WHERE swimming_pool_id = ${poolId} AND name ILIKE ${pattern}
          LIMIT 5
        `),
      ]);

      res.json({
        students: students.rows,
        teachers: teachers.rows,
        classes:  classes.rows,
        notices:  notices.rows,
        parents:  parents.rows,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 수영장 활동 로그 ─────────────────────────────────────────────────────
router.get("/activity-logs", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 정보가 없습니다." }); return; }
      const { limit = "30", offset = "0" } = req.query;
      const rows = await db.execute(sql`
        SELECT * FROM member_activity_logs
        WHERE swimming_pool_id = ${poolId}
        ORDER BY created_at DESC
        LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
      `);
      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 회원별 활동 로그 ──────────────────────────────────────────────────────
router.get("/member-logs/:studentId", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 정보가 없습니다." }); return; }
      const rows = await db.execute(sql`
        SELECT * FROM member_activity_logs
        WHERE swimming_pool_id = ${poolId} AND student_id = ${req.params.studentId}
        ORDER BY created_at DESC LIMIT 50
      `);
      res.json(rows.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 회원 상태 변경 (활동 로그 자동 기록) ─────────────────────────────────
router.patch("/students/:id/status", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { status, reason } = req.body;
      const allowedStatus = ["active", "inactive", "withdrawn", "suspended"];
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ error: "유효하지 않은 상태값입니다." });
      }
      const poolId = await getAdminPoolId(req);
      if (!poolId) { return res.status(403).json({ error: "수영장 정보가 없습니다." }); }

      const [student] = (await db.execute(sql`SELECT id, name, status FROM students WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`)).rows as any[];
      if (!student) { return res.status(404).json({ error: "회원을 찾을 수 없습니다." }); }

      const [actor] = (await db.execute(sql`SELECT name FROM users WHERE id = ${req.user!.userId}`)).rows as any[];
      const actorName = actor?.name || req.user!.userId;

      if (status === 'withdrawn') {
        await db.execute(sql`UPDATE students SET status = ${status}, archived_reason = ${reason ?? null}, withdrawn_at = NOW(), updated_at = NOW() WHERE id = ${req.params.id}`);
      } else {
        await db.execute(sql`UPDATE students SET status = ${status}, archived_reason = ${reason ?? null}, updated_at = NOW() WHERE id = ${req.params.id}`);
      }

      await writeActivityLog({
        poolId, studentId: req.params.id, targetName: student.name,
        actionType: "update", targetType: "status",
        beforeValue: student.status, afterValue: status,
        actorId: req.user!.userId, actorName, actorRole: req.user!.role,
        note: reason,
      });
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 회원 복구 (deleted → active) ──────────────────────────────────────────
router.post("/students/:id/restore", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { return res.status(403).json({ error: "수영장 정보가 없습니다." }); }

      const [student] = (await db.execute(sql`SELECT id, name, status FROM students WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`)).rows as any[];
      if (!student) { return res.status(404).json({ error: "회원을 찾을 수 없습니다." }); }
      if (!["withdrawn", "deleted"].includes(student.status)) {
        return res.status(400).json({ error: "탈퇴/삭제 회원만 복구할 수 있습니다." });
      }

      const [actor] = (await db.execute(sql`SELECT name FROM users WHERE id = ${req.user!.userId}`)).rows as any[];
      const actorName = actor?.name || req.user!.userId;

      await db.execute(sql`
        UPDATE students SET status = 'active', withdrawn_at = NULL, deleted_at = NULL,
          archived_reason = NULL, updated_at = NOW()
        WHERE id = ${req.params.id}
      `);

      await writeActivityLog({
        poolId, studentId: req.params.id, targetName: student.name,
        actionType: "restore", targetType: "status",
        beforeValue: student.status, afterValue: "active",
        actorId: req.user!.userId, actorName, actorRole: req.user!.role,
      });
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 회원 정보 수정 (활동 로그 자동 기록) ──────────────────────────────────
router.patch("/students/:id/info", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { return res.status(403).json({ error: "수영장 정보가 없습니다." }); }
      const { name, phone, birth_year, parent_name, parent_phone, memo } = req.body;

      const [student] = (await db.execute(sql`SELECT * FROM students WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}`)).rows as any[];
      if (!student) { return res.status(404).json({ error: "회원을 찾을 수 없습니다." }); }

      const [actor] = (await db.execute(sql`SELECT name FROM users WHERE id = ${req.user!.userId}`)).rows as any[];
      const actorName = actor?.name || req.user!.userId;

      const changes: string[] = [];
      if (name && name !== student.name) changes.push(`이름: ${student.name}→${name}`);
      if (phone && phone !== student.phone) changes.push(`연락처: ${student.phone}→${phone}`);
      if (birth_year && String(birth_year) !== String(student.birth_year)) changes.push(`출생년: ${student.birth_year}→${birth_year}`);
      if (parent_name && parent_name !== student.parent_name) changes.push(`보호자: ${student.parent_name}→${parent_name}`);
      if (parent_phone && parent_phone !== student.parent_phone) changes.push(`보호자연락처 변경`);

      await db.execute(sql`
        UPDATE students SET
          name = COALESCE(${name ?? null}, name),
          phone = COALESCE(${phone ?? null}, phone),
          birth_year = COALESCE(${birth_year ?? null}, birth_year),
          parent_name = COALESCE(${parent_name ?? null}, parent_name),
          parent_phone = COALESCE(${parent_phone ?? null}, parent_phone),
          memo = COALESCE(${memo ?? null}, memo),
          updated_at = NOW()
        WHERE id = ${req.params.id}
      `);

      if (changes.length > 0) {
        await writeActivityLog({
          poolId, studentId: req.params.id, targetName: student.name,
          actionType: "update", targetType: "info",
          afterValue: changes.join(", "),
          actorId: req.user!.userId, actorName, actorRole: req.user!.role,
        });
      }
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 회원 상세 (통합 데이터 + 수업 + 출결 + 일지) ─────────────────────────
router.get("/students/:id/detail", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { return res.status(403).json({ error: "수영장 정보가 없습니다." }); }

      const [student] = (await db.execute(sql`
        SELECT s.*,
          (SELECT cg.name FROM class_groups cg WHERE cg.id = s.class_group_id LIMIT 1) AS class_name,
          (SELECT u.name FROM users u WHERE u.id = cg.teacher_user_id LIMIT 1) AS teacher_name,
          (SELECT pa.name FROM parent_students ps JOIN parent_accounts pa ON pa.id = ps.parent_id
           WHERE ps.student_id = s.id AND ps.status = 'approved' LIMIT 1) AS parent_account_name,
          (SELECT ps.status FROM parent_students ps WHERE ps.student_id = s.id ORDER BY ps.created_at DESC LIMIT 1) AS parent_link_status
        FROM students s
        LEFT JOIN class_groups cg ON cg.id = s.class_group_id
        WHERE s.id = ${req.params.id} AND s.swimming_pool_id = ${poolId}
      `)).rows as any[];
      if (!student) { return res.status(404).json({ error: "회원을 찾을 수 없습니다." }); }

      // 최근 출결 30일
      const attendance = (await db.execute(sql`
        SELECT date, status, class_group_id FROM attendance
        WHERE student_id = ${req.params.id}
        ORDER BY date DESC LIMIT 30
      `)).rows;

      // 최근 일지 (본인 반)
      const diaries = student.class_group_id ? (await db.execute(sql`
        SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.is_edited,
               csn.note_content AS student_note
        FROM class_diaries cd
        LEFT JOIN class_diary_student_notes csn ON csn.diary_id = cd.id AND csn.student_id = ${req.params.id} AND csn.is_deleted = false
        WHERE cd.class_group_id = ${student.class_group_id} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC LIMIT 10
      `)).rows : [];

      res.json({ ...student, recent_attendance: attendance, recent_diaries: diaries });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ─────────────────────────────────────────
// 보강 시스템 API
// ─────────────────────────────────────────

// GET /admin/makeups — 전체 보강 목록 (필터: status, student_id, teacher_id)
router.get("/makeups", requireAuth, requireRole("super_admin","pool_admin","teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const { status, student_id, teacher_id, assigned_teacher_id } = req.query;
      const conditions: string[] = [`swimming_pool_id = '${poolId}'`];
      if (status) conditions.push(`status = '${status}'`);
      if (student_id) conditions.push(`student_id = '${student_id}'`);
      if (teacher_id) conditions.push(`original_teacher_id = '${teacher_id}'`);
      if (assigned_teacher_id) conditions.push(`(assigned_teacher_id = '${assigned_teacher_id}' OR transferred_to_teacher_id = '${assigned_teacher_id}')`);
      const rows = (await db.execute(sql.raw(`
        SELECT * FROM makeup_sessions
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
      `))).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// GET /admin/makeups/eligible-classes — 보강 가능 반 (정원 여유 있는 반만)
router.get("/makeups/eligible-classes", requireAuth, requireRole("super_admin","pool_admin","teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const { teacher_id } = req.query;
      const whereClause = teacher_id
        ? `WHERE cg.swimming_pool_id = '${poolId}' AND cg.is_deleted = false AND cg.teacher_user_id = '${teacher_id}'`
        : `WHERE cg.swimming_pool_id = '${poolId}' AND cg.is_deleted = false`;
      const rows = (await db.execute(sql.raw(`
        SELECT
          cg.id, cg.name, cg.schedule_days, cg.schedule_time,
          cg.capacity, cg.instructor, cg.teacher_user_id,
          COUNT(s.id)::int AS current_members
        FROM class_groups cg
        LEFT JOIN students s ON s.class_group_id = cg.id AND s.status NOT IN ('withdrawn','deleted')
        ${whereClause}
        GROUP BY cg.id
        ORDER BY cg.schedule_days, cg.schedule_time
      `))).rows as any[];
      const eligible = rows.map(r => ({
        ...r,
        available_slots: r.capacity ? Math.max(0, r.capacity - r.current_members) : 999,
        is_eligible: r.capacity ? r.current_members < r.capacity : true,
      })).filter(r => r.is_eligible);
      res.json(eligible);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// GET /admin/makeups/student/:studentId — 특정 회원 보강 이력
router.get("/makeups/student/:studentId", requireAuth, requireRole("super_admin","pool_admin","teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const rows = (await db.execute(sql`
        SELECT * FROM makeup_sessions
        WHERE swimming_pool_id = ${poolId} AND student_id = ${req.params.studentId}
        ORDER BY absence_date DESC
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// PATCH /admin/makeups/:id/assign — 담당선생님 보강 반 배정
router.patch("/makeups/:id/assign", requireAuth, requireRole("super_admin","pool_admin","teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const { class_group_id, assigned_date } = req.body;
      if (!class_group_id) { res.status(400).json({ error: "class_group_id 필요" }); return; }
      const [cg] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, class_group_id)).limit(1);
      if (!cg) { res.status(404).json({ error: "반 없음" }); return; }
      const actor = req.user as any;
      await db.execute(sql`
        UPDATE makeup_sessions SET
          status = 'assigned',
          assigned_class_group_id = ${class_group_id},
          assigned_class_group_name = ${cg.name},
          assigned_teacher_id = ${cg.teacher_user_id || null},
          assigned_teacher_name = ${cg.instructor || null},
          assigned_date = ${assigned_date || null},
          updated_at = now()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      `);
      await writeActivityLog(poolId, null, null, "makeup_assigned", "makeup", req.params.id,
        "waiting", "assigned", actor.userId, actor.name || "관리자", actor.role,
        `보강반 배정: ${cg.name}`);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// PATCH /admin/makeups/:id/transfer — 다른 선생님 보강으로 이동
router.patch("/makeups/:id/transfer", requireAuth, requireRole("super_admin","pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const { target_teacher_id, target_teacher_name } = req.body;
      if (!target_teacher_id) { res.status(400).json({ error: "target_teacher_id 필요" }); return; }
      const actor = req.user as any;
      await db.execute(sql`
        UPDATE makeup_sessions SET
          status = 'transferred',
          transferred_to_teacher_id = ${target_teacher_id},
          transferred_to_teacher_name = ${target_teacher_name || null},
          transferred_at = now(),
          transferred_by = ${actor.userId},
          transferred_by_name = ${actor.name || "관리자"},
          is_substitute = true,
          updated_at = now()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      `);
      await writeActivityLog(poolId, null, null, "makeup_transferred", "makeup", req.params.id,
        null, target_teacher_name, actor.userId, actor.name || "관리자", actor.role,
        `보강 이동: ${target_teacher_name} 선생님`);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// PATCH /admin/makeups/:id/complete — 보강 완료 처리
router.patch("/makeups/:id/complete", requireAuth, requireRole("super_admin","pool_admin","teacher"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const { substitute_teacher_id, substitute_teacher_name, note } = req.body;
      const actor = req.user as any;
      const rows = (await db.execute(sql`SELECT * FROM makeup_sessions WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} LIMIT 1`)).rows as any[];
      const mk = rows[0];
      if (!mk) { res.status(404).json({ error: "보강 없음" }); return; }
      const isSubstitute = substitute_teacher_id && substitute_teacher_id !== mk.original_teacher_id;
      await db.execute(sql`
        UPDATE makeup_sessions SET
          status = 'completed',
          is_substitute = ${isSubstitute || false},
          substitute_teacher_id = ${substitute_teacher_id || null},
          substitute_teacher_name = ${substitute_teacher_name || null},
          completed_at = now(),
          note = ${note || null},
          updated_at = now()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      `);
      const completedNote = isSubstitute
        ? `대리보강 완료: ${substitute_teacher_name} 선생님 (원담당: ${mk.original_teacher_name})`
        : `보강 완료`;
      await writeActivityLog(poolId, mk.student_id, mk.student_name, "makeup_completed", "makeup", req.params.id,
        "assigned", "completed", actor.userId, actor.name || "관리자", actor.role, completedNote);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// PATCH /admin/makeups/:id/cancel — 보강 취소
router.patch("/makeups/:id/cancel", requireAuth, requireRole("super_admin","pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const actor = req.user as any;
      await db.execute(sql`
        UPDATE makeup_sessions SET status = 'cancelled', updated_at = now()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      `);
      await writeActivityLog(poolId, null, null, "makeup_cancelled", "makeup", req.params.id,
        null, "cancelled", actor.userId, actor.name || "관리자", actor.role, "보강 취소");
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ─────────────────────────────────────────
// 선생님 운영 허브 API
// ─────────────────────────────────────────

// GET /admin/teacher-hub/:teacherId — 선생님 운영 현황 허브
router.get("/teacher-hub/:teacherId", requireAuth, requireRole("super_admin","pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const { teacherId } = req.params;
      const today = new Date().toISOString().split("T")[0];

      const [teacherUser] = await db.select().from(usersTable).where(eq(usersTable.id, teacherId)).limit(1);
      if (!teacherUser) { res.status(404).json({ error: "선생님 없음" }); return; }

      const [statsRow] = (await db.execute(sql.raw(`
        SELECT
          COUNT(DISTINCT cg.id)::int AS class_count,
          COUNT(DISTINCT s.id)::int AS student_count
        FROM class_groups cg
        LEFT JOIN students s ON s.class_group_id = cg.id AND s.status NOT IN ('withdrawn','deleted')
        WHERE cg.swimming_pool_id = '${poolId}'
          AND cg.teacher_user_id = '${teacherId}'
          AND cg.is_deleted = false
      `))).rows as any[];

      const [attRow] = (await db.execute(sql.raw(`
        SELECT COUNT(*)::int AS today_att FROM attendance
        WHERE swimming_pool_id = '${poolId}' AND date = '${today}'
          AND class_group_id IN (
            SELECT id FROM class_groups WHERE teacher_user_id = '${teacherId}' AND is_deleted = false
          )
      `))).rows as any[];

      const [diaryRow] = (await db.execute(sql.raw(`
        SELECT COUNT(*)::int AS today_diary FROM class_diaries
        WHERE swimming_pool_id = '${poolId}' AND lesson_date = '${today}' AND is_deleted = false
          AND class_group_id IN (
            SELECT id FROM class_groups WHERE teacher_user_id = '${teacherId}' AND is_deleted = false
          )
      `))).rows as any[];

      const [mkRow] = (await db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('waiting','transferred'))::int AS makeup_waiting,
          COUNT(*) FILTER (WHERE status = 'completed' AND is_substitute = true)::int AS substitute_done
        FROM makeup_sessions
        WHERE swimming_pool_id = '${poolId}'
          AND (original_teacher_id = '${teacherId}' OR assigned_teacher_id = '${teacherId}' OR transferred_to_teacher_id = '${teacherId}')
      `))).rows as any[];

      const classes = (await db.execute(sql.raw(`
        SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity,
               COUNT(s.id)::int AS student_count
        FROM class_groups cg
        LEFT JOIN students s ON s.class_group_id = cg.id AND s.status NOT IN ('withdrawn','deleted')
        WHERE cg.swimming_pool_id = '${poolId}'
          AND cg.teacher_user_id = '${teacherId}'
          AND cg.is_deleted = false
        GROUP BY cg.id ORDER BY cg.schedule_days, cg.schedule_time
      `))).rows;

      const recentStudents = (await db.execute(sql.raw(`
        SELECT s.id, s.name, s.status, s.class_group_id,
               (SELECT cg.name FROM class_groups cg WHERE cg.id = s.class_group_id LIMIT 1) AS class_name
        FROM students s
        WHERE s.class_group_id IN (
          SELECT id FROM class_groups WHERE teacher_user_id = '${teacherId}' AND is_deleted = false
        ) AND s.status NOT IN ('withdrawn','deleted')
        ORDER BY s.name LIMIT 30
      `))).rows;

      const recentAttendance = (await db.execute(sql.raw(`
        SELECT a.*, s.name AS student_name, cg.name AS class_name
        FROM attendance a
        LEFT JOIN students s ON s.id = a.student_id
        LEFT JOIN class_groups cg ON cg.id = a.class_group_id
        WHERE a.swimming_pool_id = '${poolId}'
          AND a.class_group_id IN (
            SELECT id FROM class_groups WHERE teacher_user_id = '${teacherId}' AND is_deleted = false
          )
        ORDER BY a.date DESC, a.created_at DESC LIMIT 20
      `))).rows;

      const recentDiaries = (await db.execute(sql.raw(`
        SELECT cd.id, cd.lesson_date, cd.class_group_id, cd.common_content, cd.teacher_name, cd.is_edited,
               cg.name AS class_name
        FROM class_diaries cd
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.swimming_pool_id = '${poolId}' AND cd.is_deleted = false
          AND cd.class_group_id IN (
            SELECT id FROM class_groups WHERE teacher_user_id = '${teacherId}' AND is_deleted = false
          )
        ORDER BY cd.lesson_date DESC LIMIT 10
      `))).rows;

      const makeups = (await db.execute(sql.raw(`
        SELECT * FROM makeup_sessions
        WHERE swimming_pool_id = '${poolId}'
          AND (original_teacher_id = '${teacherId}' OR assigned_teacher_id = '${teacherId}' OR transferred_to_teacher_id = '${teacherId}')
        ORDER BY created_at DESC LIMIT 20
      `))).rows;

      res.json({
        teacher: { id: teacherUser.id, name: teacherUser.name, email: teacherUser.email },
        stats: {
          class_count:     statsRow?.class_count ?? 0,
          student_count:   statsRow?.student_count ?? 0,
          today_att:       attRow?.today_att ?? 0,
          today_diary:     diaryRow?.today_diary ?? 0,
          makeup_waiting:  mkRow?.makeup_waiting ?? 0,
          substitute_done: mkRow?.substitute_done ?? 0,
        },
        classes,
        students: recentStudents,
        recent_attendance: recentAttendance,
        recent_diaries:    recentDiaries,
        makeups,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// GET /admin/teachers — 선생님 목록 + 운영 현황 요약
router.get("/teachers", requireAuth, requireRole("super_admin","pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const today = new Date().toISOString().split("T")[0];
      const teachers = (await db.execute(sql.raw(`
        SELECT
          u.id, u.name, u.email, u.phone,
          COUNT(DISTINCT cg.id)::int AS class_count,
          COUNT(DISTINCT s.id)::int AS student_count,
          COUNT(DISTINCT a.id) FILTER (WHERE a.date = '${today}')::int AS today_att,
          COUNT(DISTINCT cd.id) FILTER (WHERE cd.lesson_date = '${today}' AND cd.is_deleted = false)::int AS today_diary,
          COUNT(DISTINCT mk.id) FILTER (WHERE mk.status IN ('waiting','transferred'))::int AS makeup_waiting
        FROM users u
        LEFT JOIN class_groups cg ON cg.teacher_user_id = u.id AND cg.swimming_pool_id = '${poolId}' AND cg.is_deleted = false
        LEFT JOIN students s ON s.class_group_id = cg.id AND s.status NOT IN ('withdrawn','deleted')
        LEFT JOIN attendance a ON a.class_group_id = cg.id
        LEFT JOIN class_diaries cd ON cd.class_group_id = cg.id AND cd.swimming_pool_id = '${poolId}'
        LEFT JOIN makeup_sessions mk ON mk.swimming_pool_id = '${poolId}'
          AND (mk.original_teacher_id = u.id OR mk.assigned_teacher_id = u.id OR mk.transferred_to_teacher_id = u.id)
        WHERE u.swimming_pool_id = '${poolId}' AND u.role = 'teacher'
        GROUP BY u.id
        ORDER BY u.name
      `))).rows;
      res.json(teachers);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// GET /admin/parents — 학부모 목록
router.get("/parents", requireAuth, requireRole("super_admin","pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const rows = (await db.execute(sql`
        SELECT
          pa.id, pa.name, pa.phone, pa.email, pa.created_at,
          json_agg(json_build_object(
            'id', s.id, 'name', s.name, 'status', s.status,
            'ps_status', ps.status
          )) FILTER (WHERE s.id IS NOT NULL) AS children
        FROM parent_accounts pa
        LEFT JOIN parent_students ps ON ps.parent_account_id = pa.id
        LEFT JOIN students s ON s.id = ps.student_id
        WHERE pa.swimming_pool_id = ${poolId}
        GROUP BY pa.id ORDER BY pa.created_at DESC
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// GET /admin/dashboard-stats2 — 대시보드 V2 (보강 포함)
router.get("/dashboard-stats2", requireAuth, requireRole("super_admin","pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const today = new Date().toISOString().split("T")[0];
      const [mkRow] = (await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('waiting','transferred'))::int AS makeup_waiting,
          COUNT(*) FILTER (WHERE status = 'assigned')::int AS makeup_assigned,
          COUNT(*) FILTER (WHERE is_substitute = true AND status = 'completed')::int AS substitute_done
        FROM makeup_sessions WHERE swimming_pool_id = ${poolId}
      `)).rows as any[];
      const [attRow] = (await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'present')::int AS today_present,
          COUNT(*) FILTER (WHERE status = 'absent')::int AS today_absent
        FROM attendance WHERE swimming_pool_id = ${poolId} AND date = ${today}
      `)).rows as any[];
      res.json({
        makeup_waiting:  mkRow?.makeup_waiting  ?? 0,
        makeup_assigned: mkRow?.makeup_assigned ?? 0,
        substitute_done: mkRow?.substitute_done ?? 0,
        today_present:   attRow?.today_present  ?? 0,
        today_absent:    attRow?.today_absent   ?? 0,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 반 상세 현황판 API ────────────────────────────────────────────────
router.get("/class-groups/:id/detail", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const poolId = await getAdminPoolId(req);
      if (!poolId) { res.status(403).json({ error: "수영장 없음" }); return; }
      const { id } = req.params;
      const date = (req.query.date as string) || new Date().toISOString().split("T")[0];

      // 반 + 선생님 정보
      const cgRows = (await db.execute(sql`
        SELECT cg.id, cg.name, cg.schedule_days, cg.schedule_time, cg.capacity,
               u.id AS teacher_id, u.name AS teacher_name
        FROM class_groups cg
        LEFT JOIN users u ON u.id = cg.teacher_user_id
        WHERE cg.id = ${id} AND cg.swimming_pool_id = ${poolId} AND cg.is_deleted = false
      `)).rows as any[];
      if (!cgRows.length) { res.status(404).json({ error: "반 없음" }); return; }
      const cg = cgRows[0];

      // 학생 목록 + 보강 여부
      const students = (await db.execute(sql`
        SELECT s.id, s.name, s.status,
               EXISTS (
                 SELECT 1 FROM makeup_sessions mk
                 WHERE mk.student_id = s.id
                   AND mk.swimming_pool_id = ${poolId}
                   AND mk.status IN ('assigned','waiting')
               ) AS has_makeup
        FROM students s
        WHERE s.class_group_id = ${id}
          AND s.status NOT IN ('withdrawn','deleted')
        ORDER BY s.name
      `)).rows as any[];

      // 출결 (보강 여부 포함)
      const attendance = (await db.execute(sql`
        SELECT a.student_id, s.name AS student_name, a.status,
               EXISTS (
                 SELECT 1 FROM makeup_sessions mk
                 WHERE mk.student_id = a.student_id
                   AND mk.swimming_pool_id = ${poolId}
                   AND mk.status IN ('assigned','waiting')
               ) AS has_makeup
        FROM attendance a
        LEFT JOIN students s ON s.id = a.student_id
        WHERE a.class_group_id = ${id}
          AND a.swimming_pool_id = ${poolId}
          AND a.date = ${date}
        ORDER BY s.name
      `)).rows as any[];

      // 일지
      const diaryRows = (await db.execute(sql`
        SELECT id, common_content, teacher_name, created_at, is_edited
        FROM class_diaries
        WHERE class_group_id = ${id}
          AND swimming_pool_id = ${poolId}
          AND lesson_date = ${date}
          AND is_deleted = false
        LIMIT 1
      `)).rows as any[];

      res.json({
        class_group: {
          id: cg.id, name: cg.name,
          schedule_days: cg.schedule_days, schedule_time: cg.schedule_time,
          capacity: cg.capacity,
          teacher_id: cg.teacher_id, teacher_name: cg.teacher_name,
        },
        students,
        attendance,
        diary: diaryRows[0] ?? null,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

export default router;
