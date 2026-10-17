import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { ContractError, Blocked, QState, arr, errMsg, rec } from "./OfficeAppShared";

type Notice = { id: string; title: string; content: string; author_name?: string; is_pinned: boolean; created_at: string };
type ReadStats = { read_count: number; unread_count: number; total: number };
type Form = { title: string; content: string; is_pinned: boolean };
const EMPTY: Form = { title: "", content: "", is_pinned: false };

/** pool_admin only (server: requireRole super_admin, pool_admin for POST/PATCH/DELETE/read-stats). */
export function NoticesPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [push, setPush] = useState(true);
  const [msg, setMsg] = useState("");
  const q = useQuery<Notice[]>({ queryKey: ["oap", "notices"], queryFn: async () => arr<Notice>(await api.get<unknown>("/notices"), "GET /notices") });
  const stats = useQuery<ReadStats>({ queryKey: ["oap", "notice-stats", open], enabled: !!open && canManage, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/notices/${open}/read-stats`), "GET /notices/:id/read-stats");
    if (typeof o.read_count !== "number" || typeof o.unread_count !== "number" || typeof o.total !== "number") throw new ContractError("read-stats");
    return o as unknown as ReadStats;
  } });
  const refresh = () => qc.invalidateQueries({ queryKey: ["oap", "notices"] });
  const save = useMutation({
    mutationFn: async () => {
      const o = editId
        ? await api.patch<unknown>(`/notices/${editId}`, { title: form.title.trim(), content: form.content.trim(), is_pinned: form.is_pinned })
        : await api.post<unknown>("/notices", { title: form.title.trim(), content: form.content.trim(), is_pinned: form.is_pinned, image_urls: [], send_push: push });
      if (rec(o, editId ? "PATCH /notices/:id" : "POST /notices").success !== true) throw new ContractError("공지 저장");
    },
    onSuccess: () => { setMsg(editId ? "공지를 수정했습니다." : "공지를 등록했습니다."); setForm(EMPTY); setEditId(null); refresh(); },
    onError: (e) => setMsg(`저장 결과를 확인하세요: ${errMsg(e)}`),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { rec(await api.delete<unknown>(`/notices/${id}`), "DELETE /notices/:id"); },
    onSuccess: () => { setMsg("공지를 삭제했습니다."); setOpen(null); refresh(); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const submit = () => {
    if (!form.title.trim() || !form.content.trim()) { setMsg("제목과 내용을 입력해주세요."); return; }
    if (save.isPending) return;
    const text = editId ? "공지를 수정합니다. 진행할까요?" : push ? "공지를 등록하고 학부모, 관리자, 선생님에게 푸시 알림을 발송합니다. 진행할까요?" : "공지를 알림 없이 등록합니다. 진행할까요?";
    if (window.confirm(text)) save.mutate();
  };
  const items = q.data ?? [];
  return <>
    {canManage ? <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <input placeholder="공지 제목" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <textarea rows={3} placeholder="공지 내용" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      <div className="oap-row">
        <label><input type="checkbox" checked={form.is_pinned} onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })} /> 고정</label>
        {!editId && <label><input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> 푸시 알림 발송</label>}
        <button onClick={submit} disabled={save.isPending}>{save.isPending ? "저장 중…" : editId ? "수정 저장" : "공지 등록"}</button>
        {editId && <button onClick={() => { setEditId(null); setForm(EMPTY); }}>수정 취소</button>}
        {msg && <span className="oap-sub" role="status">{msg}</span>}
      </div>
    </div> : <Blocked>공지 등록, 수정, 삭제와 읽음 현황은 서버에서 pool_admin 전용입니다. 선생님 역할은 조회만 가능합니다.</Blocked>}
    {canManage && <Blocked>사진 첨부와 AI 작성은 이 화면에서 제공하지 않습니다. 공지 수정은 알림을 재발송하지 않습니다.</Blocked>}
    <QState q={q} />
    {!q.isLoading && !q.isError && !items.length && <div className="oap-empty">등록된 공지사항이 없습니다.</div>}
    {items.map((n) => <div className="oap-card" key={n.id} style={{ padding: 12 }}>
      <button onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}>{n.is_pinned ? "[고정] " : ""}{n.title}</button>
      <span className="oap-sub"> {n.author_name ?? ""} {n.created_at?.slice(0, 10)}</span>
      {open === n.id && <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{n.content}
        {canManage && <p className="oap-sub">{stats.isLoading ? "읽음 현황 조회 중…" : stats.data ? `읽음 ${stats.data.read_count} / 미읽음 ${stats.data.unread_count} / 전체 ${stats.data.total}` : stats.error ? errMsg(stats.error) : ""}</p>}
        {canManage && <div className="oap-row">
          <button onClick={() => { setEditId(n.id); setForm({ title: n.title, content: n.content, is_pinned: n.is_pinned }); }}>수정</button>
          <button disabled={del.isPending} onClick={() => { if (window.confirm(`'${n.title}' 공지를 삭제합니다. 되돌릴 수 없습니다. 삭제할까요?`)) del.mutate(n.id); }}>삭제</button>
        </div>}
      </div>}
    </div>)}
  </>;
}
