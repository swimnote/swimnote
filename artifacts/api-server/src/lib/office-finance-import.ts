import { date, digest, object, OperationError } from "./office-operations-data.js";
import { money, type FinanceEvent } from "./office-finance.js";

export const financialTargets = ["student_id","kind","amount_krw","remaining_count","contract_id","makeup_class_id","makeup_date","transaction_date"] as const;
export function financeRules(value:unknown,headers:string[]) {
  const raw=object(value),out:Record<string,string>={};
  for(const [k,v] of Object.entries(raw)) {
    if(!(financialTargets as readonly string[]).includes(k)||typeof v!=="string"||!headers.includes(v))
      throw new OperationError(400,"INVALID_FINANCIAL_RULE","지원하는 원본 열 매핑만 사용할 수 있습니다.");
    out[k]=v;
  }
  return out;
}
export function financialRows(job:any,rules:Record<string,string>,studentIds:Set<string>,contracts:Array<{id:string;studentId:string;remainingCount:number|null}>,ledger:FinanceEvent[]) {
  const referenceDate=date(job.referenceDate),seen=new Set<string>();
  const done=new Set((job.financeResults??[]).filter((r:any)=>r.status==="applied").map((r:any)=>r.sourceKey));
  const previouslyApplied=new Set(ledger.map(e=>e.importSourceKey).filter(Boolean));
  const rows:any[]=[],rightsTargets=new Map<string,any>();
  const numeric=(v:unknown)=> {
    const s=String(v??"").replace(/,/g,"").trim();
    if(!/^\d+$/.test(s)) throw new Error("금액·횟수는 음수가 아닌 정수여야 합니다.");
    const n=Number(s);if(!Number.isSafeInteger(n)||n>1_000_000_000_000) throw new Error("금액·횟수 범위를 확인하세요.");return n;
  };
  const operated=new Set<string>();
  for(const e of ledger.filter(x=>x.source==="manual_record_not_pg")) {
    if(e.studentId) operated.add(e.studentId);
    if(e.contractId) {const c=contracts.find(c=>c.id===e.contractId);if(c) operated.add(c.studentId);}
    for(const ref of [e.receiptId,e.invoiceId]) {const s=ledger.find(x=>x.id===ref)?.studentId;if(s) operated.add(s);}
  }
  for(const file of job.files) for(const [i,raw] of file.rows.entries()) {
    const source={file:file.name,sheet:file.sheet,row:i+2},v:any={};
    for(const [k,col] of Object.entries(rules)) v[k]=String(raw[col]??"").trim();
    const sourceKey=digest({sheet:file.sheet,raw,kind:v.kind}); // Filename-independent duplicate protection.
    const memberKey=digest({source,raw});
    const linked=(job.results??[]).find((r:any)=>r.sourceKey===memberKey&&r.status==="applied");
    const studentId=v.student_id||linked?.studentId;
    const row:any={sourceKey,source,studentId,kind:v.kind,errors:[],status:"ready"};
    try {
      if(done.has(sourceKey)) {row.status="applied";rows.push(row);continue;}
      if(seen.has(sourceKey)||previouslyApplied.has(sourceKey)) throw new Error("이미 이전했거나 동일 원본 행입니다.");
      seen.add(sourceKey);
      if(!studentId||!studentIds.has(studentId)) throw new Error("정확한 센터 회원 ID 또는 같은 행의 회원 이전 결과가 필요합니다.");
      if(!["opening_due","opening_credit","past_receipt","remaining_rights","makeup"].includes(v.kind)) throw new Error("이전 구분을 확인하세요.");
      if(["opening_due","opening_credit","remaining_rights"].includes(v.kind)&&operated.has(studentId)) throw new Error("운영 거래가 시작된 회원의 시작 잔액을 덮어쓰거나 추가할 수 없습니다.");
      if(["opening_due","opening_credit","past_receipt"].includes(v.kind)) {
        row.amountKrw=money(numeric(v.amount_krw));
        if(v.kind==="past_receipt") {
          row.transactionDate=date(v.transaction_date);
          if(row.transactionDate>referenceDate) throw new Error("과거 납부일은 기준일 이후일 수 없습니다.");
        }
      }
      if(v.kind==="remaining_rights") {
        const target=contracts.find(c=>c.id===v.contract_id&&c.studentId===studentId);
        if(!target||target.remainingCount===null) throw new Error("동일 회원의 횟수형 계약 ID가 필요합니다.");
        const prior=rightsTargets.get(target.id);
        if(prior){prior.status="held";prior.errors.push("같은 계약의 잔여횟수 원본이 중복됩니다.");throw new Error("같은 계약의 잔여횟수 원본이 중복됩니다.");}
        rightsTargets.set(target.id,row);
        if(ledger.some(e=>e.source==="legacy_import"&&e.action==="rights.adjust"&&e.contractId===target.id)) throw new Error("이미 시작 잔여횟수를 이전한 계약입니다. 별도 권리 정정이 필요합니다.");
        row.contractId=target.id;row.remainingCount=numeric(v.remaining_count);
        if(row.remainingCount>100000) throw new Error("잔여 횟수를 확인하세요.");
        row.deltaCount=row.remainingCount-target.remainingCount;
      }
      if(v.kind==="makeup") {row.classId=v.makeup_class_id;row.absenceDate=date(v.makeup_date);if(row.absenceDate>referenceDate) throw new Error("원 결석일은 기준일 이후일 수 없습니다.");}
    }catch(e:any){row.status="held";row.errors.push(e.message??"원본 확인 필요");}
    rows.push(row);
  }
  const ready=rows.filter(r=>r.status==="ready");
  const amountKrw=ready.reduce((n,r)=>n+(r.amountKrw??0),0),remainingCount=ready.reduce((n,r)=>n+(r.remainingCount??0),0);
  if(!Number.isSafeInteger(amountKrw)||!Number.isSafeInteger(remainingCount)) throw new OperationError(400,"IMPORT_TOTAL_OVERFLOW","이전 합계 범위를 초과했습니다.");
  return {rows,totals:{amountKrw,remainingCount},referenceDate};
}
export function importEvent(row:any,jobId:string,referenceDate:string,sequence:number):FinanceEvent {
  const base={id:`fin_import_${row.sourceKey}`,date:referenceDate,sequence,source:"legacy_import",importJobId:jobId,
    importSourceKey:row.sourceKey,originalSource:row.source,studentId:row.studentId,referenceDate};
  if(row.kind==="opening_due") return {...base,action:"invoice.issue",label:"이전 시작 미납액(과거 청구 원문 참조)",dueDate:referenceDate,amountKrw:row.amountKrw};
  if(row.kind==="opening_credit") return {...base,action:"opening.credit",method:"opening_balance",amountKrw:row.amountKrw};
  if(row.kind==="past_receipt") return {...base,action:"past.receipt",date:row.transactionDate,amountKrw:row.amountKrw};
  if(row.kind==="remaining_rights") return {...base,action:"rights.adjust",contractId:row.contractId,deltaCount:row.deltaCount,reason:"이전 기준일 잔여 횟수 대조"};
  return {...base,action:"import.makeup",makeupId:`makeup_import_${row.sourceKey}`};
}
