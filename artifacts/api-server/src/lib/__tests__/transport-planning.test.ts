import {it,expect} from "vitest";
import {calculateTransportDraft,checkTransportWindows,emptyTransportSettings,type TransportCandidate} from "../../../../../lib/api-zod/src/transport-planning";
import {dispatchTransportIntents} from "../transport-push-dispatch";
import {transportAiProposal} from "../transport-ai-proposal";
const settings=()=>({...emptyTransportSettings(),departureBufferMinutes:5,handoverBufferMinutes:5,
  travel:[{from:"CENTER",to:"stop",minutes:10,evidence:"operator measured"},{from:"stop",to:"CENTER",minutes:10,evidence:"operator measured"}]});
const plan=()=>({name:"Fixture",date:"2026-10-19",vehicleId:"v",driverId:"d",escortId:"",capacity:2,startTime:"09:00",returnBy:"10:00",
  steps:[{id:"start",action:"CENTER_BOARD" as const,stopId:"CENTER",name:"Center",time:"09:00",travelMinutes:0,fixed:false,studentIds:[]},
    {id:"end",action:"CENTER_HANDOVER" as const,stopId:"CENTER",name:"Center",time:"10:00",travelMinutes:10,fixed:false,studentIds:[]}]});
const candidate=(id="s"):TransportCandidate=>({studentId:id,name:id,enabled:true,inboundStopId:"",outboundStopId:"stop",handover:"Guardian",
  windows:[{classId:"cg",start:"08:00",end:"08:50",source:"CLASS_HISTORY_SCHEDULE"}],issues:[]});
it("constructs a real deterministic drop draft with registered directional times",()=>{
  const r=calculateTransportDraft(plan(),[candidate()],settings(),[{id:"stop",name:"Stop"}]);
  expect(r.complete).toBe(true);expect(r.plan.steps.map(x=>x.action)).toEqual(["CENTER_BOARD","DROP","CENTER_HANDOVER"]);
  expect(r.plan.steps[1].time).toBe("09:10");expect(r.source).toBe("DETERMINISTIC_CONSTRAINT_DRAFT");expect(r.applied).toBe(false);
});
it("reports missing movement evidence instead of inventing road times",()=>{
  const s=settings();s.travel=[];const r=calculateTransportDraft(plan(),[candidate()],s,[{id:"stop",name:"Stop"}]);
  expect(r.complete).toBe(false);expect(r.unassigned[0].reason).toMatch(/이동시간/);
});
it("preserves fixed order and time; cannot silently break a fixed return",()=>{
  const p=plan();p.steps[1].time="09:05";p.steps[1].fixed=true;
  const r=calculateTransportDraft(p,[candidate()],settings(),[{id:"stop",name:"Stop"}]);
  expect(r.complete).toBe(false);expect(r.plan.steps.at(-1)?.time).toBe("09:05");
});
it("does not omit unknown class times from unassigned evidence",()=>{
  const c=candidate();c.windows=[];c.issues=["실제 종료 시각 없음"];
  const r=calculateTransportDraft(plan(),[c],settings(),[{id:"stop",name:"Stop"}]);
  expect(r.unassigned).toEqual([{studentId:"s",reason:"실제 종료 시각 없음"}]);expect(r.complete).toBe(false);
});
it("enforces arrival before the actual next class and handover buffer",()=>{
  const c=candidate();c.windows=[{classId:"cg",start:"09:19",end:"10:00",source:"ASSIGNED_MAKEUP"}];c.inboundStopId="stop";c.outboundStopId="";
  const r=calculateTransportDraft(plan(),[c],settings(),[{id:"stop",name:"Stop"}]);
  expect(r.complete).toBe(false);expect(r.unassigned[0].reason).toMatch(/수업 시작/);
});
it("enforces both explicit transport place and center departure buffer",()=>{
  const p:any=plan();p.steps.splice(1,0,{id:"drop",action:"DROP",stopId:"foreign",name:"Stop",time:"09:10",travelMinutes:10,fixed:false,studentIds:["s"]});p.steps[0].studentIds=["s"];
  const s=settings();s.departureBufferMinutes=20;
  expect(checkTransportWindows(p,[candidate()],s)).toEqual(expect.arrayContaining([expect.stringContaining("출발 버퍼"),expect.stringContaining("장소 불일치")]));
});
it("does not connect to a DB or send without a new exact operating approval",async()=>{
  const pool={connect:()=>{throw Error("unexpected database");}} as any;
  expect(await dispatchTransportIntents(pool,undefined,async()=>{throw Error("unexpected provider");})).toEqual({held:true,attempted:0});
});
it("cannot reuse the exhausted model trials or enable a paid model from request JSON",async()=>{
  const pool={connect:()=>{throw Error("unexpected database");}} as any;
  await expect(transportAiProposal(pool,undefined,{key:"users:a",poolId:"p"},{plan:plan(),text:"09:00 출발",model:"request-owned",approved:true},[],settings(),[]))
    .rejects.toMatchObject({status:403,code:"TRANSPORT_MODEL_APPROVAL_REQUIRED"});
});
