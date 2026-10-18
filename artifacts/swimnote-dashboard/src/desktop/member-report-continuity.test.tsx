// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {render,renderHook,act,fireEvent,screen,waitFor,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {useReportPageState,useReportPeriod,useReportTarget,ReportWorkflowNav,issuePeriod} from "../pages/growth-reports/ReportWorkflow";
import NewMemberPage from "../pages/members/NewMemberPage";
import PendingPage from "../pages/growth-reports/PendingPage";
import PublishPage from "../pages/growth-reports/PublishPage";
import {OfficeFinancePanel} from "./OfficeFinancePanel";
import {OfficeAdminActivity} from "./OfficeAdminActivity";

const {get,post,navigate,auth}=vi.hoisted(()=>({
  get:vi.fn(),post:vi.fn(),navigate:vi.fn(),
  auth:{state:{status:"authenticated",user:{id:"admin",swimming_pool_id:"pool",role:"pool_admin"}}},
}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>auth}));
vi.mock("@/desktop/OfficeNavigation",()=>({useOfficeNavigate:()=>navigate}));
vi.mock("@/lib/api-client",()=>({api:{get,post,put:vi.fn()}}));
vi.mock("@/lib/token",()=>({isDesktopTokenStorage:()=>true}));
const wrapper=({children}:any)=><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{children}</QueryClientProvider>;
beforeEach(()=>{vi.clearAllMocks();window.dispatchEvent(new Event("office:session-invalid"));});
afterEach(()=>{cleanup();window.dispatchEvent(new Event("office:session-invalid"));});

