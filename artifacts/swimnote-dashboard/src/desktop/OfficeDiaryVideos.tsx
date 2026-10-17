import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { getAuthGeneration } from "../lib/token";
import { QState, arr, errMsg, rec } from "./OfficeAppShared";
import { OfficeVideoPicker, VideoPreview, videoRows } from "./OfficeVideoPicker";

type Note = { id: string; student_id: string; student_name?: string };
export async function attachOfficeDiaryVideos(target: { diaryId: string; classId: string; noteId?: string; studentId?: string }, ids: string[]) {
  const generation = getAuthGeneration();
  const assertCurrent = () => { if (generation !== getAuthGeneration()) throw new Error("로그인 세션이 변경됐습니다. 이전 대상에 연결 요청을 보내지 않습니다."); };
  if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new Error("영상은 대상별 최대 10개를 중복 없이 선택하세요.");
  if (!!target.noteId !== !!target.studentId) throw new Error("개인 영상은 회원과 해당 일지 노트를 함께 확인해야 합니다.");
  const classes = arr<{ id: string }>(await api.get<unknown>("/class-groups"), "영상 연결 담당 반");
  assertCurrent();
  if (!classes.some(c => c.id === target.classId)) throw new Error("현재 조회 권한의 담당 반이 아닙니다. 연결 요청 없음.");
  const diary = rec(await api.get<unknown>(`/diaries/${encodeURIComponent(target.diaryId)}`), "영상 연결 대상 일지");
  assertCurrent();
  if (diary.id !== target.diaryId || diary.class_group_id !== target.classId) throw new Error("연결 대상 반·일지를 확인하지 못했습니다. 영상 연결 요청 없음.");
  if (target.noteId && (!target.studentId || !Array.isArray(diary.student_notes) ||
    !diary.student_notes.some((n: Note) => n.id === target.noteId && n.student_id === target.studentId))) throw new Error("해당 회원의 일지 노트를 확인하지 못했습니다. 영상 연결 요청 없음.");
  const sourcePath = target.studentId ? `/videos/private/${encodeURIComponent(target.studentId)}` : `/videos/group/${encodeURIComponent(target.classId)}`;
  const source = videoRows(await api.get<unknown>(sourcePath));
  assertCurrent();
  if (ids.some(id => !source.some(v => v.id === id && v.class_id === target.classId && (target.studentId ? v.student_id === target.studentId : !v.student_id))))
    throw new Error("현재 반·회원 앨범에 없는 영상입니다. 연결 요청 없음.");
  const response = rec(await api.post<unknown>(target.noteId ? "/videos/note-attach" : "/videos/diary-attach", {
    ...(target.noteId ? { note_id: target.noteId } : { diary_id: target.diaryId }),
    video_ids: ids, sort_orders: ids.map((_, i) => i),
  }), "영상 연결");
  assertCurrent();
  const readback = videoRows(await api.get<unknown>(`/videos/diary/${encodeURIComponent(target.diaryId)}`), true);
  const found = ids.filter(id => readback.some(v => v.id === id && (target.noteId ? v.student_note_id === target.noteId : !v.student_note_id)));
  if (response.updated !== ids.length || found.length !== ids.length)
    throw new Error(`영상 연결 일부/결과 불명: 요청 ${ids.length}, 응답 ${String(response.updated)}, 대상 일지 재조회 확인 ${found.length}. 같은 요청을 자동 재전송하지 않습니다.`);
  return found.length;
}

export function OfficeDiaryVideos({ diaryId, classId, notes, disabled = false, onBusy }: { diaryId: string; classId: string; notes: Note[]; disabled?: boolean; onBusy?: (busy: boolean) => void }) {
  const [noteId, setNoteId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busyUpload, setBusyUpload] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const note = notes.find(n => n.id === noteId);
  const attached = useQuery({ queryKey: ["oap", "diary-videos", diaryId],
    queryFn: async () => videoRows(await api.get<unknown>(`/videos/diary/${encodeURIComponent(diaryId)}`), true) });
  const attach = useMutation({
    mutationFn: () => attachOfficeDiaryVideos({ diaryId, classId, ...(note ? { noteId: note.id, studentId: note.student_id } : {}) }, selected),
    onSuccess: async count => { setMessage(`영상 ${count}개를 대상 일지에서 재조회 확인했습니다.`); setSelected([]); await attached.refetch(); },
    onError: error => { setUncertain(true); setMessage(`영상 연결 결과: ${errMsg(error)} 재전송 전 연결 목록을 확인하세요.`); },
  });
  useEffect(() => { onBusy?.(attach.isPending || busyUpload); }, [attach.isPending, busyUpload, onBusy]);
  useEffect(() => () => onBusy?.(false), [onBusy]);
  return <section>
    <h3>일지 영상</h3><QState q={attached} />
    <div className="oap-row">{attached.data?.map(video => <div key={video.id}><VideoPreview video={video} />
      <span className="oap-sub">{video.student_note_id ? `개별 노트: ${notes.find(n => n.id === video.student_note_id)?.student_name ?? video.student_note_id}` : "반 공용"}</span>
    </div>)}</div>
    <fieldset disabled={disabled || attach.isPending || busyUpload} style={{ border: 0, padding: 0 }}>
      <select aria-label="영상 연결 대상" value={noteId} onChange={event => { setNoteId(event.target.value); setSelected([]); }}><option value="">반 공용 일지</option>
        {notes.map(n => <option key={n.id} value={n.id}>{n.student_name ?? n.student_id} 개별 노트</option>)}</select>
    </fieldset>
    <OfficeVideoPicker key={`${classId}:${note?.student_id ?? ""}`} classId={classId} studentId={note?.student_id}
      selected={selected} onChange={setSelected} disabled={disabled || attach.isPending} onBusy={setBusyUpload} />
    <button disabled={disabled || !selected.length || attach.isPending || busyUpload || uncertain} onClick={() => {
      if (window.confirm(`현재 일지 ${diaryId}의 ${note ? `${note.student_name ?? note.student_id} 개별 노트` : "반 공용 영역"}에 영상 ${selected.length}개를 연결합니다. 기존 앱과 동일하게 해당 영상의 이전 연결이 변경될 수 있습니다. 진행할까요?`)) attach.mutate();
    }}>선택 영상 연결</button>
    <button onClick={() => attached.refetch()}>연결 영상 다시 조회</button>
    {message && <p role="status">{message}</p>}
    {uncertain && <p className="oap-err">일지 본문과 사진 저장 결과는 영상 연결 결과와 별개입니다. 결과를 확인하기 전 영상 연결을 다시 실행하지 않습니다.</p>}
  </section>;
}
