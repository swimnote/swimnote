import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { logPoolEvent } from "../lib/pool-event-logger.js";
import { triggerAutoLinkOnStudentV2 } from "../lib/auto-link-v2.js";
import {
  studentsTable, classGroupsTable, parentStudentsTable,
  parentAccountsTable, usersTable, attendanceTable,
  classChangeLogsTable,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { createSystemMessage } from "../utils/messenger-system.js";
import { logChange } from "../utils/change-logger.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

// 회원 수 한도 체크 헬퍼
// effective_member_limit = pool.member_limit(개별 override) 우선, 없으면 subscription_plans.member_limit
async function getEffectiveMemberLimit(poolId: string): Promise<{ limit: number; current: number; overrideActive: boolean }> {
  const [planRow] = (await superAdminDb.execute(sql`
    SELECT COALESCE(p.member_limit, sp.member_limit) AS effective_member_limit,
           p.member_limit AS pool_override
    FROM swimming_pools p
    LEFT JOIN subscription_plans sp ON sp.tier = p.subscription_tier
    WHERE p.id = ${poolId} LIMIT 1
  `)).rows as any[];
  const [cntRow] = (await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM students
    WHERE swimming_pool_id = ${poolId} AND status NOT IN ('archived','deleted')
  `)).rows as any[];
  const limit = Number(planRow?.effective_member_limit ?? 5);
  const current = Number(cntRow?.cnt ?? 0);
  const overrideActive = planRow?.pool_override != null;
  console.log(`[member-limit] poolId=${poolId} limit=${limit} (override=${overrideActive ? planRow?.pool_override : 'none'}) current=${current}`);
  return { limit, current, overrideActive };
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** 반 배정 정보 enrichment */
async function enrichWithClasses(student: any) {
  const assignedIds: string[] = Array.isArray(student.assigned_class_ids)
    ? student.assigned_class_ids
    : (typeof student.assigned_class_ids === "string"
      ? JSON.parse(student.assigned_class_ids || "[]")
      : []);

  if (assignedIds.length === 0) return { ...student, assignedClasses: [] };

  const classes = await Promise.all(assignedIds.map(async (id: string) => {
    const [cg] = await db.select({
      id: classGroupsTable.id, name: classGroupsTable.name,
      schedule_days: classGroupsTable.schedule_days, schedule_time: classGroupsTable.schedule_time,
      instructor: classGroupsTable.instructor,
    }).from(classGroupsTable).where(eq(classGroupsTable.id, id)).limit(1);
    return cg || null;
  }));

  const validClasses = classes.filter(Boolean);

  // schedule_labels 자동 생성: 월4·목7 형식
  const labels = validClasses.map((c: any) => {
    if (!c) return "";
    const days = c.schedule_days.split(",").map((d: string) => d.trim());
    const hour = c.schedule_time.split(":")[0];
    return days.map((d: string) => `${d}${hour}`).join("·");
  }).filter(Boolean).join("·");

  return { ...student, assignedClasses: validClasses, schedule_labels: labels };
}

// ── GET / ──────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId && req.user!.role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    // pool_all=true: 반배정 목적으로 선생님도 pool 전체 학생 조회 가능
    const poolAll = req.query.pool_all === "true";

    let students: any[];

    if (req.user!.role === "teacher" && !poolAll) {
      // teacher (일반): 본인이 담당하는 반에 배정된 학생만 반환 (삭제된 반 제외)
      const teacherClasses = await db.select({ id: classGroupsTable.id })
        .from(classGroupsTable)
        .where(and(
          eq(classGroupsTable.swimming_pool_id, poolId!),
          eq(classGroupsTable.teacher_user_id, req.user!.userId),
          eq(classGroupsTable.is_deleted, false)
        ));
      const classIds = teacherClasses.map(c => c.id);
      if (classIds.length === 0) {
        return res.json([]);
      }
      const classIdsLiteral = classIds.map(id => `'${id}'`).join(",");
      students = await db.select().from(studentsTable)
        .where(and(
          eq(studentsTable.swimming_pool_id, poolId!),
          sql`status NOT IN ('archived', 'deleted')`,
          sql`(
            class_group_id = ANY(ARRAY[${sql.raw(classIdsLiteral)}])
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(assigned_class_ids, '[]'::jsonb)) AS cid
              WHERE cid = ANY(ARRAY[${sql.raw(classIdsLiteral)}])
            )
          )`
        ));
    } else {
      // admin / super_admin / teacher(pool_all=true): 해당 수영장의 모든 학생 반환
      // archived/deleted 제외, suspended/withdrawn 포함 (회원 목록에서 필터로 구분)
      students = await db.select().from(studentsTable)
        .where(and(
          eq(studentsTable.swimming_pool_id, poolId!),
          sql`status NOT IN ('archived', 'deleted')`
        ));
    }

    const enriched = await Promise.all(students.map(async (s) => {
      let class_group_name: string | null = null;
      if (s.class_group_id) {
        const [grp] = await db.select({ name: classGroupsTable.name }).from(classGroupsTable).where(eq(classGroupsTable.id, s.class_group_id)).limit(1);
        class_group_name = grp?.name || null;
      }
      const withClasses = await enrichWithClasses({ ...s, class_group_name });
      return withClasses;
    }));

    res.json(enriched.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST /teacher-request — 선생님 등록 요청 (pending_approval) ───
router.post("/teacher-request", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { name, birth_year, parent_name, parent_phone, weekly_count = 1 } = req.body;
  if (!name?.trim()) return err(res, 400, "학생 이름을 입력해주세요.");

  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const id = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.execute(sql`
      INSERT INTO students (
        id, swimming_pool_id, name, birth_year, parent_name, parent_phone,
        weekly_count, status, registration_path, invite_code, created_at, updated_at
      ) VALUES (
        ${id}, ${poolId}, ${name.trim()},
        ${birth_year || null}, ${parent_name || null},
        ${parent_phone ? parent_phone.replace(/[^0-9]/g, "") : null},
        ${weekly_count}, 'pending_approval', 'teacher_request',
        NULL, NOW(), NOW()
      )
    `);
    await logChange({ tenantId: req.user!.userId, tableName: "students", recordId: id, changeType: "create", payload: {
      name: name.trim(), status: "pending_approval", registration_path: "teacher_request",
    } });
    // V2 자동연결 트리거 (신규 등록)
    triggerAutoLinkOnStudentV2(id, ["name", "parent_phone", "swimming_pool_id"]).catch(e =>
      console.error("[v2-admin-trigger] teacher-request 트리거 오류:", e?.message)
    );
    return res.json({ success: true, id, name: name.trim(), status: "pending_approval" });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── GET /teacher-requests — 선생님 등록 요청 대기 목록 (관리자용) ──
router.get("/teacher-requests", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");
    const rows = (await db.execute(sql`
      SELECT id, name, birth_year, parent_name, parent_phone, weekly_count, created_at
      FROM students WHERE swimming_pool_id = ${poolId} AND status = 'pending_approval'
      ORDER BY created_at DESC
    `)).rows;
    return res.json(rows);
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST /teacher-requests/:id/approve — 등록 요청 승인 (관리자) ───
router.post("/teacher-requests/:id/approve", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const poolId = await getPoolId(req.user!.userId);
    const invite_code = generateInviteCode();
    const [row] = (await db.execute(sql`
      UPDATE students
      SET status = 'active', invite_code = ${invite_code}, registration_path = 'admin_created', updated_at = NOW()
      WHERE id = ${id} AND swimming_pool_id = ${poolId} AND status = 'pending_approval'
      RETURNING id, name
    `)).rows as any[];
    if (!row) return err(res, 404, "승인 대기 중인 요청을 찾을 수 없습니다.");
    await logChange({ tenantId: req.user!.userId, tableName: "students", recordId: id, changeType: "update", payload: { status: "active", action: "teacher_request_approved" } });
    // V2 자동연결 트리거 (승인 완료)
    triggerAutoLinkOnStudentV2(id, ["status", "name", "parent_phone"]).catch(e =>
      console.error("[v2-admin-trigger] approve 트리거 오류:", e?.message)
    );
    return res.json({ success: true, id: row.id, name: row.name, invite_code });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /teacher-requests/:id/reject — 등록 요청 거절 (관리자) ──
router.delete("/teacher-requests/:id/reject", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [row] = (await db.execute(sql`
      DELETE FROM students WHERE id = ${id} AND swimming_pool_id = ${poolId} AND status = 'pending_approval' RETURNING id, name
    `)).rows as any[];
    if (!row) return err(res, 404, "승인 대기 중인 요청을 찾을 수 없습니다.");
    return res.json({ success: true, id: row.id, name: row.name });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST /batch — 학생 일괄 등록 ─────────────────────────────────
router.post("/batch", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const items: Array<{
    name: string;
    birth_year?: string | null;
    parent_name?: string | null;
    parent_phone?: string | null;
    weekly_count?: number;
    memo?: string | null;
  }> = req.body;

  if (!Array.isArray(items) || items.length === 0)
    return err(res, 400, "등록할 학생 데이터가 없습니다.");

  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    // 회원 수 한도 체크 (배치 전체)
    // effective_member_limit = p.member_limit(개별 override) 우선, 없으면 sp.member_limit(플랜 기본값)
    const [planRow] = (await superAdminDb.execute(sql`
      SELECT COALESCE(p.member_limit, sp.member_limit) AS effective_member_limit,
             p.member_limit AS pool_override,
             sp.member_limit AS plan_default
      FROM swimming_pools p
      LEFT JOIN subscription_plans sp ON sp.tier = p.subscription_tier
      WHERE p.id = ${poolId} LIMIT 1
    `)).rows as any[];
    const [cntRow] = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${poolId} AND status NOT IN ('archived','deleted')
    `)).rows as any[];
    const limit   = Number(planRow?.effective_member_limit ?? 5);
    const current = Number(cntRow?.cnt ?? 0);
    const available = Math.max(0, limit - current);
    console.log(`[members] poolId=${poolId} limit=${limit} (override=${planRow?.pool_override ?? 'none'}, plan=${planRow?.plan_default}) current=${current}`);

    const succeeded: string[] = [];
    const failed: Array<{ name: string; reason: string; code?: string }> = [];

    let registeredCount = 0;
    for (const s of items) {
      if (!s.name?.trim()) {
        failed.push({ name: "(이름없음)", reason: "이름 누락" });
        continue;
      }
      // 한도 초과 시 개별 실패 처리 (전체 차단 대신)
      if (registeredCount >= available) {
        failed.push({ name: s.name.trim(), reason: `회원 수 한도 초과 (플랜 최대 ${limit}명)`, code: "MEMBER_LIMIT_EXCEEDED" });
        continue;
      }
      try {
        const normPhone     = s.parent_phone ? s.parent_phone.replace(/[^0-9]/g, "") : null;
        const normPName     = s.parent_name  ? s.parent_name.replace(/\s+/g, "").toLowerCase() : null;
        let resolvedParentUserId: string | null = null;
        if (normPhone) {
          const matched = await db.execute(sql`
            SELECT id FROM parent_accounts
            WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = ${normPhone}
              AND (swimming_pool_id = ${poolId} OR swimming_pool_id IS NULL)
            ORDER BY (swimming_pool_id = ${poolId}) DESC NULLS LAST
            LIMIT 1
          `);
          if ((matched.rows as any[]).length > 0)
            resolvedParentUserId = (matched.rows[0] as any).id;
        }
        if (!resolvedParentUserId && normPName) {
          const matched2 = await db.execute(sql`
            SELECT id FROM parent_accounts
            WHERE REPLACE(LOWER(COALESCE(name,'')),' ','') = ${normPName}
              AND (swimming_pool_id = ${poolId} OR swimming_pool_id IS NULL)
            ORDER BY (swimming_pool_id = ${poolId}) DESC NULLS LAST
            LIMIT 1
          `);
          if ((matched2.rows as any[]).length > 0)
            resolvedParentUserId = (matched2.rows[0] as any).id;
        }

        const id = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const invite_code = generateInviteCode();
        await db.insert(studentsTable).values({
          id,
          swimming_pool_id: poolId,
          name: s.name.trim(),
          birth_year: s.birth_year || null,
          parent_name: s.parent_name || null,
          parent_phone: normPhone ? normPhone : null,
          parent_user_id: resolvedParentUserId,
          memo: s.memo || null,
          status: resolvedParentUserId ? "active" : "unregistered",
          registration_path: "admin_created",
          weekly_count: Number(s.weekly_count) > 0 ? Number(s.weekly_count) : 1,
          invite_code,
          assigned_class_ids: [],
          schedule_labels: null,
          class_group_id: null,
          phone: null,
          birth_date: null,
        });

        if (resolvedParentUserId) {
          const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await db.execute(sql`
            INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at)
            VALUES (${psId}, ${resolvedParentUserId}, ${id}, ${poolId}, 'approved', NOW())
            ON CONFLICT DO NOTHING
          `);
        }

        logPoolEvent({ pool_id: poolId, event_type: "student.create", entity_type: "student", entity_id: id, actor_id: req.user!.userId, payload: { name: s.name.trim() } }).catch(() => {});
        succeeded.push(s.name.trim());
        registeredCount++;
      } catch (innerErr: any) {
        failed.push({ name: s.name.trim(), reason: innerErr?.message ?? "오류" });
      }
    }

    return res.json({ success: true, succeeded: succeeded.length, failed, available, limit, current });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST / — 학생 등록 ────────────────────────────────────────────
