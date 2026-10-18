import { api } from "../lib/api-client";
import { csvCell } from "./office-ops-lib";

export type FieldType = "text" | "number" | "date" | "select" | "url" | "ref";
export type FinanceFieldSpec = { key: string; label: string; type?: FieldType; ref?: string; options?: string[]; required?: boolean };
export type FinanceActionSpec = { key: string; label: string; fields: FinanceFieldSpec[] };
export type Totals = { billedKrw: number; receivedKrw: number; refundedKrw: number; expensesPaidKrw: number; dueKrw: number; unallocatedKrw: number; cashFlowKrw: number };
export type FInvoice = { id: string; studentId: string; contractId?: string; label: string; date: string; dueDate: string; amountKrw: number; allocatedKrw: number; dueKrw: number; cancelled: boolean };
export type FReceipt = { id: string; studentId: string; date: string; amountKrw: number; refundedKrw: number; unallocatedKrw: number; method: string; voided: boolean; recordedAt?: string|null; actorId?: string|null; source?: string; externalRef?: string|null };
export type FAllocation = { id: string; receiptId: string; invoiceId: string; amountKrw: number; remainingKrw: number };
export type FExpense = { id: string; label: string; date: string; dueDate: string; vendor: string; category: string; kind: string; amountKrw: number; paidKrw: number; dueKrw: number; cancelled: boolean; evidenceUrl?: string };
export type FClosing = { id: string; fromDate: string; toDate: string; active: boolean; reason: string };
export type FEvent = { id: string; action: string; date: string; [k: string]: any };
export type FRight = { id: string; studentId: string; label: string; startDate: string; endDate: string; totalCount: number; usedCount: number; remainingCount: number | null; weeklyCount?: number | null; weeklyUsedCount?: number | null; held: boolean; renewalDue: boolean; sourceAttendanceCount: number };
export type FFamily = { key: string; label: string; studentIds: string[]; billedKrw: number; dueKrw: number };
export type FinanceSnapshot = {
  version: number; actions: FinanceActionSpec[]; events: FEvent[]; invoices: FInvoice[]; receipts: FReceipt[]; allocations: FAllocation[];
  expenses: FExpense[]; closings: FClosing[]; rights: FRight[]; rightsRows?: never; students: Array<{ id: string; name: string; parent_phone?: string }>;
  families: FFamily[]; refs: Record<string, Array<{ id: string; label: string }>>; totals: Totals; basis: string[]; rights_?: never; studentTotals?: Totals | null;
  reportVersion?: number; tableTotals?: Record<string,Record<string,number>>;
};
export type PreviewResult = { command: Record<string, unknown>; expectedVersion: number; previewHash: string; impact: { before: Totals; after: Totals }; warnings: string[] };

export const financeKey = (scope: string, from: string, to: string, studentId: string, search = "") => ["office-finance", scope, from, to, studentId, search] as const;
export const krw = (n: number | undefined) => typeof n === "number" ? `${n.toLocaleString("ko-KR")}원` : "-";
export const uuid = () => crypto.randomUUID();

export function fetchSnapshot(from: string, to: string, studentId: string, search = "") {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (studentId) q.set("studentId", studentId);
  if (search.trim()) q.set("search", search.trim());
  return api.get<FinanceSnapshot>(`/office/operations/finance/snapshot?${q}`);
}
export const previewFinance = (command: Record<string, unknown>, expectedVersion: number) =>
  api.post<PreviewResult>("/office/operations/finance/preview", { command, expectedVersion });
export const executeFinance = (body: { requestId: string; command: Record<string, unknown>; expectedVersion: number; previewHash: string; confirmed: true }) =>
  api.post<{ event: FEvent; version: number }>("/office/operations/finance/execute", body);
export const lookupReceipt = (requestId: string) => api.get<{ event?: FEvent; version?: number }>(`/office/operations/receipts/${encodeURIComponent(requestId)}`);

/** Build a command from string form values using the server action descriptor. Numbers are integer KRW/counts. */
export function buildCommand(spec: FinanceActionSpec, date: string, form: Record<string, string>): { command?: Record<string, unknown>; error?: string } {
  const command: Record<string, unknown> = { action: spec.key, date };
  if (!date) return { error: "기록일을 입력하세요." };
  for (const f of spec.fields) {
    const raw = (form[f.key] ?? "").trim();
    if (!raw) { if (f.required !== false) return { error: `${f.label}을(를) 입력하세요.` }; continue; }
    if (f.type === "number") {
      if (!/^-?\d+$/.test(raw)) return { error: `${f.label}은(는) 정수로 입력하세요.` };
      command[f.key] = Number(raw);
    } else command[f.key] = raw;
  }
  return { command };
}
export const isUnknownOutcome = (e: any) => { if(e?.code==="OFFICE_OUTCOME_UNKNOWN")return true; const s = e?.status; return !(typeof s === "number" && s >= 400 && s < 500 && s !== 408 && s !== 429); };
export const financeCsv = (head: string[], rows: unknown[][]) => "\ufeff" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
