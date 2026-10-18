import {Router,type Response} from "express";
import type {Pool,PoolClient} from "pg";
import {randomUUID} from "node:crypto";
import type {AuthRequest} from "../middlewares/auth.js";
import type {OfficeActor} from "../lib/office-command.js";
import {object,text,digest,requestId,OperationError} from "../lib/office-operations-data.js";
import {transportData,preserveTransportAnchors,reviewTransportPlan,rejectTransportOverlap,type TransportKind,type TransportRecord} from "../lib/office-transport.js";
type Actor=(req:AuthRequest)=>Promise<OfficeActor>;
const failure=(status:number,code:string,message:string):never=>{throw new OperationError(status,code,message);};
const columns="id,kind,data,revision";
/** Preparation only: no scheduler, driver event, SSE, push, LLM, startup DDL or automatic migration. */
export function createOfficeTransportRouter(pool:Pool,actor:Actor){
  const router=Router();
  const run=(fn:(req:AuthRequest,res:Response,owner:OfficeActor)=>Promise<void>)=>async(req:AuthRequest,res:Response)=>{
    try{
      const owner=await actor(req);
      if(owner.role!=="pool_admin")failure(403,"ROLE_REQUIRED","센터 관리자만 배차를 준비할 수 있습니다.");
      const schema=await pool.query(`SELECT to_regclass('public.office_transport_records') IS NOT NULL
        AND to_regclass('public.office_transport_snapshots') IS NOT NULL
        AND to_regclass('public.office_operation_receipts') IS NOT NULL AS ready`);
      if(!schema.rows[0]?.ready)failure(503,"TRANSPORT_MIGRATION_REQUIRED","새 배차 준비 소스·migration 승인 적용 대기입니다. 저장·기사 배포된 상태가 아닙니다.");
      await fn(req,res,owner);
    }catch(e:any){res.status(e instanceof OperationError?e.status:e?.code==="23505"?409:500).json({
      code:e instanceof OperationError?e.code:e?.code==="23505"?"DUPLICATE":"RESULT_UNKNOWN",
      error:e instanceof OperationError?e.message:e?.code==="23505"?"같은 차량번호·배차 버전이 이미 있습니다. 재조회하세요.":"결과 불명입니다. 새 요청을 보내지 말고 기존 영수증을 확인하세요."});}
  };
  async function refs(c:Pool|PoolClient,poolId:string){
    const [records,students]=await Promise.all([
      c.query(`SELECT ${columns} FROM office_transport_records WHERE pool_id=$1 ORDER BY kind,id`,[poolId]),
      c.query("SELECT id,name FROM students WHERE swimming_pool_id=$1 AND status='active' ORDER BY id LIMIT 1001",[poolId]),
    ]);
    return {records:records.rows as TransportRecord[],students:students.rows.slice(0,1000),studentListTruncated:students.rows.length>1000};
  }
  router.get("/",run(async(_req,res,owner)=>{
    const [data,drivers,classes,snapshots]=await Promise.all([
      refs(pool,owner.poolId),
      pool.query("SELECT id,name FROM users WHERE swimming_pool_id=$1 AND role='teacher' ORDER BY name,id",[owner.poolId]),
      pool.query("SELECT id,name FROM class_groups WHERE swimming_pool_id=$1 ORDER BY name,id",[owner.poolId]),
      pool.query("SELECT id,plan_id,plan_revision,content_hash,approved_at FROM office_transport_snapshots WHERE pool_id=$1 ORDER BY approved_at DESC,id DESC LIMIT 100",[owner.poolId]),
    ]);
    res.json({...data,drivers:drivers.rows,classes:classes.rows,snapshots:snapshots.rows,driverDelivery:"NOT_IMPLEMENTED",navigation:false});
  }));
  router.get("/snapshots/:id",run(async(req,res,owner)=>{
    const row=(await pool.query("SELECT * FROM office_transport_snapshots WHERE id=$1 AND pool_id=$2",[req.params.id,owner.poolId])).rows[0];
    if(!row)failure(404,"NOT_FOUND","현재 센터의 확정 배차가 없습니다.");res.json({item:row});
  }));
  async function planReview(c:Pool|PoolClient,owner:OfficeActor,plan:Record<string,any>,planId:string){
    const records=(await c.query(`SELECT ${columns} FROM office_transport_records WHERE pool_id=$1 ORDER BY kind,id`,[owner.poolId])).rows as TransportRecord[];
    // A truncated picker must not prevent a previously saved plan from resolving its exact members.
    const ids=plan.stops.flatMap((s:any)=>s.studentIds);
    const members=await c.query("SELECT id,name FROM students WHERE swimming_pool_id=$1 AND status='active' AND id=ANY($2::text[])",[owner.poolId,ids]);
    const result=reviewTransportPlan(plan,records,members.rows);
    await validateRefs(c,owner, "plan",plan);
    const driver=(await c.query("SELECT id,name FROM users WHERE id=$1 AND swimming_pool_id=$2 AND role='teacher'",[result.vehicle.driverId,owner.poolId])).rows[0];
    if(!driver)failure(409,"DRIVER_SCOPE","기사 담당자를 현재 센터의 강사 계정에서 다시 지정하세요.");
    const group=(await c.query("SELECT id,name FROM class_groups WHERE id=$1 AND swimming_pool_id=$2",[plan.classGroupId,owner.poolId])).rows[0];
    const existing=(await c.query(`SELECT DISTINCT ON(plan_id) id,plan_id,snapshot FROM office_transport_snapshots
      WHERE pool_id=$1 ORDER BY plan_id,plan_revision DESC`,[owner.poolId])).rows;
    const snapshot={...result,driver,classGroup:group,replacesSnapshotId:existing.find(x=>x.plan_id===planId)?.id??null};
    rejectTransportOverlap(snapshot,existing.filter(x=>x.plan_id!==planId));
    return snapshot;
  }
  async function validateRefs(c:Pool|PoolClient,owner:OfficeActor,kind:TransportKind,data:Record<string,any>,newDraft=false){
    if(kind==="vehicle"&&data.driverId){
      const r=await c.query("SELECT id FROM users WHERE id=$1 AND swimming_pool_id=$2 AND role='teacher'",[data.driverId,owner.poolId]);
      if(!r.rows.length)failure(403,"SCOPE_MISMATCH","현재 센터의 기사 담당자만 지정하세요.");
    }
    if(kind!=="plan")return;
    const all=(await c.query(`SELECT ${columns} FROM office_transport_records WHERE pool_id=$1`,[owner.poolId])).rows as TransportRecord[];
    if(!all.some(r=>r.id===data.vehicleId&&r.kind==="vehicle")||data.stops.some((s:any)=>!all.some(r=>r.id===s.stopId&&r.kind==="stop")))
      failure(403,"SCOPE_MISMATCH","같은 센터의 차량·승차지를 선택하세요.");
    const ids=data.stops.flatMap((s:any)=>s.studentIds);
    const members=await c.query(`SELECT s.id FROM students s WHERE s.swimming_pool_id=$1 AND s.status='active' AND s.id=ANY($2::text[])
      AND EXISTS(SELECT 1 FROM student_class_history h WHERE h.student_id=s.id AND h.swimming_pool_id=$1
        AND h.class_group_id=$3 AND h.enrolled_at::date<=(now() AT TIME ZONE 'Asia/Seoul')::date
        AND (h.left_at IS NULL OR h.left_at::date>(now() AT TIME ZONE 'Asia/Seoul')::date))`,[owner.poolId,ids,data.classGroupId]);
    const group=await c.query("SELECT id FROM class_groups WHERE id=$1 AND swimming_pool_id=$2",[data.classGroupId,owner.poolId]);
    if(members.rows.length!==ids.length||!group.rows.length)failure(403,"SCOPE_MISMATCH","같은 센터·반의 현재 수강 이력으로 확인되는 회원만 배정하세요. 미래 수강 변경은 자동 반영하지 않습니다.");
    if(data.sourceSnapshotId){
      const source=(await c.query("SELECT snapshot FROM office_transport_snapshots WHERE id=$1 AND pool_id=$2",[data.sourceSnapshotId,owner.poolId])).rows[0];
      if(!source)failure(403,"SCOPE_MISMATCH","재사용할 원본 확정 배차를 확인하세요.");
      if(newDraft)preserveTransportAnchors(source.snapshot.plan,data);
    }
  }
  router.get("/plans/:id/preview",run(async(req,res,owner)=>{
    const plan=(await pool.query(`SELECT ${columns} FROM office_transport_records WHERE id=$1 AND pool_id=$2 AND kind='plan'`,[req.params.id,owner.poolId])).rows[0];
    if(!plan)failure(404,"NOT_FOUND","배차 초안을 다시 선택하세요.");
    const preview=await planReview(pool,owner,plan.data,plan.id);
    res.json({planId:plan.id,revision:plan.revision,preview,previewHash:digest(preview),approvalRequired:true});
  }));
  const mutate=(approve:boolean)=>run(async(req,res,owner)=>{
    const body=object(req.body),rid=requestId(body.requestId),hash=digest({approve,id:req.params.id??null,body});
    const c=await pool.connect();
    try{
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[owner.poolId]);
      const old=(await c.query("SELECT actor_id,input_hash,result FROM office_operation_receipts WHERE pool_id=$1 AND request_id=$2",[owner.poolId,rid])).rows[0];
      if(old){
        if(old.actor_id!==owner.userId||old.input_hash!==hash)failure(409,"REQUEST_CONFLICT","다른 요청에 사용된 ID입니다.");
        await c.query("COMMIT");res.json(old.result);return;
      }
      const current=req.params.id?(await c.query(`SELECT ${columns} FROM office_transport_records WHERE id=$1 AND pool_id=$2 FOR UPDATE`,[req.params.id,owner.poolId])).rows[0]:null;
      if(req.params.id&&!current)failure(404,"NOT_FOUND","현재 센터의 대상을 다시 선택하세요.");
      if(current&&current.revision!==body.expectedRevision)failure(409,"STALE_REVISION","초안이 바뀌었습니다. 다시 검수하세요.");
      let result:Record<string,any>;
      if(approve){
        if(!current||current.kind!=="plan")failure(409,"PREVIEW_REQUIRED","현재 배차 초안을 선택하세요.");
        const snapshot=await planReview(c,owner,current.data,current.id);
        if(body.confirmed!==true||body.previewHash!==digest(snapshot))
          failure(409,"PREVIEW_REQUIRED","동일한 최신 초안·차량·회원·시간 검수를 확인하세요.");
        const id=randomUUID();
        const row=(await c.query(`INSERT INTO office_transport_snapshots(id,pool_id,plan_id,plan_revision,snapshot,content_hash,approved_by)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id,plan_id,plan_revision,content_hash,approved_at`,
          [id,owner.poolId,current.id,current.revision,JSON.stringify(snapshot),digest(snapshot),owner.userId])).rows[0];
        result={item:row,driverDelivery:"NOT_IMPLEMENTED",status:"APPROVED_NOT_DISPATCHED"};
      }else{
        const kind=current?.kind??body.kind;
        const data=transportData(kind,body.data);
        if(current?.kind==="plan")preserveTransportAnchors(current.data,data);
        await validateRefs(c,owner,kind,data,!current);
        const id=current?.id??randomUUID();
        const row=current?(await c.query(`UPDATE office_transport_records SET data=$3::jsonb,revision=revision+1,updated_by=$4,updated_at=now()
          WHERE id=$1 AND pool_id=$2 RETURNING ${columns}`,[id,owner.poolId,JSON.stringify(data),owner.userId])).rows[0]
          :(await c.query(`INSERT INTO office_transport_records(id,pool_id,kind,data,created_by,updated_by)
          VALUES($1,$2,$3,$4::jsonb,$5,$5) RETURNING ${columns}`,[id,owner.poolId,kind,JSON.stringify(data),owner.userId])).rows[0];
        result={item:row};
      }
      await c.query(`INSERT INTO office_operation_receipts(pool_id,request_id,actor_id,input_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [owner.poolId,rid,owner.userId,hash,JSON.stringify(result)]);
      await c.query("COMMIT");res.json(result);
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  });
  router.post("/records",mutate(false));
  router.patch("/records/:id",mutate(false));
  router.post("/plans/:id/approve",mutate(true));
  return router;
}
