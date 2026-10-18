import {it,expect} from "vitest";
import {createTransportVault,transportRequestId} from "../transport-vault";
function storage(){const rows=new Map<string,string>();return {rows,get:async(k:string)=>rows.get(k)??null,set:async(k:string,v:string)=>{rows.set(k,v);},remove:async(k:string)=>{rows.delete(k);}};}
it("persists exact request/body across a new vault instance and isolates owners",async()=>{
  const s=storage(),a=createTransportVault(s),rid=transportRequestId();
  await a.mutate("users:a:pool",v=>({...v,runId:"r",queue:[{runId:"r",command:{requestId:rid,revision:2,kind:"BOARD",deviceAt:"2026-10-19T00:00:00Z",stepId:"s",studentIds:["child"]}}]}));
  const b=createTransportVault(s);expect((await b.read("users:a:pool")).queue[0].command.requestId).toBe(rid);
  expect((await b.read("users:b:pool")).queue).toEqual([]);
});
it("does not replace the committed queue when a chunk write fails",async()=>{
  const s=storage(),a=createTransportVault(s);await a.mutate("owner",v=>({...v,runId:"old"}));
  const bad=createTransportVault({...s,set:async(k:string,v:string)=>{if(k.includes("_0"))throw Error("storage unavailable");await s.set(k,v);}});
  await expect(bad.mutate("owner",v=>({...v,runId:"new"}))).rejects.toThrow();
  expect((await a.read("owner")).runId).toBe("old");
});
it("serializes local confirmations and chunks Unicode below native item limits",async()=>{
  const s=storage(),a=createTransportVault(s);
  await Promise.all([1,2].map(n=>a.mutate("owner",v=>({...v,hints:[...v.hints,String(n)],manifest:{names:"합성".repeat(2000)}}))));
  expect((await a.read("owner")).hints).toEqual(["1","2"]);expect([...s.rows.values()].every(v=>Buffer.byteLength(v)<=1800)).toBe(true);
});
it("fails closed on a missing committed chunk instead of returning an empty queue",async()=>{
  const s=storage(),a=createTransportVault(s);await a.mutate("owner",v=>({...v,runId:"r"}));
  s.rows.delete([...s.rows.keys()].find(k=>k.endsWith("_0"))!);
  await expect(a.read("owner")).rejects.toThrow(/일부/);
});
it("serializes readers with head replacement and old-chunk cleanup",async()=>{
  const s=storage();let pause=false,release!:()=>void,entered!:()=>void;
  const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  const a=createTransportVault({...s,get:async k=>{
    const value=await s.get(k);
    if(pause&&!k.endsWith("_0")){pause=false;entered();await gate;}
    return value;
  }});
  await a.mutate("owner",v=>({...v,runId:"old"}));pause=true;
  const reading=a.read("owner");await ready;
  const writing=a.mutate("owner",v=>({...v,runId:"new"}));release();
  expect((await reading).runId).toBe("old");await writing;expect((await a.read("owner")).runId).toBe("new");
});
