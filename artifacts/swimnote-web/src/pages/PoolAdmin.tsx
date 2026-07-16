import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

interface Member {
  id: string;
  name: string;
  phone: string;
  birth_date?: string | null;
  memo?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  created_at: string;
}

interface Class {
  id: string;
  name: string;
  instructor: string;
  schedule: string;
  capacity?: number | null;
  member_count?: number | null;
}

interface Notice {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

interface Attendance {
  id: string;
  member_name: string;
  member_id: string;
  date: string;
  status: "present" | "absent" | "late";
}

type TabId = "overview" | "members" | "classes" | "notices" | "attendance";

function StatCard({ label, value, color = "#0a0a0a" }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#ebebeb] p-5">
      <p className="text-[12px] text-[#aaa] mb-1">{label}</p>
      <p className="text-[26px] font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

export default function PoolAdmin() {
  const [, params] = useRoute("/pool/:id/admin");
  const [, navigate] = useLocation();
  const { user, logout, loading: authLoading } = useAuth();

  const [tab, setTab] = useState<TabId>("overview");
  const [members, setMembers] = useState<Member[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(false);

  // New member form
  const [newMember, setNewMember] = useState({ name: "", phone: "", birth_date: "", memo: "" });
  const [memberMsg, setMemberMsg] = useState("");

  // New class form
  const [newClass, setNewClass] = useState({ name: "", instructor: "", schedule: "", capacity: "" });
  const [classMsg, setClassMsg] = useState("");

  // New notice form
  const [newNotice, setNewNotice] = useState({ title: "", content: "" });
  const [noticeMsg, setNoticeMsg] = useState("");

  // Attendance
  const [attDate, setAttDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attClassId, setAttClassId] = useState("");

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== "pool_admin" && user.role !== "super_admin"))) {
      navigate("/login");
    }
  }, [user, authLoading, navigate]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [m, c, n] = await Promise.all([
        api.get<Member[]>("/members"),
        api.get<Class[]>("/classes"),
        api.get<Notice[]>("/notices"),
      ]);
      setMembers(m);
      setClasses(c);
      setNotices(n);
      if (c.length > 0 && !attClassId) setAttClassId(c[0].id);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) fetchAll();
  }, [authLoading, user, fetchAll]);

  const fetchAttendance = useCallback(async () => {
    if (!attClassId) return;
    try {
      const data = await api.get<Attendance[]>(`/attendance?class_id=${attClassId}&date=${attDate}`);
      setAttendance(data);
    } catch {
      setAttendance([]);
    }
  }, [attClassId, attDate]);

  useEffect(() => {
    if (tab === "attendance") fetchAttendance();
  }, [tab, fetchAttendance]);

  const createMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemberMsg("");
    try {
      await api.post("/members", {
        name: newMember.name,
        phone: newMember.phone,
        birth_date: newMember.birth_date || undefined,
        memo: newMember.memo || undefined,
      });
      setMemberMsg("회원이 등록되었습니다.");
      setNewMember({ name: "", phone: "", birth_date: "", memo: "" });
      fetchAll();
    } catch (err: any) {
      setMemberMsg(err?.data?.error || "등록 실패");
    }
  };

  const deleteMember = async (id: string) => {
    if (!confirm("이 회원을 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/members/${id}`);
      fetchAll();
    } catch { /* ignore */ }
  };

  const createClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setClassMsg("");
    try {
      await api.post("/classes", {
        name: newClass.name,
        instructor: newClass.instructor,
        schedule: newClass.schedule,
        capacity: newClass.capacity ? parseInt(newClass.capacity) : undefined,
      });
      setClassMsg("반이 등록되었습니다.");
      setNewClass({ name: "", instructor: "", schedule: "", capacity: "" });
      fetchAll();
    } catch (err: any) {
      setClassMsg(err?.data?.error || "등록 실패");
    }
  };

  const deleteClass = async (id: string) => {
    if (!confirm("이 반을 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/classes/${id}`);
      fetchAll();
    } catch { /* ignore */ }
  };

  const createNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    setNoticeMsg("");
    try {
      await api.post("/notices", { title: newNotice.title, content: newNotice.content });
      setNoticeMsg("공지사항이 등록되었습니다.");
      setNewNotice({ title: "", content: "" });
      fetchAll();
    } catch (err: any) {
      setNoticeMsg(err?.data?.error || "등록 실패");
    }
  };

  const deleteNotice = async (id: string) => {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/notices/${id}`);
      fetchAll();
    } catch { /* ignore */ }
  };

  const checkAttendance = async (memberId: string, status: "present" | "absent" | "late") => {
    try {
      await api.post("/attendance", { class_id: attClassId, member_id: memberId, date: attDate, status });
      fetchAttendance();
    } catch { /* ignore */ }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><span className="text-[#888]">로딩 중...</span></div>;
  if (!user || (user.role !== "pool_admin" && user.role !== "super_admin")) return null;

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "개요" },
    { id: "members", label: "회원관리" },
    { id: "classes", label: "반관리" },
    { id: "attendance", label: "출결관리" },
    { id: "notices", label: "공지사항" },
  ];

  const attClass = classes.find(c => c.id === attClassId);
  const classMembers = attClass ? members.filter(m => m.class_id === attClassId) : [];
  const attMap = Object.fromEntries(attendance.map(a => [a.member_id, a.status]));
  const statusLabel = { present: "출석", absent: "결석", late: "지각" };
  const statusColor = {
    present: "bg-green-50 text-green-700",
    absent: "bg-red-50 text-red-600",
    late: "bg-yellow-50 text-yellow-700",
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Header */}
      <header className="bg-white border-b border-[#ebebeb] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: PRIMARY }}>
              <span className="text-white text-[12px] font-black" translate="no">S</span>
            </div>
            <span className="text-[14px] font-bold text-[#0a0a0a]" translate="no">SWIMNOTE</span>
            <span className="text-[#ddd]">/</span>
            <span className="text-[13px] text-[#888] truncate max-w-[120px]">관리자</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#888] hidden sm:block">{user.name}</span>
            {user.role === "super_admin" && (
              <button onClick={() => navigate("/super-admin")} className="text-[12px] text-[#888] hover:text-[#0a0a0a] transition-colors hidden sm:block">슈퍼관리자</button>
            )}
            <button onClick={() => { logout(); navigate("/login"); }} className="text-[12px] text-[#888] hover:text-[#0a0a0a] transition-colors">로그아웃</button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1.5 mb-6 overflow-x-auto scrollbar-none pb-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-full text-[13px] font-semibold transition-all whitespace-nowrap ${
                tab === t.id ? "text-white shadow-sm" : "bg-white border border-[#ebebeb] text-[#555] hover:bg-[#f5f5f5]"
              }`}
              style={tab === t.id ? { background: PRIMARY } : {}}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === "overview" && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <StatCard label="총 회원" value={members.length} color={SECONDARY} />
              <StatCard label="총 반" value={classes.length} />
              <StatCard label="공지사항" value={notices.length} />
              <StatCard label="오늘 날짜" value={new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} />
            </div>

            {classes.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">반 현황</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {classes.map((c) => (
                    <div key={c.id} className="bg-white rounded-2xl border border-[#ebebeb] p-5">
                      <p className="text-[15px] font-bold text-[#0a0a0a] mb-1">{c.name}</p>
                      <p className="text-[12px] text-[#888] mb-3">{c.instructor} · {c.schedule}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold" style={{ color: SECONDARY }}>{c.member_count ?? 0}명</span>
                        {c.capacity && <span className="text-[12px] text-[#bbb]">/ {c.capacity}명</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {notices.length > 0 && (
              <div>
                <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">최근 공지사항</h2>
                <div className="space-y-2">
                  {notices.slice(0, 3).map((n) => (
                    <div key={n.id} className="bg-white rounded-xl border border-[#ebebeb] px-5 py-4">
                      <p className="text-[14px] font-semibold text-[#0a0a0a]">{n.title}</p>
                      <p className="text-[12px] text-[#aaa] mt-0.5">{new Date(n.created_at).toLocaleDateString("ko-KR")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Members */}
        {tab === "members" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">회원 목록 ({members.length}명)</h2>
              {loading ? (
                <div className="py-16 text-center text-[#aaa]">로딩 중...</div>
              ) : members.length === 0 ? (
                <div className="py-16 text-center text-[#aaa]">등록된 회원이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.id} className="bg-white rounded-xl border border-[#ebebeb] px-5 py-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-[#0a0a0a]">{m.name}</p>
                        <p className="text-[12px] text-[#aaa]">{m.phone}{m.class_name ? ` · ${m.class_name}` : ""}</p>
                      </div>
                      <button onClick={() => deleteMember(m.id)} className="text-[12px] text-red-400 hover:text-red-600 shrink-0">삭제</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">회원 등록</h2>
              <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
                <form onSubmit={createMember} className="space-y-3">
                  {[
                    { key: "name", label: "이름", placeholder: "홍길동", type: "text", required: true },
                    { key: "phone", label: "전화번호", placeholder: "010-0000-0000", type: "text", required: true },
                    { key: "birth_date", label: "생년월일", placeholder: "", type: "date", required: false },
                    { key: "memo", label: "메모", placeholder: "특이사항", type: "text", required: false },
                  ].map((f) => (
                    <div key={f.key}>
                      <label className="block text-[11px] font-semibold text-[#888] mb-1">{f.label}</label>
                      <input
                        type={f.type}
                        value={(newMember as any)[f.key]}
                        onChange={(e) => setNewMember(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        required={f.required}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ddd] focus:outline-none focus:border-[#01B2F1]"
                      />
                    </div>
                  ))}
                  {memberMsg && <p className={`text-[12px] ${memberMsg.includes("등록") ? "text-green-600" : "text-red-500"}`}>{memberMsg}</p>}
                  <button type="submit" className="w-full py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85" style={{ background: PRIMARY }}>등록</button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Classes */}
        {tab === "classes" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">반 목록 ({classes.length}개)</h2>
              {loading ? (
                <div className="py-16 text-center text-[#aaa]">로딩 중...</div>
              ) : classes.length === 0 ? (
                <div className="py-16 text-center text-[#aaa]">등록된 반이 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {classes.map((c) => (
                    <div key={c.id} className="bg-white rounded-xl border border-[#ebebeb] p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[15px] font-bold text-[#0a0a0a] mb-1">{c.name}</p>
                          <p className="text-[12px] text-[#888] mb-1">{c.instructor}</p>
                          <p className="text-[12px] text-[#aaa]">{c.schedule}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-[13px] font-semibold" style={{ color: SECONDARY }}>{c.member_count ?? 0}명</span>
                            {c.capacity && <span className="text-[12px] text-[#bbb]">/ {c.capacity}명</span>}
                          </div>
                        </div>
                        <button onClick={() => deleteClass(c.id)} className="text-[12px] text-red-400 hover:text-red-600 shrink-0">삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">반 등록</h2>
              <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
                <form onSubmit={createClass} className="space-y-3">
                  {[
                    { key: "name", label: "반 이름", placeholder: "초급반", required: true },
                    { key: "instructor", label: "강사", placeholder: "홍길동", required: true },
                    { key: "schedule", label: "스케줄", placeholder: "월·수·금 10:00", required: true },
                    { key: "capacity", label: "정원", placeholder: "20", required: false },
                  ].map((f) => (
                    <div key={f.key}>
                      <label className="block text-[11px] font-semibold text-[#888] mb-1">{f.label}</label>
                      <input
                        type={f.key === "capacity" ? "number" : "text"}
                        value={(newClass as any)[f.key]}
                        onChange={(e) => setNewClass(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        required={f.required}
                        className="w-full px-3 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ddd] focus:outline-none focus:border-[#01B2F1]"
                      />
                    </div>
                  ))}
                  {classMsg && <p className={`text-[12px] ${classMsg.includes("등록") ? "text-green-600" : "text-red-500"}`}>{classMsg}</p>}
                  <button type="submit" className="w-full py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85" style={{ background: PRIMARY }}>등록</button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Attendance */}
        {tab === "attendance" && (
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <input
                type="date"
                value={attDate}
                onChange={(e) => setAttDate(e.target.value)}
                className="px-4 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
              />
              <select
                value={attClassId}
                onChange={(e) => setAttClassId(e.target.value)}
                className="px-4 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
              >
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={fetchAttendance} className="px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold" style={{ background: SECONDARY }}>조회</button>
            </div>

            {classMembers.length === 0 ? (
              <div className="py-16 text-center text-[#aaa]">이 반에 배정된 회원이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {classMembers.map((m) => {
                  const status = attMap[m.id];
                  return (
                    <div key={m.id} className="bg-white rounded-xl border border-[#ebebeb] px-5 py-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[14px] font-semibold text-[#0a0a0a]">{m.name}</p>
                        {status && (
                          <span className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusColor[status]}`}>
                            {statusLabel[status]}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {(["present", "absent", "late"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => checkAttendance(m.id, s)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${
                              status === s
                                ? s === "present" ? "bg-green-500 text-white border-green-500"
                                  : s === "absent" ? "bg-red-500 text-white border-red-500"
                                  : "bg-yellow-500 text-white border-yellow-500"
                                : "bg-white text-[#888] border-[#e5e5e5] hover:bg-[#f5f5f5]"
                            }`}
                          >
                            {statusLabel[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Notices */}
        {tab === "notices" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">공지사항 ({notices.length}개)</h2>
              {loading ? (
                <div className="py-16 text-center text-[#aaa]">로딩 중...</div>
              ) : notices.length === 0 ? (
                <div className="py-16 text-center text-[#aaa]">등록된 공지사항이 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {notices.map((n) => (
                    <div key={n.id} className="bg-white rounded-xl border border-[#ebebeb] p-5">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <p className="text-[14px] font-bold text-[#0a0a0a]">{n.title}</p>
                        <button onClick={() => deleteNotice(n.id)} className="text-[12px] text-red-400 hover:text-red-600 shrink-0">삭제</button>
                      </div>
                      <p className="text-[13px] text-[#555] leading-relaxed whitespace-pre-wrap">{n.content}</p>
                      <p className="text-[11px] text-[#bbb] mt-3">{new Date(n.created_at).toLocaleDateString("ko-KR")}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#0a0a0a] mb-3">공지 작성</h2>
              <div className="bg-white rounded-2xl border border-[#ebebeb] p-6">
                <form onSubmit={createNotice} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#888] mb-1">제목</label>
                    <input
                      type="text"
                      value={newNotice.title}
                      onChange={(e) => setNewNotice(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="공지 제목"
                      required
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ddd] focus:outline-none focus:border-[#01B2F1]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#888] mb-1">내용</label>
                    <textarea
                      value={newNotice.content}
                      onChange={(e) => setNewNotice(prev => ({ ...prev, content: e.target.value }))}
                      placeholder="공지 내용"
                      required
                      rows={5}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ddd] focus:outline-none focus:border-[#01B2F1] resize-none"
                    />
                  </div>
                  {noticeMsg && <p className={`text-[12px] ${noticeMsg.includes("등록") ? "text-green-600" : "text-red-500"}`}>{noticeMsg}</p>}
                  <button type="submit" className="w-full py-2.5 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85" style={{ background: PRIMARY }}>등록</button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
