import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { isAllowedOfficeImage } from "../../desktop/office-access.cts";
import { ContractError, QState, arr, errMsg, rec } from "./OfficeAppShared";

export type VideoMeta = { id: string; class_id?: string; uploaded_by?: string; student_id?: string | null; student_note_id?: string | null; caption?: string | null; file_size?: number; presigned_url?: string };
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export function validateOfficeVideo(file: Pick<File, "size" | "name" | "type">): string | null {
  if (!file.size || file.size > VIDEO_MAX_BYTES) return "비어 있지 않은 100MB 이하의 영상을 선택하세요.";
  if (!/\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(file.name)) return "기존 영상 형식(mp4, mov, avi, mkv, webm, m4v)을 선택하세요.";
  if (file.type && !file.type.startsWith("video/")) return "영상 파일 형식을 확인하세요.";
  return null;
}
export function videoRows(value: unknown, envelope = false): VideoMeta[] {
  const rows = arr<VideoMeta>(envelope ? rec(value, "영상 목록").videos : value, "영상 목록");
  if (rows.some(row => !row || typeof row.id !== "string")) throw new ContractError("영상 목록");
  return rows;
}
export function VideoPreview({ video }: { video: VideoMeta }) {
  const [error, setError] = useState(false);
  return <div>
    {video.presigned_url && isAllowedOfficeImage(video.presigned_url) && !error
      ? <video src={video.presigned_url} controls preload="none" width={220} onError={() => setError(true)} />
      : <span className="oap-sub">{error ? "PC에서 재생할 수 없는 형식이거나 주소가 만료됐습니다." : "영상 메타데이터 확인 · 기존 서버가 직접 재생주소를 제공하지 않았습니다."}</span>}
    <div>{video.caption || video.id}{video.file_size ? ` · ${(video.file_size / 1024 / 1024).toFixed(1)}MB` : ""}</div>
  </div>;
}

