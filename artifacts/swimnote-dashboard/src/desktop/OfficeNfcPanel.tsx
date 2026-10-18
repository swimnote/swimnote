import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { ui } from "./office-ops-styles";
import { pendingGet, pendingSet, pendingDelete, isUnknown, receiptSaved, errText, uuid,useRecoveredPending } from "./office-unknown";

const { box, inp, btn, btn2 } = ui;
type Resolved = { student: { id: string; name: string }; classes: { id: string; name: string }[]; date: string };
type Scan = { attendance: { id: string; student_id: string; class_group_id: string; date: string; status: string }; duplicate: boolean; notificationStatus: string };

/** Explicit scan-only mode; captures keyboard-wedge input only while armed. */
export function OfficeNfcPanel({ scopeKey }: { scopeKey: string }) {
  const qc = useQueryClient();
  const pk = `${scopeKey}|nfc`;
  const ref = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState(false), [uid, setUid] = useState(""), [res, setRes] = useState<Resolved | null>(null);
  const [classId, setClassId] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [scan, setScan] = useState<Scan | null>(null);
  const [locked, setLocked] = useState(!!pendingGet(pk));
  const swallowed=useRef(false);
  useEffect(()=>{
    if(!armed)return;
    const capture=(e:KeyboardEvent)=>{
      if(e.key==="Escape"){setArmed(false);swallowed.current=false;return;}
      if(e.target===ref.current)return;
      if(e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.key.length===1&&!e.isComposing){
        e.preventDefault();e.stopImmediatePropagation();swallowed.current=true;
        if(!res&&!busy&&!locked){ref.current?.focus();if(/^[A-Za-z0-9_-]$/.test(e.key))setUid(u=>(u+e.key).slice(0,160));}
      }else if(e.key==="Enter"&&(swallowed.current||!(e.target instanceof Element&&e.target.closest('[data-testid="nfc-station"]')))){
        e.preventDefault();e.stopImmediatePropagation();swallowed.current=false;ref.current?.focus();
      }
    };
    const preventInput=(e:Event)=>{if(e.target!==ref.current){e.preventDefault();e.stopImmediatePropagation();ref.current?.focus();}};
    document.addEventListener("keydown",capture,true);document.addEventListener("beforeinput",preventInput,true);document.addEventListener("paste",preventInput,true);
    return()=>{document.removeEventListener("keydown",capture,true);document.removeEventListener("beforeinput",preventInput,true);document.removeEventListener("paste",preventInput,true);};
  },[armed,res,busy,locked]);
  useEffect(() => { if (armed && !res) ref.current?.focus(); }, [armed, res, scan]);
  const reset = () => { setUid(""); setRes(null); setClassId(""); setScan(null); setMsg(""); };
  const resolve = async () => {
    const u = uid.trim(); if (!u || busy || locked) return;
    setBusy(true); setMsg(""); setScan(null);
    try { const r = await api.post<Resolved>("/office/operations/nfc/resolve", { uid: u }); setRes(r); setClassId(r.classes.length === 1 ? r.classes[0].id : ""); }
    catch (e: any) { setRes(null); setMsg(e?.status === 404 ? "등록되지 않은 카드입니다. 출결은 기록되지 않았습니다." : errText(e)); setUid(""); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!res || locked || busy || pendingGet(pk)) return;
    if (!classId) return setMsg("반을 선택하세요.");
    const body = (pendingGet(pk)?.body as any) ?? { requestId: uuid(), uid: uid.trim(), classId };
    pendingSet(pk,{requestId:body.requestId,body,label:"nfc"});
    setBusy(true); setMsg("");
    try {
      const r = await api.post<Scan>("/office/operations/nfc/scan", body);
      if(!r.attendance?.id)throw {status:502,message:"출결 응답을 확정할 수 없습니다."};
      pendingDelete(pk); setLocked(false); setScan(r);
      qc.invalidateQueries({ queryKey: ["attendance"] }); setRes(null); setUid("");
    } catch (e: any) {
      if (isUnknown(e)) { pendingSet(pk, { requestId: body.requestId, body, label: "nfc" }); setLocked(true); setMsg("출결 기록 결과를 확인하지 못했습니다. 다시 스캔하지 말고 처리 결과를 확인하세요."); }
      else { pendingDelete(pk);setMsg(errText(e)); }
    } finally { setBusy(false); }
  };
  const check = async () => {
    const p = pendingGet(pk); if (!p) return;
    if (await receiptSaved(p.requestId)) { pendingDelete(pk); setLocked(false); reset(); setMsg("서버에 저장된 처리 결과를 확인했습니다. 출결 화면에서 확인하세요."); }
    else setMsg("저장 증거를 찾지 못했습니다. 기록 없음 또는 조회 실패는 미처리 증거가 아니므로 잠금을 유지합니다.");
  };
  useRecoveredPending(pk,()=>{void check();});
  return <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }} data-testid="nfc-station">
    <strong>카드 리더 스테이션 (키보드 입력형)</strong>
    <p style={{fontSize:12}}>현재 지원 범위는 UID+Enter 키보드 입력형의 스캔 전용 모드입니다. 일반 업무와 병행하는 백그라운드 수신은 지원하지 않습니다. 장치별 HID·Serial·SDK 연결 사양이 확인되기 전 일반 키 입력을 카드 입력으로 추정하지 않습니다.</p>
    {armed&&<p role="status">스캔 전용 모드: 다른 메모·금액 입력은 차단하고 UID 칸으로 보냅니다. 일반 업무 입력은 스테이션을 끄거나 Esc로 복귀하세요.</p>}
    <p role="note" style={{ fontSize: 12, color: "var(--color-warning)", margin: 0 }}>실제 카드 리더기 연동은 검증되지 않았습니다(NOT VERIFIED). 수동 UID 입력과 자동 출결은 같지 않습니다. 날짜는 서버의 한국 시간 오늘로만 기록되며 셔틀 정보는 다루지 않습니다.</p>
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button style={armed ? btn : btn2} data-testid="nfc-arm" onClick={() => { setArmed(!armed); if (armed) reset(); }}>{armed ? "스테이션 켜짐 (끄기)" : "스테이션 켜기"}</button>
      <input ref={ref} data-testid="nfc-uid" style={{ ...inp, flex: 1, minWidth: 200 }} disabled={!armed || locked || !!res} autoComplete="off" placeholder={armed ? "카드를 대면 UID가 입력됩니다" : "스테이션을 켜세요"} value={uid}
        onChange={e => setUid(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault();swallowed.current=false; resolve(); } }} />
      <button style={btn2} disabled={!armed || !uid.trim() || busy || locked || !!res} onClick={resolve}>조회</button>
    </div>
    {res && <div style={{ ...box, background: "var(--surface-off)" }} data-testid="nfc-resolved">
      <div><strong>{res.student.name}</strong> · {res.date}</div>
      {res.classes.length === 0 ? <div role="alert" style={{ color: "var(--color-error)" }}>오늘 배정된 반이 없습니다. 출결을 기록할 수 없습니다.</div> :
        <label style={{ fontSize: 12 }}>반 선택{res.classes.length > 1 && " (필수)"} <select data-testid="nfc-class" style={inp} disabled={locked} value={classId} onChange={e => setClassId(e.target.value)}>
          <option value="">선택</option>{res.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button style={btn} data-testid="nfc-submit" disabled={busy || locked || !classId} onClick={submit}>{busy ? "기록 중…" : "출석 기록"}</button>
        <button style={btn2} disabled={busy || locked} onClick={reset}>취소</button></div></div>}
    {scan && <div role="status" data-testid="nfc-result" style={{ fontSize: 13 }}>
      {scan.duplicate ? "이미 기록된 출결입니다(중복, 새로 만들지 않음)." : "출결을 기록했습니다."} 상태: {scan.attendance.status} · {scan.attendance.date}
      <div style={{ color: "var(--text-muted)" }}>알림: {scan.notificationStatus === "pending_activation" || /pending/.test(scan.notificationStatus) ? `발송 대기/비활성(${scan.notificationStatus}) — 실제 발송 아님` : scan.notificationStatus}</div></div>}
    {locked && <div role="alert" data-testid="nfc-unknown" style={{ color: "var(--color-warning)", fontSize: 13 }}>미확인 출결 요청이 있습니다. <button style={btn2} onClick={check}>처리 결과 확인</button></div>}
    {msg && <div role="alert" style={{ fontSize: 13 }}>{msg}</div>}
  </section>;
}
