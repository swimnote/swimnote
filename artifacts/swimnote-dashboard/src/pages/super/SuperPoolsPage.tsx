import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api-client";
import { Search, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react";

// API /super/pools-summary response shape
type Pool = {
  pool_id: string;
  pool_name: string;
  approval_status?: string;
  active_member_count?: number;
  teacher_count?: number;
  x_plan_key?: string;
  xmode_entitlement?: boolean;
  x_paid?: boolean;
  x_manual?: boolean;
  x_trial_active?: boolean;
  created_at?: string;
  last_login_at?: string;
  admin?: { user_id?: string; name?: string; phone?: string; email?: string };
  subscription?: { tier?: string; plan_name?: string; status?: string; member_limit?: number };
};

const fmt = (n: number | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR"));

const xBadge = (pool: Pool) => {
  if (pool.xmode_entitlement && !pool.x_trial_active) return { label: "X", bg: "#EDE9FE", color: "#7C3AED" };
  if (pool.x_trial_active) return { label: "체험", bg: "#FEF9C3", color: "#92400E" };
  const key = pool.x_plan_key ?? "";
  if (key.includes("x") && !key.includes("trial")) return { label: "X", bg: "#EDE9FE", color: "#7C3AED" };
  return { label: "일반", bg: "#F3F4F6", color: "#6B7280" };
};

const statusBadge = (status: string | undefined) => {
  if (status === "approved") return { label: "운영중", bg: "#DCFCE7", color: "#166534" };
  if (status === "suspended" || status === "restricted") return { label: "정지", bg: "#FEE2E2", color: "#991B1B" };
  if (status === "pending") return { label: "대기", bg: "#E0F2FE", color: "#0369A1" };
  return { label: status ?? "-", bg: "#F3F4F6", color: "#6B7280" };
};

export default function SuperPoolsPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "x" | "normal" | "pending">("all");

  const { data: pools = [], isLoading, refetch } = useQuery({
    queryKey: ["super", "pools-summary"],
    queryFn: () => api.get<Pool[]>("/super/pools-summary"),
    refetchInterval: 30_000,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/super/operators/${id}/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "pools-summary"] }); },
  });

  const filtered = pools.filter((p) => {
    const q = search.toLowerCase();
    const name = p.pool_name ?? "";
    const adminName = p.admin?.name ?? "";
    const matchSearch = !q || name.toLowerCase().includes(q) || adminName.toLowerCase().includes(q);
    const isX = p.xmode_entitlement || p.x_trial_active || (p.x_plan_key ?? "").includes("x");
    const matchMode =
      filterMode === "all" ? true
      : filterMode === "x" ? isX
      : filterMode === "normal" ? (!isX && p.approval_status !== "pending")
      : filterMode === "pending" ? p.approval_status === "pending"
      : true;
    return matchSearch && matchMode;
  });

  const pendingCount = pools.filter(p => p.approval_status === "pending").length;
  const TAB_FILTERS = [
    { key: "all", label: `전체 (${pools.length})` },
    { key: "x", label: "X 도입" },
    { key: "normal", label: "일반" },
    { key: "pending", label: `승인 대기${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
  ] as const;

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1200px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>전체 수영장</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>총 {fmt(pools.length)}개 · 30초 자동 갱신</div>
        </div>
        <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", color: "var(--text-muted)", cursor: "pointer" }}>
          <RefreshCw size={14} />새로고침
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {TAB_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilterMode(f.key as typeof filterMode)} style={{ padding: "6px 14px", borderRadius: "20px", border: "1px solid", fontSize: "13px", cursor: "pointer", fontWeight: filterMode === f.key ? 700 : 500, background: filterMode === f.key ? "var(--x-primary)" : "var(--surface-white)", color: filterMode === f.key ? "#fff" : "var(--text-muted)", borderColor: filterMode === f.key ? "var(--x-primary)" : "var(--border-default)" }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: "16px", maxWidth: "360px" }}>
        <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="수영장명·운영자·이메일 검색" style={{ width: "100%", height: "36px", paddingLeft: "34px", paddingRight: "12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", outline: "none", background: "var(--surface-white)", boxSizing: "border-box" }} />
      </div>

      {/* Table */}
      <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
        {isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-subtle)" }}>
                {["수영장명", "운영자", "연락처", "회원수", "선생님", "플랜", "상태", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((pool, i) => {
                const x = xBadge(pool);
                const s = statusBadge(pool.approval_status);
                return (
                  <tr
                    key={pool.pool_id}
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--border-default)" : "none", cursor: "pointer" }}
                    onClick={() => navigate(`/super/pools/${pool.pool_id}`)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                  >
                    <td style={{ padding: "12px 14px", fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>{pool.pool_name}</td>
                    <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--text-muted)" }}>{pool.admin?.name ?? "-"}</td>
                    <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-faint)" }}>{pool.admin?.phone ?? pool.admin?.email ?? "-"}</td>
                    <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--text-body)" }}>{fmt(pool.active_member_count)}</td>
                    <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--text-body)" }}>{fmt(pool.teacher_count)}</td>
                    <td style={{ padding: "12px 14px" }}><span style={{ padding: "2px 8px", background: x.bg, color: x.color, borderRadius: "10px", fontSize: "11px", fontWeight: 700 }}>{x.label}</span></td>
                    <td style={{ padding: "12px 14px" }}><span style={{ padding: "2px 8px", background: s.bg, color: s.color, borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>{s.label}</span></td>
                    <td style={{ padding: "12px 14px" }}>
                      {pool.approval_status === "pending" && (
                        <div style={{ display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => approveMut.mutate(pool.pool_id)} style={{ padding: "4px 10px", background: "#DCFCE7", color: "#166534", border: "none", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                            <CheckCircle size={12} />승인
                          </button>
                          <button style={{ padding: "4px 10px", background: "#FEE2E2", color: "#991B1B", border: "none", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                            <XCircle size={12} />반려
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  <AlertCircle size={24} style={{ display: "block", margin: "0 auto 8px", opacity: 0.4 }} />
                  검색 결과가 없습니다.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
