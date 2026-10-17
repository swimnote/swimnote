import type { ReactNode } from "react";

export type OfficeRole = "pool_admin" | "teacher";
export type ClassGroup = { id: string; name: string; schedule_days?: string; schedule_time?: string };
export type Student = { id: string; name: string; class_group_id?: string | null; assigned_class_ids?: unknown; assignedClasses?: unknown };

export class ContractError extends Error { constructor(where: string) { super(`${where}: 예상하지 못한 서버 응답입니다.`); } }
export const arr = <T,>(v: unknown, where: string): T[] => { if (!Array.isArray(v)) throw new ContractError(where); return v as T[]; };
export const rec = (v: unknown, where: string): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new ContractError(where); return v as Record<string, unknown>; };
export const okFlag = (v: unknown, where: string) => { if (rec(v, where).success !== true) throw new ContractError(where); };
export const errMsg = (e: unknown) => (e as { message?: string })?.message ?? "요청에 실패했습니다.";
export const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
export const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** Class membership from /students enrichment; null = not determinable. */
export const classIdsOf = (s: Student): string[] | null => {
  const a = Array.isArray(s.assigned_class_ids) ? ids(s.assigned_class_ids) : null;
  const e = Array.isArray(s.assignedClasses) ? (s.assignedClasses as { id?: unknown }[]).map((c) => c.id).filter((x): x is string => typeof x === "string") : null;
  if (a === null && e === null && s.class_group_id === undefined) return null;
  return [...new Set([...(a ?? []), ...(e ?? []), ...(typeof s.class_group_id === "string" ? [s.class_group_id] : [])])];
};
export function Blocked({ children }: { children: ReactNode }) { return <div className="oap-note" role="note">{children}</div>; }
export function QState({ q, empty }: { q: { isLoading: boolean; isError: boolean; error?: unknown; refetch: () => unknown }; empty?: string }) {
  if (q.isLoading) return <div className="oap-empty">불러오는 중…</div>;
  if (q.isError) return <div className="oap-empty"><span className="oap-err">{errMsg(q.error)} </span><button onClick={() => q.refetch()}>다시 시도</button></div>;
  return empty ? <div className="oap-empty">{empty}</div> : null;
}
