import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { toCsv, download, type OpsItem } from "./office-ops-lib";
import { ui } from "./office-ops-styles";
import { pendingGet, pendingSet, pendingDelete, isUnknown, receiptItem, errText, uuid,useRecoveredPending } from "./office-unknown";

const { box, inp, btn, btn2 } = ui;
export const FIN_TARGETS: [string, string][] = [["student_id", "회원 ID"], ["kind", "구분"], ["amount_krw", "금액(원)"], ["remaining_count", "잔여 횟수"], ["contract_id", "계약 ID"], ["makeup_class_id", "보강 반 ID"], ["transaction_date", "원 결제일(과거 수납 필수)"], ["makeup_date", "원 결석일(배정일 아님)"]];
const KINDS: Record<string, string> = { opening_due: "기초 미수", opening_credit: "기초 선수금", past_receipt: "과거 수납(이력)", remaining_rights: "잔여 수강권", makeup: "보강" };
type Row = { sourceKey: string; source: unknown; studentId?: string; kind: string; amountKrw?: number; remainingCount?: number; errors: string[]; status: string };
type Preview = { previewHash: string; ledgerVersion: number; rows: Row[]; totals: { amountKrw: number; remainingCount: number }; referenceDate: string; revision: number };
type Applied = { applied: number; held: number; results: any[]; totals: { amountKrw: number; remainingCount: number }; revision: number };

