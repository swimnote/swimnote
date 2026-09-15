import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RefreshCw, MessageSquare, CheckCircle, Phone } from "lucide-react";

type SupportCase = {
  id: string;
  pool_name?: string;
  user_name?: string;
  subject?: string;
  status?: string;
  priority?: string;
  created_at?: string;
  updated_at?: string;
  last_message?: string;
  message_count?: number;
  category?: string;
  assignee?: string;
};

type SupportStats = {
  total: number;
  open: number;
  resolved: number;
  avg_response_time_minutes?: number;
  human_required?: number;
};

const statusInfo = (s: string | undefined) => {
  if (s === "open") return { label: "열림", bg: "#E0F2FE", color: "#0369A1" };
  if (s === "ai_processing") return { label: "AI 처리중", bg: "#EDE9FE", color: "#7C3AED" };
  if (s === "human_required") return { label: "인간 필요", bg: "#FFF7ED", color: "#EA580C" };
  if (s === "resolved") return { label: "해결됨", bg: "#DCFCE7", color: "#166534" };
  if (s === "closed") return { label: "닫힘", bg: "#F3F4F6", color: "#6B7280" };
  return { label: s ?? "-", bg: "#F3F4F6", color: "#6B7280" };
};

const priorityInfo = (p: string | undefined) => {
  if (p === "high" || p === "urgent") return { label: "긴급", color: "#DC2626" };
  if (p === "normal") return { label: "일반", color: "#6B7280" };
  return { label: p ?? "-", color: "#9CA3AF" };
};

const date = (s: string | undefined) => s ? new Date(s).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";

type FilterStatus = "all" | "open" | "human_required" | "resolved";