router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const {
    name, phone, birth_date, birth_year, parent_name, parent_phone,
    parent_user_id, class_group_id, memo, weekly_count = 1,
    registration_path = "admin_created", force_create = false,
  } = req.body;

  if (!name?.trim()) return err(res, 400, "학생 이름을 입력해주세요.");

  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    // ── 회원 수 한도 체크 ─────────────────────────────────────────────
    // effective_member_limit = p.member_limit(개별 override) 우선, 없으면 sp.member_limit(플랜 기본값)
    {
      const [planRow] = (await superAdminDb.execute(sql`
        SELECT COALESCE(p.member_limit, sp.member_limit) AS effective_member_limit,
               p.member_limit AS pool_override,
               sp.member_limit AS plan_default
        FROM swimming_pools p
        LEFT JOIN subscription_plans sp ON sp.tier = p.subscription_tier
        WHERE p.id = ${poolId} LIMIT 1
      `)).rows as any[];
      const [cntRow] = (await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM students
        WHERE swimming_pool_id = ${poolId} AND status NOT IN ('archived','deleted')
      `)).rows as any[];
      const limit = Number(planRow?.effective_member_limit ?? 5);
      const current = Number(cntRow?.cnt ?? 0);
      console.log(`[members] poolId=${poolId} limit=${limit} (override=${planRow?.pool_override ?? 'none'}, plan=${planRow?.plan_default}) current=${current}`);
      if (current >= limit) {
        return res.status(403).json({
          success: false,
          error: `회원 수 제한 초과: 현재 ${current}명 / 최대 ${limit}명 (${planRow?.pool_override != null ? '개별 설정' : '플랜 기본값'})`,
          code: "MEMBER_LIMIT_EXCEEDED",
          current,
          limit,
          override_active: planRow?.pool_override != null,
        });
      }
    }

    // ── 학부모 전화번호/이름으로 기존 계정 찾기 (자동 연결용) ─────────
    // 같은 수영장 우선, 없으면 수영장 미선택(NULL) 학부모도 매칭
    const normParentPhone = parent_phone ? parent_phone.replace(/[^0-9]/g, "") : null;
    const normParentName  = parent_name  ? parent_name.replace(/\s+/g, "").toLowerCase() : null;

    let resolvedParentUserId = parent_user_id || null;
    if (!resolvedParentUserId && normParentPhone) {
      const matchedPa = await db.execute(sql`
        SELECT id FROM parent_accounts
        WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = ${normParentPhone}
          AND (swimming_pool_id = ${poolId} OR swimming_pool_id IS NULL)
        ORDER BY (swimming_pool_id = ${poolId}) DESC NULLS LAST
        LIMIT 1
      `);
      if ((matchedPa.rows as any[]).length > 0)
        resolvedParentUserId = (matchedPa.rows[0] as any).id;
    }
    if (!resolvedParentUserId && normParentName) {
      const matchedPaByName = await db.execute(sql`
        SELECT id FROM parent_accounts
        WHERE REPLACE(LOWER(COALESCE(name,'')),' ','') = ${normParentName}
          AND (swimming_pool_id = ${poolId} OR swimming_pool_id IS NULL)
        ORDER BY (swimming_pool_id = ${poolId}) DESC NULLS LAST
        LIMIT 1
      `);
      if ((matchedPaByName.rows as any[]).length > 0)
        resolvedParentUserId = (matchedPaByName.rows[0] as any).id;
    }

    // ── placeholder 병합: 학부모 가입 시 생성된 unregistered 학생이 이미 있으면 업데이트 ─
    if (!force_create && resolvedParentUserId) {
      const placeholder = await db.execute(sql`
        SELECT id FROM students
        WHERE swimming_pool_id = ${poolId}
          AND name = ${name.trim()}
          AND parent_user_id = ${resolvedParentUserId}
          AND registration_path = 'parent_signup'
          AND status = 'unregistered'
        LIMIT 1
      `);
      if ((placeholder.rows as any[]).length > 0) {
        const placeholderId = (placeholder.rows[0] as any).id;
        const invite_code = generateInviteCode();
        await db.execute(sql`
          UPDATE students SET
            birth_year = COALESCE(NULLIF(birth_year,''), ${birth_year || null}),
            parent_name = COALESCE(NULLIF(parent_name,''), ${parent_name || null}),
            parent_phone = COALESCE(NULLIF(parent_phone,''), ${normParentPhone}),
            memo = COALESCE(NULLIF(memo,''), ${memo || null}),
            weekly_count = ${Number(weekly_count) || 1},
            registration_path = 'admin_created',
            invite_code = ${invite_code},
            status = 'active',
            updated_at = NOW()
          WHERE id = ${placeholderId}
        `);
        const [merged] = (await db.execute(sql`SELECT * FROM students WHERE id = ${placeholderId}`)).rows as any[];
        const enriched = await enrichWithClasses({ ...merged, class_group_name: null });
        await logChange({ tenantId: poolId!, tableName: "students", recordId: placeholderId, changeType: "update", payload: { action: "placeholder_merged", status: "active" } });
        logPoolEvent({ pool_id: poolId!, event_type: "student.activate", entity_type: "student", entity_id: placeholderId, actor_id: req.user!.userId, payload: { name: name.trim() } }).catch(() => {});
        return res.status(201).json({ success: true, ...enriched });
      }
    }

    // ── 중복 체크 ──────────────────────────────────────────────────
    if (!force_create && (birth_year || normParentPhone)) {
      const dupRows = await db.execute(sql`
        SELECT id, name, birth_year, parent_phone, status
        FROM students
        WHERE swimming_pool_id = ${poolId}
          AND status NOT IN ('withdrawn', 'deleted', 'archived')
          AND name = ${name.trim()}
          AND (
            ${birth_year ? sql`birth_year = ${birth_year}` : sql`FALSE`}
            OR ${normParentPhone ? sql`REGEXP_REPLACE(COALESCE(parent_phone,''),'[^0-9]','','g') = ${normParentPhone}` : sql`FALSE`}
          )
        LIMIT 5
      `);
      if (dupRows.rows.length > 0) {
        const exact = (dupRows.rows as any[]).find((r: any) =>
          r.name === name.trim() &&
          (!birth_year || r.birth_year === birth_year) &&
          (!normParentPhone || (r.parent_phone || "").replace(/[^0-9]/g, "") === normParentPhone)
        );
        if (exact) return res.status(409).json({ success: false, duplicate: true, existing: exact, message: "동일한 학생이 이미 등록되어 있습니다." });
        return res.status(200).json({ success: false, possible_duplicate: true, candidates: dupRows.rows, message: "유사한 학생 정보가 있습니다. 계속 등록하시겠습니까?" });
      }
    }

    // ── 초대코드 생성 ──────────────────────────────────────────────
    const invite_code = registration_path === "admin_created" ? generateInviteCode() : null;

    // ── 상태 결정: 학부모 계정이 이미 연결되면 바로 active ─────────
    const status = resolvedParentUserId ? "active" : "unregistered";

    const id = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [student] = await db.insert(studentsTable).values({
      id,
      swimming_pool_id: poolId,
      name: name.trim(),
      phone: phone || null,
      birth_date: birth_date || null,
      birth_year: birth_year || null,
      parent_name: parent_name || null,
      parent_phone: normParentPhone || null,
      parent_user_id: resolvedParentUserId,
      class_group_id: class_group_id || null,
      memo: memo || null,
      status,
      registration_path,
      weekly_count: Number(weekly_count) || 1,
      invite_code,
      assigned_class_ids: [],
      schedule_labels: null,
    }).returning();

    // ── 학부모 계정 자동 연결 ──────────────────────────────────────
    if (resolvedParentUserId) {
      const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at)
        VALUES (${psId}, ${resolvedParentUserId}, ${id}, ${poolId}, 'approved', NOW())
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        UPDATE parent_accounts SET swimming_pool_id = ${poolId}, updated_at = NOW()
        WHERE id = ${resolvedParentUserId} AND swimming_pool_id IS NULL
      `);
    }

    const enriched = await enrichWithClasses({ ...student, class_group_name: null });
    await logChange({ tenantId: poolId!, tableName: "students", recordId: student.id, changeType: "create", payload: { name: student.name, status: student.status, class_group_id: student.class_group_id } });
    logPoolEvent({
      pool_id: poolId!, event_type: "student.create", entity_type: "student",
      entity_id: student.id, actor_id: req.user!.userId,
      payload: { name: student.name, class_group_id: student.class_group_id },
    }).catch(() => {});
    res.status(201).json({ success: true, ...enriched });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── GET /:id ───────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [student] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!student) return err(res, 404, "학생을 찾을 수 없습니다.");

    if (req.user!.role !== "super_admin" && poolId && student.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    // 단일 class_group
    let class_group: any = null;
    if (student.class_group_id) {
      const [grp] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, student.class_group_id)).limit(1);
      class_group = grp || null;
    }

    // 학부모 연결
    const parentLinks = await db.select({ parent_id: parentStudentsTable.parent_id, status: parentStudentsTable.status })
      .from(parentStudentsTable).where(eq(parentStudentsTable.student_id, student.id));
    const parents = await Promise.all(parentLinks.map(async (link) => {
      const [pa] = await db.select({ id: parentAccountsTable.id, name: parentAccountsTable.name, phone: parentAccountsTable.phone })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, link.parent_id)).limit(1);
      return pa ? { ...pa, link_status: link.status } : null;
    }));

    const enriched = await enrichWithClasses({ ...student, class_group, parents: parents.filter(Boolean) });
    res.json(enriched);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PATCH /:id — 기본 정보 수정 ─────────────────────────────────────
