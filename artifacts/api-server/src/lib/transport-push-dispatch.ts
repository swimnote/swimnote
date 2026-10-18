import type {Pool} from "pg";
type Send=(parentId:string,title:string,body:string,data:Record<string,unknown>,key:string)=>Promise<boolean>;
export type TransportDispatchApproval={poolId:string;eventIds:string[];expiresAt:number;approvalReference:string};
/** The existing worker calls this adapter. Absent approval is a strict no-DB/no-provider path. */
export async function dispatchApprovedTransportIntents(){
  const raw=process.env.TRANSPORT_PUSH_APPROVAL_JSON;
  if(!raw)return {held:true,attempted:0};
  try{
    const approval=JSON.parse(raw) as TransportDispatchApproval;
    if(!approval.poolId||!approval.approvalReference||!Number.isFinite(approval.expiresAt)||approval.expiresAt<=Date.now()||!Array.isArray(approval.eventIds)||!approval.eventIds.length||approval.eventIds.length>100||
      !approval.eventIds.every(id=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))throw Error("INVALID_APPROVAL");
    const {pool}=await import("@workspace/db");
    return await dispatchTransportIntents(pool,approval);
  }catch{console.warn("[transport-dispatch] approval/result unavailable; held without automatic retry");return {held:true,attempted:0};}
}
/** Explicit operator approval is required; never installed as an automatic startup job.
 * SENDING is committed BEFORE contacting the existing dispatcher. An uncertain result is never auto-retried. */
export async function dispatchTransportIntents(pool:Pool,approval:TransportDispatchApproval|undefined,send?:Send){
  if(!approval||!Number.isFinite(approval.expiresAt)||approval.expiresAt<=Date.now()||!approval.approvalReference||!approval.eventIds.length)return {held:true,attempted:0};
  const c=await pool.connect(),work:any[]=[];
  try{
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[approval.poolId]);
    const rows=(await c.query(`SELECT i.*,e.payload,e.run_id FROM office_transport_notification_intents i JOIN office_transport_events e ON e.request_id=i.event_id
      WHERE i.pool_id=$1 AND i.event_id=ANY($2::uuid[]) AND i.state IN ('HELD_FOR_DISPATCH_APPROVAL','WAITING_FOR_TOKEN')
      FOR UPDATE OF i`,[approval.poolId,approval.eventIds])).rows;
    for(const row of rows){
      const eligible=(await c.query(`SELECT 1 FROM parent_students p JOIN parent_accounts a ON a.id=p.parent_id AND a.swimming_pool_id=p.swimming_pool_id
        JOIN students s ON s.id=p.student_id AND s.swimming_pool_id=p.swimming_pool_id AND s.deleted_at IS NULL
        WHERE p.parent_id=$1 AND p.student_id=$2 AND p.swimming_pool_id=$3 AND p.status='approved' AND p.transport_notify=true
        AND a.withdrawal_requested_at IS NULL AND a.is_active=true AND NOT EXISTS(SELECT 1 FROM office_transport_events x WHERE x.run_id=$4 AND x.payload->>'corrects'=$5)`,
        [row.parent_id,row.student_id,approval.poolId,row.run_id,row.event_id])).rows.length>0;
      const tokens=eligible?(await c.query("SELECT 1 FROM push_tokens WHERE parent_account_id=$1 AND token IS NOT NULL AND token<>'' LIMIT 1",[row.parent_id])).rows.length>0:false;
      const state=!eligible?"SKIPPED_PREFERENCE_OR_RELATION":!tokens?"WAITING_FOR_TOKEN":"SENDING";
      const key=`transport:${row.event_id}:${row.parent_id}:${row.student_id}`;
      await c.query(`UPDATE office_transport_notification_intents SET state=$4,dispatch_key=$5,attempted_at=now(),
        attempts=attempts+CASE WHEN $4='SENDING' THEN 1 ELSE 0 END WHERE event_id=$1 AND parent_id=$2 AND student_id=$3`,
        [row.event_id,row.parent_id,row.student_id,state,key]);
      if(state==="SENDING")work.push({...row,key});
    }
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  const sender=send??(async(parentId,title,body,data,key)=>{
    const {sendPushToUserWithResult}=await import("./push-service.js");
    return sendPushToUserWithResult(parentId,true,"transport",title,body,data,key,{singleAttempt:true,ttl:300});
  });
  for(const row of work){
    let accepted=false,error:string|null=null;
    // Recheck late opt-outs/revocations/corrections immediately before contacting a provider.
    const stillEligible=(await pool.query(`SELECT 1 FROM parent_students p JOIN parent_accounts a ON a.id=p.parent_id
      WHERE p.swimming_pool_id=$1 AND p.parent_id=$2 AND p.student_id=$3 AND p.status='approved' AND p.transport_notify=true
      AND a.is_active=true AND a.withdrawal_requested_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM office_transport_events WHERE run_id=$4 AND payload->>'corrects'=$5)`,
      [row.pool_id,row.parent_id,row.student_id,row.run_id,row.event_id])).rows.length>0;
    if(!stillEligible){await pool.query("UPDATE office_transport_notification_intents SET state='SKIPPED_PREFERENCE_OR_RELATION' WHERE dispatch_key=$1",[row.key]);continue;}
    try{accepted=await sender(row.parent_id,"자녀 차량 확인","차량 승하차 기록이 반영됐습니다. 앱에서 자기 자녀 기록을 확인하세요.",
      {type:"transport",eventId:row.event_id,studentId:row.student_id},row.key);}
    catch{error="DISPATCH_RESULT_UNKNOWN";}
    // False may include a network timeout; fail closed rather than risk duplicate notifications.
    await pool.query(`UPDATE office_transport_notification_intents SET state=$4,last_error=$5
      WHERE event_id=$1 AND parent_id=$2 AND student_id=$3 AND state='SENDING'`,
      [row.event_id,row.parent_id,row.student_id,accepted?"PROVIDER_ACCEPTED":"DELIVERY_UNKNOWN",error??(accepted?null:"PROVIDER_REJECTED_OR_UNKNOWN")]);
  }
  return {held:false,attempted:work.length,deviceDisplayed:false};
}
