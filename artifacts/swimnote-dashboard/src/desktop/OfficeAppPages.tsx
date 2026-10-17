import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useAuth } from "../contexts/AuthContext";
import { isAllowedOfficeImage } from "../../desktop/office-access.cts";
import "./OfficeAppPages.css";

export type OfficeAppKind = "attendance" | "album" | "communication" | "notices" | "staff" | "guardians" | "desktop-settings" | "makeup-assignment";

type ClassGroup = { id: string; name: string };
type Student = { id: string; name: string; class_group_id?: string | null; class_enrolled_at?: string | null; assigned_class_ids?: unknown; assignedClasses?: unknown; parent_name?: string | null; parent_phone?: string | null; parent_phone2?: string | null; parent_phone3?: string | null; parent_phone4?: string | null };
type AttStatus = "present" | "absent" | "late";
type AttRow = { student_id: string | null; status: AttStatus; session_type?: string | null };
type AttSaveResponse = { success: boolean; data: { id: string }; makeup_queued: boolean | null; makeup_skip_reason: string | null };
type Notice = { id: string; title: string; content: string; author_name?: string; is_pinned: boolean; created_at: string };
type ReadStats = { read_count: number; unread_count: number; total: number };
type Teacher = { id: string; name: string; email?: string; phone?: string; is_activated?: boolean; is_admin_self_teacher?: boolean };
type ParentRequest = { id: string; student_id: string; request_type: string; request_date: string | null; content: string | null; status: string; admin_note: string | null; created_at: string };
type PhotoMeta = { id: string; album_type: string; class_id: string | null; uploaded_by_name: string | null; caption: string | null; created_at: string; file_size: number | null; class_name: string | null; presigned_url?: string };
type RequestMessage = { id: string; request_id: string; sender_type: string; message_type?: string; content: string | null; created_at: string };
type PendingMakeup = { id: string; student_id: string; student_name?: string | null; original_class_group_name?: string | null; absence_date: string; status: string };
type EligibleClass = { id: string; name: string; schedule_days: string; schedule_time: string; capacity: number | null; instructor: string | null; teacher_user_id: string | null; current_members: number; available_slots: number; is_eligible: boolean };
type PhotoList = { photos: PhotoMeta[]; total: number };

class ContractError extends Error { constructor(where: string) { super(`${where}: 예상하지 못한 서버 응답입니다.`); } }
const arr = <T,>(v: unknown, where: string): T[] => { if (!Array.isArray(v)) throw new ContractError(where); return v as T[]; };
const rec = (v: unknown, where: string): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new ContractError(where); return v as Record<string, unknown>; };
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** Class membership from /students enrichment: assigned_class_ids column, assignedClasses[] and class_group_id. null = cannot be determined. */
const classIds = (s: Student): string[] | null => {
  const a = Array.isArray(s.assigned_class_ids) ? ids(s.assigned_class_ids) : null;
  const e = Array.isArray(s.assignedClasses) ? (s.assignedClasses as { id?: unknown }[]).map((c) => c.id).filter((x): x is string => typeof x === "string") : null;
  if (a === null && e === null && s.class_group_id === undefined) return null;
  return [...new Set([...(a ?? []), ...(e ?? []), ...(typeof s.class_group_id === "string" ? [s.class_group_id] : [])])];
};
const shift = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const errMsg = (e: unknown) => (e as { message?: string })?.message ?? "요청에 실패했습니다.";
const LABEL: Record<AttStatus, string> = { present: "출석", absent: "결석", late: "지각" };

function Blocked({ children }: { children: string }) { return <div className="oap-note" role="note">{children}</div>; }
function State({ q, empty }: { q: { isLoading: boolean; isError: boolean; error?: unknown; refetch: () => unknown }; empty?: string }) {
  if (q.isLoading) return <div className="oap-empty">불러오는 중…</div>;
  if (q.isError) return <div className="oap-empty"><span className="oap-err">{errMsg(q.error)} </span><button onClick={() => q.refetch()}>다시 시도</button></div>;
  return empty ? <div className="oap-empty">{empty}</div> : null;
}

