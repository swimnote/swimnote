// @vitest-environment jsdom
import {afterEach,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent,waitFor,act} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {importConversation} from "./office-import-conversation";
import {registerOfficeAiEditor,readOfficeAiEditor,applyOfficeAiDraft} from "./office-ai-editor";
import {OfficeImportSemantic} from "./OfficeImportSemantic";
import {OfficeOpsAiDraft} from "./OfficeOpsAiDraft";
const {get,post}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock("../lib/api-client",()=>({api:{get,post}}));
afterEach(()=>{cleanup();vi.clearAllMocks();window.dispatchEvent(new Event("office:session-invalid"));});
it("interprets bounded conversational member/finance decisions and preserves future-file mappings",()=>{
  const original={name:"성명",memo:"비고"},fin={kind:"구분"};
  const p=importConversation("보호자 전화는 보호자휴대폰 열로 써줘\n잔여 횟수는 남은수업 열로 사용해줘\n다음 파일에도 이 규칙 유지해줘",["성명","보호자휴대폰","남은수업"],original,fin)!;
  expect(p.issues).toEqual([]);
  expect(p.next).toEqual({...original,parent_phone:"보호자휴대폰"});
  expect(p.financeRules).toEqual({...fin,remaining_count:"남은수업"});
  expect(original).not.toHaveProperty("parent_phone");
  const cancelled=importConversation("보호자 전화 규칙을 취소해줘",[],p.next,p.financeRules)!;
  expect(cancelled.next).not.toHaveProperty("parent_phone");expect(cancelled.financeRules.remaining_count).toBe("남은수업");
});
it("groups only ambiguous/conflicting opinions without guessing a header or executing instructions",()=>{
  const p=importConversation("이름=성명\n그 열을 전화로 써줘\n이름=다른이름\nSQL 실행해줘",["성명","다른이름"],{})!;
  expect(p.changes).toHaveLength(1);expect(p.issues).toHaveLength(3);expect(post).not.toHaveBeenCalled();
});
it("rejects stale/foreign/cleared editor handoffs and never saves while staging fields",()=>{
  const stage=vi.fn(),old={scope:"u:p",resource:"contacts",token:"1",stage},unregister=registerOfficeAiEditor(old);
  expect(readOfficeAiEditor("other:p")).toBeNull();
  const current={...old,token:"2"};registerOfficeAiEditor(current);unregister();
  expect(readOfficeAiEditor("u:p")).toBe(current);
  expect(()=>applyOfficeAiDraft(old,{name:"stale"})).toThrow();
  applyOfficeAiDraft(current,{name:"draft"});expect(stage).toHaveBeenCalledWith({name:"draft"});
  window.dispatchEvent(new Event("office:session-invalid"));expect(()=>applyOfficeAiDraft(current,{})).toThrow();
  expect(post).not.toHaveBeenCalled();
});
const props={scope:"u:p",cur:{id:"job",revision:3,data:{files:[]}},files:[],text:"의미를 해석해줘",headers:["성명","잔여"],
  rules:{},financeRules:{},locked:false};
function mount(enabled:boolean){
  get.mockResolvedValue({aiImportModelEnabled:enabled});
  const applied=vi.fn(),query=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=render(<QueryClientProvider client={query}><OfficeImportSemantic {...props} onApply={applied}/></QueryClientProvider>);
  return {applied,view};
}
it("keeps fully connected semantic execution OFF without sending an interpretation request",async()=>{
  mount(false);
  await waitFor(()=>expect(get).toHaveBeenCalled());
  const button=screen.getByRole("button",{name:"의미 해석 연결 구현됨 · 모델 실행 OFF"}) as HTMLButtonElement;
  expect(button.disabled).toBe(true);fireEvent.click(button);expect(post).not.toHaveBeenCalled();
});
it("uses a mocked semantic reply as a proposal only, then explicitly hands confirmed rules to the common editor",async()=>{
  post.mockResolvedValue({kind:"rules",rules:{name:"성명"},financeRules:{remaining_count:"잔여"},question:""});
  const {applied}=mount(true);
  fireEvent.click(await screen.findByRole("button",{name:"의미 해석 제안 요청 · 자동 적용 안 함"}));
  await screen.findByTestId("import-semantic-proposal");expect(applied).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith("/office/operations/imports/job/interpret",{text:props.text,expectedRevision:3});
  fireEvent.click(screen.getByRole("button",{name:"확인한 제안을 규칙에 반영"}));
  expect(applied).toHaveBeenCalledWith(expect.objectContaining({rules:{name:"성명"}}));
  expect(post).toHaveBeenCalledTimes(1); // No create/apply/model retry.
});
it("does not overwrite manually edited operation fields with a late mocked form-helper response",async()=>{
  get.mockResolvedValue({modelEnabled:true});
  let deliver!:(v:unknown)=>void;post.mockImplementation(()=>new Promise(r=>{deliver=r;}));
  const onDraft=vi.fn(),p={resource:"contacts",recordId:"contact",hasX:true,locked:false,onDraft};
  const view=render(<OfficeOpsAiDraft {...p} contextToken="original-fields"/>);
  fireEvent.change(screen.getByPlaceholderText("초안으로 채울 내용을 설명"),{target:{value:"상담 초안"}});
  fireEvent.click(await screen.findByRole("button",{name:"초안 요청"}));
  await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));
  view.rerender(<OfficeOpsAiDraft {...p} contextToken="user-edited-fields"/>);
  await act(async()=>deliver({kind:"operations-draft",resource:"contacts",recordId:"contact",data:{name:"이전 응답"}}));
  expect(onDraft).not.toHaveBeenCalled();expect(post).toHaveBeenCalledTimes(1);
});
