import { describe,it,expect } from "vitest";
import { normalizeFinance,checkFinance,projectFinance,financeTotals, type FinanceEvent } from "../office-finance.js";
import { financialRows,financeRules,importEvent } from "../office-finance-import.js";
import { validateData } from "../office-operations-data.js";

const day="2026-10-18";
const issue:FinanceEvent={id:"i",action:"invoice.issue",studentId:"s",label:"수강",date:day,dueDate:day,amountKrw:100000};
const cash:FinanceEvent={id:"r",action:"receipt.record",studentId:"s",date:day,amountKrw:120000,method:"cash"};
const allocation:FinanceEvent={id:"a",action:"receipt.allocate",receiptId:"r",invoiceId:"i",date:day,amountKrw:100000};
describe("OFFICE finance amounts, attribution and immutability",()=>{
  it.each([NaN,Infinity,1.5,-10,"1000",1_000_000_000_001])("rejects non-KRW integer receipt %s",amountKrw=>{
    expect(()=>normalizeFinance({action:"receipt.record",date:day,studentId:"s",method:"cash",amountKrw})).toThrow();
  });
  it("accepts zero-priced invoices without zero cash receipts",()=>{
    expect(normalizeFinance({...issue,amountKrw:0}).amountKrw).toBe(0);
    expect(()=>normalizeFinance({...cash,amountKrw:0})).toThrow();
  });
  it("requires external payment identifiers without claiming approval",()=>{
    expect(()=>normalizeFinance({...cash,method:"external_terminal"})).toThrow();
    expect(normalizeFinance({...cash,method:"external_terminal",externalRef:"external-manual-ref"}).method).toBe("external_terminal");
  });
  it("keeps partial/unallocated amounts and exact invoice ownership",()=>{
    const p=checkFinance([issue,cash],{...allocation,amountKrw:40000});
    expect(p.invoices[0].dueKrw).toBe(60000);expect(p.receipts[0].unallocatedKrw).toBe(80000);
  });
  it("prevents double allocation and overpayments to a paid invoice",()=>{
    expect(()=>checkFinance([issue,cash,allocation],{...allocation,id:"a2",amountKrw:1})).toThrow();
    expect(()=>checkFinance([issue,cash],{...allocation,amountKrw:120001})).toThrow();
  });
  it("never lowers issued claims below allocated cash",()=>{
    expect(()=>checkFinance([issue,cash,allocation],{id:"d",action:"invoice.adjust",date:day,invoiceId:"i",deltaKrw:-1})).toThrow();
    expect(()=>checkFinance([issue,cash,allocation],{id:"x",action:"invoice.cancel",date:day,invoiceId:"i"})).toThrow();
  });
  it("supports allocation correction without pretending it is a refund",()=>{
    const events=[issue,cash,allocation,{id:"u",action:"allocation.release",date:day,allocationId:"a",amountKrw:50000}];
    const p=projectFinance(events);expect(p.invoices[0].dueKrw).toBe(50000);expect(p.receipts[0].unallocatedKrw).toBe(70000);
    expect(financeTotals(events).refundedKrw).toBe(0);
  });
  it("supports partial refund linked to original allocation",()=>{
    const refund={id:"f",action:"refund.record",date:day,receiptId:"r",allocationId:"a",releaseKrw:30000,amountKrw:50000,externalRef:"f1"};
    const p=checkFinance([issue,cash,allocation],refund);
    expect(p.receipts[0].refundedKrw).toBe(50000);expect(p.receipts[0].unallocatedKrw).toBe(0);expect(p.invoices[0].dueKrw).toBe(30000);
    expect(()=>checkFinance([issue,cash,allocation,refund],{...refund,id:"f2",amountKrw:70001})).toThrow();
    expect(()=>checkFinance([issue,cash,allocation,refund],{...refund,id:"f3",amountKrw:1})).toThrow();
  });
  it("rejects refund without freeing allocated money",()=>{
    expect(()=>checkFinance([issue,cash,allocation],{id:"f",action:"refund.record",date:day,receiptId:"r",amountKrw:30000})).toThrow();
  });
  it("does not void an already refunded or allocated receipt",()=>{
    expect(()=>checkFinance([issue,cash,allocation],{id:"v",action:"receipt.void",date:day,receiptId:"r"})).toThrow();
  });
  it("treats external references as duplicate-sensitive",()=>{
    expect(()=>checkFinance([{...cash,externalRef:"same"}],{...cash,id:"r2",externalRef:"same"})).toThrow();
  });
  it("locks closed periods and requires a specific reopen",()=>{
    const close={id:"c",action:"period.close",date:day,fromDate:day,toDate:day,reason:"마감"};
    expect(()=>checkFinance([issue,close],cash)).toThrow();
    expect(checkFinance([issue,close],{id:"o",action:"period.reopen",date:day,closingId:"c"}).closings[0].active).toBe(false);
    expect(()=>checkFinance([close],{...close,id:"c2",fromDate:"2026-10-17",date:"2026-10-19"})).toThrow();
  });
  it("separates expenses from claims and blocks excess payouts",()=>{
    const exp={id:"e",action:"expense.schedule",date:day,label:"강사 정산",kind:"instructor_settlement",amountKrw:300000,dueDate:day};
    const pay={id:"p",action:"expense.pay",date:day,expenseId:"e",amountKrw:100000};
    const p=checkFinance([exp],pay);expect(p.expenses[0].dueKrw).toBe(200000);
    expect(financeTotals([exp,pay]).billedKrw).toBe(0);expect(financeTotals([exp,pay]).cashFlowKrw).toBe(-100000);
    expect(()=>checkFinance([exp,pay],{...pay,id:"p2",amountKrw:200001})).toThrow();
    expect(()=>checkFinance([exp,pay],{id:"x",action:"expense.cancel",date:day,expenseId:"e"})).toThrow();
  });
  it("does not duplicate opening credit or historical payments in current cash flow",()=>{
    const opening={...cash,action:"opening.credit",method:"opening_balance"};
    const history={...cash,id:"history",action:"past.receipt",date:"2026-09-01"};
    expect(projectFinance([opening,history]).receipts).toHaveLength(1);
    expect(financeTotals([opening,history]).receivedKrw).toBe(0);
  });
  it("preserves past balances when later corrections occur",()=>{
    const next={id:"n",action:"invoice.adjust",date:"2026-10-19",invoiceId:"i",deltaKrw:-5000};
    expect(financeTotals([issue,next],"2026-10-01",day).billedKrw).toBe(100000);
    expect(financeTotals([issue,next]).billedKrw).toBe(95000);
  });
  it("handles many partial allocations without losing a won",()=>{
    const events:FinanceEvent[]=[issue,cash];
    for(let n=0;n<100;n++){const e={...allocation,id:`a${n}`,amountKrw:1000};checkFinance(events,e);events.push(e);}
    expect(projectFinance(events).invoices[0].dueKrw).toBe(0);
    expect(projectFinance(events).receipts[0].unallocatedKrw).toBe(20000);
  });
});
describe("OFFICE financial legacy boundaries",()=>{
  const rules={student_id:"학생",kind:"구분",amount_krw:"금액",contract_id:"계약",remaining_count:"횟수",transaction_date:"납부일"};
  const job=(raw:any)=>({referenceDate:day,files:[{name:"원본.xlsx",sheet:"정산",rows:[raw]}]});
  const rows=(raw:any,ledger:FinanceEvent[]=[])=>financialRows(job(raw),rules,new Set(["s"]),[{id:"c",studentId:"s",remainingCount:4}],ledger);
  it("holds cross-pool or unknown IDs instead of matching approximately",()=>{
    expect(rows({"학생":"other","구분":"opening_due","금액":"1000"}).rows[0].status).toBe("held");
  });
  it("requires reference dates and literal column mappings",()=>{
    expect(()=>financialRows({...job({}),referenceDate:""},rules,new Set(),[],[])).toThrow();
    expect(()=>financeRules({amount_krw:"missing"},["금액"])).toThrow();
  });
  it("distinguishes opening arrears, credits and historical dates",()=>{
    const p=rows({"학생":"s","구분":"past_receipt","금액":"1,000","납부일":"2026-09-01"});
    expect(p.rows[0].amountKrw).toBe(1000);
    expect(importEvent(p.rows[0],"job",day,1).date).toBe("2026-09-01");
    expect(rows({"학생":"s","구분":"past_receipt","금액":"1000"}).rows[0].status).toBe("held");
  });
  it("blocks opening balances after operating transactions begin",()=>{
    expect(rows({"학생":"s","구분":"opening_due","금액":"1000"},[{...issue,source:"manual_record_not_pg"}]).rows[0].status).toBe("held");
  });
  it("holds renamed identical source rows already applied",()=>{
    const r=rows({"학생":"s","구분":"opening_due","금액":"1000"}).rows[0];
    const p=rows({"학생":"s","구분":"opening_due","금액":"1000"},[{id:"old",action:"invoice.issue",date:day,importSourceKey:r.sourceKey}]);
    expect(p.rows[0].status).toBe("held");
  });
  it("keeps remaining quantities independent of current product edits",()=>{
    const r=rows({"학생":"s","구분":"remaining_rights","계약":"c","횟수":"9"}).rows[0];
    expect(r.deltaCount).toBe(5);expect(r.remainingCount).toBe(9);
  });
  it("holds all duplicated contract residual rows and forbids opening-credit void",()=>{
    const p=financialRows({referenceDate:day,files:[{name:"a",sheet:"s",rows:[
      {"학생":"s","구분":"remaining_rights","계약":"c","횟수":"9"},
      {"학생":"s","구분":"remaining_rights","계약":"c","횟수":"8"}]}]},rules,new Set(["s"]),[{id:"c",studentId:"s",remainingCount:4}],[]);
    expect(p.rows.every(r=>r.status==="held")).toBe(true);
    expect(()=>checkFinance([{...cash,action:"opening.credit"}],{id:"v",action:"receipt.void",receiptId:"r",date:day})).toThrow();
  });
  it("validates centre product discounts and weekly dimensions",()=>{
    expect(()=>validateData("products",{name:"주당",priceKrw:10000,lessonCount:0,validDays:30,productType:"weekly"})).toThrow();
    expect(()=>validateData("products",{name:"상품",priceKrw:10000,lessonCount:4,validDays:30,discountKrw:10001})).toThrow();
    expect(validateData("products",{name:"기간",priceKrw:0,lessonCount:0,validDays:30,productType:"period"}).productType).toBe("period");
  });
});
