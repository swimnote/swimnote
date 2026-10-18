import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { SPECS, listOps, coerce, uuid, toCsv, download, type OpsItem, type OpsResource, type Ref, type Field } from "./office-ops-lib";
import { useLocation } from "wouter";
import { OfficeImportsPanel } from "./OfficeImportsPanel";
import { ui } from "./office-ops-styles";
import {useAuth} from "../contexts/AuthContext";

export type OpsView = "contacts" | "courses" | "sessions" | "imports" | "marketing" | "cards";
const VIEW: Record<OpsView, { title: string; res: OpsResource[] }> = {
  contacts: { title: "상담·체험·등록전환", res: ["contacts"] }, courses: { title: "상품·계약·수강", res: ["products", "contracts", "enrollments"] },
  sessions: { title: "수업 세션", res: ["sessions"] }, imports: { title: "엑셀 가져오기", res: ["imports"] },
  marketing: { title: "마케팅 수동 관리", res: ["marketing"] }, cards: { title: "출입 카드", res: ["cards"] },
};
const {box,inp,btn,btn2}=ui;

const errText = (e: any) => e?.status === 409 ? `충돌: ${e.message ?? "시간·정원 또는 다른 사용자의 수정과 겹칩니다. 새로고침 후 다시 시도하세요."}` : e?.message ?? "요청 실패";

function useRefs() {
  const s = useQuery({ queryKey: ["ops-ref", "students"], queryFn: () => api.get<any>("/students") });
  const c = useQuery({ queryKey: ["ops-ref", "classes"], queryFn: () => api.get<any>("/class-groups") });
  const p = useQuery({ queryKey: ["ops", "products", "", 0], queryFn: () => listOps("products", "", 0, 100) });
  const k = useQuery({ queryKey: ["ops", "contracts", "", 0], queryFn: () => listOps("contracts", "", 0, 100) });
  const a = (x: any) => (Array.isArray(x) ? x : x?.students ?? x?.items ?? x?.data ?? []) as any[];
  return useMemo(() => ({
    students: a(s.data).map(x => [String(x.id), x.name ?? x.id] as [string, string]),
    classes: a(c.data).map(x => [String(x.id), x.name ?? x.class_name ?? x.id] as [string, string]),
    products: (p.data?.items ?? []).map(x => [x.id, x.data.name] as [string, string]),
    contracts: (k.data?.items ?? []).map(x => [x.id, `${x.data.studentId?.slice(0, 6)} / ${x.data.startDate}`] as [string, string]),
  }), [s.data, c.data, p.data, k.data]) as Record<Ref, [string, string][]>;
}

type Draft = { edit: OpsItem | "new" | null; form: Record<string, string>; reqId: string };
const drafts = new Map<string, Draft>();
/** Unknown-outcome writes keep requestId+body; only that identical body may be retried. */
const unsure = new Map<string, { reqId: string; body: string; target: string }>();