router.patch("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, birth_year, parent_name, parent_phone, class_group_id, memo, weekly_count, status } = req.body;
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select()
      .from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    // ── parent_phone/name 변경 시 자동 학부모 연결 ─────────────────
    const normParentPhone = parent_phone != null
      ? parent_phone.replace(/[^0-9]/g, "") || null
      : (existing.parent_phone ? existing.parent_phone.replace(/[^0-9]/g, "") || null : null);
    const normParentName = parent_name != null
      ? parent_name.replace(/\s+/g, "").toLowerCase() || null
      : (existing.parent_name ? existing.parent_name.replace(/\s+/g, "").toLowerCase() || null : null);
    const effectivePoolId = existing.swimming_pool_id || poolId!;

    let resolvedParentUserId = existing.parent_user_id || null;
    // 학부모 계정이 아직 연결 안 된 경우에만 매칭 시도
    if (!resolvedParentUserId && (parent_phone !== undefined || parent_name !== undefined)) {
      if (normParentPhone) {
        const [matched] = (await db.execute(sql`
          SELECT id FROM parent_accounts
          WHERE REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g') = ${normParentPhone}
            AND (swimming_pool_id = ${effectivePoolId} OR swimming_pool_id IS NULL)
          ORDER BY (swimming_pool_id = ${effectivePoolId}) DESC NULLS LAST
          LIMIT 1
        `)).rows as any[];
        if (matched) resolvedParentUserId = matched.id;
      }
      if (!resolvedParentUserId && normParentName) {
        const [matched] = (await db.execute(sql`
          SELECT id FROM parent_accounts
          WHERE REPLACE(LOWER(COALESCE(name,'')),' ','') = ${normParentName}
            AND (swimming_pool_id = ${effectivePoolId} OR swimming_pool_id IS NULL)
          ORDER BY (swimming_pool_id = ${effectivePoolId}) DESC NULLS LAST
          LIMIT 1
        `)).rows as any[];
        if (matched) resolvedParentUserId = matched.id;
      }
    }

    const newStatus = (status !== undefined) ? status
      : (!existing.parent_user_id && resolvedParentUserId) ? "active"
      : undefined;

    // active로 전환 시 회원 수 한도 체크 (이미 active이면 skip)
    if (newStatus === "active" && (existing as any).status !== "active") {
      const targetPoolId = existing.swimming_pool_id || poolId!;
      const { limit, current, overrideActive } = await getEffectiveMemberLimit(targetPoolId);
      if (current >= limit) {
        return res.status(403).json({
          success: false,
          error: `회원 수 제한 초과: 현재 ${current}명 / 최대 ${limit}명 (${overrideActive ? '개별 설정' : '플랜 기본값'})`,
          code: "MEMBER_LIMIT_EXCEEDED",
          current,
          limit,
          override_active: overrideActive,
        });
      }
    }

    const [student] = await db.update(studentsTable)
      .set({
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(birth_date !== undefined && { birth_date }),
        ...(birth_year !== undefined && { birth_year }),
        ...(parent_name !== undefined && { parent_name }),
        ...(parent_phone !== undefined && { parent_phone: normParentPhone }),
        ...(class_group_id !== undefined && { class_group_id: class_group_id || null }),
        ...(memo !== undefined && { memo }),
        ...(weekly_count !== undefined && { weekly_count: Number(weekly_count) }),
        ...(newStatus !== undefined && { status: newStatus }),
        ...(resolvedParentUserId && !existing.parent_user_id && { parent_user_id: resolvedParentUserId }),
        updated_at: new Date(),
      })
      .where(eq(studentsTable.id, req.params.id))
      .returning();

    // ── parent_students 연결 레코드 생성 (신규 매칭 시) ─────────────
    if (resolvedParentUserId && !existing.parent_user_id) {
      const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at)
        VALUES (${psId}, ${resolvedParentUserId}, ${req.params.id}, ${effectivePoolId}, 'approved', NOW())
        ON CONFLICT DO NOTHING
      `);
    }

    const enriched = await enrichWithClasses(student);
    await logChange({ tenantId: existing.swimming_pool_id, tableName: "students", recordId: student.id, changeType: "update", payload: { name: student.name, status: student.status, class_group_id: student.class_group_id, auto_linked: !!resolvedParentUserId } });
    logPoolEvent({ pool_id: existing.swimming_pool_id, event_type: "member_update", entity_type: "student", entity_id: student.id, actor_id: req.user!.userId, payload: { name: student.name, status: student.status } }).catch(console.error);
    res.json({ success: true, ...enriched, parent_auto_linked: !existing.parent_user_id && !!resolvedParentUserId });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// 날짜 유틸
function _toDateStr(d: Date): string { return d.toISOString().split("T")[0]; }
function _getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return _toDateStr(d);
}
function _addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return _toDateStr(d);
}

// ── POST /:id/remove-from-class — 특정 반에서 제거 (선생님 전용) ────
// effective_timing: "now"(기본) | "next_week" | "week_after"
//   now → 즉시 제거 + change_log(is_applied=true)
//   next_week/week_after → change_log 예약만(is_applied=false), 실제 제거는 effective_date에 자동 적용
// new_status / effective_mode: 기존 호환용 (레거시)
router.post("/:id/remove-from-class", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { class_group_id, new_status, effective_mode, effective_timing } = req.body as {
    class_group_id: string;
    new_status?: string;
    effective_mode?: "immediate" | "next_month";
    effective_timing?: "now" | "next_week" | "week_after";
  };
  if (!class_group_id) return err(res, 400, "class_group_id 필요");

  const validNewStatuses = ["pending", "suspended", "withdrawn"];
  if (new_status && !validNewStatuses.includes(new_status)) {
    return err(res, 400, "new_status는 pending, suspended, withdrawn 중 하나여야 합니다.");
  }

  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생 없음");
    if (poolId && existing.swimming_pool_id !== poolId) return err(res, 403, "접근 권한 없음");

    // 선생님은 본인 담당 반만 제거 가능
    if (req.user!.role === "teacher") {
      const [cls] = await db.select({ teacher_user_id: classGroupsTable.teacher_user_id })
        .from(classGroupsTable)
        .where(eq(classGroupsTable.id, class_group_id))
        .limit(1);
      if (!cls || cls.teacher_user_id !== req.user!.userId) {
        return err(res, 403, "본인이 담당하는 반에서만 제거할 수 있습니다.");
      }
    }

    // 마지막 반 이름 저장
    let lastClassName: string | null = (existing as any).last_class_group_name || null;
    if (!lastClassName && class_group_id) {
      const [cgRow] = await db.select({ name: classGroupsTable.name })
        .from(classGroupsTable).where(eq(classGroupsTable.id, class_group_id)).limit(1);
      lastClassName = cgRow?.name || null;
    }

    const currentIds: string[] = Array.isArray(existing.assigned_class_ids)
      ? existing.assigned_class_ids
      : (typeof existing.assigned_class_ids === "string"
          ? JSON.parse(existing.assigned_class_ids || "[]") : []);

    // ── 다음 달 이동 예약 (next_month) ──────────────────────────────
    // 상태/반 배정 변경 없이 pending 필드만 저장 (휴원/퇴원 예약 배지용)
    if (new_status && effective_mode === "next_month") {
      // 다음 달 YYYY-MM 계산
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

      await db.execute(sql`
        UPDATE students
        SET
          pending_status_change = ${new_status},
          pending_effective_mode = 'next_month',
          pending_effective_month = ${nextMonthStr},
          updated_at = NOW()
        WHERE id = ${req.params.id}
      `);
      return res.json({
        success: true,
        pending_status_change: new_status,
        pending_effective_mode: "next_month",
        pending_effective_month: nextMonthStr,
      });
    }

    if (new_status) {
      // 즉시 이동: 전체 반 배정 해제 + 상태 변경 + pending 초기화
      const extraFields: any = {
        assigned_class_ids: [] as any,
        class_group_id: null,
        schedule_labels: null,
        status: new_status,
        last_class_group_name: lastClassName,
        pending_status_change: null,
        pending_effective_mode: null,
        pending_effective_month: null,
        updated_at: new Date(),
      };
      if (new_status === "withdrawn") {
        extraFields.withdrawn_at = new Date();
      } else if (new_status === "pending" || new_status === "suspended") {
        extraFields.archived_reason = new_status === "suspended" ? "suspended" : "pending";
      }
      await db.update(studentsTable).set(extraFields).where(eq(studentsTable.id, req.params.id));
      return res.json({ success: true, new_status, remaining_classes: 0 });
    }

    // ── 제외 시점 계산 ───────────────────────────────────────────
    const today = _toDateStr(new Date());
    const thisMonday = _getMondayOf(today);
    let effectiveDate = today;
    if (effective_timing === "next_week") effectiveDate = _addDays(thisMonday, 7);
    else if (effective_timing === "week_after") effectiveDate = _addDays(thisMonday, 14);
    const displayWeekStart = _getMondayOf(effectiveDate);

    // 반 이름 조회
    const [cgRow] = await db.select({ name: classGroupsTable.name })
      .from(classGroupsTable).where(eq(classGroupsTable.id, class_group_id)).limit(1);
    const cgName = cgRow?.name || "";

    // 제외 시점이 미래인 경우 → pending log만 생성, DB 반 배정 변경 없음
    if (effective_timing === "next_week" || effective_timing === "week_after") {
      const logId = `ccl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const studentName = (existing as any).name || "회원";
      await db.insert(classChangeLogsTable).values({
        id: logId,
        pool_id: poolId || "",
        class_group_id,
        target_student_id: req.params.id,
        change_type: "remove_from_class",
        effective_date: effectiveDate,
        display_week_start: displayWeekStart,
        note: `${studentName} 반 제외 예정 → 미배정 이동 (${effective_timing === "next_week" ? "다음 주부터" : "다다음 주부터"})`,
        created_by: req.user!.userId,
        is_applied: false,
        created_at: new Date(),
      });
      return res.json({ success: true, scheduled: true, effective_date: effectiveDate, display_week_start: displayWeekStart });
    }

    // 즉시 제거: 특정 반만 제거
    const newIds = currentIds.filter((id: string) => id !== class_group_id);
    const newPrimaryId = newIds[0] || null;

    let labels = "";
    if (newIds.length > 0) {
      const classes = await Promise.all(newIds.map(async (id: string) => {
        const [cg] = await db.select({
          schedule_days: classGroupsTable.schedule_days,
          schedule_time: classGroupsTable.schedule_time,
        }).from(classGroupsTable).where(eq(classGroupsTable.id, id)).limit(1);
        return cg || null;
      }));
      labels = classes.filter(Boolean).map((c: any) => {
        const days = c.schedule_days.split(",").map((d: string) => d.trim());
        const hour = c.schedule_time.split(":")[0];
        return days.map((d: string) => `${d}${hour}`).join("·");
      }).join("·");
    }

    await db.update(studentsTable).set({
      assigned_class_ids: newIds as any,
      class_group_id: newPrimaryId,
      schedule_labels: labels || null,
      updated_at: new Date(),
    }).where(eq(studentsTable.id, req.params.id));

    // change_log 생성 (즉시 적용)
    try {
      const logId = `ccl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const studentName = (existing as any).name || "회원";
      await db.insert(classChangeLogsTable).values({
        id: logId,
        pool_id: poolId || "",
        class_group_id,
        target_student_id: req.params.id,
        change_type: "remove_from_class",
        effective_date: today,
        display_week_start: thisMonday,
        note: `${studentName} 반 제외 → 미배정 이동 (${cgName})`,
        created_by: req.user!.userId,
        is_applied: true,
        created_at: new Date(),
      });
    } catch (logErr) { console.error("[change_log] write error:", logErr); }

    return res.json({ success: true, remaining_classes: newIds.length });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류"); }
});

// ── POST /:id/apply-pending-now — 예정 상태 즉시 적용 ─────────────
// pending_status_change 를 즉시 적용: 상태 변경 + 반 배정 해제 + pending 초기화
router.post("/:id/apply-pending-now", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생 없음");
    if (poolId && existing.swimming_pool_id !== poolId) return err(res, 403, "접근 권한 없음");

    const newStatus = (existing as any).pending_status_change as string | null;
    if (!newStatus) return err(res, 400, "예정된 상태 변경이 없습니다.");

    // 마지막 반 이름 저장 (이미 있으면 유지)
    let lastClassName: string | null = (existing as any).last_class_group_name || null;
    if (!lastClassName && (existing as any).class_group_id) {
      const [cgRow] = await db.select({ name: classGroupsTable.name })
        .from(classGroupsTable).where(eq(classGroupsTable.id, (existing as any).class_group_id)).limit(1);
      lastClassName = cgRow?.name || null;
    }

    const updateData: any = {
      status: newStatus,
      class_group_id: null,
      assigned_class_ids: [] as any,
      schedule_labels: null,
      last_class_group_name: lastClassName,
      pending_status_change: null,
      pending_effective_mode: null,
      pending_effective_month: null,
      archived_reason: newStatus,
      updated_at: new Date(),
    };

    if (newStatus === "withdrawn") {
      updateData.withdrawn_at = new Date();
    }

    await db.update(studentsTable).set(updateData).where(eq(studentsTable.id, req.params.id));
    return res.json({ success: true, new_status: newStatus });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류"); }
});

// ── POST /:id/change-status — 선생님/관리자용 상태 변경 ─────────────────
// new_status: "active" | "unassigned" | "suspended" | "withdrawn"
// effective_mode: "immediate"(기본) | "next_month" (suspended/withdrawn 전용)
router.post("/:id/change-status", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { new_status, effective_mode = "immediate" } = req.body as {
    new_status: string;
    effective_mode?: "immediate" | "next_month";
  };
  const valid = ["active", "unassigned", "suspended", "withdrawn"];
  if (!new_status || !valid.includes(new_status)) return err(res, 400, "new_status 값이 올바르지 않습니다.");

  console.log(`[change-status] DB_TARGET: superAdminDb | student: ${req.params.id} | new_status: ${new_status} | effective_mode: ${effective_mode} | caller: ${req.user?.role}(${req.user?.userId})`);

  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생 없음");
    if (poolId && existing.swimming_pool_id !== poolId) return err(res, 403, "접근 권한 없음");

    console.log(`[change-status] 현재 상태: ${(existing as any).status} | pending: ${(existing as any).pending_status_change ?? "없음"} | pool: ${existing.swimming_pool_id}`);

    // 다음 달 예약 (suspended/withdrawn 만)
    if (effective_mode === "next_month" && (new_status === "suspended" || new_status === "withdrawn")) {
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
      await db.update(studentsTable).set({
        pending_status_change: new_status,
        pending_effective_mode: "next_month",
        pending_effective_month: nextMonthStr,
        updated_at: new Date(),
      } as any).where(eq(studentsTable.id, req.params.id));
      const [updated] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
      console.log(`[change-status] ✅ next_month 예약 완료 → pending: ${new_status} (${nextMonthStr})`);
      return res.json({ success: true, pending_status_change: new_status, pending_effective_mode: "next_month", pending_effective_month: nextMonthStr, student: updated });
    }

    // 즉시 변경
    // active/unassigned 전환 시 회원 수 한도 체크 (이미 active이면 skip)
    if ((new_status === "active" || new_status === "unassigned") && (existing as any).status !== "active") {
      const targetPoolId = existing.swimming_pool_id || poolId;
      if (targetPoolId) {
        const { limit, current, overrideActive } = await getEffectiveMemberLimit(targetPoolId);
        if (current >= limit) {
          return res.status(403).json({
            success: false,
            error: `회원 수 제한 초과: 현재 ${current}명 / 최대 ${limit}명 (${overrideActive ? '개별 설정' : '플랜 기본값'})`,
            code: "MEMBER_LIMIT_EXCEEDED",
            current,
            limit,
            override_active: overrideActive,
          });
        }
      }
    }

    const update: any = {
      pending_status_change: null,
      pending_effective_mode: null,
      pending_effective_month: null,
      updated_at: new Date(),
    };

    if (new_status === "active") {
      update.status = "active";
      update.archived_reason = null;
    } else if (new_status === "unassigned") {
      update.status = "active";
      update.assigned_class_ids = [] as any;
      update.class_group_id = null;
      update.schedule_labels = null;
    } else if (new_status === "suspended" || new_status === "withdrawn") {
      update.status = new_status;
      update.assigned_class_ids = [] as any;
      update.class_group_id = null;
      update.schedule_labels = null;
      update.archived_reason = new_status;
      if (new_status === "withdrawn") {
        update.withdrawn_at = new Date();
      }
    }

    await db.update(studentsTable).set(update).where(eq(studentsTable.id, req.params.id));
    const [updated] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    console.log(`[change-status] ✅ 즉시 변경 완료 → status: ${(updated as any).status}`);
    return res.json({ success: true, new_status, student: updated });
  } catch (e) { console.error("[change-status] ❌ 오류:", e); return err(res, 500, "서버 오류"); }
});

router.post("/:id/move-class", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { from_class_id, to_class_id } = req.body as { from_class_id: string; to_class_id: string };
  if (!from_class_id || !to_class_id) return err(res, 400, "from_class_id, to_class_id 모두 필요");
  if (from_class_id === to_class_id) return err(res, 400, "출발반과 도착반이 같습니다");

  try {
    const poolId = await getPoolId(req.user!.userId);

    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생 없음");
    if (poolId && existing.swimming_pool_id !== poolId) return err(res, 403, "접근 권한 없음");

    // 선생님은 도착반(to_class_id)이 본인 담당 반이어야 함
    if (req.user!.role === "teacher") {
      const [toCls] = await db.select({ teacher_user_id: classGroupsTable.teacher_user_id, name: classGroupsTable.name })
        .from(classGroupsTable).where(eq(classGroupsTable.id, to_class_id)).limit(1);
      if (!toCls || toCls.teacher_user_id !== req.user!.userId) {
        return err(res, 403, "본인이 담당하는 반으로만 이동할 수 있습니다.");
      }
    }

    const currentIds: string[] = Array.isArray(existing.assigned_class_ids)
      ? existing.assigned_class_ids
      : (typeof existing.assigned_class_ids === "string"
          ? JSON.parse(existing.assigned_class_ids || "[]") : []);

    if (!currentIds.includes(from_class_id)) return err(res, 400, "학생이 출발반에 배정되어 있지 않습니다");
    if (currentIds.includes(to_class_id)) return err(res, 400, "이미 현재 반에 배정되어 있습니다");

    // 제거 후 추가
    const newIds = currentIds.filter((id: string) => id !== from_class_id).concat(to_class_id);

    // schedule_labels 재계산
    const clsRows = await Promise.all(newIds.map(async (id: string) => {
      const [cg] = await db.select({
        id: classGroupsTable.id,
        name: classGroupsTable.name,
        schedule_days: classGroupsTable.schedule_days,
        schedule_time: classGroupsTable.schedule_time,
      }).from(classGroupsTable).where(eq(classGroupsTable.id, id)).limit(1);
      return cg || null;
    }));
    const validRows = clsRows.filter(Boolean) as any[];
    const labels = validRows.map((c: any) => {
      const days = c.schedule_days.split(",").map((d: string) => d.trim());
      const hour = c.schedule_time.split(":")[0];
      return days.map((d: string) => `${d}${hour}`).join("·");
    }).join("·");

    const [moved] = await db.update(studentsTable).set({
      assigned_class_ids: newIds as any,
      class_group_id: newIds[0] || null,
      schedule_labels: labels || null,
      status: "active",
      updated_at: new Date(),
    }).where(eq(studentsTable.id, req.params.id)).returning({ id: studentsTable.id });

    // 출발반/도착반 이름 조회 (메신저 메시지용)
    const [fromCls] = await db.select({ name: classGroupsTable.name })
      .from(classGroupsTable).where(eq(classGroupsTable.id, from_class_id)).limit(1);
    const [toCls] = await db.select({ name: classGroupsTable.name })
      .from(classGroupsTable).where(eq(classGroupsTable.id, to_class_id)).limit(1);

    // 메신저 공지 자동 메시지
    if (poolId && fromCls && toCls) {
      await createSystemMessage({
        poolId,
        msgType: "system_move",
        content: `${existing.name} 회원이 ${fromCls.name}에서 ${toCls.name}으로 이동되었습니다.`,
      });
    }

    return res.json({ success: true, assigned_class_ids: newIds });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류"); }
});

// ── PATCH /:id/assign — 반 배정 (관리자 + 선생님 허용) ─────────────
router.patch("/:id/assign", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { assigned_class_ids: rawIds, weekly_count } = req.body;
  if (!Array.isArray(rawIds)) return err(res, 400, "assigned_class_ids는 배열이어야 합니다.");

  // null·undefined 제거 + 중복 제거
  const assigned_class_ids: string[] = [...new Set(rawIds.filter((id: any) => typeof id === "string" && id.trim()))];

  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable).where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    // 선생님 scope check: 배정하려는 반이 모두 본인 담당인지 확인
    if (req.user!.role === "teacher" && assigned_class_ids.length > 0) {
      const myClasses = await db.select({ id: classGroupsTable.id })
        .from(classGroupsTable)
        .where(and(
          eq(classGroupsTable.swimming_pool_id, poolId!),
          eq(classGroupsTable.teacher_user_id, req.user!.userId),
          eq(classGroupsTable.is_deleted, false)
        ));
      const myClassIds = new Set(myClasses.map(c => c.id));
      const unauthorized = assigned_class_ids.filter((id: string) => !myClassIds.has(id));
      if (unauthorized.length > 0) {
        return err(res, 403, "본인이 담당하는 반에만 학생을 배정할 수 있습니다.");
      }
    }

    const wc = weekly_count !== undefined ? Number(weekly_count) : (existing.weekly_count || 1);

    // 배정된 class의 schedule_labels 계산
    const classes = await Promise.all(assigned_class_ids.map(async (id: string) => {
      const [cg] = await db.select({
        id: classGroupsTable.id, name: classGroupsTable.name,
        schedule_days: classGroupsTable.schedule_days, schedule_time: classGroupsTable.schedule_time,
      }).from(classGroupsTable).where(eq(classGroupsTable.id, id)).limit(1);
      return cg || null;
    }));

    const validClasses = classes.filter(Boolean) as any[];
    const labels = validClasses.map((c: any) => {
      const days = c.schedule_days.split(",").map((d: string) => d.trim());
      const hour = c.schedule_time.split(":")[0];
      return days.map((d: string) => `${d}${hour}`).join("·");
    }).join("·");

    // students에 first class_group_id도 업데이트 (하위 호환)
    const firstClassId = assigned_class_ids[0] || null;

    const [student] = await db.update(studentsTable)
      .set({
        assigned_class_ids: assigned_class_ids as any,
        weekly_count: wc,
        schedule_labels: labels || null,
        class_group_id: firstClassId,
        status: "active",
        updated_at: new Date(),
      })
      .where(eq(studentsTable.id, req.params.id))
      .returning();

    // class_groups의 student_count는 GET 때 집계이므로 별도 업데이트 불필요
    const enriched = await enrichWithClasses({ ...student, assignedClasses: validClasses });
    logPoolEvent({
      pool_id: poolId!, event_type: "class_assign", entity_type: "student",
      entity_id: req.params.id, actor_id: req.user!.userId,
      payload: { assigned_class_ids, student_name: existing.name },
    }).catch(() => {});
    res.json({ success: true, ...enriched });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PATCH /:id/weekly-count — 주 수업 횟수 변경 (선생님도 가능) ────
router.patch("/:id/weekly-count", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { weekly_count } = req.body;
    const wc = Number(weekly_count);
    if (!wc || wc < 1 || wc > 10) return err(res, 400, "weekly_count는 1~10 사이여야 합니다.");

    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && existing.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.update(studentsTable)
      .set({ weekly_count: wc, updated_at: new Date() })
      .where(eq(studentsTable.id, req.params.id));

    res.json({ success: true, weekly_count: wc });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /:id — 운영목록에서 제거 (soft delete, 기록 보존) ────────
router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && (existing as any).swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    if ((existing as any).status === "deleted") {
      return res.json({ success: true, message: "이미 삭제회원으로 처리된 학생입니다." });
    }

    const sid = req.params.id;
    console.log(`[deleteStudent] clicked studentId: ${sid}`);

    // 마지막 반 이름 저장
    let lastClassName: string | null = (existing as any).last_class_group_name || null;
    if ((existing as any).class_group_id && !lastClassName) {
      const cgRes = await db.execute(sql`SELECT name FROM class_groups WHERE id = ${(existing as any).class_group_id} LIMIT 1`);
      lastClassName = (cgRes.rows[0] as any)?.name ?? null;
    }

    // soft delete: status='deleted', 반배정 해제, 출결 대상 제외
    await db.execute(sql`
      UPDATE students
      SET
        status = 'deleted',
        deleted_at = NOW(),
        archived_reason = 'member_deleted',
        class_group_id = NULL,
        assigned_class_ids = '[]'::jsonb,
        schedule_labels = NULL,
        last_class_group_name = COALESCE(${lastClassName}, last_class_group_name),
        updated_at = NOW()
      WHERE id = ${sid}
    `);

    // parent_students는 유지 (학부모가 과거 기록 조회 가능해야 함)
    // swim_diary, attendance 기록도 유지
    console.log(`[deleteStudent] archived success: ${sid}`);

    // ── 학부모 자동 비활성화 처리 ─────────────────────────────────
    // 이 학생과 연결된 학부모가 있으면 → 해당 학부모의 다른 활성 학생이 없을 경우 로그인 차단
    const parentUserId = (existing as any).parent_user_id;
    if (parentUserId) {
      const otherActiveStudents = await db.execute(sql`
        SELECT id FROM students
        WHERE parent_user_id = ${parentUserId}
          AND id != ${sid}
          AND status NOT IN ('deleted', 'withdrawn', 'archived')
        LIMIT 1
      `);
      if (otherActiveStudents.rows.length === 0) {
        // 다른 활성 자녀 없음 → 학부모 계정 비활성화 (로그인 차단)
        await db.execute(sql`
          UPDATE parent_accounts SET is_active = false, updated_at = NOW()
          WHERE id = ${parentUserId}
        `);
        // parent_pool_requests도 revoked로 업데이트 (superAdminDb)
        await superAdminDb.execute(sql`
          UPDATE parent_pool_requests
          SET request_status = 'revoked', processed_at = NOW()
          WHERE parent_account_id = ${parentUserId}
            AND request_status IN ('approved', 'auto_approved')
        `).catch(() => {});
        console.log(`[deleteStudent] 학부모 비활성화: parentId=${parentUserId}`);
      }
    }

    await logChange({ tenantId: (existing as any).swimming_pool_id, tableName: "students", recordId: sid, changeType: "delete", payload: { name: (existing as any).name, prev_status: (existing as any).status } });
    res.json({ success: true, message: "회원이 삭제회원으로 처리되었습니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── Attendance routes (unchanged) ─────────────────────────────────
router.get("/:id/attendance", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { month } = req.query;
    let records = await db.select().from(attendanceTable).where(eq(attendanceTable.student_id, req.params.id));
    if (month) records = records.filter(r => r.date.startsWith(month as string));
    res.json(records.sort((a, b) => a.date.localeCompare(b.date)));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

async function autoCreateMakeupForAbsent(
  poolId: string, studentId: string, cgId: string | null, date: string, attendanceId: string
) {
  const existing = (await db.execute(sql`
    SELECT id FROM makeup_sessions
    WHERE student_id = ${studentId} AND absence_date = ${date} AND status != 'cancelled'
    LIMIT 1
  `)).rows as any[];
  if (existing.length > 0) return;
  const [student] = await db.select({ name: studentsTable.name })
    .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
  if (!student) return;
  let teacherId: string | null = null, teacherName: string | null = null, cgName: string | null = null;
  if (cgId) {
    const [cg] = await db.select().from(classGroupsTable).where(eq(classGroupsTable.id, cgId)).limit(1);
    if (cg) { teacherId = cg.teacher_user_id || null; teacherName = cg.instructor || null; cgName = cg.name || null; }
  }
  const mkId = `mk_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  await db.execute(sql`
    INSERT INTO makeup_sessions (
      id, swimming_pool_id, student_id, student_name,
      original_class_group_id, original_class_group_name,
      original_teacher_id, original_teacher_name,
      absence_date, absence_attendance_id, status
    ) VALUES (
      ${mkId}, ${poolId}, ${studentId}, ${student.name},
      ${cgId}, ${cgName}, ${teacherId}, ${teacherName},
      ${date}, ${attendanceId}, 'waiting'
    )
  `);
}

