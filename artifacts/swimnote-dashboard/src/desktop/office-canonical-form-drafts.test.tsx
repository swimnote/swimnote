// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {NoticesPanel} from "./OfficeNoticesPanel";
import {ParentRequestsPanel} from "./OfficeParentRequestsPanel";
import {readOfficeAiEditor,applyOfficeAiDraft} from "./office-ai-editor";
const {get,post,patch,user}=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),patch:vi.fn(),user:{id:"owner",swimming_pool_id:"pool",role:"pool_admin",hasX:true}}));
vi.mock("../lib/api-client",()=>({api:{get,post,patch,delete:vi.fn()}}));
vi.mock("../contexts/AuthContext",()=>({useAuth:()=>({state:{status:"authenticated",user}})}));
const req=(id:string)=>({id,student_id:id,request_type:"문의",request_date:null,content:`${id} 요청`,status:"pending",admin_note:null,created_at:"2026-10-18"});
function mount(node:React.ReactNode){
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}})}>{node}</QueryClientProvider>);
}
beforeEach(()=>{
  window.dispatchEvent(new Event("office:session-invalid"));vi.resetAllMocks();user.role="pool_admin";user.hasX=true;
  vi.spyOn(window,"confirm").mockReturnValue(true);
  get.mockImplementation(async(path:string)=>{
    if(path==="/notices")return [];
    if(path==="/office/operations/workspace/catalog")return {modelEnabled:false};
    if(path==="/parent-requests")return [req("a"),req("b")];
    if(path==="/students")return [{id:"a",name:"회원A"},{id:"b",name:"회원B"}];
    if(path.endsWith("/messages"))return {success:true,messages:[]};
    throw new Error("Unexpected test URL "+path);
  });
  post.mockResolvedValue({success:true});patch.mockResolvedValue({success:true});
});
afterEach(()=>{cleanup();window.dispatchEvent(new Event("office:session-invalid"));vi.restoreAllMocks();});
async function open(which=0){fireEvent.click((await screen.findAllByText("대화 열기"))[which]);await waitFor(()=>expect(readOfficeAiEditor("owner:pool")?.recordId).toBe(which===0?"a":"b"));}
it("keeps Normal manual notice creation available without AI rights or any model request",async()=>{
  user.hasX=false;mount(<NoticesPanel canManage/>);
  fireEvent.change(screen.getByPlaceholderText("공지 제목"),{target:{value:"직접 작성"}});
  fireEvent.change(screen.getByPlaceholderText("공지 내용"),{target:{value:"직접 안내"}});
  fireEvent.click(screen.getByText("미리보기"));fireEvent.click(screen.getByText("공지 등록"));
  await waitFor(()=>expect(post).toHaveBeenCalledWith("/notices",expect.objectContaining({title:"직접 작성"})));
  expect(post).toHaveBeenCalledTimes(1);expect((screen.getByPlaceholderText("초안으로 채울 내용을 설명") as HTMLInputElement).disabled).toBe(true);
});
it("stages notice text only, previews its actual notification choice, and saves only after explicit confirmation",async()=>{
  mount(<NoticesPanel canManage/>);
  await waitFor(()=>expect(readOfficeAiEditor("owner:pool")?.formKind).toBe("notice"));
  act(()=>applyOfficeAiDraft(readOfficeAiEditor("owner:pool")!,{title:"운영 공지",content:"확정된 안내"}));
  expect(post).not.toHaveBeenCalled();expect((screen.getByLabelText("푸시 알림 발송") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByText("공지 등록"));expect(post).not.toHaveBeenCalled();
  expect(screen.getByRole("region",{name:"공지 미리보기"}).textContent).toContain("푸시 발송");
  fireEvent.click(screen.getByText("공지 등록"));
  await waitFor(()=>expect(post).toHaveBeenCalledWith("/notices",expect.objectContaining({title:"운영 공지",send_push:true})));
  expect(post).toHaveBeenCalledTimes(1);
});
it("does not allow a late helper response to overwrite manual notice edits",async()=>{
  get.mockImplementation(async(path:string)=>path==="/notices"?[]:{modelEnabled:true});
  let deliver!:(value:unknown)=>void;post.mockImplementation(()=>new Promise(r=>{deliver=r;}));
  mount(<NoticesPanel canManage/>);
  fireEvent.change(screen.getByPlaceholderText("초안으로 채울 내용을 설명"),{target:{value:"공지 초안"}});
  fireEvent.click(await screen.findByText("초안 요청"));
  await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText("공지 제목"),{target:{value:"수동 제목"}});
  await act(async()=>deliver({kind:"form-draft",formKind:"notice",data:{title:"늦은 제목",content:"늦은 본문"}}));
  expect((screen.getByPlaceholderText("공지 제목") as HTMLInputElement).value).toBe("수동 제목");
  expect(post).toHaveBeenCalledTimes(1);
});
it("preserves each request's draft and never clears B when A's confirmed send completes late",async()=>{
  let deliver!:(value:unknown)=>void;post.mockImplementation(()=>new Promise(r=>{deliver=r;}));
  mount(<ParentRequestsPanel/>);await open();
  fireEvent.change(screen.getByPlaceholderText("답장 내용"),{target:{value:"A 답장"}});
  fireEvent.click(screen.getByText("답장 미리보기"));fireEvent.click(screen.getByText("답장 발송"));
  await waitFor(()=>expect(post).toHaveBeenCalledWith("/parent-requests/a/messages",{content:"A 답장"}));
  await open(1);fireEvent.change(screen.getByPlaceholderText("답장 내용"),{target:{value:"B 입력 중"}});
  await act(async()=>deliver({success:true}));
  expect((screen.getByPlaceholderText("답장 내용") as HTMLTextAreaElement).value).toBe("B 입력 중");
  await open(0);expect((screen.getByPlaceholderText("답장 내용") as HTMLTextAreaElement).value).toBe("");
  await open(1);expect((screen.getByPlaceholderText("답장 내용") as HTMLTextAreaElement).value).toBe("B 입력 중");
});
it("keeps an unknown notice outcome locked across menu unmount/remount and never retries",async()=>{
  post.mockRejectedValue({status:409,code:"OFFICE_OUTCOME_UNKNOWN",message:"결과 불명"});
  const view=mount(<NoticesPanel canManage/>);
  fireEvent.change(screen.getByPlaceholderText("공지 제목"),{target:{value:"제목"}});
  fireEvent.change(screen.getByPlaceholderText("공지 내용"),{target:{value:"본문"}});
  fireEvent.click(screen.getByText("미리보기"));fireEvent.click(screen.getByText("공지 등록"));
  await screen.findByText(/재전송하지 말고/);view.unmount();
  mount(<NoticesPanel canManage/>);
  expect((screen.getByText("공지 등록") as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByText("공지 등록"));expect(post).toHaveBeenCalledTimes(1);
});
it("does not register a teacher's notice editor or expose administrator AI draft rights",async()=>{
  user.role="teacher";mount(<NoticesPanel canManage/>);
  await screen.findByText(/조회만 가능합니다/);
  expect(readOfficeAiEditor("owner:pool")).toBeNull();expect(screen.queryByPlaceholderText("공지 제목")).toBeNull();expect(post).not.toHaveBeenCalled();
});
it("clears session draft state on invalidation and ignores the old session's delayed response",async()=>{
  let deliver!:(value:unknown)=>void;post.mockImplementation(()=>new Promise(r=>{deliver=r;}));
  const view=mount(<NoticesPanel canManage/>);
  fireEvent.change(screen.getByPlaceholderText("공지 제목"),{target:{value:"이전 세션"}});
  fireEvent.change(screen.getByPlaceholderText("공지 내용"),{target:{value:"이전 본문"}});
  fireEvent.click(screen.getByText("미리보기"));fireEvent.click(screen.getByText("공지 등록"));
  await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));
  view.unmount();act(()=>window.dispatchEvent(new Event("office:session-invalid")));
  mount(<NoticesPanel canManage/>);fireEvent.change(screen.getByPlaceholderText("공지 제목"),{target:{value:"새 세션"}});
  await act(async()=>deliver({success:true}));
  expect((screen.getByPlaceholderText("공지 제목") as HTMLInputElement).value).toBe("새 세션");
});
