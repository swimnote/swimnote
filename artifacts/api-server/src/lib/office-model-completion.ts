import {AI_MODEL} from "../config/ai-model-config.js";
import {OperationError} from "./office-operations-data.js";
export type OfficeModelPurpose="fields"|"mapping"|"complex-document";
export const OFFICE_MODEL_LIMIT={inputBytes:20000,inputTokensUpperBound:20128,outputTokens:1200,maxMessages:4} as const;
export function officeModelPurpose(resource:unknown,instruction:string,explicit?:unknown):OfficeModelPurpose{
  if(explicit!==undefined&&explicit!=="simple"&&explicit!=="complex")throw new OperationError(400,"INVALID_COMPLEXITY","문서 해석 범위를 확인하세요.");
  if(explicit==="complex"&&resource!=="templates")throw new OperationError(400,"INVALID_COMPLEXITY","큰 모델 경로는 복합 문서에만 제공합니다.");
  return resource==="templates"&&(explicit==="complex"||/조항.*(?:충돌|상충|대조)|복합\s*(?:계획|문서)|(?:여러|복수)\s*문서.*(?:비교|대조)/.test(instruction))?"complex-document":"fields";
}
/** Static routing, never an extra routing-model call or population-based upgrade. */
export function officeModelChoice(purpose:OfficeModelPurpose,env:Record<string,string|undefined>){
  if(purpose==="complex-document"){
    if(env.OFFICE_COMPLEX_AI_ENABLED!=="true")throw new OperationError(503,"COMPLEX_MODEL_NOT_ENABLED","복합 문서 해석은 큰 모델의 별도 실행 승인이 필요합니다. 자동 승급·작은 모델 대체 호출을 하지 않았습니다.");
    return AI_MODEL.OFFICE_COMPLEX;
  }
  return AI_MODEL.OFFICE_SIMPLE;
}
export function checkOfficeModelInput(messages:Array<{role:string;content:string}>){
  if(!Array.isArray(messages)||!messages.length||messages.some(m=>!m||!["system","user"].includes(m.role)||typeof m.content!=="string"))
    throw new OperationError(400,"INVALID_MODEL_INPUT","고정 system/user 텍스트 메시지만 허용합니다.");
  if(messages.length>OFFICE_MODEL_LIMIT.maxMessages||Buffer.byteLength(JSON.stringify(messages),"utf8")>OFFICE_MODEL_LIMIT.inputBytes)
    throw new OperationError(413,"MODEL_INPUT_LIMIT","입력 상한을 넘었습니다. 자동 분할·상위 모델 승급·재시도하지 않습니다.");
}
export async function completeOfficeModel(messages:Array<{role:"system"|"user";content:string}>,purpose:OfficeModelPurpose="fields"){
  const model=officeModelChoice(purpose,process.env);checkOfficeModelInput(messages);
  const {getOpenAI}=await import("../routes/ai.js");
  const response=await getOpenAI().chat.completions.create({model,response_format:{type:"json_object"},
    temperature:0,max_tokens:OFFICE_MODEL_LIMIT.outputTokens,messages},{maxRetries:0,timeout:12000});
  if(response.choices[0]?.finish_reason!=="stop")throw new OperationError(502,"MODEL_INCOMPLETE","초안이 잘렸습니다. 자동 재시도하지 않습니다.");
  return response.choices[0]?.message.content??"";
}
