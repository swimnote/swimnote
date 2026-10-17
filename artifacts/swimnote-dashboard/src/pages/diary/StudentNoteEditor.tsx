import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

/** Existing app note endpoint, shared by Web and OFFICE; author/Pool checks stay on the server. */
export function StudentNoteEditor({ noteId, content, onSaved }: {
  noteId: string; content: string; onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const response = await api.put<{ success: boolean }>(`/diaries/student-notes/${encodeURIComponent(noteId)}`, { note_content: draft.trim() });
      if (response?.success !== true) throw new Error("회원별 일지의 저장 결과를 확인하지 못했습니다.");
    },
    onSuccess: async () => { await onSaved(); setEditing(false); setError(""); },
    onError: (e: Error) => setError(e?.message ?? "저장 결과를 확인하지 못했습니다."),
  });
  return <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
    {editing ? <>
      <textarea aria-label="회원별 일지 내용" rows={3} value={draft} disabled={save.isPending}
        onChange={event => setDraft(event.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
      <button disabled={save.isPending || !draft.trim()} onClick={() => {
        if (window.confirm("선택한 회원의 개별 일지 내용을 수정합니다. 진행하시겠습니까?")) save.mutate();
      }}>개별 내용 저장</button>
      <button disabled={save.isPending} onClick={() => { setEditing(false); setError(""); }}>취소</button>
    </> : <><div>{content || "내용 없음"}</div><button onClick={() => { setDraft(content); setError(""); setEditing(true); }}>개별 내용 수정</button></>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
