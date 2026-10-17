import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { ContractError, QState, arr, errMsg, okFlag, rec, type Student } from "./OfficeAppShared";

type ParentRequest = { id: string; student_id: string; request_type: string; request_date: string | null; content: string | null; status: string; admin_note: string | null; created_at: string };
type RequestMessage = { id: string; request_id: string; sender_type: string; content: string | null; created_at: string };
const STATUS_LABEL: Record<string, string> = { pending: "대기", done: "완료", rejected: "거절" };

export function ParentRequestsPanel() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const students = useQuery<Student[]>({ queryKey: ["oap", "students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students?pool_all=true"), "GET /students?pool_all=true") });
  const names = useMemo(() => new Map((students.data ?? []).map((s) => [s.id, s.name])), [students.data]);
  const q = useQuery<ParentRequest[]>({ queryKey: ["oap", "parent-requests"], queryFn: async () => {
    const rows = arr<ParentRequest>(await api.get<unknown>("/parent-requests"), "GET /parent-requests");
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.status !== "string") throw new ContractError("GET /parent-requests"); });
    return rows;
  } });
  // Opened only by explicit click; the server marks parent messages as read by staff.
  const m = useQuery<RequestMessage[]>({ queryKey: ["oap", "pr-messages", sel], enabled: !!sel, staleTime: 0, gcTime: 0, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/parent-requests/${encodeURIComponent(sel as string)}/messages`), "GET /parent-requests/:id/messages");
    if (o.success !== true || !Array.isArray(o.messages)) throw new ContractError("GET /parent-requests/:id/messages");
    return o.messages as RequestMessage[];
  } });
  const send = useMutation({
    mutationFn: async (v: { id: string; content: string }) => {
      const o = rec(await api.post<unknown>(`/parent-requests/${encodeURIComponent(v.id)}/messages`, { content: v.content }), "POST /parent-requests/:id/messages");
      if (o.success !== true) throw new ContractError("POST /parent-requests/:id/messages");
    },
    onSuccess: (_d, v) => { setReply(""); setMsg("답장을 발송했습니다."); qc.invalidateQueries({ queryKey: ["oap", "pr-messages", v.id] }); qc.invalidateQueries({ queryKey: ["oap", "parent-requests"] }); },
    onError: (e) => setMsg(`답장 발송 결과를 확인하세요: ${errMsg(e)}`),
  });
  const setStatus = useMutation({
    mutationFn: async (v: { id: string; status: "done" | "rejected" | "pending" }) => okFlag(await api.patch<unknown>(`/parent-requests/${encodeURIComponent(v.id)}`, { status: v.status, admin_note: note.trim() || undefined }), "PATCH /parent-requests/:id"),
    onSuccess: () => { setMsg("상태를 변경했습니다."); setNote(""); qc.invalidateQueries({ queryKey: ["oap", "parent-requests"] }); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const open = (id: string) => {
    if (sel === id) { setSel(null); return; }
    if (window.confirm("대화를 열면 학부모가 보낸 메시지가 읽음으로 처리됩니다. 열까요?")) setSel(id);
  };
  const sendReply = () => {
    if (!sel || !reply.trim() || send.isPending) return;
    if (window.confirm("답장을 발송합니다. 학부모 앱으로 알림이 전달됩니다. 발송할까요?")) send.mutate({ id: sel, content: reply.trim() });
  };
  const change = (status: "done" | "rejected" | "pending") => {
    if (!sel || setStatus.isPending) return;
    const label = STATUS_LABEL[status];
    const notify = status !== "pending" ? " 상태가 바뀌면 학부모에게 결과 알림이 발송됩니다." : "";
    if (window.confirm(`요청 상태를 '${label}'(으)로 변경합니다.${notify} 진행할까요?`)) setStatus.mutate({ id: sel, status });
  };
  const rows = q.data ?? [];
  const cur = rows.find((r) => r.id === sel);
  return <>
    {msg && <span className="oap-sub" role="status">{msg}</span>}
    <QState q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">학부모 요청이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>접수일</th><th>회원</th><th>유형</th><th>요청일</th><th>내용</th><th>상태</th><th>관리자 메모</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.created_at?.slice(0, 10) ?? "-"}</td><td>{names.get(r.student_id) ?? "-"}</td><td>{r.request_type}</td><td>{r.request_date ?? "-"}</td><td>{r.content ?? "-"}</td><td>{STATUS_LABEL[r.status] ?? r.status}</td><td>{r.admin_note ?? "-"}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => open(r.id)}>대화 열기</button></td></tr>)}</tbody></table></div>)}
    {sel && cur && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <QState q={m} />
      {!m.isLoading && !m.isError && (m.data && m.data.length > 0 ? m.data.map((x) => <p key={x.id} style={{ margin: "4px 0" }}><b>{x.sender_type}</b> {x.content ?? ""} <span className="oap-sub">{x.created_at?.slice(0, 16).replace("T", " ")}</span></p>) : <div className="oap-empty">대화 내역이 없습니다.</div>)}
      <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="답장 내용" />
      <div className="oap-row"><button disabled={!reply.trim() || send.isPending} onClick={sendReply}>{send.isPending ? "발송 중…" : "답장 발송"}</button></div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="처리 메모(거절 사유 등, 선택)" />
      <div className="oap-row">
        <button disabled={setStatus.isPending || cur.status === "done"} onClick={() => change("done")}>완료 처리</button>
        <button disabled={setStatus.isPending || cur.status === "rejected"} onClick={() => change("rejected")}>거절</button>
        <button disabled={setStatus.isPending || cur.status === "pending"} onClick={() => change("pending")}>대기로 되돌림</button>
      </div>
    </div>}
  </>;
}
