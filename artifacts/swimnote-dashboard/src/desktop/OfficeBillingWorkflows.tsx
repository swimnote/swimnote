import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { listAllOps, type OpsItem } from "./office-ops-lib";
import { ui } from "./office-ops-styles";
import { receiptItem, isUnknown, errText, uuid } from "./office-unknown";
import { previewFinance, executeFinance, fetchSnapshot, krw, type FinanceSnapshot, type Totals, type PreviewResult } from "./office-finance-api";

const { box, inp, btn, btn2 } = ui;
const today = () => new Date(Date.now()+9*3600_000).toISOString().slice(0, 10);
const TOT: [keyof Totals, string][] = [["billedKrw", "청구 누계"], ["dueKrw", "미납 잔액"], ["unallocatedKrw", "미배분 수납"], ["receivedKrw", "기간 수납"], ["refundedKrw", "기간 환불"], ["expensesPaidKrw", "기간 지출 지급"], ["cashFlowKrw", "기간 현금흐름"]];
const MAX = 100;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const dropOthers = (keep: string) => { for (const m of [batchPend, contractPend, invoicePend] as Map<string, unknown>[]) for (const k of [...m.keys()]) if (k !== keep) m.delete(k); };
const isInt = (s: string) => /^\d+$/.test(s.trim()) && Number(s) >= 0 && Number.isSafeInteger(Number(s));

type BatchBody = { commands: Record<string, unknown>[]; expectedVersion: number };
type BatchPrev = BatchBody & { previewHash: string; impact: { before: Totals; after: Totals }; warnings: string[] };
type Pend = { requestId: string; body: any };
/** Pending unknown outcomes survive tab navigation; keyed by scope, cleared on session invalid. */
const batchPend = new Map<string, Pend>(), contractPend = new Map<string, Pend>(), invoicePend = new Map<string, Pend & { contractId: string }>();
if (typeof window !== "undefined") window.addEventListener("office:session-invalid", () => { batchPend.clear(); contractPend.clear(); invoicePend.clear(); });

const th = { textAlign: "left", padding: 6, borderBottom: "1px solid var(--border-strong)", whiteSpace: "nowrap" } as const;
const td = { padding: 6, borderBottom: "1px solid var(--border-default)" } as const;
const warn = { color: "var(--color-warning)", fontSize: 13 } as const;
const bad = { color: "var(--color-error)", fontSize: 13 } as const;
const okc = { color: "var(--color-success, #1a7f37)", fontSize: 13 } as const;
const lab = { fontSize: 12, display: "flex", flexDirection: "column", gap: 2 } as const;

function Impact({ before, after }: { before: Totals; after: Totals }) {
  return <div style={{ overflowX: "auto" }}><table data-testid="billing-impact" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
    <thead><tr><th style={th}>항목</th><th style={th}>이전</th><th style={th}>이후</th></tr></thead>
    <tbody>{TOT.map(([k, l]) => <tr key={k}><td style={td}>{l}</td><td style={td}>{krw(before[k])}</td><td style={td}>{krw(after[k])}</td></tr>)}</tbody></table></div>;
}

