import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { isAllowedOfficeImage } from "../../desktop/office-access.cts";
import { ContractError, Blocked, QState, arr, classIdsOf, errMsg, rec, type ClassGroup, type Student } from "./OfficeAppShared";

export type PhotoMeta = { id: string; album_type: string; class_id: string | null; student_id?: string | null; uploaded_by_name: string | null; caption: string | null; created_at: string; class_name: string | null; presigned_url?: string };
type PhotoList = { photos: PhotoMeta[]; total: number };
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 100;

export function Thumb({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url) return <span>이미지 주소 없음</span>;
  if (!isAllowedOfficeImage(url)) return <span>허용되지 않은 이미지 출처</span>;
  if (failed) return <span>이미지를 불러오지 못했습니다</span>;
  return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4 }} />;
}

export function AlbumPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [cls, setCls] = useState("");
  const [student, setStudent] = useState("");
  const [lessonDate, setLessonDate] = useState("");
  const [msg, setMsg] = useState("");
  const [view, setView] = useState<"group" | "private" | "saved">("group");
  const [viewStudent, setViewStudent] = useState("");
  const listPath = view === "group" ? "/photos/teacher-all?scope=group" : view === "saved" ? "/photos/teacher-all?scope=saved" : `/photos/private/${encodeURIComponent(viewStudent)}?limit=200`;
  const q = useQuery<PhotoList>({ queryKey: ["oap", "photos", view, viewStudent], enabled: view !== "private" || !!viewStudent, queryFn: async () => {
    const o = rec(await api.get<unknown>(listPath), `GET ${listPath}`);
    if (!Array.isArray(o.photos)) throw new ContractError(`GET ${listPath}`);
    return { photos: o.photos as PhotoMeta[], total: typeof o.total === "number" ? o.total : o.photos.length };
  } });
  const groups = useQuery<ClassGroup[]>({ queryKey: ["oap", "class-groups"], queryFn: async () => arr<ClassGroup>(await api.get<unknown>("/class-groups"), "GET /class-groups") });
  const students = useQuery<Student[]>({ queryKey: ["oap", "students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students"), "GET /students") });
  const classStudents = useMemo(() => (students.data ?? []).filter((s) => !!cls && classIdsOf(s)?.includes(cls)), [students.data, cls]);

  const pick = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const bad = picked.filter((f) => !f.type.startsWith("image/") || f.size > MAX_BYTES);
    if (bad.length) { setMsg(`이미지가 아니거나 8MB를 넘는 파일이 있어 제외했습니다: ${bad.map((f) => f.name).join(", ")}`); }
    setFiles(picked.filter((f) => f.type.startsWith("image/") && f.size <= MAX_BYTES).slice(0, MAX_FILES));
  };
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      files.forEach((f) => fd.append("photos", f, f.name));
      if (student) { fd.append("class_id", cls); fd.append("student_id", student); }
      else { if (cls) fd.append("class_id", cls); if (lessonDate) fd.append("lesson_date", lessonDate); }
      const o = rec(await api.postForm<unknown>(student ? "/photos/private" : "/photos/group", fd), "photo upload");
      if (typeof o.count !== "number" || !Array.isArray(o.photos)) throw new ContractError("photo upload");
      return o.count;
    },
    onSuccess: (n) => { setMsg(`${n}장을 업로드했습니다.`);
      if (student) { setView("private"); setViewStudent(student); } else setView("group"); setFiles([]); if (fileRef.current) fileRef.current.value = ""; qc.invalidateQueries({ queryKey: ["oap", "photos"] }); },
    onError: (e) => setMsg(`업로드 결과를 확인하세요: ${errMsg(e)}`),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { if (rec(await api.delete<unknown>(`/photos/${encodeURIComponent(id)}`), "DELETE /photos/:id").success !== true) throw new ContractError("DELETE /photos/:id"); },
    onSuccess: () => { setMsg("사진을 삭제했습니다."); qc.invalidateQueries({ queryKey: ["oap", "photos"] }); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const submit = () => {
    if (!files.length || upload.isPending) return;
    const where = student ? `${classStudents.find((s) => s.id === student)?.name ?? "회원"} 개인 앨범` : cls ? `${groups.data?.find((g) => g.id === cls)?.name ?? "반"} 반 앨범` : "전체 앨범";
    if (window.confirm(`${files.length}장을 ${where}에 업로드합니다. 진행할까요?`)) upload.mutate();
  };
  const rows = q.data?.photos ?? [];
  return <>
    <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="oap-row">
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => pick(e.target.files)} aria-label="사진 선택" />
        <select value={cls} onChange={(e) => { setCls(e.target.value); setStudent(""); }} aria-label="반 선택"><option value="">전체 앨범(반 없음)</option>{(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <select value={student} disabled={!cls} onChange={(e) => setStudent(e.target.value)} aria-label="회원 선택"><option value="">반 공용(회원 지정 안 함)</option>{classStudents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        {!student && <input type="date" value={lessonDate} onChange={(e) => setLessonDate(e.target.value)} aria-label="수업일(선택)" />}
        <button disabled={!files.length || upload.isPending} onClick={submit}>{upload.isPending ? "업로드 중…" : `업로드 (${files.length}장)`}</button>
        {msg && <span className="oap-sub" role="status">{msg}</span>}
      </div>
    </div>
    <div className="oap-row">
      {(["group", "private", "saved"] as const).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === "group" ? "전체 앨범" : v === "private" ? "회원 개인 앨범" : "내가 저장한 사진"}</button>)}
      {view === "private" && <select value={viewStudent} onChange={(e) => setViewStudent(e.target.value)} aria-label="회원 앨범 선택"><option value="">회원 선택</option>{(students.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    </div>
    {view === "private" && !viewStudent && <div className="oap-empty">회원을 선택하면 개인 앨범을 조회합니다.</div>}
    <QState q={q} />
    {(view !== "private" || !!viewStudent) && !q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">등록된 사진이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>이미지</th><th>업로드일</th><th>반</th><th>업로더</th><th>설명</th><th /></tr></thead><tbody>
        {rows.map((p) => <tr key={p.id}><td><Thumb url={p.presigned_url} /></td><td>{p.created_at?.slice(0, 10) ?? "-"}</td><td>{p.class_name ?? "-"}</td><td>{p.uploaded_by_name ?? "-"}</td><td>{p.caption ?? "-"}</td>
          <td><button disabled={del.isPending} onClick={() => { if (window.confirm("이 사진을 삭제합니다. 되돌릴 수 없습니다. 삭제할까요?")) del.mutate(p.id); }}>삭제</button></td></tr>)}</tbody></table></div>)}
    <Blocked>사진은 서버가 발급한 임시 주소로 허용된 출처에서만 표시하며 주소는 노출하지 않습니다. 파일당 8MB, 한 번에 최대 100장입니다. 선생님은 담당 반만, 본인이 올린 사진만 삭제할 수 있습니다(서버 규칙).</Blocked>
  </>;
}
