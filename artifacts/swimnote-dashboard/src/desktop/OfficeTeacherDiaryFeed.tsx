import { StudentNoteEditor } from "../pages/diary/StudentNoteEditor";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useOfficeActions } from "./OfficeActionContext";
import { OfficeDiaryVideos } from "./OfficeDiaryVideos";
import { Blocked, ContractError, QState, arr, errMsg, rec, type ClassGroup } from "./OfficeAppShared";
import "./OfficeAppPages.css";

type Diary = { id: string; class_group_id: string; class_name: string | null; lesson_date: string; teacher_name: string | null; common_content: string | null; is_edited?: boolean; note_count?: number | string };
type Detail = Diary & { student_notes: { id: string; student_id: string; note_content: string | null }[] };

/** Teacher's own diary feed: GET /diaries (class_group_id, lesson_date), GET /diaries/:id, PUT /diaries/:id. Not the admin all-entries list. */
export function OfficeTeacherDiaryFeed() {
  const qc = useQueryClient();
  const actions = useOfficeActions();
  const [cls, setCls] = useState("");
  const [date, setDate] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [deleteReceipt, setDeleteReceipt] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
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
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!actions) throw new Error("현재 로그인 세션의 삭제 Action을 확인하지 못했습니다. 삭제 요청 없음.");
      const result = await actions.execute({ action: "office.diary.delete", input: { diaryId: id } }, "menu");
      if (result.status === "cancelled") return false;
      if (result.status !== "success" || rec(result.data, "일지 삭제").success !== true)
        throw new Error(result.status === "failed" || result.status === "unknown" ? result.message : "삭제 응답을 확인하지 못했습니다.");
      setDeleteReceipt(id);
      const refreshed = await list.refetch({ throwOnError: true });
      if (refreshed.data?.some(row => row.id === id)) throw new Error("삭제 응답은 수신했으나 목록에 대상이 남아 있습니다. 재전송하지 마세요.");
      return true;
    },
    onSuccess: deleted => { if (deleted) { setSel(null); setDraft(null); setMsg("삭제 응답과 일지 목록에서 대상 제외를 확인했습니다."); } },
    onError: error => setMsg(`삭제 결과를 확인하세요: ${errMsg(error)}`),
  });
  useEffect(() => { if (list.isSuccess && sel && !list.data.some(row => row.id === sel)) { setSel(null); setDraft(null); } }, [list.data, list.isSuccess, sel]);
  const rows = list.data ?? [];
  const d = detail.data;
  return <div className="oap" data-testid="office-teacher-diary-feed">
    <div><h1>내 일지</h1><p className="oap-sub">담당 반의 일지 조회·수정·본인 작성 일지 삭제</p></div>
    <fieldset disabled={save.isPending || remove.isPending || mediaBusy} style={{ border: 0, padding: 0 }}><div className="oap-row">
      <select value={cls} onChange={(e) => { setCls(e.target.value); setSel(null); }} aria-label="반 필터"><option value="">전체 반</option>{(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSel(null); }} aria-label="수업일 필터" />
      {date && <button onClick={() => setDate("")}>날짜 해제</button>}
      {msg && <span className="oap-sub" role="status">{msg}</span>}
    </div></fieldset>
    <QState q={groups} /><QState q={list} />
    {!list.isLoading && !list.isError && (rows.length === 0 ? <div className="oap-empty">조건에 맞는 일지가 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>수업일</th><th>반</th><th>작성자</th><th>내용</th><th>회원 메모</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.lesson_date}</td><td>{r.class_name ?? "-"}</td><td>{r.teacher_name ?? "-"}</td><td>{(r.common_content ?? "").slice(0, 60) || "-"}{r.is_edited ? " (수정됨)" : ""}</td><td>{String(r.note_count ?? 0)}</td>
          <td><button disabled={save.isPending || remove.isPending || mediaBusy} aria-pressed={sel === r.id} onClick={() => { setSel(sel === r.id ? null : r.id); setDraft(null); }}>열기</button></td></tr>)}</tbody></table></div>)}
    {sel && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <QState q={detail} />
      {d && <>
        <b>{`${d.lesson_date} ${d.class_name ?? ""}`}</b>
        <textarea rows={5} value={draft ?? d.common_content ?? ""} onChange={(e) => setDraft(e.target.value)} aria-label="공통 내용" />
        <div className="oap-row"><button disabled={draft === null || !draft.trim() || save.isPending || remove.isPending} onClick={() => { if (draft && window.confirm("일지 공통 내용을 수정합니다. 진행할까요?")) save.mutate({ id: d.id, text: draft }); }}>{save.isPending ? "저장 중…" : "수정 저장"}</button>
          <button disabled={!actions || save.isPending || remove.isPending || mediaBusy || deleteReceipt === d.id} onClick={() => remove.mutate(d.id)}>{remove.isPending ? "삭제 결과 확인 중…" : "이 일지 삭제"}</button></div>
        {d.student_notes.map((n) => <StudentNoteEditor key={n.id} noteId={n.id} content={n.note_content ?? ""}
          onSaved={async () => { await detail.refetch(); await list.refetch(); }} />)}
        <OfficeDiaryVideos key={d.id} diaryId={d.id} classId={d.class_group_id} notes={d.student_notes} disabled={save.isPending || remove.isPending} onBusy={setMediaBusy} />
      </>}
    </div>}
    <Blocked>일지 ID·반·수업일을 다시 조회해 확인 후 삭제합니다. 본인 작성·수영장 권한과 이력·미디어 보존은 기존 서버 정책을 따릅니다. AI의 제한된 실행 명령은 ‘일지 ID 삭제’이며 모호한 대상은 실행하지 않습니다.</Blocked>
  </div>;
}
