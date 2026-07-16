import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

const PRIMARY = "#002F5F";
const SECONDARY = "#01B2F1";

interface Pool {
  id: string;
  name: string;
  address: string;
  phone: string;
  owner_name: string;
  owner_email: string;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  subscription_status: "trial" | "active" | "expired" | "suspended" | "cancelled";
  subscription_start_at?: string | null;
  subscription_end_at?: string | null;
  member_count?: number | null;
  created_at: string;
}

const statusLabel: Record<string, string> = {
  pending: "승인 대기",
  approved: "승인됨",
  rejected: "반려됨",
};
const statusColor: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};
const subLabel: Record<string, string> = {
  trial: "트라이얼",
  active: "활성",
  expired: "만료",
  suspended: "정지",
  cancelled: "해지",
};
const subColor: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-green-50 text-green-700",
  expired: "bg-gray-100 text-gray-500",
  suspended: "bg-orange-50 text-orange-700",
  cancelled: "bg-red-50 text-red-600",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

export default function SuperAdmin() {
  const [, navigate] = useLocation();
  const { user, logout, loading: authLoading } = useAuth();
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [subModal, setSubModal] = useState<Pool | null>(null);
  const [subStatus, setSubStatus] = useState("");
  const [subStart, setSubStart] = useState("");
  const [subEnd, setSubEnd] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [tab, setTab] = useState<"pools" | "create-admin">("pools");
  const [newAdmin, setNewAdmin] = useState({ email: "", password: "", name: "", phone: "", swimming_pool_id: "" });
  const [createMsg, setCreateMsg] = useState("");

  useEffect(() => {
    if (!authLoading && (!user || user.role !== "super_admin")) {
      navigate("/login");
    }
  }, [user, authLoading, navigate]);

  const fetchPools = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Pool[]>(`/admin/pools?approval_status=${filter}`);
      setPools(data);
    } catch {
      setPools([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchPools(); }, [fetchPools]);

  const approve = async (id: string) => {
    setActionLoading(true);
    try {
      await api.patch(`/admin/pools/${id}/approve`, {});
      fetchPools();
    } finally {
      setActionLoading(false);
    }
  };

  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/pools/${rejectId}/reject`, { reason: rejectReason });
      setRejectId(null);
      setRejectReason("");
      fetchPools();
    } finally {
      setActionLoading(false);
    }
  };

  const updateSub = async () => {
    if (!subModal || !subStatus) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/pools/${subModal.id}/subscription`, {
        subscription_status: subStatus,
        subscription_start_at: subStart || null,
        subscription_end_at: subEnd || null,
      });
      setSubModal(null);
      fetchPools();
    } finally {
      setActionLoading(false);
    }
  };

  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg("");
    try {
      await api.post("/admin/users", { ...newAdmin, role: "pool_admin" });
      setCreateMsg("관리자 계정이 생성되었습니다.");
      setNewAdmin({ email: "", password: "", name: "", phone: "", swimming_pool_id: "" });
    } catch (err: any) {
      setCreateMsg(err?.data?.error || "생성 실패");
    }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><span className="text-[#888]">로딩 중...</span></div>;
  if (!user || user.role !== "super_admin") return null;

  const approvedPools = pools.filter(p => p.approval_status === "approved");

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Header */}
      <header className="bg-white border-b border-[#ebebeb] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: PRIMARY }}>
              <span className="text-white text-[12px] font-black" translate="no">S</span>
            </div>
            <span className="text-[14px] font-bold text-[#0a0a0a]" translate="no">SWIMNOTE</span>
            <span className="text-[#ddd]">/</span>
            <span className="text-[13px] text-[#888]">슈퍼관리자</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#888]">{user.name}</span>
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="text-[12px] text-[#888] hover:text-[#0a0a0a] transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-2 mb-8">
          {[
            { id: "pools", label: "수영장 관리" },
            { id: "create-admin", label: "관리자 계정 생성" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`px-5 py-2.5 rounded-full text-[13px] font-semibold transition-all ${
                tab === t.id ? "text-white shadow-sm" : "bg-white border border-[#ebebeb] text-[#555] hover:bg-[#f5f5f5]"
              }`}
              style={tab === t.id ? { background: PRIMARY } : {}}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "pools" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {[
                { label: "전체", value: pools.length, color: "#0a0a0a" },
                { label: "승인 대기", value: pools.filter(p => p.approval_status === "pending").length, color: "#d97706" },
                { label: "승인됨", value: pools.filter(p => p.approval_status === "approved").length, color: "#16a34a" },
                { label: "활성 구독", value: pools.filter(p => p.subscription_status === "active").length, color: SECONDARY },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-2xl border border-[#ebebeb] p-5">
                  <p className="text-[12px] text-[#aaa] mb-1">{s.label}</p>
                  <p className="text-[28px] font-bold" style={{ color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Filter */}
            <div className="flex gap-2 mb-4">
              {(["all", "pending", "approved", "rejected"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                    filter === f ? "text-white" : "bg-white border border-[#ebebeb] text-[#888] hover:bg-[#f5f5f5]"
                  }`}
                  style={filter === f ? { background: SECONDARY } : {}}
                >
                  {f === "all" ? "전체" : statusLabel[f]}
                </button>
              ))}
            </div>

            {/* Pool list */}
            {loading ? (
              <div className="py-20 text-center text-[#aaa] text-[14px]">불러오는 중...</div>
            ) : pools.length === 0 ? (
              <div className="py-20 text-center text-[#aaa] text-[14px]">수영장이 없습니다.</div>
            ) : (
              <div className="space-y-3">
                {pools.map((pool) => (
                  <div key={pool.id} className="bg-white rounded-2xl border border-[#ebebeb] p-5 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className="text-[16px] font-bold text-[#0a0a0a]">{pool.name}</h3>
                          <Badge label={statusLabel[pool.approval_status]} cls={statusColor[pool.approval_status]} />
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${subColor[pool.subscription_status]}`}>
                            {subLabel[pool.subscription_status]}
                          </span>
                        </div>
                        <p className="text-[13px] text-[#888] mb-1">{pool.address}</p>
                        <p className="text-[12px] text-[#aaa]">{pool.owner_name} · {pool.owner_email} · {pool.phone}</p>
                        {pool.member_count != null && (
                          <p className="text-[12px] text-[#aaa] mt-1">회원 {pool.member_count}명</p>
                        )}
                        {pool.rejection_reason && (
                          <p className="text-[12px] text-red-500 mt-1">반려사유: {pool.rejection_reason}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {pool.approval_status === "pending" && (
                          <>
                            <button
                              onClick={() => approve(pool.id)}
                              disabled={actionLoading}
                              className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                              style={{ background: "#16a34a" }}
                            >
                              승인
                            </button>
                            <button
                              onClick={() => setRejectId(pool.id)}
                              disabled={actionLoading}
                              className="px-4 py-2 rounded-xl text-white text-[12px] font-semibold bg-red-500 transition-opacity hover:opacity-80 disabled:opacity-50"
                            >
                              반려
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setSubModal(pool);
                            setSubStatus(pool.subscription_status);
                            setSubStart(pool.subscription_start_at?.slice(0, 10) || "");
                            setSubEnd(pool.subscription_end_at?.slice(0, 10) || "");
                          }}
                          className="px-4 py-2 rounded-xl text-[12px] font-semibold border border-[#ebebeb] text-[#555] hover:bg-[#f5f5f5] transition-colors"
                        >
                          구독 관리
                        </button>
                        {pool.approval_status === "approved" && (
                          <button
                            onClick={() => navigate(`/pool/${pool.id}/admin`)}
                            className="px-4 py-2 rounded-xl text-[12px] font-semibold border border-[#ebebeb] text-[#555] hover:bg-[#f5f5f5] transition-colors"
                          >
                            대시보드 →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "create-admin" && (
          <div className="max-w-lg">
            <div className="bg-white rounded-2xl border border-[#ebebeb] p-8">
              <h2 className="text-[17px] font-bold text-[#0a0a0a] mb-6">수영장 관리자 계정 생성</h2>
              <form onSubmit={createAdmin} className="space-y-4">
                {[
                  { key: "name", label: "이름", placeholder: "홍길동", type: "text" },
                  { key: "email", label: "이메일", placeholder: "admin@pool.com", type: "email" },
                  { key: "password", label: "비밀번호", placeholder: "초기 비밀번호", type: "password" },
                  { key: "phone", label: "전화번호", placeholder: "010-0000-0000", type: "text" },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="block text-[12px] font-semibold text-[#555] mb-1.5">{f.label}</label>
                    <input
                      type={f.type}
                      value={(newAdmin as any)[f.key]}
                      onChange={(e) => setNewAdmin(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      required={f.key !== "phone"}
                      className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1] transition-colors"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수영장</label>
                  <select
                    value={newAdmin.swimming_pool_id}
                    onChange={(e) => setNewAdmin(prev => ({ ...prev, swimming_pool_id: e.target.value }))}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] text-[#0a0a0a] focus:outline-none focus:border-[#01B2F1] transition-colors"
                  >
                    <option value="">수영장 선택</option>
                    {approvedPools.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                {createMsg && (
                  <div className={`px-4 py-3 rounded-xl text-[13px] ${createMsg.includes("생성") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {createMsg}
                  </div>
                )}
                <button
                  type="submit"
                  className="w-full py-3.5 rounded-xl text-white text-[14px] font-semibold transition-opacity hover:opacity-85"
                  style={{ background: PRIMARY }}
                >
                  계정 생성
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-xl">
            <h3 className="text-[17px] font-bold text-[#0a0a0a] mb-4">반려 사유 입력</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="반려 사유를 입력하세요"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1] resize-none transition-colors mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => { setRejectId(null); setRejectReason(""); }} className="flex-1 py-3 rounded-xl border border-[#ebebeb] text-[13px] font-semibold text-[#555] hover:bg-[#f5f5f5]">취소</button>
              <button onClick={reject} disabled={actionLoading || !rejectReason.trim()} className="flex-1 py-3 rounded-xl text-white text-[13px] font-semibold bg-red-500 hover:opacity-80 disabled:opacity-50">반려</button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription modal */}
      {subModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-xl">
            <h3 className="text-[17px] font-bold text-[#0a0a0a] mb-1">구독 관리</h3>
            <p className="text-[13px] text-[#888] mb-6">{subModal.name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">구독 상태</label>
                <select
                  value={subStatus}
                  onChange={(e) => setSubStatus(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#01B2F1]"
                >
                  {Object.entries(subLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">시작일</label>
                <input type="date" value={subStart} onChange={(e) => setSubStart(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#01B2F1]" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">종료일</label>
                <input type="date" value={subEnd} onChange={(e) => setSubEnd(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-[#e5e5e5] text-[14px] focus:outline-none focus:border-[#01B2F1]" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setSubModal(null)} className="flex-1 py-3 rounded-xl border border-[#ebebeb] text-[13px] font-semibold text-[#555] hover:bg-[#f5f5f5]">취소</button>
              <button onClick={updateSub} disabled={actionLoading} className="flex-1 py-3 rounded-xl text-white text-[13px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-50" style={{ background: PRIMARY }}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
