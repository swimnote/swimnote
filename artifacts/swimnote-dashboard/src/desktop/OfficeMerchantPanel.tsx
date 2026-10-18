import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { listOps, uuid, type OpsItem } from "./office-ops-lib";
import { pendingGet, pendingSet, pendingDelete, pendingClear, isUnknown, receiptItem, errText,useRecoveredPending } from "./office-unknown";
import { ui } from "./office-ops-styles";

const { box, inp, btn, btn2 } = ui;
const STAGES: [string, string][] = [["preparing", "준비 중"], ["application_submitted", "신청서 제출"], ["contract_signed", "계약 체결"], ["review_approved", "심사 승인"], ["payment_active", "결제 사용 개시"]];
const STATUSES: [string, string][] = [["planned", "계획"], ["requested", "신청 기록"], ["in_progress", "진행"], ["completed", "완료 기록"], ["held", "보류"], ["cancelled", "취소"]];
const stageLabel = (s: string) => STAGES.find(x => x[0] === s)?.[1] ?? s;
type Form = { name: string; status: string; merchantStage: string; merchantReference: string; merchantConfirmedAt: string; note: string };
const empty: Form = { name: "", status: "planned", merchantStage: "preparing", merchantReference: "", merchantConfirmedAt: "", note: "" };

async function loadMerchant() {
  const out: OpsItem[] = [];
  for (let off = 0; off < 2000; off += 100) {
    const p = await listOps("support", "", off, 100);
    out.push(...p.items.filter(i => i.data.kind === "merchant_application"));
    if (!p.has_more || !p.items.length) break;
  }
  return out;
}

