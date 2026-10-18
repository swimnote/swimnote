import {it,expect} from "vitest";
import {validateRunPlan,validateTransportGps,transportApproach,checkTransportCommand,transportState,nextTransportStep,transportHint,recalculateTransport,type TransportRunPlan,type TransportEvent,type TransportCommand} from "@workspace/api-zod";
import {reviewRun} from "../transport-v2-store.js";
let n=0;const id=()=>`00000000-0000-4000-8000-${String(++n).padStart(12,"0")}`;
const actor="users:driver",at="2026-10-19T00:00:00Z";
export function sample():TransportRunPlan{
  const steps:any[]=[{id:"center-start",action:"CENTER_BOARD",studentIds:["a","b","c"],time:"09:00"}];
  ["a","b","c","d","e","f"].forEach((x,i)=>steps.push({id:x,stopId:x,action:i<3?"DROP":"PICKUP",studentIds:[x],time:`${i<5?"09":"10"}:${String(i<5?(i+1)*10:0).padStart(2,"0")}`}));
  steps.push({id:"center-end",action:"CENTER_HANDOVER",studentIds:["d","e","f"],time:"10:10"});
  return {name:"합성 혼합 운행",date:"2026-10-19",vehicleId:"v",driverId:"d",escortId:"",capacity:3,startTime:"09:00",returnBy:"10:20",
    steps:steps.map(s=>({stopId:"CENTER",name:s.id,travelMinutes:0,fixed:false,...s}))};
}
function command(kind:TransportCommand["kind"],patch:Partial<TransportCommand>={}):TransportCommand{return {requestId:id(),revision:1,deviceAt:at,kind,...patch};}
function add(p:TransportRunPlan,events:TransportEvent[],c:TransportCommand){
  checkTransportCommand(p,events,c,actor,1);events.push({...c,actor,serverAt:at});
}
function started(){const p=sample(),e:TransportEvent[]=[];add(p,e,command("ACK"));add(p,e,command("START"));return {p,e};}
it("supports three drop-offs followed by three pickups using per-segment capacity",()=>{
  const p=sample();expect(validateRunPlan(p)).toBe(p);
  const x=structuredClone(p);x.capacity=2;expect(()=>validateRunPlan(x)).toThrow(/정원/);
});
it("rejects impossible center manifests, invalid dates, duplicate IDs and late return",()=>{
  for(const edit of [(p:TransportRunPlan)=>{p.steps[0].studentIds=[];},(p:TransportRunPlan)=>{p.date="2026-02-30";},(p:TransportRunPlan)=>{p.steps[2].id=p.steps[1].id;},(p:TransportRunPlan)=>{p.returnBy="09:30";}]){
    const p=sample();edit(p);expect(()=>validateRunPlan(p)).toThrow();
  }
});
it("requires current actor ACK, current version, start and actual boarding before alighting",()=>{
  const p=sample();expect(()=>checkTransportCommand(p,[],command("START"),actor,1)).toThrow(/수신/);
  const {e}=started();expect(()=>checkTransportCommand(p,e,command("ALIGHT",{stepId:"d",studentIds:["d"]}),actor,1)).toThrow();
  expect(()=>checkTransportCommand(p,e,command("BOARD",{stepId:"d",studentIds:["d"],revision:0}),actor,1)).toThrow(/버전/);
  expect(()=>checkTransportCommand(p,e,command("ACK"),actor,1)).toThrow(/이미/);
});
it("preserves A and B when C is confirmed first; viewing navigation does not record anything",()=>{
  const {p,e}=started();add(p,e,command("BOARD",{stepId:"center-start",studentIds:["a","b","c"]}));
  add(p,e,command("ALIGHT",{stepId:"c",studentIds:["c"]}));
  const before=JSON.stringify(e),state=transportState(p,e);
  expect(state.pending).toContain("a");expect(state.pending).toContain("b");expect(state.pending).not.toContain("c");
  expect(nextTransportStep(p,state.pending,"c")).toBe("d");expect(nextTransportStep(p,state.pending,"center-end")).toBe("a");
  expect(JSON.stringify(e)).toBe(before);
});
it("blocks actual capacity overflow even if driver processes out of planned order",()=>{
  const {p,e}=started();add(p,e,command("BOARD",{stepId:"center-start",studentIds:["a","b","c"]}));
  expect(()=>checkTransportCommand(p,e,command("BOARD",{stepId:"d",studentIds:["d"]}),actor,1)).toThrow(/정원/);
});
it("keeps correction and original; rejects non-last or another actor's correction",()=>{
  const {p,e}=started(),c=command("BOARD",{stepId:"center-start",studentIds:["a","b","c"]});add(p,e,c);
  expect(()=>checkTransportCommand(p,e,command("CORRECT",{corrects:c.requestId,reason:"오입력"}),"users:other",1)).toThrow();
  add(p,e,command("CORRECT",{corrects:c.requestId,reason:"실제 확인 전 잘못 누름"}));
  expect(e.some(x=>x.requestId===c.requestId)).toBe(true);expect(transportState(p,e).children.a.status).toBe("WAITING");
});
it("finishes only after center handover, all exceptions and explicit cabin/return checks",()=>{
  const {p,e}=started();add(p,e,command("BOARD",{stepId:"center-start",studentIds:["a","b","c"]}));
  for(const x of ["a","b","c"])add(p,e,command("ALIGHT",{stepId:x,studentIds:[x]}));
  add(p,e,command("NO_SHOW",{stepId:"d",studentIds:["d"]}));
  for(const x of ["e","f"])add(p,e,command("BOARD",{stepId:x,studentIds:[x]}));
  expect(()=>checkTransportCommand(p,e,command("FINISH",{cabinChecked:true,centerReturned:true}),actor,1)).toThrow(/미처리/);
  add(p,e,command("ALIGHT",{stepId:"center-end",studentIds:["e","f"]}));
  expect(()=>checkTransportCommand(p,e,command("FINISH"),actor,1)).toThrow(/최종/);
  add(p,e,command("FINISH",{cabinChecked:true,centerReturned:true}));
  expect(transportState(p,e).closed).toBe(true);expect(transportState(p,e).children.d.status).toBe("NO_SHOW");
});
it("deduplicates GPS/time hints without moving selection or creating events",()=>{
  const p=sample(),h=transportHint(p,["a","b"],[],1,0,"a");
  expect(h?.reason).toBe("GPS_APPROACH");expect(transportHint(p,["a","b"],[h!.key],1,1439,"a")).toBeNull();
  expect(transportHint(p,["a","b"],[],1,550)?.reason).toBe("SCHEDULE_TIME");
  expect(transportHint(p,["center-start","a"],[],1,1439,"a")).toBeNull();
});
it("partial registered-minute recalculation preserves earlier rows and never relaxes fixed anchors",()=>{
  const p=sample();p.steps[3].fixed=true;p.steps[3].travelMinutes=200;
  expect(()=>recalculateTransport(p,2)).toThrow(/고정/);
  p.steps[3].travelMinutes=5;
  const next=recalculateTransport(p,3);expect(next.plan.steps.slice(0,3)).toEqual(p.steps.slice(0,3));
  expect(next.plan.steps[3].time).toBe(p.steps[3].time);expect(next.source).toBe("REGISTERED_MINUTES_NOT_AI");
});
it("uses only explicitly verified GPS thresholds; no universal radius or dwell defaults",()=>{
  const gps={latitude:37,longitude:127,radiusMeters:80,dwellSeconds:10,verified:true as const};
  expect(validateTransportGps(gps)).toBe(gps);
  expect(()=>validateTransportGps({...gps,verified:false} as any)).toThrow(/현장/);
  expect(()=>validateTransportGps({...gps,latitude:91})).toThrow();
  expect(transportApproach(undefined,{latitude:37,longitude:127,accuracy:5,timestamp:1000},null,1000).near).toBe(false);
});
it("requires fresh accurate GPS and dwell; resets on leaving, stale samples and poor accuracy",()=>{
  const gps={latitude:37,longitude:127,radiusMeters:80,dwellSeconds:10,verified:true as const};
  const position={latitude:37,longitude:127,accuracy:5,timestamp:1000};
  const first=transportApproach(gps,position,null,1000);expect(first).toEqual({near:false,since:1000});
  expect(transportApproach(gps,{...position,timestamp:12000},first.since,12000).near).toBe(true);
  expect(transportApproach(gps,{...position,latitude:38},1000,2000).since).toBeNull();
  expect(transportApproach(gps,{...position,accuracy:300},1000,2000).near).toBe(false);
  expect(transportApproach(gps,position,1000,40000).near).toBe(false);
});
it("issues GPS-before-time once per run/version/stop, without an event or selection mutation",()=>{
  const p=sample(),h=transportHint(p,["a"],[],1,0,"a","run-a")!;
  expect(h.reason).toBe("GPS_APPROACH");expect(transportHint(p,["a"],[h.key],1,1439,undefined,"run-a")).toBeNull();
  expect(transportHint(p,["a"],[h.key],1,1439,undefined,"run-b")).not.toBeNull();
});
async function reviewed(events:TransportEvent[]){
  const p=sample(),ids=[...new Set(p.steps.flatMap(s=>s.studentIds))];
  const c={query:async(sql:string)=>{
    if(sql.includes("SELECT payload,actor,server_at"))return {rows:events.map(e=>({payload:e,actor:e.actor,server_at:at}))};
    if(sql.includes("kind='vehicle'"))return {rows:[{data:{capacity:p.capacity}}]};
    if(sql.includes("vehicle_availability"))return {rows:[{data:{weekdays:[1],start:"07:00",end:"20:00"}}]};
    if(sql.includes("SELECT id,duty"))return {rows:[{id:p.driverId,duty:"DRIVER"}]};
    if(sql.includes("kind='stop'"))return {rows:p.steps.map(s=>({id:s.stopId,data:{name:"변경된 master",address:"합성 주소"}}))};
    if(sql.includes("SELECT s.id,s.name"))return {rows:ids.map(id=>({id,name:id}))};
    return {rows:[]};
  }};
  return {original:p,result:await reviewRun(c as any,"pool",p,"run")};
}
it("does not rewrite processed stop snapshots from later master edits",async()=>{
  const {p,e}=started();add(p,e,command("BOARD",{stepId:"center-start",studentIds:["a","b","c"]}));add(p,e,command("ALIGHT",{stepId:"c",studentIds:["c"]}));
  const {original,result}=await reviewed(e);
  expect(result.plan.steps.find(s=>s.id==="c")).toEqual(original.steps.find(s=>s.id==="c"));
  expect(result.plan.steps.find(s=>s.id==="a")?.name).toBe("변경된 master");
});
it("does not confuse ACK of a selected step with actual passenger confirmation",async()=>{
  const {result}=await reviewed([{...command("ACK",{stepId:"a"}),actor,serverAt:at}]);
  expect(result.plan.steps.find(s=>s.id==="a")?.name).toBe("변경된 master");
});