/** Financial source mapping: separate rule object from the member rules. Server validates every row. */
export function OfficeImportsFinance({ cur, headers, scopeKey, onRevision, suggested,onLockChange,onRulesChange }: { onRulesChange?:(rules:Record<string,string>)=>void;onLockChange?:(locked:boolean)=>void; suggested?: Record<string, string>; cur: OpsItem | null; headers: string[]; scopeKey: string; onRevision: (rev: number) => void }) {
  const qc = useQueryClient(), pk = `${scopeKey}|import-fin`;
  const [rules, setRules] = useState<Record<string, string>>(cur?.data.financeRules ?? {});
  const [undo,setUndo]=useState<Record<string,string>[]>([]);
  const [prev, setPrev] = useState<Preview | null>(null), [res, setRes] = useState<Applied | null>(null), [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [lock, setLock] = useState(!!pendingGet(pk));
  useEffect(()=>{onLockChange?.(lock||busy);},[lock,busy,onLockChange]);
  useEffect(() => { setRules(cur?.data.financeRules ?? {});setUndo([]); setPrev(null); setRes(null); setOk(false); }, [cur?.id]);
  useEffect(()=>{onRulesChange?.(rules);},[rules,onRulesChange]);
  useEffect(() => { if (suggested && !pendingGet(pk)) { setUndo(u=>[...u,rules]);setRules(suggested); setPrev(null); setOk(false); } }, [suggested]);
  const edit = (r: Record<string, string>) => { if (lock) return;setUndo(u=>[...u,rules].slice(-20)); setRules(r); setPrev(null); setOk(false); };
  const bad = useMemo(() => prev?.rows.filter(r => r.errors.length || r.status !== "ready") ?? [], [prev]);
  const missing = !rules.kind || !rules.student_id;
  const doPreview = async () => {
    if (!cur) return; setBusy(true); setMsg(""); setRes(null);
    try { const r = await api.post<Omit<Preview, "revision">>(`/office/operations/imports/${cur.id}/finance-preview`, { expectedRevision: cur.revision, rules }); setPrev({ ...r, revision: cur.revision }); setOk(false); }
    catch (e: any) { setPrev(null); setMsg(e?.status === 503 ? "금융 가져오기 서버 스키마가 아직 적용되지 않았습니다(503). 적용할 수 없습니다." : errText(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!cur || !prev || !ok) return;
    const body = (pendingGet(pk)?.body as any) ?? { requestId: uuid(), expectedRevision: prev.revision, ledgerVersion: prev.ledgerVersion, previewHash: prev.previewHash, rules, confirmed: true };
    pendingSet(pk,{requestId:body.requestId,body,label:"finance-apply"});
    setBusy(true); setMsg("");
    try { const r = await api.post<Applied>(`/office/operations/imports/${cur.id}/finance-apply`, body);
      pendingDelete(pk); setLock(false); setRes(r); setPrev(null); setOk(false); onRevision(r.revision);
      qc.invalidateQueries({ queryKey: ["office-finance", scopeKey] }); qc.invalidateQueries({ queryKey: ["ops"] }); setMsg(`금융 자료 ${r.applied}건 반영, ${r.held}건 보류.`); }
    catch (e: any) {
      if (isUnknown(e)) { pendingSet(pk, { requestId: body.requestId, body, label: "finance-apply" }); setLock(true); setMsg("반영 결과를 확인하지 못했습니다. 재전송하지 말고 처리 결과를 확인하세요."); }
      else { pendingDelete(pk); setPrev(null); setMsg(errText(e)); }
    } finally { setBusy(false); }
  };
  const check = async () => { const p = pendingGet(pk); if (!p) return;
    const saved:any=await receiptItem(p.requestId);
    if (Number.isSafeInteger(saved?.revision)&&Array.isArray(saved?.results)) { pendingDelete(pk); setLock(false); setPrev(null);setRes(saved);onRevision(saved.revision); setMsg("서버 처리 영수증으로 반영을 확인했습니다. 결과 CSV를 확인하세요."); qc.invalidateQueries({ queryKey: ["office-finance", scopeKey] });qc.invalidateQueries({queryKey:["ops"]}); }
    else setMsg("저장 증거를 찾지 못했습니다. 404/조회 실패는 미처리 증거가 아니므로 잠금을 유지합니다."); };
  useRecoveredPending(pk,()=>{void check();});
  const csv = (name: string, rows: any[]) => download(name, toCsv(["sourceKey", "구분", "회원", "금액", "잔여횟수", "상태", "오류"], rows.map(r => [r.sourceKey, r.kind, r.studentId, r.amountKrw, r.remainingCount, r.status, (r.errors ?? [r.error ?? ""]).join("; ")])));
  return <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }} data-testid="import-finance">
    <strong>금융·수강권 자료 연결 (별도 규칙)</strong>
    <p role="note" style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>회원 등록 규칙과 별개로 저장됩니다. 먼저 위에서 가져오기를 저장하세요. 기초 잔액은 과거 수납 이력과 분리되며, 운영 기록이 시작된 뒤에는 덮어쓰지 않습니다. 모든 행은 서버가 검증합니다.</p>
    {!cur && <div style={{ fontSize: 12 }}>저장된 가져오기를 선택하거나 저장한 뒤 사용할 수 있습니다.</div>}
    <button style={btn2} disabled={lock||busy||!undo.length} onClick={()=>{setRules(undo[undo.length-1]);setUndo(u=>u.slice(0,-1));setPrev(null);setOk(false);}}>금융 규칙 되돌리기 (적용 자료 삭제 아님)</button>
    {cur && headers.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 6 }}>
      {FIN_TARGETS.map(([k, l]) => <label key={k} style={{ fontSize: 12 }}>{l}<select data-testid={`fin-rule-${k}`} disabled={lock} style={{ ...inp, width: "100%" }} value={rules[k] ?? ""} onChange={e => { const n = { ...rules }; if (e.target.value) n[k] = e.target.value; else delete n[k]; edit(n); }}>
        <option value="">(매핑 안 함)</option>{headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>}
    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>과거 수납은 원 결제일 매핑이 필수이며 회원 ID는 정확한 회원 ID이거나 같은 원본 행의 적용된 회원 가져오기 결과여야 합니다(아니면 보류). 구분 열 값: {Object.entries(KINDS).map(([k, v]) => `${k}=${v}`).join(", ")}</div>
    {lock && <div role="alert" data-testid="fin-unknown" style={{ color: "var(--color-warning)", fontSize: 13 }}>미확인 반영 요청이 있습니다. 입력이 잠겼습니다. <button style={btn2} onClick={check}>처리 결과 확인</button></div>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button style={btn2} data-testid="fin-preview" disabled={busy || lock || !cur || missing} onClick={doPreview}>서버 미리보기</button>
      {missing && cur && <small style={{ color: "var(--color-error)" }}>회원 ID와 구분 열 매핑이 필요합니다.</small>}</div>
    {prev && <div data-testid="fin-preview-result" style={{ fontSize: 13 }}>
      <div>기준일 {prev.referenceDate} · 원장 버전 {prev.ledgerVersion} · 행 {prev.rows.length} · 금액 합계 {prev.totals.amountKrw.toLocaleString("ko-KR")}원 · 잔여횟수 {prev.totals.remainingCount}</div>
      <div style={{ overflowX: "auto", maxHeight: 220 }}><table style={{ fontSize: 12, borderCollapse: "collapse" }}><thead><tr>{["원본 키", "구분", "회원", "금액", "잔여", "상태", "오류"].map(h => <th key={h} style={{ padding: "2px 8px", textAlign: "left" }}>{h}</th>)}</tr></thead>
        <tbody>{prev.rows.slice(0, 100).map(r => <tr key={r.sourceKey}><td style={{ padding: "2px 8px" }}>{r.sourceKey}</td><td style={{ padding: "2px 8px" }}>{KINDS[r.kind] ?? r.kind}</td><td style={{ padding: "2px 8px" }}>{r.studentId ?? "-"}</td><td style={{ padding: "2px 8px" }}>{r.amountKrw?.toLocaleString("ko-KR") ?? "-"}</td><td style={{ padding: "2px 8px" }}>{r.remainingCount ?? "-"}</td><td style={{ padding: "2px 8px" }}>{r.status}</td><td style={{ padding: "2px 8px", color: "var(--color-error)" }}>{r.errors.join(", ")}</td></tr>)}</tbody></table></div>
      {prev.rows.length > 100 && <small>처음 100행만 표시합니다. 전체는 CSV를 사용하세요.</small>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}><button style={btn2} onClick={() => csv("finance-preview.csv", prev.rows)}>미리보기 CSV</button>
        {bad.length > 0 && <button style={btn2} onClick={() => csv("finance-held-preview.csv", bad)}>보류 행 CSV ({bad.length})</button>}</div>
      <label style={{ display: "flex", gap: 6, marginTop: 6 }}><input data-testid="fin-confirm" type="checkbox" checked={ok} disabled={lock} onChange={e => setOk(e.target.checked)} />위 합계와 보류 {bad.length}행을 확인했고, 정상 행을 원장에 반영합니다.</label>
      <button style={btn} data-testid="fin-apply" disabled={busy || !ok} onClick={apply}>금융 자료 반영</button></div>}
    {res && <div data-testid="fin-result" style={{ fontSize: 13 }}>반영 {res.applied} · 보류 {res.held} · 금액 {res.totals.amountKrw.toLocaleString("ko-KR")}원 · 잔여횟수 {res.totals.remainingCount}
      <div style={{ display: "flex", gap: 6 }}><button style={btn2} onClick={() => csv("finance-results.csv", res.results)}>결과 CSV</button>
        <button style={btn2} disabled={!res.results.some(r => r.status !== "applied")} onClick={() => csv("finance-held.csv", res.results.filter(r => r.status !== "applied"))}>보류·실패 CSV</button></div></div>}
    {msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
  </section>;
}
