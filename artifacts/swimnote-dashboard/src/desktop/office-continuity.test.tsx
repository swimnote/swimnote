// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ResourceTable} from "./OfficeOperationsPanel";
import {OfficeNfcPanel} from "./OfficeNfcPanel";
import {OfficeFinancePanel} from "./OfficeFinancePanel";
import {SPECS} from "./office-ops-lib";
import {readOfficeAiEditor,applyOfficeAiDraft} from "./office-ai-editor";
const {get,post}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock("../lib/api-client",()=>({api:{get,post}}));
vi.mock("../contexts/AuthContext",()=>({useAuth:()=>({state:{status:"authenticated",user:{id:"owner",swimming_pool_id:"pool",role:"pool_admin",hasX:false}}})}));
vi.mock("./OfficeOpsAiDraft",()=>({OfficeOpsAiDraft:()=>null}));
const saved=vi.fn();
const contract={id:"contract",revision:1,data:{studentId:"student",startDate:"2026-10-01",endDate:"2026-12-31"}};
function mount(children:React.ReactNode){
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}>{children}</QueryClientProvider>);
}
beforeEach(()=>{
  window.dispatchEvent(new Event("office:session-invalid"));vi.clearAllMocks();
  get.mockImplementation(async(url:string)=>{
    if(url==="/students")return [{id:"student",name:"테스트 회원"}];
    if(url==="/class-groups")return [{id:"class",name:"테스트 반"}];
    if(url.includes("/contracts"))return {items:[contract],has_more:false};
    throw {status:404};
  });
  post.mockResolvedValue({item:{id:"enrollment",revision:1,data:{}}});
});
it("keeps inline assignment context when starting the next repeated entry",async()=>{
  mount(assignment());
  fireEvent.click(screen.getByRole("button",{name:"새로 등록",exact:true}));
  expect((screen.getByDisplayValue("2026-10-01") as HTMLInputElement).value).toBe("2026-10-01");
  fireEvent.click(screen.getByRole("button",{name:"저장",exact:true}));
  await waitFor(()=>expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1].data).toMatchObject({studentId:"student",contractId:"contract",startDate:"2026-10-01",endDate:"2026-12-31"});
});
afterEach(()=>{cleanup();window.dispatchEvent(new Event("office:session-invalid"));});
function assignment(){
  const classKey=SPECS.enrollments.fields.find(f=>f.ref==="classes")!.key;
  return <ResourceTable res="enrollments" scopeKey="owner:pool" draftKey="contract"
    seed={{form:{studentId:"student",contractId:"contract",startDate:"2026-10-01",endDate:"2026-12-31",status:"active",[classKey]:"class"}}} onSaved={saved}/>;
}
it("carries member, contract and both dates into a real assignment write",async()=>{
  mount(assignment());
  await screen.findByText("테스트 회원");
  expect((screen.getByDisplayValue("2026-10-01") as HTMLInputElement).value).toBe("2026-10-01");
  fireEvent.click(screen.getByRole("button",{name:"저장",exact:true}));
  await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][0]).toBe("/office/operations/enrollments");
  expect(post.mock.calls[0][1].data).toMatchObject({studentId:"student",contractId:"contract",startDate:"2026-10-01",endDate:"2026-12-31"});
});
it("retains the assignment input and forbids retransmission when its result is unknown",async()=>{
  post.mockRejectedValue({status:409,code:"OFFICE_OUTCOME_UNKNOWN"});
  mount(assignment());await screen.findByText("테스트 회원");
  fireEvent.click(screen.getByRole("button",{name:"저장",exact:true}));
  await screen.findByText(/새 저장을 막고/);
  expect((screen.getByRole("button",{name:"저장",exact:true}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"서버 처리 결과 확인"}));
  await screen.findByText(/확정된 처리 결과가 없습니다/);
  expect(post).toHaveBeenCalledTimes(1);
  expect((screen.getByDisplayValue("2026-12-31") as HTMLInputElement).value).toBe("2026-12-31");
});
it("armed scanner diverts other-field keys and paste; Esc and unmount release capture",()=>{
  const r=mount(<><input aria-label="금액" defaultValue="유지"/><OfficeNfcPanel scopeKey="owner:pool"/></>);
  const money=screen.getByLabelText("금액");
  fireEvent.click(screen.getByTestId("nfc-arm"));money.focus();
  expect(fireEvent.keyDown(money,{key:"A"})).toBe(false);
  expect((screen.getByTestId("nfc-uid") as HTMLInputElement).value).toBe("A");
  const paste=new Event("paste",{bubbles:true,cancelable:true});money.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);expect((money as HTMLInputElement).value).toBe("유지");
  fireEvent.keyDown(money,{key:"Escape"});
  expect(fireEvent.keyDown(money,{key:"2"})).toBe(true);
  fireEvent.click(screen.getByTestId("nfc-arm"));r.unmount();
  expect(document.dispatchEvent(new KeyboardEvent("keydown",{key:"3",bubbles:true,cancelable:true}))).toBe(true);
  expect(post).not.toHaveBeenCalled();
});
it("opens a member's unpaid invoice inline and previews only the actual partial receipt",async()=>{
  const totals={billedKrw:100000,dueKrw:100000,receivedKrw:0,refundedKrw:0,unallocatedKrw:0,expensesPaidKrw:0,cashFlowKrw:0};
  get.mockResolvedValue({version:0,students:[{id:"student",name:"테스트 회원"}],invoices:[{id:"invoice",studentId:"student",label:"테스트 수강료",date:"2026-10-01",dueDate:"2026-10-10",amountKrw:100000,allocatedKrw:0,dueKrw:100000,cancelled:false}],
    events:[],receipts:[],allocations:[],expenses:[],closings:[],rights:[],families:[],basis:[],totals,
    refs:{students:[{id:"student",label:"테스트 회원"}]},actions:[{key:"receipt.record",label:"수납 기록",fields:[
      {key:"studentId",label:"회원",type:"ref",ref:"students"},{key:"amountKrw",label:"금액",type:"number"},{key:"method",label:"수단",type:"select",options:["cash"]}]}]});
  post.mockImplementation(async(_url,body)=>({...body,previewHash:"proof",impact:{before:totals,after:totals},warnings:[]}));
  mount(<OfficeFinancePanel initialStudentId="student"/>);
  await screen.findByTestId("finance-report");
  fireEvent.click(screen.getByRole("button",{name:"청구",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"수납·부분수납 이어가기"}));
  await screen.findByTestId("finance-entry");
  expect((screen.getByLabelText(/금액/) as HTMLInputElement).value).toBe("100000");
  const beforeEdit=readOfficeAiEditor("owner:pool")!;
  expect(beforeEdit.memberId).toBe("student");
  fireEvent.change(screen.getByLabelText(/금액/),{target:{value:"25000"}});
  expect(readOfficeAiEditor("owner:pool")).not.toBe(beforeEdit);
  expect(()=>applyOfficeAiDraft(beforeEdit,{action:"receipt.record",amountKrw:100000})).toThrow();
  expect((screen.getByLabelText(/금액/) as HTMLInputElement).value).toBe("25000");
  fireEvent.change(screen.getByLabelText(/수단/),{target:{value:"cash"}});
  fireEvent.click(screen.getByRole("button",{name:"미리보기",exact:true}));
  await waitFor(()=>expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][0]).toBe("/office/operations/finance/preview");
  expect(post.mock.calls[0][1].command).toMatchObject({action:"receipt.record",studentId:"student",amountKrw:25000});
  expect(post.mock.calls[0][1].command).not.toHaveProperty("_invoiceId");
  expect(post.mock.calls.some(([url])=>url.endsWith("/execute"))).toBe(false);
});
