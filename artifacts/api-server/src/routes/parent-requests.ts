/**
 * 학부모 수영장 가입 요청 및 관리자 승인/거절
 * POST /auth/pool-join-request  - 공개: 학부모 가입 요청
 * GET  /pools/public-search     - 공개: 수영장 검색
 * GET  /admin/parent-requests   - 관리자: 요청 목록
 * PATCH /admin/parent-requests/:id - 관리자: 승인/거절
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { swimmingPoolsTable, usersTable, parentAccountsTable } from "@workspace/db/schema";
import { eq, ilike, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";

const router = Router();

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ─── 공개: 수영장 이름 검색 ───────────────────────────────────────────
router.get("/pools/public-search", async (req, res) => {
  try {
    const { name } = req.query;
    if (!name || String(name).trim().length < 1) {
      res.json({ success: true, data: [] }); return;
    }
    const results = await db.select({
      id: swimmingPoolsTable.id,
      name: swimmingPoolsTable.name,
      address: swimmingPoolsTable.address,
    }).from(swimmingPoolsTable)
      .where(ilike(swimmingPoolsTable.name, `%${name}%`))
      .limit(20);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

// ─── 공개: 학부모 수영장 가입 요청 ───────────────────────────────────
router.post("/auth/pool-join-request", async (req, res) => {
  try {
    const { swimming_pool_id, parent_name, phone } = req.body;
    if (!swimming_pool_id || !parent_name?.trim() || !phone?.trim()) {
      res.status(400).json({ success: false, message: "수영장, 이름, 전화번호는 필수입니다." }); return;
    }

    // 수영장 존재 확인
    const [pool] = await db.select({ id: swimmingPoolsTable.id })
      .from(swimmingPoolsTable).where(eq(swimmingPoolsTable.id, swimming_pool_id)).limit(1);
    if (!pool) {
      res.status(404).json({ success: false, message: "수영장을 찾을 수 없습니다." }); return;
    }

    // 중복 요청 확인 (같은 풀에 pending 요청 존재)
    const dup = await db.execute(sql`
      SELECT id FROM parent_pool_requests
      WHERE swimming_pool_id = ${swimming_pool_id}
        AND phone = ${phone.trim()}
        AND request_status = 'pending'
      LIMIT 1
    `);
    if (dup.rows.length > 0) {
      res.status(409).json({ success: false, message: "이미 승인 대기 중인 요청이 있습니다." }); return;
    }

    const id = genId("ppr");
    await db.execute(sql`
      INSERT INTO parent_pool_requests (id, swimming_pool_id, parent_name, phone, request_status, requested_at)
      VALUES (${id}, ${swimming_pool_id}, ${parent_name.trim()}, ${phone.trim()}, 'pending', NOW())
    `);

    res.status(201).json({ success: true, data: { id, message: "가입 요청이 접수되었습니다. 수영장 관리자 승인 후 이용 가능합니다." } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "서버 오류" });
  }
});

// ─── 관리자: 학부모 요청 목록 ────────────────────────────────────────
router.get("/admin/parent-requests", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { status } = req.query;
      const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      let q = `SELECT * FROM parent_pool_requests WHERE swimming_pool_id = '${me.swimming_pool_id}'`;
      if (status && ["pending", "approved", "rejected"].includes(status as string)) {
        q += ` AND request_status = '${status}'`;
      }
      q += ` ORDER BY requested_at DESC`;

      const result = await db.execute(sql.raw(q));
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

// ─── 관리자: 학부모 요청 승인/거절 ──────────────────────────────────
router.patch("/admin/parent-requests/:id", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { action, rejection_reason, pin } = req.body;
      if (!["approve", "reject"].includes(action)) {
        res.status(400).json({ success: false, message: "action은 approve 또는 reject여야 합니다." }); return;
      }

      const [me] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!me?.swimming_pool_id) { res.status(403).json({ success: false, message: "소속 수영장 없음" }); return; }

      const existing = await db.execute(sql`
        SELECT * FROM parent_pool_requests
        WHERE id = ${req.params.id} AND swimming_pool_id = ${me.swimming_pool_id}
        LIMIT 1
      `);
      if (!existing.rows.length) { res.status(404).json({ success: false, message: "요청을 찾을 수 없습니다." }); return; }

      const request = existing.rows[0] as any;
      if (request.request_status !== "pending") {
        res.status(409).json({ success: false, message: "이미 처리된 요청입니다." }); return;
      }

      if (action === "approve") {
        // 승인: parent_accounts 생성
        const defaultPin = pin || "0000";
        const pinHash = await hashPassword(defaultPin);
        const paId = genId("pa");

        // 이미 같은 전화번호의 계정이 있는지 확인
        const dupAcc = await db.execute(sql`
          SELECT id FROM parent_accounts
          WHERE phone = ${request.phone} AND swimming_pool_id = ${me.swimming_pool_id}
          LIMIT 1
        `);

        let parentAccountId = dupAcc.rows[0]?.id as string | undefined;
        if (!parentAccountId) {
          await db.execute(sql`
            INSERT INTO parent_accounts (id, swimming_pool_id, phone, pin_hash, name, created_at, updated_at)
            VALUES (${paId}, ${me.swimming_pool_id}, ${request.phone}, ${pinHash}, ${request.parent_name}, NOW(), NOW())
          `);
          parentAccountId = paId;
        }

        await db.execute(sql`
          UPDATE parent_pool_requests
          SET request_status = 'approved', processed_at = NOW(), processed_by = ${req.user!.userId},
              parent_account_id = ${parentAccountId}
          WHERE id = ${req.params.id}
        `);

        res.json({ success: true, message: "승인되었습니다. 학부모 계정이 생성되었습니다.", default_pin: defaultPin });
      } else {
        await db.execute(sql`
          UPDATE parent_pool_requests
          SET request_status = 'rejected', processed_at = NOW(), processed_by = ${req.user!.userId},
              rejection_reason = ${rejection_reason || null}
          WHERE id = ${req.params.id}
        `);
        res.json({ success: true, message: "거절되었습니다." });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "서버 오류" });
    }
  }
);

export default router;
