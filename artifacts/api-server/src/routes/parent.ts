import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { parentAccountsTable, parentStudentsTable, studentsTable, attendanceTable, noticesTable, classGroupsTable, swimmingPoolsTable, studentRegistrationRequestsTable } from "@workspace/db/schema";
import { eq, and, ne, or } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword, comparePassword } from "../lib/auth.js";
import { sendPushToUser } from "../lib/push-service.js";
import { logChange } from "../utils/change-logger.js";
import { logEvent } from "../lib/event-logger.js";
import { getParentStatusV2, upsertParentV2Pending, tryMatchStudentV2 as tryAutoLinkV2, linkParentToStudentV2 as linkParentToStudentV2Import, normalizePhone as normPhoneV2, normalizeName as normNameV2 } from "../lib/auto-link-v2.js";

const router = Router();

function requireParent(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "parent_account") {
    res.status(403).json({ error: "학부모 계정만 접근 가능합니다." }); return;
  }
  next();
}

router.get("/me", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    let poolInfo: { name: string | null; address: string | null; phone: string | null } = { name: null, address: null, phone: null };
    if (pa.swimming_pool_id) {
      const [pool] = await superAdminDb.select({ name: swimmingPoolsTable.name, address: swimmingPoolsTable.address, phone: swimmingPoolsTable.phone })
        .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, pa.swimming_pool_id)).limit(1);
      if (pool) poolInfo = { name: pool.name || null, address: (pool as any).address || null, phone: (pool as any).phone || null };
    }
    res.json({
      id: pa.id, name: pa.name, phone: pa.phone,
      swimming_pool_id: pa.swimming_pool_id,
      pool_name: poolInfo.name, pool_address: poolInfo.address, pool_phone: poolInfo.phone,
      created_at: (pa as any).created_at || null,
    });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.put("/me", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { name, phone, current_password, new_password } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "이름을 입력해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    let newHash: string | undefined;
    if (new_password) {
      if (!current_password) { res.status(400).json({ error: "현재 비밀번호를 입력해주세요." }); return; }
      const valid = await comparePassword(current_password, pa.pin_hash);
      if (!valid) { res.status(400).json({ error: "현재 비밀번호가 올바르지 않습니다." }); return; }
      if (new_password.length < 4) { res.status(400).json({ error: "새 비밀번호는 4자 이상이어야 합니다." }); return; }
      newHash = await hashPassword(new_password);
    }

    await db.update(parentAccountsTable)
      .set({
        name: name.trim(),
        phone: phone?.trim() || pa.phone,
        ...(newHash ? { pin_hash: newHash } : {}),
        updated_at: new Date(),
      })
      .where(eq(parentAccountsTable.id, pa.id));

    await logChange({ tenantId: pa.swimming_pool_id, tableName: "parent_accounts", recordId: pa.id, changeType: "update", payload: { name: name.trim() } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ══════════════════════════════════════════════════════════════════════
// 통합 자동 연결 함수 — 모든 연결 로직이 이 함수를 통해 처리됨
// parentId: 연결할 학부모 ID
// poolId: 특정 수영장 한정 매칭 시 지정 (null이면 전체 DB 검색)
// ══════════════════════════════════════════════════════════════════════
async function autoLinkParentToStudents(parentId: string, poolId?: string | null): Promise<{ linked: number; studentIds: string[] }> {
  const [pa] = await db.select({
    phone: parentAccountsTable.phone,
    name: parentAccountsTable.name,
    swimming_pool_id: parentAccountsTable.swimming_pool_id,
  }).from(parentAccountsTable).where(eq(parentAccountsTable.id, parentId)).limit(1);

  if (!pa) return { linked: 0, studentIds: [] };

  const normPhone = (pa.phone || "").replace(/[^0-9]/g, "");
  const normName  = (pa.name  || "").replace(/\s+/g, "").toLowerCase();
  const effectivePoolId = poolId ?? pa.swimming_pool_id ?? null;

  const phoneMask = normPhone.length > 6
    ? normPhone.slice(0, 3) + "****" + normPhone.slice(-4) : "****";
  console.log(`[auto-link] START parent=${parentId} phone=${phoneMask} pool=${effectivePoolId ?? "ALL"}`);

  if (!normPhone && !normName) {
    console.log(`[auto-link] SKIP — phone/name 없음`);
    return { linked: 0, studentIds: [] };
  }

  // ① 전화번호 + 이름 매칭 (pool 지정 시 해당 pool 내만, 아니면 전체)
  let matched: any[] = [];
  if (normPhone) {
    const rows = effectivePoolId
      ? await db.execute(sql`
          SELECT id, swimming_pool_id FROM students
          WHERE (
            REGEXP_REPLACE(COALESCE(parent_phone,''),'[^0-9]','','g') = ${normPhone}
            OR REGEXP_REPLACE(COALESCE(parent_phone2,''),'[^0-9]','','g') = ${normPhone}
            OR REGEXP_REPLACE(COALESCE(parent_phone3,''),'[^0-9]','','g') = ${normPhone}
            OR REGEXP_REPLACE(COALESCE(parent_phone4,''),'[^0-9]','','g') = ${normPhone}
          )
            AND swimming_pool_id = ${effectivePoolId}
            AND status NOT IN ('withdrawn','archived','deleted')
          LIMIT 20`)
      : await db.execute(sql`
          SELECT id, swimming_pool_id FROM students
          WHERE (
            REGEXP_REPLACE(COALESCE(parent_phone,''),'[^0-9]','','g') = ${normPhone}
            OR REGEXP_REPLACE(COALESCE(parent_phone2,''),'[^0-9]','','g') = ${normPhone}
            OR REGEXP_REPLACE(COALESCE(parent_phone3,''),'[^0-9]','','g') = ${normPhone}
            OR REGEXP_REPLACE(COALESCE(parent_phone4,''),'[^0-9]','','g') = ${normPhone}
          )
            AND status NOT IN ('withdrawn','archived','deleted')
          LIMIT 20`);
    matched.push(...(rows.rows as any[]));
  }
  // 이름 폴백 (전화번호 매칭 안 됐거나 추가 매칭용)
  if (normName) {
    const rows2 = effectivePoolId
      ? await db.execute(sql`
          SELECT id, swimming_pool_id FROM students
          WHERE REPLACE(LOWER(COALESCE(parent_name,'')),' ','') = ${normName}
            AND swimming_pool_id = ${effectivePoolId}
            AND status NOT IN ('withdrawn','archived','deleted')
          LIMIT 20`)
      : await db.execute(sql`
          SELECT id, swimming_pool_id FROM students
          WHERE REPLACE(LOWER(COALESCE(parent_name,'')),' ','') = ${normName}
            AND status NOT IN ('withdrawn','archived','deleted')
          LIMIT 20`);
    for (const r of rows2.rows as any[]) {
      if (!matched.some((m: any) => m.id === r.id)) matched.push(r);
    }
  }

  console.log(`[auto-link] 매칭 학생=${matched.length}명 ids=${matched.map((m:any)=>m.id).join(",")}`);

  let linked = 0;
  const studentIds: string[] = [];

  for (const student of matched) {
    if (!student.swimming_pool_id) {
      console.log(`[auto-link] SKIP student=${student.id} — swimming_pool_id NULL`);
      continue;
    }
    try {
      // 현재 상태 확인: unregistered/pending_approval → active 전환 예정인 경우 회원 수 한도 체크
      const [stRow] = (await db.execute(sql`SELECT status FROM students WHERE id = ${student.id} LIMIT 1`)).rows as any[];
      if (stRow && ["unregistered", "pending_approval"].includes(stRow.status)) {
        const [planRow] = (await superAdminDb.execute(sql`
          SELECT COALESCE(p.member_limit, sp.member_limit) AS effective_limit,
                 p.member_limit AS pool_override
          FROM swimming_pools p
          LEFT JOIN subscription_plans sp ON sp.tier = p.subscription_tier
          WHERE p.id = ${student.swimming_pool_id} LIMIT 1
        `)).rows as any[];
        const [cntRow] = (await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM students
          WHERE swimming_pool_id = ${student.swimming_pool_id} AND status NOT IN ('archived','deleted','withdrawn')
        `)).rows as any[];
        const limit = Number(planRow?.effective_limit ?? 5);
        const current = Number(cntRow?.cnt ?? 0);
        console.log(`[auto-link] 한도 체크 student=${student.id} pool=${student.swimming_pool_id} limit=${limit} current=${current} override=${planRow?.pool_override ?? 'none'}`);
        if (current >= limit) {
          console.warn(`[auto-link] SKIP student=${student.id} — 회원 수 한도 초과 (${current}/${limit})`);
          continue;
        }
      }

      const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      // 기존 레코드 삭제 후 approved 상태로 재생성 (ON CONFLICT 완전 제거)
      await db.execute(sql`DELETE FROM parent_students WHERE parent_id=${parentId} AND student_id=${student.id}`);
      await db.execute(sql`
        INSERT INTO parent_students (id,parent_id,student_id,swimming_pool_id,status,approved_at,created_at)
        VALUES (${psId},${parentId},${student.id},${student.swimming_pool_id},'approved',NOW(),NOW())
      `);
      await db.execute(sql`
        UPDATE students
        SET parent_user_id = ${parentId},
            parent_phone = COALESCE(NULLIF(parent_phone,''), ${normPhone || null}),
            parent_name  = COALESCE(NULLIF(parent_name,''),  ${normName ? pa.name : null}),
            status = CASE WHEN status IN ('unregistered','pending_approval') THEN 'active' ELSE status END,
            updated_at = NOW()
        WHERE id = ${student.id}
      `);
      linked++;
      studentIds.push(student.id);
      console.log(`[auto-link] ✓ linked student=${student.id} pool=${student.swimming_pool_id}`);
    } catch (err: any) {
      console.error(`[auto-link] ✗ student=${student.id} error:`, err?.message);
    }
  }

  // 기존 pending 레코드 → approved 승격
  await db.execute(sql`
    UPDATE parent_students SET status='approved', approved_at=NOW()
    WHERE parent_id=${parentId} AND status != 'approved'
  `);

  // 수영장 자동 세팅 (아직 미설정인 경우만)
  if (!pa.swimming_pool_id && matched.length > 0) {
    const firstPoolId = matched[0]?.swimming_pool_id;
    if (firstPoolId) {
      await db.execute(sql`
        UPDATE parent_accounts SET swimming_pool_id=${firstPoolId}, updated_at=NOW()
        WHERE id=${parentId} AND swimming_pool_id IS NULL
      `);
      console.log(`[auto-link] 수영장 자동 세팅: ${firstPoolId}`);
    }
  }

  console.log(`[auto-link] DONE parent=${parentId} linked=${linked}`);
  return { linked, studentIds };
}

router.post("/auto-link-students", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const { linked, studentIds } = await autoLinkParentToStudents(req.user!.userId);
    res.json({ linked, studentIds });
  } catch (e) {
    console.error("auto-link-students error:", e);
    res.status(500).json({ error: "서버 오류" });
  }
});

router.get("/students", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const links = await db.select().from(parentStudentsTable).where(
      and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.status, "approved"))
    );
    const students = await Promise.all(links.map(async (link) => {
      const [s] = await db.select().from(studentsTable).where(eq(studentsTable.id, link.student_id)).limit(1);
      if (!s) return null;
      // 아카이브 또는 최종퇴원(access_blocked): 학부모 접근 차단
      if ((s as any).status === "archived" || (s as any).archived_reason === "access_blocked") {
        // pool 이름 조회 (차단 메시지 표시용)
        const [pool] = await superAdminDb.select({ name: swimmingPoolsTable.name })
          .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, (s as any).swimming_pool_id)).limit(1);
        return {
          id: s.id, name: (s as any).name,
          access_blocked: true,
          pool_name: pool?.name || "이 수영장",
          status: (s as any).status,
        };
      }
      let class_group: { name: string; schedule_days: string; schedule_time: string } | null = null;
      if (s.class_group_id) {
        const [grp] = await db.select({ name: classGroupsTable.name, schedule_days: classGroupsTable.schedule_days, schedule_time: classGroupsTable.schedule_time })
          .from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
        if (grp) class_group = grp;
      }
      return { ...s, class_group, access_blocked: false };
    }));
    res.json(students.filter(Boolean));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/students/:id", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [s] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!s) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }

    let class_group: any = null;
    if (s.class_group_id) {
      const [grp] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
      class_group = grp || null;
    }
    res.json({ ...s, class_group });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ─── 학부모 → 자녀 이름 수정 ─────────────────────────────────────────────
router.patch("/students/:id/name", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) { return res.status(400).json({ error: "이름을 입력해주세요." }); }

    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { return res.status(403).json({ error: "접근 권한이 없습니다." }); }

    await db.execute(sql`
      UPDATE students SET name = ${String(name).trim()}, updated_at = NOW()
      WHERE id = ${req.params.id}
    `);
    res.json({ success: true, name: String(name).trim() });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ─── 학부모 전체 출결 (연결된 모든 자녀의 출결 통합) ──────────────────────
router.get("/attendance", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const pa = await db.execute(sql`SELECT id FROM parent_accounts WHERE id = ${req.user!.userId} LIMIT 1`);
    if (!pa.rows.length) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    const linkedStudents = await db.execute(sql`
      SELECT ps.student_id, s.name as student_name
      FROM parent_students ps
      JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_id = ${req.user!.userId} AND ps.status = 'approved'
    `);
    const studentIds = (linkedStudents.rows as any[]).map(r => r.student_id);
    const studentNames = Object.fromEntries((linkedStudents.rows as any[]).map(r => [r.student_id, r.student_name]));

    if (!studentIds.length) { res.json([]); return; }

    const records: any[] = [];
    for (const sid of studentIds) {
      const sidSafe = sid.replace(/'/g, "''");
      const rows = await db.execute(sql.raw(`
        SELECT a.id, a.student_id as member_id, a.date, a.status
        FROM attendance a
        JOIN student_class_history sch
          ON sch.student_id = a.student_id
          AND sch.class_group_id = a.class_group_id
          AND sch.enrolled_at::text <= a.date
          AND (sch.left_at IS NULL OR sch.left_at::text > a.date)
        WHERE a.student_id = '${sidSafe}'
          AND a.class_group_id IS NOT NULL
        ORDER BY a.date DESC
      `));
      for (const r of rows.rows as any[]) {
        records.push({ ...r, member_name: studentNames[sid] || "" });
      }
    }
    records.sort((a, b) => b.date.localeCompare(a.date));
    res.json(records);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/students/:id/attendance", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { month } = req.query;
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const sId = req.params.id.replace(/'/g, "''");
    const monthStr = typeof month === "string" ? month : null;
    const rows = (await db.execute(sql.raw(`
      SELECT a.id, a.student_id, a.date, a.status, a.class_group_id
      FROM attendance a
      JOIN student_class_history sch
        ON sch.student_id = a.student_id
        AND sch.class_group_id = a.class_group_id
        AND sch.enrolled_at::text <= a.date
        AND (sch.left_at IS NULL OR sch.left_at::text > a.date)
      WHERE a.student_id = '${sId}'
        AND a.class_group_id IS NOT NULL
        ${monthStr ? `AND a.date LIKE '${monthStr.replace(/'/g, "''")}%'` : ""}
      ORDER BY a.date DESC
    `))).rows as any[];
    res.json(rows.sort((a: any, b: any) => b.date.localeCompare(a.date)));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});


// ── 학부모: 자녀 등록 요청 목록 조회 ─────────────────────────────────────
router.get("/student-requests", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const reqs = await superAdminDb.select().from(studentRegistrationRequestsTable)
      .where(eq(studentRegistrationRequestsTable.parent_id, req.user!.userId));
    res.json(reqs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 학부모: 자녀 등록 요청 제출 ──────────────────────────────────────────
router.post("/student-requests", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { child_name, child_birth_date, memo } = req.body;
  if (!child_name) { res.status(400).json({ error: "자녀 이름을 입력해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    const id = `srr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [newReq] = await superAdminDb.insert(studentRegistrationRequestsTable).values({
      id, swimming_pool_id: pa.swimming_pool_id, parent_id: pa.id,
      child_names: [child_name], memo: memo || null, status: "pending",
    }).returning();
    res.status(201).json(newReq);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 학부모: 형제/자매 추가 ──────────────────────────────────────────────────
router.post("/add-child", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { child_name } = req.body;
  if (!child_name?.trim()) {
    res.status(400).json({ error: "자녀 이름을 입력해주세요." });
    return;
  }

  try {
    const [pa] = await db.select().from(parentAccountsTable)
      .where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    if (!pa.swimming_pool_id) {
      res.status(400).json({ error: "소속 수영장 정보가 없습니다. 수영장 선택 후 이용해주세요." });
      return;
    }

    const normPhone = (pa.phone || "").replace(/[^0-9]/g, "");
    const normName = child_name.trim().replace(/\s+/g, "");

    // 매칭: 같은 수영장 + 같은 전화번호 + 같은 이름 + active
    const matchResult = await db.execute(sql`
      SELECT id, name, swimming_pool_id FROM students
      WHERE swimming_pool_id = ${pa.swimming_pool_id}
        AND status = 'active'
        AND REPLACE(name, ' ', '') = ${normName}
        AND REGEXP_REPLACE(COALESCE(parent_phone, ''), '[^0-9]', '', 'g') = ${normPhone}
    `);
    const matched = matchResult.rows as Array<{ id: string; name: string; swimming_pool_id: string }>;

    if (matched.length === 1) {
      const studentId = matched[0].id;

      // 이미 연결된 자녀인지 확인
      const [existingLink] = await db.select().from(parentStudentsTable)
        .where(and(
          eq(parentStudentsTable.parent_id, pa.id),
          eq(parentStudentsTable.student_id, studentId)
        )).limit(1);

      if (existingLink) {
        res.json({ status: "already_linked" });
        return;
      }

      // parent_students INSERT (즉시 승인)
      try {
        const linkId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.insert(parentStudentsTable).values({
          id: linkId,
          parent_id: pa.id,
          student_id: studentId,
          swimming_pool_id: pa.swimming_pool_id,
          status: "approved",
          approved_at: new Date(),
        });
        res.json({ status: "linked", student: { id: studentId, name: matched[0].name } });
      } catch (e: any) {
        if (e?.code === "23505") {
          res.json({ status: "already_linked" });
        } else throw e;
      }
      return;
    }

    // 0명 또는 다중 매칭 → pending 요청 생성
    const existingReqs = await superAdminDb.select()
      .from(studentRegistrationRequestsTable)
      .where(and(
        eq(studentRegistrationRequestsTable.parent_id, pa.id),
        eq(studentRegistrationRequestsTable.status, "pending")
      ));

    const alreadyPending = existingReqs.some(r => {
      const names: string[] = Array.isArray(r.child_names) ? (r.child_names as string[]) : [];
      return names.some(n => n.replace(/\s+/g, "") === normName);
    });

    if (alreadyPending) {
      res.json({ status: "pending_already" });
      return;
    }

    const reqId = `srr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await superAdminDb.insert(studentRegistrationRequestsTable).values({
      id: reqId,
      swimming_pool_id: pa.swimming_pool_id,
      parent_id: pa.id,
      child_names: [child_name.trim()],
      status: "pending",
    });
    res.json({ status: "pending_created" });

  } catch (err) {
    console.error("[add-child] error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/notices", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    // 전체 공지(global) + 소속 수영장 공지(pool) 모두 반환, 소프트삭제 제외
    const notices = await db.select().from(noticesTable).where(
      and(
        ne(noticesTable.status, "deleted"),
        or(
          eq(noticesTable.audience_scope, "global"),
          and(
            eq(noticesTable.audience_scope, "pool"),
            eq(noticesTable.swimming_pool_id, pa.swimming_pool_id),
          ),
        ),
      )
    );

    const readRows = await db.execute(sql`SELECT notice_id FROM notice_reads WHERE parent_id = ${pa.id}`);
    const readSet = new Set((readRows.rows as any[]).map((r: any) => r.notice_id));

    const result = notices.map(n => ({ ...n, is_read: readSet.has(n.id) }));
    result.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/notices/:id/read", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    const readId = `nr_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    await db.execute(sql`
      INSERT INTO notice_reads (id, notice_id, parent_id)
      VALUES (${readId}, ${req.params.id}, ${pa.id})
      ON CONFLICT (notice_id, parent_id) DO NOTHING
    `);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── WP4: 학부모 Banner 후보 조회 ─────────────────────────────────────────────
// show_banner=true + active period + not dismissed by this parent
router.get("/notices/banners", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    const now = new Date();
    const candidates = await db.execute(sql`
      SELECT n.*
      FROM notices n
      WHERE n.show_banner = true
        AND (n.status IS NULL OR n.status != 'deleted')
        AND (n.starts_at IS NULL OR n.starts_at <= ${now})
        AND (n.ends_at   IS NULL OR n.ends_at   >= ${now})
        AND (
          n.audience_scope = 'global'
          OR (n.audience_scope = 'pool' AND n.swimming_pool_id = ${pa.swimming_pool_id})
        )
        AND n.id NOT IN (
          SELECT notice_id FROM notice_dismissals WHERE user_id = ${userId}
        )
        AND (n.target_roles IS NULL OR 'PARENT' = ANY(n.target_roles))
      ORDER BY n.is_pinned DESC, n.created_at DESC
      LIMIT 10
    `);

    res.json({ success: true, banners: candidates.rows });
  } catch (e) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── WP4: 학부모 Banner 다시 보지 않기 ──────────────────────────────────────
// idempotent: ON CONFLICT DO NOTHING
router.post("/notices/:id/dismiss", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const userId   = req.user!.userId;
    const noticeId = req.params.id;

    const rows = await db.execute(sql`SELECT id, show_banner FROM notices WHERE id = ${noticeId} LIMIT 1`);
    const notice = rows.rows[0] as any;
    if (!notice) { res.status(404).json({ error: "공지를 찾을 수 없습니다." }); return; }
    if (!notice.show_banner) { res.status(400).json({ error: "배너 공지가 아닙니다." }); return; }

    const dismId = `nd_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    await db.execute(sql`
      INSERT INTO notice_dismissals (id, notice_id, user_id, dismissed_at)
      VALUES (${dismId}, ${noticeId}, ${userId}, NOW())
      ON CONFLICT (notice_id, user_id) DO NOTHING
    `);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 학부모: 자녀 수영일지 조회 (class_diaries 기반) ───────────────────
router.get("/students/:id/diary", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [student] = await db.select({ id: studentsTable.id })
      .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student) { res.json([]); return; }

    const { month } = req.query;
    const studentIdSafe = req.params.id.replace(/'/g, "''");

    // 학생의 모든 반 이력에서 class_group_id 수집 (반 이동 후 과거 반 일지도 조회)
    // [FIX] student_class_history 미존재(신규 등록 학생) 시 students.class_group_id fallback
    const historyClasses = (await db.execute(sql.raw(`
      SELECT DISTINCT class_group_id FROM (
        SELECT class_group_id
        FROM student_class_history
        WHERE student_id = '${studentIdSafe}'
          AND class_group_id IS NOT NULL
        UNION
        SELECT class_group_id
        FROM students
        WHERE id = '${studentIdSafe}'
          AND class_group_id IS NOT NULL
      ) t
    `))).rows as any[];
    const allClassIds = historyClasses.map(r => r.class_group_id);
    if (!allClassIds.length) { res.json([]); return; }
    const idsLiteral = allClassIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(",");

    // 공통 일지 조회 — 원래 반 + 보강으로 간 반 일지 모두 포함
    // 버그 7 수정: UNION → ROW_NUMBER DISTINCT 방식으로 diary_id 기준 dedup
    // 등록일 이전 diary 차단: students.created_at KST cutoff 적용
    const monthFilter = month ? `AND cd.lesson_date LIKE '${(month as string).replace(/'/g, "''")}%'` : "";
    const diaryRows = await db.execute(sql.raw(`
      SELECT id, lesson_date, common_content, teacher_name, is_edited, created_at,
             class_group_id, class_group_name, is_makeup_diary
      FROM (
        SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.is_edited, cd.created_at,
               cd.class_group_id, cg.name AS class_group_name,
               CASE WHEN ms.id IS NOT NULL THEN true ELSE false END AS is_makeup_diary,
               ROW_NUMBER() OVER (PARTITION BY cd.id ORDER BY ms.id NULLS LAST) AS rn
        FROM class_diaries cd
        LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
        LEFT JOIN student_class_history sch
          ON sch.class_group_id = cd.class_group_id
          AND sch.student_id = '${studentIdSafe}'
          AND sch.enrolled_at <= cd.lesson_date::date
          AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
        LEFT JOIN makeup_sessions ms
          ON ms.assigned_class_group_id = cd.class_group_id
          AND ms.student_id = '${studentIdSafe}'
          AND ms.assigned_date = cd.lesson_date
          AND ms.status = 'completed'
        WHERE cd.is_deleted = false
          ${monthFilter}
          AND cd.lesson_date::date >= (
            SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
            FROM students WHERE id = '${studentIdSafe}' LIMIT 1
          )
          AND (
            -- 일반 수업: 재원 이력이 있거나 students.class_group_id 직접 연결, 결석 아닌 경우
            -- [FIX] 신규 등록 학생(student_class_history 미존재)도 표시
            --   이전: sch.id IS NOT NULL 단독 → 신규 학생 diary 항상 누락
            --   변경: sch.id IS NOT NULL OR students.class_group_id 직접 일치
            (cd.class_group_id IN (${idsLiteral})
              AND (
                sch.id IS NOT NULL
                OR EXISTS (
                  SELECT 1 FROM students s2
                  WHERE s2.id = '${studentIdSafe}'
                    AND s2.class_group_id = cd.class_group_id
                )
              )
              AND NOT EXISTS (
                SELECT 1 FROM attendance a
                WHERE a.student_id = '${studentIdSafe}'
                  AND a.class_group_id = cd.class_group_id
                  AND a.date = cd.lesson_date
                  AND a.status = 'absent'
              )
            )
            -- 보강 수업: 결석 여부와 무관하게 표시 (보강 출석 완료)
            OR ms.id IS NOT NULL
          )
      ) sub
      WHERE rn = 1
      ORDER BY lesson_date DESC, created_at DESC
      LIMIT 100
    `));

    // 각 일지에서 해당 학생의 추가 일지 조인
    const result = await Promise.all((diaryRows.rows as any[]).map(async (diary) => {
      const noteRows = await db.execute(sql`
        SELECT id, note_content, is_edited, created_at
        FROM class_diary_student_notes
        WHERE diary_id = ${diary.id} AND student_id = ${req.params.id} AND is_deleted = false
        LIMIT 1
      `);
      return {
        id: diary.id,
        lesson_date: diary.lesson_date,
        common_content: diary.common_content,
        teacher_name: diary.teacher_name,
        class_group_id: diary.class_group_id,
        class_group_name: diary.class_group_name || null,
        is_makeup_diary: !!diary.is_makeup_diary,
        is_edited: diary.is_edited,
        created_at: diary.created_at,
        student_note: (noteRows.rows[0] as any) || null,
      };
    }));

    // ── GROWTH_REPORT feed items (spec §23, §6, §7) ──────────────────────
    // Only PUBLISHED reports; projection approach (no feed table; spec §22/§7)
    // Privacy: only summary_text / sns_summary safe portion (spec §15)
    // No raw fact_package, no teacher_review_note, no excluded_claims
    const grRows = await db.execute(sql`
      SELECT gr.id,
             gr.student_id,
             gr.report_period,
             gr.published_at,
             gr.report_content,
             gr.sns_summary
      FROM growth_reports gr
      WHERE gr.student_id = ${req.params.id}
        AND gr.product_status = 'PUBLISHED'
        AND gr.deleted_at IS NULL
      ORDER BY gr.published_at DESC
      LIMIT 20
    `);

    for (const gr of grRows.rows as any[]) {
      const rc  = (gr.report_content && typeof gr.report_content === "object" && !Array.isArray(gr.report_content))
        ? gr.report_content as Record<string, unknown>
        : {};
      const sns = (gr.sns_summary && typeof gr.sns_summary === "object" && !Array.isArray(gr.sns_summary))
        ? gr.sns_summary as Record<string, unknown>
        : {};

      // Title: product UI label only — no AI generation (spec §9, §32)
      const period: string = gr.report_period ?? "";
      const monthNum = period.includes("-") ? Number(period.split("-")[1]) : null;
      const title = monthNum ? `${monthNum}월 성장리포트` : "성장리포트";

      // preview: ENGINE-generated content only (spec §8, §25, §26, §27, §28, §29)
      const preview: Record<string, unknown> = {};
      if (rc.summary_text != null) preview.summary_text = String(rc.summary_text);
      if (sns.headline   != null) preview.headline     = String(sns.headline);
      if (Array.isArray(sns.key_points)) {
        preview.key_points = (sns.key_points as unknown[]).map(String);
      }

      result.push({
        type:             "GROWTH_REPORT",
        id:               `gr_feed_${gr.id as string}`,   // stable projection id (spec §8)
        growth_report_id: gr.id,
        student_id:       gr.student_id,
        report_period:    period,
        published_at:     gr.published_at,
        created_at:       gr.published_at,                 // feed sort key (spec §10)
        title,
        preview,
        share_safe:       sns.share_safe === true,          // preserve flag, no SNS impl (spec §16)
      });
    }

    // Sort all items by created_at DESC (diary by lesson_date converted, GR by published_at)
    // Diary items' created_at is the DB insert timestamp; GR items use published_at (spec §10)
    result.sort(
      (a, b) =>
        new Date(b.created_at as string).getTime() -
        new Date(a.created_at as string).getTime(),
    );

    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 학부모: 모든 자녀 일지 조회 ─────────────────────────────────────────
router.get("/diary", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const links = await db.select().from(parentStudentsTable).where(
      and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.status, "approved"))
    );
    if (!links.length) { res.json([]); return; }

    const studentIds = links.map(l => l.student_id);
    const studentsData: any[] = [];
    for (const sid of studentIds) {
      const [s] = await db.select({ id: studentsTable.id, name: studentsTable.name })
        .from(studentsTable).where(eq(studentsTable.id, sid)).limit(1);
      if (s) studentsData.push(s);
    }
    if (!studentsData.length) { res.json([]); return; }

    const result: any[] = [];
    for (const student of studentsData) {
      const sIdSafe = student.id.replace(/'/g, "''");
      // 학생의 모든 반 이력에서 class_group_id 수집 (반 이동 후 과거 반 일지도 조회)
      const historyClasses2 = (await db.execute(sql.raw(`
        SELECT DISTINCT class_group_id
        FROM student_class_history
        WHERE student_id = '${sIdSafe}'
          AND class_group_id IS NOT NULL
      `))).rows as any[];
      const allClassIds = historyClasses2.map((r: any) => r.class_group_id);
      if (!allClassIds.length) continue;
      const idsLiteral = allClassIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(",");

      // 버그 7 수정: UNION → ROW_NUMBER DISTINCT 방식으로 diary_id 기준 dedup
      // 등록일 이전 diary 차단: students.created_at KST cutoff 적용
      const diaryRows = await db.execute(sql.raw(`
        SELECT id, lesson_date, common_content, teacher_name, is_edited, created_at,
               class_group_id, is_makeup_diary
        FROM (
          SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.is_edited, cd.created_at,
                 cd.class_group_id,
                 CASE WHEN ms.id IS NOT NULL THEN true ELSE false END AS is_makeup_diary,
                 ROW_NUMBER() OVER (PARTITION BY cd.id ORDER BY ms.id NULLS LAST) AS rn
          FROM class_diaries cd
          LEFT JOIN student_class_history sch
            ON sch.class_group_id = cd.class_group_id
            AND sch.student_id = '${sIdSafe}'
            AND sch.enrolled_at <= cd.lesson_date::date
            AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
          LEFT JOIN makeup_sessions ms
            ON ms.assigned_class_group_id = cd.class_group_id
            AND ms.student_id = '${sIdSafe}'
            AND ms.assigned_date = cd.lesson_date
            AND ms.status = 'completed'
          WHERE cd.is_deleted = false
            AND cd.lesson_date::date >= (
              SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date
              FROM students WHERE id = '${sIdSafe}' LIMIT 1
            )
            AND (
              (cd.class_group_id IN (${idsLiteral}) AND sch.id IS NOT NULL)
              OR ms.id IS NOT NULL
            )
        ) sub
        WHERE rn = 1
        ORDER BY lesson_date DESC, created_at DESC
        LIMIT 40
      `));
      for (const diary of diaryRows.rows as any[]) {
        const noteRows = await db.execute(sql`
          SELECT id, note_content, is_edited FROM class_diary_student_notes
          WHERE diary_id = ${diary.id} AND student_id = ${student.id} AND is_deleted = false LIMIT 1
        `);
        result.push({
          ...diary,
          student_id: student.id, student_name: student.name,
          is_makeup_diary: !!diary.is_makeup_diary,
          student_note: (noteRows.rows[0] as any) || null,
        });
      }
    }
    result.sort((a, b) => b.lesson_date.localeCompare(a.lesson_date));
    res.json(result.slice(0, 100));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 학부모: 일지 사진 조회 ────────────────────────────────────────────────
router.get("/diary/:diaryId/photos", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const diaryRow = await db.execute(sql`
      SELECT swimming_pool_id FROM class_diaries WHERE id = ${req.params.diaryId} AND is_deleted = false LIMIT 1
    `);
    const poolId = (diaryRow.rows[0] as any)?.swimming_pool_id;
    if (!poolId) { res.status(404).json({ error: "일지 없음" }); return; }

    // 이 학부모의 자녀 ID 목록 수집 (개인사진 접근 범위 제한)
    const myLinks = await db.select({ student_id: parentStudentsTable.student_id })
      .from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.status, "approved")
      ));
    const myStudentIds = new Set(myLinks.map(l => l.student_id));

    // Media Engine v2: media_status='attached' + is_deleted JOIN (MediaService 경유)
    const { getDiaryPhotos: getPhotos } = await import("../services/mediaService.js");
    const result = await getPhotos(req.params.diaryId, poolId, myStudentIds);

    res.json({ common: result.common, individual: result.individual, total: result.total });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 레벨 기록 ──────────────────────────────────────────────────────────────
router.get("/students/:id/levels", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    const rows = await db.execute(sql`
      SELECT id, level, achieved_date, note, teacher_name, created_at
      FROM student_levels WHERE student_id = ${req.params.id}
      ORDER BY achieved_date DESC, created_at DESC
    `);
    res.json(rows.rows);
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// GET /parent/students/:id/level-info — 현재 레벨 + 레벨 설명/학습내용/승급기준
const DEFAULT_LEVELS_P = Array.from({ length: 10 }, (_, i) => ({
  level_order: i + 1, level_name: String(i + 1),
  level_description: "", learning_content: "", promotion_test_rule: "",
  badge_type: "text", badge_label: String(i + 1),
  badge_color: "#1F8F86", badge_text_color: "#FFFFFF",
}));

router.get("/students/:id/level-info", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    const studRow = await db.execute(sql`
      SELECT current_level_order, swimming_pool_id FROM students WHERE id = ${req.params.id}
    `);
    const student = studRow.rows[0] as any;
    const poolId = student?.swimming_pool_id;
    const currentOrder = student?.current_level_order ?? null;
    const levelRows = await db.execute(sql`
      SELECT level_order, level_name, level_description, learning_content,
             promotion_test_rule, badge_type, badge_label, badge_color, badge_text_color, is_active
      FROM pool_level_settings WHERE pool_id = ${poolId}
      ORDER BY level_order ASC
    `);
    const allDefs = levelRows.rows.length > 0 ? (levelRows.rows as any[]) : DEFAULT_LEVELS_P;
    const activeDefs = allDefs.filter((l: any) => l.is_active !== false);
    const currentDef = currentOrder ? (allDefs.find((l: any) => l.level_order === currentOrder) ?? null) : null;
    const nextDef = currentOrder ? (activeDefs.find((l: any) => l.level_order > currentOrder) ?? null) : null;
    res.json({ current_level_order: currentOrder, current_level: currentDef, next_level: nextDef, all_levels: activeDefs });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 반응 (좋아요/감사합니다) ───────────────────────────────────────────────
router.get("/diary/:diaryId/reactions", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT reaction_type FROM diary_reactions
      WHERE diary_id = ${req.params.diaryId} AND parent_id = ${req.user!.userId}
    `);
    const myReactions = (rows.rows as any[]).map((r: any) => r.reaction_type);
    res.json({ myReactions });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.post("/diary/:diaryId/reactions", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const raw_reaction_type = req.body.reaction_type;
  // 'thank' → 'thanks' 자동 정규화 (하위 호환: 구버전 앱 OTA 전 bridge)
  const reaction_type = raw_reaction_type === "thank" ? "thanks" : raw_reaction_type;
  const { userId } = req.user!;
  const { diaryId } = req.params;
  console.log(`[REACTION TOGGLE REQUEST] diaryId=${diaryId} parentUserId=${userId} rawType=${raw_reaction_type} normalizedType=${reaction_type}`);
  if (!["like", "thanks"].includes(reaction_type)) {
    console.log(`[REACTION TOGGLE ERROR] invalid reactionType=${reaction_type}`);
    res.status(400).json({ error: "유효하지 않은 반응 유형입니다." }); return;
  }
  try {
    const existing = await db.execute(sql`
      SELECT id FROM diary_reactions WHERE diary_id=${diaryId} AND parent_id=${userId} AND reaction_type=${reaction_type}
    `);
    if (existing.rows.length > 0) {
      await db.execute(sql`DELETE FROM diary_reactions WHERE diary_id=${diaryId} AND parent_id=${userId} AND reaction_type=${reaction_type}`);
      console.log(`[REACTION TOGGLE RESPONSE] diaryId=${diaryId} reactionType=${reaction_type} active=false`);
      res.json({ active: false });
    } else {
      await db.execute(sql`
        INSERT INTO diary_reactions (diary_id, parent_id, reaction_type) VALUES (${diaryId}, ${userId}, ${reaction_type})
        ON CONFLICT (diary_id, parent_id, reaction_type) DO NOTHING
      `);
      // Teacher 소식 생성 (non-blocking side effect)
      ;(async () => {
        try {
          const [diary] = (await db.execute(sql`
            SELECT cd.teacher_id, cd.lesson_date, cg.swimming_pool_id
            FROM class_diaries cd
            JOIN class_groups cg ON cg.id = cd.class_group_id
            WHERE cd.id = ${diaryId} LIMIT 1
          `)).rows as any[];
          if (!diary?.teacher_id) return;
          // thanks 알림 신규 생성 금지 — UI에서 thanks 버튼 제거됨
          if (reaction_type !== "like") return;
          const settingKey = "news_like";
          const [ps] = (await db.execute(sql`
            SELECT is_enabled FROM push_settings
            WHERE user_id = ${diary.teacher_id} AND notification_type = ${settingKey} LIMIT 1
          `)).rows as any[];
          const isEnabled = ps ? Boolean(ps.is_enabled) : true;
          const [pa] = (await db.execute(sql`SELECT name FROM parent_accounts WHERE id = ${userId} LIMIT 1`)).rows as any[];
          const parentName = pa?.name ?? "학부모";
          const typeLabel = reaction_type === "like" ? "좋아요" : "감사합니다";
          const dateStr = diary.lesson_date?.slice(0, 10) ?? "";
          const bodyText = `${parentName}님이 ${dateStr} 수업피드에 ${typeLabel}를 눌렀습니다.`;
          const notifId = `notif_news_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const notifType = `diary_${reaction_type}`;
          await db.execute(sql`
            INSERT INTO notifications (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
            VALUES (${notifId}, ${diary.teacher_id}, 'user', ${notifType},
              ${'새 ' + typeLabel}, ${bodyText}, ${diaryId}, 'diary', ${diary.swimming_pool_id ?? ''}, false)
            ON CONFLICT DO NOTHING
          `);
          if (isEnabled) {
            sendPushToUser(
              diary.teacher_id, false, notifType as any,
              '새 ' + typeLabel, bodyText,
              { type: notifType, diaryId },
            ).catch(() => {});
          }
        } catch (e) { console.error("[REACTION NEWS side-effect]", e); }
      })();
      console.log(`[REACTION TOGGLE RESPONSE] diaryId=${diaryId} reactionType=${reaction_type} active=true`);
      res.json({ active: true });
    }
  } catch (err: any) {
    console.error(`[REACTION TOGGLE ERROR] diaryId=${diaryId} reactionType=${reaction_type} error=${err?.message} code=${(err?.cause as any)?.code ?? err?.code ?? ''}`);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── 학부모 쪽지 스레드 목록 ────────────────────────────────────────────────
// GET /parent/messages — 내가 쪽지를 주고받은 일지 목록 (최신순)
router.get("/messages", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId = req.user!.userId!;
    const studentId = (req.query.student_id as string) || null;
    const rows = await db.execute(sql`
      SELECT
        cd.id              AS diary_id,
        cd.lesson_date,
        cd.teacher_name,
        s.id               AS student_id,
        s.name             AS student_name,
        (
          SELECT dm.content
          FROM diary_messages dm
          WHERE dm.diary_id = cd.id AND dm.is_deleted = false
          ORDER BY dm.created_at DESC LIMIT 1
        ) AS last_message,
        (
          SELECT dm.sender_role
          FROM diary_messages dm
          WHERE dm.diary_id = cd.id AND dm.is_deleted = false
          ORDER BY dm.created_at DESC LIMIT 1
        ) AS last_sender_role,
        (
          SELECT dm.sender_name
          FROM diary_messages dm
          WHERE dm.diary_id = cd.id AND dm.is_deleted = false
          ORDER BY dm.created_at DESC LIMIT 1
        ) AS last_sender_name,
        (
          SELECT dm.created_at
          FROM diary_messages dm
          WHERE dm.diary_id = cd.id AND dm.is_deleted = false
          ORDER BY dm.created_at DESC LIMIT 1
        ) AS last_message_at,
        (
          SELECT COUNT(*)::int
          FROM diary_messages dm
          WHERE dm.diary_id = cd.id AND dm.is_deleted = false
            AND dm.sender_role != 'parent' AND dm.read_at IS NULL
        ) AS unread_count,
        (
          SELECT COUNT(*)::int
          FROM diary_messages dm
          WHERE dm.diary_id = cd.id AND dm.is_deleted = false
        ) AS message_count
      FROM class_diaries cd
      JOIN students s ON s.class_group_id = cd.class_group_id
      JOIN parent_students ps ON ps.student_id = s.id
      WHERE ps.parent_id = ${parentId} AND ps.status = 'approved'
        AND (${studentId}::text IS NULL OR s.id = ${studentId})
        AND cd.is_deleted = false
        AND EXISTS (
          SELECT 1 FROM diary_messages dm
          WHERE dm.diary_id = cd.id AND dm.is_deleted = false
        )
      ORDER BY last_message_at DESC NULLS LAST
    `);
    res.json(rows.rows);
  } catch (err: any) {
    console.error("[parent/messages] 오류:", err?.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── 쪽지 (메시지) ─────────────────────────────────────────────────────────
router.get("/diary/:diaryId/messages", requireAuth, requireParent, async (req: AuthRequest, res) => {
  console.log("[diary-msg] GET diaryId=%s userId=%s", req.params.diaryId, req.user?.userId);
  try {
    const rows = await db.execute(sql`
      SELECT id, sender_id, sender_name, sender_role, content, is_deleted, created_at
      FROM diary_messages WHERE diary_id = ${req.params.diaryId}
      ORDER BY created_at ASC
    `);
    console.log("[diary-msg] GET 결과 count=%d", rows.rows.length);
    // 부모가 읽었으므로 선생님/관리자 메시지 읽음 처리
    db.execute(sql`
      UPDATE diary_messages
      SET read_at = NOW()
      WHERE diary_id = ${req.params.diaryId}
        AND sender_role != 'parent'
        AND is_deleted = false
        AND read_at IS NULL
    `).catch(() => {/* 무시 */});
    res.json(rows.rows);
  } catch (err: any) {
    console.error("[diary-msg] GET 오류:", err?.message, err?.code);
    res.status(500).json({ error: "서버 오류: " + (err?.message ?? "알 수 없는 오류") });
  }
});

router.post("/diary/:diaryId/messages", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { content } = req.body;
  console.log("[diary-msg] POST diaryId=%s userId=%s", req.params.diaryId, req.user?.userId);
  if (!content?.trim()) { res.status(400).json({ error: "내용을 입력해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) {
      console.warn("[diary-msg] 학부모 계정 없음 userId=%s", req.user!.userId);
      res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return;
    }
    const result = await db.execute(sql`
      INSERT INTO diary_messages (diary_id, sender_id, sender_name, sender_role, content)
      VALUES (${req.params.diaryId}, ${req.user!.userId}, ${pa.name}, 'parent', ${content.trim()})
      RETURNING *
    `);
    console.log("[diary-msg] 쪽지 저장 완료 id=%s", (result.rows[0] as any)?.id);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error("[diary-msg] POST 오류:", err?.message, err?.code);
    res.status(500).json({ error: "서버 오류: " + (err?.message ?? "알 수 없는 오류") });
  }
});

router.delete("/diary/:diaryId/messages/:msgId", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, sender_id FROM diary_messages WHERE id=${req.params.msgId} AND diary_id=${req.params.diaryId}
    `);
    if (!rows.rows.length) { res.status(404).json({ error: "메시지를 찾을 수 없습니다." }); return; }
    const msg = rows.rows[0] as any;
    if (msg.sender_id !== req.user!.userId) { res.status(403).json({ error: "본인 메시지만 삭제 가능합니다." }); return; }
    await db.execute(sql`UPDATE diary_messages SET is_deleted=true, deleted_at=now() WHERE id=${req.params.msgId}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.post("/diary/:diaryId/messages/:msgId/restore", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`SELECT sender_id FROM diary_messages WHERE id=${req.params.msgId}`);
    if (!rows.rows.length) { res.status(404).json({ error: "메시지를 찾을 수 없습니다." }); return; }
    const msg = rows.rows[0] as any;
    if (msg.sender_id !== req.user!.userId) { res.status(403).json({ error: "본인 메시지만 복구 가능합니다." }); return; }
    await db.execute(sql`UPDATE diary_messages SET is_deleted=false, deleted_at=null WHERE id=${req.params.msgId}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

router.delete("/diary/:diaryId/messages/:msgId/permanent", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const rows = await db.execute(sql`SELECT sender_id, is_deleted FROM diary_messages WHERE id=${req.params.msgId}`);
    if (!rows.rows.length) { res.status(404).json({ error: "메시지를 찾을 수 없습니다." }); return; }
    const msg = rows.rows[0] as any;
    if (msg.sender_id !== req.user!.userId) { res.status(403).json({ error: "본인 메시지만 영구삭제 가능합니다." }); return; }
    if (!msg.is_deleted) { res.status(400).json({ error: "먼저 삭제 처리 후 영구삭제 가능합니다." }); return; }
    await db.execute(sql`DELETE FROM diary_messages WHERE id=${req.params.msgId}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 최신소식 피드 (공지 + 수업일지 통합, 최대 10개) ─────────────────────
router.get("/students/:id/news", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);

    const readRows = await db.execute(sql`SELECT notice_id FROM notice_reads WHERE parent_id = ${pa.id}`);
    const readSet = new Set((readRows.rows as any[]).map((r: any) => r.notice_id));

    const news: any[] = [];

    // 공지사항 (최근 20개 → 피드에 섞기)
    const noticeRows = await db.select().from(noticesTable)
      .where(eq(noticesTable.swimming_pool_id, pa.swimming_pool_id));
    for (const n of noticeRows) {
      news.push({
        kind: "notice",
        id: n.id,
        title: n.title,
        content: n.content,
        notice_type: n.notice_type,
        is_read: readSet.has(n.id),
        is_pinned: n.is_pinned,
        author_name: n.author_name,
        created_at: n.created_at,
      });
    }

    // 수업일지 (최근 20개) — 등록일~퇴원일 범위 내만
    if (student?.class_group_id) {
      const diaryRows = await db.execute(sql`
        SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.created_at,
               csn.note_content AS student_note
        FROM class_diaries cd
        LEFT JOIN class_diary_student_notes csn
          ON csn.diary_id = cd.id AND csn.student_id = ${req.params.id} AND csn.is_deleted = false
        JOIN student_class_history sch
          ON sch.class_group_id = cd.class_group_id
          AND sch.student_id = ${req.params.id}
          AND sch.enrolled_at <= cd.lesson_date::date
          AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
        WHERE cd.class_group_id = ${student.class_group_id} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC LIMIT 20
      `);
      for (const d of diaryRows.rows as any[]) {
        news.push({
          kind: "diary",
          id: d.id,
          lesson_date: d.lesson_date,
          common_content: d.common_content,
          teacher_name: d.teacher_name,
          student_note: d.student_note || null,
          created_at: d.created_at,
        });
      }
    }

    news.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(news.slice(0, 10));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 안읽은 카운트 (공지 미열람 수) ───────────────────────────────────────
router.get("/students/:id/unread-counts", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);

    // 안읽은 공지 수
    const totalNotices = await db.execute(sql`SELECT COUNT(*) AS cnt FROM notices WHERE swimming_pool_id = ${pa.swimming_pool_id} AND status = 'published'`);
    const readNotices = await db.execute(sql`SELECT COUNT(*) AS cnt FROM notice_reads nr JOIN notices n ON n.id = nr.notice_id WHERE nr.parent_id = ${pa.id} AND n.swimming_pool_id = ${pa.swimming_pool_id}`);
    const unreadNotices = Number((totalNotices.rows[0] as any).cnt) - Number((readNotices.rows[0] as any).cnt);

    // 안읽은 수업일지 수 (마지막 확인 이후 새로 추가된 일지)
    const [diaryRead] = (await db.execute(sql`
      SELECT last_read_at FROM parent_content_reads
      WHERE parent_id = ${pa.id} AND student_id = ${req.params.id} AND content_type = 'diary'
    `)).rows as any[];
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    let unreadDiaries = 0;
    if (student?.class_group_id) {
      const diaryBase = diaryRead?.last_read_at ? sql`AND cd.created_at > ${diaryRead.last_read_at}` : sql``;
      const diaryCount = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM class_diaries cd
        WHERE cd.class_group_id = ${student.class_group_id} AND cd.is_deleted = false
        ${diaryBase}
      `);
      unreadDiaries = Number((diaryCount.rows[0] as any).cnt);
    }

    // 안읽은 사진 수 (마지막 확인 이후 새로 업로드된 사진)
    const [photoRead] = (await db.execute(sql`
      SELECT last_read_at FROM parent_content_reads
      WHERE parent_id = ${pa.id} AND student_id = ${req.params.id} AND content_type = 'photo'
    `)).rows as any[];
    const photoBase = photoRead?.last_read_at ? sql`AND sp.created_at > ${photoRead.last_read_at}` : sql``;
    let unreadPhotos = 0;
    if (student?.class_group_id) {
      const photoCount = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM photo_assets_meta sp
        WHERE (sp.class_id = ${student.class_group_id} OR sp.student_id = ${req.params.id})
          AND sp.media_status = 'attached'
          AND sp.journal_id IN (SELECT id FROM class_diaries WHERE is_deleted = false)
        ${photoBase}
      `);
      unreadPhotos = Number((photoCount.rows[0] as any).cnt);
    }

    // 안읽은 쪽지 수 (선생님/관리자가 보낸 diary_messages 중 read_at IS NULL)
    const msgCount = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM diary_messages dm
      JOIN class_diaries cd ON cd.id = dm.diary_id
      JOIN students s ON s.class_group_id = cd.class_group_id
      JOIN parent_students ps ON ps.student_id = s.id
      WHERE ps.parent_id = ${pa.id} AND ps.status = 'approved'
        AND dm.sender_role != 'parent'
        AND dm.is_deleted = false
        AND dm.read_at IS NULL
    `).catch(() => ({ rows: [{ cnt: 0 }] }));
    const unreadMessages = Number((msgCount.rows[0] as any).cnt ?? 0);

    res.json({
      unread_notices: Math.max(0, unreadNotices),
      unread_diaries: unreadDiaries,
      unread_photos: unreadPhotos,
      unread_messages: unreadMessages,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 읽음 처리 — 사진 ────────────────────────────────────────────────────────
router.post("/students/:id/mark-photos-read", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.student_id, req.params.id), eq(parentStudentsTable.status, "approved"))).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    await db.execute(sql`
      INSERT INTO parent_content_reads (id, parent_id, student_id, content_type, last_read_at)
      VALUES (gen_random_uuid()::text, ${pa.id}, ${req.params.id}, 'photo', now())
      ON CONFLICT (parent_id, student_id, content_type)
      DO UPDATE SET last_read_at = now()
    `);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 읽음 처리 — 수업일지 ─────────────────────────────────────────────────────
router.post("/students/:id/mark-diary-read", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.student_id, req.params.id), eq(parentStudentsTable.status, "approved"))).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    await db.execute(sql`
      INSERT INTO parent_content_reads (id, parent_id, student_id, content_type, last_read_at)
      VALUES (gen_random_uuid()::text, ${pa.id}, ${req.params.id}, 'diary', now())
      ON CONFLICT (parent_id, student_id, content_type)
      DO UPDATE SET last_read_at = now()
    `);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 홈 종합 요약 — 한 번에 모든 홈 데이터 ────────────────────────────────────
router.get("/students/:id/home-summary", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.student_id, req.params.id), eq(parentStudentsTable.status, "approved"))).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    // raw SQL로 조회해야 current_level_order 컬럼을 확실히 포함 (Drizzle 스키마에 미등록일 수 있음)
    const studentResult = await db.execute(sql`SELECT * FROM students WHERE id = ${req.params.id} LIMIT 1`);
    const student = (studentResult.rows[0] ?? null) as any;

    // ── 읽음 기준 시점 ───────────────────────────────────────────────────────
    const [diaryRead] = (await db.execute(sql`SELECT last_read_at FROM parent_content_reads WHERE parent_id = ${pa.id} AND student_id = ${req.params.id} AND content_type = 'diary'`)).rows as any[];
    const [photoRead] = (await db.execute(sql`SELECT last_read_at FROM parent_content_reads WHERE parent_id = ${pa.id} AND student_id = ${req.params.id} AND content_type = 'photo'`)).rows as any[];

    // ── unread counts ────────────────────────────────────────────────────────
    const totalNotices = await db.execute(sql`SELECT COUNT(*) AS cnt FROM notices WHERE swimming_pool_id = ${pa.swimming_pool_id} AND status = 'published'`);
    const readNotices  = await db.execute(sql`SELECT COUNT(*) AS cnt FROM notice_reads nr JOIN notices n ON n.id = nr.notice_id WHERE nr.parent_id = ${pa.id} AND n.swimming_pool_id = ${pa.swimming_pool_id}`);
    const unreadNotices = Math.max(0, Number((totalNotices.rows[0] as any).cnt) - Number((readNotices.rows[0] as any).cnt));

    let unreadDiaries = 0;
    let unreadPhotos = 0;
    if (student?.class_group_id) {
      const dBase = diaryRead?.last_read_at ? sql`AND cd.created_at > ${diaryRead.last_read_at}` : sql``;
      const dc = await db.execute(sql`SELECT COUNT(*) AS cnt FROM class_diaries cd WHERE cd.class_group_id = ${student.class_group_id} AND cd.is_deleted = false ${dBase}`);
      unreadDiaries = Number((dc.rows[0] as any).cnt);
      const pBase = photoRead?.last_read_at ? sql`AND sp.created_at > ${photoRead.last_read_at}` : sql``;
      const pc = await db.execute(sql`SELECT COUNT(*) AS cnt FROM photo_assets_meta sp WHERE (sp.class_id = ${student.class_group_id} OR sp.student_id = ${req.params.id}) ${pBase}`);
      unreadPhotos = Number((pc.rows[0] as any).cnt);
    }

    // 안읽은 쪽지 수 (선생님/관리자 diary_messages 중 read_at IS NULL)
    const msgCount = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM diary_messages dm
      JOIN class_diaries cd ON cd.id = dm.diary_id
      JOIN students s ON s.class_group_id = cd.class_group_id
      JOIN parent_students ps ON ps.student_id = s.id
      WHERE ps.parent_id = ${pa.id} AND ps.status = 'approved'
        AND dm.sender_role != 'parent'
        AND dm.is_deleted = false
        AND dm.read_at IS NULL
    `).catch(() => ({ rows: [{ cnt: 0 }] }));
    const unreadMessages = Number((msgCount.rows[0] as any).cnt ?? 0);

    // ── 최근 수업일지 2건 ────────────────────────────────────────────────────
    let latestDiaries: any[] = [];
    if (student?.class_group_id) {
      const rows = await db.execute(sql`
        SELECT cd.id, cd.lesson_date, cd.common_content, cd.teacher_name, cd.created_at,
               csn.note_content AS student_note,
               CASE WHEN ${diaryRead?.last_read_at ?? null}::timestamptz IS NULL OR cd.created_at > ${diaryRead?.last_read_at ?? null}::timestamptz THEN true ELSE false END AS is_new
        FROM class_diaries cd
        LEFT JOIN class_diary_student_notes csn ON csn.diary_id = cd.id AND csn.student_id = ${req.params.id} AND csn.is_deleted = false
        WHERE cd.class_group_id = ${student.class_group_id} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC LIMIT 2
      `);
      latestDiaries = rows.rows as any[];
    }

    // ── 최근 사진 4장 (썸네일용) ─────────────────────────────────────────────
    let latestPhotos: any[] = [];
    if (student?.class_group_id) {
      const rows = await db.execute(sql`
        SELECT id, caption, created_at,
               '/photos/' || id || '/file' AS file_url, album_type,
               CASE WHEN ${photoRead?.last_read_at ?? null}::timestamptz IS NULL OR created_at > ${photoRead?.last_read_at ?? null}::timestamptz THEN true ELSE false END AS is_new
        FROM (
          SELECT sp.id, sp.caption, sp.created_at, sp.album_type
          FROM photo_assets_meta sp
          WHERE (sp.class_id = ${student.class_group_id} OR sp.student_id = ${req.params.id})
            AND sp.media_status = 'attached'
            AND sp.journal_id IN (SELECT id FROM class_diaries WHERE is_deleted = false)
          UNION
          SELECT sp.id, sp.caption, sp.created_at, sp.album_type
          FROM photo_assets_meta sp
          JOIN class_diaries cd ON cd.id = sp.journal_id AND cd.is_deleted = false
          WHERE cd.class_group_id = ${student.class_group_id}
            AND sp.journal_id IS NOT NULL
            AND sp.media_status = 'attached'
        ) sub
        ORDER BY created_at DESC
        LIMIT 4
      `);
      latestPhotos = rows.rows as any[];
    }

    // ── 최근 공지 2건 ────────────────────────────────────────────────────────
    const readSet = new Set(((await db.execute(sql`SELECT notice_id FROM notice_reads WHERE parent_id = ${pa.id}`)).rows as any[]).map((r: any) => r.notice_id));
    const noticeRows = await db.execute(sql`
      SELECT id, title, content, notice_type, created_at, is_pinned
      FROM notices WHERE swimming_pool_id = ${pa.swimming_pool_id} AND status = 'published'
      ORDER BY is_pinned DESC, created_at DESC LIMIT 2
    `);
    const latestNotices = (noticeRows.rows as any[]).map(n => ({ ...n, is_read: readSet.has(n.id) }));

    // ── 이번달 출석 요약 ─────────────────────────────────────────────────────
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const attRows = await db.execute(sql`
      SELECT status FROM attendance
      WHERE student_id = ${req.params.id}
        AND attendance_date >= ${monthStart}::date
      ORDER BY attendance_date DESC
    `).catch(() => ({ rows: [] }));
    const attList = attRows.rows as any[];
    const attended = attList.filter((r: any) => r.status === "present").length;
    const total = attList.length;
    const latestStatus = attList[0]?.status ?? null;

    // ── 성장 (현재 레벨) ─────────────────────────────────────────────────────
    // student는 위에서 raw SQL로 조회했으므로 current_level_order 포함
    let growthInfo: any = null;
    const currentLevelOrder: number | null = student?.current_level_order != null
      ? Number(student.current_level_order)
      : null;

    const levelRows = await db.execute(sql`
      SELECT level, achieved_date, note, teacher_name FROM student_levels
      WHERE student_id = ${req.params.id}
      ORDER BY achieved_date DESC, created_at DESC LIMIT 2
    `).catch(() => ({ rows: [] }));

    // pool_level_settings에서 현재 레벨 정의 조회 (이름·배지 등)
    let currentLevelName: string | null = null;
    if (currentLevelOrder != null) {
      const poolId2 = student?.swimming_pool_id;
      if (poolId2) {
        const defRow = await db.execute(sql`
          SELECT level_name FROM pool_level_settings
          WHERE pool_id = ${poolId2}
            AND level_order = ${currentLevelOrder}
          LIMIT 1
        `).catch(() => ({ rows: [] }));
        if (defRow.rows.length > 0) {
          currentLevelName = (defRow.rows[0] as any)?.level_name ?? `레벨 ${currentLevelOrder}`;
        } else {
          // pool_level_settings 없으면 DEFAULT fallback
          const defLevel = DEFAULT_LEVELS_P.find((l: any) => l.level_order === currentLevelOrder);
          currentLevelName = defLevel?.level_name ?? `레벨 ${currentLevelOrder}`;
        }
      } else {
        currentLevelName = `레벨 ${currentLevelOrder}`;
      }
    }

    if (levelRows.rows.length > 0) {
      const levels = levelRows.rows as any[];
      growthInfo = {
        current_level: currentLevelName ?? levels[0].level,
        achieved_date: levels[0].achieved_date,
        prev_level: levels[1]?.level ?? null,
        note: levels[0].note,
        teacher_name: levels[0].teacher_name,
      };
    } else if (currentLevelName != null) {
      // student_levels 기록 없어도 current_level_order가 설정돼 있으면 레벨명 표시
      growthInfo = {
        current_level: currentLevelName,
        achieved_date: null,
        prev_level: null,
        note: null,
        teacher_name: null,
      };
    }

    // ── 오늘 수업 여부 ───────────────────────────────────────────────────────
    let todaySchedule: string | null = null;
    if (student?.class_group_id) {
      const cgRow = await db.execute(sql`SELECT schedule_days, schedule_time FROM class_groups WHERE id = ${student.class_group_id}`).catch(() => ({ rows: [] }));
      const cg = cgRow.rows[0] as any;
      if (cg?.schedule_days && cg?.schedule_time) {
        const dayMap: Record<number, string> = { 0: "일", 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토" };
        const todayDay = dayMap[new Date().getDay()];
        const days = cg.schedule_days.split(",").map((d: string) => d.trim());
        if (days.some((d: string) => d.includes(todayDay))) {
          todaySchedule = cg.schedule_time;
        }
      }
    }

    res.json({
      unread_counts: { notices: unreadNotices, diaries: unreadDiaries, photos: unreadPhotos, messages: unreadMessages },
      latest_diaries: latestDiaries,
      latest_photos: latestPhotos,
      latest_notices: latestNotices,
      attendance: { attended, total, latest_status: latestStatus },
      growth: growthInfo,
      today_schedule: todaySchedule,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 학생 3개월 성장 리포트 ────────────────────────────────────────────────
router.get("/students/:id/growth-report", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(eq(parentStudentsTable.parent_id, req.user!.userId), eq(parentStudentsTable.student_id, req.params.id), eq(parentStudentsTable.status, "approved"))).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student) { res.status(404).json({ error: "학생 정보를 찾을 수 없습니다." }); return; }

    const now = new Date();
    // 최근 3개월 시작일 계산
    const months: { label: string; start: string; end: string }[] = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`;
      months.push({ label: `${d.getMonth() + 1}월`, start, end });
    }

    // ── 월별 출석 집계 ─────────────────────────────────────────────────────
    const threeMonthsAgo = months[0].start;
    const attRows = await db.execute(sql`
      SELECT attendance_date, status FROM attendance
      WHERE student_id = ${req.params.id}
        AND attendance_date >= ${threeMonthsAgo}::date
      ORDER BY attendance_date ASC
    `).catch(() => ({ rows: [] }));
    const attList = attRows.rows as any[];

    const monthlyAttendance = months.map(m => {
      const inRange = attList.filter(r => r.attendance_date >= m.start && r.attendance_date <= m.end);
      return {
        label: m.label,
        present: inRange.filter(r => r.status === "present").length,
        absent:  inRange.filter(r => r.status === "absent").length,
        late:    inRange.filter(r => r.status === "late").length,
        total:   inRange.length,
      };
    });

    // ── 레벨 이력 ─────────────────────────────────────────────────────────
    const levelRows = await db.execute(sql`
      SELECT level, achieved_date, note, teacher_name FROM student_levels
      WHERE student_id = ${req.params.id}
      ORDER BY achieved_date ASC, created_at ASC
    `).catch(() => ({ rows: [] }));
    const levelHistory = levelRows.rows as any[];

    // ── 최근 수업 일지 피드백 (최대 5건) ──────────────────────────────────
    let recentDiaries: any[] = [];
    if (student?.class_group_id) {
      const diaryRows = await db.execute(sql`
        SELECT cd.lesson_date, cd.common_content, cd.teacher_name,
               csn.note_content AS student_note
        FROM class_diaries cd
        LEFT JOIN class_diary_student_notes csn ON csn.diary_id = cd.id AND csn.student_id = ${req.params.id} AND csn.is_deleted = false
        WHERE cd.class_group_id = ${student.class_group_id}
          AND cd.is_deleted = false
          AND cd.lesson_date >= ${threeMonthsAgo}::date
        ORDER BY cd.lesson_date DESC LIMIT 5
      `).catch(() => ({ rows: [] }));
      recentDiaries = diaryRows.rows as any[];
    }

    // ── 3개월 총 수업 일수 ────────────────────────────────────────────────
    let totalLessons = 0;
    if (student?.class_group_id) {
      const lessonRows = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM class_diaries
        WHERE class_group_id = ${student.class_group_id}
          AND is_deleted = false
          AND lesson_date >= ${threeMonthsAgo}::date
      `).catch(() => ({ rows: [{ cnt: 0 }] }));
      totalLessons = Number((lessonRows.rows[0] as any)?.cnt ?? 0);
    }

    // ── 학생 이름 + 반 이름 ───────────────────────────────────────────────
    let className = "";
    if (student?.class_group_id) {
      const cgRow = await db.execute(sql`SELECT name FROM class_groups WHERE id = ${student.class_group_id}`).catch(() => ({ rows: [] }));
      className = (cgRow.rows[0] as any)?.name ?? "";
    }

    res.json({
      student_name: (student as any).name,
      class_name: className,
      monthly_attendance: monthlyAttendance,
      level_history: levelHistory,
      recent_diaries: recentDiaries,
      total_lessons: totalLessons,
      period_label: `${months[0].label} ~ ${months[2].label}`,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 교육 프로그램 (수영장별 1개 문서) ─────────────────────────────────────
router.get("/program", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }
    // pool_programs 테이블이 없으면 null 반환
    const rows = await db.execute(sql`
      SELECT id, title, content, updated_at, author_name
      FROM pool_programs WHERE swimming_pool_id = ${pa.swimming_pool_id} LIMIT 1
    `).catch(() => ({ rows: [] }));
    res.json(rows.rows[0] || null);
  } catch (err) { res.json(null); }
});

// ── 홈 피드 (최근 수업일지 + 사진) ──────────────────────────────────────
router.get("/students/:id/feed", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [link] = await db.select().from(parentStudentsTable)
      .where(and(
        eq(parentStudentsTable.parent_id, req.user!.userId),
        eq(parentStudentsTable.student_id, req.params.id),
        eq(parentStudentsTable.status, "approved")
      )).limit(1);
    if (!link) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }

    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    const cgId = student?.class_group_id;

    const feed: any[] = [];

    if (cgId) {
      const diaryRows = await db.execute(sql`
        SELECT cd.id, cd.lesson_date AS date, cd.common_content, cd.teacher_name, cd.created_at,
               csn.note_content AS student_note
        FROM class_diaries cd
        LEFT JOIN class_diary_student_notes csn ON csn.diary_id = cd.id AND csn.student_id = ${req.params.id} AND csn.is_deleted = false
        WHERE cd.class_group_id = ${cgId} AND cd.is_deleted = false
        ORDER BY cd.lesson_date DESC LIMIT 10
      `);
      for (const d of diaryRows.rows as any[]) {
        feed.push({ type: "diary", id: d.id, date: d.date, teacher_name: d.teacher_name,
          content: d.common_content, student_note: d.student_note, created_at: d.created_at });
      }
    }

    const photoRows = await db.execute(sql`
      SELECT id, caption, uploader_id, created_at, file_url
      FROM student_photos WHERE student_id = ${req.params.id}
      ORDER BY created_at DESC LIMIT 10
    `);
    for (const p of photoRows.rows as any[]) {
      feed.push({ type: "photo", id: p.id, date: (p.created_at as string).split("T")[0],
        teacher_name: null, content: p.caption, created_at: p.created_at, file_url: p.file_url });
    }

    // GR-M6: PUBLISHED growth_reports → feed GROWTH_REPORT items
    // 물리 feed table 없음. growth_reports projection 방식.
    // History: 모든 PUBLISHED 보존 (최신부터 최대 5개).
    // Dedup: uq_growth_reports_student_cycle 보장으로 동일 report_id 중복 없음.
    const grRows = await db.execute(sql`
      SELECT id, student_id, report_period, published_at, summary_text
      FROM growth_reports
      WHERE student_id = ${req.params.id}
        AND product_status = 'PUBLISHED'
        AND deleted_at IS NULL
      ORDER BY published_at DESC
      LIMIT 5
    `);
    for (const gr of grRows.rows as any[]) {
      const period: string = gr.report_period ?? "";
      const month = parseInt((period.split("-")[1]) ?? "0", 10);
      const title = month > 0 ? `${month}월 성장리포트` : "성장리포트";
      feed.push({
        type: "GROWTH_REPORT",
        id: `gr_feed_${gr.id}`,
        growth_report_id: gr.id,
        student_id: gr.student_id,
        report_period: period,
        published_at: gr.published_at,
        created_at: gr.published_at,
        title,
        preview: {
          summary_text: gr.summary_text ?? undefined,
        },
        share_safe: false,
      });
    }

    feed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(feed.slice(0, 25));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── 학부모 호칭(닉네임) 수정 ─────────────────────────────────────────────
router.put("/nickname", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { nickname } = req.body;
  if (!nickname?.trim()) { res.status(400).json({ error: "호칭을 입력해주세요." }); return; }
  try {
    await db.execute(sql`UPDATE parent_accounts SET nickname = ${nickname.trim()}, updated_at = now() WHERE id = ${req.user!.userId}`);
    res.json({ success: true, nickname: nickname.trim() });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ─── 학부모 온보딩: 수영장 연결 + 자녀 자동 연결 ─────────────────────────
// POST /parent/onboard-pool
// body: { swimming_pool_id }
// 처리: 내 phone과 일치하는 student(parent_phone/parent_phone2) 검색
//       - 일치 → parent_students 생성(approved) + 학부모 swimming_pool_id 업데이트
//       - 불일치 → student_registration_requests 생성(pending)
router.post("/onboard-pool", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const { swimming_pool_id } = req.body;
  if (!swimming_pool_id) { res.status(400).json({ error: "수영장을 선택해주세요." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    // WP6 P0 FIX: block pool switch if parent already has an approved child link in a DIFFERENT pool
    if (pa.swimming_pool_id && pa.swimming_pool_id !== swimming_pool_id) {
      const existingLink = await db.execute(sql`
        SELECT id FROM parent_students
        WHERE parent_id = ${pa.id} AND status = 'approved'
        LIMIT 1
      `);
      if ((existingLink.rows as any[]).length > 0) {
        res.status(403).json({ error: "이미 연결된 수영장이 있습니다. 변경이 필요하면 수영장에 문의하세요." }); return;
      }
    }

    // 수영장 존재 확인
    const [pool] = await superAdminDb.select({ id: swimmingPoolsTable.id, name: swimmingPoolsTable.name })
      .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, swimming_pool_id)).limit(1);
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    // 학부모 계정의 swimming_pool_id 업데이트 (항상 먼저 설정)
    if (pa.swimming_pool_id !== swimming_pool_id) {
      await db.execute(sql`UPDATE parent_accounts SET swimming_pool_id=${swimming_pool_id}, updated_at=NOW() WHERE id=${pa.id}`);
    }

    // 통합 자동 연결 (해당 수영장 내 전화번호/이름 매칭)
    const { linked, studentIds } = await autoLinkParentToStudents(pa.id, swimming_pool_id);
    const autoApproved = linked > 0;

    console.log(`[onboard-pool] parent=${pa.id} pool=${swimming_pool_id} linked=${linked}`);

    res.json({
      success: true,
      auto_approved: autoApproved,
      pool_name: pool.name,
      linked_students: studentIds,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ─── 수영정보 (수영장 기본 정보 + 안내 콘텐츠) ─────────────────────────────
router.get("/pool-info", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const [pa] = await db.select({ swimming_pool_id: parentAccountsTable.swimming_pool_id })
      .from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
    if (!pa) { res.status(404).json({ error: "계정을 찾을 수 없습니다." }); return; }

    // swimming_pool_id가 null이면 JWT 토큰의 poolId로 fallback
    const poolId: string | null = pa.swimming_pool_id || (req.user as any).poolId || null;
    if (!poolId) { res.status(404).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    // swimming_pool_id가 null이었던 경우 소급 업데이트
    if (!pa.swimming_pool_id) {
      await db.execute(sql`UPDATE parent_accounts SET swimming_pool_id = ${poolId}, updated_at = now() WHERE id = ${req.user!.userId}`).catch(() => {});
    }

    const [pool] = await superAdminDb.select({
      id: swimmingPoolsTable.id,
      name: swimmingPoolsTable.name,
      address: swimmingPoolsTable.address,
      phone: swimmingPoolsTable.phone,
      introduction: swimmingPoolsTable.introduction,
      tuition_info: swimmingPoolsTable.tuition_info,
      level_test_info: swimmingPoolsTable.level_test_info,
      event_info: swimmingPoolsTable.event_info,
      equipment_info: swimmingPoolsTable.equipment_info,
    }).from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, poolId)).limit(1);

    if (!pool) { res.status(404).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    res.json({
      pool_id: pool.id,
      pool_name: pool.name,
      address: pool.address,
      phone: pool.phone,
      introduction: pool.introduction ?? null,
      tuition_info: pool.tuition_info ?? null,
      level_test_info: pool.level_test_info ?? null,
      event_info: pool.event_info ?? null,
      equipment_info: pool.equipment_info ?? null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── POST /parent/link-child — 자녀 연결 (자동승인 + 승인대기) ──────────
router.post("/link-child", requireAuth, requireParent, async (req: AuthRequest, res) => {
  const parentId = req.user!.userId;
  const { swimming_pool_id, child_name, child_birth_year, child_phone_last4 } = req.body;
  if (!swimming_pool_id || !child_name?.trim()) {
    res.status(400).json({ success: false, message: "수영장과 자녀 이름을 입력해주세요." }); return;
  }
  try {
    // WP6 P0 FIX: block pool switch if parent already has an approved child link in a DIFFERENT pool
    const [paCheck] = await db.select({ swimming_pool_id: parentAccountsTable.swimming_pool_id })
      .from(parentAccountsTable).where(eq(parentAccountsTable.id, parentId)).limit(1);
    if (paCheck?.swimming_pool_id && paCheck.swimming_pool_id !== swimming_pool_id) {
      const existingLink = await db.execute(sql`
        SELECT id FROM parent_students
        WHERE parent_id = ${parentId} AND status = 'approved'
        LIMIT 1
      `);
      if ((existingLink.rows as any[]).length > 0) {
        res.status(403).json({ success: false, message: "이미 연결된 수영장이 있습니다. 변경이 필요하면 수영장에 문의하세요." }); return;
      }
    }

    // 수영장 존재 확인
    const [pool] = await superAdminDb.select().from(swimmingPoolsTable)
      .where(eq(swimmingPoolsTable.id, swimming_pool_id)).limit(1);
    if (!pool) { res.status(400).json({ success: false, message: "존재하지 않는 수영장입니다." }); return; }

    // 이름 정규화 (공백 제거 + 소문자)
    const nameRaw  = child_name.trim();
    const nameNorm = normNameV2(nameRaw);

    // 학부모 전화번호 조회 (숫자만)
    const paRows = await db.execute(sql`
      SELECT phone FROM parent_accounts WHERE id = ${parentId} LIMIT 1
    `);
    const parentPhone = ((paRows.rows[0] as any)?.phone || "").replace(/[^0-9]/g, "");

    // 학부모 계정 수영장 세팅
    await db.execute(sql`
      UPDATE parent_accounts SET swimming_pool_id = ${swimming_pool_id}, updated_at = NOW()
      WHERE id = ${parentId}
    `);

    // V2 매칭 시도 (이름 + 전화번호 동시 확인)
    const { matched, studentId, studentName, reason } = await tryAutoLinkV2(parentId, swimming_pool_id, parentPhone, nameNorm);

    if (matched && studentId) {
      // 자동 승인
      const linkResult = await linkParentToStudentV2Import(parentId, studentId, swimming_pool_id);
      if (linkResult.success) {
        return res.json({ success: true, status: "linked", message: "자녀가 연결되었습니다.", student: { id: studentId, name: studentName } });
      }
    }

    // 이름으로 학생 찾기 (pending 저장에 matched_student_id 사용)
    const foundRows = (await db.execute(sql`
      SELECT id, name FROM students
      WHERE swimming_pool_id = ${swimming_pool_id}
        AND REPLACE(LOWER(TRIM(COALESCE(name,''))), ' ', '') = ${nameNorm}
        AND status NOT IN ('withdrawn','archived','deleted')
      LIMIT 5
    `)).rows as any[];

    if (foundRows.length === 0) {
      // 이름조차 없으면 에러 반환
      return res.json({ success: false, status: "not_found", message: "수영장 회원 목록에 해당 이름의 학생이 없습니다. 관리자에게 이름 등록을 요청하세요." });
    }

    // 전화번호 불일치 → pending 저장
    const pendingStudentId = foundRows.length === 1 ? foundRows[0].id : null;
    const pendingStudentName = foundRows.length === 1 ? foundRows[0].name : foundRows[0].name;
    const pendingReason = foundRows.length >= 2 ? "duplicate_name" : "phone_mismatch";

    await upsertParentV2Pending(parentId, swimming_pool_id, nameRaw, nameNorm, parentPhone, pendingReason, pendingStudentId ?? undefined);

    // 관리자에게 push 알림
    try {
      const { sendPushToPoolAdmins } = await import("../lib/push-service.js");
      const [pa] = (await db.execute(sql`SELECT name FROM parent_accounts WHERE id=${parentId} LIMIT 1`)).rows as any[];
      await sendPushToPoolAdmins(
        swimming_pool_id, "parent_join",
        "학부모 연결 승인 대기",
        `${pa?.name || "학부모"}님이 ${pendingStudentName} 연결을 요청했습니다. 전화번호 확인 후 승인해주세요.`,
        { screen: "approvals" },
        `parent_link_${parentId}`
      );
    } catch {}

    return res.json({
      success: false,
      status: "pending",
      pending_reason: pendingReason,
      message: pendingReason === "duplicate_name"
        ? "같은 이름의 학생이 여러 명입니다. 관리자가 확인 후 승인합니다."
        : "등록된 보호자 전화번호와 일치하지 않습니다. 관리자가 확인 후 승인합니다.",
      student: { name: pendingStudentName },
    });
  } catch (e) { console.error(e); res.status(500).json({ success: false, message: "서버 오류가 발생했습니다." }); }
});

// ══════════════════════════════════════════════════════════════════════
// V2 라우트
// ══════════════════════════════════════════════════════════════════════

// GET /parent/v2/status — 학부모 연결 상태 조회 + 재매칭 시도
router.get("/v2/status", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId = req.user!.userId;
    const result = await getParentStatusV2(parentId);
    res.json(result);
  } catch (e) {
    console.error("[v2-status] 오류:", e);
    res.status(500).json({ error: "서버 오류" });
  }
});

// POST /parent/v2/retry-link — "다시 확인" 버튼 (명시적 재시도)
router.post("/v2/retry-link", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId = req.user!.userId;
    console.log(`[v2-retry] 명시적 재시도 요청: parent=${parentId}`);
    const result = await getParentStatusV2(parentId);
    res.json(result);
  } catch (e) {
    console.error("[v2-retry] 오류:", e);
    res.status(500).json({ error: "서버 오류" });
  }
});

// POST /parent/v2/update-pending — 대기 중 정보 수정 (이름/수영장 변경 시)
router.post("/v2/update-pending", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId = req.user!.userId;
    const { pool_id, child_name } = req.body;
    if (!pool_id || !child_name) return res.status(400).json({ error: "pool_id, child_name 필수" });

    const [pa] = (await db.execute(sql`SELECT phone FROM parent_accounts WHERE id=${parentId} LIMIT 1`)).rows as any[];
    if (!pa) return res.status(404).json({ error: "계정 없음" });

    const phoneNorm = normPhoneV2(pa.phone);
    const nameRaw   = child_name.trim();
    const nameNorm  = normNameV2(nameRaw);

    // 수영장 업데이트
    await db.execute(sql`UPDATE parent_accounts SET swimming_pool_id=${pool_id}, updated_at=NOW() WHERE id=${parentId}`);

    // pending UPSERT
    await upsertParentV2Pending(parentId, pool_id, nameRaw, nameNorm, phoneNorm);

    // 즉시 재매칭 시도
    const result = await getParentStatusV2(parentId);
    res.json(result);
  } catch (e) {
    console.error("[v2-update-pending] 오류:", e);
    res.status(500).json({ error: "서버 오류" });
  }
});

// DELETE /parent/unlink-child/:studentId — 자녀 연결 삭제
router.delete("/unlink-child/:studentId", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId  = req.user!.userId;
    const studentId = req.params.studentId;
    if (!studentId) return res.status(400).json({ success: false, message: "studentId 필수" });

    await db.execute(sql`
      DELETE FROM parent_students
      WHERE parent_id = ${parentId} AND student_id = ${studentId}
    `);

    res.json({ success: true, message: "자녀 연결이 삭제되었습니다" });
  } catch (e) {
    console.error("[unlink-child] 오류:", e);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

// ─── 추가 보호자 관리 ──────────────────────────────────────────────────────────
// GET /parent/guardians — 연결된 자녀별 보호자 전화번호 현황
router.get("/guardians", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId = req.user!.userId;
    const students = (await db.execute(sql`
      SELECT s.id, s.name, s.swimming_pool_id,
             s.parent_phone, s.parent_phone2, s.parent_phone3, s.parent_phone4
      FROM parent_students ps
      JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_id = ${parentId} AND ps.status = 'approved'
        AND s.status NOT IN ('withdrawn','archived','deleted')
    `)).rows as any[];

    const result = await Promise.all(students.map(async (s: any) => {
      const poolId = s.swimming_pool_id;
      const slots = [
        { slot: 1, phone: s.parent_phone },
        { slot: 2, phone: s.parent_phone2 },
        { slot: 3, phone: s.parent_phone3 },
        { slot: 4, phone: s.parent_phone4 },
      ];
      const phoneInfos = await Promise.all(slots.map(async ({ slot, phone }) => {
        if (!phone) return { slot, phone: null, status: "empty" };
        const normP = phone.replace(/[^0-9]/g, "");
        const [pa] = (await db.execute(sql`
          SELECT id, name FROM parent_accounts
          WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = ${normP}
            AND swimming_pool_id = ${poolId}
          LIMIT 1
        `)).rows as any[];
        return { slot, phone, status: pa ? "connected" : "pending", connected_name: pa?.name || null };
      }));
      return { student_id: s.id, student_name: s.name, phones: phoneInfos };
    }));

    res.json({ success: true, students: result });
  } catch (e) { console.error("[guardians GET]", e); res.status(500).json({ success: false, message: "서버 오류" }); }
});

// POST /parent/guardians — 추가 보호자 전화번호 등록
const MAX_GUARDIAN_SLOTS = 4;
router.post("/guardians", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId = req.user!.userId;
    const { studentId, phone } = req.body;
    if (!studentId || !phone) { res.status(400).json({ success: false, message: "studentId와 phone이 필요합니다." }); return; }

    const normPhone = phone.replace(/[^0-9]/g, "");
    if (normPhone.length < 9) { res.status(400).json({ success: false, message: "올바른 전화번호를 입력해주세요." }); return; }

    // 연결 확인
    const [link] = (await db.execute(sql`
      SELECT ps.id FROM parent_students ps
      WHERE ps.parent_id = ${parentId} AND ps.student_id = ${studentId} AND ps.status = 'approved'
      LIMIT 1
    `)).rows as any[];
    if (!link) { res.status(403).json({ success: false, message: "해당 자녀와 연결되지 않은 보호자입니다." }); return; }

    const [student] = (await db.execute(sql`
      SELECT id, name, swimming_pool_id, parent_phone, parent_phone2, parent_phone3, parent_phone4
      FROM students WHERE id = ${studentId} LIMIT 1
    `)).rows as any[];
    if (!student) { res.status(404).json({ success: false, message: "학생을 찾을 수 없습니다." }); return; }

    // 내 번호와 동일 여부 확인
    const [myAccount] = (await db.execute(sql`SELECT phone FROM parent_accounts WHERE id = ${parentId} LIMIT 1`)).rows as any[];
    const myNorm = ((myAccount?.phone) || "").replace(/[^0-9]/g, "");
    if (myNorm && myNorm === normPhone) {
      res.status(400).json({ success: false, message: "본인 번호는 추가 보호자로 등록할 수 없습니다." }); return;
    }

    // 이미 등록된 번호인지 확인
    const existingPhones = [student.parent_phone, student.parent_phone2, student.parent_phone3, student.parent_phone4]
      .map((p: string | null) => (p || "").replace(/[^0-9]/g, ""))
      .filter(Boolean);
    if (existingPhones.includes(normPhone)) {
      res.status(400).json({ success: false, message: "이미 등록된 전화번호입니다." }); return;
    }

    // 빈 슬롯 찾기 (phone2/3/4 중 첫 번째) + 저장
    const studentIdStr = String(studentId);
    let savedSlot = "";
    if (!student.parent_phone2) {
      await db.execute(sql`UPDATE students SET parent_phone2 = ${normPhone}, updated_at = NOW() WHERE id = ${studentIdStr}`);
      savedSlot = "parent_phone2";
    } else if (!student.parent_phone3) {
      await db.execute(sql`UPDATE students SET parent_phone3 = ${normPhone}, updated_at = NOW() WHERE id = ${studentIdStr}`);
      savedSlot = "parent_phone3";
    } else if (!student.parent_phone4) {
      await db.execute(sql`UPDATE students SET parent_phone4 = ${normPhone}, updated_at = NOW() WHERE id = ${studentIdStr}`);
      savedSlot = "parent_phone4";
    } else {
      res.status(400).json({ success: false, message: `보호자 번호는 최대 ${MAX_GUARDIAN_SLOTS}개까지 등록할 수 있습니다.` }); return;
    }
    console.log(`[guardians POST] student=${studentIdStr} slot=${savedSlot} phone=${normPhone.slice(0,3)}****${normPhone.slice(-4)}`);

    // 해당 번호로 가입한 학부모가 있으면 즉시 자동 연결
    const [existingPa] = (await db.execute(sql`
      SELECT id, name FROM parent_accounts
      WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = ${normPhone}
        AND swimming_pool_id = ${student.swimming_pool_id}
      LIMIT 1
    `)).rows as any[];

    let autoLinked = false;
    if (existingPa) {
      const { success } = await linkParentToStudentV2Import(existingPa.id, studentIdStr, student.swimming_pool_id);
      if (success) {
        autoLinked = true;
        console.log(`[guardians POST] 자동 연결 완료: parent=${existingPa.id} student=${studentIdStr}`);
      }
    }

    res.json({ success: true, slot: savedSlot, auto_linked: autoLinked });
  } catch (e) { console.error("[guardians POST]", e); res.status(500).json({ success: false, message: "서버 오류" }); }
});

// DELETE /parent/guardians — 추가 보호자 번호 삭제 (미연결 pending 상태만)
router.delete("/guardians", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId = req.user!.userId;
    const { studentId, slot } = req.body;
    const slotNum = Number(slot);
    if (!studentId || ![2, 3, 4].includes(slotNum)) {
      res.status(400).json({ success: false, message: "studentId와 slot(2/3/4)이 필요합니다." }); return;
    }

    const [link] = (await db.execute(sql`
      SELECT id FROM parent_students WHERE parent_id = ${parentId} AND student_id = ${studentId} AND status = 'approved' LIMIT 1
    `)).rows as any[];
    if (!link) { res.status(403).json({ success: false, message: "권한이 없습니다." }); return; }

    const [student] = (await db.execute(sql`
      SELECT swimming_pool_id, parent_phone2, parent_phone3, parent_phone4
      FROM students WHERE id = ${studentId} LIMIT 1
    `)).rows as any[];
    if (!student) { res.status(404).json({ success: false, message: "학생을 찾을 수 없습니다." }); return; }

    const phone = slotNum === 2 ? student.parent_phone2 : slotNum === 3 ? student.parent_phone3 : student.parent_phone4;
    if (!phone) { res.json({ success: true, message: "이미 비어있습니다." }); return; }

    const normPhone = phone.replace(/[^0-9]/g, "");
    // 연결된 학부모 계정이 있으면 삭제 불가
    const [connected] = (await db.execute(sql`
      SELECT pa.id FROM parent_accounts pa
      JOIN parent_students ps ON ps.parent_id = pa.id AND ps.student_id = ${studentId} AND ps.status = 'approved'
      WHERE REGEXP_REPLACE(COALESCE(pa.phone,''),'[^0-9]','','g') = ${normPhone}
      LIMIT 1
    `)).rows as any[];

    if (connected) {
      res.status(400).json({ success: false, message: "이미 연결된 보호자 번호는 삭제할 수 없습니다." }); return;
    }

    const studentIdStr = String(studentId);
    if (slotNum === 2) {
      await db.execute(sql`UPDATE students SET parent_phone2 = NULL, updated_at = NOW() WHERE id = ${studentIdStr}`);
    } else if (slotNum === 3) {
      await db.execute(sql`UPDATE students SET parent_phone3 = NULL, updated_at = NOW() WHERE id = ${studentIdStr}`);
    } else {
      await db.execute(sql`UPDATE students SET parent_phone4 = NULL, updated_at = NOW() WHERE id = ${studentIdStr}`);
    }
    console.log(`[guardians DELETE] student=${studentIdStr} slot=${slotNum} cleared`);
    res.json({ success: true });
  } catch (e) { console.error("[guardians DELETE]", e); res.status(500).json({ success: false, message: "서버 오류" }); }
});

// ── WP15.5-C Fix: Ad Slot (PARENT_HOME_BANNER) ───────────────────────────────
// GET /parent/ad-slot?placement=PARENT_HOME_BANNER
// - 활성 Creative 1개 반환만. impression 기록은 앱이 직접 POST /parent/ad-events/impression
router.get("/ad-slot", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const placement = (req.query.placement as string) || "PARENT_HOME_BANNER";

    const result = await db.execute(sql`
      SELECT id, placement, creative_type, headline, body_text,
             image_url, destination_url, effect_type
      FROM ad_creatives
      WHERE placement   = ${placement}
        AND is_active   = true
      ORDER BY display_order ASC, created_at DESC
      LIMIT 1
    `);

    const creative = (result.rows[0] as any) ?? null;
    res.json({ creative });
  } catch (err: any) {
    console.error("[parent/ad-slot] error:", err?.message);
    res.status(500).json({ error: "광고 슬롯 조회 실패" });
  }
});

// ── WP15.5-C Fix: Ad Events ──────────────────────────────────────────────────
// POST /parent/ad-events/impression  — banner가 실제로 렌더된 후 앱이 1회 호출
// POST /parent/ad-events/click       — 사용자가 광고 클릭 시 앱이 호출
// analytics_events 전용 테이블에만 기록. event_logs 사용 금지.

const SAFE_URL_RE = /^https?:\/\//i;

router.post("/ad-events/impression", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const { creative_id, placement } = req.body ?? {};
    if (!creative_id || !placement) {
      return res.status(400).json({ error: "creative_id, placement 필수" });
    }

    // creative 유효성 확인
    const check = await db.execute(sql`
      SELECT id FROM ad_creatives WHERE id = ${creative_id} AND is_active = true LIMIT 1
    `);
    if (!check.rows.length) {
      return res.status(404).json({ error: "유효하지 않은 creative" });
    }

    const { logAnalyticsEvent } = await import("../lib/analytics-logger.js");
    await logAnalyticsEvent({
      event_type:       "AD_IMPRESSION",
      user_id:          req.user!.userId,
      swimming_pool_id: req.user!.poolId ?? null,
      role:             "parent_account",
      creative_id,
      placement,
    }).catch(() => {});

    res.json({ success: true });
  } catch (err: any) {
    console.error("[parent/ad-events/impression] error:", err?.message);
    res.status(500).json({ error: "impression 기록 실패" });
  }
});

router.post("/ad-events/click", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const { creative_id, placement } = req.body ?? {};
    if (!creative_id || !placement) {
      return res.status(400).json({ error: "creative_id, placement 필수" });
    }

    // creative 유효성 + destination_url 확인
    const check = await db.execute(sql`
      SELECT id, destination_url FROM ad_creatives WHERE id = ${creative_id} AND is_active = true LIMIT 1
    `);
    if (!check.rows.length) {
      return res.status(404).json({ error: "유효하지 않은 creative" });
    }

    const dest = (check.rows[0] as any).destination_url ?? "";
    // URL 안전성: http/https만 허용
    if (dest && !SAFE_URL_RE.test(dest)) {
      console.warn(`[parent/ad-events/click] 위험 URL 차단: ${dest}`);
      return res.status(400).json({ error: "허용되지 않는 URL scheme" });
    }

    const { logAnalyticsEvent } = await import("../lib/analytics-logger.js");
    await logAnalyticsEvent({
      event_type:       "AD_CLICK",
      user_id:          req.user!.userId,
      swimming_pool_id: req.user!.poolId ?? null,
      role:             "parent_account",
      creative_id,
      placement,
      metadata:         { destination_url: dest },
    }).catch(() => {});

    res.json({ success: true, destination_url: dest });
  } catch (err: any) {
    console.error("[parent/ad-events/click] error:", err?.message);
    res.status(500).json({ error: "click 기록 실패" });
  }
});

