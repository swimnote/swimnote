import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { api } from "../lib/api-client";
import { listOps, uuid, toCsv, download, autoRules, previewRuleChanges, TARGETS, type OpsItem } from "./office-ops-lib";
import { ui } from "./office-ops-styles";
import { OfficeImportsFinance } from "./OfficeImportsFinance";
import { pendingGet,pendingSet,pendingDelete,pendingClear,receiptItem,isUnknown,useRecoveredPending } from "./office-unknown";

type F = { name: string; sheet: string; rows: Record<string, unknown>[] };
type Prep = { preview: { rows: { source: { file: string; sheet: string; row: number }; normalized: Record<string, unknown>; errors: string[] }[]; ready: number; held: number }; revision: number };
const { box, inp, btn, btn2 } = ui;

export function OfficeImportsPanel({ scopeKey = "local" }: { scopeKey?: string } = {}) {
  const qc = useQueryClient();
  const pk=`${scopeKey}|import-member`;
  const [locked,setLocked]=useState(!!pendingGet(pk)),[financeLocked,setFinanceLocked]=useState(!!pendingGet(`${scopeKey}|import-fin`));
  useEffect(()=>{pendingClear(scopeKey);setLocked(!!pendingGet(pk));},[scopeKey,pk]);
  const list = useQuery({ queryKey: ["ops", "imports", "", 0], queryFn: () => listOps("imports", "", 0) });
  const [cur, setCur] = useState<OpsItem | null>(null);
  const [name, setName] = useState(""), [files, setFiles] = useState<F[]>([]), [rules, setRules] = useState<Record<string, string>>({});
  const [text, setText] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<Prep | null>(null), [applied, setApplied] = useState(false);
  const [referenceDate,setReferenceDate]=useState("");
  const [classDecisions,setClassDecisions]=useState<Record<string,string>>({});
  const [finSuggest, setFinSuggest] = useState<Record<string, string> | undefined>();
  const [log, setLog] = useState<{ who: "user" | "system"; text: string }[]>([]), [undo, setUndo] = useState<Record<string, string>[]>([]);
  const blocked=locked||financeLocked||busy;
  const say = (user: string, system: string) => setLog(l => [...l, { who: "user" as const, text: user }, { who: "system" as const, text: system }].slice(-40));
  const setRulesTracked = (n: Record<string, string>) => { setUndo(u => [...u, rules].slice(-20)); setRules(n); };
  useEffect(()=>{setPrep(null);setApplied(false);},[name,files,rules,referenceDate,classDecisions]);
  const classes = useQuery({ queryKey: ["ops-ref", "classes"], queryFn: () => api.get<any>("/class-groups") });
  const classRows: any[] = Array.isArray(classes.data) ? classes.data : classes.data?.items ?? classes.data?.data ?? [];
  const headers = useMemo(() => [...new Set(files.flatMap(f => f.rows.flatMap(r => Object.keys(r))))], [files]);
  const rulePreview=useMemo(()=>previewRuleChanges(text,headers,rules),[text,headers,rules]);
  const mapped = useMemo(() => files.flatMap(f => f.rows.map((r, i) => ({ f: f.name, s: f.sheet, i: i + 2, v: Object.fromEntries(Object.entries(rules).map(([t, c]) => [t, r[c]])) }))), [files, rules]);

  /** class_name -> class_group_id only when exactly one real class matches; others are held. */
  const classMap = useMemo(() => {
    const col = rules.class_name; const out: Record<string, string> = {}; const held: Record<string, string> = {};
    if (!col) return { out, held };
    for (const n of new Set(files.flatMap(f => f.rows.map(r => String(r[col] ?? "").trim())).filter(Boolean))) {
      if(classDecisions[n]&&classRows.some(c=>String(c.id)===classDecisions[n])){out[n]=classDecisions[n];continue;}
      const hit = classRows.filter(c => String(c.name ?? c.class_name ?? "").trim() === n);
      if (hit.length === 1) out[n] = String(hit[0].id); else held[n] = hit.length ? "동일 이름 반 여러 개(모호)" : "일치하는 반 없음";
    }
    return { out, held };
  }, [files, rules, classRows,classDecisions]);
  /** Row-level decision key agreed with server: `${file}|${sheet}|${row}` (row = spreadsheet row, header is row 1). */
  const rowIds = useMemo(() => {
    const col = rules.class_name; const out: Record<string, string> = {};
    if (!col) return out;
    for (const f of files) f.rows.forEach((r, i) => { const id = classMap.out[String(r[col] ?? "").trim()]; if (id) out[`${f.name}|${f.sheet}|${i + 2}`] = id; });
    return out;
  }, [files, rules, classMap]);
  const pick = (it: OpsItem | null) => { setCur(it); setPrep(null); setApplied(false); setMsg("");
    setLog([]); setUndo([]);setFinSuggest(undefined);setClassDecisions(it?.data.decisions?.classNames??{}); setName(it?.data.name ?? ""); setFiles(it?.data.files ?? []); setRules(it?.data.rules ?? {});setReferenceDate(it?.data.referenceDate??""); };
  const addFiles = async (list: FileList | null) => {
    if (!list) return; const add: F[] = [];
    for (const file of Array.from(list)) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      for (const sh of wb.SheetNames) add.push({ name: file.name, sheet: sh, rows: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sh], { defval: "", raw: false }) });
    }
    const keys=new Set<string>();
    for(const f of [...files,...add]){
      const key=JSON.stringify([f.name,f.sheet]);
      if(keys.has(key)){setMsg("같은 파일명·시트가 이미 포함돼 있습니다. 기존 결정과 원본 행을 덮어쓰지 않았습니다. 새 파일은 이름을 구분해 추가하세요.");return;}
      keys.add(key);
    }
    const all = [...files, ...add]; setFiles(all);
    if (!Object.keys(rules).length) setRules(autoRules([...new Set(all.flatMap(f => f.rows.flatMap(r => Object.keys(r))))]));
  };
  const rule = async () => {
    if(!rulePreview){
      say(text,"일부 의견을 정형 규칙으로 확인하지 못했습니다. '이름=성명' 또는 '이름 규칙 취소'를 한 줄에 하나씩 입력하세요. 부분 적용·유료 모델 호출은 하지 않았습니다.");
      setMsg("자유 자연어 AI 해석 실행은 새 모델 호출 승인 대기입니다. 정형 규칙·수동 매핑은 계속 사용할 수 있습니다.");return;
    }
    setRulesTracked(rulePreview.next);
    say(text,`${rulePreview.changes.length}개 규칙 변경·취소를 반영했습니다. 원본 파일·기존 반 선택은 유지하며 이전 서버 검증은 무효화합니다. 회원·금융 반영은 각각 별도입니다.`);
    setText("");
  };
  const save = async (status: "draft" | "reviewed" = "draft"): Promise<OpsItem | null> => {
    if(locked||pendingGet(pk)) return null;
    if (!name.trim() || !files.length) { setMsg("이름과 파일을 입력하세요."); return null; }
    setBusy(true);
    let body:Record<string,unknown>|undefined;
    try {
      const data = { name: name.trim(), files, rules, decisions: { ...(cur?.data.decisions ?? {}), classGroupIds: rowIds, heldClasses: classMap.held,classNames:classDecisions }, status, note: cur?.data.note,referenceDate:referenceDate||undefined };
      body={requestId:uuid(),...(cur?{expectedRevision:cur.revision}:{}),data};
      pendingSet(pk,{requestId:String(body.requestId),body,label:"member-save"});
      const r = cur ? await api.patch<{ item: OpsItem }>(`/office/operations/imports/${cur.id}`, body)
        : await api.post<{ item: OpsItem }>("/office/operations/imports", body);
      if(!r.item?.id) throw Object.assign(new Error("저장 응답에 자료가 없습니다."),{status:502});
      pendingDelete(pk);
      setCur(r.item); setMsg("서버에 저장했습니다."); qc.invalidateQueries({ queryKey: ["ops", "imports"] }); return r.item;
    } catch (e: any) { if(body&&isUnknown(e))setLocked(true);else pendingDelete(pk);
      setMsg(isUnknown(e)?"저장 결과가 불명확합니다. 재전송하지 말고 서버 처리 결과를 확인하세요.":e?.status === 409 ? "다른 곳에서 수정됨(409). 목록에서 다시 열어주세요." : e?.message ?? "저장 실패"); return null; } finally { setBusy(false); }
  };
  const prepare = async () => {
    const it = await save("reviewed"); if (!it) return; setBusy(true);
    try { setPrep(await api.post<Prep>(`/office/operations/imports/${it.id}/prepare`, { expectedRevision: it.revision }));setApplied(false); setMsg("서버 준비 완료: 아직 회원에 적용되지 않았습니다(staged)."); }
    catch (e: any) { setMsg(e?.message ?? "준비 실패"); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!cur || !prep || locked || pendingGet(pk)) return; setBusy(true);
    const body={requestId:uuid(),expectedRevision:prep.revision};
    pendingSet(pk,{requestId:body.requestId,body,label:`member-apply:${cur.id}`});
    try { const result=await api.post<{created:number;held:number;remaining?:number;revision:number;status:string}>(`/office/operations/imports/${cur.id}/apply`, body);
      if(!Number.isSafeInteger(result.revision)||!Number.isSafeInteger(result.created))throw Object.assign(new Error("적용 결과 형식 확인 필요"),{status:502});
      pendingDelete(pk);setLocked(false);
      setApplied(result.created>0);setCur({...cur,revision:result.revision});
      setPrep(null);
      setMsg(`이번 회원 등록 ${result.created}명 · 보류 ${result.held}행 · 남은 행 ${result.remaining ?? result.held}행. 결과를 조회하고 다음 실행 단위를 검토하세요. 금융 자료는 미반영입니다.`);
      qc.invalidateQueries({ queryKey: ["students"] });qc.invalidateQueries({queryKey:["ops","imports"]}); }
    catch (e: any) { if(isUnknown(e))setLocked(true);else pendingDelete(pk);
      setPrep(null);setMsg(`적용 결과 확인 필요: ${e?.message ?? "오류"}. 미처리로 단정하거나 재전송하지 말고 결과 CSV/저장 작업을 확인하세요.`); } finally { setBusy(false); }
  };
  const checkPending=async()=>{
    const p=pendingGet(pk);if(!p)return;
    const r:any=await receiptItem(p.requestId);
    if(p.label==="member-save"&&r?.item?.id){
      pendingDelete(pk);setLocked(false);pick(r.item);setMsg("서버 저장 영수증으로 자료를 복구했습니다.");
    } else if(p.label.startsWith("member-apply:")&&Number.isSafeInteger(r?.revision)&&Number.isSafeInteger(r?.created)){
      const id=p.label.slice("member-apply:".length);
      pendingDelete(pk);setLocked(false);setPrep(null);
      try{const saved=await api.get<{item:OpsItem}>(`/office/operations/imports/${id}`);if(saved.item?.id)pick(saved.item);}
      catch{setCur(c=>c?.id===id?{...c,revision:r.revision}:c);}
      setMsg(`서버 영수증 확인: 등록 ${r.created}명 · 보류 ${r.held}행. 결과 CSV와 원본을 대조하고 다음 단위를 준비하세요.`);
    } else {setMsg("확정 영수증이 없습니다. 조회 실패/404는 미처리 증거가 아니므로 잠금을 유지합니다.");return;}
    qc.invalidateQueries({queryKey:["ops","imports"]});qc.invalidateQueries({queryKey:["students"]});
  };
  const results = async () => {
    if (!cur) return;
    try { const r: any = await api.get(`/office/operations/imports/${cur.id}/results`); const rows: any[] = r.results ?? [];
      download(`import-${cur.id}-results.csv`, toCsv(["file", "sheet", "row", "status", "detail"], rows.map(x => [x.source?.file ?? x.file, x.source?.sheet ?? x.sheet, x.source?.row ?? x.row, x.status, x.error ?? (x.errors ?? []).join("; ") ?? ""]))); }
    catch (e: any) { setMsg(e?.message ?? "결과 조회 실패"); }
  };
  useRecoveredPending(pk,()=>{void checkPending();});
  const exportPrep = () => prep && download("import-preview.csv", toCsv(["file", "sheet", "row", "ready", "errors", ...TARGETS.map(t => t[0])], prep.preview.rows.map(r => [r.source.file, r.source.sheet, r.source.row, r.errors.length ? "held" : "ready", r.errors.join("; "), ...TARGETS.map(t => r.normalized[t[0]])])));

  return <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 10 }}>
    <aside style={box}><button style={btn} disabled={blocked} onClick={() => pick(null)}>새 가져오기</button>
      {(list.data?.items ?? []).map(i => <div key={i.id}><button disabled={blocked} style={{ ...btn2, width: "100%", marginTop: 4, textAlign: "left", background: cur?.id === i.id ? "var(--x-primary-soft)" : undefined }} onClick={() => pick(i)}>{i.data.name} <small>({i.data.status === "reviewed" ? "검토됨" : "초안"})</small></button></div>)}
      {list.isError && <p role="alert" style={{ color: "var(--color-error)", fontSize: 12 }}>목록을 불러오지 못했습니다.</p>}</aside>
    <section style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
      {locked&&<div role="alert">미확인 회원 이전 요청이 있습니다. 원본·규칙 변경과 새 적용이 잠겼습니다. <button style={btn2} onClick={checkPending}>서버 처리 결과 확인</button></div>}
      <fieldset disabled={blocked} style={{border:0,padding:0,margin:0,display:"contents"}}>
      <p role="note" style={{ fontSize: 12, color: "var(--text-muted)" }}>회원 등록 적용은 금융 자료를 포함하지 않습니다(아래 별도 섹션). 회원 등록 행만 준비(staged) 후 적용하며, 적용 전에는 실제 회원이 생성되지 않습니다.</p>
      <input style={inp} placeholder="가져오기 이름" value={name} onChange={e => setName(e.target.value)} />
      <label style={{fontSize:12}}>원본 자료 기준일(추적용·선택) <input style={inp} type="date" value={referenceDate} onChange={e=>setReferenceDate(e.target.value)} /> — 회원 등록·반 배정일로 자동 소급하지 않습니다.</label>
      <input type="file" multiple accept=".xlsx,.xls,.csv" onChange={e => addFiles(e.target.files)} />
      {files.length>0&&<details><summary>원본 미리보기 (파일·시트별 20행)</summary>{files.map((f,i)=><div key={i} style={{overflowX:"auto",maxHeight:200}}>
        <strong>{f.name} / {f.sheet} · {f.rows.length}행</strong><table style={{fontSize:12}}><thead><tr><th>행</th>{Object.keys(f.rows[0]??{}).map(h=><th key={h}>{h}</th>)}</tr></thead>
        <tbody>{f.rows.slice(0,20).map((r,n)=><tr key={n}><td>{n+2}</td>{Object.keys(f.rows[0]??{}).map(h=><td key={h}>{String(r[h]??"")}</td>)}</tr>)}</tbody></table></div>)}</details>}
      {files.map((f, i) => <div key={i} style={{ fontSize: 12 }}>{f.name} / {f.sheet} · {f.rows.length}행 <button style={btn2} onClick={() => setFiles(files.filter((_, j) => j !== i))}>제거</button></div>)}
      {headers.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 6 }}>
        {TARGETS.map(([k, l]) => <label key={k} style={{ fontSize: 12 }}>{l}<select style={{ ...inp, width: "100%" }} value={rules[k] ?? ""} onChange={e => { const n = { ...rules }; if (e.target.value) n[k] = e.target.value; else delete n[k]; setRulesTracked(n); }}>
          <option value="">(매핑 안 함)</option>{headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>}
      {log.length > 0 && <div data-testid="import-log" style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>{log.map((m, i) => <div key={i} style={{ alignSelf: m.who === "user" ? "flex-end" : "flex-start", maxWidth: "80%", padding: "4px 10px", borderRadius: 12, fontSize: 12, background: m.who === "user" ? "var(--x-primary-soft)" : "var(--surface-off)" }}>{m.text}</div>)}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button style={btn2} data-testid="import-undo" disabled={!undo.length} onClick={() => { const u = undo[undo.length - 1]; setUndo(undo.slice(0, -1)); setRules(u); say("되돌리기", "직전 규칙 변경을 되돌렸습니다."); }}>직전 규칙 되돌리기</button>
        <select data-testid="import-remove-rule" style={inp} value="" onChange={e => { const k = e.target.value; if (!k) return; const n = { ...rules }; delete n[k]; setRulesTracked(n); say(`${k} 규칙 제거`, `${k} 매핑을 명시적으로 제거했습니다.`); }}><option value="">규칙 제거…</option>{Object.keys(rules).map(k => <option key={k} value={k}>{k} = {rules[k]}</option>)}</select>
        <small style={{ color: "var(--text-muted)" }}>이 입력은 규칙 문장 해석이며 모델을 자동 호출하지 않습니다.</small></div>
      <div style={{ display: "flex", gap: 6 }}><textarea aria-label="이전 대화·규칙 입력" rows={3} style={{ ...inp, flex: 1 }} placeholder={"규칙을 한 줄에 하나씩 입력하세요\n이름=성명\n보호자 연락처=휴대폰"} value={text} onChange={e => setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing){e.preventDefault();void rule();}}}/><button style={btn2} onClick={rule} disabled={!text.trim()}>규칙 적용 · Ctrl+Enter</button></div>
      {text.trim()&&<section style={box} data-testid="import-rule-impact"><strong>적용 전 영향 미리보기 · 정형 해석</strong>
        {rulePreview?<><p>현재 {files.length}개 파일·시트 / {mapped.length}개 회원 원본 행에 적용할 매핑입니다. 준비 결과를 폐기하고 다시 검증하며, 이미 저장된 회원·금융·잔여권리는 수정하지 않습니다.</p>
          {rulePreview.changes.map(c=><div key={c.target}>{TARGETS.find(t=>t[0]===c.target)?.[1]??c.target}: {c.before||"없음"} → {c.after||"규칙 제거"}</div>)}</>:<p>확인할 수 없는 줄이나 같은 대상의 중복 지시가 있습니다. 어떤 변경도 부분 적용하지 않습니다.</p>}
        <button style={btn2} disabled>자유 자연어 AI 해석 · 새 호출 승인 대기</button>
      </section>}
      {mapped.length > 0 && <div style={{ overflowX: "auto", maxHeight: 220 }}><table style={{ fontSize: 12, borderCollapse: "collapse" }}><thead><tr><th>원본</th>{Object.keys(rules).map(k => <th key={k} style={{ padding: "2px 8px" }}>{k}</th>)}</tr></thead>
        <tbody>{mapped.slice(0, 20).map((m, i) => <tr key={i}><td style={{ padding: "2px 8px" }}>{m.f}/{m.s}#{m.i}</td>{Object.keys(rules).map(k => <td key={k} style={{ padding: "2px 8px" }}>{String(m.v[k] ?? "")}</td>)}</tr>)}</tbody></table>
        <small>미리보기 20 / {mapped.length}행 (로컬 매핑, 서버 검증 전)</small></div>}
      {Object.keys(classMap.held).length > 0 && <div role="alert" style={{ color: "var(--color-warning)", fontSize: 12 }}>반 매핑 보류: {Object.entries(classMap.held).map(([n, w]) => `${n}(${w})`).join(", ")} — 해당 행은 보류 처리됩니다.</div>}
      {[...new Set([...Object.keys(classMap.held),...Object.keys(classDecisions)])].map(n=><label key={n} style={{fontSize:12}}>
        원본 반 “{n}” 묶음 연결 <select style={inp} value={classDecisions[n]??""} onChange={e=>{setClassDecisions(d=>({...d,[n]:e.target.value}));say(`반 연결: ${n}`,e.target.value?"선택한 실제 반에 같은 원본 이름의 행을 연결합니다. 서버 준비를 다시 확인하세요.":"수동 결정을 취소하고 자동 매핑/보류 상태로 되돌립니다.");}}>
          <option value="">자동 판단 / 보류 유지</option>{classRows.map(c=><option key={c.id} value={c.id}>{c.name??c.class_name} · {String(c.id).slice(-8)}</option>)}</select></label>)}
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
      </fieldset>
      {!locked&&<OfficeImportsFinance cur={cur} headers={headers} scopeKey={scopeKey} suggested={finSuggest} onLockChange={setFinanceLocked} onRevision={rev => setCur(c => c ? { ...c, revision: rev } : c)} />}
    </section></div>;
}
