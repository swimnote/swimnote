import type {PoolClient} from "pg";
import type {AuthRequest} from "../middlewares/auth.js";
import type {TransportIdentity} from "../lib/transport-v2-store.js";
import {transportFail} from "../lib/transport-v2-store.js";
import {object,text} from "../lib/office-operations-data.js";
import {transportMinute} from "@workspace/api-zod";
export type TransportRoute=(method:"get"|"post",path:string,admin:boolean,write:boolean,
  fn:(req:AuthRequest,c:PoolClient,who:TransportIdentity)=>Promise<any>)=>void;
export function transportDate(raw:unknown){
  const s=text(raw,"운행 날짜",10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(`${s}T00:00:00Z`))||new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)!==s)transportFail("DATE","유효한 날짜를 확인하세요.");
  return s;
}
function days(raw:unknown):number[]{
  if(!Array.isArray(raw)||!raw.length||raw.some(n=>!Number.isInteger(n)||n<1||n>7)||new Set(raw).size!==raw.length)transportFail("WEEKDAY","요일을 월=1~일=7로 중복 없이 선택하세요.");
  return raw as number[];
}
export function attachTransportPreparation(route:TransportRoute){
  route("get","/students",true,false,async(req,c,who)=>{
    const search=text(req.query.search,"회원 검색어",80);
    const rows=(await c.query("SELECT id,name FROM students WHERE swimming_pool_id=$1 AND status='active' AND (id=$2 OR name ILIKE $3) ORDER BY name,id LIMIT 51",[who.poolId,search,`%${search.replace(/[%_\\]/g,"\\$&")}%`])).rows;
    return {items:rows.slice(0,50),truncated:rows.length>50};
  });
  route("post","/preferences/:id",true,true,async(req,c,who)=>{
    const b=object(req.body),d=object(b.data),from=transportDate(d.from),to=transportDate(d.to);
    if(from>to||typeof d.enabled!=="boolean")transportFail("PREFERENCE","이용 여부·적용 기간을 확인하세요.");
    const student=(await c.query("SELECT id FROM students WHERE id=$1 AND swimming_pool_id=$2 AND status='active'",[req.params.id,who.poolId])).rows[0];
    if(!student)transportFail("STUDENT","현재 센터의 회원을 선택하세요.");
    const data={enabled:d.enabled,from,to,weekdays:days(d.weekdays),inboundStopId:d.inboundStopId?text(d.inboundStopId,"등원 정류장",160):"",
      outboundStopId:d.outboundStopId?text(d.outboundStopId,"귀가 정류장",160):"",handover:d.handover?text(d.handover,"인계 조건",500):"",
      exceptions:[] as {date:string;enabled:boolean;inboundStopId:string;outboundStopId:string}[]};
    if(!Array.isArray(d.exceptions)||d.exceptions.length>60)transportFail("PREFERENCE","임시 이용 변경을 최대 60일로 확인하세요.");
    for(const raw of d.exceptions){const e=object(raw);if(typeof e.enabled!=="boolean")transportFail("PREFERENCE","임시 이용 여부를 확인하세요.");
      data.exceptions.push({date:transportDate(e.date),enabled:e.enabled,inboundStopId:e.inboundStopId?text(e.inboundStopId,"임시 등원 정류장",160):"",outboundStopId:e.outboundStopId?text(e.outboundStopId,"임시 귀가 정류장",160):""});}
    if(new Set(data.exceptions.map(x=>x.date)).size!==data.exceptions.length)transportFail("PREFERENCE","같은 날짜의 임시 변경이 중복됐습니다.");
    const stopIds=[data.inboundStopId,data.outboundStopId,...data.exceptions.flatMap(e=>[e.inboundStopId,e.outboundStopId])].filter(Boolean);
    const stops=(await c.query("SELECT id FROM office_transport_records WHERE pool_id=$1 AND kind='stop' AND data->>'status'='active' AND id=ANY($2::text[])",[who.poolId,stopIds])).rows;
    if(stopIds.some(id=>!stops.some(s=>s.id===id)))transportFail("STOP","현재 센터의 사용 정류장만 지정하세요.");
    const old=(await c.query("SELECT revision FROM office_transport_preferences WHERE pool_id=$1 AND student_id=$2 FOR UPDATE",[who.poolId,req.params.id])).rows[0];
    if((old?.revision??0)!==b.expectedRevision)transportFail("VERSION_CHANGED","회원 이용 설정이 바뀌었습니다. 다시 조회하세요.");
    await c.query(`INSERT INTO office_transport_preferences(pool_id,student_id,data,updated_by) VALUES($1,$2,$3::jsonb,$4)
      ON CONFLICT(pool_id,student_id) DO UPDATE SET data=excluded.data,updated_by=excluded.updated_by,revision=office_transport_preferences.revision+1,updated_at=now()`,
      [who.poolId,req.params.id,JSON.stringify(data),who.key]);
    return {studentId:req.params.id,revision:(old?.revision??0)+1,data,postedRunsChanged:false};
  });
  route("post","/vehicles/:id/availability",true,true,async(req,c,who)=>{
    const d=object(req.body.data),start=text(d.start,"가용 시작",5),end=text(d.end,"가용 종료",5);
    if(transportMinute(start)>=transportMinute(end))transportFail("WINDOW","운행 가능 시간 순서를 확인하세요.");
    const vehicle=(await c.query("SELECT id FROM office_transport_records WHERE id=$1 AND pool_id=$2 AND kind='vehicle'",[req.params.id,who.poolId])).rows[0];
    if(!vehicle)transportFail("VEHICLE","현재 센터의 차량이 아닙니다.");
    const old=(await c.query("SELECT revision FROM office_transport_vehicle_availability WHERE pool_id=$1 AND vehicle_id=$2 FOR UPDATE",[who.poolId,req.params.id])).rows[0];
    if((old?.revision??0)!==req.body.expectedRevision)transportFail("VERSION_CHANGED","차량 가용 시간이 바뀌었습니다.");
    const data={start,end,weekdays:days(d.weekdays)};
    await c.query(`INSERT INTO office_transport_vehicle_availability(pool_id,vehicle_id,data,updated_by) VALUES($1,$2,$3::jsonb,$4)
      ON CONFLICT(pool_id,vehicle_id) DO UPDATE SET data=excluded.data,updated_by=excluded.updated_by,revision=office_transport_vehicle_availability.revision+1,updated_at=now()`,[who.poolId,req.params.id,JSON.stringify(data),who.key]);
    return {vehicleId:req.params.id,revision:(old?.revision??0)+1,data};
  });
  route("get","/candidates",true,false,async(req,c,who)=>{
    const date=transportDate(req.query.date),weekday=new Date(`${date}T00:00:00Z`).getUTCDay()||7;
    const rows=(await c.query(`SELECT p.student_id,s.name,p.data,
      EXISTS(SELECT 1 FROM student_class_history h WHERE h.student_id=s.id AND h.swimming_pool_id=$1 AND h.enrolled_at::date<=$2::date AND (h.left_at IS NULL OR h.left_at::date>$2::date)) AS enrolled,
      EXISTS(SELECT 1 FROM makeup_sessions m WHERE m.student_id=s.id AND m.swimming_pool_id=$1 AND m.assigned_date=$2 AND m.assigned_class_group_id IS NOT NULL AND m.cancelled_at IS NULL AND m.status NOT IN ('cancelled','expired','extinguished')) AS makeup,
      EXISTS(SELECT 1 FROM attendance a JOIN users u ON u.id=COALESCE(a.modified_by,a.created_by) AND u.swimming_pool_id=a.swimming_pool_id
        WHERE a.student_id=s.id AND a.swimming_pool_id=$1 AND a.date=$2 AND a.status='absent') AS explicit_absence
      FROM office_transport_preferences p JOIN students s ON s.id=p.student_id AND s.swimming_pool_id=p.pool_id AND s.status='active' WHERE p.pool_id=$1 ORDER BY s.id`,[who.poolId,date])).rows;
    return {date,items:rows.map(row=>{
      const d=row.data,exception=d.exceptions.find((e:any)=>e.date===date);
      const regular=d.enabled&&d.from<=date&&d.to>=date&&d.weekdays.includes(weekday);
      const enabled=(exception?exception.enabled:regular)&&!row.explicit_absence&&(row.enrolled||row.makeup);
      return {studentId:row.student_id,name:row.name,enabled,inboundStopId:exception?.inboundStopId||d.inboundStopId,
        outboundStopId:exception?.outboundStopId||d.outboundStopId,handover:d.handover,enrolled:row.enrolled,makeup:row.makeup,
        explicitAbsence:row.explicit_absence,temporary:!!exception};
    }),postedRunsChanged:false,warnings:["요일별 실제 수업 시각·미래 휴강은 관리자가 확인하세요. 보강이 정기 이용 설정의 요일 밖이면 당일 임시 이용을 명시하세요.","보호자 연락처는 회원정보를 참조하며 이용 설정에 복제하지 않습니다."]};
  });
}
