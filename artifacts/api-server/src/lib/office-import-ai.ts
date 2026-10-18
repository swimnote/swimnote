import { OperationError } from "./office-operations-data.js";
import {financialTargets} from "./office-finance-import.js";
/** Free import-model activation is separate from the existing paid workspace switch. */
export function importModelEnabled(env:Record<string,string|undefined>) {
  return env.OFFICE_IMPORT_AI_ENABLED==="true";
}
export function assertImportInstruction(instruction:string){
  if(!/열|컬럼|매핑|규칙|변환|보호자|전화|연락처|이름|생년|미납|수납|금액|잔여|횟수|보강|거래일/.test(instruction)||
    /SQL|https?:\/\/|tool_calls|fetch\s*\(|(?:발송|결제|환불|청구|서명).*(?:실행|계산|승인)|일지.*작성|공지.*작성/i.test(instruction))
    throw new OperationError(400,"IMPORT_MAPPING_ONLY","무료 이전은 원본 열의 변환 규칙 해석만 지원합니다. 일반 AI 업무·계산·발송·SQL은 실행하지 않습니다.");
}

/** Model can propose mappings only. It cannot select an actor, call tools or apply data. */
export function parseImportRules(raw:string,headers:string[]) {
  let value:any;
  try { value=JSON.parse(raw); } catch { throw new OperationError(502,"INVALID_MODEL_RESULT","열 해석 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다."); }
  const allowed=new Set(["name","parent_phone","parent_name","phone","birth_year","memo","class_name","class_group_id"]);
  if(!value || !value.rules || typeof value.rules!=="object" || Array.isArray(value.rules))
    throw new OperationError(502,"INVALID_MODEL_RESULT","열 매핑 형식 오류");
  if(Object.keys(value).some(k=>!["rules","financeRules","question"].includes(k)))
    throw new OperationError(502,"INVALID_MODEL_RESULT","이전은 열 매핑 제안만 허용합니다. 도구·SQL·업무 실행 응답은 사용할 수 없습니다.");
  const rules:Record<string,string>={};
  for(const [key,column] of Object.entries(value.rules)) {
    if(!allowed.has(key) || typeof column!=="string" || !headers.includes(column))
      throw new OperationError(502,"INVALID_MODEL_RESULT","지원하지 않는 열 또는 도구 요청입니다.");
    rules[key]=column;
  }
  const financeRules:Record<string,string>={};
  if(value.financeRules!==undefined) {
    if(!value.financeRules||typeof value.financeRules!=="object"||Array.isArray(value.financeRules)) throw new OperationError(502,"INVALID_MODEL_RESULT","이전 금융 매핑 형식 오류");
    for(const [key,column] of Object.entries(value.financeRules)) {
      if(!(financialTargets as readonly string[]).includes(key)||typeof column!=="string"||!headers.includes(column))
        throw new OperationError(502,"INVALID_MODEL_RESULT","지원하지 않는 금융 열입니다.");
      financeRules[key]=column;
    }
  }
  return {kind:"rules",rules,question:typeof value.question==="string"?value.question.slice(0,500):"",...(Object.keys(financeRules).length?{financeRules}:{})};
}