export function OfficeMerchantPanel({ scope }: { scope: string }) {
  const qc = useQueryClient(), pkey = `${scope}|merchant`;
  const cap = useQuery({ queryKey: ["ops-cap"], queryFn: () => api.get<{ available: boolean; merchantOnboardingVersion?: number }>("/office/operations/capabilities"), retry: false });
  const list = useQuery({ queryKey: ["ops", "merchant", scope], queryFn: loadMerchant, retry: false, refetchInterval: 30000, refetchOnMount: "always" });
  const [edit, setEdit] = useState<OpsItem | "new" | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [reqId, setReqId] = useState(uuid());
  const [ok, setOk] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const [lock, setLock] = useState(!!pendingGet(pkey));
  const [hist, setHist] = useState<{ id: string; rows?: any[]; err?: string } | null>(null);
  useEffect(() => { pendingClear(scope); setLock(!!pendingGet(pkey)); }, [scope, pkey]);
  const ready = cap.data?.merchantOnboardingVersion === 1 && cap.data.available;
  const items = list.data ?? [];
  const evid = useQuery({
    queryKey: ["ops", "merchant-hist", scope, items.map(i => `${i.id}:${i.revision}`).join(",")], enabled: items.length > 0, retry: false,
    queryFn: async () => {
      const seen = new Set<string>();
      for (const i of items) { const r = await api.get<{ items: { data?: any }[] }>(`/office/operations/support/${i.id}/history`); for (const h of r?.items ?? []) if (h?.data?.merchantStage) seen.add(h.data.merchantStage); }
      return seen;
    } });
  const reached = (s: string) => items.some(i => (i.data.merchantStage ?? "preparing") === s) || !!evid.data?.has(s);
  const set = (k: keyof Form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const open = (it: OpsItem | "new") => {
    if (lock && edit) return setMsg("미확인 저장이 있습니다. 먼저 해결하세요.");
    setEdit(it); setOk(false); setMsg(""); setReqId(uuid());
    setForm(it === "new" ? empty : { name: it.data.name ?? "", status: it.data.status ?? "planned", merchantStage: it.data.merchantStage ?? "preparing", merchantReference: it.data.merchantReference ?? "", merchantConfirmedAt: String(it.data.merchantConfirmedAt ?? "").slice(0, 10), note: it.data.note ?? "" });
  };
  const done = () => { pendingDelete(pkey); setLock(false); setEdit(null); setReqId(uuid()); qc.invalidateQueries({ queryKey: ["ops"] }); };
  const save = async () => {
    if (!edit || !ready) return;
    if (pendingGet(pkey)) return setMsg("미확인 저장이 있습니다. 재전송하지 않고 서버 처리 결과 확인만 할 수 있습니다.");
    if (!form.name.trim()) return setMsg("업무명을 입력하세요.");
    const late = form.merchantStage !== "preparing";
    if (late && (!form.merchantReference.trim() || !form.merchantConfirmedAt)) return setMsg("준비 중 이후 단계는 참조 번호와 확인일이 필요합니다.");
    if (!ok) return setMsg("센터가 직접 확인한 수기 기록임을 체크하세요.");
    const data: Record<string, unknown> = { kind: "merchant_application", name: form.name.trim(), status: form.status, merchantStage: form.merchantStage };
    if (form.merchantReference.trim()) data.merchantReference = form.merchantReference.trim();
    if (form.merchantConfirmedAt) data.merchantConfirmedAt = form.merchantConfirmedAt;
    if (form.note.trim()) data.note = form.note.trim();
    const target = edit === "new" ? "new" : edit.id;
    const body = { target, data };
    const id = reqId;
    pendingSet(pkey,{requestId:id,body,label:"merchant"});
    setBusy(true); setMsg("");
    try {
      const res: any = edit === "new" ? await api.post("/office/operations/support", { requestId: id, data })
        : await api.patch(`/office/operations/support/${edit.id}`, { requestId: id, expectedRevision: edit.revision, data });
      if (!res?.item?.id) throw Object.assign(new Error("응답에서 저장 항목을 확인하지 못했습니다."), { status: 502 });
      done();
    } catch (e: any) {
      if (isUnknown(e)) { pendingSet(pkey, { requestId: id, body, label: "merchant" }); setLock(true); setMsg("저장 결과를 확인하지 못했습니다. 성공으로 처리하지 않았습니다. " + errText(e)); }
      else { pendingDelete(pkey); setLock(false); setReqId(uuid()); setMsg(e?.status === 409 ? "다른 사용자가 먼저 수정했습니다. 목록을 새로 불러온 뒤 다시 수정하세요. " + errText(e) : errText(e)); if (e?.status === 409) list.refetch(); }
    } finally { setBusy(false); }
  };
  const recover = async () => {
    const p = pendingGet(pkey); if (!p) return;
    const res: any = await receiptItem(p.requestId);
    if (res?.item?.id) { done(); setMsg("서버 처리 영수증으로 저장을 확인했습니다."); }
    else setMsg("확정된 처리 기록을 찾지 못했습니다. 조회 실패는 미처리 증거가 아니며 동일 요청 ID를 유지합니다.");
  };
  const showHist = async (id: string) => {
    setHist({ id });
    try { const r = await api.get<any>(`/office/operations/support/${id}/history`); setHist({ id, rows: r?.items ?? [] }); }
    catch (e: any) { setHist({ id, err: errText(e) }); }
  };
  useRecoveredPending(pkey,()=>{void recover();});
  const lab = { fontSize: 12, display: "flex", flexDirection: "column", gap: 2 } as const;
  return <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }} data-testid="office-merchant-panel">
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <strong>가맹점 신청 진행 기록</strong>
      <button style={{ ...btn, marginLeft: "auto" }} disabled={!ready} onClick={() => open("new")}>새 기록</button>
    </div>
    <p role="note" style={{ fontSize: 12, color: "var(--color-warning)", margin: 0 }}>모든 단계는 센터가 직접 입력한 수기 기록이며 결제대행사가 확인한 것이 아닙니다. 결제(PG)와 정산 기능은 어느 단계에서도 사용할 수 없습니다. 파일, 신분증, 계좌 정보는 입력하지 마세요.</p>
    {cap.isError && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>기능 확인 실패: {errText(cap.error)} <button style={btn2} onClick={() => cap.refetch()}>다시 시도</button></div>}
    {cap.data && !ready && <div role="alert" style={{ color: "var(--color-warning)", fontSize: 13 }}>서버 승인 대기 중입니다. 저장은 비활성화되며 기존 기록만 조회합니다.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 6 }}>
      {STAGES.map(([k, l], n) => <div key={k} style={{ ...box, padding: 8, fontSize: 12, background: reached(k) ? "var(--surface-off)" : "var(--surface-white)" }} data-testid={`merchant-stage-${k}`}>
        <div style={{ color: "var(--text-muted)" }}>{n + 1}단계</div><strong>{l}</strong>
        <div style={{ color: "var(--text-muted)" }}>{reached(k) ? "센터 수기 기록 있음" : "별도 기록 근거 없음"}</div></div>)}
    </div>
    {list.isLoading && <div style={{ height: 70, background: "var(--surface-subtle)", borderRadius: 4 }} aria-busy />}
    {list.isError && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>{errText(list.error)} <button style={btn2} onClick={() => list.refetch()}>다시 시도</button></div>}
    {list.data && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead><tr>{["업무명", "단계", "기록 상태", "참조", "확인일", ""].map(h => <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border-strong)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
      <tbody>{items.map(i => <tr key={i.id}>
        <td style={{ padding: 6 }}>{i.data.name}</td><td style={{ padding: 6 }}>{stageLabel(i.data.merchantStage ?? "preparing")}</td>
        <td style={{ padding: 6 }}>{STATUSES.find(s => s[0] === i.data.status)?.[1] ?? i.data.status}</td>
        <td style={{ padding: 6 }}>{i.data.merchantReference ?? "-"}</td><td style={{ padding: 6 }}>{String(i.data.merchantConfirmedAt ?? "-").slice(0, 10)}</td>
        <td style={{ padding: 6, textAlign: "right", whiteSpace: "nowrap" }}><button style={btn2} disabled={!ready} onClick={() => open(i)}>수정</button> <button style={btn2} onClick={() => showHist(i.id)}>이력</button></td></tr>)}
        {!items.length && <tr><td colSpan={6} style={{ padding: 16, color: "var(--text-muted)" }}>아직 기록이 없습니다. 준비 중 단계부터 직접 기록을 시작하세요.</td></tr>}</tbody></table></div>}
    {hist && <div style={{ ...box, background: "var(--surface-off)", fontSize: 12 }} data-testid="merchant-history">
      <strong>변경 이력</strong> <button style={btn2} onClick={() => setHist(null)}>닫기</button>
      {!hist.rows && !hist.err && <div>불러오는 중</div>}
      {hist.err && <div role="alert" style={{ color: "var(--color-error)" }}>{hist.err} <button style={btn2} onClick={() => showHist(hist.id)}>다시 시도</button></div>}
      {hist.rows && !hist.rows.length && <div>이력이 없습니다.</div>}
      {hist.rows?.map((r, n) => { const d = r.data ?? {}; return <div key={n} style={{ padding: "4px 0", borderBottom: "1px solid var(--border-default)" }}>
        rev {r.revision ?? "-"} / {stageLabel(d.merchantStage ?? "preparing")} / {d.status} / 참조 {d.merchantReference ?? "-"} / 확인일 {String(d.merchantConfirmedAt ?? "-").slice(0, 10)} / {String(r.created_at ?? "").slice(0, 16)}</div>; })}</div>}
    {edit && <div style={{ ...box, background: "var(--surface-off)" }}>
      <strong>{edit === "new" ? "새 기록" : `수정 (rev ${edit.revision})`}</strong>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8, margin: "8px 0" }}>
        <label style={lab}>업무명 *<input style={inp} value={form.name} onChange={e => set("name", e.target.value)} /></label>
        <label style={lab}>단계<select style={inp} value={form.merchantStage} onChange={e => set("merchantStage", e.target.value)}>{STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={lab}>기록 상태<select style={inp} value={form.status} onChange={e => set("status", e.target.value)}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={lab}>참조 번호(민감정보 제외)<input style={inp} value={form.merchantReference} onChange={e => set("merchantReference", e.target.value)} /></label>
        <label style={lab}>확인일<input style={inp} type="date" value={form.merchantConfirmedAt} onChange={e => set("merchantConfirmedAt", e.target.value)} /></label>
        <label style={lab}>메모<textarea rows={3} style={inp} value={form.note} onChange={e => set("note", e.target.value)} /></label>
      </div>
      <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} />센터가 직접 확인한 수기 기록이며 제공사 검증이 아님을 확인합니다.</label>
      {lock && <div role="alert" style={{ color: "var(--color-warning)", fontSize: 13 }}>이전 저장 결과가 미확인입니다. 다시 전송하지 않으며 서버 처리 결과 확인만 가능합니다. <button style={btn2} onClick={recover}>서버 처리 결과 확인</button></div>}
      {msg && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}><button style={btn} disabled={busy || !ready || lock} onClick={save}>{busy ? "저장 중…" : "저장"}</button><button style={btn2} onClick={() => setEdit(null)}>닫기</button></div>
    </div>}
    {!edit && msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
  </section>;
}
