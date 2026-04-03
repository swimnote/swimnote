/**
 * 학부모 수영장 가입 요청 및 관리자 승인/거절
 * POST /auth/pool-join-request  - 공개: 학부모 가입 요청
 * GET  /pools/public-search     - 공개: 수영장 검색
 * GET  /admin/parent-requests   - 관리자: 요청 목록
 * PATCH /admin/parent-requests/:id - 관리자: 승인/거절 (학생 연결 지원)
 */
import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import {
  swimmingPoolsTable, usersTable, parentAccountsTable,
  parentStudentsTable, studentsTable,
} from "@workspace/db/schema";
import { eq, ilike, sql, and, or, isNull, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";

const router = Router();

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── 공개: 수영장 이름 검색 ───────────────────────────────────────────
// name 없으면 전체 목록(반려 제외) 반환, name 있으면 이름 검색
router.get("/pools/public-search", async (req, res) => {
  try {
    const { name } = req.query;
    const nameStr = name ? String(name).trim() : "";

    const results = nameStr.length > 0
      ? await superAdminDb.select({
          id: swimmingPoolsTable.id,
          name: swimmingPoolsTable.name,
          address: swimmingPoolsTable.address,
          phone: swimmingPoolsTable.phone,
        }).from(swimmingPoolsTable)
          .where(and(
            sql`approval_status != 'rejected'`,
            ilike(swimmingPoolsTable.name, `%${nameStr}%`)
          ))
          .orderBy(swimmingPoolsTable.name)
          .limit(50)
      : await superAdminDb.select({
          id: swimmingPoolsTable.id,
          name: swimmingPoolsTable.name,
          address: swimmingPoolsTable.address,
          phone: swimmingPoolsTable.phone,
        }).from(swimmingPoolsTable)
          .where(sql`approval_status != 'rejected'`)
          .orderBy(swimmingPoolsTable.name)
          .limit(100);

    res.json({ success: true, data: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});



// ─── 관리자: 학부모 초대코드 생성 ────────────────────────────────────────
router.post("/admin/parent-invites", requireAuth, requireRole("pool_admin", "super_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const { parent_name, phone, child_name, child_birth_year, notes } = req.body;
      if (!parent_name?.trim() || !phone?.trim()) {
        res.status(400).json({ success: false, message: "이름과 전화번호는 필수입니다." }); return;
      }
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const code = generateInviteCode();
      const id = genId("pic");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

      await db.execute(sql`
        INSERT INTO parent_invite_codes (id, swimming_pool_id, parent_name, phone, child_name, child_birth_year, notes, code, expires_at, is_used, created_by, created_at)
        VALUES (${id}, ${me.swimming_pool_id}, ${parent_name.trim()}, ${phone.trim()},
                ${child_name?.trim() || null}, ${child_birth_year || null}, ${notes?.trim() || null},
                ${code}, ${expiresAt.toISOString()}, false, ${req.user!.userId}, now())
      `);

      res.status(201).json({ success: true, data: { id, code, expires_at: expiresAt } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);


// ─── 관리자: 학부모 초대코드 목록 ─────────────────────────────────────────
router.get("/admin/parent-invites", requireAuth, requireRole("pool_admin", "super_admin", "teacher"),
  async (req: AuthRequest, res) => {
    try {
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const rows = await db.execute(sql`
        SELECT * FROM parent_invite_codes
        WHERE swimming_pool_id = ${me.swimming_pool_id}
        ORDER BY created_at DESC LIMIT 50
      `);
      res.json({ success: true, data: rows.rows });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자/선생님: 학생별 학부모 수업 요청 조회 ─────────────────────────
// GET /parent-requests?student_id=xxx
router.get("/parent-requests", requireAuth, requireRole("pool_admin", "sub_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { student_id } = req.query;
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      let q = `SELECT * FROM parent_student_requests WHERE swimming_pool_id = '${me.swimming_pool_id}'`;
      if (student_id) q += ` AND student_id = '${student_id}'`;
      q += ` ORDER BY created_at DESC LIMIT 100`;

      const result = await db.execute(sql.raw(q));
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 학부모: 수업 요청 생성 ──────────────────────────────────────────────
// POST /parent/requests
router.post("/parent/requests", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "parent") {
        res.status(403).json({ success: false, message: "학부모만 이용 가능합니다." }); return;
      }
      const { student_id, request_type, request_date, content } = req.body;
      const VALID_TYPES = ["absence", "makeup", "postpone", "withdrawal", "counseling", "inquiry"];
      if (!student_id || !request_type) {
        res.status(400).json({ success: false, message: "student_id와 request_type은 필수입니다." }); return;
      }
      if (!VALID_TYPES.includes(request_type)) {
        res.status(400).json({ success: false, message: "유효하지 않은 요청 유형입니다." }); return;
      }

      const paResult = await db.execute(sql`
        SELECT pa.swimming_pool_id, ps.student_id
        FROM parent_accounts pa
        JOIN parent_students ps ON ps.parent_id = pa.id AND ps.student_id = ${student_id} AND ps.status = 'approved'
        WHERE pa.id = ${req.user!.userId}
        LIMIT 1
      `);
      const pa = paResult.rows[0] as any;
      if (!pa) { res.status(403).json({ success: false, message: "해당 학생에 대한 권한이 없습니다." }); return; }

      const poolId = pa.swimming_pool_id;
      const result = await db.execute(sql`
        INSERT INTO parent_student_requests (swimming_pool_id, student_id, parent_id, request_type, request_date, content)
        VALUES (${poolId}, ${student_id}, ${req.user!.userId}, ${request_type}, ${request_date || null}, ${content || null})
        RETURNING *
      `);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 학부모: 내 수업 요청 목록 조회 ─────────────────────────────────────
// GET /parent/requests?student_id=xxx
router.get("/parent/requests", requireAuth,
  async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "parent") {
        res.status(403).json({ success: false, message: "학부모만 이용 가능합니다." }); return;
      }
      const { student_id } = req.query;
      let q = `SELECT * FROM parent_student_requests WHERE parent_id = '${req.user!.userId}'`;
      if (student_id) q += ` AND student_id = '${student_id}'`;
      q += ` ORDER BY created_at DESC LIMIT 50`;

      const result = await db.execute(sql.raw(q));
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 학부모 수업 요청 처리 (pending→done/rejected) ────────────────
// PATCH /parent-requests/:id
router.patch("/parent-requests/:id", requireAuth, requireRole("pool_admin", "sub_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { status, admin_note } = req.body;
      if (!["done", "rejected", "pending"].includes(status)) {
        res.status(400).json({ success: false, message: "status는 done, rejected, pending 중 하나여야 합니다." }); return;
      }
      const [me] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      await db.execute(sql`
        UPDATE parent_student_requests
        SET status = ${status},
            admin_note = ${admin_note || null},
            processed_by = ${req.user!.userId},
            processed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${req.params.id} AND swimming_pool_id = ${me.swimming_pool_id}
      `);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

export default router;
