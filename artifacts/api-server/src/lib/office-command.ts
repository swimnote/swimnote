import { createHash, randomUUID } from "node:crypto";

/** Pure contract + injected SQL connection: importing this module never opens a database. */
export class OfficeError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export type OfficeActor = { userId: string; poolId: string; role: string };
export type OfficeCommand = {
  action: "update" | "move"; requestId: string; memberId: string; expectedRevision: string;
  changes?: Record<string, string>; fromClassId?: string; toClassId?: string;
};
export type OfficeReceipt = {
  requestId: string; memberId: string; revision: string; action: "update" | "move";
  changes: { field: string; before: string; after: string }[]; assignedClassIds: string[];
};
export interface OfficeSql {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  release(): void;
}
export interface OfficePool { connect(): Promise<OfficeSql> }
const id = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(x);
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const bad = (code: string, message: string, status = 400): never => { throw new OfficeError(status, code, message); };
export const OFFICE_EDIT_FIELDS = ["name", "phone", "birth_date", "birth_year", "parent_name", "memo"] as const;
export function parseOfficeCommand(value: unknown): OfficeCommand {
  if (!record(value)) return bad("INPUT", "명확한 작업 입력이 필요합니다.");
  const keys = ["action", "requestId", "memberId", "expectedRevision",
    ...(value.action === "update" ? ["changes"] : value.action === "move" ? ["fromClassId", "toClassId"] : [])];
  if (!["update", "move"].includes(String(value.action)) || Object.keys(value).some(k => !keys.includes(k)) ||
      !id(value.requestId) || !id(value.memberId) || typeof value.expectedRevision !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.expectedRevision)) return bad("INPUT", "허용된 작업·대상·조회 버전이 필요합니다.");
  if (value.action === "update") {
    if (!record(value.changes) || !Object.keys(value.changes).length ||
        Object.keys(value.changes).some(k => !(OFFICE_EDIT_FIELDS as readonly string[]).includes(k)))
      return bad("INPUT", "지원하는 일반 정보만 수정할 수 있습니다.");
    for (const [k, v] of Object.entries(value.changes)) {
      if (typeof v !== "string" || v.length > (k === "memo" ? 8000 : 120) || /[\u0000-\u0008]/.test(v))
        return bad("INPUT", "입력 길이 또는 형식을 확인하세요.");
      if (k === "name" && !v.trim()) return bad("INPUT", "이름을 입력하세요.");
      if (k === "phone" && v && !/^[0-9+() -]{5,30}$/.test(v)) return bad("INPUT", "일반 연락처 형식을 확인하세요.");
      if (k === "birth_year" && v && (!/^\d{4}$/.test(v) || +v < 1900 || +v > new Date().getFullYear()))
        return bad("INPUT", "생년을 확인하세요.");
      if (k === "birth_date" && v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) ||
          new Date(v).toISOString().slice(0, 10) !== v)) return bad("INPUT", "생년월일을 확인하세요.");
    }
  } else if (!id(value.fromClassId) || !id(value.toClassId) || value.fromClassId === value.toClassId)
    return bad("INPUT", "출발반과 다른 목적 반을 선택하세요.");
  return value as OfficeCommand;
}
function authorize(actor: OfficeActor) {
  if (actor.role !== "pool_admin" || !id(actor.userId) || !id(actor.poolId)) bad("FORBIDDEN", "현재 수영장 관리자 권한이 필요합니다.", 403);
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const receiptKey = (actor: OfficeActor, requestId: string) => "office_" + digest(JSON.stringify([actor.poolId, actor.userId, requestId]));
const requestHash = (c: OfficeCommand) => digest(JSON.stringify({ ...c,
  ...(c.changes ? { changes: Object.fromEntries(Object.entries(c.changes).sort(([a], [b]) => a.localeCompare(b))) } : {}) }));
const classIds = (s: any): string[] => Array.isArray(s.assigned_class_ids) && s.assigned_class_ids.length
  ? [...new Set(s.assigned_class_ids as string[])] : s.class_group_id ? [s.class_group_id] : [];
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
export class OfficeCommandService {
  constructor(private pool: OfficePool) {}
  async status(actor: OfficeActor, requestId: string): Promise<OfficeReceipt | null> {
    authorize(actor); if (!id(requestId)) return bad("INPUT", "요청 식별자가 필요합니다.");
    const c = await this.pool.connect();
    try {
      const { rows } = await c.query("SELECT payload FROM pool_event_logs WHERE id=$1 AND pool_id=$2 AND actor_id=$3 AND source='office_stage3'", [receiptKey(actor, requestId), actor.poolId, actor.userId]);
      return rows[0]?.payload?.result ?? null;
    } finally { c.release(); }
  }
  async execute(actor: OfficeActor, raw: unknown): Promise<OfficeReceipt> {
    authorize(actor); const cmd = parseOfficeCommand(raw), hash = requestHash(cmd), key = receiptKey(actor, cmd.requestId);
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='5s'");
      // Scoped receipt lock precedes row locks. Same key cannot execute twice, even after response loss.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
      const old = (await c.query("SELECT payload FROM pool_event_logs WHERE id=$1", [key])).rows[0];
      if (old) {
        if (old.payload.requestHash !== hash) return bad("REQUEST_REUSED", "같은 요청 번호를 다른 변경에 사용할 수 없습니다.", 409);
        await c.query("COMMIT"); return old.payload.result;
      }
      const s = (await c.query("SELECT s.*, md5(row_to_json(s)::text) AS office_revision FROM students s WHERE id=$1 FOR UPDATE", [cmd.memberId])).rows[0];
      if (!s || s.swimming_pool_id !== actor.poolId) return bad("MISSING", "해당 회원이 없거나 조회 권한이 없습니다.", 404);
      if (s.office_revision !== cmd.expectedRevision) return bad("CONFLICT", "다른 변경이 있습니다. 입력을 보존한 채 최신 정보와 비교하세요.", 409);
      if (["archived", "deleted"].includes(s.status)) return bad("STATE", "현재 회원 상태에서는 변경할 수 없습니다.", 409);
      const changes: OfficeReceipt["changes"] = [];
      let assigned = classIds(s);
      if (cmd.action === "update") {
        const entries = Object.entries(cmd.changes!);
        for (const [field, value] of entries) changes.push({ field, before: String(s[field] ?? ""), after: field === "name" ? value.trim() : value });
        await c.query(`UPDATE students SET ${entries.map(([field], i) => `"${field}"=$${i + 2}`).join(",")}, updated_at=clock_timestamp() WHERE id=$1`,
          [s.id, ...entries.map(([field, value]) => field === "name" ? value.trim() : value)]);
      } else {
        if (s.status !== "active" || !assigned.includes(cmd.fromClassId!) || assigned.includes(cmd.toClassId!))
          return bad("STATE", "현재 재원 상태와 출발반·목적 반 소속을 다시 확인하세요.", 409);
        const allIds = [...new Set([...assigned, cmd.toClassId!])].sort();
        const groups = (await c.query("SELECT * FROM class_groups WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE", [allIds])).rows;
        if (groups.length !== allIds.length || groups.some(g => g.swimming_pool_id !== actor.poolId || g.is_deleted || g.is_one_time))
          return bad("CLASS", "현재 수영장의 활성 정규반을 선택하세요.", 409);
        const target = groups.find(g => g.id === cmd.toClassId)!;
        const day = todayKst();
        const history = (await c.query("SELECT class_group_id FROM student_class_history WHERE student_id=$1 AND enrolled_at<=$2::date AND (left_at IS NULL OR left_at>$2::date)", [s.id, day])).rows.map(r => r.class_group_id);
        if (!history.includes(cmd.fromClassId!) || history.some(id => !assigned.includes(id)) || assigned.some(id => !history.includes(id)))
          return bad("HISTORY", "배정과 현재 수강 이력이 다릅니다. 이력 확인 후 이동하세요.", 409);
        const count = +(await c.query(`SELECT count(DISTINCT s.id)::int AS count FROM students s
          JOIN student_class_history h ON h.student_id=s.id WHERE s.swimming_pool_id=$1 AND s.status='active'
          AND h.class_group_id=$2 AND h.enrolled_at<=$3::date AND (h.left_at IS NULL OR h.left_at>$3::date)`,
          [actor.poolId, target.id, day])).rows[0].count;
        if (target.capacity != null && count >= target.capacity) return bad("CAPACITY", "목적 반 정원이 찼습니다.", 409);
        const days = (g: any) => [...new Set(String(g.schedule_days).replace(/요일/g, "").match(/[월화수목금토일]/g) ?? [])];
        const time = (g: any) => String(g.schedule_time).slice(0, 5);
        if (groups.some(g => !days(g).length || !/^\d{2}:\d{2}/.test(String(g.schedule_time))))
          return bad("SCHEDULE_UNKNOWN", "반 일정 형식을 확인할 수 없어 이동을 보류합니다.", 409);
        for (const g of groups.filter(g => assigned.includes(g.id) && g.id !== cmd.fromClassId)) {
          if (time(g) === time(target) && days(g).some(d => days(target).includes(d)))
            return bad("SCHEDULE", "유지할 소속 반과 목적 반의 요일·시작 시각이 겹칩니다.", 409);
        }
        assigned = assigned.map(id => id === cmd.fromClassId ? cmd.toClassId! : id);
        const labels = assigned.map(id => {
          const g = groups.find(g => g.id === id)!;
          return days(g).map(d => `${d}${String(g.schedule_time).split(":")[0]}`).join("·");
        }).join("·");
        const planned = (await c.query("SELECT id FROM student_class_history WHERE student_id=$1 AND (enrolled_at>$2::date OR left_at>$2::date) LIMIT 1", [s.id, day])).rows;
        if (planned.length) return bad("HISTORY", "예약된 수강 이력 변경이 있어 먼저 이력을 확인해야 합니다.", 409);
        await c.query("UPDATE student_class_history SET left_at=$3::date WHERE student_id=$1 AND class_group_id=$2 AND enrolled_at<=$3::date AND left_at IS NULL", [s.id, cmd.fromClassId, day]);
        await c.query("INSERT INTO student_class_history (id,student_id,class_group_id,swimming_pool_id,enrolled_at,created_at) VALUES ($1,$2,$3,$4,$5::date,NOW())",
          ["sch_" + randomUUID(), s.id, cmd.toClassId, actor.poolId, day]);
        await c.query("UPDATE students SET assigned_class_ids=$2::jsonb,class_group_id=$3,schedule_labels=$4,updated_at=clock_timestamp() WHERE id=$1",
          [s.id, JSON.stringify(assigned), assigned[0], labels]);
        changes.push({ field: "수강반", before: classIds(s).join(", "), after: assigned.join(", ") });
      }
      const revision = (await c.query("SELECT md5(row_to_json(s)::text) AS revision FROM students s WHERE id=$1", [s.id])).rows[0].revision;
      const result: OfficeReceipt = { requestId: cmd.requestId, memberId: s.id, revision, action: cmd.action, changes, assignedClassIds: assigned };
      // Existing PK + transaction provide durable result/audit, no new table or migration.
      await c.query(`INSERT INTO pool_event_logs (id,pool_id,event_type,entity_type,entity_id,actor_id,payload,source)
        VALUES ($1,$2,$3,'student',$4,$5,$6::jsonb,'office_stage3')`,
        [key, actor.poolId, "member_" + cmd.action, s.id, actor.userId, JSON.stringify({ requestHash: hash, result })]);
      await c.query("COMMIT"); return result;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { c.release(); }
  }
}