function ResourceTable({ res,scopeKey }: { res: Exclude<OpsResource, "imports">;scopeKey:string }) {
  const cacheKey=`${scopeKey}:${res}`;
  const [, nav] = useLocation();
  const spec = SPECS[res], qc = useQueryClient(), refs = useRefs();
  const [search, setSearch] = useState(""), [q, setQ] = useState(""), [offset, setOffset] = useState(0);
  const d0 = drafts.get(cacheKey);
  const [edit, setEdit] = useState<OpsItem | "new" | null>(d0?.edit ?? null), [form, setForm] = useState<Record<string, string>>(d0?.form ?? {});
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [reqId, setReqId] = useState(d0?.reqId ?? uuid());
  const [lockMsg, setLockMsg] = useState(unsure.has(cacheKey) ? "이전 저장의 결과가 확인되지 않았습니다. 동일 내용·요청 ID 재확인 또는 처리 결과 확인이 필요합니다." : "");
  useEffect(() => { if (edit) drafts.set(cacheKey, { edit, form, reqId }); else drafts.delete(cacheKey); }, [cacheKey, edit, form, reqId]);
  const list = useQuery({ queryKey: ["ops", res, q, offset], queryFn: () => listOps(res, q, offset), retry: false });
  const label = (f: Field, v: any) => f.type === "ref" ? (refs[f.ref!].find(([i]) => i === v)?.[1] ?? v) : f.type === "select" ? (f.options!.find(([i]) => i === v)?.[1] ?? v) : v;
  const open = (it: OpsItem | "new") => { if (unsure.has(cacheKey) && edit) return setMsg("미확인 저장이 있습니다. 먼저 해결하세요."); setEdit(it); setMsg(""); setReqId(uuid()); setForm(it === "new" ? {} : Object.fromEntries(Object.entries(it.data).map(([k, v]) => [k, String(v ?? "")]))); };
  const save = async () => {
    const miss = spec.fields.find(f => f.req && !form[f.key]?.trim());
    if (miss) return setMsg(`${miss.label}을(를) 입력하세요.`);
    const data = coerce(spec.fields, form);
    const target = edit === "new" ? "new" : (edit as OpsItem).id;
    const body = JSON.stringify(data);
    const pend = unsure.get(cacheKey);
    if (pend && (pend.body !== body || pend.target !== target)) return setMsg("이전 저장 결과가 미확인입니다. 처리 결과 확인 또는 동일 내용·동일 요청 ID 재확인이 먼저 필요합니다.");
    const id = pend?.reqId ?? reqId;
    setBusy(true); setMsg("");
    try {
      if (edit === "new") await api.post(`/office/operations/${res}`, { requestId: id, data });
      else await api.patch(`/office/operations/${res}/${(edit as OpsItem).id}`, { requestId: id, expectedRevision: (edit as OpsItem).revision, data });
       unsure.delete(cacheKey); setLockMsg(""); setEdit(null); setReqId(uuid()); qc.invalidateQueries({ queryKey: ["ops"] });
    } catch (e: any) {
      const st = e?.status;
       if (typeof st === "number" && st >= 400 && st < 500 && st !== 408 && st !== 429) { unsure.delete(cacheKey); setLockMsg(""); setReqId(uuid()); setMsg(errText(e)); }
       else { unsure.set(cacheKey, { reqId: id, body, target }); setLockMsg("저장 결과를 확인하지 못했습니다(성공으로 처리하지 않음). 같은 내용으로 재시도하면 같은 요청 ID를 사용합니다."); setMsg(errText(e)); }
    } finally { setBusy(false); }
  };
  const discardUnknown = async () => {
    try {
      const receipt=await api.get<{item:OpsItem}>(`/office/operations/receipts/${unsure.get(cacheKey)?.reqId??reqId}`);
      if(!receipt.item) {setMsg("확정된 처리 결과가 없습니다. 동일 요청 ID와 내용을 유지합니다.");return;}
      unsure.delete(cacheKey);setLockMsg("");setEdit(null);setReqId(uuid());qc.invalidateQueries({queryKey:["ops"]});setMsg("서버 처리 영수증으로 저장을 확인했습니다.");
    } catch {setMsg("결과를 확정하지 못했습니다. 조회 실패·기록 없음은 미처리 증거가 아닙니다. 동일 요청 ID와 내용을 유지합니다.");}
  };
  const items = list.data?.items ?? [];
  const rows = () => items.map(i => [i.id, i.revision, ...spec.fields.map(f => i.data[f.key])]);
  const head = ["id", "revision", ...spec.fields.map(f => f.label)];
  const print = () => window.print();
  return <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }} data-testid={`ops-${res}`}>
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <strong>{spec.title}</strong><span style={{ color: "var(--text-muted)", fontSize: 12 }}>총 {list.data?.total ?? 0}건</span>
      <input style={{ ...inp, marginLeft: "auto" }} placeholder="검색" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setQ(search); setOffset(0); } }} />
      <button style={btn2} onClick={() => { setQ(search); setOffset(0); }}>검색</button>
      <button style={btn2} disabled={!items.length} onClick={() => download(`${res}.csv`, toCsv(head, rows()))}>현재 페이지 CSV</button>
      <button style={btn2} disabled={!items.length} onClick={print}>인쇄</button>
      <button style={btn} onClick={() => open("new")}>새로 등록</button>
    </div>
    {res === "cards" && <p role="note" style={{ fontSize: 12, color: "var(--color-warning)" }}>실제 카드 리더기 연동은 검증되지 않았습니다(NOT VERIFIED). UID는 수동 등록이며 출결은 기존 수동 출결 화면(/admin/attendance)에서 처리합니다.</p>}
    {res === "marketing" && <p role="note" style={{ fontSize: 12, color: "var(--text-muted)" }}>외부 채널 자동 게시는 하지 않습니다. 수동 게시 일정·URL만 기록합니다.</p>}
    {res === "contacts" && <p role="note" style={{ fontSize: 12, color: "var(--text-muted)" }}>등록 전환은 <a href="/admin/members/new" onClick={e => { e.preventDefault(); nav("/admin/members/new"); }}>회원 등록</a>으로 실제 회원을 만든 뒤 아래에서 연결 회원을 선택해 단계를 &lsquo;등록됨&rsquo;으로 저장하세요.</p>}
    {list.isLoading && <div style={{ height: 80, background: "var(--surface-subtle)", borderRadius: 4 }} />}
    {list.isError && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>
      {(list.error as any)?.status === 404 || (list.error as any)?.status === 503 ? "서버 운영 스키마 마이그레이션이 아직 적용되지 않았습니다. 작성 중 내용은 보존되며 목록은 표시하지 않습니다." : errText(list.error)}
      <button style={{ ...btn2, marginLeft: 8 }} onClick={() => list.refetch()}>다시 시도</button></div>}
    {list.data && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead><tr>{spec.fields.filter(f => spec.list.includes(f.key)).map(f => <th key={f.key} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border-strong)", whiteSpace: "nowrap" }}>{f.label}</th>)}<th /></tr></thead>
      <tbody>{items.map(i => <tr key={i.id}>{spec.fields.filter(f => spec.list.includes(f.key)).map(f => <td key={f.key} style={{ padding: 6, borderBottom: "1px solid var(--border-default)" }}>{String(label(f, i.data[f.key]) ?? "")}</td>)}
        <td style={{ padding: 6, textAlign: "right" }}><button style={btn2} onClick={() => open(i)}>수정</button></td></tr>)}
        {!items.length && <tr><td colSpan={9} style={{ padding: 16, color: "var(--text-muted)" }}>저장된 항목이 없습니다.</td></tr>}</tbody></table></div>}
    <div style={{ display: "flex", gap: 6 }}>
      <button style={btn2} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>이전</button>
      <button style={btn2} disabled={!list.data?.has_more} onClick={() => setOffset(offset + 100)}>다음</button>
    </div>
    {edit && <div style={{ ...box, background: "var(--surface-off)" }}>
      <strong>{edit === "new" ? "새 항목" : `수정 (rev ${edit.revision})`}</strong>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8, margin: "8px 0" }}>
        {spec.fields.map(f => <label key={f.key} style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>{f.label}{f.req && " *"}
          {f.type === "select" || f.type === "ref"
            ? <select style={inp} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })}><option value="">선택</option>
              {(f.type === "select" ? f.options! : refs[f.ref!]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            : <input style={inp} type={f.type ?? "text"} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}</label>)}
      </div>
      {lockMsg && <div role="alert" style={{ color: "var(--color-warning)", fontSize: 13 }}>{lockMsg} <button style={btn2} onClick={discardUnknown}>서버 처리 결과 확인</button></div>}
      {msg && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 6 }}><button style={btn} disabled={busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button><button style={btn2} onClick={() => setEdit(null)}>닫기</button></div>
    </div>}
  </section>;
}

