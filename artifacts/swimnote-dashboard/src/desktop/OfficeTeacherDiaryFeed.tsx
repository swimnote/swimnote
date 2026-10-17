import { StudentNoteEditor } from "../pages/diary/StudentNoteEditor";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { Blocked, ContractError, QState, arr, errMsg, rec, type ClassGroup } from "./OfficeAppShared";
import "./OfficeAppPages.css";

type Diary = { id: string; class_group_id: string; class_name: string | null; lesson_date: string; teacher_name: string | null; common_content: string | null; is_edited?: boolean; note_count?: number | string };
type Detail = Diary & { student_notes: { id: string; student_id: string; note_content: string | null }[] };

/** Teacher's own diary feed: GET /diaries (class_group_id, lesson_date), GET /diaries/:id, PUT /diaries/:id. Not the admin all-entries list. */
export function OfficeTeacherDiaryFeed() {
  const qc = useQueryClient();
  const [cls, setCls] = useState("");
  const [date, setDate] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const groups = useQuery<ClassGroup[]>({ queryKey: ["oap", "class-groups"], queryFn: async () => arr<ClassGroup>(await api.get<unknown>("/class-groups"), "GET /class-groups") });
  const qs = new URLSearchParams(); if (cls) qs.set("class_group_id", cls); if (date) qs.set("lesson_date", date);
  const path = `/diaries${qs.toString() ? `?${qs}` : ""}`;
  const list = useQuery<Diary[]>({ queryKey: ["oap", "diaries", cls, date], queryFn: async () => {
    const rows = arr<Diary>(await api.get<unknown>(path), `GET ${path}`);
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.lesson_date !== "string") throw new ContractError(`GET ${path}`); });
    return rows;
  } });
  const detail = useQuery<Detail>({ queryKey: ["oap", "diary-detail", sel], enabled: !!sel, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/diaries/${encodeURIComponent(sel as string)}`), "GET /diaries/:id");
    if (typeof o.id !== "string" || !Array.isArray(o.student_notes)) throw new ContractError("GET /diaries/:id");
    return o as unknown as Detail;
  } });
  const save = useMutation({
    mutationFn: async (v: { id: string; text: string }) => { if (rec(await api.put<unknown>(`/diaries/${encodeURIComponent(v.id)}`, { common_content: v.text }), "PUT /diaries/:id").success !== true) throw new ContractError("PUT /diaries/:id"); },
    onSuccess: (_d, v) => { setMsg("일지를 수정했습니다."); setDraft(null); qc.invalidateQueries({ queryKey: ["oap", "diaries"] }); qc.invalidateQueries({ queryKey: ["oap", "diary-detail", v.id] }); },
    onError: (e) => setMsg(`수정 결과를 확인하세요: ${errMsg(e)}`),
  });
  const rows = list.data ?? [];
  const d = detail.data;
  return <div className="oap" data-testid="office-teacher-diary-feed">
    <div><h1>내 일지</h1><p className="oap-sub">담당 반의 일지 목록과 공통 내용 수정</p></div>
    <div className="oap-row">
      <select value={cls} onChange={(e) => { setCls(e.target.value); setSel(null); }} aria-label="반 필터"><option value="">전체 반</option>{(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSel(null); }} aria-label="수업일 필터" />
      {date && <button onClick={() => setDate("")}>날짜 해제</button>}
      {msg && <span className="oap-sub" role="status">{msg}</span>}
    </div>
    <QState q={groups} /><QState q={list} />
    {!list.isLoading && !list.isError && (rows.length === 0 ? <div className="oap-empty">조건에 맞는 일지가 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>수업일</th><th>반</th><th>작성자</th><th>내용</th><th>회원 메모</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.lesson_date}</td><td>{r.class_name ?? "-"}</td><td>{r.teacher_name ?? "-"}</td><td>{(r.common_content ?? "").slice(0, 60) || "-"}{r.is_edited ? " (수정됨)" : ""}</td><td>{String(r.note_count ?? 0)}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => { setSel(sel === r.id ? null : r.id); setDraft(null); }}>열기</button></td></tr>)}</tbody></table></div>)}
    {sel && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <QState q={detail} />
      {d && <>
        <b>{`${d.lesson_date} ${d.class_name ?? ""}`}</b>
        <textarea rows={5} value={draft ?? d.common_content ?? ""} onChange={(e) => setDraft(e.target.value)} aria-label="공통 내용" />
        <div className="oap-row"><button disabled={draft === null || !draft.trim() || save.isPending} onClick={() => { if (draft && window.confirm("일지 공통 내용을 수정합니다. 진행할까요?")) save.mutate({ id: d.id, text: draft }); }}>{save.isPending ? "저장 중…" : "수정 저장"}</button></div>
        {d.student_notes.map((n) => <StudentNoteEditor key={n.id} noteId={n.id} content={n.note_content ?? ""}
          onSaved={async () => { await detail.refetch(); await list.refetch(); }} />)}
      </>}
    </div>}
    <Blocked>공통 내용·회원별 개별 내용은 기존 서버의 본인 작성·수영장 권한 검사 후에만 수정됩니다.</Blocked>
  </div>;
}
