import {useEffect} from "react";
import {AppState} from "react-native";
import {useQueryClient} from "@tanstack/react-query";
import {API_BASE} from "@/context/AuthContext";
/** Same pool_events/SSE source; RN engines without streaming stay on existing finite polling + foreground resync. */
export function useTransportRealtime(owner:string,token:string|null|undefined,onRun:()=>void){
  const qc=useQueryClient();
  useEffect(()=>{
    if(!owner||!token)return;
    let alive=true,abort:AbortController|null=null,timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=()=>{for(const key of ["transport-parent","transport-runs","transport-me"])void qc.invalidateQueries({queryKey:[key,owner]});onRun();};
    const connect=async()=>{
      if(!alive||AppState.currentState!=="active")return;
      abort=new AbortController();
      const guard=setTimeout(()=>abort?.abort(),10000);
      try{
        const response=await fetch(`${API_BASE}/transport/stream`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});
        clearTimeout(guard);
        if(!response.ok||!response.body?.getReader){abort.abort();return;}
        refresh();const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
        while(alive){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
          const lines=buffer.split("\n");buffer=lines.pop()??"";for(const line of lines)if(line.startsWith("data:")){
            try{if(JSON.parse(line.slice(5)).type==="transport.changed")refresh();}catch{}
          }}
      }catch{/* Finite existing polling remains the fallback, never infer success. */}
      finally{clearTimeout(guard);if(alive)timer=setTimeout(()=>void connect(),15000);}
    };
    void connect();
    const sub=AppState.addEventListener("change",s=>{if(s==="active"){refresh();abort?.abort();}else abort?.abort();});
    return()=>{alive=false;abort?.abort();clearTimeout(timer);sub.remove();};
  },[owner,token,qc]);
}