// ─── GET /parent/students/:studentId/curriculum-progress ─────────────────────
// 학생의 SCP(student_curriculum_progress) 조회.
// 보안: parent → approved student relation → student의 pool → SCP
router.get("/students/:studentId/curriculum-progress", requireAuth, requireParent, async (req: AuthRequest, res) => {
  try {
    const parentId  = req.user!.userId;
    const { studentId } = req.params;

    // 1. Parent ownership 확인 — parent_students approved 링크 있어야 함
    const linkRes = await db.execute(sql`
      SELECT ps.student_id, s.swimming_pool_id
      FROM parent_students ps
      JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_id   = ${parentId}
        AND ps.student_id  = ${studentId}
        AND ps.status      = 'approved'
      LIMIT 1
    `);
    if (!linkRes.rows.length) {
      return res.status(403).json({ error: "접근 권한이 없습니다." });
    }

    const row = linkRes.rows[0] as { student_id: string; swimming_pool_id: string };
    const poolId = row.swimming_pool_id;

    if (!poolId) {
      return res.status(403).json({ error: "학생의 수영장 정보가 없습니다." });
    }

    // 2. SCP 조회 (student + pool 모두 매칭 — cross-pool leakage 차단)
    const scpRes = await superAdminDb.execute(sql`
      SELECT
        student_id,
        display_confirmed_pct,
        active_confirmed_pct,
        active_confirmed_rank,
        active_confirmed_total,
        active_curriculum_version_id,
        observation_session_count,
        confirmed_at,
        display_updated_at,
        prev_curriculum_version_id
      FROM student_curriculum_progress
      WHERE student_id       = ${studentId}
        AND swimming_pool_id = ${poolId}
      LIMIT 1
    `);

    // 3. SCP row 없으면 empty zero response (404 아님)
    if (!scpRes.rows.length) {
      return res.json({
        student_id:                    studentId,
        display_confirmed_pct:         0,
        active_confirmed_pct:          0,
        active_confirmed_rank:         0,
        active_confirmed_total:        0,
        active_curriculum_version_id:  null,
        observation_session_count:     0,
        confirmed_at:                  null,
        display_updated_at:            null,
        is_version_transition:         false,
      });
    }

    const scp = scpRes.rows[0] as any;
    return res.json({
      student_id:                    scp.student_id,
      display_confirmed_pct:         Number(scp.display_confirmed_pct ?? 0),
      active_confirmed_pct:          Number(scp.active_confirmed_pct ?? 0),
      active_confirmed_rank:         Number(scp.active_confirmed_rank ?? 0),
      active_confirmed_total:        Number(scp.active_confirmed_total ?? 0),
      active_curriculum_version_id:  scp.active_curriculum_version_id ?? null,
      observation_session_count:     Number(scp.observation_session_count ?? 0),
      confirmed_at:                  scp.confirmed_at ?? null,
      display_updated_at:            scp.display_updated_at ?? null,
      is_version_transition:         scp.prev_curriculum_version_id != null,
    });
  } catch (err: any) {
    console.error("[parent/curriculum-progress] error:", err?.message);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;



