import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api-client";
import { download } from "./office-ops-lib";
import { ui } from "./office-ops-styles";
import {
  financeKey, fetchSnapshot, previewFinance, executeFinance, lookupReceipt, buildCommand, isUnknownOutcome, financeCsv, krw, uuid,
  type FinanceSnapshot, type PreviewResult, type FinanceActionSpec, type Totals,
} from "./office-finance-api";

const { box, inp, btn, btn2 } = ui;
type Tab = "summary" | "invoices" | "receipts" | "allocations" | "refunds" | "expenses" | "rights" | "closings" | "families" | "events" | "entry";
const TABS: [Tab, string][] = [["summary", "요약·보고서"], ["invoices", "청구"], ["receipts", "수납"], ["allocations", "배분"], ["refunds", "환불"], ["expenses", "지출·강사정산"], ["rights", "수강권·갱신"], ["closings", "마감"], ["families", "가족·회원"], ["events", "처리 내역"], ["entry", "업무 입력"]];
const TOTAL_LABELS: [keyof Totals, string, string][] = [["billedKrw", "청구 누계", "기준일 잔액"], ["dueKrw", "미납 잔액", "기준일 잔액"], ["unallocatedKrw", "미배분 수납", "기준일 잔액"], ["receivedKrw", "기간 수납", "기간 거래일"], ["refundedKrw", "기간 환불", "기간 거래일"], ["expensesPaidKrw", "기간 지출 지급", "기간 거래일"], ["cashFlowKrw", "기간 현금흐름", "기간 거래일"]];
const errMsg = (e: any) => e?.status === 503 ? "수납 원장 서버 마이그레이션이 아직 적용되지 않았습니다. 합계·목록을 표시하지 않으며 저장도 되지 않습니다." : e?.status === 409 ? `충돌: ${e.message ?? "다른 변경과 겹칩니다. 새로고침 후 미리보기를 다시 실행하세요."}` : e?.message ?? "요청 실패";
const today = () => new Date().toISOString().slice(0, 10);

type Draft = { actionKey: string; date: string; form: Record<string, string> };
const drafts = new Map<string, Draft>();
/** Unknown outcome: same requestId and body kept; only receipt confirmation allowed. */
const unsure = new Map<string, { requestId: string; body: any }>();
const clearMemory = (keep?: string) => { for (const m of [drafts, unsure] as Map<string, unknown>[]) for (const k of [...m.keys()]) if (k !== keep) m.delete(k); };
if (typeof window !== "undefined") window.addEventListener("office:session-invalid", () => clearMemory());

/** Stage an AI/Action draft into the regular entry form of the same user+pool scope. Never executes. */
export function stageFinanceDraft(scope: string, command: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("office-finance-draft", { detail: { scope, command } }));
}
type Interpret = { kind: "unavailable"; message: string } | { kind: "clarify"; question: string } | { kind: "draft"; command: Record<string, unknown>; message?: string };

function AiDraft({ scope, studentId, hasX }: { scope: string; studentId: string; hasX: boolean }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [out, setOut] = useState(""), [catalog, setCatalog] = useState<any>(null);
  useEffect(() => { let on = true; api.get<any>("/office/operations/workspace/catalog").then(c => { if (on) setCatalog(c); }).catch(() => { if (on) setCatalog(null); }); return () => { on = false; }; }, [scope]);
  const ask = async () => {
    if (!text.trim()) return; setBusy(true); setOut("");
    try {
      const r = await api.post<Interpret>("/office/operations/workspace/interpret", { text: text.trim(), ...(studentId ? { memberId: studentId } : {}) });
      if (r.kind === "draft") { stageFinanceDraft(scope, r.command); setOut(`${r.message ?? "초안을 업무 입력 양식에 채웠습니다."} 확정되지 않았습니다. 미리보기와 영향 확인 후 직접 기록하세요.`); }
      else if (r.kind === "clarify") setOut(r.question); else setOut(r.message);
    } catch (e: any) { setOut(e?.status === 403 ? "이 기능은 스윔노트 AI 이용 권한이 필요합니다(서버 판단)." : errMsg(e)); } finally { setBusy(false); }
  };
  return <section data-finance-noprint style={{ ...box, display: "flex", flexDirection: "column", gap: 6 }} data-testid="finance-ai">
    <strong>AI 초안 (선택)</strong>
    <ul style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, paddingLeft: 18 }}>
      <li>화면 이동·조회: 연결됨</li>
      <li>초안 작성: 서버 경로 연결됨, 모델 사용은 별도 승인 대기{catalog && (catalog.modelEnabled ? " (서버 설정은 켜짐, 실제 동작은 검증되지 않음)" : " (현재 꺼짐)")}</li>
      <li>실행: 항상 일반 영향 미리보기와 사람의 확인 후에만 기록됩니다.</li></ul>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <input data-testid="finance-ai-text" style={{ ...inp, flex: 1, minWidth: 220 }} disabled={!hasX} placeholder={studentId ? "선택한 회원 기준 초안 요청" : "예: 이번 달 수납 초안 요청"} value={text} onChange={e => setText(e.target.value)} />
      <button style={btn2} data-testid="finance-ai-ask" disabled={busy || !hasX || !text.trim()} onClick={ask}>{busy ? "요청 중…" : "초안 요청"}</button></div>
    {!hasX && <small style={{ color: "var(--text-muted)" }}>스윔노트 AI 이용 권한이 없어 AI 초안을 사용할 수 없습니다. 수납 업무는 AI 없이 그대로 사용할 수 있습니다.</small>}
    {out && <div role="status" data-testid="finance-ai-out" style={{ fontSize: 13 }}>{out}</div>}
  </section>;
}

