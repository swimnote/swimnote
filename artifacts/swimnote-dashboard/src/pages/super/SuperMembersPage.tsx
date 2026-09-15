import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RefreshCw, Users, Search } from "lucide-react";

type MemberRow = {
  id: string;
  name: string;
  phone?: string;
  status?: string;
  pool_id?: string;
  pool_name?: string;
  class_name?: string;
  birth_date?: string;
  created_at?: string;
  [key: string]: unknown;
};

type PlatformStats = {
  total_members?: number;
  active_members?: number;
  [key: string]: unknown;
};

const statusInfo = (s: string | undefined) => {
  if (s === "active") return { label: "재원", bg: "#DCFCE7", color: "#166534" };
  if (s === "withdrawn") return { label: "퇴원", bg: "#FEE2E2", color: "#991B1B" };
  if (s === "suspended") return { label: "연기", bg: "#FEF9C3", color: "#854D0E" };
  if (s === "pending") return { label: "대기", bg: "#E0F2FE", color: "#0369A1" };
  return { label: s ?? "-", bg: "#F3F4F6", color: "#6B7280" };
};

const fmt = (n: number | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR"));
const date = (s: string | undefined) => s ? new Date(s).toLocaleDateString("ko-KR") : "-";
const PAGE_SIZE = 50;

export default function SuperMembersPage() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: stats } = useQuery({
    queryKey: ["super", "platform-stats"],
    queryFn: () => api.get<PlatformStats>("/platform-stats"),
    refetchInterval: 60_000,
  });

  // Use pools-summary to get member aggregates; full member list requires per-pool API
  // We show aggregate stats + direct to pool detail for individual member management
  const { data: pools = [], isLoading } = useQuery({
    queryKey: ["super", "pools-summary"],
    queryFn: () => api.get<Array<{ id: string; name: string; member_count: number; active_member_count?: number; owner_name?: string }>>("/super/pools-summary"),
    refetchInterval: 60_000,
  });

  const totalMembers = stats?.total_members ?? pools.reduce((s, p) => s + (p.member_count ?? 0), 0);
  const activeMembers = stats?.active_members ?? pools.reduce((s, p) => s + (p.active_member_count ?? 0), 0);

  const filtered = pools.filter((p) => {
    const q = search.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || (p.owner_name ?? "").toLowerCase().includes(q);
  });

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1100px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>전체 회원</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>플랫폼 전체 회원 현황</div>
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {[
          { label: "전체 회원", value: fmt(totalMembers) + "명", icon: <Users size={20} />, color: "#1D4E8F" },
          { label: "재원 회원", value: fmt(activeMembers) + "명", icon: <Users size={20} />, color: "#059669" },
          { label: "수영장 수", value: fmt(pools.length) + "개", icon: <Users size={20} />, color: "#7C3AED" },
        ].map((k) => (
          <div key={k.label} style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "20px" }}>
            <div style={{ color: k.color, marginBottom: "8px" }}>{k.icon}</div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-strong)", marginBottom: "4px" }}>{k.value}</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Notice */}
      <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#1E40AF" }}>
        💡 개별 회원 상세 조회는 <strong>수영장 상세 → 회원·반 탭</strong>에서 확인하세요. 아래는 수영장별 회원 현황 요약입니다.
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: "16px", maxWidth: "320px" }}>
        <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="수영장명·운영자 검색" style={{ width: "100%", height: "36px", paddingLeft: "34px", paddingRight: "12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", outline: "none", background: "var(--surface-white)", boxSizing: "border-box" }} />
      </div>

      {/* Table */}
      <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
        {isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--surface-subtle)" }}>
                {["수영장명", "운영자", "전체 회원", "활성 회원"].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {paged.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: i < paged.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                    <td style={{ padding: "12px 16px", fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>{p.name}</td>
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--text-muted)" }}>{p.owner_name ?? "-"}</td>
                    <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--text-body)", fontWeight: 600 }}>{fmt(p.member_count)}명</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "13px", color: "#059669", fontWeight: 600 }}>{fmt(p.active_member_count)}명</span>
                        {p.member_count > 0 && (
                          <div style={{ flex: 1, maxWidth: "80px", height: "4px", background: "#E5E7EB", borderRadius: "2px" }}>
                            <div style={{ height: "100%", background: "#22C55E", borderRadius: "2px", width: `${Math.min(100, ((p.active_member_count ?? 0) / p.member_count) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: "8px", padding: "14px", borderTop: "1px solid var(--border-default)" }}>
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: "6px 14px", border: "1px solid var(--border-default)", borderRadius: "6px", background: "var(--surface-white)", fontSize: "13px", cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.5 : 1 }}>이전</button>
                <span style={{ fontSize: "13px", color: "var(--text-muted)", padding: "6px 12px" }}>{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page === totalPages - 1} style={{ padding: "6px 14px", border: "1px solid var(--border-default)", borderRadius: "6px", background: "var(--surface-white)", fontSize: "13px", cursor: page === totalPages - 1 ? "not-allowed" : "pointer", opacity: page === totalPages - 1 ? 0.5 : 1 }}>다음</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