export function OfficeOperationsPanel({ view }: { view: OpsView }) {
  const {state}=useAuth();
  const scopeKey=state.status==="authenticated"?`${state.user.id}:${state.user.swimming_pool_id}`:"unauthenticated";
  const v = VIEW[view];
  const [tab, setTab] = useState(v.res[0]);
  useEffect(() => setTab(v.res[0]), [view]);
  const cap = useQuery({ queryKey: ["ops-cap"], queryFn: () => api.get<{ available: boolean; schemaVersion: number; resources: string[] }>("/office/operations/capabilities"), retry: false });
  return <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
    <h1 style={{ fontSize: 18 }}>{v.title}</h1>
    {cap.isError && <div role="alert" style={{ ...box, color: "var(--color-error)" }}>운영 API에 연결할 수 없습니다: {errText(cap.error)} <button style={btn2} onClick={() => cap.refetch()}>다시 시도</button></div>}
    {cap.data && !cap.data.available && <div role="alert" style={{ ...box, color: "var(--color-warning)" }}>서버 마이그레이션 대기 중입니다. 저장 목록은 표시하지 않으며 입력 중인 내용은 이 화면에서 유지됩니다.</div>}
    {cap.data?.available && <>
      {v.res.length > 1 && <div style={{ display: "flex", gap: 4 }}>{v.res.map(r => <button key={r} style={tab === r ? btn : btn2} onClick={() => setTab(r)}>{SPECS[r as Exclude<OpsResource, "imports">].title}</button>)}</div>}
      {tab === "imports" ? <OfficeImportsPanel key={scopeKey} /> : <ResourceTable key={`${scopeKey}:${tab}`} scopeKey={scopeKey} res={tab as Exclude<OpsResource, "imports">} />}
    </>}
  </div>;
}
