/**
 * SuperPools — 수영장 관리
 * 기존 SuperAdmin.tsx 「수영장 관리」탭 로직을 그대로 이동.
 * MOVED (not duplicated).
 */
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
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
  homepage_slug?: string | null;
  homepage_enabled?: boolean | null;
}

const statusLabel: Record<string, string> = {
  pending: "승인 대기", approved: "승인됨", rejected: "반려됨",
};
const statusColor: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};
const subLabel: Record<string, string> = {
  trial: "트라이얼", active: "활성", expired: "만료",
  suspended: "정지", cancelled: "해지",
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

export default function SuperPools() {
  const [, navigate] = useLocation();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
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
  const [searchQuery, setSearchQuery] = useState("");

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
    } finally { setActionLoading(false); }
  };

  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/pools/${rejectId}/reject`, { reason: rejectReason });
      setRejectId(null);
      setRejectReason("");
      fetchPools();
    } finally { setActionLoading(false); }
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
    } finally { setActionLoading(false); }
  };

  const filtered = pools.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.owner_name.toLowerCase().includes(q) ||
      p.owner_email.toLowerCase().includes(q) ||
      p.phone.includes(q)
    );
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">수영장 관리</h1>
          <p className="text-[12px] text-[#999] mt-0.5">수영장 승인 · 구독 관리</p>
        </div>
        <button onClick={fetchPools} className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg">새로고침</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "전체", value: pools.length, color: "#0a0a0a" },
          { label: "승인 대기", value: pools.filter(p => p.approval_status === "pending").length, color: "#d97706" },
          { label: "승인됨", value: pools.filter(p => p.approval_status === "approved").length, color: "#16a34a" },
          { label: "활성 구독", value: pools.filter(p => p.subscription_status === "active").length, color: SECONDARY },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-lg border border-[#e5e5e5] px-4 py-3">
            <p className="text-[11px] text-[#aaa] mb-1">{s.label}</p>
            <p className="text-[24px] font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search + Filter */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="수영장명, pool_id, 대표자, 이메일, 전화번호"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 min-w-[200px] px-3.5 py-1.5 rounded-lg border border-[#e5e5e5] text-[13px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1]"
        />
        <div className="flex gap-1.5">
          {(["all", "pending", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                filter === f ? "text-white" : "bg-white border border-[#e5e5e5] text-[#888] hover:bg-[#f5f5f5]"
              }`}
              style={filter === f ? { background: SECONDARY } : {}}
            >
              {f === "all" ? "전체" : statusLabel[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Pool list */}
      {loading ? (
        <div className="py-20 text-center text-[#aaa] text-[13px]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-[#aaa] text-[13px]">{searchQuery ? "검색 결과 없음" : "수영장이 없습니다."}</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((pool) => (
            <div key={pool.id} className="bg-white rounded-lg border border-[#e5e5e5] p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <button
                      onClick={() => navigate(`/super/pools/${pool.id}`)}
                      className="text-[14px] font-bold text-[#002F5F] hover:underline"
                    >
                      {pool.name}
                    </button>
                    <Badge label={statusLabel[pool.approval_status]} cls={statusColor[pool.approval_status]} />
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${subColor[pool.subscription_status]}`}>
                      {subLabel[pool.subscription_status]}
                    </span>
                    {pool.homepage_slug && pool.homepage_enabled && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#EFF6FF] text-[#0369A1]">
                        <img src={`${BASE}/icon.png`} alt="" className="w-3 h-3 rounded-[2px]" />
                        홈페이지
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#999]">{pool.id}</p>
                  <p className="text-[12px] text-[#888] mt-0.5">{pool.address}</p>
                  <p className="text-[11px] text-[#aaa]">{pool.owner_name} · {pool.owner_email} · {pool.phone}</p>
                  {pool.member_count != null && (
                    <p className="text-[11px] text-[#aaa]">회원 {pool.member_count}명</p>
                  )}
                  {pool.rejection_reason && (
                    <p className="text-[11px] text-red-500 mt-0.5">반려사유: {pool.rejection_reason}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  {pool.approval_status === "pending" && (
                    <>
                      <button onClick={() => approve(pool.id)} disabled={actionLoading}
                        className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold bg-green-600 hover:opacity-80 disabled:opacity-50">승인</button>
                      <button onClick={() => setRejectId(pool.id)} disabled={actionLoading}
                        className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold bg-red-500 hover:opacity-80 disabled:opacity-50">반려</button>
                    </>
                  )}
                  <button
                    onClick={() => { setSubModal(pool); setSubStatus(pool.subscription_status); setSubStart(pool.subscription_start_at?.slice(0, 10) || ""); setSubEnd(pool.subscription_end_at?.slice(0, 10) || ""); }}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5]">구독 관리</button>
                  <button onClick={() => navigate(`/super/pools/${pool.id}`)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[#e5e5e5] text-[#002F5F] hover:bg-[#f5f5f5]">상세 →</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-[16px] font-bold text-[#0a0a0a] mb-4">반려 사유 입력</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="반려 사유를 입력하세요" rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] text-[#0a0a0a] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1] resize-none mb-4" />
            <div className="flex gap-2">
              <button onClick={() => { setRejectId(null); setRejectReason(""); }}
                className="flex-1 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] font-semibold text-[#555] hover:bg-[#f5f5f5]">취소</button>
              <button onClick={reject} disabled={actionLoading || !rejectReason.trim()}
                className="flex-1 py-2.5 rounded-xl text-white text-[13px] font-semibold bg-red-500 hover:opacity-80 disabled:opacity-50">반려</button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription modal */}
      {subModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-[16px] font-bold text-[#0a0a0a] mb-1">구독 관리</h3>
            <p className="text-[12px] text-[#888] mb-4">{subModal.name}</p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#555] mb-1">구독 상태</label>
                <select value={subStatus} onChange={e => setSubStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] text-[#111] focus:outline-none focus:border-[#01B2F1]">
                  {["trial", "active", "expired", "suspended", "cancelled"].map(s => (
                    <option key={s} value={s}>{subLabel[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#555] mb-1">시작일</label>
                <input type="date" value={subStart} onChange={e => setSubStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] text-[#111] focus:outline-none focus:border-[#01B2F1]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#555] mb-1">만료일</label>
                <input type="date" value={subEnd} onChange={e => setSubEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] text-[#111] focus:outline-none focus:border-[#01B2F1]" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSubModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-[#e5e5e5] text-[13px] font-semibold text-[#555] hover:bg-[#f5f5f5]">취소</button>
              <button onClick={updateSub} disabled={actionLoading || !subStatus}
                className="flex-1 py-2.5 rounded-xl text-white text-[13px] font-semibold disabled:opacity-50"
                style={{ background: PRIMARY }}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
