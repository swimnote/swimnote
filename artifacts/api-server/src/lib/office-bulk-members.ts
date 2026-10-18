import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertMemberLimitInTx, MemberLimitError } from "./member-limit.js";
import { OperationError, phone } from "./office-operations-data.js";

/** Shared insertion path for canonical bulk commit and resumable OFFICE imports.
 * Caller owns the transaction; no network notifications or implicit DDL here.
 */
export async function commitBulkMemberRows(tx: any, poolId: string, input: Array<Record<string, any>>) {
  if (!input.length || input.length > 1000) throw new OperationError(400,"ROW_LIMIT_EXCEEDED","한 번에 1~1,000행만 등록할 수 있습니다.");
  const {limit,current,planKey} = await assertMemberLimitInTx(tx, poolId);
  if (current + input.length > limit) throw new MemberLimitError(limit,current,planKey);
  const rows = input.map(row => ({
    name:String(row.name ?? "").trim(), parent_phone:phone(row.parent_phone),
    parent_name:String(row.parent_name ?? "").trim() || null,
    phone:row.phone ? phone(row.phone) : null,
    birth_year:String(row.birth_year ?? "").trim() || null,
    class_group_id:row.class_group_id || null, memo:String(row.memo ?? "").trim() || null,
    weekly_count:Math.max(1,Number(row.weekly_count) || 1),
  }));
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.name || !/^0\d{8,10}$/.test(row.parent_phone)) throw new OperationError(400,"VALIDATION_ERROR","이름·보호자 연락처를 확인하세요.");
    const key = `${row.name.replace(/\s/g,"")}|${row.parent_phone}`;
    if (keys.has(key)) throw new OperationError(409,"DUPLICATE_MEMBER","동일 회원 후보가 중복됩니다.");
    keys.add(key);
    if (row.class_group_id) {
      const c = await tx.execute(sql`SELECT id FROM class_groups WHERE id=${row.class_group_id} AND swimming_pool_id=${poolId} AND is_deleted=false`);
      if (!c.rows.length) throw new OperationError(403,"CLASS_SCOPE","센터에 속하지 않은 반입니다.");
    }
    const duplicate = await tx.execute(sql`SELECT id FROM students WHERE swimming_pool_id=${poolId}
      AND regexp_replace(name,'\\s','','g')=${row.name.replace(/\s/g,"")}
      AND regexp_replace(COALESCE(parent_phone,''),'[^0-9]','','g')=${row.parent_phone} LIMIT 1`);
    if (duplicate.rows.length) throw new OperationError(409,"DUPLICATE_MEMBER","기존 회원과 일치합니다. 자동 덮어쓰기는 하지 않습니다.");
  }
  const parents = await tx.execute(sql`SELECT id,phone FROM parent_accounts WHERE swimming_pool_id=${poolId}`);
  const byPhone = new Map<string,string>();
  for (const p of parents.rows) {
    const key = phone(p.phone);
    if (key && !byPhone.has(key)) byPhone.set(key,p.id);
  }
  const ids: string[] = [];
  for (const row of rows) {
    const id = `student_${randomUUID()}`;
    // Never link a parent account by name alone or grant a cross-centre relation.
    const parentId = byPhone.get(row.parent_phone) ?? null;
    await tx.execute(sql`INSERT INTO students
      (id,swimming_pool_id,name,birth_year,parent_name,parent_phone,parent_user_id,class_group_id,
       memo,status,registration_path,weekly_count,invite_code,assigned_class_ids,schedule_labels,phone,created_at,updated_at)
      VALUES (${id},${poolId},${row.name},${row.birth_year},${row.parent_name},${row.parent_phone},
       ${parentId},${row.class_group_id},${row.memo},${parentId ? "active" : "unregistered"},
       'admin_created',${row.weekly_count},${randomUUID().replace(/-/g,"").slice(0,8).toUpperCase()},
       '[]'::jsonb,NULL,${row.phone},NOW(),NOW())`);
    if(row.class_group_id) await tx.execute(sql`INSERT INTO student_class_history
      (id,student_id,class_group_id,swimming_pool_id,enrolled_at,created_at)
      VALUES (${`sch_${randomUUID()}`},${id},${row.class_group_id},${poolId},
        (now() AT TIME ZONE 'Asia/Seoul')::date,NOW())`);
    if (parentId) await tx.execute(sql`INSERT INTO parent_students
      (id,parent_id,student_id,swimming_pool_id,status,approved_at)
      VALUES (${`ps_${randomUUID()}`},${parentId},${id},${poolId},'approved',NOW()) ON CONFLICT DO NOTHING`);
    ids.push(id);
  }
  return ids;
}
