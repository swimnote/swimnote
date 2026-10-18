import { useEffect,useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "../lib/api-client";
import { listOps,listAllOps, toCsv, download, type OpsItem } from "./office-ops-lib";
import { ui } from "./office-ops-styles";
import { pendingGet, pendingSet, pendingDelete, isUnknown, receiptItem, errText, uuid } from "./office-unknown";

const { box, inp, btn, btn2 } = ui;
type Doc = { template: { id: string; name: string; version: number | string; body: string; consentText: string; hash?: string }; applicant: { name: string; parentName: string; phone: string }; signature: number[][]; signedAt: string; confirmedAt: string; student: { id: string; name: string }; hash: string; rendererVersion: string | number };

/** Signature strokes: points with null/NaN-free pairs; a pair array [x,y]. Rendered as one polyline path. */
export function signaturePath(points: number[][]) {
  const pts = points.filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  /** p[2] === 1 starts a new stroke, so separate strokes are not joined. */
  if (!pts.length) return { d: "", w: 300, h: 120 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(1, Math.max(...xs) - minX), h = Math.max(1, Math.max(...ys) - minY);
  return { d: pts.map((p, i) => `${i && p[2] !== 1 ? "L" : "M"}${(p[0] - minX + 4).toFixed(1)} ${(p[1] - minY + 4).toFixed(1)}`).join(" "), w: w + 8, h: h + 8 };
}
export function SignatureSvg({ points }: { points: number[][] }) {
  const s = signaturePath(points);
  return <svg data-testid="signature-svg" viewBox={`0 0 ${s.w} ${s.h}`} style={{ width: 240, maxWidth: "100%", border: "1px solid var(--border-default)", background: "#fff" }}><path d={s.d} fill="none" stroke="#111" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function OfficeIntakePanel({ scopeKey }: { scopeKey: string }) {
  const qc = useQueryClient(), [, nav] = useLocation();
  const [search, setSearch] = useState("");
  const [offset,setOffset]=useState(0);
  useEffect(()=>setOffset(0),[search]);
  const apps = useQuery({ queryKey: ["ops", "applications", scopeKey, search,offset], queryFn: () => listOps("applications" as never, search, offset), retry: false, refetchInterval:15000 });
  const tpls = useQuery({ queryKey: ["ops", "templates", scopeKey, "all"], queryFn: () => listAllOps("templates"), retry: false });
  const students = useQuery({ queryKey: ["ops-ref", "students", scopeKey], queryFn: () => api.get<any>("/students"), retry: false });
  const stuList: { id: string; name: string }[] = useMemo(() => { const x = students.data; return (Array.isArray(x) ? x : x?.students ?? x?.items ?? x?.data ?? []).map((s: any) => ({ id: String(s.id), name: s.name ?? String(s.id) })); }, [students.data]);
  const [templateId, setTemplateId] = useState(""), [invite, setInvite] = useState<{ token: string; expiresAt: string } | null>(null);
  const [sel, setSel] = useState<OpsItem | null>(null), [studentId, setStudentId] = useState(""), [doc, setDoc] = useState<Doc | null>(null);
  const [inviteNote, setInviteNote] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [lock, setLock] = useState<string>(() => pendingGet(`${scopeKey}|intake`)?.label ?? "");
  const pk = `${scopeKey}|intake`;
  const link = invite ? `${api.getBaseUrl()}/office-tablet#${invite.token}` : "";

  const run = async (label: string, bodyIfNew: () => unknown, call: (body: any) => Promise<any>, ok: (r: any) => void) => {
    const pend = pendingGet(pk);
    if (pend && pend.label !== label) return setMsg("이전 요청 결과가 미확인입니다. 먼저 처리 결과를 확인하세요.");
    const body = (pend?.body as any) ?? { requestId: uuid(), ...(bodyIfNew() as object) };
    setBusy(true); setMsg("");
    try { const r = await call(body); pendingDelete(pk); setLock(""); ok(r); qc.invalidateQueries({ queryKey: ["ops"] }); }
    catch (e: any) {
      if (isUnknown(e)) { pendingSet(pk, { requestId: body.requestId, body, label }); setLock(label); setMsg("결과를 확인하지 못했습니다. 같은 요청으로만 재시도하거나 처리 결과를 확인하세요."); }
      else { pendingDelete(pk); setLock(""); setMsg(errText(e)); }
    } finally { setBusy(false); }
  };
  const makeInvite = () => { if (!templateId) return setMsg("서식을 선택하세요."); return run("invite", () => ({ templateId }), b => api.post<{ invitationId: string; token: string; expiresAt: string }>("/office/operations/applications/invite", b), r => { setInviteNote(""); setInvite({ token: r.token, expiresAt: r.expiresAt }); setMsg("초대 링크를 만들었습니다. 이 화면을 벗어나면 다시 볼 수 없습니다."); }); };
  const confirm = () => {
    if (!sel || !studentId) return setMsg("실제로 등록된 회원을 선택하세요.");
    return run(`confirm:${sel.id}`, () => ({ expectedRevision: sel.revision, studentId }), b => api.post<{ item: OpsItem }>(`/office/operations/applications/${sel.id}/confirm`, b), r => { setSel(r.item); setMsg("신청서를 회원에 연결해 확정했습니다."); });
  };
  const check = async () => {
    const p = pendingGet(pk); if (!p) return;
    const item: any = await receiptItem(p.requestId);
    if (item) { pendingDelete(pk); setLock("");
      if (p.label === "invite") { const d = item.data ?? item; setInvite(null); setInviteNote(`초대가 생성되었습니다(초대 ${d.invitationId ?? item.invitationId ?? "-"}, 만료 ${d.expiresAt ? new Date(d.expiresAt).toLocaleString("ko-KR") : "-"}). 링크 원문은 다시 확인할 수 없으니 사용 가능한 링크가 필요하면 새 초대를 만드세요.`); }
      setMsg("서버에 저장된 처리 결과를 확인했습니다."); qc.invalidateQueries({ queryKey: ["ops"] }); }
    else setMsg("저장 증거를 찾지 못했습니다. 404나 조회 실패는 미처리 증거가 아니며 잠금을 유지합니다.");
  };
  const openDoc = async (it: OpsItem) => { setSel(it); setStudentId(""); setDoc(null); setMsg("");
    if (it.data.status === "confirmed") try { setDoc((await api.get<{ document: Doc }>(`/office/operations/applications/${it.id}/document`)).document); } catch (e: any) { setMsg(errText(e)); } };
  const items = apps.data?.items ?? [];
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="intake-panel">
    <style>{`@media print{[data-intake-noprint]{display:none!important}}`}</style>
    <section data-intake-noprint style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>태블릿 신청 초대</strong>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select data-testid="intake-template" style={inp} disabled={!!lock} value={templateId} onChange={e => { setTemplateId(e.target.value); setInvite(null); }}><option value="">서식 선택</option>
          {(tpls.data?.items ?? []).map(t => <option key={t.id} value={t.id}>{t.data.name}</option>)}</select>
        <button style={btn} data-testid="intake-invite" disabled={busy || !templateId || (!!lock && lock !== "invite")} onClick={makeInvite}>초대 링크 만들기</button></div>
      {tpls.isError && <div role="alert" style={{ color: "var(--color-error)", fontSize: 12 }}>서식 목록을 불러오지 못했습니다. <button style={btn2} onClick={() => tpls.refetch()}>다시 시도</button></div>}
      {inviteNote && <div role="status" data-testid="intake-link-unavailable" style={{ fontSize: 12 }}>{inviteNote}</div>}
      {invite && <div data-testid="intake-link" style={{ fontSize: 12 }}>
        <input readOnly style={{ ...inp, width: "100%" }} value={link} onFocus={e => e.target.select()} />
        <div>만료: {new Date(invite.expiresAt).toLocaleString("ko-KR")} · 관리자 계정 접근 없는 격리된 신청서 화면입니다.</div>
        <button style={btn2} onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg("링크를 복사했습니다."), () => setMsg("복사하지 못했습니다. 직접 선택해 복사하세요."))}>링크 복사</button></div>}
    </section>
    {lock && <div role="alert" data-testid="intake-unknown" style={{ ...box, color: "var(--color-warning)", fontSize: 13 }}>미확인 요청이 있습니다. <button style={btn2} onClick={check}>처리 결과 확인</button></div>}
    {msg && <div role="status" style={{ fontSize: 13 }}>{msg}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,340px) 1fr", gap: 10 }}>
      <section data-intake-noprint style={{ ...box, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6 }}><strong>제출된 신청서</strong><input style={{ ...inp, marginLeft: "auto", width: 120 }} placeholder="검색" value={search} onChange={e => setSearch(e.target.value)} /></div>
        {apps.isLoading && <div style={{ height: 60, background: "var(--surface-subtle)" }} />}
        {apps.isError && <div role="alert" style={{ color: "var(--color-error)", fontSize: 12 }}>{errText(apps.error)} <button style={btn2} onClick={() => apps.refetch()}>다시 시도</button></div>}
        {items.map(i => <button key={i.id} style={{ ...btn2, textAlign: "left", background: sel?.id === i.id ? "var(--x-primary-soft)" : undefined }} onClick={() => openDoc(i)}>
          {i.data.name} / {i.data.parentName} <small>({i.data.status === "confirmed" ? "확정" : "제출됨"})</small></button>)}
        {apps.data && !items.length && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>제출된 신청서가 없습니다.</div>}
        {apps.data&&<div data-intake-noprint style={{display:"flex",gap:8,alignItems:"center"}}><button style={btn2} disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-100))}>이전</button><span>{offset+1}~{offset+items.length} / {apps.data.total}</span><button style={btn2} disabled={!apps.data.has_more} onClick={()=>setOffset(offset+100)}>다음</button></div>}
        <button style={btn2} disabled={!items.length} onClick={() => download("applications.csv", toCsv(["id", "이름", "보호자", "연락처", "동의", "서명시각", "상태", "연결 회원"], items.map(i => [i.id, i.data.name, i.data.parentName, i.data.phone, i.data.consented, i.data.signedAt, i.data.status, i.data.studentId])))}>현재 목록 CSV</button>
      </section>
      <section style={{ ...box }} data-testid="intake-detail">
        {!sel && <div style={{ color: "var(--text-muted)" }}>신청서를 선택하세요.</div>}
        {sel && sel.data.status !== "confirmed" && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>{sel.data.name} (보호자 {sel.data.parentName}, {sel.data.phone})</strong>
          <div style={{ fontSize: 12 }}>서식 {sel.data.template?.name} v{sel.data.template?.version} · 동의 {sel.data.consented ? "예" : "아니오"} · 서명 {sel.data.signedAt}</div>
          <SignatureSvg points={sel.data.signature ?? []} />
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>회원이 아직 생성되지 않았다면 먼저 <a href="/admin/members/new" onClick={e => { e.preventDefault(); nav("/admin/members/new"); }}>회원 등록</a>으로 실제 회원을 만든 뒤 돌아와 직접 선택하세요. 이름·연락처로 자동 선택하지 않습니다.</p>
          <select data-testid="intake-student" style={inp} disabled={!!lock} value={studentId} onChange={e => setStudentId(e.target.value)}><option value="">회원 선택</option>{stuList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button style={btn} data-testid="intake-confirm" disabled={busy || !studentId || (!!lock && !lock.startsWith("confirm"))} onClick={confirm}>이 회원에 연결해 확정</button></div>}
        {sel && sel.data.status === "confirmed" && !doc && !msg && <div style={{ height: 80, background: "var(--surface-subtle)" }} />}
        {doc && <div data-testid="intake-document" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 16 }}>{doc.template.name} (버전 {doc.template.version})</h2>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{doc.template.body}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, borderTop: "1px solid var(--border-default)", paddingTop: 6 }}>{doc.template.consentText}</div>
          <div style={{ fontSize: 13 }}>신청자 {doc.applicant.name} · 보호자 {doc.applicant.parentName} · {doc.applicant.phone}<br />연결 회원 {doc.student.name} · 서명 {doc.signedAt} · 확정 {doc.confirmedAt}</div>
          <SignatureSvg points={doc.signature} />
          <small style={{ color: "var(--text-muted)" }}>문서 해시 {doc.hash} · 렌더러 {String(doc.rendererVersion)}</small>
          <div data-intake-noprint><button style={btn} onClick={() => window.print()}>인쇄·PDF 저장(브라우저 인쇄)</button></div></div>}
      </section>
    </div>
  </div>;
}
