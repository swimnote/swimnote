import {it,expect,vi} from "vitest";
import {createOfficeTransportRouter} from "../office-transport.js";
import {digest} from "../../lib/office-operations-data.js";
const owner={userId:"synthetic-admin",poolId:"synthetic-pool",role:"pool_admin" as const};
const rid="11111111-1111-4111-8111-111111111111";
function fixture(query:ReturnType<typeof vi.fn>,role:any="pool_admin"){
  const pool:any={query,connect:vi.fn(async()=>({query,release:vi.fn()}))};
  const router=createOfficeTransportRouter(pool,async()=>({...owner,role}));
  const call=async(method:string,path:string,body:any={},id?:string)=>{
    const layer=(router as any).stack.find((x:any)=>x.route?.path===path&&x.route.methods[method]);
    const res:any={status:vi.fn(function(this:any){return this;}),json:vi.fn()};
    await layer.route.stack[0].handle({body,params:{id:id??(path.includes(":id")?"record":undefined)}},res);return res;
  };
  return {pool,call};
}
it("rejects teacher access before any schema or private data read",async()=>{
  const query=vi.fn(),f=fixture(query,"teacher"),r=await f.call("get","/");
  expect(r.status).toHaveBeenCalledWith(403);expect(query).not.toHaveBeenCalled();
});
it("reports missing additive schema explicitly and does not create it",async()=>{
  const query=vi.fn(async()=>({rows:[{ready:false}]})),f=fixture(query),r=await f.call("get","/");
  expect(r.status).toHaveBeenCalledWith(503);expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][0]).not.toMatch(/CREATE|ALTER/);
});
it("scopes historical snapshot lookup to actor pool and rejects absent/foreign records",async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("to_regclass")?[{ready:true}]:[]})),f=fixture(query),r=await f.call("get","/snapshots/:id",{},"foreign");
  expect(r.status).toHaveBeenCalledWith(404);expect(query.mock.calls[1][1]).toEqual(["foreign",owner.poolId]);
});
it("replays only an identical actor-owned receipt, with no insert or repeated approval",async()=>{
  const body={requestId:rid,kind:"stop",data:{name:"합성",address:"합성",status:"active"}};
  const result={item:{id:"saved",kind:"stop",revision:1,data:body.data}};
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("to_regclass")?[{ready:true}]:sql.includes("SELECT actor_id")?
    [{actor_id:owner.userId,input_hash:digest({approve:false,id:null,body}),result}]:[]}));
  const f=fixture(query),r=await f.call("post","/records",body,undefined as any);
  expect(r.json).toHaveBeenCalledWith(result);expect(query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);
});
it("refuses a receipt owned by another actor without an insert",async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("to_regclass")?[{ready:true}]:sql.includes("SELECT actor_id")?[{actor_id:"other",input_hash:"other"}]:[]}));
  const f=fixture(query),r=await f.call("post","/records",{requestId:rid},undefined as any);
  expect(r.status).toHaveBeenCalledWith(409);expect(query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);
});
it("checks revision before modifying a stored record",async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("to_regclass")?[{ready:true}]:sql.includes("FOR UPDATE")?[{id:"record",kind:"stop",revision:2,data:{}}]:[]}));
  const f=fixture(query),r=await f.call("patch","/records/:id",{requestId:rid,expectedRevision:1});
  expect(r.status).toHaveBeenCalledWith(409);expect(query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
});
it("does not allow vehicle records to be approved as route plans",async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("to_regclass")?[{ready:true}]:sql.includes("FOR UPDATE")?[{id:"record",kind:"vehicle",revision:1,data:{}}]:[]}));
  const f=fixture(query),r=await f.call("post","/plans/:id/approve",{requestId:rid,expectedRevision:1,confirmed:true,previewHash:"invalid"});
  expect(r.status).toHaveBeenCalledWith(409);expect(query.mock.calls.some(([sql])=>sql.includes("INSERT INTO office_transport_snapshots"))).toBe(false);
});
it("rejects foreign driver assignment and rolls back without storing a record or receipt",async()=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("to_regclass")?[{ready:true}]:[]}));
  const f=fixture(query),r=await f.call("post","/records",{requestId:rid,kind:"vehicle",data:{name:"합성",plate:"합성",capacity:3,driverId:"foreign",status:"active"}},undefined as any);
  expect(r.status).toHaveBeenCalledWith(403);expect(query.mock.calls.some(([sql])=>sql==="ROLLBACK")).toBe(true);
  expect(query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);
});
function approvalFixture(){
  let driverName="합성 기사";
  const data={name:"합성 배차",weekday:1,direction:"INBOUND",vehicleId:"vehicle",classGroupId:"class",classTime:"10:00",earliestTime:"09:00",bufferMinutes:10,toCenterMinutes:10,sourceSnapshotId:"",
    stops:[{stopId:"stop",time:"09:10",travelMinutes:0,fixed:false,studentIds:["a"]}]};
  const records=[{id:"vehicle",kind:"vehicle",revision:1,data:{name:"합성",plate:"합성",capacity:3,driverId:"driver",status:"active"}},
    {id:"stop",kind:"stop",revision:1,data:{name:"합성 승차지",address:"합성 위치",status:"active"}}];
  const query=vi.fn(async(sql:string,params?:any[])=>{
    if(sql.includes("to_regclass"))return {rows:[{ready:true}]};
    if(sql.includes("kind='plan'")||sql.includes("FOR UPDATE"))return {rows:[{id:"record",kind:"plan",revision:1,data}]};
    if(sql.includes("FROM office_transport_records"))return {rows:records};
    if(sql.includes("FROM students"))return {rows:[{id:"a",name:"합성 회원"}]};
    if(sql.includes("FROM users"))return {rows:[{id:"driver",name:driverName}]};
    if(sql.includes("FROM class_groups"))return {rows:[{id:"class",name:"합성 반"}]};
    if(sql.includes("INSERT INTO office_transport_snapshots"))return {rows:[{id:params![0],plan_id:"record",plan_revision:1,content_hash:params![5]}]};
    return {rows:[]};
  });
  return {...fixture(query),query,setDriverName:(v:string)=>{driverName=v;}};
}
it("stores only the exact reviewed immutable snapshot and receipt in one transaction",async()=>{
  const f=approvalFixture(),preview=await f.call("get","/plans/:id/preview");
  const p=preview.json.mock.calls[0][0];expect(p.previewHash).toBe(digest(p.preview));
  const approved=await f.call("post","/plans/:id/approve",{requestId:rid,expectedRevision:1,confirmed:true,previewHash:p.previewHash});
  expect(approved.json.mock.calls[0][0]).toMatchObject({status:"APPROVED_NOT_DISPATCHED",driverDelivery:"NOT_IMPLEMENTED"});
  const insert=f.query.mock.calls.find(([sql])=>sql.includes("INSERT INTO office_transport_snapshots"));
  expect(JSON.parse(insert![1]![4]).driver.name).toBe("합성 기사");
  expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO office_operation_receipts"))).toBe(true);
  expect(f.query.mock.calls.filter(([sql])=>sql==="COMMIT")).toHaveLength(1);
});
it("refuses approval when reference names change after preview without producing a snapshot",async()=>{
  const f=approvalFixture(),preview=await f.call("get","/plans/:id/preview"),p=preview.json.mock.calls[0][0];
  f.setDriverName("변경된 합성 기사");
  const r=await f.call("post","/plans/:id/approve",{requestId:rid,expectedRevision:1,confirmed:true,previewHash:p.previewHash});
  expect(r.status).toHaveBeenCalledWith(409);
  expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO office_transport_snapshots"))).toBe(false);
});
