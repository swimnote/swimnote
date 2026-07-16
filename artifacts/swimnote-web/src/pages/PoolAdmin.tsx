import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Member {
  id: string; name: string; phone: string; birth_date?: string | null;
  memo?: string | null; class_id?: string | null; class_name?: string | null; created_at: string;
}
interface Class {
  id: string; name: string; instructor: string; schedule: string;
  capacity?: number | null; member_count?: number | null;
}
interface Notice {
  id: string; title: string; content: string; created_at: string;
}
interface Attendance {
  id: string; member_name: string; member_id: string; date: string;
  status: "present" | "absent" | "late";
}
interface Teacher {
  id: string; name: string; email: string; phone?: string | null;
  is_active: boolean; created_at: string;
}
interface Holiday {
  id: string; date: string; reason?: string | null; confirmed: boolean;
}
interface Makeup {
  id: string; member_name: string; original_date: string; status: string;
  class_name?: string | null; created_at: string;
}
interface Revenue {
  month: string; total: number; member_count: number;
}

// ─── Menu config ──────────────────────────────────────────────────────────────
type MenuId =
  | "dashboard"
  | "members" | "teachers" | "approvals" | "invite-records"
  | "classes" | "attendance" | "diary" | "notices"
  | "makeups" | "holidays" | "makeup-policy"
  | "revenue" | "settlement"
  | "pool-settings" | "data-management" | "subscription";

const MENU_GROUPS = [
  {
    id: "class",
    label: "수업관리",
    icon: "📚",
    items: [
      { id: "classes" as MenuId, label: "반 관리" },
      { id: "attendance" as MenuId, label: "출결 관리" },
      { id: "diary" as MenuId, label: "수업 일지" },
      { id: "notices" as MenuId, label: "공지사항" },
    ],
  },
  {
    id: "makeup",
    label: "보강관리",
    icon: "🔁",
    items: [
      { id: "makeups" as MenuId, label: "보강 현황" },
      { id: "holidays" as MenuId, label: "휴무일 관리" },
      { id: "makeup-policy" as MenuId, label: "보강정책 설정" },
    ],
  },
  {
    id: "ops",
    label: "운영관리",
    icon: "👥",
    items: [
      { id: "members" as MenuId, label: "회원 명부" },
      { id: "teachers" as MenuId, label: "선생님 관리" },
      { id: "approvals" as MenuId, label: "승인 대기" },
      { id: "invite-records" as MenuId, label: "초대 기록" },
    ],
  },
  {
    id: "finance",
    label: "매출/정산",
    icon: "💰",
    items: [
      { id: "revenue" as MenuId, label: "월별 매출" },
      { id: "settlement" as MenuId, label: "정산 확인" },
    ],
  },
  {
    id: "settings",
    label: "설정",
    icon: "⚙️",
    items: [
      { id: "pool-settings" as MenuId, label: "수영장 정보" },
      { id: "data-management" as MenuId, label: "데이터 관리" },
      { id: "subscription" as MenuId, label: "구독 현황" },
    ],
  },
];

