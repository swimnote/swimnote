import { useEffect,useRef,useState } from "react";
import { api } from "../lib/api-client";
import { ui } from "./office-ops-styles";

const { box, inp, btn2 } = ui;
type Reply = { kind: "operations-draft"|"form-draft"; resource?: string;formKind?:string; recordId?: string; data: Record<string, unknown>; message?: string } | { kind: "clarify"; question: string } | { kind: "unavailable"; message: string };

/** Optional paid draft helper. Explicit click only; result goes into the existing editor form, never saved here. */
export function OfficeOpsAiDraft({ resource,formKind,draftContext, recordId, hasX, locked, onDraft,contextToken }: {
  resource?: string;formKind?:"notice"|"parent-reply";draftContext?:Record<string,string>; recordId?: string; hasX: boolean; locked: boolean;contextToken?:string; onDraft: (data: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [out, setOut] = useState("");
  const [enabled,setEnabled]=useState(false);
  const current=useRef("");current.current=JSON.stringify([resource,formKind,draftContext,recordId,text,locked,contextToken]);
  useEffect(()=>{let live=true;api.get<{modelEnabled?:boolean}>("/office/operations/workspace/catalog").then(c=>{if(live)setEnabled(c.modelEnabled===true);}).catch(()=>{if(live)setEnabled(false);});return()=>{live=false;current.current="unmounted";};},[resource,recordId]);
  const ask = async () => {
    if (!text.trim() || locked || !enabled || !hasX || busy) return;
    const sentResource = resource, sentId = recordId;
    const sent=current.current;
    setBusy(true); setOut("");
    try {
      const r = await api.post<Reply>("/office/operations/workspace/interpret", { text: text.trim(), ...(formKind?{formKind,draftContext}:{resource:sentResource}), ...(sentId ? { recordId: sentId } : {}) });
      if(current.current!==sent)return;
      if (r.kind === "operations-draft"||r.kind==="form-draft") {
        if ((formKind?(r.kind!=="form-draft"||r.formKind!==formKind):(r.kind!=="operations-draft"||r.resource!==sentResource)) || (r.recordId ?? undefined) !== (sentId ?? undefined)) setOut("응답이 현재 편집 중인 항목과 달라 사용하지 않았습니다.");
        else { onDraft(r.data); setOut(`${r.message ?? "초안을 입력 양식에 채웠습니다."} 저장되지 않았습니다. 내용을 확인하고 직접 저장하세요.`); }
      } else if (r.kind === "clarify") setOut(r.question); else if(r.kind==="unavailable")setOut(r.message);
      else throw new Error("허용된 초안 응답이 아닙니다.");
    } catch (e: any) { if(current.current===sent)setOut(e?.status === 403 ? "이 기능은 스윔노트 AI 이용 권한이 필요합니다(서버 판단)." : e?.message ?? "요청 실패"); } finally { setBusy(false); }
  };
  return <div data-testid="ops-ai-draft" style={{ ...box, background: "var(--surface-white)", display: "flex", flexDirection: "column", gap: 4, margin: "6px 0" }}>
    <strong style={{ fontSize: 12 }}>AI 초안 (선택)</strong>
    <small style={{ color: "var(--text-muted)" }}>화면 이동·조회·초안 입력·공통 저장 연결: 구현됨 · 모델 실행: {enabled?"ON · 실제 응답 미확인":"OFF"} · 저장: {formKind?"기존 API의 권한·사용자 확인 절차":"일반 검증·버전·확인"}를 그대로 거칩니다.</small>
    {formKind==="parent-reply"&&<small>선택한 요청의 일부 최근 대화만 사용합니다. 전체 이력을 검토했다는 뜻이 아닙니다. 내부 처리 메모는 모델에 보내지 않습니다.</small>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <input style={{ ...inp, flex: 1, minWidth: 200 }} disabled={!hasX || locked} placeholder="초안으로 채울 내용을 설명" value={text} onChange={e => setText(e.target.value)} />
      <button style={btn2} disabled={!hasX || locked || busy || !enabled || !text.trim()} onClick={ask}>{busy ? "요청 중…" : enabled?"초안 요청":"모델 실행 OFF · 연결 구현됨"}</button></div>
    {!hasX && <small style={{ color: "var(--text-muted)" }}>스윔노트 AI 이용 권한이 없어 사용할 수 없습니다. 직접 입력은 그대로 가능합니다.</small>}
    {locked && <small style={{ color: "var(--color-warning)" }}>미확인 저장이 있어 초안을 채울 수 없습니다.</small>}
    {out && <div role="status" style={{ fontSize: 12 }}>{out}</div>}
  </div>;
}