export function OfficeBillingWorkflows({ scope, snapshot, onDone }: { scope: string; snapshot: FinanceSnapshot; onDone: () => void }) {
  const cap = useQuery({ queryKey: ["ops-cap"], queryFn: () => api.get<{ financeBatchVersion?: number }>("/office/operations/capabilities"), retry: false });
  const [mode, setMode] = useState<"bulk" | "renew">("renew");
  useEffect(() => { dropOthers(scope); }, [scope]);
  return <section style={{ ...box, display: "flex", flexDirection: "column", gap: 10 }} data-testid="office-billing-workflows">
    <p role="note" style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>수기 원장 기록입니다. 결제 승인·실제 수납이 아니며 금액은 직접 입력하거나 서버가 저장한 계약 금액만 사용합니다.</p>
    <div style={{ display: "flex", gap: 4 }}>
      <button style={mode === "renew" ? btn : btn2} data-testid="billing-mode-renew" onClick={() => setMode("renew")}>재등록 (계약 + 청구)</button>
      <button style={mode === "bulk" ? btn : btn2} data-testid="billing-mode-bulk" onClick={() => setMode("bulk")}>일괄 청구</button></div>
    {mode === "bulk" ? (cap.data?.financeBatchVersion === 1 ? <Bulk scope={scope} snapshot={snapshot} onDone={onDone} />
      : <div role="status" data-testid="billing-bulk-disabled" style={warn}>{cap.isLoading ? "서버 기능 확인 중…" : "서버가 일괄 청구를 아직 지원하지 않아 사용할 수 없습니다(financeBatchVersion 필요). 개별 청구는 업무 입력에서 가능합니다."}</div>)
      : <Renew scope={scope} snapshot={snapshot} onDone={onDone} />}
  </section>;
}