/** Original file only. No transcoder, guessed URL, privileged IPC or automatic resend. */
export function OfficeVideoPicker({ classId, studentId, selected, onChange, disabled = false, onBusy, canDelete }: {
  classId: string; studentId?: string; selected: string[]; onChange: (ids: string[]) => void;
  disabled?: boolean; onBusy?: (busy: boolean) => void; canDelete?: (video: VideoMeta) => boolean;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [deleteLocked, setDeleteLocked] = useState<string[]>([]);
  const path = studentId ? `/videos/private/${encodeURIComponent(studentId)}` : `/videos/group/${encodeURIComponent(classId)}`;
  const list = useQuery<VideoMeta[]>({ queryKey: ["oap", "videos", classId, studentId ?? ""], enabled: !!classId,
    queryFn: async () => {
      const rows = videoRows(await api.get<unknown>(path));
      return rows.filter(row => studentId ? row.student_id === studentId && row.class_id === classId : row.class_id === classId && !row.student_id);
    } });
  const upload = useMutation({
    mutationFn: async () => {
      if (!classId || !file || validateOfficeVideo(file)) throw new Error("반과 영상 파일을 확인하세요.");
      const body = new FormData(); body.append("video", file); body.append("class_id", classId);
      if (studentId) body.append("student_id", studentId);
      const response = rec(await api.postForm<unknown>(studentId ? "/videos/private" : "/videos/group", body), "영상 업로드");
      const video = rec(response.video, "업로드 영상");
      if (response.success !== true || typeof video.id !== "string") throw new ContractError("영상 업로드");
      const id = video.id;
      await qc.cancelQueries({ queryKey: ["oap", "videos", classId, studentId ?? ""], exact: true });
      const refreshed = await list.refetch({ throwOnError: true });
      if (!refreshed.data?.some(row => row.id === id)) throw new Error(`업로드 응답은 수신했으나 목록에서 ${id} 확인 불가. 재전송하지 마세요.`);
      return id;
    },
    onSuccess: id => {
      setMessage("영상 업로드 후 서버 목록에서 확인했습니다. 일지 저장/영상 연결은 별도입니다.");
      setFile(null); if (input.current) input.current.value = "";
      if (selected.length < 10) onChange([...new Set([...selected, id])]);
    },
    onError: error => {
      const status = (error as { status?: number }).status;
      if (!status || status >= 500 || status === 410) setUncertain(true);
      setMessage(`영상 업로드 결과: ${errMsg(error)}`);
    },
    onSettled: () => onBusy?.(false),
  });
  const remove = useMutation({
    mutationFn: async (video: VideoMeta) => {
      if (!canDelete?.(video)) throw new Error("이 영상을 삭제할 권한을 확인하지 못했습니다.");
      const response = rec(await api.delete<unknown>(`/videos/${encodeURIComponent(video.id)}`), "영상 삭제");
      if (response.success !== true) throw new ContractError("영상 삭제");
      const refreshed = await list.refetch({ throwOnError: true });
      if (refreshed.data?.some(row => row.id === video.id)) throw new Error("삭제 응답 후 목록에 영상이 남아 있습니다. 재전송하지 마세요.");
      return video.id;
    },
    onSuccess: id => { onChange(selected.filter(value => value !== id)); setMessage("영상 삭제 응답과 목록 제외를 확인했습니다."); },
    onError: error => setMessage(`영상 삭제 결과를 확인하세요. 자동 재전송하지 않습니다: ${errMsg(error)}`),
    onSettled: () => onBusy?.(false),
  });
  return <section className="oap-card" style={{ padding: 12 }}>
    <b>{studentId ? "개인 영상" : "반 공용 영상"} · 원본 전송</b>
    <fieldset disabled={disabled || upload.isPending || remove.isPending} style={{ border: 0, padding: 0 }}>
      <div className="oap-row">
        <input ref={input} type="file" accept=".mp4,.mov,.avi,.mkv,.webm,.m4v,video/*" aria-label="영상 파일 선택"
          onChange={event => { const next = event.target.files?.[0] ?? null; const error = next && validateOfficeVideo(next); setFile(error ? null : next); setMessage(error ?? ""); }} />
        <button disabled={!classId || !file || uncertain} onClick={() => {
          if (!file || !window.confirm(`${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)을 현재 표시된 ${studentId ? "회원 개인" : "반 공용"} 앨범에 원본 업로드합니다. 진행할까요?`)) return;
          onBusy?.(true); upload.mutate();
        }}>{upload.isPending ? "영상 전송 중…" : "영상 원본 업로드"}</button>
        <button disabled={!classId} onClick={() => list.refetch()}>영상 목록 다시 조회</button>
      </div>
      <QState q={list} />
      {!list.isLoading && !list.isError && classId && !list.data?.length && <div className="oap-empty">이 대상의 영상이 없습니다.</div>}
      <div className="oap-row">{list.data?.map(video => <div key={video.id}>
        <VideoPreview video={video} />
        <label><input type="checkbox" aria-label={`영상 선택 ${video.id}`} checked={selected.includes(video.id)}
          disabled={!selected.includes(video.id) && selected.length >= 10}
          onChange={event => onChange(event.target.checked ? [...selected, video.id] : selected.filter(id => id !== video.id))} /> 일지에 연결할 영상</label>
        {canDelete?.(video) && <button disabled={deleteLocked.includes(video.id)} onClick={() => {
          if (!window.confirm(`${video.caption || video.id} 영상을 원본 파일과 함께 삭제합니다. 이미 연결된 일지·앨범에도 영향을 줍니다. 삭제할까요?`)) return;
          setDeleteLocked(ids => [...ids, video.id]); onBusy?.(true); remove.mutate(video);
        }}>영상 삭제</button>}
      </div>)}</div>
    </fieldset>
    {message && <p role="status">{message}</p>}
    {uncertain && <p className="oap-err">결과 불명: 목록을 확인하고 중복 업로드하지 마세요. 자동 재전송하지 않습니다.</p>}
    <p className="oap-sub">파일당 최대 100MB. 기존 서버의 저장공간·권한·보관 정책을 따릅니다. PC 압축·변환은 하지 않습니다. 재생주소 미제공은 업로드 실패와 구분합니다.</p>
  </section>;
}
