import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { withMemberCreationReceipt } from "../member-creation-receipt.js";

const rid="84e17c0b-c125-4825-8ded-0833b987ceda";
const input={requestId:rid,poolId:"pool",actorId:"admin",body:{name:"same-name",parent_phone:"same-phone"}};
function store(){
  let receipt:any,created=0;
  let role="pool_admin",poolId="pool",failReceipt=false,ready=true;
  const queries:string[]=[];
  const tx={
    execute:vi.fn(async(q:any)=>{
      const {sql,params}=new PgDialect().sqlToQuery(q);queries.push(sql);
      if(sql.includes("FROM users"))return {rows:[{role,swimming_pool_id:poolId}]};
      if(sql.includes("to_regclass"))return {rows:[{ready}]};
      if(sql.includes("SELECT actor_id"))return {rows:receipt?[receipt]:[]};
      if(sql.startsWith("INSERT INTO office_operation_receipts")){
        if(failReceipt)throw new Error("receipt write failure");
        receipt={actor_id:params[2],input_hash:params[3],result:JSON.parse(params[4] as string)};
      }
      return {rows:[]};
    }),
  };
  const db={...tx,transaction:vi.fn(async(fn:any)=>{
    const before={receipt,created};
    try{return await fn(tx);}catch(e){receipt=before.receipt;created=before.created;throw e;}
  })};
  const sideEffect=vi.fn(async()=>{});
  const perform=vi.fn(async()=>{
    created++;return {status:201,body:{success:true,id:"created-exact-id",name:"same-name"},afterCommit:sideEffect};
  });
  return {db,perform,queries,sideEffect,
    count:()=>created,receipt:()=>receipt,
    setActor:(r:string,p="pool")=>{role=r;poolId=p;},
    failReceipt:()=>{failReceipt=true;},missingSchema:()=>{ready=false;}};
}
describe("optional canonical member creation receipt",()=>{
  it("commits exact ID with the business write and reuses it without re-running effects",async()=>{
    const s=store(),first=await withMemberCreationReceipt(s.db,input,s.perform);
    expect(first.body.id).toBe("created-exact-id");
    expect(s.sideEffect).not.toHaveBeenCalled(); // caller runs this ONLY after transaction resolves
    await first.afterCommit?.();
    const replay=await withMemberCreationReceipt(s.db,input,s.perform);
    expect(replay.body).toEqual({kind:"member.create",success:true,id:"created-exact-id",requestId:rid});
    expect(s.perform).toHaveBeenCalledTimes(1);expect(replay.afterCommit).toBeUndefined();
    expect(s.receipt().result).not.toHaveProperty("name");expect(s.receipt().result).not.toHaveProperty("parent_phone");
    expect(s.queries.findIndex(q=>q.includes("pg_advisory_xact_lock"))).toBeLessThan(s.queries.findIndex(q=>q.includes("SELECT actor_id")));
  });
  it("rolls back the creation if its receipt cannot commit",async()=>{
    const s=store();s.failReceipt();
    await expect(withMemberCreationReceipt(s.db,input,s.perform)).rejects.toThrow("receipt write failure");
    expect(s.count()).toBe(0);expect(s.receipt()).toBeUndefined();expect(s.sideEffect).not.toHaveBeenCalled();
  });
  it.each([["teacher","pool"],["pool_admin","other-pool"]])("revalidates current actor %s/%s before any creation",async(role,poolId)=>{
    const s=store();s.setActor(role,poolId);
    await expect(withMemberCreationReceipt(s.db,input,s.perform)).rejects.toMatchObject({status:403});
    expect(s.perform).not.toHaveBeenCalled();
  });
  it("rejects another input or actor reusing an ID, regardless of matching names",async()=>{
    const s=store();await withMemberCreationReceipt(s.db,input,s.perform);
    await expect(withMemberCreationReceipt(s.db,{...input,body:{...input.body,memo:"different"}},s.perform)).rejects.toMatchObject({code:"REQUEST_REUSED"});
    await expect(withMemberCreationReceipt(s.db,{...input,actorId:"other-admin"},s.perform)).rejects.toMatchObject({code:"REQUEST_REUSED"});
    expect(s.perform).toHaveBeenCalledTimes(1);
  });
  it("does not invent success from a similar existing member",async()=>{
    const s=store(),perform=vi.fn(async()=>({status:200,body:{success:false,possible_duplicate:true,candidates:[{id:"not-proof"}]}}));
    expect((await withMemberCreationReceipt(s.db,input,perform)).body.success).toBe(false);
    expect(s.receipt()).toBeUndefined();
  });
  it("legacy requests need no schema or receipt; keyed requests fail before writing if unavailable",async()=>{
    const s=store();s.missingSchema();
    await expect(withMemberCreationReceipt(s.db,input,s.perform)).rejects.toMatchObject({code:"OFFICE_MIGRATION_REQUIRED"});
    expect(s.perform).not.toHaveBeenCalled();
    expect((await withMemberCreationReceipt(s.db,{...input,requestId:undefined},s.perform)).status).toBe(201);
    expect(s.db.transaction).toHaveBeenCalledTimes(1);
  });
  it("validates request IDs before beginning a transaction",async()=>{
    const s=store();
    await expect(withMemberCreationReceipt(s.db,{...input,requestId:"../bad"},s.perform)).rejects.toMatchObject({status:400});
    expect(s.db.transaction).not.toHaveBeenCalled();
  });
});
