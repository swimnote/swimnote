import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useAuth } from "../contexts/AuthContext";
import { Thumb, type PhotoMeta } from "./OfficeAlbumPanel";
import { OfficeVideoPicker } from "./OfficeVideoPicker";
import { attachOfficeDiaryVideos, OfficeDiaryVideos } from "./OfficeDiaryVideos";
import { Blocked, ContractError, QState, arr, classIdsOf, errMsg, kstToday, rec, type ClassGroup, type Student } from "./OfficeAppShared";
import "./OfficeAppPages.css";

type SavedDiary = { success: boolean; diary_id: string; student_notes: { id: string; student_id: string; note_content: string }[] };

/** Existing manual/AI diary DTOs; paid draft generation and saving remain separate, confirmed operations. */
export function OfficeDiaryComposer({ onSaved }: { onSaved?: (diaryId: string) => void }) {
  const qc = useQueryClient();
  const { state: auth } = useAuth();
  const poolId = auth.status === "authenticated" ? auth.user.swimming_pool_id : null;
  const [aiText, setAiText] = useState("");
  const [aiReq, setAiReq] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [sPicked, setSPicked] = useState<Record<string, string[]>>({});
  const [vPicked, setVPicked] = useState<string[]>([]);
  const [svPicked, setSVPicked] = useState<Record<string, string[]>>({});
  const [showVideos, setShowVideos] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [savedPartial, setSavedPartial] = useState<{ diaryId: string; classId: string; notes: SavedDiary["student_notes"] } | null>(null);
  const [openStu, setOpenStu] = useState<string | null>(null);
  const [aiMatches, setAiMatches] = useState<Record<string, unknown>[]>([]);
  const [showPhotos, setShowPhotos] = useState(false);
  const [cls, setCls] = useState("");
  const [date, setDate] = useState(kstToday());
  const [common, setCommon] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState("");
  const groups = useQuery<ClassGroup[]>({ queryKey: ["oap", "class-groups"], queryFn: async () => arr<ClassGroup>(await api.get<unknown>("/class-groups"), "GET /class-groups") });
  const students = useQuery<Student[]>({ queryKey: ["oap", "students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students"), "GET /students") });
  const classStudents = useMemo(() => (students.data ?? []).filter((s) => !!cls && classIdsOf(s)?.includes(cls)), [students.data, cls]);
  const unknown = (students.data ?? []).filter((s) => classIdsOf(s) === null).length;
  const photos = useQuery<PhotoMeta[]>({ queryKey: ["oap", "photos"], enabled: showPhotos, queryFn: async () => {
    const o = rec(await api.get<unknown>("/photos/teacher-all?scope=group"), "GET /photos/teacher-all");
    return arr<PhotoMeta>(o.photos, "GET /photos/teacher-all");
  } });
  const sPhotos = useQuery<PhotoMeta[]>({ queryKey: ["oap", "photos", "private", openStu], enabled: !!openStu, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/photos/private/${encodeURIComponent(openStu as string)}?limit=200`), "GET /photos/private/:id");
    return arr<PhotoMeta>(o.photos, "GET /photos/private/:id");
  } });
  const gen = useMutation({
    mutationFn: async () => {
      const list = classStudents.map((s) => ({ ref: s.id, name: s.name }));
      const requestId = crypto.randomUUID();
      const o = rec(await api.post<unknown>("/v1/teacher-diary/generate", {
        contract_version: "1.0", request_id: requestId, schema_version: "1.0", feature: "teacher_diary", locale: "ko-KR",
        input: { text: aiText.trim() },
        context: { pool_id: poolId, class_id: cls, lesson_date: date, student_refs: list.map((x) => x.ref), students: list },
      }), "POST /v1/teacher-diary/generate");
      const r = rec(o.result, "teacher-diary result");
      if (typeof r.common !== "string" || !Array.isArray(r.students)) throw new ContractError("teacher-diary result");
      if (o.request_id !== requestId) throw new ContractError("teacher-diary request_id");
      const cm = Array.isArray(o.curriculum_matches) ? (o.curriculum_matches as unknown[]).filter((m): m is Record<string, unknown> => !!m && typeof m === "object").map((m) => ({
        student_ref: typeof m.student_ref === "string" ? m.student_ref : "", candidate_id: typeof m.candidate_id === "string" ? m.candidate_id : "", match_token: typeof m.match_token === "string" ? m.match_token : "",
        curriculum_version_id: typeof m.curriculum_version_id === "string" ? m.curriculum_version_id : "", confidence: typeof m.confidence === "number" ? m.confidence : 0,
        match_status: typeof m.match_status === "string" ? m.match_status : "", matching_algorithm_version: typeof m.matching_algorithm_version === "string" ? m.matching_algorithm_version : "" })).filter((m) => m.student_ref && m.candidate_id && m.match_token) : [];
      return { requestId, common: r.common, students: r.students as { student_ref?: unknown; content?: unknown }[], cm };
    },
    onSuccess: (r) => {
      setCommon(r.common);
      const n: Record<string, string> = {};
      r.students.forEach((x) => { if (typeof x.student_ref === "string" && typeof x.content === "string") n[x.student_ref] = x.content; });
      setNotes(n); setAiReq(r.requestId); setAiMatches(r.cm);
      setAiMsg("초안이 채워졌습니다. 아직 저장되지 않았습니다. 내용을 확인하고 수정한 뒤 저장하세요.");
    },
    onError: (e) => setAiMsg(`AI 생성 결과를 확인하세요(요청이 서버에 도달했다면 사용량이 차감됐을 수 있습니다, 확인 불가): ${errMsg(e)}`),
  });
  const runAi = () => {
    if (!cls || !aiText.trim() || !poolId || classStudents.length === 0 || gen.isPending) return;
    if (window.confirm("AI 일지 초안을 생성합니다. 유료 AI 호출이며 수영장 플랜의 AI 사용량이 차감될 수 있습니다. 이 화면은 남은 사용량이나 한도를 조회하지 못하며, 서버가 한도를 초과로 거절하면 오류로 표시됩니다. 현재 입력된 공통 내용과 회원 메모는 초안으로 덮어써집니다. 생성할까요?")) gen.mutate();
  };
  const save = useMutation({
    mutationFn: async (): Promise<SavedDiary & { attachNote: string }> => {
      const student_notes = classStudents.map((s) => ({ student_id: s.id, note_content: (notes[s.id] ?? "").trim(), ...((sPicked[s.id]?.length ?? 0) + (svPicked[s.id]?.length ?? 0) > 0 ? { has_media: true } : {}) })).filter((n) => n.note_content || (n as { has_media?: boolean }).has_media);
      const o = rec(await api.post<unknown>("/diaries", { class_group_id: cls, lesson_date: date, common_content: common.trim(), student_notes, ...(picked.length || vPicked.length ? { has_group_media: true } : {}), ...(aiReq ? { ai_request_id: aiReq } : {}), ...(aiReq && aiMatches.length ? { curriculum_matches: aiMatches } : {}), ...(force ? { force_suspicious_save: true } : {}) }), "POST /diaries");
      if (o.success !== true || typeof o.diary_id !== "string" || !Array.isArray(o.student_notes)) throw new ContractError("POST /diaries");
      const saved = o as unknown as SavedDiary;
      let attachNote = "";
      if (picked.length) {
        try {
          const a = rec(await api.post<unknown>("/photos/diary-attach", { diary_id: saved.diary_id, photo_ids: picked, sort_orders: picked.map((_, i) => i) }), "POST /photos/diary-attach");
          if (a.success !== true || typeof a.failed !== "number" || a.failed > 0 || a.attached !== picked.length) attachNote = `사진 연결 일부 실패/결과 불명(요청 ${picked.length}, 연결 ${String(a.attached)}, 실패 ${String(a.failed)})`;
        } catch (e) { attachNote = `일지는 저장됐지만 사진 연결에 실패했습니다: ${errMsg(e)}`; }
      }
      for (const [sid, pids] of Object.entries(sPicked)) {
        if (!pids.length) continue;
        const note = saved.student_notes.find((n) => n.student_id === sid);
        if (!note) { attachNote += ` 회원 사진 연결 실패: 서버가 해당 회원 노트를 반환하지 않았습니다(${classStudents.find((x) => x.id === sid)?.name ?? sid}).`; continue; }
        try {
          const a = rec(await api.post<unknown>("/photos/note-attach", { note_id: note.id, photo_ids: pids, sort_orders: pids.map((_, i) => i) }), "POST /photos/note-attach");
          if (a.success !== true || typeof a.failed !== "number" || a.failed > 0 || a.attached !== pids.length) attachNote += ` ${classStudents.find((x) => x.id === sid)?.name ?? sid} 사진 연결 일부 실패/결과 불명(요청 ${pids.length}, 연결 ${String(a.attached)}, 실패 ${String(a.failed)}).`;
        } catch (e) { attachNote += ` ${classStudents.find((x) => x.id === sid)?.name ?? sid} 사진 연결 실패: ${errMsg(e)}.`; }
      }
      if (vPicked.length) {
        try { await attachOfficeDiaryVideos({ diaryId: saved.diary_id, classId: cls }, vPicked); }
        catch (e) { attachNote += ` 반 영상 연결 실패/결과 불명: ${errMsg(e)}.`; }
      }
      for (const [sid, vids] of Object.entries(svPicked)) {
        if (!vids.length) continue;
        const note = saved.student_notes.find(n => n.student_id === sid);
        if (!note) { attachNote += ` 회원 영상 연결 실패: 서버가 ${classStudents.find(s => s.id === sid)?.name ?? sid} 노트를 반환하지 않았습니다.`; continue; }
        try { await attachOfficeDiaryVideos({ diaryId: saved.diary_id, classId: cls, noteId: note.id, studentId: sid }, vids); }
        catch (e) { attachNote += ` ${classStudents.find(s => s.id === sid)?.name ?? sid} 영상 연결 실패/결과 불명: ${errMsg(e)}.`; }
      }
      return { ...saved, attachNote: attachNote.trim() };
    },
    onSuccess: (r) => {
      setMsg(`일지 ${r.diary_id} 저장. ${r.attachNote || "사진 연결은 서버 응답, 영상 연결은 응답과 대상 일지 재조회로 확인했습니다."}`); setCommon(""); setNotes({}); setForce(false); setAiReq(null); setAiMatches([]); setAiMsg(""); setPicked([]); setSPicked({}); setVPicked([]); setSVPicked({}); setOpenStu(null);
      if (r.attachNote) setSavedPartial({ diaryId: r.diary_id, classId: cls, notes: r.student_notes });
      qc.invalidateQueries({ queryKey: ["oap", "diaries"] }); qc.invalidateQueries({ queryKey: ["diaries"] });
      if (!r.attachNote) onSaved?.(r.diary_id);
    },
    onError: (e) => setMsg(`저장 결과를 확인하세요: ${errMsg(e)}`),
  });
  const hasContent = common.trim() || Object.values(notes).some((v) => v.trim()) || picked.length > 0 || Object.values(sPicked).some((v) => v.length > 0) || vPicked.length > 0 || Object.values(svPicked).some(v => v.length > 0);
  const submit = () => {
    if (!cls || !hasContent || save.isPending || videoBusy || savedPartial) return;
    const g = groups.data?.find((x) => x.id === cls)?.name ?? "";
    if (window.confirm(`${g} ${date} 일지를 저장합니다. 같은 반과 날짜에 이미 일지가 있으면 저장되지 않습니다. 진행할까요?`)) save.mutate();
  };
  return <div className="oap" data-testid="office-diary-new">
    <div><h1>일지 작성</h1><p className="oap-sub">반과 수업일을 선택해 공통 내용과 회원별 메모를 직접 입력합니다.</p></div>
    <fieldset disabled={save.isPending || gen.isPending || videoBusy || !!savedPartial} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
    <QState q={groups} /><QState q={students} />
    <div className="oap-row">
      <select value={cls} onChange={(e) => { setCls(e.target.value); setNotes({}); setAiReq(null); setAiMatches([]); setSPicked({}); setPicked([]); setSVPicked({}); setVPicked([]); setOpenStu(null); }} aria-label="반 선택"><option value="">반 선택</option>{(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <input type="date" value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setAiReq(null); setAiMatches([]); } }} aria-label="수업일" />
    </div>
    <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <b>AI 초안 (선택)</b>
      <textarea rows={2} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="오늘 수업 내용을 간단히 입력" />
      <div className="oap-row"><button disabled={!cls || !aiText.trim() || !poolId || classStudents.length === 0 || gen.isPending} onClick={runAi}>{gen.isPending ? "생성 중…" : "AI 초안 생성 (유료)"}</button>{aiMsg && <span className="oap-sub" role="status">{aiMsg}</span>}</div>
      {!poolId && <span className="oap-err">수영장 정보가 없어 AI를 사용할 수 없습니다.</span>}
    </div>
    <textarea rows={4} value={common} onChange={(e) => setCommon(e.target.value)} placeholder="공통 수업 내용" />
    {cls && (classStudents.length === 0 ? <div className="oap-empty">이 반에서 확인된 회원이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>회원</th><th>메모</th></tr></thead><tbody>
        {classStudents.map((s) => <tr key={s.id}><td>{s.name}<br /><button onClick={() => setOpenStu(openStu === s.id ? null : s.id)} aria-pressed={openStu === s.id}>{`개인 사진 (${sPicked[s.id]?.length ?? 0}) · 영상 (${svPicked[s.id]?.length ?? 0})`}</button></td><td><textarea rows={2} style={{ width: "100%" }} value={notes[s.id] ?? ""} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} aria-label={`${s.name} 메모`} /></td></tr>)}</tbody></table></div>)}
    {openStu && <div className="oap-card" style={{ padding: 12 }}><b>{classStudents.find((x) => x.id === openStu)?.name} 개인 앨범</b><QState q={sPhotos} />
      {sPhotos.data && (sPhotos.data.length === 0 ? <div className="oap-empty">이 회원의 개인 사진이 없습니다. 앨범 화면에서 먼저 업로드하세요.</div>
        : <div className="oap-row">{sPhotos.data.map((p) => <label key={p.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}><Thumb url={p.presigned_url} /><input type="checkbox" checked={(sPicked[openStu] ?? []).includes(p.id)} onChange={(e) => { const cur = sPicked[openStu] ?? []; setSPicked({ ...sPicked, [openStu]: e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id) }); }} aria-label="개인 사진 선택" /></label>)}</div>)}</div>}
    <div className="oap-row"><button onClick={() => setShowPhotos(!showPhotos)} aria-pressed={showPhotos}>{`앨범에서 사진 선택 (${picked.length}장)`}</button></div>
    {showPhotos && <><QState q={photos} />{photos.data && (photos.data.length === 0 ? <div className="oap-empty">앨범에 사진이 없습니다. 앨범 화면에서 먼저 업로드하세요.</div>
      : <div className="oap-row">{photos.data.map((p) => <label key={p.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}><Thumb url={p.presigned_url} /><input type="checkbox" checked={picked.includes(p.id)} disabled={!picked.includes(p.id) && picked.length >= 20} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} aria-label="사진 선택" /></label>)}</div>)}</>}
    <div className="oap-row"><button disabled={!cls} onClick={() => setShowVideos(!showVideos)}>{`반 영상 선택 (${vPicked.length}개)`}</button></div>
    {showVideos && cls && <OfficeVideoPicker key={cls} classId={cls} selected={vPicked} onChange={setVPicked} onBusy={setVideoBusy} />}
    {openStu && cls && <OfficeVideoPicker key={`${cls}:${openStu}`} classId={cls} studentId={openStu} selected={svPicked[openStu] ?? []} onChange={ids => setSVPicked({ ...svPicked, [openStu]: ids })} onBusy={setVideoBusy} />}
    {unknown > 0 && <Blocked>{`반 소속을 확인할 수 없는 회원 ${unknown}명은 목록에서 제외했습니다.`}</Blocked>}
    <div className="oap-row">
      <label><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> 비슷한 회원 메모 경고를 확인했으며 그대로 저장</label>
      <button disabled={!cls || !hasContent || save.isPending || videoBusy || !!savedPartial} onClick={submit}>{save.isPending ? "저장 중…" : "일지 저장"}</button>
      {msg && <span className="oap-sub" role="status">{msg}</span>}
    </div>
    </fieldset>
    {savedPartial && <><Blocked>일지는 이미 저장됐습니다. 사진·영상의 일부 실패를 일지 전체 완료로 표시하지 않으며 같은 일지를 재저장하지 않습니다. 아래 영상 목록과 기존 일지 상세에서 결과를 확인하세요.</Blocked>
      <OfficeDiaryVideos diaryId={savedPartial.diaryId} classId={savedPartial.classId} notes={savedPartial.notes} />
      <button onClick={() => { setSavedPartial(null); setMsg(""); }}>결과를 확인했으며 새 일지 입력</button></>}
    <Blocked>AI 초안은 자동 저장되지 않습니다. 공용 사진·영상은 일지에, 개인 사진·영상은 서버가 반환한 해당 회원 노트에 각각 연결합니다. 영상은 원본 100MB 이하, 대상별 최대 10개이며 이전 영상 연결이 변경될 수 있습니다. 사진 응답과 영상 updated 응답을 구분합니다. AI 교육과정 매칭은 기존 앱 필드 그대로 전달합니다.</Blocked>
  </div>;
}
