import { OperationError } from "./office-operations-data.js";
/** Free import-model activation is separate from the existing paid workspace switch. */
export function importModelEnabled(env:Record<string,string|undefined>) {
  return env.OFFICE_IMPORT_AI_ENABLED==="true";
}

/** Model can propose mappings only. It cannot select an actor, call tools or apply data. */
export function parseImportRules(raw:string,headers:string[]) {
  let value:any;
  try { value=JSON.parse(raw); } catch { throw new OperationError(502,"INVALID_MODEL_RESULT","열 해석 결과를 확인하지 못했습니다. 자동 재시도하지 않습니다."); }
  const allowed=new Set(["name","parent_phone","parent_name","phone","birth_year","memo","class_name","class_group_id"]);
  if(!value || !value.rules || typeof value.rules!=="object" || Array.isArray(value.rules))
    throw new OperationError(502,"INVALID_MODEL_RESULT","열 매핑 형식 오류");
  const rules:Record<string,string>={};
  for(const [key,column] of Object.entries(value.rules)) {
    if(!allowed.has(key) || typeof column!=="string" || !headers.includes(column))
      throw new OperationError(502,"INVALID_MODEL_RESULT","지원하지 않는 열 또는 도구 요청입니다.");
    rules[key]=column;
  }
  return {kind:"rules",rules,question:typeof value.question==="string"?value.question.slice(0,500):""};
}
