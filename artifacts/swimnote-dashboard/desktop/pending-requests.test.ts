import {afterEach,it,expect} from "vitest";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {PendingRequestStore} from "./session-ipc.cjs";
const dirs:string[]=[];
async function setup(){const dir=await mkdtemp(path.join(tmpdir(),"office-pointer-"));dirs.push(dir);return {dir,store:new PendingRequestStore(dir)};}
const owner="a".repeat(64),other="b".repeat(64);
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
it("survives a fresh store; contains no body and exposes only this owner's pointers",async()=>{
  const {dir,store}=await setup();
  await store.apply({op:"begin",owner,requestId:"request-1",path:"/office/operations/contracts"});
  const fresh=new PendingRequestStore(dir);
  expect(await fresh.apply({op:"list",owner:other})).toEqual([]);
  const rows=await fresh.apply({op:"list",owner});
  expect(rows).toHaveLength(1);expect(rows[0].requestId).toBe("request-1");
  expect(Object.keys(rows[0]).sort()).toEqual(["createdAt","path","requestId"]);
  expect(Object.keys(JSON.parse(await readFile(path.join(dir,"office-pending-requests.json"),"utf8"))[0]).sort()).toEqual(["createdAt","owner","path","requestId"]);
  await fresh.apply({op:"finish",owner:other,requestId:"request-1"});
  expect(await fresh.apply({op:"list",owner})).toHaveLength(1);
  await fresh.apply({op:"finish",owner,requestId:"request-1"});
  expect(await new PendingRequestStore(dir).apply({op:"list",owner})).toEqual([]);
});
it("serializes simultaneous begin calls and blocks the same resource lane",async()=>{
  const {store}=await setup();
  const r=await Promise.allSettled(["r1","r2"].map(requestId=>store.apply({op:"begin",owner,requestId,path:"/office/operations/contracts"})));
  expect(r.map(x=>x.status).sort()).toEqual(["fulfilled","rejected"]);
  await store.apply({op:"begin",owner,requestId:"r3",path:"/office/operations/enrollments"});
  expect(await store.apply({op:"list",owner})).toHaveLength(2);
});
it("fails closed on corrupt files and rejects payloads or traversal",async()=>{
  const {dir,store}=await setup();
  await expect(store.apply({op:"begin",owner,requestId:"r",path:"/office/operations/../token"})).rejects.toThrow();
  await expect(store.apply({op:"begin",owner,requestId:"r",path:"/office/operations/cards",body:{secret:"x"}} as any)).rejects.toThrow();
  await writeFile(path.join(dir,"office-pending-requests.json"),"{broken");
  await expect(store.apply({op:"list",owner})).rejects.toThrow();
  await expect(store.apply({op:"begin",owner,requestId:"new",path:"/office/operations/cards"})).rejects.toThrow();
});
