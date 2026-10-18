// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {act,cleanup,render,screen,fireEvent,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {OfficeFinancePanel} from "./OfficeFinancePanel";
import {applyOfficeAiDraft,readOfficeAiEditor} from "./office-ai-editor";
const {get,fetchSnapshot,previewFinance,executeFinance,lookupReceipt,user}=vi.hoisted(()=>({
  get:vi.fn(),fetchSnapshot:vi.fn(),previewFinance:vi.fn(),executeFinance:vi.fn(),lookupReceipt:vi.fn(),
  user:{id:"owner",swimming_pool_id:"pool",role:"pool_admin",hasX:false}}));
vi.mock("../lib/api-client",()=>({api:{get}}));
vi.mock("../contexts/AuthContext",()=>({useAuth:()=>({state:{status:"authenticated",user}})}));
vi.mock("./OfficeRecovery",()=>({confirmRecoveryPointer:vi.fn().mockResolvedValue(undefined)}));
vi.mock("./office-finance-api",async original=>({...await original<typeof import("./office-finance-api")>(),fetchSnapshot,previewFinance,executeFinance,lookupReceipt}));
const totals={billedKrw:100,receivedKrw:0,dueKrw:100,unallocatedKrw:0,refundedKrw:0,expensesPaidKrw:0,cashFlowKrw:0};
const actions=[
  {key:"receipt.record",label:"수납 기록",fields:[{key:"studentId",label:"회원"},{key:"amountKrw",label:"금액",type:"number"},{key:"method",label:"수단"}]},
  {key:"receipt.allocate",label:"수납 배분",fields:[{key:"receiptId",label:"수납"},{key:"invoiceId",label:"청구"},{key:"amountKrw",label:"금액",type:"number"}]}];
const data={version:1,actions,totals,students:[{id:"member",name:"회원"}],invoices:[{id:"invoice",studentId:"member",dueKrw:100}],receipts:[],allocations:[],events:[],expenses:[],closings:[],rights:[],families:[],refs:{},basis:[]};
const result={version:2,event:{id:"receipt",action:"receipt.record",studentId:"member",amountKrw:100}};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><OfficeFinancePanel/></QueryClientProvider>);}
beforeEach(()=>{
  window.dispatchEvent(new Event("office:session-invalid"));vi.clearAllMocks();user.swimming_pool_id="pool";
  get.mockResolvedValue({modelEnabled:false});fetchSnapshot.mockResolvedValue(data);
  previewFinance.mockImplementation(async(command:any)=>({command,expectedVersion:1,previewHash:"proof",impact:{before:totals,after:totals},warnings:[]}));
  executeFinance.mockResolvedValue(result);lookupReceipt.mockResolvedValue(result);
});
afterEach(()=>{cleanup();window.dispatchEvent(new Event("office:session-invalid"));});
async function prepare(){
  await waitFor(()=>expect(readOfficeAiEditor("owner:pool")).toBeTruthy());
  act(()=>applyOfficeAiDraft(readOfficeAiEditor("owner:pool")!,{action:"receipt.record",date:"2026-10-18",studentId:"member",amountKrw:100,method:"cash",_invoiceId:"invoice"}));
  await waitFor(()=>expect((screen.getByTestId("finance-action") as HTMLSelectElement).value).toBe("receipt.record"));
  fireEvent.click(screen.getByTestId("finance-preview-btn"));await screen.findByTestId("finance-preview");
  fireEvent.click(screen.getByTestId("finance-confirm"));fireEvent.click(screen.getByTestId("finance-execute"));
}
it("preserves the confirmed receipt -> original invoice continuation after menu remount without recording a second receipt",async()=>{
  const view=mount();await prepare();await screen.findByTestId("finance-next-allocation");view.unmount();
  mount();await screen.findByTestId("finance-next-allocation");
  fireEvent.click(screen.getByText("이 수납을 선택한 청구에 배분 · 미리보기로"));
  expect((screen.getByTestId("finance-action") as HTMLSelectElement).value).toBe("receipt.allocate");
  expect(screen.getByDisplayValue("receipt")).toBeTruthy();expect(screen.getByDisplayValue("invoice")).toBeTruthy();
  expect(executeFinance).toHaveBeenCalledTimes(1);expect(previewFinance).toHaveBeenCalledTimes(1);
});
it("restores the same continuation only after a confirmed unknown-outcome receipt, never by resending",async()=>{
  executeFinance.mockRejectedValue({status:502,message:"lost response"});
  mount();await prepare();await screen.findByTestId("finance-unknown");
  expect((screen.getByTestId("finance-execute") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("처리 결과 확인"));await screen.findByTestId("finance-next-allocation");
  expect(lookupReceipt).toHaveBeenCalledTimes(1);expect(executeFinance).toHaveBeenCalledTimes(1);
});
it("keeps the new mounted view synchronized when the old view's already-started receipt completes",async()=>{
  let deliver!:(r:unknown)=>void;executeFinance.mockImplementation(()=>new Promise(r=>{deliver=r;}));
  const view=mount();await prepare();await waitFor(()=>expect(executeFinance).toHaveBeenCalledTimes(1));
  view.unmount();mount();await screen.findByTestId("finance-unknown");
  await act(async()=>deliver(result));await screen.findByTestId("finance-next-allocation");
  expect(screen.queryByTestId("finance-unknown")).toBeNull();
  expect(executeFinance).toHaveBeenCalledTimes(1);
});
