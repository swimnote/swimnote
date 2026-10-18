import type {TransportCommand} from "../../../lib/api-zod/src/transport";
export type TransportQueueItem={runId:string;command:TransportCommand;blocked?:string};
export type TransportVault={owner:string;runId:string;manifest:any|null;queue:TransportQueueItem[];hints:string[]};
type Storage={get:(k:string)=>Promise<string|null>;set:(k:string,v:string)=>Promise<void>;remove:(k:string)=>Promise<void>};
async function secure(){
  try{const s=await import("expo-secure-store");if(await s.isAvailableAsync())return s;}catch{}
  throw Error("보호된 기기 보관 모듈이 없습니다. native 통합 빌드가 필요하며 새 운행 확인은 전송하지 않습니다.");
}
const native:Storage={get:async k=>(await secure()).getItemAsync(k),
  set:async(k,v)=>{const s=await secure();await s.setItemAsync(k,v,{keychainAccessible:s.WHEN_UNLOCKED_THIS_DEVICE_ONLY});},
  remove:async k=>{await (await secure()).deleteItemAsync(k);}};
/** Chunked encrypted OS storage; head switches only after every new chunk is durable.
 * Not a business database or a second server truth. Confirmed server events and unsent inputs remain distinct. */
export function createTransportVault(storage:Storage=native){
  const lanes=new Map<string,Promise<unknown>>();
  const key=(owner:string)=>`sn_tr_${Array.from(owner).map(c=>c.charCodeAt(0).toString(16)).join("_")}`;
  async function committed(owner:string):Promise<TransportVault>{
    const base=key(owner),raw=await storage.get(base);
    if(raw===null)return {owner,runId:"",manifest:null,queue:[],hints:[]};
    const head=JSON.parse(raw);
    if(head.owner!==owner||!Number.isInteger(head.count)||head.count<1||head.count>300||typeof head.generation!=="string")throw Error("운행 보관 소유자·목차를 확인할 수 없습니다.");
    let text="";
    for(let i=0;i<head.count;i++){const part=await storage.get(`${base}_${head.generation}_${i}`);if(part===null)throw Error("운행 보관 일부가 없습니다. 새 요청을 보내지 말고 복구하세요.");text+=part;}
    const value=JSON.parse(text);
    if(value.owner!==owner||!Array.isArray(value.queue)||!Array.isArray(value.hints))throw Error("운행 보관 본문을 확인할 수 없습니다.");
    return value;
  }
  function read(owner:string):Promise<TransportVault>{
    const task=(lanes.get(owner)??Promise.resolve()).catch(()=>{}).then(()=>committed(owner));
    lanes.set(owner,task);return task;
  }
  async function mutate(owner:string,fn:(v:TransportVault)=>TransportVault|void):Promise<TransportVault>{
    const task=(lanes.get(owner)??Promise.resolve()).catch(()=>{}).then(async()=>{
      const value=await committed(owner),next=fn(value)??value;
      if(next.owner!==owner)throw Error("다른 계정의 운행 기록을 보관할 수 없습니다.");
      const base=key(owner),previous=await storage.get(base);
      const generation=`${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const text=JSON.stringify(next).replace(/[\u007f-\uffff]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,"0")}`);
      const count=Math.ceil(text.length/1800);
      if(count>300)throw Error("보호된 운행 보관 한도를 초과했습니다. 기존 기록은 유지합니다.");
      for(let i=0;i<count;i++)await storage.set(`${base}_${generation}_${i}`,text.slice(i*1800,(i+1)*1800));
      await storage.set(base,JSON.stringify({owner,generation,count}));
      // Best-effort cleanup is AFTER commit. It never changes the queue's success/unknown result.
      if(previous){try{const old=JSON.parse(previous);for(let i=0;i<old.count;i++)await storage.remove(`${base}_${old.generation}_${i}`);}catch{}}
      return next;
    });
    lanes.set(owner,task);return task;
  }
  return {read,mutate};
}
export const transportVault=createTransportVault();
export const transportRequestId=()=> "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
  const n=Math.floor(Math.random()*16);return (c==="x"?n:(n&3)|8).toString(16);
});
