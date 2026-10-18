// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {webcrypto} from "node:crypto";
import {recoverableWrite,isSavedReceipt,recoveryOwner} from "./OfficeRecovery";
const {get}=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("../lib/api-client",()=>({api:{get}}));
vi.mock("./OfficeNavigation",()=>({useOfficeNavigate:()=>vi.fn()}));
const actor={userId:"u",poolId:"p"};
const path="/office/operations/contracts",body=JSON.stringify({requestId:"r",data:{name:"not-stored"}});
const bridge=vi.fn();
beforeEach(()=>{vi.stubGlobal("crypto",webcrypto);window.officeDesktop={pendingRequests:bridge} as any;vi.clearAllMocks();bridge.mockResolvedValue([]);});
afterEach(()=>{delete (window as any).officeDesktop;vi.unstubAllGlobals();});
it("persists BEFORE sending and clears only validated success",async()=>{
  const order:string[]=[];bridge.mockImplementation(async({op})=>{order.push(op);return [];});
  const result={item:{id:"contract-1"}};
  expect(await recoverableWrite(actor,path,"POST",body,async()=>{order.push("send");return result;})).toEqual(result);
  expect(order).toEqual(["begin","send","finish"]);
  expect(bridge.mock.calls[0][0]).toEqual({op:"begin",owner:await recoveryOwner(actor),requestId:"r",path});
});
it("never sends if the durable bookmark is blocked or unavailable",async()=>{
  const send=vi.fn();bridge.mockRejectedValue(new Error("prior request"));
  await expect(recoverableWrite(actor,path,"POST",body,send)).rejects.toMatchObject({code:"OFFICE_RECOVERY_BLOCKED"});
  expect(send).not.toHaveBeenCalled();
  delete (window as any).officeDesktop;
  await expect(recoverableWrite(actor,path,"POST",body,send)).rejects.toMatchObject({code:"OFFICE_RECOVERY_UNAVAILABLE"});
  expect(send).not.toHaveBeenCalled();
});
it.each([{status:502},{status:408},{status:429},new TypeError("lost")])("retains uncertainty without retry: %j",async(error)=>{
  const send=vi.fn().mockRejectedValue(error);
  await expect(recoverableWrite(actor,path,"POST",body,send)).rejects.toEqual(error);
  expect(send).toHaveBeenCalledTimes(1);expect(bridge.mock.calls.map(x=>x[0].op)).toEqual(["begin"]);
});
it("definite rejection clears; malformed success retains",async()=>{
  await expect(recoverableWrite(actor,path,"POST",body,async()=>{throw {status:422};})).rejects.toMatchObject({status:422});
  expect(bridge.mock.calls.map(x=>x[0].op)).toEqual(["begin","finish"]);bridge.mockClear();
  await expect(recoverableWrite(actor,path,"POST",body,async()=>({}))).rejects.toMatchObject({status:502});
  expect(bridge.mock.calls.map(x=>x[0].op)).toEqual(["begin"]);
});
it("matches actual finance-import results rather than expecting a finance event",()=>{
  expect(isSavedReceipt("/office/operations/imports/job/finance-apply",{applied:1,held:0,results:[],revision:3})).toBe(true);
  expect(isSavedReceipt("/office/operations/finance/execute",{event:{id:"e"},version:2})).toBe(true);
  expect(isSavedReceipt("/office/operations/finance/execute",{results:[],revision:2})).toBe(false);
});
it("blocks member creation before transport when the server lacks the optional receipt contract",async()=>{
  get.mockResolvedValue({});
  const send=vi.fn();
  await expect(recoverableWrite(actor,"/students","POST",body,send)).rejects.toMatchObject({status:400,code:"OFFICE_MEMBER_RECOVERY_NOT_READY"});
  expect(send).not.toHaveBeenCalled();expect(bridge).not.toHaveBeenCalled();
});
it("uses the native pointer for a member and never retries a lost response",async()=>{
  get.mockResolvedValue({memberCreationReceiptVersion:1});
  const send=vi.fn().mockRejectedValue(new TypeError("response lost"));
  await expect(recoverableWrite(actor,"/students","POST",body,send)).rejects.toThrow("response lost");
  expect(send).toHaveBeenCalledTimes(1);expect(bridge.mock.calls.map(c=>c[0].op)).toEqual(["begin"]);
});
