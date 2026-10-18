import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {transportAiProposal,type TransportModelPort} from "../lib/transport-ai-proposal.js";
import {object,text,digest,OperationError} from "../lib/office-operations-data.js";
import {transportMinute,transportState,checkTransportCommand,type TransportRunPlan,type TransportCommand} from "@workspace/api-zod";
import {checkTransportWindows,calculateTransportDraft,type TransportPlanningSettings} from "../../../../lib/api-zod/src/transport-planning.js";
import {loadTransportPlanning} from "../lib/transport-v2-planning.js";
import {transportFail,readRunEvents,transportContacts,reviewRun} from "../lib/transport-v2-store.js";
import {transportDate,type TransportRoute} from "./transport-v2-preparation.js";
export function attachTransportCompletion(route:TransportRoute,pool:Pool,model?:TransportModelPort){
  route("get","/planning/ai-capability",true,false,async(_req,_c,who)=>({enabled:!!model&&model.approval.poolId===who.poolId&&model.approval.expiresAt>Date.now(),
    reason:"차량 전용 승인 모델·횟수·token·금액 범위만 허용. 이전 모델 시험 4회 승인은 재사용하지 않음",
    model:model?.approval.model,maxTokens:model?.approval.maxTokens}));
  route("post","/planning/ai-propose",true,true,async(req,c,who)=>{
    text(req.body.text,"해석할 차량 조건",2000);
    const context=await loadTransportPlanning(c,who.poolId,transportDate(req.body.plan?.date));
    const stops=(await c.query("SELECT id,data FROM office_transport_records WHERE pool_id=$1 AND kind='stop' AND data->>'status'='active'",[who.poolId])).rows.map(x=>({id:x.id,...x.data}));
    return transportAiProposal(pool,model,who,req.body,context.items,context.settings.data,stops);
  });
  route("get","/planning",true,false,(req,c,who)=>loadTransportPlanning(c,who.poolId,transportDate(req.query.date)));
  route("post","/planning/settings",true,true,async(req,c,who)=>{
    const b=object(req.body),d=object(b.data) as TransportPlanningSettings;
    const minute=(v:number,max=240)=>Number.isInteger(v)&&v>=0&&v<=max;
    if(!minute(d.departureBufferMinutes,120)||!minute(d.handoverBufferMinutes,120)||!d.durations||
      !Array.isArray(d.overrides)||d.overrides.length>366||!Array.isArray(d.travel)||d.travel.length>2000)transportFail("SETTINGS","버퍼·수업시간·날짜 변경·등록 이동시간을 확인하세요.");
    const classes=(await c.query("SELECT id FROM class_groups WHERE swimming_pool_id=$1 AND is_deleted=false",[who.poolId])).rows;
    const validClass=(id:string)=>classes.some(x=>x.id===id);
    for(const [id,v] of Object.entries(d.durations))if(!validClass(id)||!minute(v)||v===0)transportFail("CLASS_DURATION","현재 센터 반의 실제 수업 길이를 입력하세요.");
    const overrideKeys=new Set<string>();
    for(const o of d.overrides){
      const key=`${o.classId}:${transportDate(o.date)}`;
      if(!validClass(o.classId)||typeof o.cancelled!=="boolean"||overrideKeys.has(key))transportFail("OVERRIDE","반·날짜·휴강 중복을 확인하세요.");
      overrideKeys.add(key);
      if(!o.cancelled&&(!o.start||!o.end||transportMinute(o.end)<=transportMinute(o.start)))transportFail("OVERRIDE","변경 수업의 시작과 종료를 모두 입력하세요.");
    }
    const stops=(await c.query("SELECT id FROM office_transport_records WHERE pool_id=$1 AND kind='stop' AND data->>'status'='active'",[who.poolId])).rows.map(x=>x.id);
    const edges=new Set<string>();
    for(const edge of d.travel){
      const key=`${edge.from}:${edge.to}`;
      if(![edge.from,edge.to].every(id=>id==="CENTER"||stops.includes(id))||edge.from===edge.to||!minute(edge.minutes)||edges.has(key))transportFail("TRAVEL","센터 정류장·방향별 이동시간을 중복 없이 입력하세요.");
      text(edge.evidence,"이동시간 근거",500);edges.add(key);
    }
    const old=(await c.query("SELECT revision FROM office_transport_settings WHERE pool_id=$1 FOR UPDATE",[who.poolId])).rows[0];
    if((old?.revision??0)!==b.expectedRevision)transportFail("VERSION_CHANGED","일정 검수 설정이 바뀌었습니다.");
    await c.query(`INSERT INTO office_transport_settings(pool_id,data,updated_by) VALUES($1,$2::jsonb,$3)
      ON CONFLICT(pool_id) DO UPDATE SET data=excluded.data,updated_by=excluded.updated_by,revision=office_transport_settings.revision+1,updated_at=now()`,[who.poolId,JSON.stringify(d),who.key]);
    return {revision:(old?.revision??0)+1,data:d,postedRunsChanged:false};
  });
  route("post","/planning/calculate",true,false,async(req,c,who)=>{
    const p=object(req.body.plan) as TransportRunPlan;
    const context=await loadTransportPlanning(c,who.poolId,transportDate(p.date));
    const stops=(await c.query("SELECT id,data FROM office_transport_records WHERE pool_id=$1 AND kind='stop' AND data->>'status'='active'",[who.poolId])).rows.map(x=>({id:x.id,...x.data}));
    if(!Array.isArray(p.steps)||p.steps.length<2||p.steps[0].action!=="CENTER_BOARD"||p.steps.at(-1)?.action!=="CENTER_HANDOVER")transportFail("PLAN","센터 출발·복귀 구조가 필요합니다.");
    const result=calculateTransportDraft(p,context.items,context.settings.data,stops,req.body.from??1);
    try{result.plan=(await reviewRun(c,who.poolId,result.plan,req.body.id)).plan;}
    catch(e){result.conflicts.push((e as Error).message);}
    const others=(await c.query(`SELECT id,plan FROM office_transport_runs WHERE pool_id=$1 AND id<>$2 AND plan->>'date'=$3
      AND status IN ('APPROVED','PUBLISHED','ACTIVE')`,[who.poolId,req.body.id??"",p.date])).rows;
    const ids=new Set(result.plan.steps.flatMap(s=>s.studentIds));
    for(const row of others){
      const other=row.plan as TransportRunPlan;
      if(p.returnBy<other.startTime||other.returnBy<p.startTime)continue;
      const overlap=other.steps.flatMap(s=>s.studentIds).filter(id=>ids.has(id));
      if(other.vehicleId===p.vehicleId||[other.driverId,other.escortId].filter(Boolean).some(id=>[p.driverId,p.escortId].includes(id))||overlap.length)
        result.conflicts.push(`운행 ${row.id}: 차량·담당자·회원 시간 중복 ${[...new Set(overlap)].join(",")}`);
    }
    result.complete=!result.unassigned.length&&!result.conflicts.length;
    return result;
  });
  route("post","/planning/interpret",true,false,async(req)=>{
    const input=text(req.body.text,"조건 설명",2000),proposal:Record<string,unknown>={};
    const date=input.match(/\d{4}-\d{2}-\d{2}/)?.[0];if(date)proposal.date=transportDate(date);
    const times=input.match(/\d{2}:\d{2}/g)??[];for(const s of times)transportMinute(s);
    if(times[0])proposal.startTime=times[0];if(times[1])proposal.returnBy=times[1];
    const count=input.match(/(\d{1,2})\s*명/);if(count)proposal.capacity=Number(count[1]);
    return {proposal,source:"LOCAL_RULE_INTERPRETER",modelCalled:false,unparsed:input,
      warning:"로컬 날짜·시간·인원 추출입니다. 실제 모델 해석·최적 경로가 아닙니다. 미해석 조건은 직접 확인하세요."};
  });
  route("get","/reconciliation",true,false,async(_req,c,who)=>({items:(await c.query(`SELECT o.*,CASE WHEN r.id IS NULL THEN 'PENDING' ELSE 'RESOLVED' END AS status,
    CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END AS resolution FROM office_transport_observations o
    LEFT JOIN office_transport_resolutions r ON r.observation_id=o.id WHERE o.pool_id=$1 ORDER BY o.created_at DESC LIMIT 200`,[who.poolId])).rows}));
  route("get","/notifications",true,false,async(_req,c,who)=>({items:(await c.query(`SELECT event_id,parent_id,student_id,state,attempts,last_error,attempted_at
    FROM office_transport_notification_intents WHERE pool_id=$1 ORDER BY created_at DESC LIMIT 200`,[who.poolId])).rows,
    dispatchEnabled:false,deviceDeliveryProven:false,warning:"승하차 저장·provider 접수·실기기 표시는 별개입니다. UNKNOWN/SENDING은 중복 방지를 위해 자동 재시도하지 않으며 SMS로 전환하지 않습니다."}));
  route("post","/observations",false,true,async(req,c,who)=>{
    const b=object(req.body),command=object(b.command),id=text(command.requestId,"원 요청 ID",36);
    const run=(await c.query("SELECT id FROM office_transport_runs WHERE id=$1 AND pool_id=$2",[b.runId,who.poolId])).rows[0];
    const version=(await c.query("SELECT plan FROM office_transport_run_versions WHERE run_id=$1 AND revision=$2 AND pool_id=$3",[b.runId,command.revision,who.poolId])).rows[0];
    if(!run||!version)transportFail("OBSERVATION_SCOPE","원 센터·확정 배차를 확인할 수 없습니다.");
    const membership=(await c.query(`SELECT id FROM office_transport_memberships WHERE pool_id=$1 AND principal_type=$2 AND principal_id=$3 AND id=ANY($4::text[])`,
      [who.poolId,who.type,who.id,[version.plan.driverId,version.plan.escortId].filter(Boolean)])).rows[0];
    if(!membership)throw new OperationError(403,"OBSERVATION_SCOPE","당시 본인 배정의 관측만 대조 요청할 수 있습니다.");
    if(!Number.isFinite(Date.parse(command.deviceAt)))transportFail("OBSERVATION","원 기기 확인 시각을 확인하세요.");
    const reason=text(b.reason,"충돌 사유",1000),old=(await c.query("SELECT * FROM office_transport_observations WHERE id=$1",[id])).rows[0];
    if(old&&(old.actor!==who.key||old.run_id!==run.id||digest(old.command)!==digest(command)))transportFail("REQUEST_CONFLICT","원 요청 ID에 다른 관측이 있습니다.");
    if(!old)await c.query(`INSERT INTO office_transport_observations(id,pool_id,run_id,actor,revision,command,plan,reason)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,[id,who.poolId,run.id,who.key,command.revision,JSON.stringify(command),JSON.stringify(version.plan),reason]);
    return {id,status:"PENDING",passengerEventCreated:false};
  });
  route("get","/observations/:id",false,false,async(req,c,who)=>{
    const row=(await c.query(`SELECT o.id,r.decision,r.reason,r.event_id,r.created_at FROM office_transport_observations o
      LEFT JOIN office_transport_resolutions r ON r.observation_id=o.id WHERE o.id=$1 AND o.pool_id=$2 AND o.actor=$3`,[req.params.id,who.poolId,who.key])).rows[0];
    if(!row)throw new OperationError(404,"NOT_FOUND","본인 관측 대조 요청이 없습니다.");
    return row;
  });
  route("post","/reconciliation/:id/resolve",true,true,async(req,c,who)=>{
    const b=object(req.body),reason=text(b.reason,"관리자 대조 사유",1000);
    if(!["LINK_EXISTING","RETAIN_OBSERVATION","ADOPT_ORIGINAL"].includes(b.decision))transportFail("RESOLUTION","동일 서버 기록 연결·검수한 원 관측 채택·미반영 보존을 선택하세요.");
    const o=(await c.query("SELECT * FROM office_transport_observations WHERE id=$1 AND pool_id=$2",[req.params.id,who.poolId])).rows[0];
    if(!o)transportFail("NOT_FOUND","현재 센터의 관측이 없습니다.");
    let eventId=null;
    if(b.decision==="LINK_EXISTING"){
      const e=(await c.query("SELECT * FROM office_transport_events WHERE request_id=$1 AND run_id=$2 AND pool_id=$3",[b.eventId,o.run_id,who.poolId])).rows[0];
      if(!e||e.request_id!==o.id||e.actor!==o.actor||digest(e.payload)!==digest(o.command))transportFail("EVENT_MISMATCH","동일 원 요청 ID·배차·처리자·내용의 서버 기록만 연결할 수 있습니다.");
      eventId=e.request_id;
    }
    if(b.decision==="ADOPT_ORIGINAL"){
      const run=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2 FOR UPDATE",[o.run_id,who.poolId])).rows[0];
      if(!run||!["PUBLISHED","ACTIVE"].includes(run.status))transportFail("CLOSED","진행 가능한 게시 운행에서만 원 관측을 채택할 수 있습니다.");
      const command=o.command as TransportCommand,original=o.plan as TransportRunPlan,current=run.plan as TransportRunPlan;
      if(original.date!==current.date||original.vehicleId!==current.vehicleId)transportFail("OBSERVATION_CONFLICT","원 운행일·차량과 달라 자동 반영할 수 없습니다. 관측을 보존하세요.");
      const events=await readRunEvents(c,run.id),state=transportState(current,events);
      if(command.stepId){
        const before=original.steps.find(s=>s.id===command.stepId),now=current.steps.find(s=>s.id===command.stepId);
        if(!before||!now||digest(before)!==digest(now))transportFail("OBSERVATION_CONFLICT","당시 정류장·대상·시각이 달라 원 관측을 새 배차로 변환하지 않습니다.");
      }
      if(command.kind==="FINISH"&&(state.pending.length||state.onboard.length))transportFail("SAFETY","현재 운행의 미처리·미하차를 먼저 해결하세요.");
      if(command.kind==="BOARD"&&(state.onboard.length+(command.studentIds?.length??0)>current.capacity))transportFail("CAPACITY","현재 구간 정원을 초과합니다.");
      if(command.kind==="ALIGHT"&&command.studentIds?.some(id=>state.children[id]?.status!=="ONBOARD"))transportFail("NOT_ONBOARD","현재 승차 기록과 원 하차 관측이 충돌합니다.");
      if(["BOARD","NO_SHOW"].includes(command.kind)&&command.studentIds?.some(id=>state.children[id]?.status!=="WAITING"))transportFail("ALREADY_CONFIRMED","이미 반영된 현재 회원 상태와 충돌합니다.");
      checkTransportCommand(original,events,command,o.actor,o.revision);
      // SAME original request id, actor, revision, clock and payload. Never manufacture a new boarding command.
      await c.query(`INSERT INTO office_transport_events(request_id,run_id,pool_id,revision,actor,payload,device_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[o.id,o.run_id,who.poolId,o.revision,o.actor,JSON.stringify(command),command.deviceAt]);
      eventId=o.id;
      if(["BOARD","ALIGHT","NO_SHOW"].includes(command.kind))await c.query(`INSERT INTO office_transport_notification_intents(event_id,parent_id,student_id,pool_id)
        SELECT $1,parent_id,student_id,swimming_pool_id FROM parent_students WHERE swimming_pool_id=$2 AND status='approved' AND transport_notify=true AND student_id=ANY($3::text[])
        ON CONFLICT DO NOTHING`,[o.id,who.poolId,command.studentIds]);
      if(command.kind==="CORRECT")await c.query("UPDATE office_transport_notification_intents SET state='VOIDED_BY_CORRECTION' WHERE event_id=$1 AND state='HELD_FOR_DISPATCH_APPROVAL'",[command.corrects]);
      if(command.kind==="START"||command.kind==="FINISH")await c.query("UPDATE office_transport_runs SET status=$2,updated_at=now() WHERE id=$1",[o.run_id,command.kind==="FINISH"?"CLOSED":"ACTIVE"]);
    }
    await c.query(`INSERT INTO office_transport_resolutions(id,observation_id,pool_id,decision,reason,event_id,resolved_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(),o.id,who.poolId,b.decision,reason,eventId,who.key]);
    return {id:o.id,status:"RESOLVED",decision:b.decision,originalEventAdopted:b.decision==="ADOPT_ORIGINAL",newRequestCreated:false};
  });
  route("get","/operations",true,false,async(req,c,who)=>({items:(await c.query(`SELECT id,kind,vehicle_id AS "vehicleId",data,created_at
    FROM office_transport_operations WHERE pool_id=$1 AND ($2='' OR vehicle_id=$2) ORDER BY created_at DESC LIMIT 500`,[who.poolId,typeof req.query.vehicleId==="string"?req.query.vehicleId:""])).rows,certifications:[]}));
  route("post","/operations",true,true,async(req,c,who)=>{
    const b=object(req.body),d=object(b.data);
    if(!["FUEL","MAINTENANCE","INSURANCE","INSPECTION"].includes(b.kind))transportFail("KIND","차량관리 이력 종류를 확인하세요.");
    const vehicle=(await c.query("SELECT id FROM office_transport_records WHERE id=$1 AND pool_id=$2 AND kind='vehicle'",[b.vehicleId,who.poolId])).rows[0];
    if(!vehicle)transportFail("VEHICLE","현재 센터 차량을 선택하세요.");
    transportDate(d.date);if(d.dueDate)transportDate(d.dueDate);
    if(!Number.isFinite(d.amount)||d.amount<0||!Number.isFinite(d.odometer)||d.odometer<0)transportFail("AMOUNT","금액·주행거리를 확인하세요.");
    const data={date:d.date,amount:d.amount,odometer:d.odometer,note:text(d.note,"기록 내용",1000),dueDate:d.dueDate||null,expenseId:d.expenseId||null};
    // An expense reference is informational only; this does not post duplicate accounting entries.
    const id=randomUUID();
    await c.query("INSERT INTO office_transport_operations(id,pool_id,vehicle_id,kind,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[id,who.poolId,vehicle.id,b.kind,JSON.stringify(data),who.key]);
    return {item:{id,kind:b.kind,vehicleId:vehicle.id,data}};
  });
  route("get","/runs/:id/document",true,false,async(req,c,who)=>{
    const run=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2",[req.params.id,who.poolId])).rows[0];
    if(!run)transportFail("NOT_FOUND","현재 센터 운행을 선택하세요.");
    const events=await readRunEvents(c,run.id);
    return {run,events,students:await transportContacts(c,who.poolId,run.plan),certifications:(await c.query("SELECT * FROM office_transport_certifications WHERE run_id=$1 AND pool_id=$2",[run.id,who.poolId])).rows,
      official:false,label:"비공식 업무용 운행 기록",hash:digest({plan:run.plan,events})};
  });
  route("post","/runs/:id/certify",true,true,async(req,c,who)=>{
    const b=object(req.body),run=(await c.query("SELECT * FROM office_transport_runs WHERE id=$1 AND pool_id=$2 FOR UPDATE",[req.params.id,who.poolId])).rows[0];
    if(!run||run.status!=="CLOSED"||run.revision!==b.expectedRevision||b.confirmed!==true)transportFail("CERTIFY","종료된 최신 운행을 검수하세요.");
    const events=await readRunEvents(c,run.id),state=transportState(run.plan,events);
    if(!state.closed||state.pending.length||state.onboard.length)transportFail("SAFETY","종료·미하차·미처리를 대조하세요.");
    const id=randomUUID(),hash=digest({plan:run.plan,events});
    await c.query(`INSERT INTO office_transport_certifications(id,pool_id,run_id,revision,content_hash,signature,reason,signed_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,who.poolId,run.id,run.revision,hash,text(b.signature,"확인 서명",100),text(b.reason,"검수 사유",1000),who.key]);
    return {id,hash,status:"CERTIFIED",official:false};
  });
}
