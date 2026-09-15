import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RefreshCw, Server, AlertTriangle, CheckCircle, Clock } from "lucide-react";

type ServerStatus = {
  name: string;
  status: string;
  latency_ms?: number;
  uptime_pct?: number;
  last_check?: string;
  region?: string;
  version?: string;
  worker_type?: string;
  [key: string]: unknown;
};

type Incident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at?: string;
  resolved_at?: string;
  description?: string;
  affected_pools?: number;
  [key: string]: unknown;
};

const serverStatusInfo = (s: string) => {
  if (s === "healthy" || s === "ok") return { label: "정상", bg: "#DCFCE7", color: "#166534", dot: "#22C55E" };
  if (s === "degraded") return { label: "성능 저하", bg: "#FFF7ED", color: "#EA580C", dot: "#F97316" };
  if (s === "down" || s === "error") return { label: "장애", bg: "#FEE2E2", color: "#991B1B", dot: "#EF4444" };
  return { label: s, bg: "#F3F4F6", color: "#6B7280", dot: "#9CA3AF" };
};

const severityInfo = (s: string) => {
  if (s === "critical") return { label: "심각", color: "#DC2626", bg: "#FEE2E2" };
  if (s === "high") return { label: "높음", color: "#EA580C", bg: "#FFF7ED" };
  if (s === "medium") return { label: "보통", color: "#D97706", bg: "#FFFBEB" };
  return { label: "낮음", color: "#6B7280", bg: "#F3F4F6" };
};

const date = (s: string | undefined) => s ? new Date(s).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";

type ActiveTab = "servers" | "incidents";

