import {Router} from "express";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {requireAuth,type AuthRequest} from "../middlewares/auth.js";
import {object,text,requestId,digest,OperationError} from "../lib/office-operations-data.js";
import {TransportConflict,validateRunPlan,transportState,checkTransportCommand,recalculateTransport,type TransportRunPlan,type TransportCommand} from "@workspace/api-zod";
import {transportFail,reviewRun,readRunEvents,transportContacts,type TransportIdentity} from "../lib/transport-v2-store.js";
import {attachTransportPreparation} from "./transport-v2-preparation.js";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export function createTransportV2Router(pool:Pool){
  const r=Router();r.use(requireAuth as any);
  async function identity(req:AuthRequest,c:PoolClient):Promise<TransportIdentity>{
    const type=["parent","parent_account"].includes(req.user!.role)?"parent_accounts":"users";
    const row=(await c.query(type==="users"?
      "SELECT id,name,swimming_pool_id,roles FROM users WHERE id=$1 AND is_activated=true AND withdrawal_requested_at IS NULL":
      "SELECT id,name,swimming_pool_id FROM parent_accounts WHERE id=$1 AND withdrawal_requested_at IS NULL",[req.user!.userId])).rows[0];
    if(!row||!row.swimming_pool_id||(req.user!.poolId&&req.user!.poolId!==row.swimming_pool_id))transportFail("IDENTITY","현재 계정·센터 소속을 다시 확인하세요.");
    const activePool=(await c.query("SELECT id FROM swimming_pools WHERE id=$1 AND deactivated_at IS NULL",[row.swimming_pool_id])).rows[0];
    if(!activePool)transportFail("IDENTITY","사용 중인 센터 소속이 아닙니다.");
    return {id:row.id,name:row.name,type,poolId:row.swimming_pool_id,key:`${type}:${row.id}`,
      admin:type==="users"&&req.user!.role==="pool_admin"&&row.roles?.includes("pool_admin")};
  }
  const route=(method:"get"|"post",path:string,admin:boolean,write:boolean,fn:(req:AuthRequest,c:PoolClient,who:TransportIdentity)=>Promise<any>)=>{
    r[method](path,async(raw,res)=>{
      const req=raw as unknown as AuthRequest;
      let c:PoolClient|undefined;
      try{
        c=await pool.connect();
        await c.query("BEGIN");
        const ready=(await c.query(`SELECT to_regclass('office_transport_runs') IS NOT NULL AND to_regclass('office_transport_memberships') IS NOT NULL
          AND to_regclass('office_transport_run_versions') IS NOT NULL AND to_regclass('office_transport_events') IS NOT NULL
          AND to_regclass('office_transport_preferences') IS NOT NULL AND to_regclass('office_transport_vehicle_availability') IS NOT NULL
          AND to_regclass('office_transport_notification_intents') IS NOT NULL AND to_regclass('office_operation_receipts') IS NOT NULL
          AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('parent_students') AND attname='transport_notify' AND NOT attisdropped) AS ready`)).rows[0]?.ready;
        if(!ready)throw new OperationError(503,"TRANSPORT_V2_MIGRATION_REQUIRED","V2 소스·신규 migration 적용 승인 대기입니다. 운영에 저장·게시된 상태가 아닙니다.");
        const who=await identity(req,c);
        if(admin&&!who.admin)throw new OperationError(403,"ADMIN_REQUIRED","센터 관리자 전용입니다.");
        // One pool lock also serializes revocation, publication, versioning and driver events.
        await c.query(write?"SELECT pg_advisory_xact_lock(hashtextextended($1,0))":"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",[who.poolId]);
        const rid=write?requestId(object(req.body).requestId):null,ih=write?digest({path:req.path,body:req.body}):null;
        if(rid){
          // Authorization is still rechecked inside endpoints for scoped reads; old receipts never expose manifests.
          const old=(await c.query("SELECT actor_id,input_hash,result FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2",[who.poolId,rid])).rows[0];
          if(old){
            if(old.actor_id!==who.key||old.input_hash!==ih)transportFail("REQUEST_CONFLICT","다른 요청·계정에 사용된 ID입니다.");
            await receiptAccess(c,who,old.result);
            await c.query("COMMIT");res.json(old.result.value);return;
          }
        }
        const result=await fn(req,c,who);
        if(rid)await c.query("INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",
          [who.poolId,rid,who.key,ih,JSON.stringify({transportScope:{admin,runId:!admin?req.params.id??null:null,
            childId:path==="/parent/preferences"?req.body.studentId:null},value:result})]);
        await c.query("COMMIT");res.json(result);
      }catch(e:any){
        if(c)await c.query("ROLLBACK").catch(()=>{});
        const status=e instanceof OperationError?e.status:e instanceof TransportConflict?409:e?.code==="23505"?409:500;
        res.status(status).json({code:e.code??"RESULT_UNKNOWN",error:e instanceof OperationError||e instanceof TransportConflict?e.message:"결과를 확인하지 못했습니다. 같은 요청 ID와 원 소유 문맥을 보존하세요."});
      }finally{c?.release();}
    });
  };
  async function assigned(c:PoolClient,who:TransportIdentity,id:string){
    const run=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2",[id,who.poolId])).rows[0];
    if(!run||!["PUBLISHED","ACTIVE","CLOSED"].includes(run.status))throw new OperationError(404,"NOT_FOUND","게시된 담당 운행이 없습니다.");
    const crew=(await c.query(`SELECT id FROM office_transport_memberships WHERE pool_id=$1 AND principal_type=$2 AND principal_id=$3
      AND status='ACTIVE' AND id=ANY($4::text[])`,[who.poolId,who.type,who.id,[run.plan.driverId,run.plan.escortId].filter(Boolean)])).rows;
    if(!crew.length)throw new OperationError(403,"ASSIGNMENT_REVOKED","운행 배정·센터 운행 권한이 해제됐습니다. 이전 대기 기록을 새 계정으로 보내지 마세요.");
    return run;
  }
  async function receiptAccess(c:PoolClient,who:TransportIdentity,result:any){
    if(!result?.transportScope)throw new OperationError(403,"RECEIPT_SCOPE","이 업무의 영수증이 아닙니다.");
    if(result.transportScope.admin&&!who.admin)throw new OperationError(403,"ADMIN_REQUIRED","기존 관리자 권한이 해제됐습니다.");
    if(result.transportScope.runId)await assigned(c,who,result.transportScope.runId);
    if(result.transportScope.childId){
      const relation=(await c.query("SELECT id FROM parent_students WHERE parent_id=$1 AND student_id=$2 AND swimming_pool_id=$3 AND status='approved'",[who.id,result.transportScope.childId,who.poolId])).rows[0];
      if(who.type!=="parent_accounts"||!relation)throw new OperationError(403,"CHILD_SCOPE","승인된 자기 자녀 관계를 다시 확인하세요.");
    }
    if(!result.transportScope.admin&&!result.transportScope.runId&&!result.transportScope.childId){
      const active=(await c.query("SELECT id FROM office_transport_memberships WHERE id=$1 AND principal_type=$2 AND principal_id=$3 AND pool_id=$4 AND status='ACTIVE'",[result.value?.item?.id,who.type,who.id,who.poolId])).rows[0];
      if(!active)throw new OperationError(403,"ASSIGNMENT_REVOKED","기존 운행 전용 권한이 해제됐습니다.");
    }
  }
  route("get","/requests/:id",false,false,async(req,c,who)=>{
    const row=(await c.query("SELECT result FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2 AND actor_id=$3",[who.poolId,requestId(req.params.id),who.key])).rows[0];
    if(!row)throw new OperationError(404,"NOT_FOUND","처리 결과를 찾지 못했습니다. 미처리 증거는 아닙니다.");
    await receiptAccess(c,who,row.result);return row.result.value;
  });
  route("get","/me",false,false,async(_req,c,who)=>({identity:{key:who.key,id:who.id,type:who.type,poolId:who.poolId,name:who.name},
    memberships:(await c.query("SELECT id,pool_id,duty,status,name FROM office_transport_memberships WHERE principal_type=$1 AND principal_id=$2 AND pool_id=$3 AND status<>'REVOKED'",[who.type,who.id,who.poolId])).rows}));
  route("get","/admin",true,false,async(_req,c,who)=>({
    members:(await c.query("SELECT id,principal_type,principal_id,name,duty,status,accepted_at FROM office_transport_memberships WHERE pool_id=$1 ORDER BY created_at DESC",[who.poolId])).rows,
    runs:(await c.query("SELECT * FROM office_transport_runs WHERE pool_id=$1 ORDER BY updated_at DESC LIMIT 100",[who.poolId])).rows,
    preferences:(await c.query("SELECT student_id,revision,data FROM office_transport_preferences WHERE pool_id=$1",[who.poolId])).rows,
    availability:(await c.query("SELECT vehicle_id,revision,data FROM office_transport_vehicle_availability WHERE pool_id=$1",[who.poolId])).rows,
    ai:{enabled:false,reason:"새 유료 호출 승인 전 AI 배차 제안 미연결"},push:{enabled:false,reason:"발송 경로 연결·운영 승인 전 미발송"}}));
  route("post","/memberships/invite",true,true,async(req,c,who)=>{
    const b=object(req.body),type=b.principalType;
    if(!["users","parent_accounts"].includes(type)||!["DRIVER","ESCORT"].includes(b.duty)||b.confirmed!==true)transportFail("INVITE","계정 종류·운행 전용 역할·초대 확인이 필요합니다.");
    const id=text(b.principalId,"기존 계정 ID",160);
    const row=(await c.query(`SELECT id,name,swimming_pool_id FROM ${type} WHERE id=$1 AND withdrawal_requested_at IS NULL`,[id])).rows[0];
    if(!row||row.swimming_pool_id!==who.poolId)transportFail("INVITE_SCOPE","기존 계정의 현재 센터 귀속을 확인하세요. 새 계정·강사 권한을 대신 만들지 않습니다.");
    const token=randomBytes(32).toString("hex"),mid=randomUUID();
    await c.query(`INSERT INTO office_transport_memberships(id,pool_id,principal_type,principal_id,name,duty,status,invite_hash,expires_at,invited_by)
      VALUES($1,$2,$3,$4,$5,$6,'INVITED',$7,now()+interval '7 days',$8)`,[mid,who.poolId,type,id,row.name,b.duty,hash(token),who.key]);
    // Return an on-screen handoff code, not an SMS/push or new identity credential.
    return {id:mid,inviteCode:token,status:"INVITED",sent:false};
  });
  route("post","/memberships/accept",false,true,async(req,c,who)=>{
    const code=text(object(req.body).inviteCode,"초대 코드",100);
    const row=(await c.query(`UPDATE office_transport_memberships SET status='ACTIVE',accepted_at=now(),invite_hash=NULL
      WHERE invite_hash=$1 AND principal_type=$2 AND principal_id=$3 AND pool_id=$4 AND status='INVITED' AND expires_at>now() RETURNING id,duty`,
      [hash(code),who.type,who.id,who.poolId])).rows[0];
    if(!row)transportFail("INVITE","본인·센터에 유효한 초대가 아닙니다.");
    return {item:row,status:"ACTIVE"};
  });
  route("post","/memberships/:id/revoke",true,true,async(req,c,who)=>{
    if(req.body.confirmed!==true)transportFail("CONFIRM","운행 전용 권한 회수를 확인하세요.");
    const row=(await c.query("UPDATE office_transport_memberships SET status='REVOKED',invite_hash=NULL,revoked_at=now() WHERE id=$1 AND pool_id=$2 RETURNING id",[req.params.id,who.poolId])).rows[0];
    if(!row)transportFail("NOT_FOUND","현재 센터의 운행 담당자가 없습니다.");
    return {item:row,status:"REVOKED"};
  });
  route("post","/runs/save",true,true,async(req,c,who)=>{
    const b=object(req.body),p=object(b.plan) as TransportRunPlan;
    validateRunPlan(p);
    const old=b.id?(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2 FOR UPDATE",[text(b.id,"운행 ID",160),who.poolId])).rows[0]:null;
    if(b.id&&!old)transportFail("NOT_FOUND","현재 센터의 운행이 없습니다.");
    if(old&&((old.pending_revision??old.revision)!==b.expectedRevision||old.status==="CLOSED"))transportFail("VERSION_CHANGED","최신 운행 버전·종료 상태를 다시 확인하세요.");
    if(old){
      const events=await readRunEvents(c,old.id);
      for(const step of (old.pending_plan??old.plan).steps){
        const next=p.steps.find(s=>s.id===step.id);
        if(step.fixed&&(!next||step.time!==next.time))transportFail("PROCESSED_FIXED","고정 시각은 유지하세요. 먼저 같은 시각으로 고정 해제·저장해야 합니다.");
      }
      for(const step of old.plan.steps)if(events.some(e=>["BOARD","ALIGHT","NO_SHOW"].includes(e.kind)&&e.stepId===step.id)&&digest(step)!==digest(p.steps.find(s=>s.id===step.id)))
        transportFail("PROCESSED_FIXED","기사 확인이 있는 구간은 원기록을 보존하세요.");
      if(events.some(e=>e.kind==="START")&&(p.date!==old.plan.date||p.vehicleId!==old.plan.vehicleId||p.driverId!==old.plan.driverId||p.escortId!==old.plan.escortId))
        transportFail("ACTIVE_IDENTITY","진행 운행의 날짜·차량·담당자는 이 경로로 바꿀 수 없습니다.");
    }
    const reviewed=await reviewRun(c,who.poolId,p,old?.id);
    const canonical=JSON.stringify(reviewed.plan);
    const id=old?.id??randomUUID();
    const staged=old&&["PUBLISHED","ACTIVE"].includes(old.status);
    const row=staged?(await c.query(`UPDATE office_transport_runs SET pending_plan=$3::jsonb,pending_revision=COALESCE(pending_revision,revision)+1,
      pending_status='DRAFT',pending_hash=NULL,updated_at=now() WHERE id=$1 AND pool_id=$2
      RETURNING id,pending_revision AS revision,pending_status AS status`,[id,who.poolId,canonical])).rows[0]:
      old?(await c.query("UPDATE office_transport_runs SET plan=$3::jsonb,revision=revision+1,status='DRAFT',approved_hash=NULL,updated_at=now() WHERE id=$1 AND pool_id=$2 RETURNING id,revision,status",[id,who.poolId,canonical])).rows[0]:
      (await c.query("INSERT INTO office_transport_runs(id,pool_id,status,plan,created_by) VALUES($1,$2,'DRAFT',$3::jsonb,$4) RETURNING id,revision,status",[id,who.poolId,canonical,who.key])).rows[0];
    return {item:row,plan:reviewed.plan};
  });
  route("get","/runs/:id/review",true,false,async(req,c,who)=>{
    const row=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2",[req.params.id,who.poolId])).rows[0];
    if(!row)transportFail("NOT_FOUND","현재 센터의 운행이 없습니다.");
    return {id:row.id,revision:row.pending_revision??row.revision,...await reviewRun(c,who.poolId,row.pending_plan??row.plan,row.id)};
  });
  route("post","/runs/:id/recalculate",true,false,async(req,c,who)=>{
    const row=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2",[req.params.id,who.poolId])).rows[0];
    if(!row||(row.pending_revision??row.revision)!==req.body.expectedRevision)transportFail("VERSION_CHANGED","최신 운행 버전을 선택하세요.");
    return {...recalculateTransport(row.pending_plan??row.plan,req.body.from),id:row.id,revision:row.pending_revision??row.revision,applied:false};
  });
  route("post","/runs/:id/approve",true,true,async(req,c,who)=>{
    const row=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2 FOR UPDATE",[req.params.id,who.poolId])).rows[0];
    if(!row||(row.pending_status??row.status)!=="DRAFT"||(row.pending_revision??row.revision)!==req.body.expectedRevision||req.body.confirmed!==true)transportFail("VERSION_CHANGED","검수할 최신 초안을 다시 선택·확인하세요.");
    const revision=row.pending_revision??row.revision,plan=row.pending_plan??row.plan;
    const checked=await reviewRun(c,who.poolId,plan,row.id);
    if(checked.hash!==req.body.previewHash||digest(plan)!==checked.hash)transportFail("PREVIEW_CHANGED","정류장·차량·회원 검수가 바뀌었습니다. 다시 검수하세요.");
    await c.query("INSERT INTO office_transport_run_versions(run_id,revision,pool_id,plan,content_hash,approved_by) VALUES($1,$2,$3,$4::jsonb,$5,$6)",[row.id,revision,who.poolId,JSON.stringify(plan),checked.hash,who.key]);
    await c.query(row.pending_plan?
      "UPDATE office_transport_runs SET pending_status='APPROVED',pending_hash=$2,updated_at=now() WHERE id=$1":
      "UPDATE office_transport_runs SET status='APPROVED',approved_hash=$2,updated_at=now() WHERE id=$1",[row.id,checked.hash]);
    return {id:row.id,revision,status:"APPROVED",hash:checked.hash,driverReceived:false};
  });
  route("post","/runs/:id/publish",true,true,async(req,c,who)=>{
    const row=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2 FOR UPDATE",[req.params.id,who.poolId])).rows[0];
    if(!row||(row.pending_status??row.status)!=="APPROVED"||(row.pending_revision??row.revision)!==req.body.expectedRevision||(row.pending_hash??row.approved_hash)!==req.body.hash||req.body.confirmed!==true)transportFail("PUBLISH","확정 ID·버전·hash를 확인하세요.");
    const plan=row.pending_plan??row.plan,revision=row.pending_revision??row.revision;
    const checked=await reviewRun(c,who.poolId,plan,row.id);
    if(checked.hash!==req.body.hash||digest(plan)!==checked.hash)transportFail("PREVIEW_CHANGED","확정 이후 정류장·차량 검수 자료가 바뀌었습니다. 다시 저장·검수·확정하세요.");
    const events=await readRunEvents(c,row.id);
    for(const step of row.plan.steps)if(events.some(e=>["BOARD","ALIGHT","NO_SHOW"].includes(e.kind)&&e.stepId===step.id)&&digest(step)!==digest(plan.steps.find((s:any)=>s.id===step.id)))
      transportFail("PROCESSED_CHANGED","검수 후 기사 확인이 추가됐습니다. 처리 구간을 보존하고 다시 검수하세요.");
    const status=events.some(e=>e.kind==="START")?"ACTIVE":"PUBLISHED";
    if(events.some(e=>e.kind==="FINISH"))transportFail("CLOSED","이미 현장 종료한 운행입니다.");
    await c.query(`UPDATE office_transport_runs SET status=$2,plan=$3::jsonb,revision=$4,approved_hash=$5,
      pending_plan=NULL,pending_revision=NULL,pending_status=NULL,pending_hash=NULL,updated_at=now() WHERE id=$1`,
      [row.id,status,JSON.stringify(plan),revision,req.body.hash]);
    return {id:row.id,revision,status,driverReceived:false,push:"NOT_SENT"};
  });
  route("get","/runs",false,false,async(_req,c,who)=>({items:(await c.query(`SELECT r.id,r.revision,r.status,r.plan->>'name' AS name,r.plan->>'date' AS date
    FROM office_transport_runs r WHERE r.pool_id=$1 AND r.status IN ('PUBLISHED','ACTIVE','CLOSED') AND EXISTS(
      SELECT 1 FROM office_transport_memberships m WHERE m.pool_id=r.pool_id AND m.principal_type=$2 AND m.principal_id=$3 AND m.status='ACTIVE'
      AND m.id IN (r.plan->>'driverId',r.plan->>'escortId')) ORDER BY r.updated_at DESC LIMIT 100`,[who.poolId,who.type,who.id])).rows}));
  route("get","/runs/:id",false,false,async(req,c,who)=>{
    const run=await assigned(c,who,req.params.id),events=await readRunEvents(c,run.id);
    const {pending_plan,pending_revision,pending_status,pending_hash,created_by,...published}=run;
    return {run:published,events,state:transportState(run.plan,events),students:await transportContacts(c,who.poolId,run.plan),serverAt:new Date().toISOString()};
  });
  route("get","/admin/runs/:id",true,false,async(req,c,who)=>{
    const run=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2",[req.params.id,who.poolId])).rows[0];
    if(!run)transportFail("NOT_FOUND","현재 센터의 운행이 없습니다.");
    const events=await readRunEvents(c,run.id);
    return {run,events,state:transportState(run.plan,events),students:await transportContacts(c,who.poolId,run.plan),serverAt:new Date().toISOString()};
  });
  route("post","/runs/:id/events",false,true,async(req,c,who)=>{
    const run=await assigned(c,who,req.params.id);
    const b=object(req.body);
    const command:TransportCommand={requestId:b.requestId,revision:b.revision,kind:b.kind,deviceAt:b.deviceAt,
      stepId:b.stepId,studentIds:b.studentIds,corrects:b.corrects,reason:b.reason,cabinChecked:b.cabinChecked,centerReturned:b.centerReturned};
    const events=await readRunEvents(c,run.id);
    checkTransportCommand(run.plan,events,command,who.key,run.revision);
    const event={...command,actor:who.key,serverAt:new Date().toISOString()};
    await c.query("INSERT INTO office_transport_events(request_id,run_id,pool_id,revision,actor,payload,device_at,server_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
      [command.requestId,run.id,who.poolId,run.revision,who.key,JSON.stringify(command),command.deviceAt,event.serverAt]);
    if(["BOARD","ALIGHT","NO_SHOW"].includes(command.kind))await c.query(`INSERT INTO office_transport_notification_intents(event_id,parent_id,student_id,pool_id)
      SELECT $1,p.parent_id,p.student_id,p.swimming_pool_id FROM parent_students p WHERE p.swimming_pool_id=$2 AND p.status='approved'
      AND p.transport_notify=true AND p.student_id=ANY($3::text[]) ON CONFLICT DO NOTHING`,[command.requestId,who.poolId,command.studentIds]);
    if(command.kind==="CORRECT")await c.query("UPDATE office_transport_notification_intents SET state='VOIDED_BY_CORRECTION' WHERE event_id=$1 AND state='HELD_FOR_DISPATCH_APPROVAL'",[command.corrects]);
    const state=transportState(run.plan,[...events,event]);
    if(command.kind==="START"||command.kind==="FINISH")await c.query("UPDATE office_transport_runs SET status=$2,updated_at=now() WHERE id=$1",[run.id,command.kind==="FINISH"?"CLOSED":"ACTIVE"]);
    return {requestId:command.requestId,event,state,revision:run.revision,push:"NOT_SENT"};
  });
  route("get","/parent",false,false,async(_req,c,who)=>{
    if(who.type!=="parent_accounts")throw new OperationError(403,"PARENT_REQUIRED","승인된 보호자 계정으로 조회하세요.");
    const relationships=(await c.query("SELECT student_id,transport_notify FROM parent_students WHERE parent_id=$1 AND swimming_pool_id=$2 AND status='approved'",[who.id,who.poolId])).rows;
    const children=relationships.map(x=>x.student_id);
    const runs=(await c.query("SELECT id,revision,status,plan FROM office_transport_runs WHERE pool_id=$1 AND status IN ('PUBLISHED','ACTIVE','CLOSED') ORDER BY updated_at DESC LIMIT 100",[who.poolId])).rows;
    const items=[];
    for(const run of runs){
      const own=children.filter(id=>run.plan.steps.some((s:any)=>s.studentIds.includes(id)));
      if(!own.length)continue;
      const events=await readRunEvents(c,run.id),state=transportState(run.plan,events);
      for(const studentId of own){
        const child=state.children[studentId];
        items.push({runId:run.id,revision:run.revision,date:run.plan.date,studentId,status:child.status,
          scheduled:run.plan.steps.filter((s:any)=>s.studentIds.includes(studentId)).map((s:any)=>({action:s.action,time:s.time,name:s.name})),
          deviceAt:child.event?.deviceAt??null,serverAt:child.event?.serverAt??null,queriedAt:new Date().toISOString(),notifyEnabled:relationships.find(x=>x.student_id===studentId)?.transport_notify??false,push:"NOT_SENT"});
      }
    }
    return {items,tracking:false};
  });
  route("post","/parent/preferences",false,true,async(req,c,who)=>{
    if(who.type!=="parent_accounts"||typeof req.body.enabled!=="boolean")throw new OperationError(403,"CHILD_SCOPE","승인된 보호자·알림 선택을 확인하세요.");
    const id=text(req.body.studentId,"자녀 ID",160);
    const row=(await c.query("UPDATE parent_students SET transport_notify=$4 WHERE parent_id=$1 AND student_id=$2 AND swimming_pool_id=$3 AND status='approved' RETURNING student_id,transport_notify",[who.id,id,who.poolId,req.body.enabled])).rows[0];
    if(!row)throw new OperationError(403,"CHILD_SCOPE","승인된 자기 자녀만 설정하세요.");
    return {studentId:id,enabled:row.transport_notify,dispatch:"HELD_FOR_DISPATCH_APPROVAL"};
  });
  attachTransportPreparation(route);
  return r;
}
