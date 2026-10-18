import {it,expect} from "vitest";
import {financeDrill} from "./office-finance-drill";
import type {FinanceSnapshot,Totals} from "./office-finance-api";
function snapshot(){
  return {
    reportVersion:1,
    invoices:[{id:"invoice-A",studentId:"A",date:"2026-10-01",label:"A 청구",amountKrw:100000,dueKrw:60000}],
    receipts:[{id:"receipt-B",studentId:"B",date:"2026-10-02",method:"transfer",amountKrw:70000,unallocatedKrw:20000}],
    events:[
      {id:"receipt-B",action:"receipt.record",date:"2026-10-02",studentId:"B",amountKrw:70000},
      {id:"refund",action:"refund.record",date:"2026-10-03",receiptId:"receipt-B",amountKrw:10000},
      {id:"pay",action:"expense.pay",date:"2026-10-04",expenseId:"expense",amountKrw:5000},
    ],
    totals:{billedKrw:100000,dueKrw:60000,unallocatedKrw:20000,receivedKrw:70000,refundedKrw:10000,expensesPaidKrw:5000,cashFlowKrw:55000},
  } as FinanceSnapshot;
}
it.each(["billedKrw","dueKrw","unallocatedKrw","receivedKrw","refundedKrw","expensesPaidKrw","cashFlowKrw"] as (keyof Totals)[])("drills into the same projected rows and signed amounts: %s",key=>{
  const d=snapshot(),r=financeDrill(d,key);expect(r.matches).toBe(true);expect(r.total).toBe(d.totals[key]);
});
it("preserves different family member ownership on invoice, receipt and refund",()=>{
  const d=snapshot();
  expect(financeDrill(d,"dueKrw").rows[0].studentId).toBe("A");
  expect(financeDrill(d,"unallocatedKrw").rows[0].studentId).toBe("B");
  expect(financeDrill(d,"refundedKrw").rows[0].studentId).toBe("B");
});
it("subtracts the original amount for a void and refuses missing or inconsistent source evidence",()=>{
  const d=snapshot();d.events.push({id:"void",action:"receipt.void",date:"2026-10-05",receiptId:"receipt-B"});d.totals.receivedKrw=0;
  expect(financeDrill(d,"receivedKrw").matches).toBe(true);
  d.receipts=[];expect(financeDrill(d,"receivedKrw").matches).toBe(false);
  expect(financeDrill(snapshot(),"cashFlowKrw").rows.map(r=>r.amountKrw)).toEqual([70000,-10000,-5000]);
});