it("uses different state for different period keys and keeps it when returning",()=>{
  const h=renderHook(({keyName})=>useReportPageState<Set<string>>(keyName,new Set()),{initialProps:{keyName:"2026-10"}});
  act(()=>h.result.current[1](new Set(["October-report"])));
  h.rerender({keyName:"2026-11"});expect(h.result.current[0].size).toBe(0);
  act(()=>h.result.current[1](new Set(["November-report"])));
  h.rerender({keyName:"2026-10"});expect([...h.result.current[0]]).toEqual(["October-report"]);
});
it("hands the exact report/version and next issue month to review, not the next list row",()=>{
  const h=renderHook(()=>({target:useReportTarget(),period:useReportPeriod(2026,10)}));
  render(<ReportWorkflowNav target={{id:"old-published-id",studentId:"student",name:"회원",period:"2026-12",version:2}}/>);
  fireEvent.click(screen.getByRole("button",{name:"본문·관리자 확인"}));
  expect(h.result.current.target[0]).toMatchObject({id:"old-published-id",version:2,studentId:"student"});
  expect(h.result.current.period).toMatchObject({year:2027,month:1});
  expect(navigate).toHaveBeenCalledWith("/admin/growth-reports/pending");
  expect(issuePeriod("bad")).toBeNull();expect(post).not.toHaveBeenCalled();
});
it("keeps member creation locked after response loss and accepts only the original request's exact receipt ID",async()=>{
  const created=vi.fn();
  get.mockImplementation(async(path:string)=>path==="/class-groups"?[]:{id:"exact-created",name:"회원"});
  post.mockRejectedValue(new TypeError("response lost"));
  render(<NewMemberPage initialValues={{name:"회원"}} onCreated={created}/>,{wrapper});
  fireEvent.click(screen.getByRole("button",{name:"회원 등록"}));
  await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));
  await waitFor(()=>expect((screen.getByRole("button",{name:"회원 등록"}) as HTMLButtonElement).disabled).toBe(true));
  const rid=post.mock.calls[0][1].requestId;
  act(()=>window.dispatchEvent(new CustomEvent("office:receipt-recovered",{detail:{requestId:"unrelated",result:{kind:"member.create",id:"wrong"}}})));
  expect(created).not.toHaveBeenCalled();
  act(()=>window.dispatchEvent(new CustomEvent("office:receipt-recovered",{detail:{requestId:rid,result:{kind:"member.create",id:"exact-created"}}})));
  await waitFor(()=>expect(created).toHaveBeenCalledWith({id:"exact-created",name:"회원"}));
  expect(post).toHaveBeenCalledTimes(1);expect(get).toHaveBeenCalledWith("/students/exact-created");
});
it("marks admin confirmation then refetches the same ID without claiming teacher approval or jumping on list refresh",async()=>{
  let reviewed=false;
  const now=new Date(),period=`${now.getMonth()===0?now.getFullYear()-1:now.getFullYear()}-${String(now.getMonth()===0?12:now.getMonth()).padStart(2,"0")}`;
  const report={id:"report-original",student_id:"student",student_name:"회원",report_period:period,product_status:"REVIEW_REQUIRED",version_number:3};
  get.mockImplementation(async(path:string)=>{
    if(path.includes("/monthly-list"))return {items:reviewed?[]:[report],total:reviewed?0:1};
    return {report_id:report.id,student:{id:"student",name:"회원"},product_status:"REVIEW_REQUIRED",report_period:period,version_number:3,report_content:{summary:"본문"},admin_reviewed_at:reviewed?"2026-10-18":null};
  });
  post.mockImplementation(async()=>{reviewed=true;return {ok:true,report_id:report.id};});
  render(<PendingPage/>,{wrapper});
  await waitFor(()=>expect(screen.queryByRole("button",{name:"검수"})).not.toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"검수"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"관리자 확인 기록"})).not.toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"관리자 확인 기록"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"관리자 확인됨 · 발급과 별개"})).not.toBeNull());
  expect(post).toHaveBeenCalledWith("/admin/growth-reports/report-original/mark-reviewed",{});
  expect(get.mock.calls.filter(c=>c[0]==="/admin/growth-reports/report-original").length).toBeGreaterThan(1);
  expect(screen.queryByText(/이 보고서의 관리자 확인을 기록/)).not.toBeNull();
  expect(post).toHaveBeenCalledTimes(1);
});
it("locks an uncertain publish and resolves only by reading the same ID, never resending",async()=>{
  let published=false;
  get.mockImplementation(async(path:string)=>{
    if(path.includes("monthly-list"))return {items:[{id:"publish-id",student_name:"회원",product_status:"APPROVED",report_period:"2026-09",version_number:2}],total:1};
    return {product_status:published?"PUBLISHED":"APPROVED",published_at:published?"2026-10-18":null};
  });
  post.mockRejectedValue({status:502,message:"결과 불명"});
  render(<PublishPage/>,{wrapper});
  await waitFor(()=>expect(screen.queryAllByRole("checkbox").length).toBe(2));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button",{name:"선택 리포트 발행 (1건)"}));
  fireEvent.click(screen.getByRole("button",{name:"발행",exact:true}));
  await waitFor(()=>expect(screen.queryByText(/발급·발송 결과 불명 1건/)).not.toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"상태만 조회 · 발송 안 함"}));
  await waitFor(()=>expect(screen.queryByText(/아직 모든 ID의 발행/)).not.toBeNull());
  expect(post).toHaveBeenCalledTimes(1);published=true;
  fireEvent.click(screen.getByRole("button",{name:"상태만 조회 · 발송 안 함"}));
  await waitFor(()=>expect(screen.queryByText(/발급·발송 결과 불명 1건/)).toBeNull());
  expect(get).toHaveBeenCalledWith("/admin/growth-reports/publish-id");expect(post).toHaveBeenCalledTimes(1);
});
it("opens matching finance detail inline and preserves period/search/detail across navigation",async()=>{
  get.mockImplementation(async(path:string)=>path.includes("/finance/snapshot")?{
    version:1,reportVersion:1,invoices:[{id:"A-invoice",studentId:"A",date:"2026-10-01",label:"수강료",amountKrw:100000,dueKrw:60000}],
    receipts:[],events:[],expenses:[],rights:[],allocations:[],closings:[],families:[],refs:{},actions:[],
    students:[{id:"A",name:"회원A"}],basis:["기준일 누적"],
    totals:{billedKrw:100000,dueKrw:60000,unallocatedKrw:0,receivedKrw:0,refundedKrw:0,expensesPaidKrw:0,cashFlowKrw:0},
  }:{aiModelEnabled:false});
  const first=render(<OfficeFinancePanel/>,{wrapper});
  await waitFor(()=>expect(screen.queryByTestId("total-dueKrw")).not.toBeNull());
  fireEvent.click(screen.getByTestId("total-dueKrw").closest("button")!);
  expect(screen.queryByTestId("finance-drill")).not.toBeNull();
  expect(screen.queryByText(/상세 합계 60,000원 · 서버 요약 60,000원 · 일치/)).not.toBeNull();
  fireEvent.change(screen.getByTestId("finance-from"),{target:{value:"2026-09-01"}});
  first.unmount();
  render(<OfficeFinancePanel/>,{wrapper});
  await waitFor(()=>expect(screen.queryByTestId("finance-drill")).not.toBeNull());
  expect((screen.getByTestId("finance-from") as HTMLInputElement).value).toBe("2026-09-01");
  expect(screen.getByRole("button",{name:"상세 검색 결과 전체 CSV"})).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});
it("drills admin counts into the same filtered period and separates people/contracts/records",async()=>{
  get.mockImplementation(async(path:string)=>{
    const p=new URLSearchParams(path.split("?")[1]),kind=p.get("kind");
    return {reportVersion:1,counts:{members:1,registrations:2,renewals:1,attendance:4,makeups:1},total:kind==="renewals"?1:2,offset:0,limit:100,
      items:[{kind,id:"source-id",student_id:"student",name:"회원",date:"2026-10-01",status:"active",label:"계약 시작일 기준"}]};
  });
  render(<OfficeAdminActivity scope="admin:pool" from="2026-10-01" to="2026-10-18" studentId="student" search="회원"/>,{wrapper});
  await waitFor(()=>expect(screen.queryByRole("button",{name:"재등록 계약 1 (계약 건 · 시작일)"})).not.toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"재등록 계약 1 (계약 건 · 시작일)"}));
  await waitFor(()=>expect(get.mock.calls.some(c=>{
    const p=new URLSearchParams(c[0].split("?")[1]);
    return p.get("kind")==="renewals"&&p.get("studentId")==="student"&&p.get("search")==="회원"&&p.get("from")==="2026-10-01"&&p.get("to")==="2026-10-18";
  })).toBe(true));
  expect(await screen.findByRole("button",{name:"현재 페이지 CSV · 전체 1건 아님"})).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});
