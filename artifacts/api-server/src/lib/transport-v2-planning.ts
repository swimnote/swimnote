import type {PoolClient} from "pg";
import {emptyTransportSettings,transportClock,type TransportPlanningSettings,type TransportCandidate} from "../../../../lib/api-zod/src/transport-planning.js";
import {transportMinute} from "@workspace/api-zod";
export async function loadTransportPlanning(c:PoolClient,poolId:string,date:string){
  const stored=(await c.query("SELECT revision,data FROM office_transport_settings WHERE pool_id=$1",[poolId])).rows[0];
  const data:TransportPlanningSettings=stored?.data??emptyTransportSettings();
  const classes=(await c.query("SELECT id,name,schedule_days,schedule_time,is_one_time,one_time_date FROM class_groups WHERE swimming_pool_id=$1 AND is_deleted=false",[poolId])).rows;
  const holiday=(await c.query("SELECT 1 FROM pool_holidays WHERE pool_id=$1 AND holiday_date=$2::date LIMIT 1",[poolId,date])).rows.length>0;
  const histories=(await c.query(`SELECT h.student_id,h.class_group_id FROM student_class_history h
    WHERE h.swimming_pool_id=$1 AND h.enrolled_at::date<=$2::date AND (h.left_at IS NULL OR h.left_at::date>$2::date)`,[poolId,date])).rows;
  const makeups=(await c.query(`SELECT student_id,assigned_class_group_id AS class_group_id FROM makeup_sessions WHERE swimming_pool_id=$1
    AND assigned_date=$2 AND assigned_class_group_id IS NOT NULL AND cancelled_at IS NULL AND status NOT IN ('cancelled','expired','extinguished')`,[poolId,date])).rows;
  const absences=(await c.query(`SELECT DISTINCT a.student_id,a.class_group_id FROM attendance a
    JOIN users u ON u.id=COALESCE(a.modified_by,a.created_by) AND u.swimming_pool_id=a.swimming_pool_id
    WHERE a.swimming_pool_id=$1 AND a.date=$2 AND a.status='absent'`,[poolId,date])).rows;
  const prefs=(await c.query(`SELECT p.student_id,s.name,p.data FROM office_transport_preferences p JOIN students s
    ON s.id=p.student_id AND s.swimming_pool_id=p.pool_id WHERE p.pool_id=$1 AND s.deleted_at IS NULL
    AND s.status IN ('active','pending_parent_link','unregistered')`,[poolId])).rows;
  const day=new Date(`${date}T12:00:00Z`).getUTCDay(),ko="일월화수목금토"[day],iso=day||7;
  const items:TransportCandidate[]=prefs.map(row=>{
    const pref=row.data,exception=pref.exceptions.find((x:any)=>x.date===date);
    const enabled=exception?exception.enabled:pref.enabled&&pref.from<=date&&pref.to>=date&&pref.weekdays.includes(iso);
    const issues:string[]=[],windows:TransportCandidate["windows"]=[];
    const memberships=[...histories.filter(h=>h.student_id===row.student_id).map(h=>({...h,makeup:false})),
      ...makeups.filter(h=>h.student_id===row.student_id).map(h=>({...h,makeup:true}))];
    for(const membership of memberships){
      const cg=classes.find(x=>x.id===membership.class_group_id);if(!cg)continue;
      const override=data.overrides.find(x=>x.classId===cg.id&&x.date===date);
      if(holiday||override?.cancelled)continue;
      if(!membership.makeup&&!override&&!(cg.is_one_time?cg.one_time_date===date:String(cg.schedule_days).includes(ko)))continue;
      if(absences.some(x=>x.student_id===row.student_id&&x.class_group_id===cg.id))continue;
      const times=String(cg.schedule_time).match(/\d{1,2}:\d{2}/g)??[];
      const normalize=(s:string)=>s.padStart(5,"0");
      try{
        const start=override?.start??(times[0]?normalize(times[0]):"");
        const startMinute=transportMinute(start);
        const end=override?.end??(times[1]?normalize(times[1]):data.durations[cg.id]?transportClock(startMinute+data.durations[cg.id]):"");
        if(transportMinute(end)<=startMinute)throw Error();
        windows.push({classId:cg.id,start,end,source:override?"ADMIN_DATED_OVERRIDE":membership.makeup?"ASSIGNED_MAKEUP":"CLASS_HISTORY_SCHEDULE"});
      }catch{issues.push(`${cg.name}: 실제 시작/종료 시각 보완 필요`);}
    }
    if(enabled&&!windows.length)issues.push(holiday?"센터 휴무일":"실제 수업 요일·미래 수강·보강·결석 확인 필요");
    return {studentId:row.student_id,name:row.name,enabled,inboundStopId:exception?.inboundStopId||pref.inboundStopId,
      outboundStopId:exception?.outboundStopId||pref.outboundStopId,handover:pref.handover,windows,issues};
  });
  return {date,settings:{revision:stored?.revision??0,data},classes,items,warnings:["등록 수업·휴무와 날짜별 관리자 변경 근거. 주소/이동시간 누락은 자동 추정하지 않습니다."]};
}
