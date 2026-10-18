import type {Pool} from "pg";
import OpenAI from "openai";
import {digest,OperationError} from "./office-operations-data.js";
import {calculateTransportDraft,type TransportCandidate,type TransportPlanningSettings} from "../../../../lib/api-zod/src/transport-planning.js";
import {transportMinute,type TransportRunPlan} from "@workspace/api-zod";
import {reviewRun} from "./transport-v2-store.js";
/** Supplied only by the operator's separately approved service configuration, NEVER from request JSON or ordinary paid-AI entitlements. */
export type TransportModelApproval={reference:string;poolId:string;expiresAt:number;model:string;maxCalls:number;maxTokens:number;
  maxInputTokens:number;inputUsdPerMillion:number;outputUsdPerMillion:number;maxTotalUsd:number};
export type TransportModelPort={approval:TransportModelApproval;complete?:(prompt:string)=>Promise<string>};
export function configuredTransportModel():TransportModelPort|undefined{
  const raw=process.env.TRANSPORT_MODEL_APPROVAL_JSON;
  if(!raw)return;
  try{
    const approval=JSON.parse(raw) as TransportModelApproval;
    if(!approval.reference||!approval.poolId||!approval.model||!Number.isFinite(approval.expiresAt)||approval.expiresAt<=Date.now()||
      !Number.isInteger(approval.maxCalls)||approval.maxCalls<1||!Number.isInteger(approval.maxTokens)||approval.maxTokens<1||approval.maxTokens>4096||
      !Number.isInteger(approval.maxInputTokens)||approval.maxInputTokens<1||
      ![approval.inputUsdPerMillion,approval.outputUsdPerMillion,approval.maxTotalUsd].every(v=>Number.isFinite(v)&&v>0)||
      approval.maxCalls*(approval.maxInputTokens*approval.inputUsdPerMillion+approval.maxTokens*approval.outputUsdPerMillion)/1e6>approval.maxTotalUsd)
      throw Error("INVALID_APPROVAL");
    return {approval};
  }catch{console.warn("[transport-model] invalid or expired operator approval; model disabled");return;}
}
export async function transportAiProposal(pool:Pool,port:TransportModelPort|undefined,who:{key:string;poolId:string},body:any,
  items:TransportCandidate[],settings:TransportPlanningSettings,stops:{id:string;name:string;address?:string}[]){
  const permit=port?.approval;
  const prompt=JSON.stringify({instruction:body.text,currentPlan:body.plan,
    constraints:items.map(x=>({studentId:x.studentId,enabled:x.enabled,windows:x.windows,issues:x.issues})),
    output:"JSON only {startTime?:HH:MM,returnBy?:HH:MM,capacity?:integer}. Interpret the instruction only. Never infer roads, coordinates, times or confirmations. Existing fixed steps must remain unchanged."});
  // Byte length is a conservative input-token upper bound plus framing; no paid tokenizer/request is required.
  const inputBound=Buffer.byteLength(prompt,"utf8")+256;
  if(!permit||permit.poolId!==who.poolId||!Number.isFinite(permit.expiresAt)||permit.expiresAt<=Date.now()||!permit.reference||!Number.isInteger(permit.maxCalls)||permit.maxCalls<1||
    !Number.isInteger(permit.maxTokens)||permit.maxTokens<1||permit.maxTokens>4096||!permit.model||
    !Number.isInteger(permit.maxInputTokens)||permit.maxInputTokens<inputBound||
    ![permit.inputUsdPerMillion,permit.outputUsdPerMillion,permit.maxTotalUsd].every(v=>Number.isFinite(v)&&v>0)||
    permit.maxCalls*(permit.maxInputTokens*permit.inputUsdPerMillion+permit.maxTokens*permit.outputUsdPerMillion)/1e6>permit.maxTotalUsd)
    throw new OperationError(403,"TRANSPORT_MODEL_APPROVAL_REQUIRED","새 차량용 모델·횟수·token·금액 승인 전입니다. 수동 편집·계산 초안은 사용할 수 있습니다.");
  const inputHash=digest(body),c=await pool.connect();
  try{
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`transport-ai:${who.poolId}:${permit.reference}`]);
    const old=(await c.query("SELECT * FROM office_transport_model_calls WHERE request_id=$1",[body.requestId])).rows[0];
    if(old){
      if(old.pool_id!==who.poolId||old.actor!==who.key||old.input_hash!==inputHash)throw new OperationError(409,"REQUEST_CONFLICT","다른 모델 요청에 사용된 ID입니다.");
      if(old.state!=="COMPLETED")throw new OperationError(409,"MODEL_RESULT_UNKNOWN","원 호출 결과 미확인/실패입니다. 새 유료 호출로 자동 재시도하지 않습니다.");
      await c.query("COMMIT");return old.result;
    }
    const used=Number((await c.query("SELECT count(*) AS n FROM office_transport_model_calls WHERE pool_id=$1 AND approval_reference=$2",[who.poolId,permit.reference])).rows[0].n);
    if(used>=permit.maxCalls)throw new OperationError(403,"MODEL_APPROVAL_EXHAUSTED","승인된 호출 횟수를 모두 사용했습니다.");
    await c.query(`INSERT INTO office_transport_model_calls(request_id,pool_id,actor,input_hash,approval_reference,model,max_tokens,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,'SENDING')`,[body.requestId,who.poolId,who.key,inputHash,permit.reference,permit.model,permit.maxTokens]);
    await c.query("COMMIT");
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  try{
    const raw=port!.complete?await port!.complete(prompt):(await new OpenAI({maxRetries:0,timeout:20000}).chat.completions.create({model:permit.model,max_completion_tokens:permit.maxTokens,
      response_format:{type:"json_object"},messages:[{role:"user",content:prompt}]})).choices[0]?.message?.content??"";
    const proposal=JSON.parse(raw),plan=structuredClone(body.plan) as TransportRunPlan;
    if(proposal.startTime!==undefined){transportMinute(proposal.startTime);plan.startTime=proposal.startTime;}
    if(proposal.returnBy!==undefined){transportMinute(proposal.returnBy);plan.returnBy=proposal.returnBy;}
    if(proposal.capacity!==undefined){
      // Vehicle capacity is a server-owned safety limit, never editable by a model.
      if(proposal.capacity!==plan.capacity)throw new OperationError(409,"MODEL_CAPACITY","모델이 차량 정원을 바꾸려 했습니다. 등록 정원으로 직접 검수하세요.");
    }
    const result={id:body.requestId,...calculateTransportDraft(plan,items,settings,stops,body.from??1),
      source:"MODEL_INTERPRETATION_WITH_DETERMINISTIC_DRAFT",modelCalled:true,model:permit.model,approvalReference:permit.reference};
    const checker=await pool.connect();
    try{result.plan=(await reviewRun(checker,who.poolId,result.plan,body.id)).plan;}
    catch(e){result.conflicts.push((e as Error).message);result.complete=false;}
    finally{checker.release();}
    await pool.query("UPDATE office_transport_model_calls SET state='COMPLETED',result=$2::jsonb WHERE request_id=$1 AND actor=$3",[body.requestId,JSON.stringify(result),who.key]);
    return result;
  }catch(e){
    await pool.query("UPDATE office_transport_model_calls SET state='FAILED_NO_RETRY',error=$2 WHERE request_id=$1",[body.requestId,"MODEL_OR_VALIDATION_FAILED_RESULT_NOT_RETRIED"]);
    throw e;
  }
}
