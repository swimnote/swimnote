import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { api } from "../lib/api-client";
import { listOps, uuid, toCsv, download, autoRules, parseRuleText, TARGETS, type OpsItem } from "./office-ops-lib";
import { ui } from "./office-ops-styles";

type F = { name: string; sheet: string; rows: Record<string, unknown>[] };
type Prep = { preview: { rows: { source: { file: string; sheet: string; row: number }; normalized: Record<string, unknown>; errors: string[] }[]; ready: number; held: number }; revision: number };
const { box, inp, btn, btn2 } = ui;

export function OfficeImportsPanel() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["ops", "imports", "", 0], queryFn: () => listOps("imports", "", 0) });
  const [cur, setCur] = useState<OpsItem | null>(null);
  const [name, setName] = useState(""), [files, setFiles] = useState<F[]>([]), [rules, setRules] = useState<Record<string, string>>({});
  const [text, setText] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<Prep | null>(null), [applied, setApplied] = useState(false);
  const [referenceDate,setReferenceDate]=useState("");
  useEffect(()=>{setPrep(null);setApplied(false);},[name,files,rules,referenceDate]);
  const classes = useQuery({ queryKey: ["ops-ref", "classes"], queryFn: () => api.get<any>("/class-groups") });
  const classRows: any[] = Array.isArray(classes.data) ? classes.data : classes.data?.items ?? classes.data?.data ?? [];
  const headers = useMemo(() => [...new Set(files.flatMap(f => f.rows.flatMap(r => Object.keys(r))))], [files]);
  const mapped = useMemo(() => files.flatMap(f => f.rows.map((r, i) => ({ f: f.name, s: f.sheet, i: i + 2, v: Object.fromEntries(Object.entries(rules).map(([t, c]) => [t, r[c]])) }))), [files, rules]);

  /** class_name -> class_group_id only when exactly one real class matches; others are held. */
  const classMap = useMemo(() => {
    const col = rules.class_name; const out: Record<string, string> = {}; const held: Record<string, string> = {};
    if (!col) return { out, held };
    for (const n of new Set(files.flatMap(f => f.rows.map(r => String(r[col] ?? "").trim())).filter(Boolean))) {
      const hit = classRows.filter(c => String(c.name ?? c.class_name ?? "").trim() === n);
      if (hit.length === 1) out[n] = String(hit[0].id); else held[n] = hit.length ? "동일 이름 반 여러 개(모호)" : "일치하는 반 없음";
    }
    return { out, held };
  }, [files, rules, classRows]);
  /** Row-level decision key agreed with server: `${file}|${sheet}|${row}` (row = spreadsheet row, header is row 1). */
  const rowIds = useMemo(() => {
    const col = rules.class_name; const out: Record<string, string> = {};
    if (!col) return out;
    for (const f of files) f.rows.forEach((r, i) => { const id = classMap.out[String(r[col] ?? "").trim()]; if (id) out[`${f.name}|${f.sheet}|${i + 2}`] = id; });
    return out;
  }, [files, rules, classMap]);
  const pick = (it: OpsItem | null) => { setCur(it); setPrep(null); setApplied(false); setMsg("");
    setName(it?.data.name ?? ""); setFiles(it?.data.files ?? []); setRules(it?.data.rules ?? {});setReferenceDate(it?.data.referenceDate??""); };
  const addFiles = async (list: FileList | null) => {
    if (!list) return; const add: F[] = [];
    for (const file of Array.from(list)) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      for (const sh of wb.SheetNames) add.push({ name: file.name, sheet: sh, rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sh], { defval: "", raw: false }) });
    }
    const all = [...files, ...add]; setFiles(all);
    if (!Object.keys(rules).length) setRules(autoRules([...new Set(all.flatMap(f => f.rows.flatMap(r => Object.keys(r))))]));
  };
  const rule = async () => {
    const p = parseRuleText(text, headers);
    if (p) { setRules({ ...rules, [p.target]: p.source }); setText(""); return setMsg(`규칙 적용: ${p.target} = ${p.source}`); }
    if (!cur) return setMsg("자유 문장 해석은 저장된 가져오기가 필요합니다. 먼저 저장하거나 '이름=성명' 형식을 사용하세요.");
    try { const r = await api.post<{ kind: string; message?: string; rules?:Record<string,string>;question?:string }>(`/office/operations/imports/${cur.id}/interpret`, { text });
      if(r.kind==="rules" && r.rules) { setRules({...rules,...r.rules});setPrep(null);setMsg(r.question || "규칙 제안을 미리보기에 반영했습니다. 실제 회원 등록은 별도입니다."); }
      else setMsg(r.message ?? "해석 결과를 사용할 수 없습니다."); }
    catch (e: any) { setMsg(e?.message ?? "해석 요청 실패"); }
  };
  const save = async (status: "draft" | "reviewed" = "draft"): Promise<OpsItem | null> => {
    if (!name.trim() || !files.length) { setMsg("이름과 파일을 입력하세요."); return null; }
    setBusy(true);
    try {
      const data = { name: name.trim(), files, rules, decisions: { ...(cur?.data.decisions ?? {}), classGroupIds: rowIds, heldClasses: classMap.held }, status, note: cur?.data.note,referenceDate:referenceDate||undefined };
      const r = cur ? await api.patch<{ item: OpsItem }>(`/office/operations/imports/${cur.id}`, { requestId: uuid(), expectedRevision: cur.revision, data })
        : await api.post<{ item: OpsItem }>("/office/operations/imports", { requestId: uuid(), data });
      setCur(r.item); setMsg("서버에 저장했습니다."); qc.invalidateQueries({ queryKey: ["ops", "imports"] }); return r.item;
    } catch (e: any) { setMsg(e?.status === 409 ? "다른 곳에서 수정됨(409). 목록에서 다시 열어주세요." : e?.message ?? "저장 실패"); return null; } finally { setBusy(false); }
  };
  const prepare = async () => {
    const it = await save("reviewed"); if (!it) return; setBusy(true);
    try { setPrep(await api.post<Prep>(`/office/operations/imports/${it.id}/prepare`, { expectedRevision: it.revision }));setApplied(false); setMsg("서버 준비 완료: 아직 회원에 적용되지 않았습니다(staged)."); }
    catch (e: any) { setMsg(e?.message ?? "준비 실패"); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!cur || !prep) return; setBusy(true);
    try { const result=await api.post<{created:number;held:number;remaining?:number;revision:number;status:string}>(`/office/operations/imports/${cur.id}/apply`, { requestId: uuid(), expectedRevision: prep.revision });
      setApplied(result.created>0);setCur({...cur,revision:result.revision});
      setPrep(null);
      setMsg(`이번 회원 등록 ${result.created}명 · 보류 ${result.held}행 · 남은 행 ${result.remaining ?? result.held}행. 결과를 조회하고 다음 실행 단위를 검토하세요. 금융 자료는 미반영입니다.`);
      qc.invalidateQueries({ queryKey: ["students"] });qc.invalidateQueries({queryKey:["ops","imports"]}); }
    catch (e: any) { setPrep(null);setMsg(`적용 결과 확인 필요: ${e?.message ?? "오류"}. 미처리로 단정하거나 재전송하지 말고 결과 CSV/저장 작업을 확인하세요.`); } finally { setBusy(false); }
  };
  const results = async () => {
    if (!cur) return;
    try { const r: any = await api.get(`/office/operations/imports/${cur.id}/results`); const rows: any[] = r.results ?? [];
      download(`import-${cur.id}-results.csv`, toCsv(["file", "sheet", "row", "status", "detail"], rows.map(x => [x.source?.file ?? x.file, x.source?.sheet ?? x.sheet, x.source?.row ?? x.row, x.status, x.error ?? (x.errors ?? []).join("; ") ?? ""]))); }
    catch (e: any) { setMsg(e?.message ?? "결과 조회 실패"); }
  };
  const exportPrep = () => prep && download("import-preview.csv", toCsv(["file", "sheet", "row", "ready", "errors", ...TARGETS.map(t => t[0])], prep.preview.rows.map(r => [r.source.file, r.source.sheet, r.source.row, r.errors.length ? "held" : "ready", r.errors.join("; "), ...TARGETS.map(t => r.normalized[t[0]])])));

  return <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 10 }}>
    <aside style={box}><button style={btn} onClick={() => pick(null)}>새 가져오기</button>
      {(list.data?.items ?? []).map(i => <div key={i.id}><button style={{ ...btn2, width: "100%", marginTop: 4, textAlign: "left", background: cur?.id === i.id ? "var(--x-primary-soft)" : undefined }} onClick={() => pick(i)}>{i.data.name} <small>({i.data.status === "reviewed" ? "검토됨" : "초안"})</small></button></div>)}
      {list.isError && <p role="alert" style={{ color: "var(--color-error)", fontSize: 12 }}>목록을 불러오지 못했습니다.</p>}</aside>
    <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
      <p role="note" style={{ fontSize: 12, color: "var(--text-muted)" }}>금융 데이터는 가져오지 않습니다. 회원 등록 행만 준비(staged) 후 적용하며, 적용 전에는 실제 회원이 생성되지 않습니다.</p>
      <input style={inp} placeholder="가져오기 이름" value={name} onChange={e => setName(e.target.value)} />
      <label style={{fontSize:12}}>원본 자료 기준일(추적용·선택) <input style={inp} type="date" value={referenceDate} onChange={e=>setReferenceDate(e.target.value)} /> — 회원 등록·반 배정일로 자동 소급하지 않습니다.</label>
      <input type="file" multiple accept=".xlsx,.xls,.csv" onChange={e => addFiles(e.target.files)} />
      {files.map((f, i) => <div key={i} style={{ fontSize: 12 }}>{f.name} / {f.sheet} · {f.rows.length}행 <button style={btn2} onClick={() => setFiles(files.filter((_, j) => j !== i))}>제거</button></div>)}
      {headers.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 6 }}>
        {TARGETS.map(([k, l]) => <label key={k} style={{ fontSize: 12 }}>{l}<select style={{ ...inp, width: "100%" }} value={rules[k] ?? ""} onChange={e => { const n = { ...rules }; if (e.target.value) n[k] = e.target.value; else delete n[k]; setRules(n); }}>
          <option value="">(매핑 안 함)</option>{headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>}
      <div style={{ display: "flex", gap: 6 }}><input style={{ ...inp, flex: 1 }} placeholder="규칙 입력: 이름=성명" value={text} onChange={e => setText(e.target.value)} /><button style={btn2} onClick={rule} disabled={!text.trim()}>규칙 적용</button></div>
      {mapped.length > 0 && <div style={{ overflowX: "auto", maxHeight: 220 }}><table style={{ fontSize: 12, borderCollapse: "collapse" }}><thead><tr><th>원본</th>{Object.keys(rules).map(k => <th key={k} style={{ padding: "2px 8px" }}>{k}</th>)}</tr></thead>
        <tbody>{mapped.slice(0, 20).map((m, i) => <tr key={i}><td style={{ padding: "2px 8px" }}>{m.f}/{m.s}#{m.i}</td>{Object.keys(rules).map(k => <td key={k} style={{ padding: "2px 8px" }}>{String(m.v[k] ?? "")}</td>)}</tr>)}</tbody></table>
        <small>미리보기 20 / {mapped.length}행 (로컬 매핑, 서버 검증 전)</small></div>}
      {Object.keys(classMap.held).length > 0 && <div role="alert" style={{ color: "var(--color-warning)", fontSize: 12 }}>반 매핑 보류: {Object.entries(classMap.held).map(([n, w]) => `${n}(${w})`).join(", ")} — 해당 행은 보류 처리됩니다.</div>}
      {!rules.name && files.length > 0 && <div role="alert" style={{ color: "var(--color-error)", fontSize: 12 }}>이름 컬럼 매핑이 필요합니다.</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={btn2} disabled={busy} onClick={() => save("draft")}>초안 저장</button>
        <button style={btn} disabled={busy || !rules.name || !files.length} onClick={prepare}>검토·서버 준비</button>
        <button style={btn} disabled={busy || !prep || prep.preview.ready === 0 || applied} onClick={apply}>적용 ({prep?.preview.ready ?? 0}건)</button>
        <button style={btn2} disabled={!prep} onClick={exportPrep}>준비 CSV</button>
        <button style={btn2} disabled={!cur} onClick={results}>결과 CSV</button>
      </div>
      {prep && <div style={{ fontSize: 13 }}>상태: {applied ? "적용됨" : "준비됨(staged)"} · 준비 {prep.preview.ready} · 보류 {prep.preview.held}
        {prep.preview.rows.filter(r => r.errors.length).slice(0, 30).map((r, i) => <div key={i} style={{ color: "var(--color-error)", fontSize: 12 }}>{r.source.file}/{r.source.sheet}#{r.source.row}: {r.errors.join(", ")}</div>)}</div>}
      {msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
    </section></div>;
}