function Bulk({ scope, snapshot, onDone }: { scope: string; snapshot: FinanceSnapshot; onDone: () => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set()), [date, setDate] = useState(today()), [due, setDue] = useState(today());
  const [label, setLabel] = useState(""), [amount, setAmount] = useState(""), [over, setOver] = useState<Record<string, string>>({});
  const [q, setQ] = useState(""), [prev, setPrev] = useState<BatchPrev | null>(null), [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [done, setDone] = useState("");
  const [locked, setLocked] = useState(batchPend.has(scope));
  const name = useMemo(() => { const m = new Map(snapshot.students.map(s => [s.id, s.name])); return (id: string) => m.get(id) ?? id; }, [snapshot.students]);
  const touch = () => { setPrev(null); setOk(false); };
  const ids = [...sel];
  const amt = (id: string) => (over[id]?.trim() ? over[id] : amount).trim();
  const toggle = (id: string) => { if (locked) return; setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); touch(); };
  const shown = snapshot.students.filter(s => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

  const preview = async () => {
    if (locked) return;
    if (!ids.length) return setMsg("회원을 선택하세요.");
    if (ids.length > MAX) return setMsg(`한 번에 최대 ${MAX}명까지 가능합니다.`);
    if (!label.trim() || !date || !due) return setMsg("내용, 청구일, 납부기한을 입력하세요.");
    if (due < date) return setMsg("납부기한이 청구일보다 빠릅니다.");
    for (const id of ids) if (!isInt(amt(id))) return setMsg(`${name(id)}: 금액은 0 이상의 정수(원)여야 합니다.`);
    const commands = ids.map(id => ({ action: "invoice.issue", date, studentId: id, label: label.trim(), amountKrw: Number(amt(id)), dueDate: due }));
    setBusy(true); setMsg(""); setDone("");
    try {
      const r = await api.post<BatchPrev>("/office/operations/finance/batch/preview", { commands, expectedVersion: snapshot.version });
      setPrev({ commands: r.commands, expectedVersion: r.expectedVersion, previewHash: r.previewHash, impact: r.impact, warnings: r.warnings ?? [] }); setOk(false);
    } catch (e: any) { setPrev(null); setMsg(errText(e)); } finally { setBusy(false); }
  };
  const execute = async () => {
    if (!prev || !ok) return;
    const pend = batchPend.get(scope);
    const body = pend?.body ?? { requestId: uuid(), commands: prev.commands, expectedVersion: prev.expectedVersion, previewHash: prev.previewHash, confirmed: true as const };
    batchPend.set(scope,{requestId:body.requestId,body});
    setBusy(true); setMsg("");
    try {
      const r = await api.post<{ events:unknown[];version: number }>("/office/operations/finance/batch/execute", body);
      if(!Array.isArray(r.events)||!Number.isSafeInteger(r.version))throw Object.assign(new Error("서버 처리 결과 형식 확인 필요"),{status:502});
      batchPend.delete(scope); setLocked(false); setPrev(null); setOk(false); setSel(new Set()); setOver({});
      setDone(`일괄 청구 ${body.commands.length}건 기록 완료 · 원장 버전 ${r.version}`); onDone();
    } catch (e: any) {
      if (isUnknown(e)) { batchPend.set(scope, { requestId: body.requestId, body }); setLocked(true); setMsg(`${errText(e)} — 결과를 확인하지 못했습니다. 성공으로 처리하지 않으며 처리 결과 확인만 가능합니다.`); }
      else { batchPend.delete(scope); setPrev(null); setOk(false); setMsg(errText(e)); }
    } finally { setBusy(false); }
  };
  const recover = async () => {
    const p = batchPend.get(scope); if (!p) return;
    const it = await receiptItem(p.requestId) as { events?: unknown; version?: unknown } | null;
    if (!it || !Array.isArray(it.events) || !Number.isInteger(it.version)) return setMsg("서버 처리 영수증이 없거나 형식이 맞지 않습니다. 기록 없음은 미처리 증거가 아니므로 잠금을 유지합니다.");
    batchPend.delete(scope); setLocked(false); setPrev(null); setOk(false); setSel(new Set()); setDone("서버 영수증으로 일괄 청구 저장을 확인했습니다."); onDone();
  };
  const pb: BatchBody | null = locked ? (batchPend.get(scope)?.body ?? null) : prev;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="billing-bulk">
    <strong>일괄 청구 (최대 {MAX}명, 전체 성공 또는 전체 실패)</strong>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 8 }}>
      <label style={lab}>청구일 *<input style={inp} type="date" disabled={locked} value={date} onChange={e => { setDate(e.target.value); touch(); }} /></label>
      <label style={lab}>납부기한 *<input style={inp} type="date" disabled={locked} value={due} onChange={e => { setDue(e.target.value); touch(); }} /></label>
      <label style={lab}>내용 *<input data-testid="billing-label" style={inp} disabled={locked} value={label} onChange={e => { setLabel(e.target.value); touch(); }} /></label>
      <label style={lab}>공통 금액(원) *<input data-testid="billing-amount" style={inp} inputMode="numeric" disabled={locked} value={amount} onChange={e => { setAmount(e.target.value); touch(); }} /></label></div>
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input style={inp} placeholder="회원 검색" value={q} onChange={e => setQ(e.target.value)} />
      <button style={btn2} disabled={locked} onClick={() => { setSel(new Set(shown.slice(0, MAX).map(s => s.id))); touch(); }}>검색된 회원 선택(최대 {MAX})</button>
      <button style={btn2} disabled={locked} onClick={() => { setSel(new Set()); touch(); }}>선택 해제</button>
      <span style={{ fontSize: 12 }}>선택 {ids.length}명</span></div>
    <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid var(--border-default)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr><th style={th}></th><th style={th}>회원</th><th style={th}>개별 금액(비우면 공통)</th></tr></thead>
        <tbody>{shown.map(s => <tr key={s.id}><td style={td}><input type="checkbox" aria-label={`${s.name} 선택`} disabled={locked} checked={sel.has(s.id)} onChange={() => toggle(s.id)} /></td><td style={td}>{s.name}</td>
          <td style={td}>{sel.has(s.id) && <input style={{ ...inp, width: 120 }} inputMode="numeric" disabled={locked} value={over[s.id] ?? ""} onChange={e => { setOver(o => ({ ...o, [s.id]: e.target.value })); touch(); }} />}</td></tr>)}
          {!shown.length && <tr><td colSpan={3} style={{ ...td, color: "var(--text-muted)", padding: 16 }}>회원이 없습니다.</td></tr>}</tbody></table></div>
    {locked && <div role="alert" data-testid="billing-bulk-unknown" style={warn}>이전 일괄 청구 결과가 미확인입니다. 입력이 잠겼습니다. <button style={btn2} onClick={recover}>처리 결과 확인</button></div>}
    {msg && <div role="alert" style={bad}>{msg}</div>}
    {done && <div role="status" data-testid="billing-bulk-done" style={okc}>{done}</div>}
    {pb && <div style={{ ...box, background: "var(--surface-off)", fontSize: 13 }} data-testid="billing-bulk-preview">
      <strong>영향 미리보기 (서버 계산, 저장 전) · {pb.commands.length}명 · 합계 {krw(pb.commands.reduce((a, c: any) => a + Number(c.amountKrw), 0))}</strong>
      {prev && <Impact before={prev.impact.before} after={prev.impact.after} />}
      <div style={{ maxHeight: 200, overflow: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>회원</th><th style={th}>내용</th><th style={th}>금액</th><th style={th}>청구일</th><th style={th}>기한</th></tr></thead>
        <tbody>{pb.commands.map((c: any, i) => <tr key={i}><td style={td}>{name(c.studentId)}</td><td style={td}>{c.label}</td><td style={td}>{krw(c.amountKrw)}</td><td style={td}>{c.date}</td><td style={td}>{c.dueDate}</td></tr>)}</tbody></table></div>
      {prev?.warnings.map((w, i) => <div key={i} style={warn}>주의: {w}</div>)}
      <label style={{ display: "flex", gap: 6, marginTop: 6 }}><input data-testid="billing-bulk-confirm" type="checkbox" checked={ok} disabled={locked} onChange={e => setOk(e.target.checked)} />위 {pb.commands.length}명의 청구와 합계 영향을 확인했고 기록합니다. 미리보기 이후 내용은 바꿀 수 없습니다.</label></div>}
    <div style={{ display: "flex", gap: 6 }}>
      <button style={btn2} data-testid="billing-bulk-preview-btn" disabled={busy || locked} onClick={preview}>{busy ? "처리 중…" : "미리보기"}</button>
      <button style={btn} data-testid="billing-bulk-execute" disabled={busy || !prev || !ok} onClick={execute}>기록 확정</button></div>
  </div>;
}

type Terms = { contractPriceKrw?: number };
const termsOf = (c: OpsItem): Terms => (c.data?.terms ?? {}) as Terms;

function Renew({ scope, snapshot, onDone }: { scope: string; snapshot: FinanceSnapshot; onDone: () => void }) {
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["ops", "billing-products", scope], queryFn: () => listAllOps("products"), retry: false, refetchOnMount: "always" });
  const contracts = useQuery({ queryKey: ["ops", "billing-contracts", scope], queryFn: () => listAllOps("contracts"), retry: false, refetchOnMount: "always" });
  const [oldId, setOldId] = useState(""), [productId, setProductId] = useState(""), [start, setStart] = useState(today()), [end, setEnd] = useState(""), [disc, setDisc] = useState("");
  const [ackC, setAckC] = useState(false), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [cLocked, setCLocked] = useState(contractPend.has(scope));
  const [created, setCreated] = useState<OpsItem | null>(null), [newId, setNewId] = useState("");
  const name = (id: string) => snapshot.students.find(s => s.id === id)?.name ?? id;
  const all = useMemo(() => { const l = contracts.data?.items ?? []; return created && !l.some(c => c.id === created.id) ? [created, ...l] : l; }, [contracts.data, created]);
  const prods = products.data?.items ?? [];
  const prodName = (id: string) => prods.find(p => p.id === id)?.data?.name ?? id;
  const renewStudents = new Set(snapshot.rights.filter(r => r.renewalDue).map(r => r.studentId));
  const rightIds = new Set(snapshot.rights.filter(r => r.renewalDue).map(r => r.id));
  const targets = all.filter(c => renewStudents.has(c.data.studentId) && !c.data.previousContractId || rightIds.has(c.id));
  const old = all.find(c => c.id === oldId);
  const renewals = all.filter(c => c.data.previousContractId);
  const nc = all.find(c => c.id === newId);
  const edit = (f: () => void) => { if (cLocked) return; f(); setAckC(false); };

  const createContract = async () => {
    if (!old || !ackC) return;
    const pend = contractPend.get(scope);
    const data: Record<string, unknown> = { studentId: old.data.studentId, productId, startDate: start, endDate: end, status: "active", previousContractId: old.id };
    if (disc.trim()) data.discountKrw = Number(disc);
    const body = pend?.body ?? { requestId: uuid(), data };
    contractPend.set(scope,{requestId:body.requestId,body});
    setBusy(true); setMsg("");
    try {
      const r = await api.post<{ item: OpsItem }>("/office/operations/contracts", body);
      if(!r.item?.id)throw Object.assign(new Error("계약 저장 결과 형식 확인 필요"),{status:502});
      contractPend.delete(scope); setCLocked(false); setCreated(r.item); setNewId(r.item.id); setAckC(false);
      qc.invalidateQueries({ queryKey: ["ops"] }); onDone();
    } catch (e: any) {
      if (isUnknown(e)) { contractPend.set(scope, { requestId: body.requestId, body }); setCLocked(true); setMsg(`${errText(e)} — 계약 생성 결과를 확인하지 못했습니다. 다시 생성하지 않으며 처리 결과 확인만 가능합니다.`); }
      else if (e?.status === 409) { contractPend.delete(scope);setAckC(false); contracts.refetch(); setMsg(`${errText(e)} — 같은 재등록 계약이 이미 있을 수 있습니다. 목록을 새로 불러왔으니 아래 2단계에서 기존 계약을 선택하세요. 자동으로 다시 만들지 않습니다.`); }
      else {contractPend.delete(scope);setMsg(errText(e));}
    } finally { setBusy(false); }
  };
  const recoverContract = async () => {
    const p = contractPend.get(scope); if (!p) return;
    const res = await receiptItem(p.requestId) as { item?: OpsItem } | null;
    const it = res?.item;
    if (!it || typeof it.id !== "string") return setMsg("서버 처리 영수증이 없거나 형식이 맞지 않습니다. 기록 없음은 미처리 증거가 아니므로 잠금을 유지합니다.");
    contractPend.delete(scope); setCLocked(false); setCreated(it); setNewId(it.id); setMsg(""); qc.invalidateQueries({ queryKey: ["ops"] }); onDone();
  };
  const body0 = contractPend.get(scope)?.body?.data;
  const pdata = cLocked ? body0 : old ? { studentId: old.data.studentId, productId, startDate: start, endDate: end, discountKrw: disc } : null;
  const canC = !!old && !!productId && !!start && !!end && end >= start && (!disc.trim() || /^\d+$/.test(disc.trim()));

  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="billing-renew">
    <strong>재등록: 새 계약 생성 후 청구</strong>
    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>기존 계약은 수정하지 않고 새 계약을 만듭니다. 새 계약의 금액은 서버가 계약 시점 상품 조건으로 확정해 저장합니다. 반·수강배정(날짜별 수업 지정)은 이 화면에서 하지 않으며, 계약 생성 후 기존 [상품·수강배정] 화면에서 직접 지정하세요.</p>
    {(contracts.isError || products.isError) && <div role="alert" style={bad}>계약·상품을 불러오지 못했습니다. <button style={btn2} onClick={() => { contracts.refetch(); products.refetch(); }}>다시 시도</button></div>}
    {(contracts.isLoading || products.isLoading) && <div style={{ height: 60, background: "var(--surface-subtle)", borderRadius: 4 }} />}

    <div style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>1단계 · 계약</strong>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
        <label style={lab}>갱신 대상(기존 계약) *<select data-testid="renew-old" style={inp} disabled={cLocked} value={oldId} onChange={e => edit(() => setOldId(e.target.value))}><option value="">선택</option>
          {targets.map(c => <option key={c.id} value={c.id}>{name(c.data.studentId)} · {prodName(c.data.productId)} · ~{c.data.endDate}{rightIds.has(c.id) ? " (갱신 필요 수강권)" : ""}</option>)}</select></label>
        <label style={lab}>새 상품 *<select data-testid="renew-product" style={inp} disabled={cLocked} value={productId} onChange={e => edit(() => setProductId(e.target.value))}><option value="">선택</option>
          {prods.map(p => <option key={p.id} value={p.id}>{p.data.name} ({krw(p.data.priceKrw)})</option>)}</select></label>
        <label style={lab}>시작일 *<input style={inp} type="date" disabled={cLocked} value={start} onChange={e => edit(() => setStart(e.target.value))} /></label>
        <label style={lab}>종료일 *<input style={inp} type="date" disabled={cLocked} value={end} onChange={e => edit(() => setEnd(e.target.value))} /></label>
        <label style={lab}>계약 할인(원, 선택)<input style={inp} inputMode="numeric" disabled={cLocked} value={disc} onChange={e => edit(() => setDisc(e.target.value))} /></label></div>
      {!targets.length && !contracts.isLoading && <small style={{ color: "var(--text-muted)" }}>실제 수강권 기준으로 갱신이 필요한 계약이 없습니다.</small>}
      {pdata && <div style={{ ...box, background: "var(--surface-off)", fontSize: 13 }} data-testid="renew-summary">
        회원 {name(String(pdata.studentId))} · 상품 {prodName(String(pdata.productId))} · {pdata.startDate} ~ {pdata.endDate}{pdata.discountKrw ? ` · 할인 ${krw(Number(pdata.discountKrw))}` : ""}
        <label style={{ display: "flex", gap: 6, marginTop: 6 }}><input data-testid="renew-confirm" type="checkbox" checked={ackC || cLocked} disabled={cLocked || !canC} onChange={e => setAckC(e.target.checked)} />위 내용으로 새 계약을 만들며, 금액은 생성 시점의 상품 조건으로 고정(되돌릴 수 없는 스냅샷)됨을 확인합니다.</label></div>}
      {cLocked && <div role="alert" data-testid="renew-unknown" style={warn}>계약 생성 결과가 미확인입니다. 입력이 잠겼습니다. <button style={btn2} onClick={recoverContract}>처리 결과 확인</button></div>}
      {msg && <div role="alert" style={bad}>{msg}</div>}
      <div><button style={btn} data-testid="renew-create" disabled={busy || cLocked || !canC || !ackC || !!created && created.data.previousContractId === oldId} onClick={createContract}>{busy ? "처리 중…" : "새 계약 생성"}</button></div>
    </div>

    <div style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>2단계 · 청구</strong>
      <label style={lab}>재등록 계약 선택(서버에 저장된 새 계약, 이어서 진행 가능)<select data-testid="renew-new" style={inp} value={newId} onChange={e => setNewId(e.target.value)}><option value="">선택</option>
        {renewals.map(c => <option key={c.id} value={c.id}>{name(c.data.studentId)} · {prodName(c.data.productId)} · {c.data.startDate}~{c.data.endDate}</option>)}</select></label>
      {nc ? <InvoiceStep key={nc.id} scope={scope} contract={nc} studentName={name(nc.data.studentId)} onDone={() => { qc.invalidateQueries({ queryKey: ["ops"] }); onDone(); }} />
        : <small style={{ color: "var(--text-muted)" }}>계약을 선택하면 발행된 청구 여부와 청구 단계가 표시됩니다.</small>}
    </div>
  </div>;
}