export default function SuperSupportPage() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selectedCase, setSelectedCase] = useState<SupportCase | null>(null);
  const [reply, setReply] = useState("");

  const { data: stats } = useQuery({
    queryKey: ["super", "support-stats"],
    queryFn: () => api.get<SupportStats>("/super/support/stats"),
    refetchInterval: 30_000,
  });

  const { data: cases = [], isLoading, refetch } = useQuery({
    queryKey: ["super", "support-cases", filterStatus],
    queryFn: () => api.get<SupportCase[]>(`/super/support/cases?status=${filterStatus === "all" ? "" : filterStatus}`),
    refetchInterval: 30_000,
  });

  const { data: caseDetail } = useQuery({
    queryKey: ["super", "support-case", selectedCase?.id],
    queryFn: () => api.get<Record<string, unknown>>(`/super/support/cases/${selectedCase!.id}`),
    enabled: !!selectedCase,
  });

  const replyMut = useMutation({
    mutationFn: ({ id, msg }: { id: string; msg: string }) => api.post(`/super/support/cases/${id}/agent-reply`, { message: msg }),
    onSuccess: () => { setReply(""); qc.invalidateQueries({ queryKey: ["super", "support-cases"] }); qc.invalidateQueries({ queryKey: ["super", "support-case", selectedCase?.id] }); },
  });

  const resolveMut = useMutation({
    mutationFn: (id: string) => api.post(`/super/support/cases/${id}/resolve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "support-cases"] }); setSelectedCase(null); },
  });

  const FILTERS: { key: FilterStatus; label: string; count?: number }[] = [
    { key: "all", label: `전체 (${stats?.total ?? cases.length})` },
    { key: "open", label: `열림 (${stats?.open ?? 0})` },
    { key: "human_required", label: `인간 필요 (${stats?.human_required ?? 0})` },
    { key: "resolved", label: "해결됨" },
  ];

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1200px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>고객지원</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>지원 케이스 · 30초 자동 갱신</div>
        </div>
        <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
          <RefreshCw size={14} />새로고침
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
          {[
            { label: "전체", value: stats.total, icon: <MessageSquare size={18} />, color: "#1D4E8F" },
            { label: "열린 케이스", value: stats.open, icon: <MessageSquare size={18} />, color: "#0891B2" },
            { label: "인간 필요", value: stats.human_required ?? 0, icon: <Phone size={18} />, color: "#EA580C" },
            { label: "해결됨", value: stats.resolved, icon: <CheckCircle size={18} />, color: "#059669" },
          ].map((k) => (
            <div key={k.label} style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "16px" }}>
              <div style={{ color: k.color, marginBottom: "8px" }}>{k.icon}</div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)" }}>{k.value?.toLocaleString("ko-KR")}</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilterStatus(f.key)} style={{ padding: "6px 14px", borderRadius: "20px", border: "1px solid", fontSize: "13px", cursor: "pointer", fontWeight: filterStatus === f.key ? 700 : 500, background: filterStatus === f.key ? "var(--x-primary)" : "var(--surface-white)", color: filterStatus === f.key ? "#fff" : "var(--text-muted)", borderColor: filterStatus === f.key ? "var(--x-primary)" : "var(--border-default)" }}>
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selectedCase ? "1fr 400px" : "1fr", gap: "16px" }}>
        {/* Cases Table */}
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
          {isLoading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--surface-subtle)" }}>
                {["우선순위", "제목", "수영장", "상태", "마지막 업데이트"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {cases.map((c, i) => {
                  const s = statusInfo(c.status);
                  const p = priorityInfo(c.priority);
                  const isSelected = selectedCase?.id === c.id;
                  return (
                    <tr key={c.id} onClick={() => setSelectedCase(isSelected ? null : c)} style={{ borderBottom: i < cases.length - 1 ? "1px solid var(--border-default)" : "none", cursor: "pointer", background: isSelected ? "var(--x-accent-soft, #E8F2FC)" : "" }}
                      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--surface-subtle)"; }}
                      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = ""; }}
                    >
                      <td style={{ padding: "12px 14px" }}><span style={{ fontSize: "12px", fontWeight: 700, color: p.color }}>{p.label}</span></td>
                      <td style={{ padding: "12px 14px", fontSize: "13px", fontWeight: 500, color: "var(--text-strong)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject ?? "-"}</td>
                      <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-muted)" }}>{c.pool_name ?? c.user_name ?? "-"}</td>
                      <td style={{ padding: "12px 14px" }}><span style={{ padding: "2px 8px", background: s.bg, color: s.color, borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>{s.label}</span></td>
                      <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-faint)" }}>{date(c.updated_at)}</td>
                    </tr>
                  );
                })}
                {cases.length === 0 && <tr><td colSpan={5} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>케이스가 없습니다.</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        {/* Case Detail Panel */}
        {selectedCase && (
          <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "12px", height: "fit-content" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>{selectedCase.subject}</div>
              <button onClick={() => setSelectedCase(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "var(--text-muted)" }}>×</button>
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{selectedCase.pool_name} · {date(selectedCase.created_at)}</div>

            {/* Messages */}
            <div style={{ maxHeight: "300px", overflowY: "auto", background: "var(--surface-subtle)", borderRadius: "8px", padding: "12px" }}>
              {caseDetail ? (
                <pre style={{ fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, color: "var(--text-body)" }}>{JSON.stringify(caseDetail, null, 2)}</pre>
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>불러오는 중...</div>
              )}
            </div>

            {/* Reply */}
            {selectedCase.status !== "resolved" && (
              <>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="답변 메시지 입력..." style={{ height: "80px", padding: "10px 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", resize: "none", outline: "none" }} />
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => replyMut.mutate({ id: selectedCase.id, msg: reply })} disabled={!reply.trim() || replyMut.isPending} style={{ flex: 1, padding: "10px", background: "var(--x-primary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: 700 }}>답변 전송</button>
                  <button onClick={() => resolveMut.mutate(selectedCase.id)} style={{ padding: "10px 14px", background: "#DCFCE7", color: "#166534", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: 700 }}>해결</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
