/**
 * SuperPools — 전국 수영장 목록 (PC TABLE 구조)
 * - pools-summary API 사용
 * - 검색/필터: 수영장명, pool_id, mode, plan, active, paid, curriculum, subscription, warning
 * - URL search params로 filter/search 상태 보존 (Back 후 복원)
 * - Pool row 클릭 → SuperPoolControlCenter
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";

const NAVY = "#002F5F";
const CYAN = "#01B2F1";

interface PoolRow {
  pool_id: string;
  pool_name: string;
  pool_type: string;
  approval_status: string;
  is_readonly: boolean;
  upload_blocked: boolean;
  active_member_count: number;
  teacher_count: number;
  parent_count: number;
  diary_count: number;
  ai_diary_count: number;
  has_curriculum: boolean;
  last_login_at: string | null;
  usage_pct: number;
  used_storage_bytes: number;
  deletion_pending: boolean;
  xmode_entitlement: boolean;
  xmode_config_status: string;
  x_paid: boolean;
  x_manual: boolean;
  x_override: boolean;
  x_force_disabled: boolean;
  x_trial_active: boolean;
  x_trial_ends_at: string | null;
  x_trial_started_at: string | null;
  x_trial_used: boolean;
  created_at: string;
  updated_at: string;
  admin: { user_id: string | null; name: string; phone: string };
  subscription: {
    tier: string; plan_name: string; status: string; source: string;
    member_limit: number; storage_mb: number; display_storage: string;
    starts_at: string | null; ends_at: string | null; trial_end_at: string | null;
  };
}

// URL 쿼리 파라미터 파싱
function parseParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get("q") ?? "",
    mode: (p.get("mode") ?? "all") as "all" | "base" | "x",
    approval: (p.get("approval") ?? "all") as "all" | "pending" | "approved" | "rejected",
    sub: (p.get("sub") ?? "all") as "all" | "ok" | "issue",
    paid: (p.get("paid") ?? "all") as "all" | "paid" | "manual" | "force_off",
    curriculum: (p.get("curriculum") ?? "all") as "all" | "ready" | "none",
  };
}
function updateParams(patch: Record<string, string>) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === "all" || v === "") p.delete(k); else p.set(k, v);
  }
  const s = p.toString();
  const url = s ? `${window.location.pathname}?${s}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${cls}`}>{text}</span>;
}
function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
function fmtDT(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

function modeLabel(row: PoolRow) {
  if (row.x_force_disabled) return { label: "X-OFF", cls: "bg-red-100 text-red-700" };
  if (row.xmode_entitlement) return { label: "X", cls: "bg-[#002F5F] text-white" };
  if (row.x_trial_active)    return { label: "체험", cls: "bg-purple-100 text-purple-700" };
  return { label: "BASE", cls: "bg-[#f3f4f6] text-[#555]" };
}
function fmtTrialEnd(d: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  const now = new Date();
  const diffH = Math.max(0, Math.round((dt.getTime() - now.getTime()) / 3600000));
  if (diffH < 24) return `${diffH}h 남음`;
  return `${Math.ceil(diffH / 24)}일 남음`;
}
function subStatusCls(s: string) {
  return s === "active" ? "bg-green-100 text-green-700"
       : s === "trial"  ? "bg-blue-100 text-blue-700"
       : "bg-red-100 text-red-600";
}
function approvalCls(s: string) {
  return s === "approved" ? "bg-green-100 text-green-700"
       : s === "pending"  ? "bg-amber-100 text-amber-700"
       : "bg-gray-100 text-gray-500";
}
function approvalLabel(s: string) {
  return s === "approved" ? "승인" : s === "pending" ? "대기" : "반려";
}

const FilterBtn = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button onClick={onClick}
    className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all border ${
      active ? "text-white border-transparent" : "bg-white border-[#e5e5e5] text-[#888] hover:bg-[#f5f5f5]"
    }`}
    style={active ? { background: NAVY } : {}}>
    {label}
  </button>
);

export default function SuperPools() {
  const [, navigate] = useLocation();
  const init = useRef(parseParams());

  const [pools, setPools]   = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(init.current.q);
  const [mode, setMode] = useState(init.current.mode);
  const [approval, setApproval] = useState(init.current.approval);
  const [sub, setSub] = useState(init.current.sub);
  const [paid, setPaid] = useState(init.current.paid);
  const [curriculum, setCurriculum] = useState(init.current.curriculum);

  const [actionLoading, setActionLoading] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // URL sync
  useEffect(() => { updateParams({ q, mode, approval, sub, paid, curriculum }); }, [q, mode, approval, sub, paid, curriculum]);

  const fetchPools = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (approval !== "all") params.set("approval_status", approval);
      const data = await api.get<PoolRow[]>(`/super/pools-summary?${params}`);
      setPools(Array.isArray(data) ? data : []);
    } catch { setPools([]); } finally { setLoading(false); }
  }, [approval]);

  useEffect(() => { fetchPools(); }, [fetchPools]);

  // 클라이언트 필터
  const filtered = pools.filter(row => {
    if (q) {
      const lower = q.toLowerCase();
      if (![row.pool_name, row.pool_id, row.admin.name, row.admin.phone, row.subscription.tier].some(s => s?.toLowerCase().includes(lower))) return false;
    }
    if (mode === "x" && !row.xmode_entitlement) return false;
    if (mode === "base" && row.xmode_entitlement) return false;
    if (sub === "ok" && !["active","trial"].includes(row.subscription.status)) return false;
    if (sub === "issue" && ["active","trial"].includes(row.subscription.status)) return false;
    if (paid === "paid" && !row.x_paid) return false;
    if (paid === "manual" && !row.x_manual) return false;
    if (paid === "force_off" && !row.x_force_disabled) return false;
    if (curriculum === "ready" && !row.has_curriculum) return false;
    if (curriculum === "none" && row.has_curriculum) return false;
    return true;
  });

  const approve = async (id: string) => {
    setActionLoading(true);
    try { await api.patch(`/admin/pools/${id}/approve`, {}); fetchPools(); } finally { setActionLoading(false); }
  };
  const reject = async () => {
    if (!rejectId || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/admin/pools/${rejectId}/reject`, { reason: rejectReason });
      setRejectId(null); setRejectReason(""); fetchPools();
    } finally { setActionLoading(false); }
  };

  return (
    <div className="p-4 lg:p-6 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-[#111]">전국 수영장 목록</h1>
          <p className="text-[12px] text-[#999] mt-0.5">총 {filtered.length.toLocaleString()}곳 표시 / {pools.length.toLocaleString()}곳 로드</p>
        </div>
        <button onClick={fetchPools} className="text-[12px] text-[#888] hover:text-[#111] border border-[#e5e5e5] px-3 py-1.5 rounded-lg">새로고침</button>
      </div>

      {/* Stats 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
        {[
          { label: "전체",     val: pools.length,                                       color: "#111" },
          { label: "활성",     val: pools.filter(p => p.approval_status === "approved").length, color: "#16a34a" },
          { label: "X MODE",   val: pools.filter(p => p.xmode_entitlement).length,      color: NAVY },
          { label: "대기",     val: pools.filter(p => p.approval_status === "pending").length, color: "#d97706" },
          { label: "구독이상", val: pools.filter(p => !["active","trial"].includes(p.subscription.status) && p.approval_status === "approved").length, color: "#dc2626" },
          { label: "Curriculum", val: pools.filter(p => p.has_curriculum).length,       color: "#0369a1" },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-lg border border-[#e5e5e5] px-3 py-2">
            <p className="text-[10px] text-[#aaa]">{c.label}</p>
            <p className="text-[18px] font-bold" style={{ color: c.color }}>{c.val}</p>
          </div>
        ))}
      </div>

      {/* 검색 + 필터 */}
      <div className="bg-white rounded-lg border border-[#e5e5e5] p-3 mb-4 space-y-2">
        <input type="text" placeholder="수영장명 · pool_id · 대표자 · 전화번호 · plan"
          value={q} onChange={e => setQ(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg border border-[#e5e5e5] text-[13px] text-[#111] placeholder:text-[#ccc] focus:outline-none focus:border-[#01B2F1]" />
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-[#bbb] self-center mr-1">MODE</span>
          {(["all","base","x"] as const).map(f => <FilterBtn key={f} label={f === "all" ? "전체" : f.toUpperCase()} active={mode === f} onClick={() => setMode(f)} />)}
          <span className="text-[10px] text-[#bbb] self-center ml-2 mr-1">승인</span>
          {(["all","pending","approved","rejected"] as const).map(f => <FilterBtn key={f} label={f === "all" ? "전체" : approvalLabel(f)} active={approval === f} onClick={() => setApproval(f)} />)}
          <span className="text-[10px] text-[#bbb] self-center ml-2 mr-1">구독</span>
          {(["all","ok","issue"] as const).map(f => <FilterBtn key={f} label={f === "all" ? "전체" : f === "ok" ? "정상" : "이상"} active={sub === f} onClick={() => setSub(f)} />)}
          <span className="text-[10px] text-[#bbb] self-center ml-2 mr-1">Paid</span>
          {(["all","paid","manual","force_off"] as const).map(f => <FilterBtn key={f} label={f === "all" ? "전체" : f === "paid" ? "RC유료" : f === "manual" ? "수동" : "Force-Off"} active={paid === f} onClick={() => setPaid(f)} />)}
          <span className="text-[10px] text-[#bbb] self-center ml-2 mr-1">Curriculum</span>
          {(["all","ready","none"] as const).map(f => <FilterBtn key={f} label={f === "all" ? "전체" : f === "ready" ? "READY" : "없음"} active={curriculum === f} onClick={() => setCurriculum(f)} />)}
        </div>
      </div>

      {/* TABLE */}
      {loading ? (
        <div className="py-20 text-center text-[#aaa] text-[13px] animate-pulse">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-[#aaa] text-[13px]">조건에 맞는 수영장이 없습니다.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#e5e5e5] bg-white">
          <table className="w-full text-[12px] border-collapse min-w-[1100px]">
            <thead>
              <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                {["수영장명", "pool_id", "승인", "Mode", "Plan", "Paid/Manual/Override/ForceOff", "학생", "교사", "학부모", "일지/AI", "Curriculum", "구독", "갱신일", "최근활동", "Warning"].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-[10px] font-bold text-[#999] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const m = modeLabel(row);
                const subIssue = !["active","trial"].includes(row.subscription.status) && row.approval_status === "approved";
                return (
                  <tr key={row.pool_id}
                    className="border-b border-[#f5f5f5] hover:bg-[#f8f9ff] cursor-pointer transition-colors"
                    onClick={() => navigate(`/super/pools/${row.pool_id}`)}>
                    {/* 수영장명 */}
                    <td className="px-3 py-2.5 max-w-[160px]">
                      <span className="font-semibold text-[#002F5F] hover:underline truncate block">{row.pool_name}</span>
                      <span className="text-[10px] text-[#bbb] truncate block">{row.admin.name}</span>
                    </td>
                    {/* pool_id */}
                    <td className="px-3 py-2.5 font-mono text-[10px] text-[#aaa] max-w-[80px]">
                      <span className="truncate block">{row.pool_id}</span>
                    </td>
                    {/* 승인 */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <Badge text={approvalLabel(row.approval_status)} cls={approvalCls(row.approval_status)} />
                        {row.approval_status === "pending" && (
                          <div className="flex gap-1 mt-1" onClick={e => e.stopPropagation()}>
                            <button onClick={() => approve(row.pool_id)} disabled={actionLoading}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold text-white bg-green-600 hover:opacity-80 disabled:opacity-50">승인</button>
                            <button onClick={() => { setRejectId(row.pool_id); }} disabled={actionLoading}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold text-white bg-red-500 hover:opacity-80 disabled:opacity-50">반려</button>
                          </div>
                        )}
                      </div>
                    </td>
                    {/* Mode */}
                    <td className="px-3 py-2.5"><Badge text={m.label} cls={m.cls} /></td>
                    {/* Plan */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-[11px] font-medium text-[#333]">{row.subscription.plan_name}</span>
                      <br />
                      <span className="text-[10px] text-[#bbb]">/{row.subscription.member_limit}명</span>
                    </td>
                    {/* X Flags */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-0.5">
                        {row.x_paid && <Badge text="Paid" cls="bg-[#002F5F] text-white" />}
                        {row.x_manual && <Badge text="Manual" cls="bg-blue-100 text-blue-700" />}
                        {row.x_override && <Badge text="Override" cls="bg-amber-100 text-amber-700" />}
                        {row.x_force_disabled && <Badge text="Force-Off" cls="bg-red-100 text-red-700" />}
                        {row.x_trial_active && (
                          <span title={`체험 종료: ${row.x_trial_ends_at ? new Date(row.x_trial_ends_at).toLocaleString("ko-KR") : "-"}`}>
                            <Badge text={`무료체험 중 · ${fmtTrialEnd(row.x_trial_ends_at)}`} cls="bg-purple-100 text-purple-700" />
                          </span>
                        )}
                        {!row.x_trial_active && row.x_trial_used && (
                          <Badge text="체험완료" cls="bg-gray-100 text-gray-400" />
                        )}
                        {!row.x_paid && !row.x_manual && !row.x_override && !row.x_force_disabled && !row.x_trial_active && !row.x_trial_used && <span className="text-[#bbb]">—</span>}
                      </div>
                    </td>
                    {/* 학생 */}
                    <td className="px-3 py-2.5 text-center font-semibold text-[#333]">{row.active_member_count}</td>
                    {/* 교사 */}
                    <td className="px-3 py-2.5 text-center text-[#555]">{row.teacher_count}</td>
                    {/* 학부모 */}
                    <td className="px-3 py-2.5 text-center text-[#555]">{row.parent_count}</td>
                    {/* 일지/AI */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="text-[#333]">{row.diary_count}</span>
                      <span className="text-[#bbb] mx-0.5">/</span>
                      <span className="text-[#0369a1]">{row.ai_diary_count}</span>
                    </td>
                    {/* Curriculum */}
                    <td className="px-3 py-2.5">
                      {row.has_curriculum ? <Badge text="READY" cls="bg-green-100 text-green-700" /> : <span className="text-[#bbb] text-[11px]">없음</span>}
                    </td>
                    {/* 구독 */}
                    <td className="px-3 py-2.5">
                      <Badge text={row.subscription.status} cls={subStatusCls(row.subscription.status)} />
                    </td>
                    {/* 갱신일 */}
                    <td className="px-3 py-2.5 whitespace-nowrap text-[#888]">
                      {fmt(row.subscription.ends_at)}
                    </td>
                    {/* 최근활동 */}
                    <td className="px-3 py-2.5 whitespace-nowrap text-[#aaa]">
                      {fmtDT(row.last_login_at)}
                    </td>
                    {/* Warning */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        {row.deletion_pending && <Badge text="삭제예정" cls="bg-red-100 text-red-700" />}
                        {subIssue && <Badge text="구독이상" cls="bg-orange-100 text-orange-700" />}
                        {row.upload_blocked && <Badge text="업로드차단" cls="bg-gray-100 text-gray-500" />}
                        {!row.deletion_pending && !subIssue && !row.upload_blocked && <span className="text-[#bbb]">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject Modal */}
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
    </div>
  );
}