function InvoiceStep({ scope, contract, studentName, onDone }: { scope: string; contract: OpsItem; studentName: string; onDone: () => void }) {
  const price = termsOf(contract).contractPriceKrw;
  const fresh = useQuery({ queryKey: ["office-finance-fresh", scope, contract.id], queryFn: () => fetchSnapshot("0001-01-01", kstToday(), ""), retry: false, refetchOnMount: "always", staleTime: 0, gcTime: 0 });
  const fs = fresh.data;
  const existing = (fs?.invoices ?? []).filter(i => i.contractId === contract.id);
  const live = existing.filter(i => !i.cancelled);
  const pend = invoicePend.get(scope);
  const pendHere = pend?.contractId === contract.id ? pend : undefined;
  const [date, setDate] = useState(today()), [due, setDue] = useState(today()), [label, setLabel] = useState(`재등록 ${contract.data.startDate}~${contract.data.endDate}`);
  const [prev, setPrev] = useState<PreviewResult | null>(null), [ok, setOk] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [done, setDone] = useState("");
  const [locked, setLocked] = useState(!!pendHere);
  const otherLock = !!pend && !pendHere;
  const validPrice = typeof price === "number" && Number.isInteger(price) && price >= 0;
  const touch = () => { setPrev(null); setOk(false); };
  const command = { action: "invoice.issue", date, studentId: contract.data.studentId, contractId: contract.id, label: label.trim(), amountKrw: price, dueDate: due };

  const doPreview = async () => {
    if (!fs) return setMsg("전체 기간 원장을 확인하지 못해 청구할 수 없습니다. 다시 시도하세요.");
    if (!validPrice) return setMsg("계약에 저장된 금액(terms.contractPriceKrw)이 없어 청구할 수 없습니다.");
    if (!label.trim() || !date || !due || due < date) return setMsg("청구일·기한·내용을 확인하세요.");
    setBusy(true); setMsg("");
    try { setPrev(await previewFinance(command, fs!.version)); setOk(false); } catch (e: any) { setPrev(null); setMsg(errText(e)); } finally { setBusy(false); }
  };
  const doExecute = async () => {
    if (!prev || !ok || live.length) return;
    const body = pendHere?.body ?? { requestId: uuid(), command: prev.command, expectedVersion: prev.expectedVersion, previewHash: prev.previewHash, confirmed: true as const };
    invoicePend.set(scope,{requestId:body.requestId,body,contractId:contract.id});
    setBusy(true); setMsg("");
    try {
      const r = await executeFinance(body);
      if(!r.event?.id||!Number.isSafeInteger(r.version))throw Object.assign(new Error("청구 저장 결과 형식 확인 필요"),{status:502});
      invoicePend.delete(scope); setLocked(false); setPrev(null); setOk(false); setDone(`청구 기록 완료 · 원장 버전 ${r.version}`); fresh.refetch(); onDone();
    } catch (e: any) {
      if (isUnknown(e)) { invoicePend.set(scope, { requestId: body.requestId, body, contractId: contract.id }); setLocked(true); setMsg(`${errText(e)} — 청구 결과를 확인하지 못했습니다. 성공으로 처리하지 않으며 처리 결과 확인만 가능합니다.`); }
      else { invoicePend.delete(scope);setPrev(null); setOk(false); setMsg(`${errText(e)} (계약은 이미 생성되어 있으며 다시 만들지 않습니다. 청구만 다시 시도하세요.)`); }
    } finally { setBusy(false); }
  };
  const recover = async () => {
    if (!pendHere) return;
    const it = await receiptItem(pendHere.requestId) as { event?: { id?: unknown }; version?: unknown } | null;
    if (!it || typeof it.event?.id !== "string" || !Number.isInteger(it.version)) return setMsg("서버 처리 영수증이 없거나 형식이 맞지 않습니다. 기록 없음은 미처리 증거가 아니므로 잠금을 유지합니다.");
    invoicePend.delete(scope); setLocked(false); setPrev(null); setDone("서버 영수증으로 청구 저장을 확인했습니다."); fresh.refetch(); onDone();
  };
  useEffect(() => { if (live.length) setPrev(null); }, [live.length]);
  const shownBody = locked ? pendHere?.body?.command : prev?.command;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="renew-invoice-step">
    <div data-testid="renew-contract-exists" style={okc}>새 계약이 서버에 저장되어 있습니다: {studentName} · {contract.data.startDate}~{contract.data.endDate} · 계약 {contract.id.slice(0, 8)}</div>
    {fresh.isLoading && <div style={{ height: 40, background: "var(--surface-subtle)", borderRadius: 4 }} />}
    {fresh.isError && <div role="alert" style={bad}>전체 기간 청구 확인 실패: 중복 여부를 알 수 없어 청구를 막았습니다. <button style={btn2} onClick={() => fresh.refetch()}>다시 시도</button></div>}
    {existing.length > 0 && <div data-testid="renew-existing-invoices" style={{ fontSize: 13 }}>
      <strong>이 계약으로 발행된 청구</strong>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{existing.map(i => <li key={i.id}>{i.label} · {krw(i.amountKrw)} · 미납 {krw(i.dueKrw)} · {i.cancelled ? "취소" : i.dueKrw === 0 ? "완납" : "미납"}</li>)}</ul></div>}
    {!fs ? null : live.length > 0 ? <div role="status" data-testid="renew-duplicate-block" style={warn}>이 계약에는 이미 유효한 청구가 있어 중복 청구를 만들 수 없습니다. 수납·배분은 수납 탭에서 진행하세요.</div> : <>
      {!validPrice && <div role="alert" style={bad}>계약에 저장된 청구 금액(terms.contractPriceKrw)이 없습니다. 임의로 계산하지 않으므로 청구할 수 없습니다.</div>}
      {otherLock && <div role="alert" style={warn}>다른 청구의 결과가 미확인입니다. 먼저 그 계약에서 처리 결과를 확인하세요.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>
        <label style={lab}>청구 금액(계약 확정 금액, 수정 불가)<input data-testid="renew-amount" style={inp} readOnly value={validPrice ? krw(price) : "-"} /></label>
        <label style={lab}>청구일 *<input style={inp} type="date" disabled={locked} value={date} onChange={e => { setDate(e.target.value); touch(); }} /></label>
        <label style={lab}>납부기한 *<input style={inp} type="date" disabled={locked} value={due} onChange={e => { setDue(e.target.value); touch(); }} /></label>
        <label style={lab}>내용 *<input style={inp} disabled={locked} value={label} onChange={e => { setLabel(e.target.value); touch(); }} /></label></div>
      {locked && <div role="alert" data-testid="renew-invoice-unknown" style={warn}>청구 결과가 미확인입니다. 입력이 잠겼습니다. <button style={btn2} onClick={recover}>처리 결과 확인</button></div>}
      {shownBody && <div style={{ ...box, background: "var(--surface-off)", fontSize: 13 }} data-testid="renew-invoice-preview">
        <strong>청구 영향 미리보기 (저장 전) · {krw(Number((shownBody as any).amountKrw))}</strong>
        {prev && <Impact before={prev.impact.before} after={prev.impact.after} />}
        {prev?.warnings.map((w, i) => <div key={i} style={warn}>주의: {w}</div>)}
        <label style={{ display: "flex", gap: 6, marginTop: 6 }}><input data-testid="renew-invoice-confirm" type="checkbox" checked={ok} disabled={locked} onChange={e => setOk(e.target.checked)} />청구 금액 {krw(Number((shownBody as any).amountKrw))}을(를) {studentName}에게 청구함을 확인합니다.</label></div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button style={btn2} data-testid="renew-invoice-preview-btn" disabled={busy || locked || otherLock || !validPrice || !fs} onClick={doPreview}>{busy ? "처리 중…" : "청구 미리보기"}</button>
        <button style={btn} data-testid="renew-invoice-execute" disabled={busy || !prev || !ok} onClick={doExecute}>청구 확정</button></div></>}
    {msg && <div role="alert" style={bad}>{msg}</div>}
    {done && <div role="status" data-testid="renew-invoice-done" style={okc}>{done}</div>}
  </div>;
}
