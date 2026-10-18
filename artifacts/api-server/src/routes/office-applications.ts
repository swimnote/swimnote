import { Router, type Response } from "express";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { AuthRequest } from "../middlewares/auth.js";
import type { OfficeActor } from "../lib/office-command.js";
import { OperationError, object, text, requestId, digest, phone } from "../lib/office-operations-data.js";
import { requireFinanceSchema } from "./office-finance.js";
import { tabletForm } from "../lib/office-tablet-form.js";
import rateLimit from "express-rate-limit";
type Handler=(req:AuthRequest,res:Response,owner:OfficeActor)=>Promise<void>;
type Wrap=(fn:Handler)=>(req:AuthRequest,res:Response)=>Promise<void>;
function invitationToken(id:string,expiresAt:string) {
  const key=process.env.JWT_SECRET;
  if(!key) throw new OperationError(503,"TOKEN_UNAVAILABLE","신청 연결을 준비할 수 없습니다.");
  return createHmac("sha256",key).update(`office-tablet-v1:${id}:${expiresAt}`).digest("hex");
}
export function signaturePoints(value:unknown):number[][] {
  if(!Array.isArray(value)||value.length<8||value.length>2500) throw new OperationError(400,"SIGNATURE_REQUIRED","직접 서명을 확인하세요.");
  return value.map(p=>{
    if(!Array.isArray(p)||p.length!==3||!p.every(n=>typeof n==="number"&&Number.isFinite(n))||p[0]<0||p[0]>1||p[1]<0||p[1]>1||![0,1].includes(p[2]))
      throw new OperationError(400,"INVALID_SIGNATURE","서명 형식을 확인하세요.");
    return p;
  });
}
export function createOfficeApplicationsRouter(pool:Pool,run:Wrap) {
  const router=Router();
  router.get("/",run(async(req,res,owner)=>{
    await requireFinanceSchema(pool);
    const offset=Math.max(0,Number(req.query.offset)||0),limit=Math.min(200,Math.max(1,Number(req.query.limit)||100));
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(limit)) throw new OperationError(400,"INVALID_PAGE","페이지를 확인하세요.");
    const search=String(req.query.search??"").trim().slice(0,160);
    const pattern=`%${search}%`;
    const count=(await pool.query("SELECT count(*)::int AS n FROM office_operation_records WHERE pool_id=$1 AND resource='applications' AND data::text ILIKE $2",[owner.poolId,pattern])).rows[0].n;
    const items=(await pool.query("SELECT id,data,revision,created_at,updated_at FROM office_operation_records WHERE pool_id=$1 AND resource='applications' AND data::text ILIKE $2 ORDER BY created_at DESC,id LIMIT $3 OFFSET $4",[owner.poolId,pattern,limit,offset])).rows;
    res.json({items,total:count,has_more:offset+items.length<count});
  }));
  router.post("/invite",run(async(req,res,owner)=>{
    const b=object(req.body),rid=requestId(b.requestId),templateId=text(b.templateId,"양식",160),hash=digest({templateId,action:"invite"});
    const c=await pool.connect();
    try{
      await c.query("BEGIN");await c.query("SELECT id FROM swimming_pools WHERE id=$1 FOR UPDATE",[owner.poolId]);await requireFinanceSchema(c);
      const old=(await c.query("SELECT * FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2",[owner.poolId,rid])).rows[0];
      if(old){
        if(old.actor_id!==owner.userId||old.input_hash!==hash) throw new OperationError(409,"REQUEST_REUSED","다른 요청 ID입니다.");
        await c.query("COMMIT");
        const r=old.result;res.json({...r,token:invitationToken(r.invitationId,r.expiresAt)});return;
      }
      const source=(await c.query("SELECT id,data FROM office_operation_records WHERE pool_id=$1 AND resource='templates' AND id=$2 AND data->>'status'='active'",[owner.poolId,templateId])).rows[0];
      if(!source) throw new OperationError(409,"TEMPLATE_REQUIRED","활성 양식 버전을 선택하세요.");
      const invitationId=`invite_${randomUUID()}`,expiresAt=new Date(Date.now()+15*60_000).toISOString();
      const token=invitationToken(invitationId,expiresAt),template={id:source.id,...source.data,hash:digest(source.data)};
      const data={tokenHash:digest(token),expiresAt,template,status:"open"};
      await c.query("INSERT INTO office_operation_records(id,pool_id,resource,data,created_by) VALUES($1,$2,'tablet-invitations',$3::jsonb,$4)",[invitationId,owner.poolId,JSON.stringify(data),owner.userId]);
      const result={invitationId,expiresAt};
      await c.query("INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",[owner.poolId,rid,owner.userId,hash,JSON.stringify(result)]);
      await c.query("COMMIT");res.json({...result,token});
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }));
  router.post("/:id/confirm",run(async(req,res,owner)=>{
    const b=object(req.body),rid=requestId(b.requestId),studentId=text(b.studentId,"회원",160),hash=digest({id:req.params.id,studentId,revision:b.expectedRevision});
    const c=await pool.connect();
    try{
      await c.query("BEGIN");await c.query("SELECT id FROM swimming_pools WHERE id=$1 FOR UPDATE",[owner.poolId]);await requireFinanceSchema(c);
      const receipt=(await c.query("SELECT * FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2",[owner.poolId,rid])).rows[0];
      if(receipt){
        if(receipt.actor_id!==owner.userId||receipt.input_hash!==hash) throw new OperationError(409,"REQUEST_REUSED","다른 처리의 요청 ID입니다.");
        await c.query("COMMIT");res.json(receipt.result);return;
      }
      const current=(await c.query("SELECT * FROM office_operation_records WHERE pool_id=$1 AND resource='applications' AND id=$2 FOR UPDATE",[owner.poolId,req.params.id])).rows[0];
      if(!current||current.revision!==b.expectedRevision||current.data.status!=="submitted") throw new OperationError(409,"APPLICATION_CHANGED","현재 접수 상태와 버전을 다시 확인하세요.");
      const student=(await c.query("SELECT id,name FROM students WHERE swimming_pool_id=$1 AND id=$2 AND deleted_at IS NULL",[owner.poolId,studentId])).rows[0];
      if(!student) throw new OperationError(403,"SCOPE_MISMATCH","실제 등록한 센터 회원을 선택하세요.");
      const d=current.data,document:any={template:d.template,applicant:{name:d.name,parentName:d.parentName,phone:d.phone},
        signature:d.signature,signedAt:d.signedAt,confirmedAt:new Date().toISOString(),student,rendererVersion:1};
      document.hash=digest(document);
      const data={...d,status:"confirmed",studentId,document};
      const item=(await c.query("UPDATE office_operation_records SET data=$1::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 RETURNING id,data,revision",[JSON.stringify(data),current.id])).rows[0];
      await c.query("INSERT INTO office_operation_versions(record_id,revision,pool_id,actor_id,data) VALUES($1,$2,$3,$4,$5::jsonb)",[item.id,item.revision,owner.poolId,owner.userId,JSON.stringify(data)]);
      const result={item};
      await c.query("INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",[owner.poolId,rid,owner.userId,hash,JSON.stringify(result)]);
      await c.query("COMMIT");res.json(result);
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }));
  router.get("/:id/document",run(async(req,res,owner)=>{
    const row=(await pool.query("SELECT data FROM office_operation_records WHERE pool_id=$1 AND resource='applications' AND id=$2",[owner.poolId,req.params.id])).rows[0];
    if(!row?.data.document) throw new OperationError(404,"DOCUMENT_NOT_CONFIRMED","확정 문서가 없습니다.");
    res.json({document:row.data.document});
  }));
  return router;
}
/** Mounted outside privileged /office router: only an expiring purpose-scoped capability is accepted. */
export function createOfficeTabletRouter(pool:Pool) {
  const router=Router();
  router.use(rateLimit({windowMs:60_000,limit:30}));
  router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","no-referrer");next();});
  router.get("/",(_req,res)=>{
    const nonce=randomBytes(18).toString("base64");
    res.setHeader("Content-Security-Policy",`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    res.setHeader("Referrer-Policy","no-referrer");res.setHeader("Cache-Control","no-store");
    res.type("html").send(tabletForm(nonce));
  });
  router.use(async(req,res,next)=>{
    try{
      await requireFinanceSchema(pool);
      const token=req.headers.authorization?.replace(/^Bearer /,"")??"";
      if(!/^[a-f0-9]{64}$/.test(token)) throw new OperationError(403,"INVALID_INVITATION","유효한 신청 연결이 필요합니다.");
      const row=(await pool.query("SELECT id,pool_id,data FROM office_operation_records WHERE resource='tablet-invitations' AND data->>'tokenHash'=$1",[digest(token)])).rows[0];
      if(!row||Date.parse(row.data.expiresAt)<Date.now()) throw new OperationError(410,"INVITATION_EXPIRED","신청 연결이 만료됐습니다. 센터에 새 연결을 요청하세요.");
      res.locals.invitation=row;next();
    }catch(e:any){res.status(e instanceof OperationError?e.status:503).json({error:e instanceof OperationError?e.message:"신청 연결 적용 대기입니다."});}
  });
  router.get("/form",(_req,res)=>{res.setHeader("Cache-Control","no-store");res.json({template:res.locals.invitation.data.template});});
  router.post("/submit",async(req,res)=>{
    const c=await pool.connect();
    try{
      const b=object(req.body),rid=requestId(b.requestId);
      const data={name:text(b.name,"회원 이름",100),parentName:text(b.parentName,"신청인",100),phone:phone(b.phone),
        consented:b.consented===true,signature:signaturePoints(b.signature)};
      if(!data.consented||!/^0\d{8,10}$/.test(data.phone)) throw new OperationError(400,"INVALID_APPLICATION","동의와 연락처를 확인하세요.");
      const source=res.locals.invitation;
      await c.query("BEGIN");await c.query("SELECT id FROM swimming_pools WHERE id=$1 FOR UPDATE",[source.pool_id]);
      const row=(await c.query("SELECT * FROM office_operation_records WHERE id=$1 AND resource='tablet-invitations' FOR UPDATE",[source.id])).rows[0];
      if(!row||Date.parse(row.data.expiresAt)<Date.now()) throw new OperationError(410,"INVITATION_EXPIRED","신청 연결이 만료됐습니다.");
      const inputHash=digest(data);
      if(row.data.status==="submitted"){
        if(row.data.requestId!==rid||row.data.inputHash!==inputHash) throw new OperationError(409,"ALREADY_SUBMITTED","이미 제출한 신청 연결입니다.");
        await c.query("COMMIT");res.json({applicationId:row.data.applicationId});return;
      }
      const id=`application_${randomUUID()}`,signedAt=new Date().toISOString();
      const application={...data,status:"submitted",template:row.data.template,signedAt,invitationId:row.id};
      await c.query("INSERT INTO office_operation_records(id,pool_id,resource,data,created_by) VALUES($1,$2,'applications',$3::jsonb,$4)",[id,row.pool_id,JSON.stringify(application),"tablet_capability"]);
      await c.query("INSERT INTO office_operation_versions(record_id,revision,pool_id,actor_id,data) VALUES($1,1,$2,$3,$4::jsonb)",[id,row.pool_id,"tablet_capability",JSON.stringify(application)]);
      await c.query("UPDATE office_operation_records SET data=data||$1::jsonb,revision=revision+1 WHERE id=$2",[JSON.stringify({status:"submitted",requestId:rid,inputHash,applicationId:id}),row.id]);
      await c.query("COMMIT");res.json({applicationId:id});
    }catch(e:any){await c.query("ROLLBACK");res.status(e instanceof OperationError?e.status:503).json({error:e instanceof OperationError?e.message:"제출 결과 확인이 필요합니다. 새 신청을 제출하지 말고 센터에 확인하세요."});}
    finally{c.release();}
  });
  return router;
}
