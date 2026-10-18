// @vitest-environment jsdom
import { beforeEach,afterEach,it,expect,vi } from "vitest";
import { render,screen,fireEvent,waitFor,cleanup } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { OfficeBillingWorkflows } from "./OfficeBillingWorkflows";
import type { FinanceSnapshot } from "./office-finance-api";

const {get,post}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock("../lib/api-client",()=>({api:{get,post}}));
const totals={billedKrw:0,dueKrw:0,receivedKrw:0,refundedKrw:0,unallocatedKrw:0,expensesPaidKrw:0,cashFlowKrw:0};
const snapshot={version:0,students:[{id:"a",name:"회원 A"}],rights:[],invoices:[],receipts:[],events:[],refs:{},totals} as unknown as FinanceSnapshot;
const done=vi.fn();
function mount(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  return render(<QueryClientProvider client={client}><OfficeBillingWorkflows scope="test:pool" snapshot={snapshot} onDone={done}/></QueryClientProvider>);
}
beforeEach(()=>{
  window.dispatchEvent(new Event("office:session-invalid"));vi.clearAllMocks();
  get.mockImplementation(async(url:string)=>url.includes("capabilities")?{financeBatchVersion:1}:{items:[],has_more:false});
  post.mockImplementation(async(url:string,body:any)=>{
    if(url.endsWith("/batch/preview"))return{...body,previewHash:"proof",impact:{before:totals,after:{...totals,billedKrw:100,dueKrw:100}},warnings:[]};
    throw Object.assign(new Error("connection lost after send"),{status:502});
  });
});
afterEach(()=>{cleanup();window.dispatchEvent(new Event("office:session-invalid"));});
async function prepare(){
  fireEvent.click(screen.getByTestId("billing-mode-bulk"));
  await screen.findByTestId("billing-bulk");
  fireEvent.click(screen.getByText(/검색된 회원 선택/));
  fireEvent.change(screen.getByTestId("billing-label"),{target:{value:"수강료"}});
  fireEvent.change(screen.getByTestId("billing-amount"),{target:{value:"100"}});
  fireEvent.click(screen.getByTestId("billing-bulk-preview-btn"));
  await screen.findByTestId("billing-bulk-confirm");
}
it("editing a batch clears its confirmed preview instead of submitting stale amounts",async()=>{
  mount();await prepare();
  fireEvent.click(screen.getByTestId("billing-bulk-confirm"));
  fireEvent.change(screen.getByTestId("billing-amount"),{target:{value:"200"}});
  expect(screen.queryByTestId("billing-bulk-confirm")).toBeNull();
  expect((screen.getByTestId("billing-bulk-execute") as HTMLButtonElement).disabled).toBe(true);
  expect(post.mock.calls.filter(c=>c[0].endsWith("/execute"))).toHaveLength(0);
});
it("locks UNKNOWN across navigation and accepts only the actual saved batch receipt",async()=>{
  const first=mount();await prepare();fireEvent.click(screen.getByTestId("billing-bulk-confirm"));
  fireEvent.click(screen.getByTestId("billing-bulk-execute"));
  await screen.findByTestId("billing-bulk-unknown");
  const sent=post.mock.calls.find(c=>c[0].endsWith("/execute"))![1];
  first.unmount();mount();fireEvent.click(screen.getByTestId("billing-mode-bulk"));
  await screen.findByTestId("billing-bulk-unknown");
  fireEvent.click(screen.getByText("처리 결과 확인"));
  await waitFor(()=>expect(screen.getByText(/서버 처리 영수증이 없거나 형식이 맞지/)).toBeTruthy());
  get.mockImplementation(async(url:string)=>url.includes("capabilities")?{financeBatchVersion:1}:url.includes(`/receipts/${sent.requestId}`)?{events:[{id:"saved"}],version:1}:{items:[],has_more:false});
  fireEvent.click(screen.getByText("처리 결과 확인"));
  await screen.findByTestId("billing-bulk-done");
  expect(post.mock.calls.filter(c=>c[0].endsWith("/execute"))).toHaveLength(1);
  expect(done).toHaveBeenCalledOnce();
});
it("does not offer bulk execution without an explicit server capability",async()=>{
  get.mockResolvedValue({available:true,schemaVersion:2,items:[],has_more:false});
  mount();fireEvent.click(screen.getByTestId("billing-mode-bulk"));
  expect(await screen.findByTestId("billing-bulk-disabled")).toBeTruthy();
  expect(screen.queryByTestId("billing-bulk-execute")).toBeNull();
});
