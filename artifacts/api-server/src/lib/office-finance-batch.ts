import { OperationError } from "./office-operations-data.js";
import { normalizeFinance, checkFinance, financeTotals, type FinanceEvent } from "./office-finance.js";

/** A bounded atomic invoice batch, using exactly the same integer ledger rules as single entry. */
export function normalizeInvoiceBatch(value: unknown): FinanceEvent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new OperationError(400, "INVALID_BATCH", "청구 대상을 1~100명 선택하세요.");
  const seen = new Set<string>();
  return value.map(raw => {
    const e = normalizeFinance(raw);
    if (e.action !== "invoice.issue") throw new OperationError(400, "BATCH_INVOICES_ONLY", "대량 처리는 청구 발행만 지원합니다.");
    if (seen.has(e.studentId)) throw new OperationError(409, "DUPLICATE_MEMBER", "한 묶음에 같은 회원을 중복 청구할 수 없습니다.");
    seen.add(e.studentId);
    return e;
  });
}

export function previewInvoiceBatch(events: FinanceEvent[], commands: FinanceEvent[]) {
  let after = [...events];
  for (const [i, command] of commands.entries()) {
    const event = { ...command, id: `batch_preview_${i}`, sequence: events.length + i + 1 };
    checkFinance(after, event);
    after.push(event);
  }
  return { before: financeTotals(events), after: financeTotals(after) };
}
