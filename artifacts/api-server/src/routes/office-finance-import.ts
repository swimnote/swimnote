import { POST_REFERENCE_ATTENDANCE_SQL } from "../lib/office-finance-sql.js";
import { Router,type Response } from "express";
import type { Pool } from "pg";
import type { OfficeActor } from "../lib/office-command.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { OperationError,object,requestId,digest,date } from "../lib/office-operations-data.js";
import { requireFinanceSchema,readLedger,courseContext,appendLedger } from "./office-finance.js";
import { financeRules,financialRows,importEvent } from "../lib/office-finance-import.js";
import { checkFinance } from "../lib/office-finance.js";
type Handler=(req:AuthRequest,res:Response,owner:OfficeActor)=>Promise<void>;
type Wrap=(fn:Handler)=>(req:AuthRequest,res:Response)=>Promise<void>;
export function createOfficeFinanceImportRouter(pool:Pool,run:Wrap) {
  const router=Router();
  const process=(apply:boolean)=>run(async(req,res,owner)=>{
    const b=object(req.body),rid=apply?requestId(b.requestId):null;
    const hash=digest({id:req.params.id,revision:b.expectedRevision,rules:b.rules,ledgerVersion:b.ledgerVersion,action:"finance-import"});
    const c=await pool.connect();
    try{
      await c.query("BEGIN");
      await c.query("SELECT id FROM swimming_pools WHERE id=$1 FOR UPDATE",[owner.poolId]);await requireFinanceSchema(c);
      if(rid){
        const old=(await c.query("SELECT * FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2",[owner.poolId,rid])).rows[0];
        if(old){
          if(old.actor_id!==owner.userId||old.input_hash!==hash) throw new OperationError(409,"REQUEST_REUSED","다른 이전에 사용된 요청 ID입니다.");
          await c.query("COMMIT");res.json(old.result);return;
        }
      }
      const job=(await c.query("SELECT * FROM office_operation_records WHERE pool_id=$1 AND resource='imports' AND id=$2 FOR UPDATE",[owner.poolId,req.params.id])).rows[0];
      if(!job||job.revision!==b.expectedRevision) throw new OperationError(409,"REVISION_CONFLICT","이전 원본과 버전을 다시 확인하세요.");
      const headers=[...new Set<string>(job.data.files.flatMap((f:any)=>f.rows.flatMap((r:any)=>Object.keys(r))))];
      const rules=financeRules(b.rules,headers),ledger=await readLedger(c,owner.poolId);
      const referenceDate=date(job.data.referenceDate);
      const context=await courseContext(c,owner.poolId,ledger,referenceDate);
      const preview=financialRows(job.data,rules,new Set(context.students.map(s=>s.id)),context.rights,ledger);
      const operated=new Set((await c.query(POST_REFERENCE_ATTENDANCE_SQL,[owner.poolId,referenceDate])).rows.map(x=>x.student_id));
      for(const row of preview.rows) if(row.status==="ready"&&["opening_due","opening_credit","remaining_rights"].includes(row.kind)&&operated.has(row.studentId)){
        row.status="held";row.errors.push("기준일 이후 실제 출결이 있는 회원입니다. 시작 잔액·권리를 별도 대조하세요.");
      }
      for(const row of preview.rows.filter(r=>r.status==="ready")) {
        if(row.kind==="makeup"){
          const cls=(await c.query("SELECT id FROM class_groups WHERE id=$1 AND swimming_pool_id=$2 AND is_deleted=false",[row.classId,owner.poolId])).rows[0];
          const old=(await c.query(`SELECT id FROM makeup_sessions WHERE swimming_pool_id=$1 AND student_id=$2
            AND original_class_group_id=$3 AND absence_date=$4 AND cancelled_at IS NULL`,[owner.poolId,row.studentId,row.classId,row.absenceDate])).rows[0];
          if(!cls||old){row.status="held";row.errors.push(old?"이미 존재하는 보강 자료 — 덮어쓰기 금지":"센터의 원 결석 반 ID 필요");}
        }
      }
      // Recompute totals after reference checks, not from held amounts.
      const ready=preview.rows.filter(r=>r.status==="ready");
      preview.totals={amountKrw:ready.reduce((n,r)=>n+(r.amountKrw??0),0),remainingCount:ready.reduce((n,r)=>n+(r.remainingCount??0),0)};
      const proof=digest({jobId:job.id,revision:job.revision,rules,ledgerVersion:ledger.length,preview});
      if(!apply){
        await c.query("ROLLBACK");res.json({...preview,previewHash:proof,ledgerVersion:ledger.length});return;
      }
      if(b.confirmed!==true||b.ledgerVersion!==ledger.length||b.previewHash!==proof) throw new OperationError(409,"PREVIEW_REQUIRED","현재 금액·횟수·원본 미리보기 확인이 필요합니다.");
      const results=[...(job.data.financeResults??[])],actual:any[]=[];
      for(const row of ready.slice(0,1000)){
        const event=importEvent(row,job.id,preview.referenceDate,ledger.length+1);
        checkFinance(ledger,event);
        if(row.kind==="makeup") {
          const name=context.students.find(s=>s.id===row.studentId)?.name;
          await c.query(`INSERT INTO makeup_sessions(id,swimming_pool_id,student_id,student_name,original_class_group_id,absence_date,status,note)
            VALUES($1,$2,$3,$4,$5,$6,'waiting',$7)`,[event.makeupId,owner.poolId,row.studentId,name,row.classId,row.absenceDate,`이전 기준일 ${preview.referenceDate} · 원본 ${row.source.file}/${row.source.sheet}#${row.source.row}`]);
        }
        await appendLedger(c,owner.poolId,owner.userId,{...event,actorId:owner.userId});
        ledger.push(event);actual.push(row);
        results.push({...row,status:"applied",eventId:event.id});
      }
      const held=preview.rows.filter(r=>r.status==="held");
      const data={...job.data,financeRules:rules,financeResults:results,financialReferenceDate:preview.referenceDate};
      const saved=(await c.query("UPDATE office_operation_records SET data=$1::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 RETURNING revision",[JSON.stringify(data),job.id])).rows[0];
      await c.query("INSERT INTO office_operation_versions(record_id,revision,pool_id,actor_id,data) VALUES($1,$2,$3,$4,$5::jsonb)",[job.id,saved.revision,owner.poolId,owner.userId,JSON.stringify(data)]);
      const result={applied:actual.length,held:held.length,remaining:ready.length-actual.length,results:[...results,...held],revision:saved.revision,
        totals:{amountKrw:actual.reduce((n,r)=>n+(r.amountKrw??0),0),remainingCount:actual.reduce((n,r)=>n+(r.remainingCount??0),0)}};
      await c.query("INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",[owner.poolId,rid,owner.userId,hash,JSON.stringify(result)]);
      await c.query("COMMIT");res.json(result);
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  });
  router.post("/:id/finance-preview",process(false));
  router.post("/:id/finance-apply",process(true));
  return router;
}
