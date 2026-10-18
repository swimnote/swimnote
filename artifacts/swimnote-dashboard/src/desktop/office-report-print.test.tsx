// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ReportDetailLink} from "../pages/growth-reports/ReportViews";
const {get,setTarget}=vi.hoisted(()=>({get:vi.fn(),setTarget:vi.fn()}));
vi.mock("../lib/api-client",()=>({api:{get}}));
vi.mock("../pages/growth-reports/ReportWorkflow",()=>({useReportTarget:()=>[null,setTarget],ReportWorkflowNav:()=>null}));
const report={report_id:"original",version_number:3,student:{id:"member",name:"선택 회원"},product_status:"PUBLISHED",report_period:"2026-09",published_at:"2026-10-05",report_content:{summary:"당시 발행 본문"}};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><ReportDetailLink id="original" label="인쇄·PDF 저장"/></QueryClientProvider>);}
beforeEach(()=>{get.mockResolvedValue(report);vi.spyOn(window,"print").mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
it("prints only the explicitly opened stored ID/version via the shared read-only renderer, without sending or regenerating",async()=>{
  mount();expect(get).not.toHaveBeenCalled();expect(window.print).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("인쇄·PDF 저장"));
  await screen.findByText("당시 발행 본문");
  expect(get).toHaveBeenCalledWith("/admin/growth-reports/original");
  expect(document.body.textContent).toContain("버전 3");
  expect(window.print).not.toHaveBeenCalled();fireEvent.click(screen.getByText("이 보고서 인쇄·PDF 저장"));
  expect(window.print).toHaveBeenCalledTimes(1);
  const target=document.body.dataset.officeReportPrintId;
  expect(target).toBeTruthy();expect(document.querySelector(`[data-office-report-print="${target}"]`)?.textContent).toContain("당시 발행 본문");
  fireEvent(window,new Event("afterprint"));expect(document.body.dataset.officeReportPrintId).toBeUndefined();
  expect(setTarget).not.toHaveBeenCalled();
});
it("refuses printing when the API supplies a different report ID",async()=>{
  get.mockResolvedValue({...report,report_id:"different"});
  mount();fireEvent.click(screen.getByText("인쇄·PDF 저장"));await screen.findByRole("alert");
  expect(screen.queryByText("당시 발행 본문")).toBeNull();expect(screen.queryByText("이 보고서 인쇄·PDF 저장")).toBeNull();
  expect(window.print).not.toHaveBeenCalled();
});
it("does not treat an OS print failure as a saved PDF",async()=>{
  vi.mocked(window.print).mockImplementation(()=>{throw Error("OS print unavailable");});
  mount();fireEvent.click(screen.getByText("인쇄·PDF 저장"));await screen.findByText("당시 발행 본문");
  fireEvent.click(screen.getByText("이 보고서 인쇄·PDF 저장"));
  expect(screen.getByRole("alert").textContent).toContain("저장 완료로 처리하지");
  expect(document.body.dataset.officeReportPrintId).toBeUndefined();
});
