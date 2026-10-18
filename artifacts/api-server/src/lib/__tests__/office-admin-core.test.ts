import { describe,it,expect } from "vitest";
import { validateData, previewImport, digest, date, requestId } from "../office-operations-data.js";
import { parseImportRules,importModelEnabled } from "../office-import-ai.js";

describe("OFFICE administrator core pure boundary checks (no DB/auth/model calls)",()=>{
  it.each([
    [{OFFICE_STAGE3_AI_ENABLED:"true"},false],
    [{OFFICE_IMPORT_AI_ENABLED:"false",OFFICE_STAGE3_AI_ENABLED:"true"},false],
    [{OFFICE_IMPORT_AI_ENABLED:"true"},true],
  ] as const)("separates import approval from paid workspace activation %j",(env,enabled)=>{
    expect(importModelEnabled(env)).toBe(enabled);
  });
  it.each([-1,1.5,NaN,Infinity])("rejects invalid money %s",priceKrw=>{
    expect(()=>validateData("products",{name:"수강",priceKrw,lessonCount:4,validDays:30})).toThrow();
  });
  it("retains integer price and strips client-owned authorization fields",()=>{
    expect(validateData("products",{name:"수강",priceKrw:0,lessonCount:4,validDays:30,poolId:"foreign",actorId:"other"}))
      .toEqual({name:"수강",priceKrw:0,lessonCount:4,validDays:30});
  });
  it.each(["2026-02-30","2026-13-01","2026-1-1","not-a-date"])("rejects invalid date %s",v=>expect(()=>date(v)).toThrow());
  it("requires actual student link before registered contact",()=>{
    expect(()=>validateData("contacts",{name:"상담",phone:"01000000000",stage:"registered"})).toThrow();
  });
  it("rejects crossing midnight/negative lesson durations",()=>{
    expect(()=>validateData("sessions",{classId:"c",date:"2026-10-18",startTime:"14:00",endTime:"13:00",capacity:5,status:"scheduled"})).toThrow();
  });
  it("normalizes card identity before unique-index enforcement",()=>{
    expect(validateData("cards",{studentId:"s",cardUid:"AA:BB:CC:DD",status:"active"}).cardUid).toBe("AABBCCDD");
  });
  it.each(["javascript:alert(1)","https://user:password@example.invalid"])("rejects unsafe marketing address %s",managementUrl=>{
    expect(()=>validateData("marketing",{name:"홍보",channel:"네이버",status:"draft",managementUrl})).toThrow();
  });
  it("requires evidence link for manually posted status",()=>{
    expect(()=>validateData("marketing",{name:"홍보",channel:"네이버",status:"posted_manual"})).toThrow();
  });
  it("does not let a file or model create tools or authorities",()=>{
    expect(()=>parseImportRules('{"rules":{"executeSql":"이름"}}',["이름"])).toThrow();
    expect(()=>parseImportRules('{"rules":{"name":"unknown"}}',["이름"])).toThrow();
    expect(parseImportRules('{"rules":{"name":"이름"},"question":""}',["이름"]).rules).toEqual({name:"이름"});
  });
  it("fingerprints canonical input independently of key ordering",()=>{
    expect(digest({b:2,a:1})).toBe(digest({a:1,b:2}));
    expect(digest({a:2})).not.toBe(digest({a:1}));
  });
  it.each(["bad","../../id",""])("requires a real request UUID %s",v=>expect(()=>requestId(v)).toThrow());
  const draft={files:[{name:"members.xlsx",sheet:"회원",rows:[
    {성명:"회원 가",보호자:"+82 10-0000-0000",반:"기초"},
    {성명:"회원 가",보호자:"01000000000",반:"기초"},
    {성명:"회원 나",보호자:"",반:"없는반"},
  ]}],rules:{name:"성명",parent_phone:"보호자",class_name:"반"}};
  it("tracks source file/sheet/row; normalizes phones and holds duplicates/unknown classes",()=>{
    const p=previewImport(draft,[],[{id:"c",name:"기초"}]);
    expect(p.ready).toBe(1);expect(p.held).toBe(2);
    expect(p.rows[0].source).toEqual({file:"members.xlsx",sheet:"회원",row:2});
    expect(p.rows[0].normalized).toMatchObject({parent_phone:"01000000000",class_group_id:"c"});
    expect(p.rows[1].errors.join()).toContain("중복");
    expect(p.rows[2].errors.join()).toContain("반 이름");
  });
  it("holds existing members instead of overwriting newer operational data",()=>{
    const p=previewImport(draft,[{name:"회원 가",parent_phone:"01000000000"}],[{id:"c",name:"기초"}]);
    expect(p.ready).toBe(0);
    expect(p.rows[0].errors.join()).toContain("자동 덮어쓰기 금지");
  });
  it("holds duplicate files even after renaming",()=>{
    const p=previewImport({...draft,files:[draft.files[0],{...draft.files[0],name:"copy.xlsx"}]},[],[{id:"c",name:"기초"}]);
    expect(p.rows[3].errors).toContain("중복 파일·시트");
  });
});
