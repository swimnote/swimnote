import { describe,it,expect } from "vitest";
import { normalizeInvoiceBatch,previewInvoiceBatch } from "../office-finance-batch.js";
import { financeView } from "../office-finance-view.js";
import { validateData } from "../office-operations-data.js";
import type { FinanceEvent } from "../office-finance.js";

const date="2026-10-18";
const bill=(studentId="a",amountKrw=100000)=>({action:"invoice.issue",date,studentId,amountKrw,label:"수강",dueDate:"2026-10-25"});
const invoice:FinanceEvent={...bill(),id:"i"};
const receipt:FinanceEvent={id:"r",action:"receipt.record",date,studentId:"b",amountKrw:120000,method:"bank",externalRef:"bank-reference",actorId:"staff",recordedAt:"2026-10-18T02:00:00Z",source:"manual_record_not_pg"};
const allocation:FinanceEvent={id:"alloc",action:"receipt.allocate",date,receiptId:"r",invoiceId:"i",amountKrw:40000};
const students=[{id:"a",name:"회원 A"},{id:"b",name:"회원 B"}];
describe("atomic bulk invoice preparation",()=>{
  it.each([[],Array.from({length:101},(_,i)=>bill(String(i))),[bill(),bill()]])("rejects empty/oversized/duplicate batches",raw=>{
    expect(()=>normalizeInvoiceBatch(raw)).toThrow();
  });
  it("does not expose arbitrary actions in bulk",()=>{
    expect(()=>normalizeInvoiceBatch([receipt])).toThrow();
  });
  it.each([1.5,-1,Infinity,"1000"])("rejects invalid amount %s",amountKrw=>{
    expect(()=>normalizeInvoiceBatch([{...bill(),amountKrw}])).toThrow();
  });
  it("supports free invoices consistently with individual entry",()=>{
    expect(normalizeInvoiceBatch([bill("a",0)])[0].amountKrw).toBe(0);
  });
  it("projects 100 distinct members without modifying the source",()=>{
    const source:FinanceEvent[]=[];
    const impact=previewInvoiceBatch(source,normalizeInvoiceBatch(Array.from({length:100},(_,i)=>bill(String(i)))));
    expect(impact.before.dueKrw).toBe(0);expect(impact.after.dueKrw).toBe(10000000);expect(source).toEqual([]);
  });
  it("a closed date rejects the entire preview, not a partial prefix",()=>{
    const source:FinanceEvent[]=[{id:"closing",action:"period.close",date,fromDate:date,toDate:date,reason:"마감"}];
    expect(()=>previewInvoiceBatch(source,normalizeInvoiceBatch([bill("a"),bill("b")]))).toThrow(/마감/);
    expect(source).toHaveLength(1);
  });
});
describe("server reporting from the full ledger",()=>{
  const source=[invoice,receipt,allocation];
  it("preserves invoice attribution after cross-family allocation",()=>{
    const a=financeView(source,students,date,date,"a");
    expect(a.invoices[0].dueKrw).toBe(60000);expect(a.totals.dueKrw).toBe(60000);
    expect(a.totals.receivedKrw).toBe(0);expect(a.receipts).toEqual([]);
  });
  it("preserves the payer's unallocated amount without importing another member's invoices",()=>{
    const b=financeView(source,students,date,date,"b");
    expect(b.totals.unallocatedKrw).toBe(80000);expect(b.totals.receivedKrw).toBe(120000);expect(b.invoices).toEqual([]);
  });
  it("member balances reconcile to centre balances without double counting",()=>{
    const a=financeView(source,students,date,date,"a").totals,b=financeView(source,students,date,date,"b").totals;
    const all=financeView(source,students,date,date).totals;
    for(const key of ["billedKrw","dueKrw","receivedKrw","unallocatedKrw"] as const)expect(a[key]+b[key]).toBe(all[key]);
  });
  it("uses the same selected rows for search totals and exports",()=>{
    const v=financeView(source,students,date,date,"","bank-reference");
    expect(v.invoices).toEqual([]);expect(v.receipts).toHaveLength(1);
    expect(v.tableTotals.receipts.amountKrw).toBe(v.receipts[0].amountKrw);
    expect(v.totals.receivedKrw).toBe(120000);
    expect(v.receipts[0]).toMatchObject({actorId:"staff",recordedAt:receipt.recordedAt,source:"manual_record_not_pg"});
  });
  it("keeps cumulative balances separate from period cash flow",()=>{
    const v=financeView(source,students,"2026-10-19","2026-10-31");
    expect(v.totals.receivedKrw).toBe(0);expect(v.totals.dueKrw).toBe(60000);expect(v.receipts[0].amountKrw).toBe(120000);
  });
  it("excludes centre expenses from a member-only view",()=>{
    const events=[...source,{id:"e",action:"expense.schedule",date,amountKrw:10000,vendor:"업체",label:"시설",category:"시설",kind:"operating",dueDate:date},
      {id:"ep",action:"expense.pay",date,expenseId:"e",amountKrw:10000,externalRef:"pay",reason:"지급"}];
    expect(financeView(events,students,date,date).totals.expensesPaidKrw).toBe(10000);
    expect(financeView(events,students,date,date,"a").totals.expensesPaidKrw).toBe(0);
    expect(financeView(events,students,date,date,"a").expenses).toEqual([]);
  });
  it("attributes refunds to the receipt owner, not the relative's invoice",()=>{
    const events=[...source,{id:"refund",action:"refund.record",date,receiptId:"r",allocationId:"alloc",releaseKrw:20000,amountKrw:20000,externalRef:"refund-ref",reason:"실제 반환 기록"}];
    expect(financeView(events,students,date,date,"a").totals.dueKrw).toBe(80000);
    expect(financeView(events,students,date,date,"a").totals.refundedKrw).toBe(0);
    expect(financeView(events,students,date,date,"b").totals.refundedKrw).toBe(20000);
  });
});
describe("merchant progress is manual metadata, not approval",()=>{
  it.each(["application_submitted","contract_signed","review_approved","payment_active"])("requires dated reference evidence for %s",merchantStage=>{
    const raw={name:"신청",kind:"merchant_application",status:"in_progress",merchantStage};
    expect(()=>validateData("support",raw)).toThrow();
    expect(validateData("support",{...raw,merchantReference:"공식 접수번호 수기",merchantConfirmedAt:"2026-10-17",approved:true,pgEnabled:true}))
      .not.toHaveProperty("pgEnabled");
  });
  it("cannot create future confirmed progress",()=>{
    expect(()=>validateData("support",{name:"신청",kind:"merchant_application",status:"in_progress",merchantStage:"contract_signed",
      merchantReference:"수기",merchantConfirmedAt:"2999-01-01"})).toThrow();
  });
});
