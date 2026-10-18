import type { FinanceSnapshot, Totals } from "./office-finance-api";

export type DrillRow={id:string;date:string;studentId:string;label:string;amountKrw:number};
/** The same server-projected rows as the summary. Never re-project a family subset. */
export function financeDrill(d:FinanceSnapshot,key:keyof Totals){
  const rows:DrillRow[]=[];
  const add=(id:string,date:string,studentId:string,label:string,amountKrw:number)=>{
    if(amountKrw!==0)rows.push({id,date,studentId,label,amountKrw});
  };
  if(key==="billedKrw"||key==="dueKrw")
    d.invoices.forEach(i=>add(i.id,i.date,i.studentId,i.label,key==="billedKrw"?i.amountKrw:i.dueKrw));
  if(key==="unallocatedKrw")
    d.receipts.forEach(r=>add(r.id,r.date,r.studentId,r.method,r.unallocatedKrw));
  const receipts=new Map(d.receipts.map(r=>[r.id,r]));
  for(const e of d.events){
    const isCash=key==="cashFlowKrw";
    if((isCash||key==="receivedKrw")&&e.action==="receipt.record")
      add(e.id,e.date,e.studentId,"수납",e.amountKrw);
    if((isCash||key==="receivedKrw")&&e.action==="receipt.void"){
      const original=receipts.get(e.receiptId);
      add(e.id,e.date,original?.studentId??"","수납 오입력 취소",-(original?.amountKrw??NaN));
    }
    if((isCash||key==="refundedKrw")&&e.action==="refund.record")
      add(e.id,e.date,receipts.get(e.receiptId)?.studentId??"","환불 수기 기록",(isCash?-1:1)*e.amountKrw);
    if((isCash||key==="expensesPaidKrw")&&e.action==="expense.pay")
      add(e.id,e.date,"","지출 지급",(isCash?-1:1)*e.amountKrw);
  }
  const total=rows.reduce((n,r)=>n+r.amountKrw,0);
  return {rows,total,expected:d.totals[key],matches:d.reportVersion===1&&Number.isSafeInteger(total)&&total===d.totals[key]};
}
