// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {OfficeTransportPanel} from "./OfficeTransportPanel";
const {get,post,patch,user}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),patch:vi.fn(),user:{id:"owner",swimming_pool_id:"pool",role:"pool_admin",hasX:false}}));
vi.mock("../lib/api-client",()=>({api:{get,post,patch}}));
vi.mock("../contexts/AuthContext",()=>({useAuth:()=>({state:{status:"authenticated",user}})}));
const plan={id:"plan",kind:"plan",revision:1,data:{name:"합성 배차",weekday:1,direction:"INBOUND",vehicleId:"vehicle",classGroupId:"class",classTime:"10:00",earliestTime:"09:00",bufferMinutes:10,toCenterMinutes:10,sourceSnapshotId:"",
  stops:[{stopId:"stop",time:"09:10",travelMinutes:0,fixed:false,studentIds:["member"]}]}};
const vehicle={id:"vehicle",kind:"vehicle",revision:1,data:{name:"합성 차량",plate:"합성",capacity:3,driverId:"driver",status:"active"}};
const stop={id:"stop",kind:"stop",revision:1,data:{name:"합성 승차지",address:"합성 위치",status:"active"}};
const boot={records:[plan,vehicle,stop],students:[{id:"member",name:"합성 회원"}],drivers:[{id:"driver",name:"합성 기사"}],classes:[{id:"class",name:"합성 반"}],snapshots:[],studentListTruncated:false};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}})}><OfficeTransportPanel/></QueryClientProvider>);}
beforeEach(()=>{
  window.dispatchEvent(new Event("office:session-invalid"));vi.resetAllMocks();user.role="pool_admin";user.hasX=false;
  get.mockResolvedValue(boot);post.mockResolvedValue({item:vehicle});patch.mockResolvedValue({item:vehicle});
  vi.spyOn(window,"confirm").mockReturnValue(true);
});
afterEach(()=>{cleanup();window.dispatchEvent(new Event("office:session-invalid"));vi.restoreAllMocks();});
async function openPlan(){fireEvent.click(await screen.findByRole("button",{name:"정기 배차"}));fireEvent.click(screen.getByRole("button",{name:"합성 배차 · 버전 1 [plan]"}));}
it("transport: keeps manual preparation free and preserves drafts across menu remount",async()=>{
  const view=mount();await screen.findByRole("button",{name:"차량"});
  fireEvent.change(screen.getByLabelText("이름"),{target:{value:"수동 초안"}});view.unmount();mount();
  await screen.findByRole("button",{name:"차량"});expect((screen.getByLabelText("이름") as HTMLInputElement).value).toBe("수동 초안");
  expect(post).not.toHaveBeenCalled();
});
it("transport: refuses teacher access without issuing a data query",()=>{
  user.role="teacher";mount();expect(screen.getByText(/센터 관리자만/)).toBeTruthy();expect(get).not.toHaveBeenCalled();
});
it("transport: keeps GPS optional and requires operator-entered thresholds instead of hidden defaults",async()=>{
  const gps={latitude:37,longitude:127,radiusMeters:80,dwellSeconds:10,verified:true};
  post.mockResolvedValue({item:{...stop,data:{...stop.data,gps}}});mount();
  fireEvent.click(await screen.findByRole("button",{name:"승차지"}));
  expect(screen.queryByLabelText("현장 확인 반경(m)")).toBeNull();
  fireEvent.click(screen.getByLabelText("선택: 앱 사용 중 GPS 접근 안내 설정"));
  expect((screen.getByLabelText("현장 확인 반경(m)") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("좌표·반경·머무름을 현장에서 확인했습니다") as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText("이름"),{target:{value:stop.data.name}});
  fireEvent.change(screen.getByLabelText("승차지 주소·위치 안내"),{target:{value:stop.data.address}});
  for(const [label,value] of [["위도","37"],["경도","127"],["현장 확인 반경(m)","80"],["현장 확인 머무름(초)","10"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.click(screen.getByLabelText("좌표·반경·머무름을 현장에서 확인했습니다"));
  fireEvent.click(screen.getByText("준비 자료 저장"));
  await waitFor(()=>expect(post).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({data:expect.objectContaining({gps})})));
});
it("transport: uses the same manual page in X without adding a model request",async()=>{
  user.hasX=true;mount();await screen.findByRole("button",{name:"차량"});
   expect(get.mock.calls.every(([path])=>["/office/operations/transport","/transport/admin"].includes(path))).toBe(true);
  expect(screen.getByRole("button",{name:"준비 자료 저장"})).toBeTruthy();expect(post).not.toHaveBeenCalled();
});
it("transport: shows migration failure rather than a false empty success or editable form",async()=>{
  get.mockRejectedValue({status:503,message:"신규 배차 migration 대기"});mount();
  expect((await screen.findByRole("alert")).textContent).toContain("별도 승인");expect(screen.queryByRole("button",{name:"준비 자료 저장"})).toBeNull();
});
it("transport: does not preview the old saved plan after manual edits",async()=>{
  mount();await openPlan();const count=get.mock.calls.length;
  fireEvent.change(screen.getByLabelText("이름"),{target:{value:"미저장 변경"}});
  fireEvent.click(screen.getByText("저장한 배차 검수"));await screen.findByText(/현재 입력을 먼저 저장/);
  expect(get).toHaveBeenCalledTimes(count);expect(post).not.toHaveBeenCalled();
});
it("transport: confirms only the selected plan revision and hash without claiming dispatch",async()=>{
  const preview={planId:"plan",revision:1,previewHash:"hash",preview:{plan:plan.data,studentCount:1,vehicle:vehicle.data,driver:{name:"합성 기사"},classGroup:{name:"합성 반"},stops:[{...plan.data.stops[0],name:"합성 승차지",students:boot.students}]}};
  get.mockImplementation(async(path:string)=>path.endsWith("/preview")?preview:boot);
  post.mockResolvedValue({item:{id:"snapshot",plan_id:"plan",plan_revision:1},status:"APPROVED_NOT_DISPATCHED"});
  mount();await openPlan();fireEvent.click(screen.getByText("저장한 배차 검수"));await screen.findByRole("region",{name:"배차 검수 미리보기"});
  expect(post).not.toHaveBeenCalled();fireEvent.click(screen.getByText("검수 확인·확정본 보관(미배포)"));
  await waitFor(()=>expect(post).toHaveBeenCalledWith("/office/operations/transport/plans/plan/approve",expect.objectContaining({expectedRevision:1,previewHash:"hash",confirmed:true})));
  await screen.findByText(/확정 스냅샷을 보관했습니다/);expect(post).toHaveBeenCalledTimes(1);
});
it("transport: locks unknown writes across menu remount and does not treat receipt 404 as unprocessed",async()=>{
  post.mockRejectedValue({status:500,message:"응답 유실"});const view=mount();
  await screen.findByRole("button",{name:"차량"});fireEvent.click(screen.getByText("준비 자료 저장"));
  await screen.findByRole("button",{name:"서버 처리 결과 확인"});view.unmount();mount();
  await screen.findByRole("button",{name:"차량"});expect((screen.getByText("준비 자료 저장") as HTMLButtonElement).closest("fieldset")?.disabled).toBe(true);
  get.mockImplementation(async(path:string)=>{if(path.includes("/receipts/"))throw {status:404,message:"기록 없음"};return boot;});
  fireEvent.click(screen.getByText("서버 처리 결과 확인"));await screen.findByText(/기록 없음도 미처리 증거가 아닙니다/);
  expect(post).toHaveBeenCalledTimes(1);
});
