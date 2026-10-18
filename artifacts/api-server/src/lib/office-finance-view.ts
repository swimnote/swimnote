import { OperationError } from "./office-operations-data.js";
import { projectFinance, type FinanceEvent } from "./office-finance.js";

/** Filter only AFTER projection: replaying a member subset loses cross-family allocations.
 * Both visible lists/CSV and their totals use these same rows on the same DB snapshot. */
export function financeView(events: FinanceEvent[], students: {id:string;name:string}[], from: string, to: string, sid = "", search = "") {
  const all = events.filter(e => e.date <= to), p = projectFinance(all);
  const byId = new Map(all.map(e => [e.id,e]));
  const names = new Map(students.map(s=>[s.id,s.name]));
  const q = search.trim().toLowerCase();
  const match = (...v: unknown[]) => !q || v.some(x=>String(x??"").toLowerCase().includes(q));
  const metadata = (id: string) => {
    const e = byId.get(id);
    return {actorId:e?.actorId??null,recordedAt:e?.recordedAt??null,source:e?.source??"legacy_record",externalRef:e?.externalRef??null};
  };
  const invoices = p.invoices.filter(i=>(!sid||i.studentId===sid)&&match(i.id,i.label,names.get(i.studentId),byId.get(i.id)?.externalRef)).map(i=>({...i,...metadata(i.id)}));
  const receipts = p.receipts.filter(r=>(!sid||r.studentId===sid)&&match(r.id,r.method,names.get(r.studentId),byId.get(r.id)?.externalRef)).map(r=>({...r,...metadata(r.id)}));
  const expenses = sid?[]:p.expenses.filter(e=>match(e.id,e.label,e.vendor,e.category,e.kind));
  const invIds = new Set(invoices.map(i=>i.id)), recIds = new Set(receipts.map(r=>r.id)), expIds = new Set(expenses.map(e=>e.id));
  const allocations = p.allocations.filter(a=>invIds.has(a.invoiceId)||recIds.has(a.receiptId));
  const allocationIds = new Set(allocations.map(a=>a.id));
  const ownerOfReceipt = (e: FinanceEvent) => byId.get(e.receiptId)?.studentId;
  const period = all.filter(e=>e.date>=from);
  const refunds = period.filter(e=>e.action==="refund.record"&&(!sid||ownerOfReceipt(e)===sid)&&
    (recIds.has(e.receiptId)||match(e.id,e.externalRef,e.reason,names.get(ownerOfReceipt(e)))));
  const refundIds = new Set(refunds.map(e=>e.id));
  const filteredEvents = period.filter(e=>{
    if (e.action==="refund.record") return refundIds.has(e.id);
    if (e.action.startsWith("expense.")) return expIds.has(e.expenseId??e.id);
    if (e.action.startsWith("invoice.")) return invIds.has(e.invoiceId??e.id);
    if (e.action==="receipt.record"||e.action==="opening.credit"||e.action==="receipt.void") return recIds.has(e.receiptId??e.id);
    if (e.action==="receipt.allocate"||e.action==="allocation.release") return allocationIds.has(e.allocationId??e.id);
    return (!sid||e.studentId===sid)&&match(e.id,e.action,e.label,e.reason,names.get(e.studentId));
  });
  const sum = (values: number[]) => {
    const n = values.reduce((a,b)=>a+b,0);
    if (!Number.isSafeInteger(n)) throw new OperationError(409,"FINANCE_CONFLICT","합계 범위를 초과했습니다.");
    return n;
  };
  const receivedKrw = sum(filteredEvents.filter(e=>e.action==="receipt.record").map(e=>e.amountKrw)) -
    sum(filteredEvents.filter(e=>e.action==="receipt.void").map(e=>byId.get(e.receiptId)?.amountKrw??0));
  const refundedKrw = sum(refunds.map(e=>e.amountKrw));
  const expensesPaidKrw = sum(filteredEvents.filter(e=>e.action==="expense.pay").map(e=>e.amountKrw));
  const totals = {billedKrw:sum(invoices.map(e=>e.amountKrw)),dueKrw:sum(invoices.map(e=>e.dueKrw)),
    unallocatedKrw:sum(receipts.map(e=>e.unallocatedKrw)),receivedKrw,refundedKrw,expensesPaidKrw,
    cashFlowKrw:sum([receivedKrw,-refundedKrw,-expensesPaidKrw])};
  return {invoices,receipts,allocations,expenses,events:filteredEvents,totals,
    tableTotals:{invoices:{amountKrw:totals.billedKrw,allocatedKrw:sum(invoices.map(i=>i.allocatedKrw)),dueKrw:totals.dueKrw},
      receipts:{amountKrw:sum(receipts.map(r=>r.amountKrw)),refundedKrw:sum(receipts.map(r=>r.refundedKrw)),unallocatedKrw:totals.unallocatedKrw},
      expenses:{amountKrw:sum(expenses.map(e=>e.amountKrw)),paidKrw:sum(expenses.map(e=>e.paidKrw)),dueKrw:sum(expenses.map(e=>e.dueKrw))},
      unpaid:{dueKrw:sum(invoices.filter(i=>!i.cancelled&&i.dueKrw>0).map(i=>i.dueKrw))},
      refunds:{amountKrw:refundedKrw}}};
}