async function cancelWaitingMakeup(studentId: string, date: string) {
  await db.execute(sql`
    UPDATE makeup_sessions
    SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'absent_cleared'
    WHERE student_id = ${studentId} AND absence_date = ${date} AND status = 'waiting'
  `);
}

router.post("/:id/attendance", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  const { date, status, class_group_id } = req.body;
  if (!date || !["present", "absent"].includes(status)) {
    return err(res, 400, "날짜와 출결 상태(present/absent)를 입력해주세요.");
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const [actor] = await superAdminDb.select({ name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    const actorName = actor?.name || req.user!.userId;

    const [student] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    const cgId = class_group_id || student?.class_group_id || null;

    const existing = await db.select().from(attendanceTable)
      .where(and(eq(attendanceTable.student_id, req.params.id), eq(attendanceTable.date, date))).limit(1);

    if (existing.length > 0) {
      const prevStatus = existing[0].status;
      const [updated] = await db.update(attendanceTable)
        .set({
          status,
          class_group_id: cgId || existing[0].class_group_id,
          updated_at: new Date(),
          modified_by: req.user!.userId,
          modified_by_name: actorName,
        })
        .where(eq(attendanceTable.id, existing[0].id)).returning();
      if (status === "absent") {
        // autoCreateMakeupForAbsent 내부에서 중복 방지 처리 (non-cancelled 보강 있으면 skip)
        await autoCreateMakeupForAbsent(poolId, req.params.id, cgId, date, existing[0].id);
      } else if (status === "present" && prevStatus === "absent") {
        await cancelWaitingMakeup(req.params.id, date);
      }
      res.json({ success: true, ...updated, was_modified: true });
    } else {
      const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const [created] = await db.insert(attendanceTable).values({
        id, student_id: req.params.id, swimming_pool_id: poolId,
        class_group_id: cgId || null,
        date, status, created_by: req.user!.userId, created_by_name: actorName,
      }).returning();
      if (status === "absent") {
        await autoCreateMakeupForAbsent(poolId, req.params.id, cgId, date, id);
      }
      res.status(201).json({ success: true, ...created, was_modified: false });
    }
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.patch("/:id/attendance/:attendanceId", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { status } = req.body;
  if (!["present", "absent"].includes(status)) return err(res, 400, "출결 상태는 present 또는 absent여야 합니다.");
  try {
    const [actor] = await superAdminDb.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    const [updated] = await db.update(attendanceTable)
      .set({ status, updated_at: new Date(), modified_by: req.user!.userId, modified_by_name: actor?.name || req.user!.userId })
      .where(eq(attendanceTable.id, req.params.attendanceId)).returning();
    if (!updated) return err(res, 404, "출결 기록을 찾을 수 없습니다.");
    res.json({ success: true, ...updated });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST /:id/purge — 퇴원 학생 개인정보 소각 (이름·부모정보 익명화) ──
router.post("/:id/purge", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [existing] = await db.select().from(studentsTable)
      .where(eq(studentsTable.id, req.params.id)).limit(1);
    if (!existing) return err(res, 404, "학생을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && (existing as any).swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    const status = (existing as any).status;
    if (!["withdrawn", "deleted"].includes(status)) {
      return err(res, 400, `퇴원 상태인 학생만 소각할 수 있습니다. (현재 상태: ${status})`);
    }
    if ((existing as any).is_purged) {
      return res.json({ success: true, message: "이미 소각된 학생입니다." });
    }

    const date = new Date().toISOString().slice(0, 7).replace("-", "");
    await db.execute(sql`
      UPDATE students
      SET
        name         = ${"탈퇴_" + date},
        parent_name  = NULL,
        parent_phone = NULL,
        birth_year   = NULL,
        memo         = NULL,
        invite_code  = NULL,
        parent_user_id = NULL,
        status       = 'deleted',
        is_purged    = true,
        updated_at   = NOW()
      WHERE id = ${req.params.id}
    `).catch(() => db.execute(sql`
      UPDATE students
      SET
        name         = ${"탈퇴_" + date},
        parent_name  = NULL,
        parent_phone = NULL,
        birth_year   = NULL,
        memo         = NULL,
        invite_code  = NULL,
        parent_user_id = NULL,
        status       = 'deleted',
        updated_at   = NOW()
      WHERE id = ${req.params.id}
    `));

    res.json({ success: true, message: "개인정보가 소각되었습니다. 수업 기록은 유지됩니다." });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.delete("/:id/attendance/:attendanceId", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(attendanceTable).where(eq(attendanceTable.id, req.params.attendanceId));
    res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
