/**
 * student-create-service.ts — 학생 등록 공통 서비스
 *
 * 단건 등록(POST /students)과 대량 등록(POST /admin/members/bulk/commit)이
 * 동일한 비즈니스 규칙을 따르도록 공통 함수를 제공합니다.
 *
 * createStudentCore: tx 안에서 단일 학생 INSERT + 부모 연결
 *   - 반드시 db.transaction() 안에서 호출
 *   - assertMemberLimitInTx는 호출자(bulk: 한 번)가 처리
 */

import { db } from "@workspace/db";
import { studentsTable, parentStudentsTable, parentAccountsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";

// 공통 입력 타입
export interface StudentCreateInput {
  name: string;
  phone?: string | null;
  birth_year?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  class_group_id?: string | null;
  memo?: string | null;
  weekly_count?: number;
  registration_path?: string;
  swimming_pool_id: string;
}

export interface StudentCreateResult {
  id: string;
  name: string;
  status: string;
  class_group_id: string | null;
  parent_user_id: string | null;
  invite_code: string | null;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * 단일 학생 INSERT (tx 안에서 호출).
 * - 부모 계정 자동 연결 (parent_phone 기준)
 * - parent_students 연결 (같은 tx)
 * - bulk all-or-nothing을 위해 tx를 호출자가 관리
 */
export async function createStudentCore(
  tx: any,
  input: StudentCreateInput
): Promise<StudentCreateResult> {
  const poolId = input.swimming_pool_id;
  const normParentPhone = input.parent_phone ? input.parent_phone.replace(/[^0-9]/g, "") : null;
  const normParentName  = input.parent_name  ? input.parent_name.replace(/\s+/g, "").toLowerCase() : null;

  // ── 학부모 계정 자동 매칭 (phone → name 순) ───────────────────────────────
  let resolvedParentUserId: string | null = null;
  if (normParentPhone) {
    const matchedPa = await tx.execute(sql`
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
    const matchedPaByName = await tx.execute(sql`
      SELECT id FROM parent_accounts
      WHERE REPLACE(LOWER(COALESCE(name,'')),' ','') = ${normParentName}
        AND (swimming_pool_id = ${poolId} OR swimming_pool_id IS NULL)
      ORDER BY (swimming_pool_id = ${poolId}) DESC NULLS LAST
      LIMIT 1
    `);
    if ((matchedPaByName.rows as any[]).length > 0)
      resolvedParentUserId = (matchedPaByName.rows[0] as any).id;
  }

  const status = resolvedParentUserId ? "active" : "unregistered";
  const registration_path = input.registration_path ?? "admin_created";
  const invite_code = registration_path === "admin_created" ? generateInviteCode() : null;
  const id = `student_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // ── INSERT ─────────────────────────────────────────────────────────────────
  const [inserted] = await tx.insert(studentsTable).values({
    id,
    swimming_pool_id: poolId,
    name: input.name.trim(),
    phone: input.phone || null,
    birth_year: input.birth_year || null,
    parent_name: input.parent_name || null,
    parent_phone: normParentPhone,
    parent_user_id: resolvedParentUserId,
    class_group_id: input.class_group_id || null,
    memo: input.memo || null,
    status,
    registration_path,
    weekly_count: Number(input.weekly_count ?? 1),
    invite_code,
    assigned_class_ids: [],
    schedule_labels: null,
  }).returning();

  // ── 학부모 계정 자동 연결 ──────────────────────────────────────────────────
  if (resolvedParentUserId) {
    const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await tx.execute(sql`
      INSERT INTO parent_students (id, parent_id, student_id, swimming_pool_id, status, approved_at)
      VALUES (${psId}, ${resolvedParentUserId}, ${id}, ${poolId}, 'approved', NOW())
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`
      UPDATE parent_accounts SET swimming_pool_id = ${poolId}, updated_at = NOW()
      WHERE id = ${resolvedParentUserId} AND swimming_pool_id IS NULL
    `);
  }

  return {
    id: inserted.id,
    name: inserted.name,
    status: inserted.status,
    class_group_id: inserted.class_group_id ?? null,
    parent_user_id: resolvedParentUserId,
    invite_code,
  };
}
