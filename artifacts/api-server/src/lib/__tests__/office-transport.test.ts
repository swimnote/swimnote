import {it,expect} from "vitest";
import {transportData,reviewTransportPlan,preserveTransportAnchors,rejectTransportOverlap,type TransportRecord} from "../office-transport.js";
const vehicle={id:"vehicle",kind:"vehicle",revision:1,data:{name:"합성 차량",plate:"합성",capacity:3,driverId:"driver",status:"active"}} as TransportRecord;
const stop={id:"stop",kind:"stop",revision:1,data:{name:"합성 승차지",address:"합성 위치",status:"active"}} as TransportRecord;
const raw=()=>({name:"합성 월요일",weekday:1,direction:"INBOUND",vehicleId:"vehicle",classGroupId:"class",classTime:"10:00",earliestTime:"09:00",bufferMinutes:10,toCenterMinutes:10,
  stops:[{stopId:"stop",time:"09:10",travelMinutes:0,fixed:true,studentIds:["a","b","c"]}]});
const students=["a","b","c"].map(id=>({id,name:`합성 ${id}`}));
const plan=()=>transportData("plan",raw());
const review=(p:any,records=[vehicle,stop])=>reviewTransportPlan(p,records,students);
it("validates manual preparation without model, road ETA or delivery claims",()=>{
  expect(review(plan())).toMatchObject({studentCount:3,navigation:false,timingSource:"administrator_registered_minutes",driverDelivery:"NOT_IMPLEMENTED"});
});
it("refuses arbitrary fields and invalid kind instead of treating input as commands",()=>{
  expect(()=>transportData("vehicle",{...vehicle.data,send_push:true})).toThrow();
  expect(()=>transportData("driver" as any,{})).toThrow();
});
it("refuses capacity overflow rather than changing the constraint",()=>{
  expect(()=>review(plan(),[{...vehicle,data:{...vehicle.data,capacity:2}},stop])).toThrow(/정원/);
});
it("does not accept foreign, inactive or missing assets",()=>{
  expect(()=>review(plan(),[vehicle])).toThrow(/승차지/);
  expect(()=>review(plan(),[{...vehicle,data:{...vehicle.data,status:"inactive"}},stop])).toThrow(/차량/);
});
it("requires an assigned driver at approval time",()=>{
  expect(()=>review(plan(),[{...vehicle,data:{...vehicle.data,driverId:""}},stop])).toThrow(/기사/);
});
it("does not accept duplicate student assignments even within the same stop",()=>{
  const r=raw();r.stops[0].studentIds=["a","a"];
  expect(()=>transportData("plan",r)).toThrow(/중복/);
});
it("does not accept duplicate stops or a missing student",()=>{
  const r=raw();r.stops.push({...r.stops[0],studentIds:["other"]});
  expect(()=>transportData("plan",r)).toThrow(/중복/);
  const p=plan();(p as any).stops[0].studentIds=["foreign"];
  expect(()=>review(p)).toThrow(/회원/);
});
it("blocks invalid clock, weekday, negative travel and impossible class buffer",()=>{
  for(const patch of [{weekday:8},{classTime:"24:00"},{toCenterMinutes:-1}])expect(()=>transportData("plan",{...raw(),...patch})).toThrow();
  expect(()=>review(transportData("plan",{...raw(),classTime:"09:20"}))).toThrow(/여유/);
});
it("enforces earliest time and registered travel between stops",()=>{
  expect(()=>review(transportData("plan",{...raw(),earliestTime:"09:20"}))).toThrow(/최소/);
  const r=raw();r.stops[0].studentIds=["a"];
  r.stops.push({stopId:"second",time:"09:15",travelMinutes:10,fixed:false,studentIds:["b"]});
  expect(()=>review(transportData("plan",r),[vehicle,stop,{...stop,id:"second"}])).toThrow(/이동시간/);
});
it("treats inbound first stop as the pickup start, never a calculated depot route",()=>{
  const r=raw();r.stops[0].travelMinutes=15;
  expect(()=>transportData("plan",r)).toThrow(/첫 승차지/);
});
it("keeps outbound class-end buffer distinct from inbound arrival",()=>{
  const r={...raw(),direction:"OUTBOUND",classTime:"09:30",earliestTime:"09:30"};r.stops[0].time="09:35";
  expect(()=>review(transportData("plan",r))).toThrow();
  r.stops[0].time="09:45";expect(review(transportData("plan",r)).studentCount).toBe(3);
});
it("requires explicit anchor release with unchanged time before a later edit",()=>{
  const old=raw(),next=raw();next.stops[0].time="09:20";
  expect(()=>preserveTransportAnchors(old,next)).toThrow(/고정/);
  next.stops[0].time="09:10";next.stops[0].fixed=false;
  expect(()=>preserveTransportAnchors(old,next)).not.toThrow();
  const later=structuredClone(next);later.stops[0].time="09:20";
  expect(()=>preserveTransportAnchors(next,later)).not.toThrow();
});
it("preserves historical snapshots while reviewing copied drafts",()=>{
  const old=raw(),before=JSON.stringify(old),next=transportData("plan",{...old,sourceSnapshotId:"original"});
  review(next);expect(JSON.stringify(old)).toBe(before);
});
it("blocks overlapping vehicle, driver and student schedules across latest snapshots",()=>{
  const a={...review(plan()),driver:{id:"driver"}};
  expect(()=>rejectTransportOverlap(a,[{snapshot:a}])).toThrow(/겹칩니다/);
  const other=structuredClone(a);other.vehicle.id="other";other.driver.id="other";
  expect(()=>rejectTransportOverlap(a,[{snapshot:other}])).toThrow();
  other.plan.weekday=2;expect(()=>rejectTransportOverlap(a,[{snapshot:other}])).not.toThrow();
});
it("does not treat two zero-minute same-time assignments as nonoverlap",()=>{
  const a={...review(plan()),driver:{id:"driver"}};
  a.plan.toCenterMinutes=0;
  expect(()=>rejectTransportOverlap(a,[{snapshot:a}])).toThrow();
});
