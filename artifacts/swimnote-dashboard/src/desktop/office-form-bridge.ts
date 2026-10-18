import {useEffect,useRef,useCallback,useSyncExternalStore} from "react";
import {useAuth} from "../contexts/AuthContext";
import {registerOfficeAiEditor,type OfficeAiEditor} from "./office-ai-editor";
const drafts=new Map<string,unknown>();
const listeners=new Set<()=>void>();let epoch=0;
export const officeFormEpoch=()=>epoch;
if(typeof window!=="undefined")window.addEventListener("office:session-invalid",()=>{epoch++;drafts.clear();listeners.forEach(fn=>fn());});
export function useOfficeFormState<T>(key:string,initial:T){
  const generation=useRef(epoch).current;
  const snapshot=useCallback(()=>{if(!drafts.has(key))drafts.set(key,initial);return drafts.get(key) as T;},[key]);
  const state=useSyncExternalStore(useCallback((fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},[]),snapshot);
  const set=useCallback((update:T|((old:T)=>T))=>{
    if(epoch!==generation)return false;
    const old=drafts.get(key) as T??initial;drafts.set(key,typeof update==="function"?(update as (v:T)=>T)(old):update);
    listeners.forEach(fn=>fn());return true;
  },[key,generation]);
  return [state,set] as const;
}
export function useOfficeFormOwner(){
  const {state}=useAuth();
  return state.status==="authenticated"?{scope:`${state.user.id}:${state.user.swimming_pool_id}`,role:state.user.role,hasX:!!state.user.hasX,isAdmin:state.user.role==="pool_admin"}:
    {scope:"",role:"",hasX:false,isAdmin:false};
}
/** Adapter to the existing editor contract; not an API executor or alternate form. */
export function useOfficeFormBridge(input:{
  scope:string;formKind:"notice"|"parent-reply";recordId?:string;fields:Record<string,string>;token:string;
  locked:boolean;enabled:boolean;canSend:boolean;onDraft:(data:Record<string,unknown>)=>void;
  preview:()=>void;submit:()=>void;
}){
  const latest=useRef(input);latest.current=input;
  const fingerprint=JSON.stringify([input.scope,input.formKind,input.recordId,input.fields,input.token,input.locked,input.enabled,input.canSend]);
  useEffect(()=>{
    if(!input.scope||!input.enabled)return;
    const editor:OfficeAiEditor={scope:input.scope,formKind:input.formKind,recordId:input.recordId,draftContext:input.fields,
      token:fingerprint,locked:input.locked,canSend:input.canSend,
      stage:data=>{
        const allowed=input.formKind==="notice"?["title","content"]:["content"];
        if(Object.keys(data).some(k=>!allowed.includes(k)||typeof data[k]!=="string"||
          (data[k] as string).length>(k==="title"?200:8000)))throw new Error("현재 양식의 텍스트 필드만 입력할 수 있습니다.");
        latest.current.onDraft(data);
      },preview:()=>latest.current.preview(),requestSubmit:()=>latest.current.submit()};
    return registerOfficeAiEditor(editor);
  },[fingerprint]);
}
