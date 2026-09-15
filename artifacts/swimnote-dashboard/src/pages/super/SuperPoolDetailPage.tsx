import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api-client";
import { ArrowLeft, RefreshCw, Brain, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

type PoolDetail = {
  id: string;
  name: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  status?: string;
  x_mode?: string;
  plan_key?: string;
  is_x?: boolean;
  x_entitlement_status?: string;
  member_count?: number;
  active_member_count?: number;
  teacher_count?: number;
  class_count?: number;
  created_at?: string;
  last_active_at?: string;
  billing?: {
    plan?: string;
    status?: string;
    current_period_end?: string;
    amount?: number;
  };
  storage?: { used_bytes?: number; limit_bytes?: number };
  growth_reports?: { total?: number; pending?: number; published?: number };
  ai_credits?: number;
  recent_members?: Array<{ id: string; name: string; status: string; created_at?: string }>;
  recent_classes?: Array<{ id: string; name: string; member_count?: number }>;
  [key: string]: unknown;
};

type CreditInfo = { pool_id: string; balance: number; updated_at?: string; pool_name?: string };

const fmt = (n: number | undefined) => (n == null ? "-" : n.toLocaleString("ko-KR"));
const money = (n: number | undefined) => (n == null ? "-" : `${n.toLocaleString("ko-KR")}원`);
const date = (s: string | undefined) => s ? new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-";
const bytes = (b: number | undefined) => {
  if (b == null) return "-";
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
};

type Tab = "overview" | "members" | "billing" | "ai" | "control";

export default function SuperPoolDetailPage() {
  const [, params] = useRoute("/super/pools/:id");
  const [, navigate] = useLocation();
  const id = params?.id ?? "";
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [creditAmount, setCreditAmount] = useState("");

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ["super", "pool-detail", id],
    queryFn: () => api.get<PoolDetail>(`/super/operators/${id}`),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const { data: credits, refetch: refetchCredits } = useQuery({
    queryKey: ["super", "pool-credits", id],
    queryFn: () => api.get<CreditInfo>(`/super/pools/${id}/credits`),
    enabled: !!id && tab === "ai",
  });

  const { data: summary } = useQuery({
    queryKey: ["super", "pool-control", id],
    queryFn: () => api.get<Record<string, unknown>>(`/super/pools/${id}/control-center/summary`),
    enabled: !!id && tab === "control",
    refetchInterval: 30_000,
  });

  const approveMut = useMutation({ mutationFn: () => api.patch(`/super/operators/${id}/approve`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "pool-detail", id] }); } });
  const restrictMut = useMutation({ mutationFn: () => api.patch(`/super/operators/${id}/restrict`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "pool-detail", id] }); } });
  const creditMut = useMutation({ mutationFn: (amount: number) => api.post(`/super/pools/${id}/credits`, { amount }), onSuccess: () => { refetchCredits(); setCreditAmount(""); } });

  const xGrantMut = useMutation({ mutationFn: (grant: boolean) => api.patch(`/super/operators/${id}/xmode`, { grant }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "pool-detail", id] }); } });

  if (!id) return <div style={{ padding: "32px" }}>잘못된 접근입니다.</div>;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "기본 정보" },
    { key: "members", label: "회원·반" },
    { key: "billing", label: "결제" },
    { key: "ai", label: "AI 크레딧" },
    { key: "control", label: "컨트롤센터" },
  ];

  const xMode = detail?.x_mode ?? detail?.plan_key ?? "";
  const isX = detail?.is_x || xMode.includes("x");

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1000px" }}>
      {/* Back */}
      <button onClick={() => navigate("/super/pools")} style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: "13px", marginBottom: "20px" }}>
        <ArrowLeft size={15} /> 수영장 목록으로
      </button>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>불러오는 중...</div>
      ) : !detail ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>수영장 정보를 찾을 수 없습니다.</div>
      ) : (
        <>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>{detail.name}</h1>
                <span style={{ padding: "2px 10px", background: isX ? "#EDE9FE" : "#F3F4F6", color: isX ? "#7C3AED" : "#6B7280", borderRadius: "12px", fontSize: "12px", fontWeight: 700 }}>{isX ? "X" : "일반"}</span>
                <span style={{ padding: "2px 10px", background: detail.status === "active" ? "#DCFCE7" : "#FEE2E2", color: detail.status === "active" ? "#166534" : "#991B1B", borderRadius: "12px", fontSize: "12px", fontWeight: 600 }}>{detail.status === "active" ? "운영중" : (detail.status ?? "-")}</span>
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>{detail.owner_name} · {detail.owner_email}</div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}>
                <RefreshCw size={13} />새로고침
              </button>
              {detail.status === "pending" && (
                <button onClick={() => approveMut.mutate()} style={{ padding: "8px 14px", background: "#166534", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontWeight: 700 }}>승인</button>
              )}
              {detail.status === "active" && (
                <button onClick={() => restrictMut.mutate()} style={{ padding: "8px 14px", background: "#FEE2E2", color: "#991B1B", border: "none", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontWeight: 700 }}>제한</button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "2px", marginBottom: "24px", borderBottom: "1px solid var(--border-default)" }}>
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--x-primary)" : "2px solid transparent", marginBottom: "-1px", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? "var(--x-primary)" : "var(--text-muted)", cursor: "pointer" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {tab === "overview" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
                {[
                  { label: "전체 회원", value: fmt(detail.member_count) + "명" },
                  { label: "활성 회원", value: fmt(detail.active_member_count) + "명" },
                  { label: "선생님", value: fmt(detail.teacher_count) + "명" },
                  { label: "반 수", value: fmt(detail.class_count) + "개" },
                ].map((kpi) => (
                  <div key={kpi.label} style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "16px" }}>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-strong)", marginBottom: "4px" }}>{kpi.value}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{kpi.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "20px", marginBottom: "16px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "16px" }}>기본 정보</div>
                {[
                  { label: "운영자명", value: detail.owner_name },
                  { label: "이메일", value: detail.owner_email },
                  { label: "전화번호", value: detail.owner_phone },
                  { label: "가입일", value: date(detail.created_at as string) },
                  { label: "마지막 활동", value: date(detail.last_active_at as string) },
                  { label: "스토리지 사용", value: bytes(detail.storage?.used_bytes) + " / " + bytes(detail.storage?.limit_bytes) },
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <div style={{ width: "140px", fontSize: "13px", color: "var(--text-muted)", fontWeight: 500 }}>{row.label}</div>
                    <div style={{ fontSize: "13px", color: "var(--text-body)" }}>{row.value ?? "-"}</div>
                  </div>
                ))}
              </div>

              {/* X Mode Toggle */}
              <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "20px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "12px" }}>X 모드 제어</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>현재 상태: <strong style={{ color: isX ? "#7C3AED" : "#6B7280" }}>{isX ? "X 활성" : "일반"}</strong></div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => xGrantMut.mutate(true)} disabled={isX} style={{ padding: "8px 16px", background: isX ? "#F3F4F6" : "#7C3AED", color: isX ? "#9CA3AF" : "#fff", border: "none", borderRadius: "8px", fontSize: "12px", cursor: isX ? "not-allowed" : "pointer", fontWeight: 700 }}>X 부여</button>
                    <button onClick={() => xGrantMut.mutate(false)} disabled={!isX} style={{ padding: "8px 16px", background: !isX ? "#F3F4F6" : "#FEE2E2", color: !isX ? "#9CA3AF" : "#991B1B", border: "none", borderRadius: "8px", fontSize: "12px", cursor: !isX ? "not-allowed" : "pointer", fontWeight: 700 }}>X 해제</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "members" && (
            <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-default)", fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>최근 회원 ({fmt(detail.member_count)}명)</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--surface-subtle)" }}>
                  {["이름", "상태", "가입일"].map(h => <th key={h} style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(detail.recent_members ?? []).map((m, i) => (
                    <tr key={m.id} style={{ borderBottom: "1px solid var(--border-default)" }}>
                      <td style={{ padding: "10px 16px", fontSize: "13px", fontWeight: 500 }}>{m.name}</td>
                      <td style={{ padding: "10px 16px" }}><span style={{ padding: "2px 8px", background: m.status === "active" ? "#DCFCE7" : "#F3F4F6", color: m.status === "active" ? "#166534" : "#6B7280", borderRadius: "10px", fontSize: "11px" }}>{m.status === "active" ? "재원" : m.status}</span></td>
                      <td style={{ padding: "10px 16px", fontSize: "12px", color: "var(--text-muted)" }}>{date(m.created_at)}</td>
                    </tr>
                  ))}
                  {(detail.recent_members ?? []).length === 0 && <tr><td colSpan={3} style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>데이터가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === "billing" && (
            <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "20px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "16px" }}>결제 정보</div>
              {detail.billing ? (
                [
                  { label: "플랜", value: detail.billing.plan },
                  { label: "결제 상태", value: detail.billing.status },
                  { label: "다음 결제일", value: date(detail.billing.current_period_end) },
                  { label: "결제 금액", value: money(detail.billing.amount) },
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <div style={{ width: "140px", fontSize: "13px", color: "var(--text-muted)" }}>{row.label}</div>
                    <div style={{ fontSize: "13px", color: "var(--text-body)", fontWeight: 500 }}>{row.value ?? "-"}</div>
                  </div>
                ))
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>결제 정보가 없습니다.</div>
              )}
            </div>
          )}

          {tab === "ai" && (
            <div>
              <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "24px", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                  <Brain size={24} style={{ color: "#7C3AED" }} />
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>AI 크레딧 잔액</div>
                    <div style={{ fontSize: "28px", fontWeight: 800, color: "#7C3AED" }}>{fmt(credits?.balance)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="충전할 크레딧 수량" style={{ height: "36px", padding: "0 12px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", width: "180px" }} />
                  <button onClick={() => creditMut.mutate(Number(creditAmount))} disabled={!creditAmount || creditMut.isPending} style={{ padding: "0 16px", height: "36px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: 700 }}>충전</button>
                </div>
              </div>
            </div>
          )}

          {tab === "control" && (
            <div>
              {summary ? (
                <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "16px" }}>컨트롤센터 요약</div>
                  <pre style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(summary, null, 2)}</pre>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