function Attendance() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const [cls, setCls] = useState("");
  const [msg, setMsg] = useState("");
  const groups = useQuery<ClassGroup[]>({ queryKey: ["oap", "class-groups"], queryFn: async () => arr<ClassGroup>(await api.get<unknown>("/class-groups"), "GET /class-groups") });
  const students = useQuery<Student[]>({ queryKey: ["oap", "students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students?pool_all=true"), "GET /students?pool_all=true") });
  const gl = groups.data ?? [];
  useEffect(() => { if (!cls && gl.length) setCls(gl[0].id); }, [gl, cls]);
  const att = useQuery<AttRow[]>({ queryKey: ["oap", "attendance", cls, date], enabled: !!cls,
    queryFn: async () => arr<AttRow>(await api.get<unknown>(`/attendance?class_group_id=${encodeURIComponent(cls)}&date=${date}`), "GET /attendance") });
  const map = useMemo(() => {
    const m: Record<string, AttStatus> = {};
    (att.data ?? []).filter((r) => r.session_type == null || r.session_type === "regular").forEach((r) => { if (r.student_id) m[r.student_id] = r.status; });
    return m;
  }, [att.data]);
  const all = students.data ?? [];
  const unknownStudents = all.filter((s) => classIds(s) === null);
  const list = all.filter((s) => classIds(s)?.includes(cls) && (!s.class_enrolled_at || s.class_enrolled_at <= date));
  const save = useMutation({
    mutationFn: async (v: { student_id: string; status: AttStatus }) => {
      const r = await api.post<AttSaveResponse>("/attendance", { student_id: v.student_id, class_group_id: cls, date, status: v.status });
      if (!r || r.success !== true) throw new ContractError("POST /attendance");
      return r;
    },
    onSuccess: (r, v) => {
      setMsg(v.status === "absent" && r.makeup_queued === false ? `저장했습니다. 보강 대기는 생성되지 않았습니다(${r.makeup_skip_reason ?? "사유 없음"}).` : "저장했습니다.");
      qc.invalidateQueries({ queryKey: ["oap", "attendance"] }); qc.invalidateQueries({ queryKey: ["makeups"] });
    },
    onError: (e) => setMsg(errMsg(e)),
  });
  const change = (s: Student, status: AttStatus) => {
    if (map[s.id] === status) return;
    if (window.confirm(`${s.name} 학생을 ${date} ${LABEL[status]}(으)로 저장할까요?`)) save.mutate({ student_id: s.id, status });
  };
  return <>
    <div className="oap-row">
      <button onClick={() => setDate(shift(date, -1))}>이전</button>
      <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="날짜" />
      <button onClick={() => setDate(shift(date, 1))}>다음</button>
      <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="반 선택">{gl.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      {msg && <span className="oap-sub" role="status">{msg}</span>}
    </div>
    <State q={groups} /><State q={students} />
    {cls && <State q={att} />}
    {!groups.isLoading && !gl.length && <State q={{ isLoading: false, isError: false, refetch: () => 0 }} empty="등록된 반이 없습니다." />}
    {unknownStudents.length > 0 && <Blocked>{`반 소속을 확인할 수 없는 회원 ${unknownStudents.length}명은 목록에서 제외했습니다(서버 응답에 반 배정 정보 없음): ${unknownStudents.slice(0, 10).map((s) => s.name).join(", ")}`}</Blocked>}
    {cls && !students.isLoading && (list.length === 0
      ? <div className="oap-empty">이 반에 해당 날짜 기준 회원이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>회원</th><th>현재</th><th>변경</th></tr></thead><tbody>
        {list.map((s) => <tr key={s.id}><td>{s.name}</td><td>{map[s.id] ? LABEL[map[s.id]] : "미기록"}</td><td className="oap-row">
          {(["present", "late", "absent"] as AttStatus[]).map((k) => <button key={k} aria-pressed={map[s.id] === k} disabled={save.isPending} onClick={() => change(s, k)}>{LABEL[k]}</button>)}
        </td></tr>)}</tbody></table></div>)}
    <Blocked>결석 저장 시 서버가 보강 대기를 자동으로 생성합니다(별도 보강 생성 요청은 보내지 않습니다). 출결 저장은 서버 이벤트 기록을 남길 수 있으며 보강 지정, 소멸 처리는 이 화면에서 제공하지 않습니다.</Blocked>
  </>;
}

