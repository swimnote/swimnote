import { OperationError, object, text, date } from "./office-operations-data.js";

/** KRW integers only. This ledger records centre operations, never PG approvals. */
export type FinanceEvent = { id: string; action: string; date: string; [key: string]: any };
export type FinanceField = { key: string; label: string; type?: string; ref?: string; options?: string[]; required?: boolean };
export type FinanceAction = { key: string; label: string; fields: FinanceField[] };
const f = (key: string, label: string, type = "text", ref?: string, required = true): FinanceField => ({ key, label, type, ref, required });
const amount = f("amountKrw", "금액(원)", "number");
const reason = f("reason", "사유·근거");
const student = f("studentId", "귀속 회원", "ref", "students");
const contract = f("contractId", "수강 계약", "ref", "contracts");
const invoice = f("invoiceId", "청구", "ref", "invoices");
const receipt = f("receiptId", "원 수납", "ref", "receipts");
export const financeActions: FinanceAction[] = [
  { key: "invoice.issue", label: "청구 발행", fields: [student, f("contractId", "계약(선택)", "ref", "contracts", false), f("label", "청구 내용"), amount, f("dueDate", "납부기한", "date")] },
  { key: "invoice.adjust", label: "청구 감액·증액 정정", fields: [invoice, f("deltaKrw", "청구 증감액(감액은 음수)", "number"), reason] },
  { key: "invoice.cancel", label: "청구 취소", fields: [invoice, reason] },
  { key: "receipt.record", label: "수동 수납 기록", fields: [student, amount, { ...f("method", "수납 방식", "select"), options: ["cash", "bank", "external_terminal"] }, f("externalRef", "납부 식별번호(현금 외 필수)", "text", undefined, false), f("note", "수기 확인 메모", "text", undefined, false)] },
  { key: "receipt.allocate", label: "수납을 청구에 배분", fields: [receipt, invoice, amount] },
  { key: "allocation.release", label: "배분 정정·해제", fields: [f("allocationId", "원 배분", "ref", "allocations"), amount, reason] },
  { key: "receipt.void", label: "수납 오입력 정정(환불 아님)", fields: [receipt, reason] },
  { key: "refund.record", label: "실제 환불 수기 기록", fields: [receipt, amount, f("allocationId", "환불로 해제할 배분(선택)", "ref", "allocations", false), f("releaseKrw", "배분 해제액(선택)", "number", undefined, false), f("externalRef", "환불 식별번호"), reason] },
  { key: "expense.schedule", label: "지출·강사정산 지급 예정", fields: [f("label", "지출 내용"), amount, f("dueDate", "지급 예정일", "date"), f("vendor", "거래처·수령인"), f("category", "지출 분류"), { ...f("kind", "구분", "select"), options: ["operating", "instructor_settlement"] }, f("evidenceUrl", "증빙 주소(선택)", "url", undefined, false)] },
  { key: "expense.pay", label: "지출 지급 기록", fields: [f("expenseId", "지출", "ref", "expenses"), amount, f("externalRef", "지급 식별번호"), reason] },
  { key: "expense.cancel", label: "미지급 지출 취소", fields: [f("expenseId", "지출", "ref", "expenses"), reason] },
  { key: "rights.adjust", label: "수강 잔여횟수 조정", fields: [contract, f("deltaCount", "횟수 증감(감소는 음수)", "number"), reason] },
  { key: "contract.hold", label: "계약 휴회 시작", fields: [contract, reason] },
  { key: "contract.resume", label: "계약 복귀", fields: [contract, reason] },
  { key: "contract.amend", label: "중도변경·만료일 정정", fields: [contract, f("endDate", "변경 만료일", "date"), reason] },
  { key: "contract.cancel", label: "수강 계약 종료(금전 환불 별도)", fields: [contract, reason] },
  { key: "period.close", label: "기간 마감", fields: [f("fromDate", "마감 시작일", "date"), f("toDate", "마감 종료일", "date"), reason] },
  { key: "period.reopen", label: "마감 해제(관리자)", fields: [f("closingId", "마감", "ref", "closings"), reason] },
];
function reject(message:string):never { throw new OperationError(409,"FINANCE_CONFLICT",message); }
export function money(v: unknown, signed = false): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || Math.abs(v) > 1_000_000_000_000 || (!signed && v <= 0) || (signed && v === 0))
    throw new OperationError(400, "INVALID_MONEY", "원 단위 정수 금액을 확인하세요(최대 1조 원).");
  return v;
}
export function normalizeFinance(input: unknown): FinanceEvent {
  const raw = object(input), spec = financeActions.find(x => x.key === raw.action);
  if (!spec) throw new OperationError(400, "UNKNOWN_ACTION", "지원하지 않는 수납 업무입니다.");
  const out: FinanceEvent = { id: "", action: spec.key, date: date(raw.date) };
  for (const field of spec.fields) {
    const v = raw[field.key];
    if ((v === undefined || v === null || v === "") && !field.required) continue;
    if (field.type === "number") {
      out[field.key] = v === 0 && raw.action === "invoice.issue" && field.key === "amountKrw" ? 0 :
        money(v, field.key === "deltaKrw" || field.key === "deltaCount");
      if (field.key === "deltaCount" && Math.abs(out[field.key]) > 100000) reject("조정 횟수가 너무 큽니다.");
    } else if (field.type === "date") out[field.key] = date(v);
    else {
      out[field.key] = text(v, field.label, field.key === "reason" || field.key === "note" ? 2000 : 500);
      if (field.options && !field.options.includes(out[field.key])) reject("방식을 확인하세요.");
      if (field.type === "url") {
        let u: URL; try { u = new URL(out[field.key]); } catch { return reject("증빙 웹 주소를 확인하세요."); }
        if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) reject("증빙 웹 주소를 확인하세요.");
      }
    }
  }
  if (out.action === "receipt.record" && out.method !== "cash" && !out.externalRef) reject("계좌·외부 단말기 수납은 중복 대조용 식별번호가 필요합니다.");
  return out;
}
export type Invoice = { id: string; studentId: string; contractId?: string; label: string; date: string; dueDate: string; amountKrw: number; allocatedKrw: number; dueKrw: number; cancelled: boolean };
export type Receipt = { id: string; studentId: string; date: string; amountKrw: number; refundedKrw: number; unallocatedKrw: number; method: string; voided: boolean };
export type Allocation = { id: string; receiptId: string; invoiceId: string; amountKrw: number; remainingKrw: number };
export type Expense = { id: string; label: string; date: string; dueDate: string; vendor: string; category: string; kind: string; amountKrw: number; paidKrw: number; dueKrw: number; cancelled: boolean; evidenceUrl?: string };
export function projectFinance(events: FinanceEvent[]) {
  const invoices: Invoice[] = [], receipts: Receipt[] = [], allocations: Allocation[] = [], expenses: Expense[] = [];
  const closings: Array<{ id: string; fromDate: string; toDate: string; active: boolean; reason: string }> = [];
  for (const e of events) {
    const inv = invoices.find(x => x.id === e.invoiceId), rec = receipts.find(x => x.id === e.receiptId);
    const exp = expenses.find(x => x.id === e.expenseId), alloc = allocations.find(x => x.id === e.allocationId);
    switch (e.action) {
      case "invoice.issue": invoices.push({ id: e.id, studentId: e.studentId, contractId: e.contractId, label: e.label, date: e.date, dueDate: e.dueDate, amountKrw: e.amountKrw, allocatedKrw: 0, dueKrw: e.amountKrw, cancelled: false }); break;
      case "invoice.adjust": if (inv) inv.amountKrw += e.deltaKrw; break;
      case "invoice.cancel": if (inv) { inv.amountKrw = 0; inv.cancelled = true; } break;
      case "receipt.record": case "opening.credit": receipts.push({ id: e.id, studentId: e.studentId, date: e.date, amountKrw: e.amountKrw, refundedKrw: 0, unallocatedKrw: e.amountKrw, method: e.method, voided: false }); break;
      case "receipt.allocate":
        if (rec && inv) { rec.unallocatedKrw -= e.amountKrw; inv.allocatedKrw += e.amountKrw; allocations.push({ id: e.id, receiptId: rec.id, invoiceId: inv.id, amountKrw: e.amountKrw, remainingKrw: e.amountKrw }); }
        break;
      case "allocation.release": case "refund.record": {
        const release = e.action === "allocation.release" ? e.amountKrw : (e.releaseKrw ?? 0);
        if (alloc && release) {
          alloc.remainingKrw -= release;
          const i = invoices.find(x => x.id === alloc.invoiceId), r = receipts.find(x => x.id === alloc.receiptId);
          if (i) i.allocatedKrw -= release; if (r) r.unallocatedKrw += release;
        }
        if (e.action === "refund.record" && rec) { rec.refundedKrw += e.amountKrw; rec.unallocatedKrw -= e.amountKrw; }
        break;
      }
      case "receipt.void": if (rec) { rec.voided = true; rec.unallocatedKrw = 0; } break;
      case "expense.schedule": expenses.push({ id: e.id, label: e.label, date: e.date, dueDate: e.dueDate, vendor: e.vendor, category: e.category, kind: e.kind, amountKrw: e.amountKrw, paidKrw: 0, dueKrw: e.amountKrw, cancelled: false, evidenceUrl: e.evidenceUrl }); break;
      case "expense.pay": if (exp) exp.paidKrw += e.amountKrw; break;
      case "expense.cancel": if (exp) { exp.cancelled = true; exp.amountKrw = 0; } break;
      case "period.close": closings.push({ id: e.id, fromDate: e.fromDate, toDate: e.toDate, active: true, reason: e.reason }); break;
      case "period.reopen": { const c = closings.find(x => x.id === e.closingId); if (c) c.active = false; break; }
    }
  }
  invoices.forEach(x => { x.dueKrw = x.amountKrw - x.allocatedKrw; });
  expenses.forEach(x => { x.dueKrw = x.amountKrw - x.paidKrw; });
  for (const n of [...invoices.flatMap(x => [x.amountKrw, x.allocatedKrw, x.dueKrw]), ...receipts.flatMap(x => [x.refundedKrw, x.unallocatedKrw]), ...allocations.map(x => x.remainingKrw), ...expenses.flatMap(x => [x.amountKrw, x.dueKrw])])
    if (!Number.isSafeInteger(n) || n < 0) reject("원장 대조 불일치입니다. 임의 재실행하지 마세요.");
  return { invoices, receipts, allocations, expenses, closings };
}
export function checkFinance(events: FinanceEvent[], command: FinanceEvent) {
  const p = projectFinance(events), e = command;
  if (e.action !== "period.reopen" && p.closings.some(c => c.active && e.date >= c.fromDate && e.date <= c.toDate)) reject("마감된 날짜입니다. 사유를 남기고 관리자 마감 해제를 먼저 하세요.");
  const inv = p.invoices.find(x => x.id === e.invoiceId), rec = p.receipts.find(x => x.id === e.receiptId);
  const exp = p.expenses.find(x => x.id === e.expenseId), alloc = p.allocations.find(x => x.id === e.allocationId);
  const prior = (id: unknown) => events.find(x => x.id === id);
  for (const id of [e.invoiceId, e.receiptId, e.expenseId, e.allocationId])
    if (id && (!prior(id) || prior(id)!.date > e.date)) reject("원거래가 없거나 원거래보다 이른 날짜입니다.");
  if (e.action.startsWith("invoice.") && e.action !== "invoice.issue") {
    if (!inv || inv.cancelled) reject("유효한 청구가 없습니다.");
    const next = e.action === "invoice.cancel" ? 0 : inv.amountKrw + e.deltaKrw;
    if (!Number.isSafeInteger(next) || next < inv.allocatedKrw || next < 0) reject("청구를 배분된 수납보다 줄일 수 없습니다. 배분을 해제한 뒤 감액하세요.");
  }
  if (e.action === "receipt.allocate") {
    if (!rec || rec.voided || !inv || inv.cancelled) reject("유효한 수납과 청구가 필요합니다.");
    if (e.amountKrw > rec.unallocatedKrw || e.amountKrw > inv.dueKrw) reject("미배분금 또는 미납액 초과입니다.");
  }
  if (e.action === "allocation.release" && (!alloc || e.amountKrw > alloc.remainingKrw)) reject("원 배분의 잔여액을 초과했습니다.");
  if (e.action === "receipt.void" && (!rec || rec.voided || rec.refundedKrw || rec.unallocatedKrw !== rec.amountKrw || prior(e.receiptId)?.action!=="receipt.record")) reject("배분·환불한 수납이나 이전 시작 미배분금은 수납 오입력 취소할 수 없습니다. 원거래별 정정이 필요합니다.");
  if (e.action === "refund.record") {
    if (!rec || rec.voided || e.amountKrw > rec.amountKrw - rec.refundedKrw) reject("원 수납의 환불 가능 원금을 초과했습니다.");
    const released = e.releaseKrw ?? 0;
    if (released && (!alloc || alloc.receiptId !== rec.id || released > alloc.remainingKrw || released > e.amountKrw)) reject("해제할 원 배분·금액을 확인하세요.");
    if (e.allocationId && !released) reject("배분을 선택했다면 해제액을 입력하세요.");
    if (e.amountKrw > rec.unallocatedKrw + released) reject("배분된 금액은 원 배분 해제를 함께 지정하세요.");
  }
  if (e.externalRef && events.some(x => x.action === e.action && x.externalRef === e.externalRef && (e.action !== "refund.record" || x.receiptId === e.receiptId))) reject("이미 기록된 거래 식별번호입니다.");
  if (e.action === "expense.pay" && (!exp || exp.cancelled || e.amountKrw > exp.dueKrw)) reject("미지급액을 초과했습니다.");
  if (e.action === "expense.cancel" && (!exp || exp.cancelled || exp.paidKrw)) reject("이미 지급한 지출은 취소할 수 없습니다.");
  if (e.action === "period.close") {
    if (e.fromDate > e.toDate || e.toDate > e.date) reject("마감 기간·기록일을 확인하세요.");
    if (p.closings.some(c => c.active && c.fromDate <= e.toDate && c.toDate >= e.fromDate)) reject("이미 마감한 기간과 겹칩니다.");
  }
  if (e.action === "period.reopen" && !p.closings.some(c => c.id === e.closingId && c.active)) reject("활성 마감이 없습니다.");
  return projectFinance([...events, e]);
}
export function financeTotals(events: FinanceEvent[], from = "0001-01-01", to = "9999-12-31") {
  const p = projectFinance(events.filter(e => e.date <= to));
  const period = events.filter(e => e.date >= from && e.date <= to);
  const sum = (a: number[]) => { const n = a.reduce((x, y) => x + y, 0); if (!Number.isSafeInteger(n)) reject("합계 범위를 초과했습니다."); return n; };
  const receivedKrw = sum(period.filter(e => e.action === "receipt.record").map(e => e.amountKrw)) -
    sum(period.filter(e => e.action === "receipt.void").map(e => events.find(x => x.id === e.receiptId)?.amountKrw ?? 0));
  const refundedKrw = sum(period.filter(e => e.action === "refund.record").map(e => e.amountKrw));
  const expensesPaidKrw = sum(period.filter(e => e.action === "expense.pay").map(e => e.amountKrw));
  const cashFlowKrw=receivedKrw-refundedKrw-expensesPaidKrw;
  if(!Number.isSafeInteger(cashFlowKrw)) reject("자금수지 합계 범위를 초과했습니다.");
  return { billedKrw: sum(p.invoices.map(x => x.amountKrw)), receivedKrw, refundedKrw, expensesPaidKrw,
    dueKrw: sum(p.invoices.map(x => x.dueKrw)), unallocatedKrw: sum(p.receipts.map(x => x.unallocatedKrw)),
    cashFlowKrw };
}
