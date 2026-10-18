import {it,expect} from "vitest";
import {parseImportRules,importModelEnabled,assertImportInstruction} from "../office-import-ai.js";
it("defaults semantic import execution OFF and accepts only exact source column proposals",()=>{
  expect(importModelEnabled({})).toBe(false);
  expect(parseImportRules(JSON.stringify({rules:{name:"성명"},financeRules:{remaining_count:"잔여"},question:""}),["성명","잔여"]))
    .toMatchObject({kind:"rules",rules:{name:"성명"},financeRules:{remaining_count:"잔여"}});
});
it("does not expose the free mapping interpreter as a general paid assistant or financial calculator",()=>{
  expect(()=>assertImportInstruction("보호자 연락처 열의 의미를 변환 규칙으로 제안해줘")).not.toThrow();
  for(const text of ["오늘 일지를 작성해줘","환불 금액을 계산하고 승인해줘","SQL로 회원 이름 조회","내일 날씨 알려줘"])
    expect(()=>assertImportInstruction(text)).toThrow();
});
it("rejects SQL, general business tools, invented columns, identities and extra instructions",()=>{
  for(const value of [
    {rules:{name:"추정열"}},{rules:{poolId:"성명"}},{rules:{},execute:{action:"refund.record"}},
    {rules:{},sql:"SELECT *"},{rules:{},tool_calls:[]},{rules:{},financeRules:{amount_formula:"성명"}},
  ])expect(()=>parseImportRules(JSON.stringify(value),["성명"])).toThrow();
});
