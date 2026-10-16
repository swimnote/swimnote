import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import { verifyToken, TOKEN_VERSION } from "./auth.js";

export interface StreamPrincipal {
  userId: string;
  role: "super_admin" | "pool_admin";
  poolId: string;
  expiresAt: number;
}

/** Same signed APP session and roles as the existing admin SSE, never a query token. */
export function streamPrincipal(token: string, poolId: string): StreamPrincipal {
  const payload = verifyToken(token) as ReturnType<typeof verifyToken> & { exp?: number };
  if (payload.tv !== TOKEN_VERSION || !payload.userId ||
      !["super_admin", "pool_admin"].includes(payload.role) ||
      !Number.isFinite(payload.exp) || payload.exp! * 1000 <= Date.now()) {
    throw new Error("Invalid stream session");
  }
  return { userId: payload.userId, role: payload.role as StreamPrincipal["role"],
    poolId, expiresAt: payload.exp! * 1000 };
}

/** No withdrawal cache/fail-open fallback: opened streams need current DB authority. */
export async function checkStreamAccess(principal: StreamPrincipal): Promise<boolean> {
  return superAdminDb.transaction(async tx => {
    // Local to this read transaction; timeout rolls it back and releases its connection.
    await tx.execute(sql`SET LOCAL statement_timeout = '1500ms'`);
    const result = await tx.execute(sql`
      SELECT u.is_activated, u.withdrawal_requested_at, u.roles, u.role,
             u.swimming_pool_id, p.id AS pool_id, p.deactivated_at
      FROM users u
      LEFT JOIN swimming_pools p ON p.id = ${principal.poolId}
      WHERE u.id = ${principal.userId} LIMIT 1
    `);
    const row = result.rows[0] as {
      is_activated: boolean; withdrawal_requested_at: unknown; roles: string[] | null;
      role: string; swimming_pool_id: string | null; pool_id: string | null; deactivated_at: unknown;
    } | undefined;
    if (!row || row.is_activated !== true || row.withdrawal_requested_at ||
        row.pool_id !== principal.poolId || row.deactivated_at) return false;
    // Preserve requireRole's strict pool_admin roles-array contract.
    if (principal.role === "pool_admin") {
      return Array.isArray(row.roles) && row.roles.includes("pool_admin") &&
        row.swimming_pool_id === principal.poolId;
    }
    return row.role === "super_admin" || !!row.roles?.includes("super_admin");
  });
}
