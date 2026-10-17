import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { Blocked, ContractError, QState, arr, errMsg, rec } from "./OfficeAppShared";
import "./OfficeAppPages.css";
import { REANALYSIS_REASONS } from "../pages/growth-reports/PendingPage";

type ReportRow = { id: string; student_id: string; student_name: string; product_status: string; report_period: string | null; published_at: string | null; teacher_review_action: string | null; created_at: string };
type ReportDetail = { report_id: string; product_status: string; report_period: string | null; teacher_review_action: string | null; teacher_review_note: string | null; student: { id: string; name: string }; report_content: unknown; sns_summary: unknown };
const STATUS: Record<string, string> = { REVIEW_REQUIRED: "검수 필요", APPROVED: "승인", PUBLISHED: "발행" };
const text = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Teacher-scoped list (GET /teacher/growth-reports) and review (GET/POST /teacher/growth-reports/:id/review). Admin monthly-list is pool_admin-only. */
export function OfficeTeacherGrowthReports() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const list = useQuery<ReportRow[]>({ queryKey: ["oap", "teacher-growth"], queryFn: async () => {
    const o = rec(await api.get<unknown>("/teacher/growth-reports"), "GET /teacher/growth-reports");
    if (o.success !== true || !Array.isArray(o.reports)) throw new ContractError("GET /teacher/growth-reports");
    return arr<ReportRow>(o.reports, "GET /teacher/growth-reports");
  } });
  const detail = useQuery<ReportDetail>({ queryKey: ["oap", "teacher-growth-detail", sel], enabled: !!sel, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/teacher/growth-reports/${encodeURIComponent(sel as string)}/review`), "GET review");
    if (o.success !== true || typeof o.report_id !== "string" || !o.student) throw new ContractError("GET review");
    return o as unknown as ReportDetail;
  } });
  const approve = useMutation({
    mutationFn: async (id: string) => { if (rec(await api.post<unknown>(`/teacher/growth-reports/${encodeURIComponent(id)}/review`, { action: "APPROVE" }), "POST review").success !== true) throw new ContractError("POST review"); },
    onSuccess: (_d, id) => { setMsg("검수 승인을 저장했습니다."); qc.invalidateQueries({ queryKey: ["oap", "teacher-growth"] }); qc.invalidateQueries({ queryKey: ["oap", "teacher-growth-detail", id] }); },
    onError: (e) => setMsg(`승인 결과를 확인하세요: ${errMsg(e)}`),
  });
  const reanalyse = useMutation({
    mutationFn: async (id: string) => {
      const response = rec(await api.post<unknown>(`/teacher/growth-reports/${encodeURIComponent(id)}/review`,
        { action: "REQUEST_REANALYSIS", reason_code: reason, ...(note.trim() ? { note: note.trim() } : {}) }), "POST reanalysis");
      if (response.success !== true) throw new ContractError("POST reanalysis");
    },
    onSuccess: async (_data, id) => {
      setMsg("재분석 요청을 접수했습니다. 분석 완료가 아닙니다."); setReason(""); setNote("");
      await Promise.all([qc.invalidateQueries({ queryKey: ["oap", "teacher-growth"] }),
        qc.invalidateQueries({ queryKey: ["oap", "teacher-growth-detail", id] })]);
    },
    onError: error => setMsg(`재분석 요청 결과를 확인하세요: ${errMsg(error)}`),
  });
  const rows = list.data ?? [];
  return <div className="oap" data-testid="office-teacher-growth">
    <div><h1>성장리포트 검수</h1><p className="oap-sub">담당 회원의 리포트만 표시됩니다.</p></div>
    {msg && <span className="oap-sub" role="status">{msg}</span>}
    <QState q={list} />
    {!list.isLoading && !list.isError && (rows.length === 0 ? <div className="oap-empty">검수할 리포트가 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>회원</th><th>기간</th><th>상태</th><th>검수</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.student_name}</td><td>{r.report_period ?? "-"}</td><td>{STATUS[r.product_status] ?? r.product_status}</td><td>{r.teacher_review_action ?? "-"}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => setSel(sel === r.id ? null : r.id)}>열기</button></td></tr>)}</tbody></table></div>)}
    {sel && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <QState q={detail} />
      {detail.data && <>
        <b>{detail.data.student.name}</b><span className="oap-sub">{`${detail.data.report_period ?? ""} / ${STATUS[detail.data.product_status] ?? detail.data.product_status}`}</span>
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{text(detail.data.report_content)}</pre>
        {text(detail.data.sns_summary) && <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{text(detail.data.sns_summary)}</pre>}
        <div className="oap-row"><button disabled={detail.data.product_status !== "REVIEW_REQUIRED" || approve.isPending || reanalyse.isPending}
          onClick={() => { if (window.confirm(`${detail.data?.student.name} 리포트를 승인합니다. 진행할까요?`)) approve.mutate(sel); }}>검수 승인</button></div>
        <fieldset disabled={approve.isPending || reanalyse.isPending || detail.data.product_status !== "REVIEW_REQUIRED"} style={{ border: 0, padding: 0 }}>
          <div className="oap-row">
            <select aria-label="재분석 사유" value={reason} onChange={event => setReason(event.target.value)}>
              <option value="">재분석 사유 선택</option>{REANALYSIS_REASONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input aria-label="재분석 메모" placeholder="사유 메모" value={note} onChange={event => setNote(event.target.value)} />
            <button disabled={!reason} onClick={() => {
              if (window.confirm(`${detail.data?.student.name} 리포트의 재분석을 요청합니다. 유료 분석·이용량 차감으로 이어질 수 있습니다. 요청하시겠습니까?`)) reanalyse.mutate(sel);
            }}>재분석 요청</button>
          </div>
        </fieldset>
      </>}
    </div>}
    <Blocked>검수는 승인 또는 사유를 지정한 재분석 요청만 가능합니다. 본문 직접 수정은 기존 서버 계약이 허용하지 않습니다. 유료 처리·횟수 제한은 서버가 판정하며 발행은 관리자 화면에서 처리됩니다.</Blocked>
  </div>;
}
