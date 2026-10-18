// @vitest-environment jsdom
import {afterEach,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {OfficeActionProvider} from "./OfficeActionProvider";
import {useOfficeActions} from "./OfficeActionContext";
import {registerOfficeAiEditor} from "./office-ai-editor";
const {get,post}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock("../lib/api-client",()=>({api:{get,post},performOfficeOperation:vi.fn()}));
vi.mock("../contexts/AuthContext",()=>({useAuth:()=>({state:{status:"authenticated",user:{id:"u",swimming_pool_id:"p",role:"pool_admin",hasX:true}}})}));
vi.mock("./OfficeNavigation",async original=>({...await original<typeof import("./OfficeNavigation")>(),
  useOfficeNavigation:()=>({getDestination:()=>({screen:"page",path:"/admin/office/contacts"}),open:vi.fn()})}));
vi.mock("./OfficeRecovery",()=>({OfficeRecovery:()=>null,recoverableWrite:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();window.dispatchEvent(new Event("office:session-invalid"));});
function Command(){
  const action=useOfficeActions()!;
  return <><button onClick={()=>action.interpret("현재 상담 내용 초안")}>요청</button><p data-testid="notice">{action.notice}</p></>;
}
function mount(){
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <OfficeActionProvider actor={{userId:"u",poolId:"p",role:"pool_admin"}}><Command/></OfficeActionProvider>
  </QueryClientProvider>);
}
it("connects daily command -> currently selected editor -> explicit common-form save, not automatic execution",async()=>{
  const stage=vi.fn();
  registerOfficeAiEditor({scope:"u:p",resource:"contacts",recordId:"contact",token:"1",stage});
  get.mockResolvedValue({modelEnabled:true});
  post.mockResolvedValue({kind:"operations-draft",resource:"contacts",recordId:"contact",data:{name:"입력 초안"}});
  mount();fireEvent.click(screen.getByText("요청"));
  await waitFor(()=>expect(stage).toHaveBeenCalledWith({name:"입력 초안"}));
  expect(post).toHaveBeenCalledWith("/office/operations/workspace/interpret",{text:"현재 상담 내용 초안",resource:"contacts",recordId:"contact"});
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("notice").textContent).toContain("저장되지 않았습니다");
});
it("keeps the implemented daily editor path OFF without an interpreter/model POST",async()=>{
  const stage=vi.fn();registerOfficeAiEditor({scope:"u:p",resource:"contacts",token:"1",stage});
  get.mockResolvedValue({modelEnabled:false});mount();fireEvent.click(screen.getByText("요청"));
  await waitFor(()=>expect(screen.getByTestId("notice").textContent).toContain("모델 실행 스위치 OFF"));
  expect(post).not.toHaveBeenCalled();expect(stage).not.toHaveBeenCalled();
});
