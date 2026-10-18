// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {OfficeTransportV2} from "./OfficeTransportV2";
const {get,post}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}));
vi.mock("../lib/api-client",()=>({api:{get,post}}));
const boot={members:[],runs:[],preferences:[],availability:[]};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><OfficeTransportV2 scope="owner:pool" records={[]}/></QueryClientProvider>);}
beforeEach(()=>{window.dispatchEvent(new Event("office:session-invalid"));get.mockReset();post.mockReset();get.mockImplementation(async(p:string)=>{
  if(p==="/transport/admin")return boot;
  if(p==="/transport/planning/ai-capability")return {enabled:false,reason:"별도 호출 비용 승인 대기"};
  if(p.startsWith("/transport/planning?"))return {settings:{revision:0,data:{departureBufferMinutes:0,handoverBufferMinutes:0,durations:{},overrides:[],travel:[]}},items:[],classes:[],warnings:[]};
  if(p==="/transport/notifications")return {items:[],dispatchEnabled:false,deviceDeliveryProven:false,warning:"실발송 승인 전"};
  if(p==="/transport/reconciliation"||p.startsWith("/transport/operations"))return {items:[]};
  throw Error(`Unexpected fixture read ${p}`);
});vi.spyOn(window,"confirm").mockReturnValue(true);});
afterEach(()=>{cleanup();window.dispatchEvent(new Event("office:session-invalid"));vi.restoreAllMocks();});
it("binds an explicit existing account/duty invite without creating an account or sending",async()=>{
  post.mockResolvedValue({id:"invite",inviteCode:"synthetic-code",status:"INVITED",sent:false});
  mount();await screen.findByRole("button",{name:"운행 전용 초대 생성"});
  fireEvent.change(screen.getByLabelText("기존 계정 ID"),{target:{value:"account"}});
  fireEvent.click(screen.getByRole("button",{name:"운행 전용 초대 생성"}));
  await waitFor(()=>expect(post).toHaveBeenCalledWith("/transport/memberships/invite",expect.objectContaining({principalType:"parent_accounts",principalId:"account",duty:"DRIVER",confirmed:true,requestId:expect.any(String)})));
  expect(await screen.findByText("synthetic-code")).toBeTruthy();expect(post).toHaveBeenCalledTimes(1);
});
it("keeps unknown native writes locked across menu remount; receipt 404 is not permission to retry",async()=>{
  post.mockRejectedValue({status:500,message:"응답 유실"});let view=mount();
  fireEvent.click(await screen.findByRole("button",{name:"운행 전용 초대 생성"}));
  await screen.findByRole("button",{name:"V2 서버 결과 확인"});view.unmount();mount();
  expect((await screen.findByRole("button",{name:"운행 전용 초대 생성"})).closest("fieldset")?.disabled).toBe(true);
  get.mockImplementation(async(p:string)=>{if(p.includes("/requests/"))throw {status:404,message:"기록 없음"};return boot;});
  fireEvent.click(screen.getByRole("button",{name:"V2 서버 결과 확인"}));await screen.findByText(/미처리 증거가 아닙니다/);
  expect(post).toHaveBeenCalledTimes(1);
});
it("shows contract/migration failures rather than false empty operational success",async()=>{
  get.mockRejectedValue({status:503,message:"migration approval pending"});mount();
  expect((await screen.findByRole("alert")).textContent).toContain("별도 승인");
  expect(screen.queryByRole("button",{name:"운행 전용 초대 생성"})).toBeNull();expect(post).not.toHaveBeenCalled();
});
it("does not expose confirmation before saved revision/hash review and never calls a model",async()=>{
  mount();fireEvent.click(await screen.findByRole("button",{name:"혼합 배차·확정·게시"}));
  expect((screen.getByRole("button",{name:"최신 저장본 검수"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button",{name:"검수한 버전 확정"})).toBeNull();
  expect(post).not.toHaveBeenCalled();expect(get.mock.calls.every(([path])=>path.startsWith("/transport/"))).toBe(true);
});
it("keeps the cost-gated model action disabled without an approved capability",async()=>{
  mount();fireEvent.click(await screen.findByRole("button",{name:"혼합 배차·확정·게시"}));
  await screen.findByText(/별도 호출 비용 승인 대기/);
  const action=screen.getByRole("button",{name:"모델 제안 요청(비용 발생)"});
  expect(action).toBeTruthy();expect((action as HTMLButtonElement).disabled).toBe(true);expect(post).not.toHaveBeenCalled();
});
it("requests the deterministic draft without saving, approving, publishing or enabling a model",async()=>{
  const draft={plan:{steps:[]},source:"DETERMINISTIC_CONSTRAINT_DRAFT",applied:false,complete:false,unassigned:[{studentId:"s",reason:"등록 이동시간 필요"}],conflicts:[]};
  post.mockResolvedValue(draft);mount();
  fireEvent.click(await screen.findByRole("button",{name:"혼합 배차·확정·게시"}));
  fireEvent.click(await screen.findByRole("button",{name:"초안 계산"}));
  await screen.findByText(/등록 이동시간 필요/);
  expect(post).toHaveBeenCalledTimes(1);expect(post.mock.calls[0][0]).toBe("/transport/planning/calculate");
  expect(screen.queryByRole("button",{name:"검수한 버전 확정"})).toBeNull();
});
