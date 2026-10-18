import {it,expect,vi} from "vitest";
vi.mock("../lib/api-client",()=>({api:{}}));
import {previewRuleChanges} from "./office-ops-lib";
it("previews changes/removals without mutating decisions, and preserves unrelated mappings",()=>{
  const current={name:"이름",parent_phone:"전화",memo:"비고"};
  const p=previewRuleChanges("이름=성명\nparent_phone 규칙 취소",["성명","전화","비고"],current)!;
  expect(p.next).toEqual({name:"성명",memo:"비고"});
  expect(p.changes).toEqual([{target:"name",before:"이름",after:"성명"},{target:"parent_phone",before:"전화",after:""}]);
  expect(current.parent_phone).toBe("전화");
});
it("rejects ambiguous/unknown/duplicate decisions as a whole instead of applying part or calling a model",()=>{
  expect(previewRuleChanges("이름=성명\n마음대로 분석해줘",["성명"],{})).toBeNull();
  expect(previewRuleChanges("이름=성명\n이름 규칙 취소",["성명"],{})).toBeNull();
  expect(previewRuleChanges("이름=존재하지않음",["성명"],{})).toBeNull();
});
