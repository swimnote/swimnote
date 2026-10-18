import {it,expect,vi,afterEach} from "vitest";
const {resolveMode}=vi.hoisted(()=>({resolveMode:vi.fn()}));
vi.mock("../xmode.js",()=>({resolvePoolMode:resolveMode}));
import {createOfficeOperationsAiRouter} from "../../routes/office-operations-ai.js";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
const owner={userId:"admin",poolId:"pool",role:"pool_admin" as const};
function handler(){
  const query=vi.fn(),json=vi.fn();
  const router=createOfficeOperationsAiRouter({query} as any,(fn:any)=>(req:any,res:any)=>fn(req,res,owner));
  const layer=(router as any).stack.find((x:any)=>x.route?.path==="/interpret").route.stack;
  return {query,json,call:()=>layer[layer.length-1].handle({body:{text:"현재 업무 초안",resource:"contacts"}},{json})};
}
it("checks current server X entitlement before the model switch or any selected data/model lookup",async()=>{
  vi.stubEnv("OFFICE_OPERATIONS_AI_ENABLED","true");resolveMode.mockResolvedValue({mode:"normal"});
  const h=handler();await expect(h.call()).rejects.toMatchObject({status:403,code:"AI_ENTITLEMENT_REQUIRED"});
  expect(h.query).not.toHaveBeenCalled();expect(h.json).not.toHaveBeenCalled();
});
it("returns implemented-but-OFF for an entitled actor without reading ledger or calling a model",async()=>{
  vi.stubEnv("OFFICE_OPERATIONS_AI_ENABLED","false");resolveMode.mockResolvedValue({mode:"x"});
  const h=handler();await h.call();
  expect(h.json).toHaveBeenCalledWith(expect.objectContaining({kind:"unavailable"}));expect(h.query).not.toHaveBeenCalled();
});
