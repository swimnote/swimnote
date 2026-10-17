import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useAuth } from "../contexts/AuthContext";
import { MakeupPanel } from "./OfficeMakeupPanel";
import { ParentRequestsPanel } from "./OfficeParentRequestsPanel";
import { NoticesPanel } from "./OfficeNoticesPanel";
import { AlbumPanel } from "./OfficeAlbumPanel";
import { GuardianContacts } from "./OfficeGuardianContacts";
import { StaffPanel } from "./OfficeStaffPanel";
import { OfficeDiaryComposer } from "./OfficeDiaryComposer";
import { OfficeTeacherGrowthReports } from "./OfficeTeacherGrowthReports";
import { OfficeTeacherHome } from "./OfficeTeacherHome";
import type { OfficeRole } from "./OfficeAppShared";
import "./OfficeAppPages.css";

export type OfficeAppKind = "attendance" | "album" | "communication" | "notices" | "staff" | "guardians" | "desktop-settings" | "makeup-assignment" | "diary-new" | "teacher-growth-reports";

type ClassGroup = { id: string; name: string };
type Student = { id: string; name: string; class_group_id?: string | null; class_enrolled_at?: string | null; assigned_class_ids?: unknown; assignedClasses?: unknown; parent_name?: string | null; parent_phone?: string | null; parent_phone2?: string | null; parent_phone3?: string | null; parent_phone4?: string | null };
type AttStatus = "present" | "absent" | "late";
type AttRow = { student_id: string | null; status: AttStatus; session_type?: string | null };
type AttSaveResponse = { success: boolean; data: { id: string }; makeup_queued: boolean | null; makeup_skip_reason: string | null };

class ContractError extends Error { constructor(where: string) { super(`${where}: 예상하지 못한 서버 응답입니다.`); } }
const arr = <T,>(v: unknown, where: string): T[] => { if (!Array.isArray(v)) throw new ContractError(where); return v as T[]; };
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
  const students = useQuery<Student[]>({ queryKey: ["oap", "students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students"), "GET /students") });
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
  album: ["앨범", "사진 조회, 업로드, 삭제"],
  communication: ["소통", "학부모 요청, 대화, 답장, 상태 변경"],
  notices: ["공지사항", "공지 조회, 등록, 수정, 삭제"],
  staff: ["강사 관리", "강사 목록 조회"],
  guardians: ["보호자", "회원 등록 연락처 조회"],
  "desktop-settings": ["Desktop 설정", "로그인 편의 설정"],
  "diary-new": ["일지 작성", ""],
  "teacher-growth-reports": ["성장리포트 검수", ""],
  "makeup-assignment": ["보강 지정", "보강 대기, 배정, 완료, 취소, 소멸"],
};

export { OfficeTeacherHome, OfficeDiaryComposer, OfficeTeacherGrowthReports };
export { OfficeCurriculumReview } from "./OfficeCurriculumReview";
export { OfficeTeacherDiaryFeed } from "./OfficeTeacherDiaryFeed";
export function OfficeAppPage({ kind, role }: { kind: OfficeAppKind; role?: OfficeRole }) {
  const { state } = useAuth();
  const userRole = state.status === "authenticated" ? state.user.role : "";
  const eff: OfficeRole | null = role ?? (userRole === "teacher" ? "teacher" : userRole === "pool_admin" ? "pool_admin" : null);
  if (kind === "diary-new") return <OfficeDiaryComposer />;
  if (kind === "teacher-growth-reports") return <OfficeTeacherGrowthReports />;
  const [t, d] = TITLES[kind];
  return <div className="oap" data-testid={`office-app-${kind}`}>
    <div><h1>{t}</h1><p className="oap-sub">{d}</p></div>
    {kind === "attendance" && <Attendance />}
    {kind === "album" && <AlbumPanel />}
    {kind === "communication" && <ParentRequestsPanel />}
    {kind === "notices" && <NoticesPanel canManage={eff === "pool_admin"} />}
    {kind === "staff" && <StaffPanel canManage={eff === "pool_admin"} />}
    {kind === "guardians" && <GuardianContacts canEdit={eff === "pool_admin"} />}
    {kind === "desktop-settings" && <DesktopSettings />}
    {kind === "makeup-assignment" && (eff ? <MakeupPanel role={eff} /> : <div className="oap-empty">pool_admin 또는 teacher 권한이 필요합니다.</div>)}
  </div>;
}
export default OfficeAppPage;
