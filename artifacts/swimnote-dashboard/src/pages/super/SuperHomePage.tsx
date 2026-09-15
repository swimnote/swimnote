import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useLocation } from "wouter";
import { Building2, Users, CreditCard, TrendingUp, AlertTriangle, Brain, RefreshCw } from "lucide-react";

type DashStats = {
  total_pools: number;
  active_pools: number;
  total_members: number;
  active_members: number;
  total_revenue_this_month: number;
  x_pools: number;
  x_members: number;
  pending_approvals: number;
  open_incidents: number;
  open_support_cases: number;
  ai_credits_total: number;
  growth_reports_pending: number;
  new_pools_this_month?: number;
  new_members_this_month?: number;
  [key: string]: unknown;
};

type PoolSummaryRow = {
  id: string;
  name: string;
  owner_name?: string;
  member_count: number;
  active_member_count?: number;
  x_mode?: string;
  plan_key?: string;
  status?: string;
  created_at?: string;
  last_active_at?: string;
};

const fmt = (n: number | undefined) =>
  n === undefined || n === null ? "-" : n.toLocaleString("ko-KR");

const money = (n: number | undefined) => {
  if (n === undefined || n === null) return "-";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억원`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)}만원`;
  return `${n.toLocaleString("ko-KR")}원`;
};

