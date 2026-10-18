import { useEffect,useId,useState, type ReactNode } from "react";
import {createPortal} from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import {ReportWorkflowNav,useReportTarget} from "./ReportWorkflow";

const LABELS: Record<string, string> = { summary: "요약", overall_assessment: "전반적 평가", positive_growth_signals: "긍정적 성장 신호", next_growth_targets: "다음 성장 목표", next_observation_targets: "다음 관찰 목표", success_conditions: "성공 조건", support_levers: "지원 방법" };

function Node({ v }: { v: unknown }): ReactNode {
  if (v == null || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{String(v)}</div>;
  if (Array.isArray(v)) return <ul style={{ margin: 0, paddingLeft: 16 }}>{v.map((x, i) => <li key={i} style={{ fontSize: 13 }}><Node v={x} /></li>)}</ul>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{Object.entries(v as object).map(([k, x]) =>
    <div key={k}><span style={{ fontSize: 11, color: "#64748B" }}>{LABELS[k] ?? k.replace(/_/g, " ")}</span><Node v={x} /></div>)}</div>;
}

/** Shared renderer for report_content as stored/published (string or structured object), plus detail-level lists. */
export function ReportContentView({ content, extra }: { content: unknown; extra?: Record<string, unknown> }) {
  if (content == null && !extra) return <div style={{ color: "#94A3B8", fontSize: 13 }}>리포트 내용이 없습니다.</div>;
  const obj = content && typeof content === "object" && !Array.isArray(content) ? (content as Record<string, unknown>) : null;
  const sections: [string, unknown][] = obj ? Object.entries(obj) : [["리포트", content]];
  for (const [k, v] of Object.entries(extra ?? {})) if (v && !(obj && k in obj)) sections.push([k, v]);
  return <div data-testid="report-content" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {sections.map(([k, v]) => v == null || v === "" || (Array.isArray(v) && !v.length) ? null :
      <div key={k} style={{ padding: 12, border: "1px solid #E2E8F0", borderRadius: 6, background: "#fff" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#1A4070", marginBottom: 4 }}>{LABELS[k] ?? k.replace(/_/g, " ")}</div><Node v={v} /></div>)}
  </div>;
}

export function ReportDetailLink({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const printId=useId(),[printError,setPrintError]=useState("");
  useEffect(()=>{
    const done=()=>{if(document.body.dataset.officeReportPrintId===printId)delete document.body.dataset.officeReportPrintId;};
    window.addEventListener("afterprint",done);return()=>{window.removeEventListener("afterprint",done);done();};
  },[printId,open]);
  const q = useQuery<any>({ queryKey: ["growth-report-detail", id], queryFn: () => api.get(`/admin/growth-reports/${encodeURIComponent(id)}`), enabled: open,staleTime:0 });
  const matches=!q.data||(q.data.report_id??q.data.id)===undefined||(q.data.report_id??q.data.id)===id;
  const d = matches?q.data:undefined;
  const canPrint=!!d&&!q.isFetching&&!q.isError&&Number.isSafeInteger(d.version_number)&&
    typeof d.student?.id==="string"&&((d.report_id??d.id)===undefined||(d.report_id??d.id)===id);
  const [,setTarget]=useReportTarget();
  return <>
    <button onClick={e => { e.stopPropagation(); setOpen(true); }} data-testid={`report-detail-${id}`} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 600, color: "#1A4070", textDecoration: "underline", cursor: "pointer" }}>{label}</button>
    {open && createPortal(<div data-office-report-print={printId} onClick={e=>e.stopPropagation()}>
      <style>{`@media print{body[data-office-report-print-id="${printId}"]>:not([data-office-report-print="${printId}"]){display:none!important}[data-office-report-print] [data-report-noprint]{display:none!important}[data-office-report-print] .report-print-sheet{position:static!important;inset:auto!important;width:100%!important;max-width:none!important;box-shadow:none!important;display:block!important}[data-office-report-print] .report-print-body{overflow:visible!important;display:block!important}body{background:white!important}}`}</style>
      <div data-report-noprint onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} />
      <div className="report-print-sheet" onClick={e => e.stopPropagation()} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "100vw", background: "#fff", zIndex: 50, display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between" }}>
          <strong>{d?.student?.name??label} 성장리포트 상세</strong><button data-report-noprint onClick={() => setOpen(false)}>닫기</button></div>
        <div className="report-print-body" style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {q.isLoading && <div style={{ color: "#94A3B8" }}>로딩 중…</div>}
          {q.isError && <div style={{ color: "#EF4444" }}>불러오지 못했습니다. <button onClick={() => q.refetch()}>다시 시도</button></div>}
          {!matches&&<div role="alert">선택한 보고서와 응답 ID가 달라 본문 표시·인쇄를 중단했습니다.</div>}
          {d && <>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>ID {d.report_id??id} · 버전 {d.version_number} · 상태 {d.product_status} · 기간 {d.report_period}<br/>
              강사 검수: {d.teacher_reviewed_at??"미확인"} · 관리자 확인: {d.admin_reviewed_at??"미확인"}<br/>
              {d.published_at?`당시 발행본 · 발행 ${d.published_at}. 최신 초안으로 바꾸지 않습니다.`:"현재 미발행 본문"}</div>
            <p data-report-noprint style={{fontSize:12}}>본문은 읽기 전용입니다. 관리자 확인은 기존 경로에서만 기록하며, 강사 검수를 대신하거나 새 유료 재분석을 실행하지 않습니다.</p>
            <div data-report-noprint><button disabled={!canPrint} onClick={()=>{
              if(!canPrint)return;setPrintError("");document.body.dataset.officeReportPrintId=printId;
              try{window.print();}catch{delete document.body.dataset.officeReportPrintId;setPrintError("인쇄창을 열지 못했습니다. PDF 저장 완료로 처리하지 않았습니다.");}
            }}>이 보고서 인쇄·PDF 저장</button><p>이 ID·버전의 표시 본문만 인쇄합니다. PDF 파일 생성·저장 완료 여부는 운영체제 인쇄창에서 확인하세요.</p>{printError&&<p role="alert">{printError}</p>}
              <button onClick={()=>setTarget({id,studentId:d.student.id,name:d.student.name??label,period:d.report_period,version:d.version_number})}>이 보고서를 연속 업무 대상으로 선택</button></div>
            <ReportContentView content={d.report_content} extra={{ sns_summary: d.sns_summary, positive_growth_signals: d.positive_growth_signals, next_growth_targets: d.next_growth_targets, next_observation_targets: d.next_observation_targets }} /></>}
        </div>{d&&<div data-report-noprint><ReportWorkflowNav target={{id,studentId:d.student.id,name:d.student.name??label,period:d.report_period,version:d.version_number}}/></div>}</div></div>,document.body)}
  </>;
}

/** Server pagination control for monthly-list (limit/offset, total). */
export function ReportPager({ offset, limit = 50, total, onChange }: { offset: number; limit?: number; total?: number; onChange: (o: number) => void }) {
  const t = total ?? 0;
  return <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#64748B", margin: "0 0 10px" }}>
    <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>이전</button>
    <span>{t ? `${offset + 1}–${Math.min(offset + limit, t)} / ${t}` : "0"}</span>
    <button disabled={offset + limit >= t} onClick={() => onChange(offset + limit)}>다음</button></div>;
}

/** monthly-list rows carry report_id; callers key everything by id. */
export function normalizeReportList<T extends { items?: any[] }>(d: T): T {
  return { ...d, items: (d.items ?? []).map((r) => ({ ...r, id: r.report_id ?? r.id })) };
}