function Notices() {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery<Notice[]>({ queryKey: ["oap", "notices"], queryFn: async () => arr<Notice>(await api.get<unknown>("/notices"), "GET /notices") });
  const stats = useQuery<ReadStats>({ queryKey: ["oap", "notice-stats", open], enabled: !!open, queryFn: async () => { const o = rec(await api.get<unknown>(`/notices/${open}/read-stats`), "GET /notices/:id/read-stats"); if (typeof o.read_count !== "number" || typeof o.unread_count !== "number" || typeof o.total !== "number") throw new ContractError("read-stats"); return o as unknown as ReadStats; } });
  const items = q.data ?? [];
  return <>
    <div className="oap-row"><button disabled title="실제 발송 승인 대기">공지 등록</button></div>
    <Blocked>공지 등록은 푸시 알림이 발송될 수 있어 실제 발송 승인 전까지 사용할 수 없습니다. 사진 첨부, AI 작성, 공지 삭제도 사용할 수 없습니다.</Blocked>
    <State q={q} />
    {!q.isLoading && !q.isError && !items.length && <div className="oap-empty">등록된 공지사항이 없습니다.</div>}
    {items.map((n) => <div className="oap-card" key={n.id} style={{ padding: 12 }}>
      <button onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}>{n.is_pinned ? "[고정] " : ""}{n.title}</button>
      <span className="oap-sub"> {n.author_name ?? ""} {n.created_at?.slice(0, 10)}</span>
      {open === n.id && <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{n.content}
        <p className="oap-sub">{stats.isLoading ? "읽음 현황 조회 중…" : stats.data ? `읽음 ${stats.data.read_count} / 미읽음 ${stats.data.unread_count} / 전체 ${stats.data.total}` : "읽음 현황을 불러오지 못했습니다."}</p></div>}
    </div>)}
  </>;
}

function Guardians() {
  const q = useQuery<Student[]>({ queryKey: ["oap", "students-contacts"], queryFn: async () => {
    const rows = arr<Student>(await api.get<unknown>("/students?pool_all=true"), "GET /students?pool_all=true");
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.name !== "string") throw new ContractError("GET /students?pool_all=true"); });
    return rows;
  } });
  const [s, setS] = useState("");
  const rows = (q.data ?? []).filter((r) => !s || r.name.includes(s) || (r.parent_name ?? "").includes(s));
  return <>
    <input placeholder="회원 또는 보호자 이름 검색" value={s} onChange={(e) => setS(e.target.value)} style={{ maxWidth: 260 }} />
    <Blocked>회원 등록 시 입력된 연락처 정보입니다. 앱 계정과 연결이 확인된 관계가 아니며, 추가 연락처는 보호자와 짝지어 표시하지 않습니다. 계정 연결 확인과 연결 작업은 안전한 연결 방식이 준비될 때까지 보류됩니다.</Blocked>
    <State q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">표시할 연락처가 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>회원</th><th>등록된 보호자명</th><th>등록된 연락처</th><th>앱 계정 연결</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.parent_name || "-"}</td>
          <td>{[r.parent_phone, r.parent_phone2, r.parent_phone3, r.parent_phone4].filter(Boolean).join(" / ") || "-"}</td><td>연결 확인 보류</td></tr>)}</tbody></table></div>)}
  </>;
}

function Staff() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "";
  const q = useQuery<Teacher[]>({ queryKey: ["oap", "teachers"], queryFn: async () => arr<Teacher>(await api.get<unknown>("/teachers"), "GET /teachers") });
  const rows = q.data ?? [];
  return <>
    <State q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">등록된 강사가 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>이름</th><th>이메일</th><th>연락처</th><th>상태</th></tr></thead><tbody>
        {rows.map((t) => <tr key={t.id}><td>{t.name}{t.is_admin_self_teacher ? " (관리자 겸임)" : ""}</td><td>{t.email ?? "-"}</td><td>{t.phone ?? "-"}</td><td>{t.is_activated ? "활성" : "미활성"}</td></tr>)}</tbody></table></div>)}
    <Blocked>{`강사 추가, 권한 변경, 초대, 비밀번호 변경은 승인 전까지 사용할 수 없습니다.${role ? ` (현재 권한: ${role})` : ""}`}</Blocked>
  </>;
}

