import {createHmac,createHash,randomUUID,randomBytes} from "node:crypto";
import type {Pool} from "pg";
import {OperationError,text} from "./office-operations-data.js";
import {hashPassword} from "./auth.js";
import type {TransportRoute} from "../routes/transport-v2-preparation.js";
export const transportInviteHash=(s:string)=>createHash("sha256").update(s).digest("hex");
function phoneHash(raw:string){
  const phone=String(raw).replace(/\D/g,""),secret=process.env.JWT_SECRET;
  if(!secret)throw new OperationError(503,"SECRET_REQUIRED","초대 보호 설정이 필요합니다.");
  if(!/^01[016789]\d{7,8}$/.test(phone))throw new OperationError(400,"PHONE","휴대전화 번호를 확인하세요.");
  return createHmac("sha256",secret).update(`transport-invite:${phone}`).digest("hex");
}
/** Reuses the existing parent-account identity carrier and verified OTP, but NEVER links children or grants parent/teacher/admin permissions. */
export async function registerTransportCarrier(pool:Pool,b:any){
  const {claimParentPhoneProof,verifyParentPhoneProof}=await import("./parent-phone-proof.js");
  const name=text(b.parent_name,"이름",100),phone=String(b.phone??"").replace(/\D/g,""),poolId=text(b.pool_id,"센터",160);
  if(!verifyParentPhoneProof(b.phone_proof,phone))throw new OperationError(403,"parent_phone_proof_required","실제 휴대폰 소유 인증이 필요합니다.");
  const password=text(b.password,"비밀번호",128);
  if(password.length<8)throw new OperationError(400,"PASSWORD","기사 가입 비밀번호는 8자 이상이어야 합니다.");
  const inviteHash=transportInviteHash(text(b.transport_invite,"센터 초대 코드",100));
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    if(!(await c.query("SELECT to_regclass('office_transport_join_invites') IS NOT NULL AS ready")).rows[0]?.ready)
      throw new OperationError(503,"TRANSPORT_V2_MIGRATION_REQUIRED","차량 신규 가입 운영 적용 승인 전입니다.");
    const invite=(await c.query(`SELECT * FROM office_transport_join_invites WHERE token_hash=$1 AND pool_id=$2 AND expires_at>now()
      AND accepted_by IS NULL FOR UPDATE`,[inviteHash,poolId])).rows[0];
    if(!invite||invite.phone_hash!==phoneHash(phone))throw new OperationError(403,"INVITE_SCOPE","본인 전화·센터에 유효한 초대가 아닙니다.");
    const active=(await c.query("SELECT id FROM swimming_pools WHERE id=$1 AND deactivated_at IS NULL",[poolId])).rows[0];
    if(!active)throw new OperationError(403,"POOL","사용 중인 센터의 초대가 아닙니다.");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[poolId]);
    const exists=(await c.query("SELECT id FROM parent_accounts WHERE swimming_pool_id=$1 AND regexp_replace(phone,'[^0-9]','','g')=$2",[poolId,phone])).rows[0];
    if(exists)throw new OperationError(409,"EXISTING_ACCOUNT","기존 계정으로 로그인한 후 차량 초대를 수락하세요.");
    const id=`pa_transport_${randomUUID()}`;
    if(!await claimParentPhoneProof(b.phone_proof,phone,id))throw new OperationError(403,"parent_phone_proof_invalid_or_used","휴대전화 인증을 다시 진행하세요.");
    await c.query(`INSERT INTO parent_accounts(id,swimming_pool_id,phone,pin_hash,name,login_id,is_active,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,true,now(),now())`,[id,poolId,phone,await hashPassword(password),name,text(b.loginId,"로그인 ID",100)]);
    await c.query(`INSERT INTO office_transport_memberships(id,pool_id,principal_type,principal_id,name,duty,status,accepted_at,invited_by)
      VALUES($1,$2,'parent_accounts',$3,$4,$5,'ACTIVE',now(),$6)`,[randomUUID(),poolId,id,name,invite.duty,invite.created_by]);
    await c.query("UPDATE office_transport_join_invites SET accepted_by=$2 WHERE id=$1",[invite.id,id]);
    await c.query("COMMIT");
    return {id,name,phone,swimming_pool_id:poolId};
  }catch(e){await c.query("ROLLBACK");if((e as any).code==="23505")throw new OperationError(409,"EXISTING_ACCOUNT","기존 계정 또는 로그인 ID가 있습니다. 기존 계정으로 로그인해 초대를 수락하세요.");throw e;}finally{c.release();}
}
export function attachTransportOnboarding(route:TransportRoute){
  route("post","/onboarding/invites",true,true,async(req,c,who)=>{
    const b=req.body;
    if(!["DRIVER","ESCORT"].includes(b.duty)||b.confirmed!==true)throw new OperationError(400,"INVITE","운행 전용 초대를 확인하세요.");
    const code=randomBytes(32).toString("hex"),id=randomUUID();
    await c.query(`INSERT INTO office_transport_join_invites(id,pool_id,token_hash,phone_hash,duty,expires_at,created_by)
      VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6)`,[id,who.poolId,transportInviteHash(code),phoneHash(b.phone),b.duty,who.key]);
    return {id,inviteCode:code,sent:false};
  });
  route("post","/onboarding/accept",false,true,async(req,c,who)=>{
    const {isParentPhoneVerified}=await import("./parent-phone-proof.js");
    const code=text(req.body.inviteCode,"본인 초대 코드",100);
    // Existing explicit account-id invitations retain their previous acceptance path.
    const old=(await c.query(`UPDATE office_transport_memberships SET status='ACTIVE',accepted_at=now(),invite_hash=NULL
      WHERE invite_hash=$1 AND principal_type=$2 AND principal_id=$3 AND pool_id=$4 AND status='INVITED' AND expires_at>now() RETURNING id,duty`,
      [transportInviteHash(code),who.type,who.id,who.poolId])).rows[0];
    if(old)return {item:old,status:"ACTIVE"};
    if(who.type!=="parent_accounts")throw new OperationError(403,"INVITE","직원 계정은 관리자가 기존 계정 지정 초대를 사용하세요.");
    const principal=(await c.query("SELECT phone FROM parent_accounts WHERE id=$1 AND swimming_pool_id=$2",[who.id,who.poolId])).rows[0];
    const invite=(await c.query("SELECT * FROM office_transport_join_invites WHERE token_hash=$1 AND pool_id=$2 AND expires_at>now() AND accepted_by IS NULL FOR UPDATE",[transportInviteHash(code),who.poolId])).rows[0];
    if(!invite||invite.phone_hash!==phoneHash(principal?.phone)||!await isParentPhoneVerified(who.id,principal.phone))
      throw new OperationError(403,"INVITE_SCOPE","실제 인증된 본인 전화·센터 초대만 수락하세요.");
    const id=randomUUID();
    await c.query(`INSERT INTO office_transport_memberships(id,pool_id,principal_type,principal_id,name,duty,status,accepted_at,invited_by)
      VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',now(),$7)`,[id,who.poolId,who.type,who.id,who.name,invite.duty,invite.created_by]);
    await c.query("UPDATE office_transport_join_invites SET accepted_by=$2 WHERE id=$1",[invite.id,who.key]);
    return {item:{id,duty:invite.duty},status:"ACTIVE"};
  });
}
