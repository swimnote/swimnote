import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RefreshCw, Shield } from "lucide-react";

type AuditLog = {
  id: string;
  admin_id?: string;
  admin_name?: string;
  action?: string;
  target_type?: string;
  target_id?: string;
  detail?: string | Record<string, unknown>;
  ip_address?: string;
  created_at?: string;
  [key: string]: unknown;
};

const actionColor = (action: string | undefined) => {
  if (!action) return { bg: "#F3F4F6", color: "#6B7280" };
  if (action.includes("delete") || action.includes("remove")) return { bg: "#FEE2E2", color: "#991B1B" };
  if (action.includes("create") || action.includes("approve")) return { bg: "#DCFCE7", color: "#166534" };
  if (action.includes("update") || action.includes("patch")) return { bg: "#E0F2FE", color: "#0369A1" };
  if (action.includes("restrict") || action.includes("reject")) return { bg: "#FFF7ED", color: "#EA580C" };
  return { bg: "#F3F4F6", color: "#6B7280" };
};

const date = (s: string | undefined) => s ? new Date(s).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";

export default function SuperAuditPage() {
  const [search, setSearch] = useState("");

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["super", "audit-logs"],
    queryFn: () => api.get<AuditLog[]>("/super/recent-audit-logs"),
    refetchInterval: 30_000,
  });

  const filtered = logs.filter((l) => {
    const q = search.toLowerCase();
    return !q
      || (l.admin_name ?? "").toLowerCase().includes(q)
      || (l.action ?? "").toLowerCase().includes(q)
      || (l.target_type ?? "").toLowerCase().includes(q);
  });

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1100px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>감사 로그</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>슈퍼관리자 작업 이력 · 30초 자동 갱신</div>
        </div>
        <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
          <RefreshCw size={14} />새로고침
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <Shield size={14} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>최근 {logs.length}건의 작업 이력</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="관리자·액션·대상 검색" style={{ marginLeft: "auto", height: "34px", padding: "0 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", outline: "none", width: "220px" }} />
      </div>

      <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
        {isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--surface-subtle)" }}>
              {["시각", "관리자", "액션", "대상", "IP", "상세"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((log, i) => {
                const ac = actionColor(log.action);
                const detail = typeof log.detail === "object" ? JSON.stringify(log.detail) : (log.detail ?? "-");
                return (
                  <tr key={log.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                    <td style={{ padding: "10px 14px", fontSize: "12px", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{date(log.created_at)}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>{log.admin_name ?? log.admin_id ?? "-"}</td>
                    <td style={{ padding: "10px 14px" }}><span style={{ padding: "2px 8px", background: ac.bg, color: ac.color, borderRadius: "8px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" }}>{log.action ?? "-"}</span></td>
                    <td style={{ padding: "10px 14px", fontSize: "12px", color: "var(--text-muted)" }}>{log.target_type ?? "-"} {log.target_id ? `#${String(log.target_id).slice(-6)}` : ""}</td>
                    <td style={{ padding: "10px 14px", fontSize: "11px", color: "var(--text-faint)", fontFamily: "monospace" }}>{log.ip_address ?? "-"}</td>
                    <td style={{ padding: "10px 14px", fontSize: "11px", color: "var(--text-muted)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(detail).slice(0, 80)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>감사 로그가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
