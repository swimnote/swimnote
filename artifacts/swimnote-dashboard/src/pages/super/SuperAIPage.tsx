import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Brain, RefreshCw, CheckCircle, XCircle, Archive } from "lucide-react";

type KnowledgeItem = {
  id: string;
  title?: string;
  question?: string;
  answer?: string;
  status?: string;
  scope?: string;
  answer_mode?: string;
  created_at?: string;
  updated_at?: string;
  approval_count?: number;
  category?: string;
};

type CreditRow = {
  pool_id: string;
  pool_name?: string;
  balance: number;
  updated_at?: string;
};

const statusInfo = (s: string | undefined) => {
  if (s === "active") return { label: "활성", bg: "#DCFCE7", color: "#166534" };
  if (s === "pending") return { label: "검토중", bg: "#E0F2FE", color: "#0369A1" };
  if (s === "archived") return { label: "보관", bg: "#F3F4F6", color: "#6B7280" };
  if (s === "inactive") return { label: "비활성", bg: "#FEF9C3", color: "#92400E" };
  return { label: s ?? "-", bg: "#F3F4F6", color: "#6B7280" };
};

const fmt = (n: number | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR"));

type ActiveTab = "knowledge" | "credits";

export default function SuperAIPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ActiveTab>("knowledge");
  const [filterStatus, setFilterStatus] = useState<string>("active");

  const { data: knowledge = [], isLoading: knowledgeLoading, refetch: refetchKnowledge } = useQuery({
    queryKey: ["super", "knowledge", filterStatus],
    queryFn: () => api.get<KnowledgeItem[]>(`/super/support/knowledge/list?status=${filterStatus}`),
    refetchInterval: 60_000,
  });

  // Credits: list by pool via pools-summary (if available)
  const { data: pools = [] } = useQuery({
    queryKey: ["super", "pools-summary-credits"],
    queryFn: () => api.get<Array<{ id: string; name: string; ai_credits?: number }>>("/super/pools-summary"),
    enabled: tab === "credits",
    refetchInterval: 60_000,
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => api.patch(`/super/support/knowledge/${id}/deactivate`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super", "knowledge"] }),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/super/support/knowledge/${id}/archive`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super", "knowledge"] }),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/super/support/knowledge/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super", "knowledge"] }),
  });

  const KI_FILTERS = ["active", "pending", "inactive", "archived"];

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1100px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>AI · 지식 관리</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>지식 베이스 · AI 크레딧 현황</div>
        </div>
        <button onClick={() => refetchKnowledge()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
          <RefreshCw size={14} />새로고침
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "2px", marginBottom: "20px", borderBottom: "1px solid var(--border-default)" }}>
        {[{ key: "knowledge" as ActiveTab, label: `지식 베이스 (${knowledge.length})` }, { key: "credits" as ActiveTab, label: "AI 크레딧" }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--x-primary)" : "2px solid transparent", marginBottom: "-1px", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? "var(--x-primary)" : "var(--text-muted)", cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "knowledge" && (
        <>
          {/* Status filters */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            {KI_FILTERS.map((f) => (
              <button key={f} onClick={() => setFilterStatus(f)} style={{ padding: "6px 14px", borderRadius: "20px", border: "1px solid", fontSize: "13px", cursor: "pointer", fontWeight: filterStatus === f ? 700 : 500, background: filterStatus === f ? "var(--x-primary)" : "var(--surface-white)", color: filterStatus === f ? "#fff" : "var(--text-muted)", borderColor: filterStatus === f ? "var(--x-primary)" : "var(--border-default)" }}>
                {f === "active" ? "활성" : f === "pending" ? "검토중" : f === "inactive" ? "비활성" : "보관"}
              </button>
            ))}
          </div>

          <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
            {knowledgeLoading ? (
              <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--surface-subtle)" }}>
                  {["제목 / 질문", "카테고리", "범위", "상태", ""].map((h) => (
                    <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {knowledge.map((ki, i) => {
                    const s = statusInfo(ki.status);
                    return (
                      <tr key={ki.id} style={{ borderBottom: i < knowledge.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                        <td style={{ padding: "12px 14px", maxWidth: "320px" }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ki.title ?? ki.question ?? "-"}</div>
                          {ki.answer && <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ki.answer}</div>}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-muted)" }}>{ki.category ?? "-"}</td>
                        <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-muted)" }}>{ki.scope ?? "global"}</td>
                        <td style={{ padding: "12px 14px" }}><span style={{ padding: "2px 8px", background: s.bg, color: s.color, borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>{s.label}</span></td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {ki.status === "pending" && (
                              <button onClick={() => approveMut.mutate(ki.id)} style={{ padding: "4px 8px", background: "#DCFCE7", color: "#166534", border: "none", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: "3px" }}>
                                <CheckCircle size={10} />승인
                              </button>
                            )}
                            {ki.status === "active" && (
                              <button onClick={() => deactivateMut.mutate(ki.id)} style={{ padding: "4px 8px", background: "#FEF9C3", color: "#92400E", border: "none", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: "3px" }}>
                                <XCircle size={10} />비활성
                              </button>
                            )}
                            {ki.status !== "archived" && (
                              <button onClick={() => archiveMut.mutate(ki.id)} style={{ padding: "4px 8px", background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: "6px", fontSize: "11px", cursor: "pointer", display: "flex", alignItems: "center", gap: "3px" }}>
                                <Archive size={10} />보관
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {knowledge.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                      <Brain size={24} style={{ display: "block", margin: "0 auto 8px", opacity: 0.3 }} />
                      지식 항목이 없습니다.
                    </td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "credits" && (
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--surface-subtle)" }}>
              {["수영장명", "AI 크레딧 잔액"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {pools.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: i < pools.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                  <td style={{ padding: "12px 16px", fontSize: "13px", fontWeight: 600, color: "var(--text-strong)" }}>{p.name}</td>
                  <td style={{ padding: "12px 16px", fontSize: "13px", color: "var(--text-body)", fontWeight: 700 }}>
                    <span style={{ color: "#7C3AED" }}>{fmt(p.ai_credits)}</span>
                  </td>
                </tr>
              ))}
              {pools.length === 0 && (
                <tr><td colSpan={2} style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>데이터를 불러오는 중...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
