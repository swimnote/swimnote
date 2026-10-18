import {beforeEach,it,expect,vi} from "vitest";
const {handlers}=vi.hoisted(()=>({handlers:new Map<string,Function>()}));
vi.mock("express",()=>({Router:()=>({use:vi.fn(),get:(p:string,h:Function)=>handlers.set(`get ${p}`,h),post:(p:string,h:Function)=>handlers.set(`post ${p}`,h)})}));
vi.mock("../../middlewares/auth.js",()=>({requireAuth:vi.fn()}));
import {createTransportV2Router} from "../transport-v2.js";
import {digest} from "../../lib/office-operations-data.js";
const at="2026-10-19T00:00:00Z",rid="00000000-0000-4000-8000-000000000001";
const plan={name:"합성",date:"2026-10-19",vehicleId:"v",driverId:"crew",escortId:"",capacity:3,startTime:"09:00",returnBy:"10:00",
  steps:[{id:"start",stopId:"CENTER",name:"센터",action:"CENTER_BOARD",time:"09:00",travelMinutes:0,fixed:false,studentIds:[]},
    {id:"pick",stopId:"stop",name:"합성 정류장",action:"PICKUP",time:"09:30",travelMinutes:0,fixed:false,studentIds:["own","foreign"]},
    {id:"end",stopId:"CENTER",name:"센터",action:"CENTER_HANDOVER",time:"10:00",travelMinutes:0,fixed:false,studentIds:["own","foreign"]}]};
beforeEach(()=>handlers.clear());
function fixture(options:{role?:string;assigned?:boolean;receipt?:any;events?:any[]}={}){
  const role=options.role??"teacher",query=vi.fn(async(sql:string,args?:any[])=>{
    if(sql.includes("to_regclass"))return {rows:[{ready:true}]};
    if(sql.startsWith("SELECT id,name,swimming_pool_id"))return {rows:[{id:"account",name:"합성",swimming_pool_id:"pool",roles:[role]}]};
    if(sql.startsWith("SELECT id FROM swimming_pools"))return {rows:[{id:"pool"}]};
    if(sql.includes("SELECT actor_id,input_hash,result"))return {rows:options.receipt?[options.receipt]:[]};
    if(sql.includes("SELECT * FROM office_transport_runs"))return {rows:[{id:"run",pool_id:"pool",revision:2,status:"PUBLISHED",plan}]};
    if(sql.includes("SELECT id FROM office_transport_memberships"))return {rows:options.assigned===false?[]:[{id:"crew"}]};
    if(sql.startsWith("SELECT student_id,transport_notify"))return {rows:[{student_id:"own",transport_notify:false}]};
    if(sql.startsWith("SELECT id,revision,status,plan"))return {rows:[{id:"run",revision:2,status:"PUBLISHED",plan}]};
    if(sql.startsWith("SELECT payload,actor,server_at"))return {rows:(options.events??[]).map(payload=>({payload,actor:"users:account",server_at:at}))};
    return {rows:[]};
  });
  createTransportV2Router({query,connect:async()=>({query,release:vi.fn()})} as any);
  async function call(key:string,body:any={},id="run"){
    const response={status:vi.fn().mockReturnThis(),json:vi.fn()};
    await handlers.get(key)!({user:{userId:"account",poolId:"pool",role},params:{id},body,path:key.slice(key.indexOf(" ")+1).replace(":id",id),query:{}},response);
    return response;
  }
  return {query,call};
}
it("uses actual current administrator role checks, not a driver grant as teacher/admin access",async()=>{
  const f=fixture(),r=await f.call("get /admin");
  expect(r.status).toHaveBeenCalledWith(403);expect(f.query.mock.calls.some(([sql])=>sql.includes("ORDER BY updated_at"))).toBe(false);
});
it("blocks revoked/foreign driver access before returning manifests or guardian contacts",async()=>{
  const f=fixture({assigned:false}),r=await f.call("get /runs/:id");
  expect(r.status).toHaveBeenCalledWith(403);expect(f.query.mock.calls.some(([sql])=>sql.includes("parent_phone"))).toBe(false);
});
it("projects only the approved parent's own child, with no peer IDs or contact fields",async()=>{
  const f=fixture({role:"parent_account"}),r=await f.call("get /parent"),result=r.json.mock.calls[0][0];
  expect(result.items).toHaveLength(1);expect(result.items[0].studentId).toBe("own");
  expect(JSON.stringify(result)).not.toContain("foreign");expect(JSON.stringify(result)).not.toContain("parent_phone");
  const relation=f.query.mock.calls.find(([s])=>s.startsWith("SELECT student_id,transport_notify"));
  expect(relation?.[0]).toContain("status='approved'");expect(relation?.[1]).toEqual(["account","pool"]);
});
it("replays exactly one actor-owned event receipt without another event or notification intent",async()=>{
  const body={requestId:rid,revision:2,kind:"ACK",deviceAt:at},result={requestId:rid,event:{requestId:rid}};
  const f=fixture({receipt:{actor_id:"users:account",input_hash:digest({path:"/runs/run/events",body}),result:{transportScope:{admin:false,runId:"run"},value:result}}});
  const r=await f.call("post /runs/:id/events",body);expect(r.json).toHaveBeenCalledWith(result);
  expect(f.query.mock.calls.some(([s])=>s.startsWith("INSERT"))).toBe(false);
});
it("does not disclose an old receipt after assignment revocation",async()=>{
  const body={requestId:rid,revision:2,kind:"ACK",deviceAt:at};
  const f=fixture({assigned:false,receipt:{actor_id:"users:account",input_hash:digest({path:"/runs/run/events",body}),result:{transportScope:{admin:false,runId:"run"},value:{requestId:rid}}}});
  expect((await f.call("post /runs/:id/events",body)).status).toHaveBeenCalledWith(403);
});
it("preserves old-version input as a conflict instead of inserting into the new plan",async()=>{
  const f=fixture(),r=await f.call("post /runs/:id/events",{requestId:rid,revision:1,kind:"ACK",deviceAt:at});
  expect(r.status).toHaveBeenCalledWith(409);expect(r.json.mock.calls[0][0].code).toBe("VERSION_CHANGED");
  expect(f.query.mock.calls.some(([s])=>s.startsWith("INSERT"))).toBe(false);
});
it("stores event, receipt and no push dispatch for ACK in one transaction",async()=>{
  const f=fixture(),r=await f.call("post /runs/:id/events",{requestId:rid,revision:2,kind:"ACK",deviceAt:at});
  expect(r.json.mock.calls[0][0].requestId).toBe(rid);
  expect(f.query.mock.calls.filter(([s])=>s.startsWith("INSERT INTO office_transport_events"))).toHaveLength(1);
  expect(f.query.mock.calls.filter(([s])=>s.startsWith("INSERT INTO office_operation_receipts"))).toHaveLength(1);
  expect(r.json.mock.calls[0][0].push).toBe("NOT_SENT");
});
it("requires an owned approved child for notification choice",async()=>{
  const f=fixture({role:"parent_account"}),r=await f.call("post /parent/preferences",{requestId:rid,studentId:"foreign",enabled:true});
  expect(r.status).toHaveBeenCalledWith(403);
  const update=f.query.mock.calls.find(([s])=>s.startsWith("UPDATE parent_students"));
  expect(update?.[0]).toContain("status='approved'");expect(update?.[1]).toEqual(["account","foreign","pool",true]);
});
