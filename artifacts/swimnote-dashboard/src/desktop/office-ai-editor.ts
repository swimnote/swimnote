/** Session-only handoff to an already mounted common editor. Never an executor. */
export type OfficeAiEditor={
  scope:string; resource?:string; recordId?:string; memberId?:string;
  token:string; stage:(data:Record<string,unknown>)=>void;
};
let editor:OfficeAiEditor|null=null;
export function registerOfficeAiEditor(next:OfficeAiEditor){
  editor=next;
  return()=>{if(editor===next)editor=null;};
}
export function readOfficeAiEditor(scope:string){return editor?.scope===scope?editor:null;}
export function applyOfficeAiDraft(expected:OfficeAiEditor,data:Record<string,unknown>){
  if(editor!==expected)throw new Error("선택·입력·화면이 바뀌어 이전 초안을 적용하지 않았습니다.");
  expected.stage(data);
}
if(typeof window!=="undefined")window.addEventListener("office:session-invalid",()=>{editor=null;});