export default function SuperServersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ActiveTab>("servers");
  const [newIncident, setNewIncident] = useState<{ title: string; description: string; severity: string } | null>(null);

  const { data: servers = [], isLoading: serversLoading, refetch: refetchServers } = useQuery({
    queryKey: ["super", "servers-status"],
    queryFn: () => api.get<ServerStatus[]>("/super/servers/status"),
    refetchInterval: 15_000,
  });

  const { data: incidents = [], isLoading: incidentsLoading, refetch: refetchIncidents } = useQuery({
    queryKey: ["super", "incidents"],
    queryFn: () => api.get<Incident[]>("/super/incidents"),
    refetchInterval: 30_000,
  });

  const createIncidentMut = useMutation({
    mutationFn: (data: { title: string; description: string; severity: string }) => api.post("/super/incidents", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "incidents"] }); setNewIncident(null); },
  });

  const resolveIncidentMut = useMutation({
    mutationFn: (id: string) => api.patch(`/super/incidents/${id}`, { status: "resolved" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "incidents"] }); },
  });

  const healthyCount = servers.filter((s) => s.status === "healthy" || s.status === "ok").length;
  const openIncidents = incidents.filter((i) => i.status !== "resolved");

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1100px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>서버 · 장애</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>15초 자동 갱신</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {tab === "incidents" && (
            <button onClick={() => setNewIncident({ title: "", description: "", severity: "medium" })} style={{ padding: "8px 14px", background: "var(--x-primary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: 700 }}>+ 장애 등록</button>
          )}
          <button onClick={() => tab === "servers" ? refetchServers() : refetchIncidents()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
            <RefreshCw size={14} />새로고침
          </button>
        </div>
      </div>

      {/* Status summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
        {[
          { label: "정상 서버", value: `${healthyCount}/${servers.length}`, icon: <Server size={18} />, color: healthyCount === servers.length ? "#059669" : "#D97706" },
          { label: "진행중 장애", value: String(openIncidents.length), icon: <AlertTriangle size={18} />, color: openIncidents.length > 0 ? "#DC2626" : "#059669" },
          { label: "전체 장애 이력", value: String(incidents.length), icon: <Clock size={18} />, color: "#6B7280" },
        ].map((k) => (
          <div key={k.label} style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "16px" }}>
            <div style={{ color: k.color, marginBottom: "8px" }}>{k.icon}</div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "2px", marginBottom: "16px", borderBottom: "1px solid var(--border-default)" }}>
        {[{ key: "servers" as ActiveTab, label: "서버 상태" }, { key: "incidents" as ActiveTab, label: `장애 관리 (${incidents.length})` }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--x-primary)" : "2px solid transparent", marginBottom: "-1px", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? "var(--x-primary)" : "var(--text-muted)", cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* New Incident Form */}
      {newIncident && (
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "20px", marginBottom: "16px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "16px" }}>장애 등록</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <input value={newIncident.title} onChange={(e) => setNewIncident({ ...newIncident, title: e.target.value })} placeholder="장애 제목" style={{ height: "36px", padding: "0 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px" }} />
            <select value={newIncident.severity} onChange={(e) => setNewIncident({ ...newIncident, severity: e.target.value })} style={{ height: "36px", padding: "0 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px" }}>
              <option value="critical">심각</option>
              <option value="high">높음</option>
              <option value="medium">보통</option>
              <option value="low">낮음</option>
            </select>
            <textarea value={newIncident.description} onChange={(e) => setNewIncident({ ...newIncident, description: e.target.value })} placeholder="장애 설명" style={{ height: "72px", padding: "10px 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", resize: "none" }} />
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => createIncidentMut.mutate(newIncident)} disabled={!newIncident.title} style={{ padding: "8px 20px", background: "var(--x-primary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: 700 }}>등록</button>
              <button onClick={() => setNewIncident(null)} style={{ padding: "8px 16px", background: "var(--surface-subtle)", color: "var(--text-muted)", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {tab === "servers" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
          {serversLoading ? (
            [...Array(6)].map((_, i) => <div key={i} style={{ height: "100px", background: "var(--surface-white)", borderRadius: "10px", border: "1px solid var(--border-default)", animation: "pulse 1.5s ease-in-out infinite" }} />)
          ) : servers.length === 0 ? (
            <div style={{ gridColumn: "span 2", padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px", background: "var(--surface-white)", borderRadius: "12px", border: "1px solid var(--border-default)" }}>서버 상태 데이터가 없습니다.</div>
          ) : servers.map((srv) => {
            const info = serverStatusInfo(srv.status);
            return (
              <div key={srv.name} style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: info.dot }} />
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>{srv.name}</div>
                  </div>
                  <span style={{ padding: "2px 8px", background: info.bg, color: info.color, borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>{info.label}</span>
                </div>
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  {srv.latency_ms != null && <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>응답: <strong>{srv.latency_ms}ms</strong></div>}
                  {srv.uptime_pct != null && <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>업타임: <strong>{srv.uptime_pct.toFixed(2)}%</strong></div>}
                  {srv.region && <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>지역: <strong>{srv.region}</strong></div>}
                  {srv.version && <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>버전: <strong>{srv.version}</strong></div>}
                </div>
                {srv.last_check && <div style={{ fontSize: "11px", color: "var(--text-faint)", marginTop: "8px" }}>최종 확인: {date(srv.last_check)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {tab === "incidents" && (
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
          {incidentsLoading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--surface-subtle)" }}>
                {["심각도", "제목", "상태", "영향 수영장", "발생일", "해결일", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {incidents.map((inc, i) => {
                  const sev = severityInfo(inc.severity);
                  const isOpen = inc.status !== "resolved";
                  return (
                    <tr key={inc.id} style={{ borderBottom: i < incidents.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                      <td style={{ padding: "12px 14px" }}><span style={{ padding: "2px 8px", background: sev.bg, color: sev.color, borderRadius: "10px", fontSize: "11px", fontWeight: 700 }}>{sev.label}</span></td>
                      <td style={{ padding: "12px 14px", fontSize: "13px", fontWeight: 500, color: "var(--text-strong)" }}>{inc.title}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ padding: "2px 8px", background: isOpen ? "#FEE2E2" : "#DCFCE7", color: isOpen ? "#991B1B" : "#166534", borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>
                          {isOpen ? "진행중" : "해결됨"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--text-muted)" }}>{inc.affected_pools ?? "-"}</td>
                      <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-muted)" }}>{date(inc.created_at)}</td>
                      <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-muted)" }}>{date(inc.resolved_at)}</td>
                      <td style={{ padding: "12px 14px" }}>
                        {isOpen && (
                          <button onClick={() => resolveIncidentMut.mutate(inc.id)} style={{ padding: "4px 10px", background: "#DCFCE7", color: "#166534", border: "none", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                            <CheckCircle size={11} />해결
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {incidents.length === 0 && <tr><td colSpan={7} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>장애 이력이 없습니다.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </div>
  );
}