const th = { textAlign: "left", padding: 6, borderBottom: "1px solid var(--border-strong)", whiteSpace: "nowrap" } as const;
const td = { padding: 6, borderBottom: "1px solid var(--border-default)" } as const;
function Table({ head, rows, empty, testid }: { head: string[]; rows: React.ReactNode[][]; empty: string; testid: string }) {
  return <div style={{ overflowX: "auto" }}><table data-testid={testid} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
    <thead><tr>{head.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}
      {!rows.length && <tr><td colSpan={head.length} style={{ ...td, color: "var(--text-muted)", padding: 16 }}>{empty}</td></tr>}</tbody></table></div>;
}

export function OfficeFinancePanel() {
  const { state } = useAuth();
  const scope = state.status === "authenticated" ? `${state.user.id}:${state.user.swimming_pool_id}` : "unauthenticated";
  const hasX = state.status === "authenticated" && state.user.hasX;
  useEffect(() => { clearMemory(scope === "unauthenticated" ? undefined : scope); }, [scope]);
  return <FinanceInner key={scope} scope={scope} hasX={hasX} />;
}

function FinanceInner({ scope, hasX }: { scope: string; hasX: boolean }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("summary");
  const [from, setFrom] = useState(`${today().slice(0, 8)}01`), [to, setTo] = useState(today()), [studentId, setStudentId] = useState("");
  const [search, setSearch] = useState("");
  const [staged, setStaged] = useState<{ command: Record<string, unknown>; nonce: number } | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.scope === scope) { setStaged({ command: d.command, nonce: Date.now() }); setTab("entry"); } };
    window.addEventListener("office-finance-draft", h); return () => window.removeEventListener("office-finance-draft", h);
  }, [scope]);
  const key = financeKey(scope, from, to, studentId);
  const snap = useQuery({ queryKey: key, queryFn: () => fetchSnapshot(from, to, studentId), retry: false, refetchOnWindowFocus: false, staleTime: 10_000, refetchOnMount: "always", refetchInterval: 30_000, refetchIntervalInBackground: false, enabled: scope !== "unauthenticated" });
  const d: FinanceSnapshot | undefined = snap.data;
  const nameOf = useMemo(() => { const m = new Map((d?.students ?? []).map(s => [s.id, s.name])); return (id: string) => m.get(id) ?? id; }, [d]);
  const match = (...v: unknown[]) => !search.trim() || v.some(x => String(x ?? "").toLowerCase().includes(search.trim().toLowerCase()));
  const sid = (id: string) => `${nameOf(id)}`;

  const invoices = (d?.invoices ?? []).filter(x => match(x.label, nameOf(x.studentId), x.id));
  const receipts = (d?.receipts ?? []).filter(x => match(x.method, nameOf(x.studentId), x.id));
  const allocations = (d?.allocations ?? []).filter(x => match(x.id, x.receiptId, x.invoiceId));
  const expenses = (d?.expenses ?? []).filter(x => match(x.label, x.vendor, x.category, x.kind));
  const refunds = (d?.events ?? []).filter(e => e.action === "refund.record" && match(e.externalRef, e.reason, e.receiptId));
  const rights = (d?.rights ?? []).filter(x => match(x.label, nameOf(x.studentId)));
  const events = (d?.events ?? []).filter(e => match(e.action, e.reason, e.label, e.externalRef, e.id));

  const csv = (name: string, head: string[], rows: unknown[][]) => download(`${name}-${from}_${to}.csv`, financeCsv(head, rows));
  const reports: Record<string, () => void> = {
    청구: () => csv("invoices", ["id", "회원", "내용", "청구일", "기한", "청구액", "배분액", "미납액", "취소"], invoices.map(x => [x.id, nameOf(x.studentId), x.label, x.date, x.dueDate, x.amountKrw, x.allocatedKrw, x.dueKrw, x.cancelled])),
    수납: () => csv("receipts", ["id", "회원", "수납일", "방식", "금액", "환불", "미배분", "오입력취소"], receipts.map(x => [x.id, nameOf(x.studentId), x.date, x.method, x.amountKrw, x.refundedKrw, x.unallocatedKrw, x.voided])),
    지출: () => csv("expenses", ["id", "내용", "예정일", "거래처", "분류", "구분", "금액", "지급", "미지급", "취소"], expenses.map(x => [x.id, x.label, x.dueDate, x.vendor, x.category, x.kind, x.amountKrw, x.paidKrw, x.dueKrw, x.cancelled])),
    배분: () => csv("allocations", ["id", "수납", "청구", "배분액", "잔여"], allocations.map(x => [x.id, x.receiptId, x.invoiceId, x.amountKrw, x.remainingKrw])),
    처리내역: () => csv("events", ["id", "업무", "기록일", "금액", "사유"], events.map(e => [e.id, e.action, e.date, e.amountKrw ?? e.deltaKrw ?? "", e.reason ?? ""])),
  };

  return <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="office-finance">
    <style>{`@media print{[data-finance-noprint]{display:none!important}}`}</style>
    <h1 style={{ fontSize: 18 }}>재등록·청구·수납 원장</h1>
    <p role="note" style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>센터 운영 기록용 수기 원장입니다. 수동 수납·환불은 PG 승인·실제 환불이 아니며, 실제 입출금 식별번호를 직접 기록합니다. 앱 구독 결제를 대체하지 않습니다.</p>
    <div data-finance-noprint style={{ ...box, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <label style={{ fontSize: 12 }}>기간 시작 <input data-testid="finance-from" style={inp} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label style={{ fontSize: 12 }}>기간 종료(기준일) <input data-testid="finance-to" style={inp} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <label style={{ fontSize: 12 }}>회원 <select data-testid="finance-student" style={inp} value={studentId} onChange={e => setStudentId(e.target.value)}><option value="">전체</option>
        {(d?.students ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <input data-testid="finance-search" style={{ ...inp, marginLeft: "auto" }} placeholder="목록 검색" value={search} onChange={e => setSearch(e.target.value)} />
      <button style={btn2} onClick={() => snap.refetch()}>새로고침</button>
    </div>
    {snap.isLoading && <div style={{ height: 80, background: "var(--surface-subtle)", borderRadius: 4 }} />}
    {snap.isError && <div role="alert" data-testid="finance-error" style={{ ...box, color: "var(--color-error)" }}>{errMsg(snap.error)} <button style={btn2} onClick={() => snap.refetch()}>다시 시도</button></div>}
    <AiDraft scope={scope} studentId={studentId} hasX={hasX} />
    <div data-finance-noprint style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{TABS.map(([k, l]) => <button key={k} data-testid={`finance-tab-${k}`} style={tab === k ? btn : btn2} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "entry" && <EntryForm scope={scope} d={d} date={to} staged={staged} onDone={() => { qc.invalidateQueries({ queryKey: ["office-finance", scope] }); qc.invalidateQueries({ queryKey: ["ops"] }); }} />}
    {d && tab !== "entry" && <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
      {tab === "summary" && <div data-testid="finance-report">
        <strong>재무 보고서 {from} ~ {to}{studentId && ` · ${nameOf(studentId)}`}</strong>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>기준일 잔액은 {to}까지의 누적이며, 기간 거래일 항목은 {from}~{to} 사이 기록일 합계입니다.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 8 }}>
          {TOTAL_LABELS.map(([k, l, b]) => <div key={k} style={{ ...box, background: "var(--surface-off)" }}><div style={{ fontSize: 12 }}>{l} <span style={{ color: "var(--text-muted)" }}>({b})</span></div>
            <strong data-testid={`total-${k}`}>{krw(d.totals[k])}</strong></div>)}</div>
        <ul style={{ fontSize: 12, color: "var(--text-muted)" }}>{d.basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
        <div data-finance-noprint style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.keys(reports).map(k => <button key={k} style={btn2} onClick={reports[k]}>{k} CSV</button>)}
          <button style={btn} data-testid="finance-print" onClick={() => window.print()}>인쇄·PDF 저장(브라우저 인쇄)</button></div>
      </div>}
      {tab === "invoices" && <Table testid="finance-invoices" empty="청구가 없습니다." head={["회원", "내용", "청구일", "기한", "청구액", "배분", "미납", "상태"]}
        rows={invoices.map(x => [sid(x.studentId), x.label, x.date, x.dueDate, krw(x.amountKrw), krw(x.allocatedKrw), krw(x.dueKrw), x.cancelled ? "취소" : x.dueKrw === 0 ? "완납" : x.dueDate < to ? "연체" : "미납"])} />}
      {tab === "receipts" && <Table testid="finance-receipts" empty="수납이 없습니다." head={["회원", "수납일", "방식", "금액", "환불", "미배분", "상태"]}
        rows={receipts.map(x => [sid(x.studentId), x.date, x.method, krw(x.amountKrw), krw(x.refundedKrw), krw(x.unallocatedKrw), x.voided ? "오입력 정정" : "수기 기록"])} />}
      {tab === "allocations" && <Table testid="finance-allocations" empty="배분이 없습니다." head={["배분 ID", "수납", "청구", "배분액", "잔여"]}
        rows={allocations.map(x => [x.id.slice(0, 8), x.receiptId.slice(0, 8), d.invoices.find(i => i.id === x.invoiceId)?.label ?? x.invoiceId, krw(x.amountKrw), krw(x.remainingKrw)])} />}
      {tab === "refunds" && <><p style={{ fontSize: 12, color: "var(--text-muted)" }}>실제로 돌려준 환불을 수기로 기록한 내역입니다. 원 수납 원금 범위 안에서만 가능하며 PG 환불 승인이 아닙니다.</p>
        <Table testid="finance-refunds" empty="환불 기록이 없습니다." head={["기록일", "원 수납", "금액", "식별번호", "사유"]}
          rows={refunds.map(e => [e.date, String(e.receiptId).slice(0, 8), krw(e.amountKrw), e.externalRef, e.reason])} /></>}
      {tab === "expenses" && <Table testid="finance-expenses" empty="지출 예정이 없습니다." head={["구분", "내용", "거래처", "분류", "예정일", "금액", "지급", "미지급", "증빙"]}
        rows={expenses.map(x => [x.kind === "instructor_settlement" ? "강사정산" : "운영", x.label, x.vendor, x.category, x.dueDate, krw(x.amountKrw), krw(x.paidKrw), x.cancelled ? "취소" : krw(x.dueKrw), x.evidenceUrl ? <a href={x.evidenceUrl} target="_blank" rel="noopener noreferrer">열기</a> : "-"])} />}
      {tab === "rights" && <Table testid="finance-rights" empty="수강권이 없습니다." head={["회원", "수강권", "기간", "총 횟수", "사용", "잔여", "주간 횟수", "출석 근거", "상태"]}
        rows={rights.map(x => [sid(x.studentId), x.label, `${x.startDate}~${x.endDate}`, x.remainingCount === null ? "기간제(총횟수 없음)" : x.totalCount, x.usedCount, x.remainingCount === null ? "-" : x.remainingCount, x.weeklyCount != null ? `주 ${x.weeklyCount}회 (이번 주 ${x.weeklyUsedCount ?? 0}회 사용)` : "-", x.sourceAttendanceCount, [x.held && "휴회", x.renewalDue && (x.remainingCount === null ? "만료 갱신 필요" : "갱신 필요")].filter(Boolean).join(", ") || "정상"])} />}
      {tab === "closings" && <Table testid="finance-closings" empty="마감 기간이 없습니다." head={["시작", "종료", "상태", "사유"]}
        rows={d.closings.map(x => [x.fromDate, x.toDate, x.active ? "마감" : "해제", x.reason])} />}
      {tab === "families" && <><strong>가족 합산</strong><Table testid="finance-families" empty="가족 묶음이 없습니다." head={["가족", "회원", "청구", "미납"]}
        rows={d.families.filter(f => match(f.label)).map(f => [f.label, f.studentIds.map(nameOf).join(", "), krw(f.billedKrw), krw(f.dueKrw)])} />
        <strong>회원별 귀속</strong><Table testid="finance-students" empty="회원이 없습니다." head={["회원", "청구", "수납", "미납"]}
          rows={d.students.filter(s => match(s.name)).map(s => [s.name, studentId === s.id && d.studentTotals ? krw(d.studentTotals.billedKrw) : "회원 선택 시 서버 합계", studentId === s.id && d.studentTotals ? krw(d.studentTotals.receivedKrw) : "-", studentId === s.id && d.studentTotals ? krw(d.studentTotals.dueKrw) : "-"])} />
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>회원별 귀속 합계는 서버 계산값(studentTotals)만 표시합니다. 위에서 회원을 선택하세요.</p></>}
      {tab === "events" && <Table testid="finance-events" empty="처리 내역이 없습니다." head={["기록일", "업무", "금액", "사유"]}
        rows={events.map(e => [e.date, d.actions.find(a => a.key === e.action)?.label ?? e.action, e.amountKrw ?? e.deltaKrw ?? "-", e.reason ?? e.label ?? ""])} />}
    </section>}
  </div>;
}

function EntryForm({ scope, d, date: defDate, onDone, staged }: { staged: { command: Record<string, unknown>; nonce: number } | null; scope: string; d?: FinanceSnapshot; date: string; onDone: () => void }) {
  const d0 = drafts.get(scope);
  const [actionKey, setActionKey] = useState(d0?.actionKey ?? ""), [date, setDate] = useState(d0?.date ?? defDate), [form, setForm] = useState<Record<string, string>>(d0?.form ?? {});
  const [prev, setPrev] = useState<PreviewResult | null>(null), [ok, setOk] = useState(false), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(unsure.has(scope)), [done, setDone] = useState("");
  useEffect(() => { if (actionKey) drafts.set(scope, { actionKey, date, form }); }, [scope, actionKey, date, form]);
  useEffect(() => {
    if (!staged || unsure.has(scope)) return;
    const { action, date: dd, ...rest } = staged.command as Record<string, unknown>;
    setActionKey(String(action ?? "")); if (typeof dd === "string") setDate(dd);
    setForm(Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])));
    setPrev(null); setOk(false); setMsg("AI 초안을 채웠습니다. 내용을 확인하고 미리보기를 실행하세요(자동 확정 없음).");
  }, [staged?.nonce]);
  const spec: FinanceActionSpec | undefined = d?.actions.find(a => a.key === actionKey);
  const edit = (patch: Record<string, string>) => { if (locked) return; setForm(f => ({ ...f, ...patch })); setPrev(null); setOk(false); };
  const doPreview = async () => {
    if (!spec || !d || locked) return;
    const b = buildCommand(spec, date, form); if (b.error) return setMsg(b.error);
    setBusy(true); setMsg(""); setDone("");
    try { setPrev(await previewFinance(b.command!, d.version)); setOk(false); } catch (e: any) { setPrev(null); setMsg(errMsg(e)); } finally { setBusy(false); }
  };
  const doExecute = async () => {
    if (!prev || !ok) return;
    const pend = unsure.get(scope);
    const body = pend?.body ?? { requestId: uuid(), command: prev.command, expectedVersion: prev.expectedVersion, previewHash: prev.previewHash, confirmed: true as const };
    setBusy(true); setMsg("");
    try {
      const r = await executeFinance(body);
      unsure.delete(scope); drafts.delete(scope); setLocked(false); setPrev(null); setOk(false); setForm({}); setActionKey("");
      setDone(`처리 완료: 요청 ${body.requestId.slice(0, 8)} · 원장 버전 ${r.version} (영수증 확인됨)`); onDone();
    } catch (e: any) {
      if (isUnknownOutcome(e)) { unsure.set(scope, { requestId: body.requestId, body }); setLocked(true); setMsg(`${errMsg(e)} — 결과를 확인하지 못했습니다(성공으로 처리하지 않음). 처리 결과 확인만 가능합니다.`); }
      else { unsure.delete(scope); setPrev(null); setOk(false); setMsg(errMsg(e)); }
    } finally { setBusy(false); }
  };
  const confirmReceipt = async () => {
    const p = unsure.get(scope); if (!p) return;
    try { const r = await lookupReceipt(p.requestId);
      if (!r.item) return setMsg("확정된 처리 결과가 없습니다. 기록 없음은 미처리 증거가 아니므로 잠금을 유지합니다.");
      unsure.delete(scope); drafts.delete(scope); setLocked(false); setPrev(null); setForm({}); setActionKey(""); setDone("서버 처리 영수증으로 저장을 확인했습니다."); onDone();
    } catch { setMsg("결과를 확정하지 못했습니다. 조회 실패·404는 미처리 증거가 아닙니다. 동일 요청을 유지합니다."); }
  };
  if (!d) return <div style={box}>원장을 불러온 뒤 입력할 수 있습니다.</div>;
  const rows = (t: Totals) => <>{(["billedKrw", "dueKrw", "unallocatedKrw", "receivedKrw", "refundedKrw", "expensesPaidKrw", "cashFlowKrw"] as const).map(k => [k, t[k]] as const)}</>;
  void rows;
  return <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }} data-testid="finance-entry">
    <strong>업무 입력 (미리보기 후 영향 확인 필수)</strong>
    <select data-testid="finance-action" style={inp} disabled={locked} value={actionKey} onChange={e => { setActionKey(e.target.value); setForm({}); setPrev(null); setOk(false); }}>
      <option value="">업무 선택</option>{d.actions.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
    {spec && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
      <label style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>기록일 *<input style={inp} type="date" disabled={locked} value={date} onChange={e => { if (!locked) { setDate(e.target.value); setPrev(null); setOk(false); } }} /></label>
      {spec.fields.map(f => <label key={f.key} style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>{f.label}{f.required !== false && " *"}
        {f.type === "ref" ? <select style={inp} disabled={locked} value={form[f.key] ?? ""} onChange={e => edit({ [f.key]: e.target.value })}><option value="">선택</option>{(d.refs[f.ref!] ?? []).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          : f.type === "select" ? <select style={inp} disabled={locked} value={form[f.key] ?? ""} onChange={e => edit({ [f.key]: e.target.value })}><option value="">선택</option>{(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select>
          : <input style={inp} disabled={locked} type={f.type === "number" ? "text" : f.type ?? "text"} inputMode={f.type === "number" ? "numeric" : undefined} value={form[f.key] ?? ""} onChange={e => edit({ [f.key]: e.target.value })} />}</label>)}</div>}
    {actionKey === "receipt.record" && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>수동 수납은 PG 승인이 아닙니다. 계좌·외부 단말기는 식별번호가 필요합니다.</p>}
    {actionKey === "refund.record" && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>실제로 환불을 완료한 뒤 기록하세요. 이 화면은 환불을 실행하지 않습니다. 배분된 금액은 해제할 배분을 함께 지정해야 합니다.</p>}
    {locked && <div role="alert" data-testid="finance-unknown" style={{ color: "var(--color-warning)", fontSize: 13 }}>이전 처리 결과가 미확인입니다. 입력이 잠겼습니다. <button style={btn2} onClick={confirmReceipt}>처리 결과 확인</button></div>}
    {msg && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>{msg}</div>}
    {done && <div role="status" data-testid="finance-done" style={{ color: "var(--color-success, #1a7f37)", fontSize: 13 }}>{done}</div>}
    {prev && <div style={{ ...box, background: "var(--surface-off)", fontSize: 13 }} data-testid="finance-preview">
      <strong>영향 미리보기 (저장 전)</strong>
      <Table testid="finance-impact" empty="" head={["항목", "이전", "이후"]} rows={TOTAL_LABELS.map(([k, l]) => [l, krw(prev.impact.before[k]), krw(prev.impact.after[k])])} />
      {prev.warnings.map((w, i) => <div key={i} style={{ color: "var(--color-warning)" }}>주의: {w}</div>)}
      <label style={{ display: "flex", gap: 6, marginTop: 6 }}><input data-testid="finance-confirm" type="checkbox" checked={ok} disabled={locked} onChange={e => setOk(e.target.checked)} />위 영향을 확인했고 이 금액 변경을 기록합니다.</label></div>}
    <div style={{ display: "flex", gap: 6 }}>
      <button style={btn2} data-testid="finance-preview-btn" disabled={busy || locked || !spec} onClick={doPreview}>{busy ? "처리 중…" : "미리보기"}</button>
      <button style={btn} data-testid="finance-execute" disabled={busy || !prev || !ok} onClick={doExecute}>기록 확정</button></div>
  </section>;
}
