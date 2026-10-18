import { sql } from "drizzle-orm";
import { digest, OperationError, requestId } from "./office-operations-data.js";

type Outcome = { status: number; body: Record<string, any>; afterCommit?: () => Promise<void> };
type Store = { execute: (query: any) => Promise<any>; transaction: (fn: (tx: any) => Promise<Outcome>) => Promise<Outcome> };

/** Optional OFFICE contract around the canonical student creation, not a second creator.
 * No request body journal, DDL, replay of side effects, or name/phone-based recovery.
 */
export async function withMemberCreationReceipt(
  store: Store, input: { requestId?: unknown; poolId: string; actorId: string; body: unknown },
  perform: (tx: any) => Promise<Outcome>,
): Promise<Outcome> {
  if (input.requestId === undefined) return perform(store);
  const rid = requestId(input.requestId);
  const hash = digest({ action: "member.create", body: input.body });
  return store.transaction(async tx => {
    // Authorization is current DB membership, not just a possibly stale JWT.
    const actor = (await tx.execute(sql`SELECT role, swimming_pool_id FROM users
      WHERE id=${input.actorId} FOR SHARE`)).rows[0];
    if (!actor || !["pool_admin", "super_admin"].includes(actor.role) || actor.swimming_pool_id !== input.poolId)
      throw new OperationError(403, "FORBIDDEN", "현재 관리자 소속과 권한을 확인하세요.");
    const ready = (await tx.execute(sql`SELECT to_regclass('public.office_operation_receipts') IS NOT NULL AS ready`)).rows[0]?.ready;
    if (!ready) throw new OperationError(503, "OFFICE_MIGRATION_REQUIRED", "회원 생성 복구 계약 적용 대기입니다. 저장하지 않았습니다.");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`office-member:${input.poolId}:${rid}`}, 0))`);
    const previous = (await tx.execute(sql`SELECT actor_id,input_hash,result FROM office_operation_receipts
      WHERE pool_id=${input.poolId} AND request_id=${rid}::uuid`)).rows[0];
    if (previous) {
      if (previous.actor_id !== input.actorId || previous.input_hash !== hash || previous.result?.kind !== "member.create")
        throw new OperationError(409, "REQUEST_REUSED", "다른 처리에 사용된 요청 ID입니다.");
      return { status: 200, body: previous.result };
    }
    const result = await perform(tx);
    if (result.body.success === true && typeof result.body.id === "string") {
      const receipt = { kind: "member.create", success: true, id: result.body.id, requestId: rid };
      await tx.execute(sql`INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result)
        VALUES(${input.poolId},${rid}::uuid,${input.actorId},${hash},${JSON.stringify(receipt)}::jsonb)`);
    }
    return result;
  });
}
