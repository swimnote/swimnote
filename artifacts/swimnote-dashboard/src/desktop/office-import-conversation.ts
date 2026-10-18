import {TARGETS,parseRuleText} from "./office-ops-lib";
export const FINANCE_COLUMNS=[
  ["student_id","회원 ID"],["kind","자료 구분"],["amount_krw","금액"],["remaining_count","잔여횟수"],
  ["contract_id","계약 ID"],["makeup_class_id","보강 반 ID"],["makeup_date","보강일"],["transaction_date","원 거래일"],
] as const;
const normalized=(s:string)=>s.replace(/[\s"'“”‘’]/g,"").toLowerCase();
const aliases:Record<string,string>={"회원이름":"name","학생이름":"name","보호자전화":"parent_phone","보호자연락처":"parent_phone",
  "학부모전화":"parent_phone","보호자성명":"parent_name","학생전화":"phone","휴대폰":"phone","반이름":"class_name",
  "잔여회차":"remaining_count","잔여횟수":"remaining_count","남은횟수":"remaining_count","원결제일":"transaction_date","보강날짜":"makeup_date"};
const identify=(value:string)=>{
  const t=normalized(value);
  return [...TARGETS,...FINANCE_COLUMNS].find(([k,l])=>normalized(k)===t||normalized(l)===t)?.[0]??aliases[t];
};
/** Bounded conversational grammar over exact headers. Never IDs/SQL/formulas or model emulation. */
export function importConversation(text:string,headers:string[],current:Record<string,string>,financial:Record<string,string>={}){
  const lines=text.split(/[\n;,]+/).map(s=>s.trim().replace(/[.!]$/,"")).filter(Boolean);
  if(!lines.length)return null;
  const next={...current},financeRules={...financial},issues:string[]=[];
  const changes:Array<{target:string;before:string;after:string}>=[];
  const touched=new Set<string>();
  for(const line of lines){
    if(/^(?:다음|추가)\s*파일에도?\s*(?:이|기존)?\s*규칙\s*(?:유지|적용)(?:해줘|해주세요)?$/.test(line))continue;
    const removal=/^(.+?)\s*(?:의\s*)?규칙(?:을|은|는)?\s*(?:취소|제거|삭제)(?:해줘|해주세요)?$/.exec(line);
    let target=removal?identify(removal[1]):undefined,source:string|undefined;
    if(!removal){
      const direct=parseRuleText(line,headers);
      if(direct){target=direct.target;source=direct.source;}
      else{
        const m=/^(.+?)(?:은|는|을|를|=)\s*(.+?)(?:\s*열)?(?:으로|로)\s*(?:사용|연결|매핑|변경|바꿔|써)(?:해줘|해주세요|줘|주세요)?$/.exec(line)
          ??/^(.+?)\s*=\s*(.+)$/.exec(line);
        if(m){target=identify(m[1]);source=headers.find(h=>normalized(h)===normalized(m[2]));}
      }
    }
    if(!target||(!removal&&!source)){issues.push(`${line}: 대상 항목 또는 정확한 원본 열을 선택하세요.`);continue;}
    if(touched.has(target)){issues.push(`${line}: 같은 항목의 중복·충돌 지시를 하나로 정리하세요.`);continue;}
    touched.add(target);
    const isFinance=FINANCE_COLUMNS.some(([k])=>k===target),map=isFinance?financeRules:next;
    changes.push({target:isFinance?`금융:${target}`:target,before:map[target]??"",after:source??""});
    if(removal)delete map[target];else map[target]=source!;
  }
  return {next,financeRules,changes,issues};
}