function Communication() {
  const [sel, setSel] = useState<string | null>(null);
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
  const open = (id: string) => {
    if (sel === id) { setSel(null); return; }
    if (window.confirm("대화를 열면 학부모가 보낸 메시지가 읽음으로 처리됩니다. 열까요?")) setSel(id);
  };
  const rows = q.data ?? [];
  return <>
    <State q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">학부모 요청이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>접수일</th><th>유형</th><th>요청일</th><th>내용</th><th>상태</th><th>관리자 메모</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.created_at?.slice(0, 10) ?? "-"}</td><td>{r.request_type}</td><td>{r.request_date ?? "-"}</td><td>{r.content ?? "-"}</td><td>{r.status}</td><td>{r.admin_note ?? "-"}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => open(r.id)}>대화 열기</button></td></tr>)}</tbody></table></div>)}
    {sel && <div className="oap-card" style={{ padding: 12 }}>
      <State q={m} />
      {!m.isLoading && !m.isError && (m.data && m.data.length > 0 ? m.data.map((x) => <p key={x.id} style={{ margin: "4px 0" }}><b>{x.sender_type}</b> {x.content ?? ""} <span className="oap-sub">{x.created_at?.slice(0, 16).replace("T", " ")}</span></p>) : <div className="oap-empty">대화 내역이 없습니다.</div>)}
    </div>}
    <div className="oap-row"><button disabled>답장</button><button disabled>상태 변경</button></div>
    <Blocked>답장, 요청 상태 변경, 알림 발송은 승인 전까지 사용할 수 없습니다.</Blocked>
  </>;
}

function PhotoThumb({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url) return <span>이미지 주소 없음</span>;
  if (!isAllowedOfficeImage(url)) return <span>허용되지 않은 이미지 출처</span>;
  if (failed) return <span>이미지를 불러오지 못했습니다</span>;
  return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" crossOrigin={undefined} onError={() => setFailed(true)} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4 }} />;
}

function Album() {
  const q = useQuery<PhotoList>({ queryKey: ["oap", "photos"], queryFn: async () => {
    const o = rec(await api.get<unknown>("/photos/teacher-all?scope=group"), "GET /photos/teacher-all");
    if (!Array.isArray(o.photos)) throw new ContractError("GET /photos/teacher-all");
    return { photos: o.photos as PhotoMeta[], total: typeof o.total === "number" ? o.total : o.photos.length };
  } });
  const rows = q.data?.photos ?? [];
  return <>
    <State q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">등록된 사진이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>이미지</th><th>업로드일</th><th>반</th><th>업로더</th><th>설명</th></tr></thead><tbody>
        {rows.map((p) => <tr key={p.id}><td><PhotoThumb url={p.presigned_url} /></td><td>{p.created_at?.slice(0, 10) ?? "-"}</td><td>{p.class_name ?? "-"}</td><td>{p.uploaded_by_name ?? "-"}</td><td>{p.caption ?? "-"}</td></tr>)}</tbody></table></div>)}
    <Blocked>사진은 서버가 발급한 임시 주소로 허용된 출처에서만 표시하며 주소는 노출하지 않습니다. 다운로드, 업로드, 삭제, 공유는 사용할 수 없습니다.</Blocked>
  </>;
}

function MakeupAssignment() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "";
  const [sel, setSel] = useState<string | null>(null);
  const [cls, setCls] = useState("");
  const [date, setDate] = useState(today());
  const pending = useQuery<PendingMakeup[]>({ queryKey: ["oap", "makeups-pending"], queryFn: async () => {
    const rows = arr<PendingMakeup>(await api.get<unknown>("/admin/makeups/pending"), "GET /admin/makeups/pending");
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.absence_date !== "string") throw new ContractError("GET /admin/makeups/pending"); });
    return rows;
  } });
  const eligible = useQuery<EligibleClass[]>({ queryKey: ["oap", "makeups-eligible-classes"], enabled: !!sel, queryFn: async () => {
    const rows = arr<EligibleClass>(await api.get<unknown>("/admin/makeups/eligible-classes"), "GET /admin/makeups/eligible-classes");
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.available_slots !== "number") throw new ContractError("GET /admin/makeups/eligible-classes"); });
    return rows;
  } });
  const rows = pending.data ?? [];
  const target = rows.find((r) => r.id === sel);
  const ec = (eligible.data ?? []).find((c) => c.id === cls);
  return <>
    <State q={pending} />
    {!pending.isLoading && !pending.isError && (rows.length === 0 ? <div className="oap-empty">보강 대기 회원이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>회원</th><th>원반</th><th>결석일</th><th>상태</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.student_name ?? "-"}</td><td>{r.original_class_group_name ?? "-"}</td><td>{r.absence_date}</td><td>{r.status}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => { setSel(sel === r.id ? null : r.id); setCls(""); }}>배정 선택</button></td></tr>)}</tbody></table></div>)}
    {target && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="oap-row"><b>{target.student_name ?? "-"}</b><span className="oap-sub">결석일 {target.absence_date}</span>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="보강 날짜" /></div>
      <State q={eligible} />
      {!eligible.isLoading && !eligible.isError && ((eligible.data ?? []).length === 0 ? <div className="oap-empty">보강 가능한 반이 없습니다.</div>
        : <table><thead><tr><th /><th>반</th><th>시간</th><th>강사</th><th>인원</th></tr></thead><tbody>
          {(eligible.data ?? []).map((c) => <tr key={c.id}><td><input type="radio" name="mk-class" disabled={!c.is_eligible} checked={cls === c.id} onChange={() => setCls(c.id)} aria-label={c.name} /></td>
            <td>{c.name}</td><td>{c.schedule_days} {c.schedule_time}</td><td>{c.instructor ?? "-"}</td><td>{c.current_members}/{c.capacity ?? "제한 없음"} (여유 {c.available_slots >= 999 ? "제한 없음" : c.available_slots})</td></tr>)}</tbody></table>)}
      {ec && <div className="oap-sub" role="status">{`미리보기: ${target.student_name ?? "회원"} → ${ec.name} (${ec.schedule_days} ${ec.schedule_time}), ${date}`}</div>}
      <div className="oap-row"><button disabled title="서버 권한 없음">보강 지정</button></div>
    </div>}
    <Blocked>{`보강 지정은 서버 PATCH /admin/makeups/:id/assign 가 super_admin 만 허용하므로 pool_admin 권한으로 제출할 수 없습니다. 서버 권한 변경 없이 우회하지 않습니다.${role ? ` (현재 권한: ${role})` : ""} 대기 목록 조회, 반 선택, 미리보기만 제공합니다.`}</Blocked>
  </>;
}

