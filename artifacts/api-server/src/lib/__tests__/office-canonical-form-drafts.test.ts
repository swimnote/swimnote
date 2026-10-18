import {afterEach,it,expect,vi} from "vitest";
vi.mock("../office-model-completion.js",async original=>({...await original<typeof import("../office-model-completion.js")>(),completeOfficeModel:vi.fn()}));
import {completeOfficeModel,officeModelChoice,officeModelPurpose,checkOfficeModelInput,OFFICE_MODEL_LIMIT} from "../office-model-completion.js";
import {draftOfficeForm,parseOfficeFormDraft,readOfficeFormContext} from "../office-form-ai.js";
const owner={userId:"admin",poolId:"pool",role:"pool_admin" as const};
afterEach(()=>vi.clearAllMocks());
it("refuses teacher draft access before reading or calling a model",async()=>{
  const query=vi.fn();
  await expect(draftOfficeForm({query} as any,{...owner,role:"teacher"},{formKind:"notice",text:"공지"})).rejects.toMatchObject({code:"ROLE_REQUIRED"});
  expect(query).not.toHaveBeenCalled();expect(completeOfficeModel).not.toHaveBeenCalled();
});
it("uses the pinned small model for fields and population-independent mapping without routing calls",()=>{
  expect(officeModelChoice("fields",{})).toBe("gpt-4o-mini-2024-07-18");
  expect(officeModelChoice("mapping",{})).toBe("gpt-4o-mini-2024-07-18");
  expect(officeModelPurpose("enrollments","1000명 수강 필드 정리")).toBe("fields");
  expect(officeModelPurpose("templates","여러 문서 조항 충돌 대조")).toBe("complex-document");
  expect(()=>officeModelChoice("complex-document",{})).toThrow();
  expect(officeModelChoice("complex-document",{OFFICE_COMPLEX_AI_ENABLED:"true"})).toBe("gpt-4.1-2025-04-14");
  expect(()=>officeModelPurpose("contacts","test","complex")).toThrow();
  expect(completeOfficeModel).not.toHaveBeenCalled();
});
it("enforces one bounded request and rejects message/input overflow rather than split/upgrade/retry",()=>{
  expect(OFFICE_MODEL_LIMIT.outputTokens).toBe(1200);
  expect(OFFICE_MODEL_LIMIT.inputTokensUpperBound).toBe(20128);
  expect(()=>checkOfficeModelInput([{role:"user",content:"가".repeat(7000)}])).toThrow();
  expect(()=>checkOfficeModelInput(Array.from({length:5},()=>({role:"user",content:"a"})))).toThrow();
  expect(()=>checkOfficeModelInput([{role:"assistant",content:"arbitrary role"}])).toThrow();
  expect(completeOfficeModel).not.toHaveBeenCalled();
});
it("returns only text fields and refuses recipient, notification, status, model tools and SQL injection output",()=>{
  expect(parseOfficeFormDraft('{"kind":"form-draft","data":{"title":"제목","content":"내용"}}',"notice")).toMatchObject({data:{title:"제목",content:"내용"}});
  for(const data of [{content:"x",send_push:true},{content:"x",parentId:"other"},{status:"done"},{title:"not allowed"}])
    expect(()=>parseOfficeFormDraft(JSON.stringify({kind:"form-draft",data}),"parent-reply")).toThrow();
  expect(()=>parseOfficeFormDraft('{"kind":"form-draft","data":{"content":"x"},"tool_calls":[]}',"parent-reply")).toThrow();
});
it("checks pool ownership before asking even the mocked model",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});
  await expect(draftOfficeForm({query} as any,owner,{formKind:"notice",recordId:"foreign",text:"공지 초안"})).rejects.toMatchObject({code:"SCOPE_MISMATCH"});
  expect(query.mock.calls[0][1]).toEqual(["foreign","pool"]);expect(completeOfficeModel).not.toHaveBeenCalled();
});
it("reads recent thread context with SELECT only and never triggers read-receipt, notifications or writes",async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{id:"req",student_id:"member",content:"요청"}]}).mockResolvedValueOnce({rows:[{id:"msg",sender_type:"parent",content:"문의"}]});
  const context=await readOfficeFormContext({query} as any,owner,"parent-reply","req");
  expect(context).toMatchObject({contextLimited:true,messages:[{id:"msg"}]});
  expect(query.mock.calls.every(([sql])=>/^SELECT /.test(sql))).toBe(true);
  expect(query.mock.calls[0][0]).not.toContain("admin_note");
  expect(query.mock.calls.every(([,params])=>params[1]==="pool")).toBe(true);
  expect(completeOfficeModel).not.toHaveBeenCalled();
});
it("rejects a delayed mocked result if source content changed and performs no business write",async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{id:"n",title:"before",content:"body"}]}).mockResolvedValueOnce({rows:[{id:"n",title:"changed",content:"body"}]});
  vi.mocked(completeOfficeModel).mockResolvedValue('{"kind":"form-draft","data":{"content":"초안"}}');
  await expect(draftOfficeForm({query} as any,owner,{formKind:"notice",recordId:"n",text:"현재 공지 다듬기",draftContext:{content:"body"}})).rejects.toMatchObject({code:"STALE_CONTEXT"});
  expect(query.mock.calls.every(([sql])=>/^SELECT /.test(sql))).toBe(true);
});
it("binds the successful mocked text to the exact selected request, not any inferred receiver",async()=>{
  const query=vi.fn().mockImplementation(async(sql:string)=>({rows:sql.includes("FROM parent_student_requests")?[{id:"req",student_id:"member",content:"요청"}]:[]}));
  vi.mocked(completeOfficeModel).mockResolvedValue('{"kind":"form-draft","data":{"content":"확인 후 안내드리겠습니다."}}');
  const result=await draftOfficeForm({query} as any,owner,{formKind:"parent-reply",recordId:"req",text:"답장 초안",draftContext:{content:""}});
  expect(result).toMatchObject({kind:"form-draft",formKind:"parent-reply",recordId:"req",data:{content:"확인 후 안내드리겠습니다."},contextLimited:true});
  expect(query.mock.calls.every(([sql])=>/^SELECT /.test(sql))).toBe(true);
});
