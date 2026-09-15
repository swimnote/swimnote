import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RefreshCw, TrendingUp, CreditCard, DollarSign } from "lucide-react";

type BillingRow = {
  id: string;
  pool_id: string;
  pool_name?: string;
  owner_name?: string;
  plan_key?: string;
  status?: string;
  amount?: number;
  currency?: string;
  current_period_start?: string;
  current_period_end?: string;
  provider?: string;
  rc_subscription_id?: string;
  created_at?: string;
  [key: string]: unknown;
};

type RevenueByPlan = { plan_key: string; total: number; count: number }[];
type RevenueByPool = { pool_id: string; pool_name?: string; total: number }[];

const fmt = (n: number | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR"));
const money = (n: number | undefined) => (n == null ? "-" : `${(n).toLocaleString("ko-KR")}원`);
const date = (s: string | undefined) => s ? new Date(s).toLocaleDateString("ko-KR") : "-";

const planLabel: Record<string, string> = {
  base: "베이스",
  x_monthly: "X 월정기",
  x_annual: "X 연간",
  x_trial: "X 체험",
  storage_10gb: "스토리지 10GB",
  storage_50gb: "스토리지 50GB",
};

const statusInfo = (s: string | undefined) => {
  if (s === "active") return { label: "활성", bg: "#DCFCE7", color: "#166534" };
  if (s === "cancelled") return { label: "해지", bg: "#FEE2E2", color: "#991B1B" };
  if (s === "past_due") return { label: "연체", bg: "#FFF7ED", color: "#EA580C" };
  if (s === "suspended") return { label: "정지", bg: "#FEE2E2", color: "#991B1B" };
  return { label: s ?? "-", bg: "#F3F4F6", color: "#6B7280" };
};

type FilterStatus = "all" | "active" | "past_due" | "cancelled";

export default function SuperBillingPage() {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  const { data: billingList = [], isLoading: listLoading, refetch } = useQuery({
    queryKey: ["super", "billing-list"],
    queryFn: () => api.get<BillingRow[]>("/super/billing/list"),
    refetchInterval: 60_000,
  });

  const { data: byPlan = [] } = useQuery({
    queryKey: ["super", "revenue-by-plan"],
    queryFn: () => api.get<RevenueByPlan>("/billing/revenue-by-plan"),
    refetchInterval: 120_000,
  });

  const { data: byPool = [] } = useQuery({
    queryKey: ["super", "revenue-by-pool"],
    queryFn: () => api.get<RevenueByPool>("/billing/revenue-by-pool"),
    refetchInterval: 120_000,
  });

  const totalRevenue = byPlan.reduce((s, r) => s + (r.total ?? 0), 0);
  const activeCount = billingList.filter((b) => b.status === "active").length;
  const pastDueCount = billingList.filter((b) => b.status === "past_due").length;

  const filtered = billingList.filter((b) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (b.pool_name ?? "").toLowerCase().includes(q) || (b.owner_name ?? "").toLowerCase().includes(q);
    const matchStatus = filterStatus === "all" || b.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const FILTERS: { key: FilterStatus; label: string }[] = [
    { key: "all", label: `전체 (${billingList.length})` },
    { key: "active", label: `활성 (${activeCount})` },
    { key: "past_due", label: `연체 (${pastDueCount})` },
    { key: "cancelled", label: "해지" },
  ];

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1200px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>결제 · 매출</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>실시간 구독 현황 · 1분 자동 갱신</div>
        </div>
        <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", color: "var(--text-muted)", cursor: "pointer" }}>
          <RefreshCw size={14} />새로고침
        </button>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {[
          { label: "총 매출", value: money(totalRevenue), icon: <DollarSign size={20} />, color: "#059669" },
          { label: "활성 구독", value: fmt(activeCount) + "개", icon: <CreditCard size={20} />, color: "#1D4E8F" },
          { label: "연체 건수", value: fmt(pastDueCount) + "개", icon: <TrendingUp size={20} />, color: pastDueCount > 0 ? "#DC2626" : "#6B7280" },
        ].map((c) => (
          <div key={c.label} style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "20px" }}>
            <div style={{ color: c.color, marginBottom: "10px" }}>{c.icon}</div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-strong)", marginBottom: "4px" }}>{c.value}</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Revenue by Plan */}
      {byPlan.length > 0 && (
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "16px" }}>플랜별 매출</div>
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {byPlan.map((r) => (
              <div key={r.plan_key} style={{ padding: "12px 16px", background: "var(--surface-subtle)", borderRadius: "8px", minWidth: "140px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>{planLabel[r.plan_key] ?? r.plan_key}</div>
                <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--text-strong)" }}>{money(r.total)}</div>
                <div style={{ fontSize: "11px", color: "var(--text-faint)" }}>{fmt(r.count)}건</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter + Search */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", alignItems: "center", flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilterStatus(f.key)} style={{ padding: "6px 14px", borderRadius: "20px", border: "1px solid", fontSize: "13px", cursor: "pointer", fontWeight: filterStatus === f.key ? 700 : 500, background: filterStatus === f.key ? "var(--x-primary)" : "var(--surface-white)", color: filterStatus === f.key ? "#fff" : "var(--text-muted)", borderColor: filterStatus === f.key ? "var(--x-primary)" : "var(--border-default)" }}>
            {f.label}
          </button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="수영장명·운영자 검색" style={{ height: "34px", padding: "0 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", outline: "none", marginLeft: "auto" }} />
      </div>

      {/* Table */}
      <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
        {listLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--surface-subtle)" }}>
              {["수영장", "운영자", "플랜", "금액", "상태", "기간 종료일", "결제수단"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((b, i) => {
                const s = statusInfo(b.status);
                return (
                  <tr key={b.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                    <td style={{ padding: "12px 14px", fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>{b.pool_name ?? b.pool_id}</td>
                    <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--text-muted)" }}>{b.owner_name ?? "-"}</td>
                    <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-body)" }}>{planLabel[b.plan_key ?? ""] ?? (b.plan_key ?? "-")}</td>
                    <td style={{ padding: "12px 14px", fontSize: "13px", fontWeight: 600, color: "var(--text-body)" }}>{money(b.amount)}</td>
                    <td style={{ padding: "12px 14px" }}><span style={{ padding: "2px 8px", background: s.bg, color: s.color, borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>{s.label}</span></td>
                    <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-muted)" }}>{date(b.current_period_end)}</td>
                    <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-faint)" }}>{b.provider ?? "-"}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