function DesktopSettings() {
  const bridge = window.officeDesktop;
  const [loginId, setLoginId] = useState("");
  const [remember, setRemember] = useState(false);
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    bridge?.readLoginPreferences().then((p) => { if (live) { setLoginId(p.loginId); setRemember(p.remember); setReady(true); } }).catch(() => live && setMsg("설정을 읽지 못했습니다."));
    return () => { live = false; };
  }, [bridge]);
  if (!bridge) return <Blocked>Desktop 앱에서만 로그인 설정을 사용할 수 있습니다.</Blocked>;
  const save = async () => {
    if (!window.confirm("로그인 편의 설정을 저장할까요? 비밀번호는 저장되지 않습니다.")) return;
    try { const r = await bridge.saveLoginPreferences({ loginId: remember ? loginId.trim() : "", remember }); setMsg(r.ok ? "저장했습니다." : "저장하지 못했습니다."); }
    catch { setMsg("저장하지 못했습니다."); }
  };
  return <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
    <input value={loginId} disabled={!ready} onChange={(e) => setLoginId(e.target.value)} placeholder="로그인 아이디" aria-label="로그인 아이디" />
    <label><input type="checkbox" checked={remember} disabled={!ready} onChange={(e) => setRemember(e.target.checked)} /> 로그인 아이디 기억</label>
    <div className="oap-row"><button onClick={save} disabled={!ready}>저장</button>{msg && <span className="oap-sub" role="status">{msg}</span>}</div>
  </div>;
}

const TITLES: Record<OfficeAppKind, [string, string]> = {
  attendance: ["출결 관리", "날짜와 반을 선택해 출결을 확인하고 저장합니다."],
  album: ["앨범", "전체 앨범 사진 정보 조회"],
  communication: ["소통", "학부모 요청 조회"],
  notices: ["공지사항", "공지 조회와 읽음 현황"],
  staff: ["강사 관리", "강사 목록 조회"],
  guardians: ["보호자", "회원 등록 연락처 조회"],
  "desktop-settings": ["Desktop 설정", "로그인 편의 설정"],
  "makeup-assignment": ["보강 지정", "보강 대기 회원과 배정 가능 반 조회"],
};

export function OfficeAppPage({ kind }: { kind: OfficeAppKind }) {
  const [t, d] = TITLES[kind];
  return <div className="oap" data-testid={`office-app-${kind}`}>
    <div><h1>{t}</h1><p className="oap-sub">{d}</p></div>
    {kind === "attendance" && <Attendance />}
    {kind === "album" && <Album />}
    {kind === "communication" && <Communication />}
    {kind === "notices" && <Notices />}
    {kind === "staff" && <Staff />}
    {kind === "guardians" && <Guardians />}
    {kind === "desktop-settings" && <DesktopSettings />}
    {kind === "makeup-assignment" && <MakeupAssignment />}
  </div>;
}
export default OfficeAppPage;