export default function SuperHomePage() {
  const [, navigate] = useLocation();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["super", "dashboard-stats"],
    queryFn: () => api.get<DashStats>("/super/dashboard-stats"),
    refetchInterval: 30_000,
  });

  const { data: pools, isLoading: poolsLoading } = useQuery({
    queryKey: ["super", "pools-summary"],
    queryFn: () => api.get<PoolSummaryRow[]>("/super/pools-summary"),
    refetchInterval: 60_000,
  });

  const kpiCards = [
    { label: "전체 수영장", value: fmt(stats?.total_pools), sub: `활성 ${fmt(stats?.active_pools)}`, icon: <Building2 size={20} />, color: "#1D4E8F", path: "/super/pools" },
    { label: "X 도입 수영장", value: fmt(stats?.x_pools), sub: `X 회원 ${fmt(stats?.x_members)}명`, icon: <TrendingUp size={20} />, color: "#7C3AED", path: "/super/pools" },
    { label: "전체 회원", value: fmt(stats?.total_members), sub: `활성 ${fmt(stats?.active_members)}명`, icon: <Users size={20} />, color: "#0891B2", path: "/super/members" },
    { label: "이번달 매출", value: money(stats?.total_revenue_this_month), sub: "구독 기준", icon: <CreditCard size={20} />, color: "#059669", path: "/super/billing" },
    { label: "대기 승인", value: fmt(stats?.pending_approvals), sub: "처리 필요", icon: <AlertTriangle size={20} />, color: "#D97706", path: "/super/operators" },
    { label: "AI 크레딧 잔액", value: fmt(stats?.ai_credits_total), sub: "전체 수영장 합산", icon: <Brain size={20} />, color: "#7C3AED", path: "/super/ai" },
  ];

  const recentPools = (pools ?? []).slice(0, 10);

  const xBadge = (mode: string | undefined) => {
    if (mode === "x" || mode === "x_active") return <span style={{ padding: "2px 8px", background: "#EDE9FE", color: "#7C3AED", borderRadius: "10px", fontSize: "11px", fontWeight: 700 }}>X</span>;
    if (mode === "x_trial") return <span style={{ padding: "2px 8px", background: "#FEF9C3", color: "#92400E", borderRadius: "10px", fontSize: "11px", fontWeight: 700 }}>체험</span>;
    return <span style={{ padding: "2px 8px", background: "#F3F4F6", color: "#6B7280", borderRadius: "10px", fontSize: "11px" }}>일반</span>;
  };

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1200px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0, letterSpacing: "-0.3px" }}>플랫폼 개요</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>실시간 플랫폼 현황 · 30초 자동 갱신</div>
        </div>
        <button
          onClick={() => refetchStats()}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", color: "var(--text-muted)", cursor: "pointer" }}
        >
          <RefreshCw size={14} />
          새로고침
        </button>
      </div>

      {/* KPI Cards */}
      {statsLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "32px" }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ height: "100px", background: "var(--surface-white)", borderRadius: "12px", border: "1px solid var(--border-default)", animation: "pulse 1.5s ease-in-out infinite" }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "32px" }}>
          {kpiCards.map((card) => (
            <button
              key={card.label}
              onClick={() => navigate(card.path)}
              style={{
                background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px",
                padding: "20px", textAlign: "left", cursor: "pointer", transition: "box-shadow 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ color: card.color, opacity: 0.8 }}>{card.icon}</span>
              </div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-strong)", marginBottom: "4px" }}>{card.value}</div>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>{card.label}</div>
              <div style={{ fontSize: "11px", color: "var(--text-faint)", marginTop: "2px" }}>{card.sub}</div>
            </button>
          ))}
        </div>
      )}

      {/* Alert Banner */}
      {stats && ((stats.open_incidents ?? 0) > 0 || (stats.open_support_cases ?? 0) > 0 || (stats.pending_approvals ?? 0) > 0) && (
        <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
          {(stats.open_incidents ?? 0) > 0 && (
            <div onClick={() => navigate("/super/incidents")} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "8px", fontSize: "13px", color: "#DC2626", cursor: "pointer", fontWeight: 600 }}>
              <AlertTriangle size={14} /> 진행중 장애 {stats.open_incidents}건
            </div>
          )}
          {(stats.open_support_cases ?? 0) > 0 && (
            <div onClick={() => navigate("/super/support")} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: "8px", fontSize: "13px", color: "#EA580C", cursor: "pointer", fontWeight: 600 }}>
              <AlertTriangle size={14} /> 미처리 문의 {stats.open_support_cases}건
            </div>
          )}
          {(stats.pending_approvals ?? 0) > 0 && (
            <div onClick={() => navigate("/super/operators")} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 16px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "8px", fontSize: "13px", color: "#D97706", cursor: "pointer", fontWeight: 600 }}>
              <AlertTriangle size={14} /> 승인 대기 {stats.pending_approvals}건
            </div>
          )}
        </div>
      )}

      {/* Recent Pools Table */}
      <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-strong)" }}>최근 수영장 현황</div>
          <button onClick={() => navigate("/super/pools")} style={{ fontSize: "12px", color: "var(--x-primary)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>전체 보기 →</button>
        </div>
        {poolsLoading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-subtle)" }}>
                {["수영장명", "운영자", "회원수", "플랜", "상태"].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentPools.map((pool, i) => (
                <tr
                  key={pool.id}
                  style={{ borderBottom: i < recentPools.length - 1 ? "1px solid var(--border-default)" : "none", cursor: "pointer" }}
                  onClick={() => navigate(`/super/pools/${pool.id}`)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                >
                  <td style={{ padding: "12px 16px", fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>{pool.name}</td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--text-muted)" }}>{pool.owner_name ?? "-"}</td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--text-body)" }}>{fmt(pool.member_count)}명</td>
                  <td style={{ padding: "12px 16px" }}>{xBadge(pool.x_mode ?? pool.plan_key)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "2px 8px", background: pool.status === "active" ? "#DCFCE7" : "#F3F4F6", color: pool.status === "active" ? "#166534" : "#6B7280", borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>
                      {pool.status === "active" ? "운영중" : (pool.status ?? "알 수 없음")}
                    </span>
                  </td>
                </tr>
              ))}
              {recentPools.length === 0 && (
                <tr><td colSpan={5} style={{ padding: "32px", textAlign: "center", fontSize: "13px", color: "var(--text-muted)" }}>수영장 데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </div>
  );
}