// ─── Shared UI ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "#0a0a0a" }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#ebebeb] p-5">
      <p className="text-[12px] text-[#aaa] mb-1">{label}</p>
      <p className="text-[28px] font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[#bbb] mt-1">{sub}</p>}
    </div>
  );
}
function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-[17px] font-bold text-[#0a0a0a]">{title}</h2>
      {action}
    </div>
  );
}
function Placeholder({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <p className="text-[16px] font-semibold text-[#333] mb-2">{title}</p>
      <p className="text-[13px] text-[#aaa] max-w-xs">{desc}</p>
    </div>
  );
}
function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[#ebebeb] bg-white">
      <table className="w-full text-[13px]">{children}</table>
    </div>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-3 text-[11px] text-[#aaa] font-semibold bg-[#fafafa] border-b border-[#f0f0f0] whitespace-nowrap">{children}</th>;
}
function Td({ children, cls }: { children: React.ReactNode; cls?: string }) {
  return <td className={`px-4 py-3 border-b border-[#f8f8f8] align-middle ${cls ?? ""}`}>{children}</td>;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PoolAdmin() {
  const [, params] = useRoute("/pool/:id/admin");
  const [, navigate] = useLocation();
  const { user, logout, loading: authLoading } = useAuth();
  const poolId = params?.id;

  const [menu, setMenu] = useState<MenuId>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Data state
  const [members, setMembers] = useState<Member[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [makeups, setMakeups] = useState<Makeup[]>([]);
  const [revenue, setRevenue] = useState<Revenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [poolInfo, setPoolInfo] = useState<any>(null);

  // Attendance filters
  const [attDate, setAttDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attClassId, setAttClassId] = useState("");

  // Forms
  const [memberSearch, setMemberSearch] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMember, setNewMember] = useState({ name: "", phone: "", birth_date: "", memo: "" });
  const [memberMsg, setMemberMsg] = useState("");

  const [showAddClass, setShowAddClass] = useState(false);
  const [newClass, setNewClass] = useState({ name: "", instructor: "", schedule: "", capacity: "" });
  const [classMsg, setClassMsg] = useState("");

  const [showAddNotice, setShowAddNotice] = useState(false);
  const [newNotice, setNewNotice] = useState({ title: "", content: "" });
  const [noticeMsg, setNoticeMsg] = useState("");

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== "pool_admin" && user.role !== "super_admin"))) {
      navigate("/login");
    }
  }, [user, authLoading, navigate]);

  const fetchCore = useCallback(async () => {
    setLoading(true);
    try {
      const [m, c, n] = await Promise.all([
        api.get<Member[]>("/members").catch(() => []),
        api.get<Class[]>("/classes").catch(() => []),
        api.get<Notice[]>("/notices").catch(() => []),
      ]);
      setMembers(m);
      setClasses(c);
      setNotices(n);
      if (c.length > 0 && !attClassId) setAttClassId(c[0].id);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTeachers = useCallback(async () => {
    try {
      const data = await api.get<Teacher[]>("/teachers").catch(() => []);
      setTeachers(data);
    } catch { /* ignore */ }
  }, []);

  const fetchAttendance = useCallback(async () => {
    if (!attClassId) return;
    try {
      const data = await api.get<Attendance[]>(`/attendance?class_id=${attClassId}&date=${attDate}`).catch(() => []);
      setAttendance(data);
    } catch { setAttendance([]); }
  }, [attClassId, attDate]);

  const fetchHolidays = useCallback(async () => {
    try {
      const data = await api.get<Holiday[]>("/holidays").catch(() => []);
      setHolidays(data);
    } catch { /* ignore */ }
  }, []);

  const fetchRevenue = useCallback(async () => {
    try {
      const data = await api.get<Revenue[]>("/attendance/monthly-summary").catch(() => []);
      setRevenue(data);
    } catch { /* ignore */ }
  }, []);

  const fetchPoolInfo = useCallback(async () => {
    if (!poolId) return;
    try {
      const data = await api.get(`/admin/pools/${poolId}`).catch(() => null);
      setPoolInfo(data);
    } catch { /* ignore */ }
  }, [poolId]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchCore();
      fetchTeachers();
      fetchPoolInfo();
    }
  }, [authLoading, user, fetchCore, fetchTeachers, fetchPoolInfo]);

  useEffect(() => {
    if (menu === "attendance") fetchAttendance();
    if (menu === "holidays") fetchHolidays();
    if (menu === "revenue") fetchRevenue();
  }, [menu, fetchAttendance, fetchHolidays, fetchRevenue]);

  useEffect(() => {
    if (menu === "attendance") fetchAttendance();
  }, [attDate, attClassId]);

  // CRUD
  const createMember = async (e: React.FormEvent) => {
    e.preventDefault(); setMemberMsg("");
    try {
      await api.post("/members", { name: newMember.name, phone: newMember.phone, birth_date: newMember.birth_date || undefined, memo: newMember.memo || undefined });
      setMemberMsg("회원이 등록되었습니다."); setNewMember({ name: "", phone: "", birth_date: "", memo: "" }); setShowAddMember(false); fetchCore();
    } catch (err: any) { setMemberMsg(err?.data?.error || "등록 실패"); }
  };

  const deleteMember = async (id: string) => {
    if (!confirm("이 회원을 삭제하시겠습니까?")) return;
    try { await api.delete(`/members/${id}`); fetchCore(); } catch { /* ignore */ }
  };

  const createClass = async (e: React.FormEvent) => {
    e.preventDefault(); setClassMsg("");
    try {
      await api.post("/classes", { name: newClass.name, instructor: newClass.instructor, schedule: newClass.schedule, capacity: newClass.capacity ? parseInt(newClass.capacity) : undefined });
      setClassMsg("반이 등록되었습니다."); setNewClass({ name: "", instructor: "", schedule: "", capacity: "" }); setShowAddClass(false); fetchCore();
    } catch (err: any) { setClassMsg(err?.data?.error || "등록 실패"); }
  };

  const deleteClass = async (id: string) => {
    if (!confirm("이 반을 삭제하시겠습니까?")) return;
    try { await api.delete(`/classes/${id}`); fetchCore(); } catch { /* ignore */ }
  };

  const createNotice = async (e: React.FormEvent) => {
    e.preventDefault(); setNoticeMsg("");
    try {
      await api.post("/notices", { title: newNotice.title, content: newNotice.content });
      setNoticeMsg("공지사항이 등록되었습니다."); setNewNotice({ title: "", content: "" }); setShowAddNotice(false); fetchCore();
    } catch (err: any) { setNoticeMsg(err?.data?.error || "등록 실패"); }
  };

  const deleteNotice = async (id: string) => {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try { await api.delete(`/notices/${id}`); fetchCore(); } catch { /* ignore */ }
  };

  const checkAttendance = async (memberId: string, status: "present" | "absent" | "late") => {
    if (!attClassId) return;
    try {
      await api.post("/attendance", { member_id: memberId, class_id: attClassId, date: attDate, status });
      fetchAttendance();
    } catch { /* ignore */ }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><span className="text-[#aaa]">로딩 중...</span></div>;
  if (!user || (user.role !== "pool_admin" && user.role !== "super_admin")) return null;

  const poolName = poolInfo?.name || "수영장";
  const filteredMembers = members.filter(m =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.phone.includes(memberSearch)
  );

  // ── Content renderers ──
  const renderDashboard = () => (
    <div>
      <SectionHeader title="대시보드" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="전체 회원" value={members.length} color={PRIMARY} />
        <StatCard label="수업 반 수" value={classes.length} />
        <StatCard label="공지사항" value={notices.length} />
        <StatCard label="선생님" value={teachers.length} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-5">
          <p className="text-[12px] font-semibold text-[#888] mb-3">최근 공지사항</p>
          {notices.length === 0 ? (
            <p className="text-[13px] text-[#bbb]">공지사항 없음</p>
          ) : notices.slice(0, 3).map(n => (
            <div key={n.id} className="py-2.5 border-b border-[#f5f5f5] last:border-0">
              <p className="text-[13px] font-medium text-[#0a0a0a]">{n.title}</p>
              <p className="text-[11px] text-[#bbb] mt-0.5">{n.created_at?.slice(0, 10)}</p>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-5">
          <p className="text-[12px] font-semibold text-[#888] mb-3">수업 목록</p>
          {classes.length === 0 ? (
            <p className="text-[13px] text-[#bbb]">수업 없음</p>
          ) : classes.slice(0, 4).map(c => (
            <div key={c.id} className="py-2.5 border-b border-[#f5f5f5] last:border-0">
              <p className="text-[13px] font-medium text-[#0a0a0a]">{c.name}</p>
              <p className="text-[11px] text-[#bbb] mt-0.5">{c.instructor} · {c.schedule}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderMembers = () => (
    <div>
      <SectionHeader
        title={`회원 명부 (${members.length}명)`}
        action={
          <button onClick={() => setShowAddMember(v => !v)} className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold" style={{ background: PRIMARY }}>
            + 회원 추가
          </button>
        }
      />
      {showAddMember && (
        <form onSubmit={createMember} className="bg-white rounded-2xl border border-[#ebebeb] p-6 mb-5">
          <p className="text-[14px] font-bold text-[#0a0a0a] mb-4">새 회원 등록</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[{ key: "name", label: "이름 *", ph: "홍길동", type: "text" }, { key: "phone", label: "연락처 *", ph: "010-0000-0000", type: "text" }, { key: "birth_date", label: "생년월일", ph: "1990-01-01", type: "date" }].map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-semibold text-[#888] mb-1">{f.label}</label>
                <input type={f.type} value={(newMember as any)[f.key]} onChange={e => setNewMember(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph} required={f.key !== "birth_date"} className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
              </div>
            ))}
            <div>
              <label className="block text-[11px] font-semibold text-[#888] mb-1">메모</label>
              <input type="text" value={newMember.memo} onChange={e => setNewMember(p => ({ ...p, memo: e.target.value }))} placeholder="메모 (선택)" className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
            </div>
          </div>
          {memberMsg && <p className={`mt-3 text-[12px] ${memberMsg.includes("등록") ? "text-green-600" : "text-red-500"}`}>{memberMsg}</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowAddMember(false)} className="flex-1 py-2.5 rounded-xl border border-[#ebebeb] text-[12px] font-semibold text-[#555]">취소</button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl text-white text-[12px] font-semibold" style={{ background: PRIMARY }}>등록</button>
          </div>
        </form>
      )}
      <div className="mb-4">
        <input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="이름 또는 연락처 검색" className="w-full max-w-sm px-4 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
      </div>
      {loading ? <p className="text-[#aaa] text-[13px]">불러오는 중...</p> : (
        <TableWrap>
          <thead><tr><Th>이름</Th><Th>연락처</Th><Th>수업반</Th><Th>생년월일</Th><Th>등록일</Th><Th></Th></tr></thead>
          <tbody>
            {filteredMembers.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-[#bbb] text-[13px]">회원이 없습니다.</td></tr>
            ) : filteredMembers.map(m => (
              <tr key={m.id} className="hover:bg-[#fafafa]">
                <Td><span className="font-medium text-[#0a0a0a]">{m.name}</span></Td>
                <Td>{m.phone}</Td>
                <Td><span className={`text-[11px] px-2 py-0.5 rounded-full ${m.class_name ? "bg-blue-50 text-blue-600" : "text-[#ccc]"}`}>{m.class_name || "미배정"}</span></Td>
                <Td>{m.birth_date || "-"}</Td>
                <Td cls="text-[#bbb]">{m.created_at?.slice(0, 10)}</Td>
                <Td><button onClick={() => deleteMember(m.id)} className="text-[11px] text-red-400 hover:text-red-600 transition-colors">삭제</button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );

  const renderClasses = () => (
    <div>
      <SectionHeader
        title={`반 관리 (${classes.length}개)`}
        action={
          <button onClick={() => setShowAddClass(v => !v)} className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold" style={{ background: PRIMARY }}>
            + 반 추가
          </button>
        }
      />
      {showAddClass && (
        <form onSubmit={createClass} className="bg-white rounded-2xl border border-[#ebebeb] p-6 mb-5">
          <p className="text-[14px] font-bold text-[#0a0a0a] mb-4">새 반 등록</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[{ key: "name", label: "반 이름 *", ph: "아침 반" }, { key: "instructor", label: "담당 강사 *", ph: "김선생" }, { key: "schedule", label: "스케줄 *", ph: "월·수·금 07:00-08:00" }, { key: "capacity", label: "정원", ph: "30" }].map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-semibold text-[#888] mb-1">{f.label}</label>
                <input type={f.key === "capacity" ? "number" : "text"} value={(newClass as any)[f.key]} onChange={e => setNewClass(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.ph} required={!["capacity"].includes(f.key)} className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
              </div>
            ))}
          </div>
          {classMsg && <p className={`mt-3 text-[12px] ${classMsg.includes("등록") ? "text-green-600" : "text-red-500"}`}>{classMsg}</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowAddClass(false)} className="flex-1 py-2.5 rounded-xl border border-[#ebebeb] text-[12px] font-semibold text-[#555]">취소</button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl text-white text-[12px] font-semibold" style={{ background: PRIMARY }}>등록</button>
          </div>
        </form>
      )}
      <TableWrap>
        <thead><tr><Th>반 이름</Th><Th>담당 강사</Th><Th>스케줄</Th><Th>정원</Th><Th>현재 인원</Th><Th></Th></tr></thead>
        <tbody>
          {classes.length === 0 ? (
            <tr><td colSpan={6} className="text-center py-10 text-[#bbb] text-[13px]">등록된 반이 없습니다.</td></tr>
          ) : classes.map(c => (
            <tr key={c.id} className="hover:bg-[#fafafa]">
              <Td><span className="font-medium text-[#0a0a0a]">{c.name}</span></Td>
              <Td>{c.instructor}</Td>
              <Td>{c.schedule}</Td>
              <Td>{c.capacity ?? "-"}</Td>
              <Td>{c.member_count ?? 0}명</Td>
              <Td><button onClick={() => deleteClass(c.id)} className="text-[11px] text-red-400 hover:text-red-600 transition-colors">삭제</button></Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );

  const renderAttendance = () => (
    <div>
      <SectionHeader title="출결 관리" />
      <div className="flex flex-wrap gap-3 mb-5">
        <input type="date" value={attDate} onChange={e => setAttDate(e.target.value)} className="px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
        <select value={attClassId} onChange={e => setAttClassId(e.target.value)} className="px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]">
          <option value="">반 선택</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {!attClassId ? (
        <Placeholder icon="📋" title="반을 선택하세요" desc="출결을 확인할 반을 선택해주세요." />
      ) : (
        <TableWrap>
          <thead><tr><Th>회원명</Th><Th>출결 상태</Th></tr></thead>
          <tbody>
            {members.filter(m => !m.class_id || m.class_id === attClassId).length === 0 ? (
              <tr><td colSpan={2} className="text-center py-10 text-[#bbb] text-[13px]">이 반에 배정된 회원이 없습니다.</td></tr>
            ) : members.filter(m => m.class_id === attClassId || !m.class_id).slice(0, 50).map(m => {
              const rec = attendance.find(a => a.member_id === m.id);
              return (
                <tr key={m.id} className="hover:bg-[#fafafa]">
                  <Td><span className="font-medium text-[#0a0a0a]">{m.name}</span></Td>
                  <Td>
                    <div className="flex gap-2">
                      {(["present", "absent", "late"] as const).map(s => {
                        const labels = { present: "출석", absent: "결석", late: "지각" };
                        const colors = { present: "bg-green-50 text-green-700 border-green-200", absent: "bg-red-50 text-red-600 border-red-200", late: "bg-yellow-50 text-yellow-700 border-yellow-200" };
                        const active = rec?.status === s;
                        return (
                          <button key={s} onClick={() => checkAttendance(m.id, s)} className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-all ${active ? colors[s] : "border-[#ebebeb] text-[#bbb] hover:bg-[#f5f5f5]"}`}>
                            {labels[s]}
                          </button>
                        );
                      })}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </div>
  );

  const renderNotices = () => (
    <div>
      <SectionHeader
        title={`공지사항 (${notices.length}건)`}
        action={
          <button onClick={() => setShowAddNotice(v => !v)} className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold" style={{ background: PRIMARY }}>
            + 공지 작성
          </button>
        }
      />
      {showAddNotice && (
        <form onSubmit={createNotice} className="bg-white rounded-2xl border border-[#ebebeb] p-6 mb-5">
          <p className="text-[14px] font-bold text-[#0a0a0a] mb-4">새 공지사항</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#888] mb-1">제목 *</label>
              <input type="text" value={newNotice.title} onChange={e => setNewNotice(p => ({ ...p, title: e.target.value }))} placeholder="공지사항 제목" required className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#888] mb-1">내용 *</label>
              <textarea value={newNotice.content} onChange={e => setNewNotice(p => ({ ...p, content: e.target.value }))} placeholder="공지사항 내용" required rows={4} className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1] resize-none" />
            </div>
          </div>
          {noticeMsg && <p className={`mt-3 text-[12px] ${noticeMsg.includes("등록") ? "text-green-600" : "text-red-500"}`}>{noticeMsg}</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowAddNotice(false)} className="flex-1 py-2.5 rounded-xl border border-[#ebebeb] text-[12px] font-semibold text-[#555]">취소</button>
            <button type="submit" className="flex-1 py-2.5 rounded-xl text-white text-[12px] font-semibold" style={{ background: PRIMARY }}>등록</button>
          </div>
        </form>
      )}
      <div className="space-y-3">
        {notices.length === 0 ? (
          <Placeholder icon="📢" title="공지사항 없음" desc="아직 등록된 공지사항이 없습니다." />
        ) : notices.map(n => (
          <div key={n.id} className="bg-white rounded-2xl border border-[#ebebeb] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[#0a0a0a] mb-1">{n.title}</p>
                <p className="text-[13px] text-[#666] whitespace-pre-wrap">{n.content}</p>
                <p className="text-[11px] text-[#bbb] mt-2">{n.created_at?.slice(0, 10)}</p>
              </div>
              <button onClick={() => deleteNotice(n.id)} className="text-[11px] text-red-400 hover:text-red-600 shrink-0">삭제</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTeachers = () => (
    <div>
      <SectionHeader title={`선생님 관리 (${teachers.length}명)`} />
      <TableWrap>
        <thead><tr><Th>이름</Th><Th>이메일</Th><Th>연락처</Th><Th>상태</Th><Th>등록일</Th></tr></thead>
        <tbody>
          {teachers.length === 0 ? (
            <tr><td colSpan={5} className="text-center py-10 text-[#bbb] text-[13px]">등록된 선생님이 없습니다.</td></tr>
          ) : teachers.map(t => (
            <tr key={t.id} className="hover:bg-[#fafafa]">
              <Td><span className="font-medium text-[#0a0a0a]">{t.name}</span></Td>
              <Td>{t.email}</Td>
              <Td>{t.phone || "-"}</Td>
              <Td><span className={`text-[11px] px-2 py-0.5 rounded-full ${t.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{t.is_active ? "활성" : "비활성"}</span></Td>
              <Td cls="text-[#bbb]">{t.created_at?.slice(0, 10)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );

  const renderHolidays = () => (
    <div>
      <SectionHeader title="휴무일 관리" />
      <TableWrap>
        <thead><tr><Th>날짜</Th><Th>사유</Th><Th>확정 여부</Th></tr></thead>
        <tbody>
          {holidays.length === 0 ? (
            <tr><td colSpan={3} className="text-center py-10 text-[#bbb] text-[13px]">등록된 휴무일이 없습니다.</td></tr>
          ) : holidays.map(h => (
            <tr key={h.id} className="hover:bg-[#fafafa]">
              <Td><span className="font-medium text-[#0a0a0a]">{h.date}</span></Td>
              <Td>{h.reason || "-"}</Td>
              <Td><span className={`text-[11px] px-2 py-0.5 rounded-full ${h.confirmed ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>{h.confirmed ? "확정" : "미확정"}</span></Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );

  const renderRevenue = () => (
    <div>
      <SectionHeader title="월별 매출" />
      {revenue.length === 0 ? (
        <Placeholder icon="💰" title="매출 데이터 없음" desc="아직 정산된 매출 데이터가 없습니다." />
      ) : (
        <TableWrap>
          <thead><tr><Th>월</Th><Th>회원 수</Th><Th>총 매출</Th></tr></thead>
          <tbody>
            {revenue.map((r, i) => (
              <tr key={i} className="hover:bg-[#fafafa]">
                <Td><span className="font-medium text-[#0a0a0a]">{r.month}</span></Td>
                <Td>{r.member_count}명</Td>
                <Td><span className="font-bold" style={{ color: PRIMARY }}>{r.total?.toLocaleString()}원</span></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );

  const renderPoolSettings = () => (
    <div>
      <SectionHeader title="수영장 정보" />
      {poolInfo ? (
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-6 max-w-lg">
          <div className="space-y-4">
            {[
              { label: "수영장 이름", value: poolInfo.name },
              { label: "주소", value: poolInfo.address },
              { label: "전화번호", value: poolInfo.phone },
              { label: "대표자", value: poolInfo.owner_name },
              { label: "이메일", value: poolInfo.owner_email },
              { label: "승인 상태", value: poolInfo.approval_status === "approved" ? "승인됨" : poolInfo.approval_status },
              { label: "구독 상태", value: poolInfo.subscription_status },
              { label: "구독 시작", value: poolInfo.subscription_start_at?.slice(0, 10) || "-" },
              { label: "구독 종료", value: poolInfo.subscription_end_at?.slice(0, 10) || "-" },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-2.5 border-b border-[#f5f5f5] last:border-0">
                <span className="text-[12px] text-[#888]">{label}</span>
                <span className="text-[13px] font-medium text-[#0a0a0a]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Placeholder icon="🏊" title="정보 없음" desc="수영장 정보를 불러올 수 없습니다." />
      )}
    </div>
  );

  const renderContent = () => {
    if (menu === "dashboard") return renderDashboard();
    if (menu === "members") return renderMembers();
    if (menu === "classes") return renderClasses();
    if (menu === "attendance") return renderAttendance();
    if (menu === "notices") return renderNotices();
    if (menu === "teachers") return renderTeachers();
    if (menu === "holidays") return renderHolidays();
    if (menu === "revenue") return renderRevenue();
    if (menu === "pool-settings") return renderPoolSettings();

    const placeholders: Partial<Record<MenuId, { icon: string; title: string; desc: string }>> = {
      "diary": { icon: "📓", title: "수업 일지", desc: "선생님이 앱에서 작성한 수업 일지를 확인합니다. 앱에서 더 자세히 관리할 수 있습니다." },
      "makeups": { icon: "🔁", title: "보강 현황", desc: "회원의 보강 신청 및 처리 현황입니다. 앱에서 보강을 승인하고 관리합니다." },
      "makeup-policy": { icon: "📋", title: "보강정책 설정", desc: "보강 가능 기간, 최대 횟수 등 보강 정책을 앱에서 설정합니다." },
      "approvals": { icon: "✅", title: "승인 대기", desc: "회원 등록 및 선생님 초대 승인 대기 목록입니다. 앱에서 즉시 승인/거절할 수 있습니다." },
      "invite-records": { icon: "📨", title: "초대 기록", desc: "선생님 및 학부모 초대 이력을 확인합니다." },
      "settlement": { icon: "🧾", title: "정산 확인", desc: "월별 구독 정산 내역을 확인합니다. 스윔노트 구독 플랜에 따른 결제 정보입니다." },
      "data-management": { icon: "🗄️", title: "데이터 관리", desc: "수영장 데이터 백업, 삭제, 이벤트 로그 등을 관리합니다." },
      "subscription": { icon: "💳", title: "구독 현황", desc: "현재 구독 플랜과 사용량을 확인합니다. 플랜 변경은 슈퍼관리자에 문의하세요." },
    };
    const p = placeholders[menu];
    if (p) return <Placeholder {...p} />;
    return null;
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#ebebeb] sticky top-0 z-20">
        <div className="h-14 flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => navigate("/super-admin")} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: PRIMARY }}>
                <span className="text-white text-[12px] font-black" translate="no">S</span>
              </div>
              <span className="text-[14px] font-bold text-[#0a0a0a]" translate="no">SWIMNOTE</span>
            </button>
            <span className="text-[#ddd]">/</span>
            <span className="text-[13px] text-[#888]">관리자</span>
            <span className="text-[#ddd]">/</span>
            <span className="text-[13px] font-semibold text-[#0a0a0a]">{poolName}</span>
          </div>
          <div className="flex items-center gap-3">
            {user.role === "super_admin" && (
              <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-600">슈퍼관리자</span>
            )}
            <span className="hidden sm:inline text-[12px] text-[#888]">{user.name}</span>
            <button onClick={() => { logout(); navigate("/login"); }} className="text-[12px] text-[#888] hover:text-[#0a0a0a]">로그아웃</button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? "w-52" : "w-0 overflow-hidden"} transition-all duration-200 bg-white border-r border-[#ebebeb] flex-shrink-0 flex flex-col`}>
          <div className="p-3 flex-1 overflow-y-auto">
            {/* Dashboard */}
            <button
              onClick={() => setMenu("dashboard")}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold mb-1 transition-all ${menu === "dashboard" ? "text-white" : "text-[#555] hover:bg-[#f5f5f5]"}`}
              style={menu === "dashboard" ? { background: PRIMARY } : {}}
            >
              🏠 <span>대시보드</span>
            </button>

            {MENU_GROUPS.map(group => (
              <div key={group.id} className="mt-4">
                <p className="text-[10px] font-bold text-[#bbb] uppercase tracking-wider px-3 mb-1.5">{group.icon} {group.label}</p>
                {group.items.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setMenu(item.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] transition-all mb-0.5 ${
                      menu === item.id
                        ? "font-semibold text-white"
                        : "font-medium text-[#666] hover:bg-[#f5f5f5]"
                    }`}
                    style={menu === item.id ? { background: SECONDARY } : {}}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-7">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}
