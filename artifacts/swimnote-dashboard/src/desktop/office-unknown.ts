import { api } from "../lib/api-client";

/** Unknown-outcome write memory, scoped by user+pool key. Cleared on session invalid. Same requestId+body only. */
export type Pending = { requestId: string; body: unknown; label: string };
const store = new Map<string, Pending>();
export const pendingGet = (k: string) => store.get(k);
export const pendingSet = (k: string, v: Pending) => { store.set(k, v); };
export const pendingDelete = (k: string) => { store.delete(k); };
export const pendingClear = (keep?: string) => { for (const k of [...store.keys()]) if (!keep || !k.startsWith(`${keep}|`)) store.delete(k); };
if (typeof window !== "undefined") window.addEventListener("office:session-invalid", () => pendingClear());

export const isUnknown = (e: any) => { const s = e?.status; return !(typeof s === "number" && s >= 400 && s < 500 && s !== 408 && s !== 429); };
/** The receipt endpoint returns the saved RESULT itself, not an {item: result} wrapper.
 * CRUD results have item; ledger/import results have event/results/etc. Missing/404 is never proof. */
export async function receiptItem(requestId: string): Promise<unknown | null> {
  try { const r = await api.get<Record<string, unknown>>(`/office/operations/receipts/${encodeURIComponent(requestId)}`);
    return r && typeof r === "object" && !Array.isArray(r) && Object.keys(r).length ? r : null;
  } catch { return null; }
}
export async function receiptSaved(requestId: string): Promise<boolean> { return !!(await receiptItem(requestId)); }
export const errText = (e: any) => e?.status === 503 ? "서버 마이그레이션 대기 중입니다. 저장되지 않았습니다." : e?.status === 409 ? `충돌: ${e.message ?? "다른 변경과 겹칩니다. 새로고침 후 다시 시도하세요."}` : e?.message ?? "요청 실패";
export const uuid = () => crypto.randomUUID();
