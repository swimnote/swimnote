import { api } from "../lib/api-client";
import {confirmRecoveryPointer} from "./OfficeRecovery";
import {useEffect} from "react";

/** Unknown-outcome write memory, scoped by user+pool key. Cleared on session invalid. Same requestId+body only. */
export type Pending = { requestId: string; body: unknown; label: string };
const store = new Map<string, Pending>();
export const pendingGet = (k: string) => store.get(k);
export const pendingSet = (k: string, v: Pending) => { store.set(k, v); };
export const pendingDelete = (k: string) => { store.delete(k); };
export const pendingClear = (keep?: string) => { for (const k of [...store.keys()]) if (!keep || !k.startsWith(`${keep}|`)) store.delete(k); };
if (typeof window !== "undefined") window.addEventListener("office:session-invalid", () => pendingClear());

export const isUnknown = (e: any) => { if(e?.code==="OFFICE_OUTCOME_UNKNOWN")return true; const s = e?.status; return !(typeof s === "number" && s >= 400 && s < 500 && s !== 408 && s !== 429); };
/** The receipt endpoint returns the saved RESULT itself, not an {item: result} wrapper.
 * CRUD results have item; ledger/import results have event/results/etc. Missing/404 is never proof. */
export async function receiptItem(requestId: string): Promise<unknown | null> {
  try { const r = await api.get<Record<string, unknown>>(`/office/operations/receipts/${encodeURIComponent(requestId)}`);
    await confirmRecoveryPointer(requestId,r);
    return r && typeof r === "object" && !Array.isArray(r) && Object.keys(r).length ? r : null;
  } catch { return null; }
}
export async function receiptSaved(requestId: string): Promise<boolean> { return !!(await receiptItem(requestId)); }
export const errText = (e: any) => e?.code==="OFFICE_RECOVERY_UNAVAILABLE"?e.message:e?.status === 503 ? "서버 요청을 확정하지 못했습니다. 스키마 적용 여부와 처리 결과를 확인하세요." : e?.status === 409 ? `충돌: ${e.message ?? "다른 변경과 겹칩니다. 새로고침 후 다시 시도하세요."}` : e?.message ?? "요청 실패";
export const uuid = () => crypto.randomUUID();
export function useRecoveredPending(key:string,recover:()=>void){
  useEffect(()=>{const h=(e:Event)=>{if(pendingGet(key)?.requestId===(e as CustomEvent).detail?.requestId)recover();};
    window.addEventListener("office:receipt-recovered",h);return()=>window.removeEventListener("office:receipt-recovered",h);},[key,recover]);
}
