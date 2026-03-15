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

export default router;
