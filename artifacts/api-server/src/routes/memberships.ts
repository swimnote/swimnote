/**
 * memberships.ts — Multi-Pool Membership API 엔드포인트
 *
 * GET  /me/memberships   — 현재 인증된 계정의 유효 membership 목록
 * POST /auth/switch-pool — 수영장/역할 전환 (JWT 재발급)
 */

import { Router } from "express";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { signToken } from "../lib/auth.js";
import { getMemberships, checkMembership, upsertMembership } from "../migrations/pool-db-membership.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

// ── GET /me/memberships ────────────────────────────────────────────────────
// 현재 로그인 사용자(users OR parent_accounts)의 유효 membership 목록 반환
// Response: { memberships: [{ pool_id, pool_name, role, status }] }
router.get("/me/memberships", requireAuth, async (req: AuthRequest, res) => {
  try {
    const accountId = req.user!.userId;
    const memberships = await getMemberships(accountId);
    return res.json({ success: true, memberships });
  } catch (e) {
    console.error("[memberships] GET /me/memberships 오류:", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

// ── POST /auth/switch-pool ─────────────────────────────────────────────────
// 수영장 전환: membership 존재 확인 후 새 JWT 발급
// Body: { pool_id: string, role: string }
// Response: { success: true, token: string, pool_id: string, role: string, pool_name: string }
router.post("/auth/switch-pool", requireAuth, async (req: AuthRequest, res) => {
  const { pool_id, role } = req.body;
  if (!pool_id || !role) {
    return err(res, 400, "pool_id와 role을 모두 지정해주세요.");
  }

  try {
    const accountId = req.user!.userId;
    const currentRole = req.user!.role;

    // parent_account는 parent_accounts 테이블 소속
    const accountType = currentRole === "parent_account" ? "parent" : "user";

    // DB에서 membership 존재 확인 (cross-pool 보안 검증)
    const hasMembership = await checkMembership({
      accountId,
      poolId: pool_id,
      role,
    });

    if (!hasMembership) {
      // membership이 없는 경우: 현재 pool에서 역할이 있는지 재확인
      // (backfill 누락 대비 — 기존 users.swimming_pool_id 기반 fallback)
      if (accountType === "user") {
        const userRow = await superAdminDb.execute(sql.raw(`
          SELECT roles, swimming_pool_id, role AS primary_role
          FROM users WHERE id = '${accountId}' LIMIT 1
        `));
        const row = userRow.rows[0] as any;
        if (row && row.swimming_pool_id === pool_id) {
          const userRoles: string[] = Array.isArray(row.roles) && row.roles.length > 0
            ? row.roles
            : [row.primary_role];
          if (userRoles.includes(role)) {
            // backfill 누락 → 지금 생성
            await upsertMembership({ accountId, accountType: "user", poolId: pool_id, role }).catch(() => {});
            // 진행
          } else {
            return err(res, 403, "해당 수영장에서 해당 역할 권한이 없습니다.");
          }
        } else {
          return err(res, 403, "해당 수영장에 대한 접근 권한이 없습니다.");
        }
      } else {
        // parent: parent_accounts.swimming_pool_id 확인
        const paRow = await superAdminDb.execute(sql.raw(`
          SELECT swimming_pool_id FROM parent_accounts WHERE id = '${accountId}' LIMIT 1
        `));
        const pa = paRow.rows[0] as any;
        if (pa && pa.swimming_pool_id === pool_id && role === "parent_account") {
          await upsertMembership({ accountId, accountType: "parent", poolId: pool_id, role: "parent_account" }).catch(() => {});
        } else {
          return err(res, 403, "해당 수영장에 대한 접근 권한이 없습니다.");
        }
      }
    }

    // pool 이름 조회
    const poolRow = await superAdminDb.execute(sql.raw(`
      SELECT name FROM swimming_pools WHERE id = '${pool_id}' LIMIT 1
    `));
    const poolName = (poolRow.rows[0] as any)?.name ?? pool_id;

    // 새 JWT 발급 (poolId 업데이트, backward-compatible)
    const newToken = signToken({ userId: accountId, role, poolId: pool_id });

    return res.json({
      success: true,
      token: newToken,
      pool_id,
      role,
      pool_name: poolName,
    });
  } catch (e) {
    console.error("[memberships] POST /auth/switch-pool 오류:", e);
    return err(res, 500, "서버 오류가 발생했습니다.");
  }
});

export default router;
