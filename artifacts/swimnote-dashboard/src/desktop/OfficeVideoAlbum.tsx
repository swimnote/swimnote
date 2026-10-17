import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useAuth } from "../contexts/AuthContext";
import { QState, arr, classIdsOf, type ClassGroup, type Student } from "./OfficeAppShared";
import { OfficeVideoPicker } from "./OfficeVideoPicker";

export function OfficeVideoAlbum() {
  const { state: auth } = useAuth();
  const [cls, setCls] = useState("");
  const [student, setStudent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const groups = useQuery({ queryKey: ["oap", "class-groups"], queryFn: async () => arr<ClassGroup>(await api.get<unknown>("/class-groups"), "반 목록") });
  const students = useQuery({ queryKey: ["oap", "students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students"), "회원 목록") });
  const members = students.data?.filter(s => classIdsOf(s)?.includes(cls)) ?? [];
  return <section>
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><div className="oap-row">
      <select aria-label="영상 반 선택" value={cls} onChange={e => { setCls(e.target.value); setStudent(""); setSelected([]); }}><option value="">반 선택</option>{groups.data?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <select aria-label="영상 회원 선택" value={student} disabled={!cls} onChange={e => { setStudent(e.target.value); setSelected([]); }}><option value="">반 공용 영상</option>{members.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
    </div></fieldset>
    <QState q={groups} /><QState q={students} />
    {cls && (!student || members.some(s => s.id === student)) && <OfficeVideoPicker key={`${cls}:${student}`} classId={cls} studentId={student || undefined}
      selected={selected} onChange={setSelected} onBusy={setBusy}
      canDelete={video => auth.status === "authenticated" && (auth.user.role === "pool_admin" || auth.user.role === "teacher" && video.uploaded_by === auth.user.id)} />}
    <p className="oap-sub">업로드한 영상은 일지 작성 화면에서 선택하거나 기존 일지 상세의 영상 연결에서 첨부합니다. 앨범 업로드만으로 일지에 첨부되지 않습니다.</p>
  </section>;
}
