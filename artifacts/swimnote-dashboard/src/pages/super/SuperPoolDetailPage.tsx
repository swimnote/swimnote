import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { api } from "@/lib/api-client";
import { getToken } from "@/lib/token";
import { ArrowLeft, RefreshCw, Brain, Wifi, WifiOff } from "lucide-react";

// ── 구독 플랜 상수 ───────────────────────────────────────────────────────────
const TIER_LABEL: Record<string, string> = {
  // 신규 체계
  free:      "Free (미구독)",
  swimnote:  "SWIMNOTE",
  // legacy (구 플랜)
  starter:       "구 플랜 · Starter",
  basic:         "구 플랜 · Basic",
  standard:      "구 플랜 · Standard",
  center_200:    "구 플랜 · Center 200",
  advance:       "구 플랜 · Advance",
  pro:           "구 플랜 · Pro",
  max:           "구 플랜 · Max",
  trial:         "구 플랜 · Trial",
  coach30:       "구 플랜 · Coach 30",
  coach50:       "구 플랜 · Coach 50",
  coach100:      "구 플랜 · Coach 100",
  premier200:    "구 플랜 · Premier 200",
  premier300:    "구 플랜 · Premier 300",
  premier500:    "구 플랜 · Premier 500",
  premier1000:   "구 플랜 · Premier 1000",
};
const LEGACY_TIERS = new Set([
  "starter","basic","standard","center_200","advance","pro","max","trial",
  "coach30","coach50","coach100","premier200","premier300","premier500","premier1000",
]);
const X_PLAN_LABEL: Record<string, string> = {
  x300: "X300", x500: "X500", x1000: "X1000",
};
const STATUS_LABEL: Record<string, string> = {
  trial: "체험", active: "활성", expired: "만료", suspended: "정지",
  cancelled: "해지", payment_failed: "결제실패",
};
const ALLOWED_STATUSES = ["trial","active","expired","suspended","cancelled","payment_failed"] as const;

type PoolSummary = {
  pool_id: string;
  name: string;
  owner_name?: string;
  approval_status?: string;
  created_at?: string;
  updated_at?: string;
  health?: "GREEN" | "YELLOW" | "RED";
  health_issues?: string[];
  // BASE
  base_effective?: boolean;
  base_source?: string;
  subscription_status?: string;
  subscription_tier?: string;
  subscription_end_at?: string;
  payment_failed_at?: string;
  // X
  x_effective?: boolean;
  x_paid?: boolean;
  x_manual?: boolean;
  x_management_override?: boolean;
  x_force_disabled?: boolean;
  x_source?: string;
  x_plan_key?: string;
  xmode_config_status?: string;
  // Counts
  active_members?: number;
  total_members?: number;
  teacher_count?: number;
  parent_count?: number;
  active_class_count?: number;
  // Member limit
  member_limit?: number | null;
  member_limit_remaining?: number | null;
  member_limit_warn?: boolean;
  member_limit_unavailable?: boolean;
  // Storage
  used_storage_bytes?: number;
  base_storage_gb?: number;
  extra_storage_gb?: number;
  effective_storage_bytes?: number | null;
  upload_blocked?: boolean;
  storage_unavailable?: boolean;
  // Push fanout
  push_pending_jobs?: number | null;
  push_failed_jobs?: number | null;
  push_partial_jobs?: number | null;
  push_completed_24h?: number | null;
  push_recent_delivery_failures?: number | null;
  push_unavailable?: boolean;
  // AI
  recent_ai_diary_count?: number | null;
  recent_ai_month?: string | null;
  ai_unavailable?: boolean;
  // Growth Report
  gr_ready_count?: number | null;
  gr_failed_count?: number | null;
  gr_total_count?: number | null;
  gr_unavailable?: boolean;
  // Event log
  recent_event_count?: number | null;
  last_event_at?: string | null;
  event_log_unavailable?: boolean;
  // Notifications
  unread_notifications?: number | null;
  notifications_unavailable?: boolean;
  // Support
  recent_support?: { id: string; state: string; actor_role?: string; created_at?: string } | null;
  support_unavailable?: boolean;
};

type PoolDetail = {
  id: string;
  name: string;
  owner_name?: string;
  owner_email?: string;
  status?: string;
  x_mode?: string;
  plan_key?: string;
  is_x?: boolean;
  member_count?: number;
  active_member_count?: number;
  teacher_count?: number;
  class_count?: number;
  created_at?: string;
  storage?: { used_bytes?: number; limit_bytes?: number };
  billing?: { plan?: string; status?: string; current_period_end?: string; amount?: number };
  recent_members?: Array<{ id: string; name: string; status: string; created_at?: string }>;
  // 구독 직접 조정용
  subscription_tier?: string;
  subscription_status?: string;
  subscription_end_at?: string;
  member_limit?: number | null;
  credit_balance?: number;
  // X
  x_plan_key?: string;
  xmode_entitlement?: boolean;
  x_trial_used?: boolean;
  x_trial_started_at?: string;
  x_trial_ends_at?: string;
  [key: string]: unknown;
};

type CreditInfo = { pool_id: string; balance: number; pool_name?: string };

const fmt = (n?: number | null) => (n == null ? "-" : n.toLocaleString("ko-KR"));
const date = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-";
const bytes = (b?: number | null) => {
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
  const [sseConnected, setSseConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // 구독 직접 조정 상태
  const [subTier, setSubTier] = useState("");
  const [subStatus, setSubStatus] = useState("");
  const [subEndAt, setSubEndAt] = useState("");
  const [subMemberLimit, setSubMemberLimit] = useState("");
  const [subSaveMsg, setSubSaveMsg] = useState<string | null>(null);

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ["super", "pool-detail", id],
    queryFn: async (): Promise<PoolDetail> => {
      const data = await api.get<any>(`/super/operators/${id}`);
      const p = data.pool ?? {};
      return {
        id: p.id,
        name: p.name,
        owner_name: p.owner_name ?? p.admin_name,
        owner_email: p.owner_email ?? p.admin_email,
        // approval/subscription combined status: show approval first, then subscription
        status: p.approval_status === "pending" ? "pending"
              : p.approval_status === "rejected" ? "rejected"
              : p.subscription_status === "active" ? "active"
              : p.subscription_status ?? p.approval_status,
        x_mode: p.x_plan_key,
        is_x: p.xmode_entitlement,
        member_count: p.total_member_count,
        active_member_count: p.active_member_count,
        teacher_count: p.teacher_count,
        class_count: p.total_class_count,
        created_at: p.created_at,
        storage: {
          used_bytes: p.used_storage_bytes,
          limit_bytes: p.storage_mb != null ? p.storage_mb * 1024 * 1024 : null,
        },
        billing: {
          plan: p.plan_name ?? p.subscription_plan_name,
          status: p.subscription_status,
          current_period_end: p.subscription_end_at ?? p.subscription_ends_at,
        },
        // 구독 직접 조정용
        subscription_tier: p.subscription_tier,
        subscription_status: p.subscription_status,
        subscription_end_at: p.subscription_end_at ?? p.subscription_ends_at,
        member_limit: p.member_limit ?? null,
        credit_balance: p.credit_balance ?? 0,
        x_plan_key: p.x_plan_key,
        xmode_entitlement: !!p.xmode_entitlement,
        x_trial_used: !!p.x_trial_used,
        x_trial_started_at: p.x_trial_started_at,
        x_trial_ends_at: p.x_trial_ends_at,
        // teachers 배열을 recent_members 형태로 매핑
        recent_members: (data.teachers ?? []).slice(0, 20).map((t: any) => ({
          id: t.id,
          name: t.name,
          status: "active",
          created_at: t.last_login_at,
        })),
      } as PoolDetail;
    },
    enabled: !!id,
  });

  const { data: credits, refetch: refetchCredits } = useQuery({
    queryKey: ["super", "pool-credits", id],
    queryFn: () => api.get<CreditInfo>(`/super/pools/${id}/credits`),
    enabled: !!id && tab === "ai",
  });

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ["super", "pool-control", id],
    queryFn: () => api.get<PoolSummary>(`/super/pools/${id}/control-center/summary`),
    enabled: !!id && tab === "control",
    // 폴링 없음 — SSE가 invalidate 담당
  });

  // SSE realtime — control 탭이 열려있을 때만 구독
  useEffect(() => {
    if (tab !== "control" || !id) return;
    const token = getToken() ?? "";
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
    const url = `${base}/super/pools/${id}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url, {});
    esRef.current = es;
    es.onopen = () => setSseConnected(true);
    es.onmessage = (e) => {
      if (!e.data || e.data === "ping") return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== "connected") {
          // 변경 이벤트 → React Query 무효화
          qc.invalidateQueries({ queryKey: ["super", "pool-control", id] });
        }
      } catch {}
    };
    es.onerror = () => setSseConnected(false);
    return () => { es.close(); setSseConnected(false); };
  }, [tab, id, qc]);

  const approveMut = useMutation({
    mutationFn: () => api.patch(`/super/operators/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super", "pool-detail", id] }),
  });
  const restrictMut = useMutation({
    mutationFn: () => api.patch(`/super/operators/${id}/restrict`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super", "pool-detail", id] }),
  });
  const creditMut = useMutation({
    mutationFn: (amount: number) => api.post(`/super/pools/${id}/credits`, { amount }),
    onSuccess: () => { refetchCredits(); setCreditAmount(""); },
  });
  const xGrantMut = useMutation({
    mutationFn: (grant: boolean) => api.patch(`/super/operators/${id}/xmode`, { grant }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super", "pool-detail", id] }),
  });

  const subMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/super/operators/${id}/subscription`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super", "pool-detail", id] });
      setSubSaveMsg("저장 완료");
      setSubTier(""); setSubStatus(""); setSubEndAt(""); setSubMemberLimit("");
      setTimeout(() => setSubSaveMsg(null), 3000);
    },
    onError: (e: any) => setSubSaveMsg(`오류: ${e?.message ?? "저장 실패"}`),
  });

  function handleSubSave() {
    const body: Record<string, unknown> = {};
    if (subTier)        body.subscription_tier   = subTier;
    if (subStatus)      body.subscription_status = subStatus;
    if (subEndAt !== "")  body.subscription_end_at = subEndAt === "null" ? null : subEndAt || undefined;
    if (subMemberLimit) body.member_limit = Number(subMemberLimit);
    if (!Object.keys(body).length) { setSubSaveMsg("변경할 항목을 선택하세요."); return; }
    subMut.mutate(body);
  }

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

  const healthColor = { GREEN: "#166534", YELLOW: "#854D0E", RED: "#991B1B" };
  const healthBg    = { GREEN: "#DCFCE7", YELLOW: "#FEF9C3", RED: "#FEE2E2" };

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "1000px" }}>
      <button onClick={() => navigate("/super/pools")} style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontSize: "13px", marginBottom: "20px" }}>
        <ArrowLeft size={15} /> 수영장 목록으로
      </button>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>불러오는 중...</div>
      ) : !detail ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>수영장 정보를 찾을 수 없습니다.</div>
      ) : (
        <>
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

          <div style={{ display: "flex", gap: "2px", marginBottom: "24px", borderBottom: "1px solid var(--border-default)" }}>
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--x-primary)" : "2px solid transparent", marginBottom: "-1px", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? "var(--x-primary)" : "var(--text-muted)", cursor: "pointer" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Overview ── */}
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
                  { label: "가입일", value: date(detail.created_at as string) },
                  { label: "스토리지 사용", value: bytes(detail.storage?.used_bytes) + " / " + bytes(detail.storage?.limit_bytes) },
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--border-default)" }}>
                    <div style={{ width: "140px", fontSize: "13px", color: "var(--text-muted)", fontWeight: 500 }}>{row.label}</div>
                    <div style={{ fontSize: "13px", color: "var(--text-body)" }}>{row.value ?? "-"}</div>
                  </div>
                ))}
              </div>
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

          {/* ── Members ── */}
          {tab === "members" && (
            <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-default)", fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>최근 회원 ({fmt(detail.member_count)}명)</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "var(--surface-subtle)" }}>
                  {["이름", "상태", "가입일"].map(h => <th key={h} style={{ padding: "10px 16px", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textAlign: "left", borderBottom: "1px solid var(--border-default)" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(detail.recent_members ?? []).map((m) => (
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

          {/* ── Billing ── */}
          {tab === "billing" && (
            <div style={{ display: "grid", gap: "16px" }}>

              {/* ── A. 기본 SWIMNOTE 구독 ── */}
              <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-subtle)", fontSize: "13px", fontWeight: 700, color: "var(--text-strong)" }}>
                  A. 기본 SWIMNOTE 구독
                </div>
                <div style={{ padding: "16px" }}>
                  {/* 현재 구독 정보 표시 */}
                  {[
                    {
                      label: "현재 플랜",
                      value: detail.subscription_tier
                        ? (TIER_LABEL[detail.subscription_tier] ?? detail.subscription_tier)
                        : "-",
                      legacy: !!(detail.subscription_tier && LEGACY_TIERS.has(detail.subscription_tier)),
                    },
                    { label: "현재 상태", value: STATUS_LABEL[detail.subscription_status ?? ""] ?? detail.subscription_status ?? "-" },
                    { label: "만료일", value: date(detail.subscription_end_at) },
                    { label: "회원 한도", value: detail.member_limit != null ? `${fmt(detail.member_limit)}명` : "무제한" },
                    { label: "크레딧 잔액", value: `${(detail.credit_balance ?? 0).toLocaleString("ko-KR")}원 (읽기 전용)` },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-default)" }}>
                      <div style={{ width: "140px", fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>{row.label}</div>
                      <div style={{ fontSize: "13px", color: "var(--text-body)", fontWeight: 500, display: "flex", alignItems: "center", gap: "8px" }}>
                        {row.value}
                        {"legacy" in row && row.legacy && (
                          <span style={{ padding: "1px 6px", background: "#FEF3C7", color: "#92400E", borderRadius: "6px", fontSize: "11px", fontWeight: 600 }}>구 플랜</span>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* 구독 직접 조정 */}
                  <div style={{ marginTop: "20px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "14px" }}>구독 직접 조정</div>

                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>구독 플랜</div>
                    {detail.subscription_tier && LEGACY_TIERS.has(detail.subscription_tier) && (
                      <div style={{ marginBottom: "8px", padding: "6px 10px", background: "#FEF3C7", borderRadius: "6px", fontSize: "11px", color: "#92400E" }}>
                        현재: {TIER_LABEL[detail.subscription_tier] ?? detail.subscription_tier} — 아래에서 전환 가능
                      </div>
                    )}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
                      {(["free","swimnote"] as const).map(t => (
                        <button key={t} onClick={() => setSubTier(subTier === t ? "" : t)}
                          style={{ padding: "6px 14px", background: subTier === t ? "var(--x-primary)" : "var(--surface-white)", color: subTier === t ? "#fff" : "var(--text-body)", border: "1px solid var(--border-default)", borderRadius: "20px", fontSize: "12px", cursor: "pointer", fontWeight: subTier === t ? 700 : 400 }}>
                          {TIER_LABEL[t]}
                        </button>
                      ))}
                    </div>

                    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>구독 상태</div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
                      {ALLOWED_STATUSES.map(s => (
                        <button key={s} onClick={() => setSubStatus(subStatus === s ? "" : s)}
                          style={{ padding: "6px 14px", background: subStatus === s ? "var(--x-primary)" : "var(--surface-white)", color: subStatus === s ? "#fff" : "var(--text-body)", border: "1px solid var(--border-default)", borderRadius: "20px", fontSize: "12px", cursor: "pointer", fontWeight: subStatus === s ? 700 : 400 }}>
                          {STATUS_LABEL[s] ?? s}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>만료일 (빈칸=변경 없음, "null"=삭제)</div>
                        <input value={subEndAt} onChange={e => setSubEndAt(e.target.value)}
                          style={{ width: "100%", height: "34px", padding: "0 10px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }}
                          placeholder="예: 2026-12-31T23:59:59Z" />
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px" }}>회원 한도 (명)</div>
                        <input type="number" value={subMemberLimit} onChange={e => setSubMemberLimit(e.target.value)}
                          style={{ width: "100%", height: "34px", padding: "0 10px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", boxSizing: "border-box" }}
                          placeholder="예: 50" />
                      </div>
                    </div>

                    {/* RevenueCat 경고 */}
                    <div style={{ marginBottom: "14px", padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "8px", fontSize: "11px", color: "#92400E", lineHeight: "1.5" }}>
                      스토어 결제 상태가 다시 수신되면 RevenueCat 동기화에 의해 구독 상태가 변경될 수 있습니다.
                    </div>

                    {subSaveMsg && (
                      <div style={{ marginBottom: "10px", fontSize: "13px", color: subSaveMsg.startsWith("오류") ? "#991B1B" : "#166534", fontWeight: 600 }}>{subSaveMsg}</div>
                    )}

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={handleSubSave} disabled={subMut.isPending}
                        style={{ padding: "8px 20px", background: "var(--x-primary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer", opacity: subMut.isPending ? 0.6 : 1 }}>
                        {subMut.isPending ? "저장 중..." : "저장"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── B. SWIMNOTE X (읽기 전용) ── */}
              <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #DDD6FE", fontSize: "13px", fontWeight: 700, color: "#5B21B6" }}>
                  B. SWIMNOTE X (읽기 전용)
                </div>
                <div style={{ padding: "16px" }}>
                  {[
                    { label: "X 플랜", value: detail.x_plan_key ? (X_PLAN_LABEL[detail.x_plan_key] ?? detail.x_plan_key) : "미가입" },
                    { label: "X 사용권", value: detail.xmode_entitlement ? "활성" : "비활성" },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid #DDD6FE" }}>
                      <div style={{ width: "140px", fontSize: "12px", color: "#6D28D9", fontWeight: 500 }}>{row.label}</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: row.label === "X 사용권" ? (detail.xmode_entitlement ? "#166534" : "#6B7280") : "#5B21B6" }}>{row.value}</div>
                    </div>
                  ))}
                  {/* X Trial */}
                  <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #DDD6FE" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#7C3AED", marginBottom: "8px" }}>X Trial</div>
                    {[
                      { label: "사용 여부", value: detail.x_trial_used ? "사용됨" : detail.x_trial_started_at ? "사용 중" : "미사용" },
                      { label: "시작일", value: date(detail.x_trial_started_at) },
                      { label: "종료일", value: date(detail.x_trial_ends_at) },
                    ].map(row => (
                      <div key={row.label} style={{ display: "flex", padding: "6px 0" }}>
                        <div style={{ width: "140px", fontSize: "12px", color: "#6D28D9", fontWeight: 500 }}>{row.label}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-body)" }}>{row.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: "10px", fontSize: "11px", color: "#7C3AED" }}>
                    X 사용권 grant/revoke는 기본 정보 탭 "X 모드 제어"에서 조정하십시오.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── AI ── */}
          {tab === "ai" && (
            <div>
              <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "24px" }}>
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

          {/* ── Control Center ── */}
          {tab === "control" && (
            <div>
              {/* SSE 상태 표시 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: sseConnected ? "#166534" : "var(--text-muted)" }}>
                  {sseConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
                  {sseConnected ? "실시간 연결됨" : "실시간 연결 대기 중"}
                </div>
                <button onClick={() => refetchSummary()} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 10px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}>
                  <RefreshCw size={11} /> 갱신
                </button>
              </div>

              {summaryLoading ? (
                <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
              ) : !summary ? (
                <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>데이터를 불러올 수 없습니다.</div>
              ) : (
                <div style={{ display: "grid", gap: "12px" }}>
                  {/* 헬스 */}
                  <div style={{ background: healthBg[summary.health ?? "GREEN"], border: `1px solid ${healthColor[summary.health ?? "GREEN"]}30`, borderRadius: "10px", padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "18px", fontWeight: 800, color: healthColor[summary.health ?? "GREEN"] }}>● {summary.health === "GREEN" ? "정상" : summary.health === "YELLOW" ? "경고" : "위험"}</span>
                      {(summary.health_issues ?? []).map((issue) => (
                        <span key={issue} style={{ padding: "2px 8px", background: "#FEE2E2", color: "#991B1B", borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>{issue}</span>
                      ))}
                    </div>
                  </div>

                  {/* 구독 */}
                  <Section title="구독 상태 (기본 SWIMNOTE)">
                    <Row label="상태" value={STATUS_LABEL[summary.subscription_status ?? ""] ?? summary.subscription_status ?? "-"} />
                    <Row
                      label="플랜 티어"
                      value={summary.subscription_tier
                        ? (TIER_LABEL[summary.subscription_tier] ?? summary.subscription_tier)
                        : "-"}
                      color={summary.subscription_tier && LEGACY_TIERS.has(summary.subscription_tier) ? "#92400E" : undefined}
                    />
                    <Row label="BASE 접근" value={summary.base_effective ? "활성" : "비활성"} color={summary.base_effective ? "#166534" : undefined} />
                    <Row label="BASE 소스" value={summary.base_source ?? "-"} />
                    <Row label="구독 만료일" value={date(summary.subscription_end_at)} />
                    {summary.payment_failed_at && <Row label="결제 실패" value={date(summary.payment_failed_at)} color="#991B1B" />}
                  </Section>

                  {/* X 모드 */}
                  <Section title="X 모드 (SWIMNOTE X)">
                    <Row label="X 유효" value={summary.x_effective ? "활성" : "비활성"} color={summary.x_effective ? "#7C3AED" : undefined} />
                    <Row label="X 소스" value={summary.x_source ?? "-"} />
                    <Row label="x_paid" value={summary.x_paid ? "true" : "false"} />
                    <Row label="x_manual" value={summary.x_manual ? "true" : "false"} />
                    <Row label="x_management_override" value={summary.x_management_override ? "true" : "false"} />
                    <Row label="x_force_disabled" value={summary.x_force_disabled ? "true" : "false"} color={summary.x_force_disabled ? "#991B1B" : undefined} />
                    <Row
                      label="플랜 키"
                      value={summary.x_plan_key ? (X_PLAN_LABEL[summary.x_plan_key] ?? summary.x_plan_key) : "-"}
                    />
                    <Row label="설정 상태" value={summary.xmode_config_status ?? "-"} />
                  </Section>

                  {/* 카운트 */}
                  <Section title="운영 현황">
                    <Row label="활성 회원" value={`${fmt(summary.active_members)}명 / 전체 ${fmt(summary.total_members)}명`} />
                    <Row label="선생님" value={`${fmt(summary.teacher_count)}명`} />
                    <Row label="학부모" value={`${fmt(summary.parent_count)}명`} />
                    <Row label="활성 반" value={`${fmt(summary.active_class_count)}개`} />
                  </Section>

                  {/* 회원 한도 */}
                  <Section title="회원 한도">
                    {summary.member_limit_unavailable ? (
                      <Row label="한도" value="조회 불가 (테이블 미적용)" color="var(--text-muted)" />
                    ) : (
                      <>
                        <Row label="한도" value={summary.member_limit != null ? `${fmt(summary.member_limit)}명` : "무제한"} />
                        <Row label="잔여" value={summary.member_limit_remaining != null ? `${fmt(summary.member_limit_remaining)}명` : "-"} color={summary.member_limit_warn ? "#991B1B" : undefined} />
                      </>
                    )}
                  </Section>

                  {/* 스토리지 */}
                  <Section title="스토리지">
                    {summary.storage_unavailable ? (
                      <Row label="스토리지" value="조회 불가" color="var(--text-muted)" />
                    ) : (
                      <>
                        <Row label="사용량" value={bytes(summary.used_storage_bytes)} />
                        <Row label="기본 할당" value={`${(summary.base_storage_gb ?? 0).toFixed(0)} GB`} />
                        <Row label="추가 할당" value={`${(summary.extra_storage_gb ?? 0).toFixed(0)} GB`} />
                        <Row label="총 한도" value={bytes(summary.effective_storage_bytes)} />
                        <Row label="업로드 차단" value={summary.upload_blocked ? "차단됨" : "정상"} color={summary.upload_blocked ? "#991B1B" : undefined} />
                      </>
                    )}
                  </Section>

                  {/* 푸시 */}
                  <Section title="푸시 알림 큐">
                    {summary.push_unavailable ? (
                      <Row label="푸시 큐" value="조회 불가 (테이블 미적용)" color="var(--text-muted)" />
                    ) : (
                      <>
                        <Row label="대기 중" value={fmt(summary.push_pending_jobs)} />
                        <Row label="실패" value={fmt(summary.push_failed_jobs)} color={Number(summary.push_failed_jobs ?? 0) > 0 ? "#991B1B" : undefined} />
                        <Row label="24h 완료" value={fmt(summary.push_completed_24h)} />
                        <Row label="최근 배달 실패" value={fmt(summary.push_recent_delivery_failures)} />
                      </>
                    )}
                  </Section>

                  {/* AI */}
                  <Section title="AI 운영 (최근 월)">
                    {summary.ai_unavailable ? (
                      <Row label="AI 운영" value="조회 불가 (테이블 미적용)" color="var(--text-muted)" />
                    ) : (
                      <>
                        <Row label="기준 월" value={summary.recent_ai_month ?? "-"} />
                        <Row label="AI 일지 수" value={fmt(summary.recent_ai_diary_count)} />
                      </>
                    )}
                  </Section>

                  {/* 성장 리포트 */}
                  <Section title="성장 리포트 (30일)">
                    {summary.gr_unavailable ? (
                      <Row label="리포트" value="조회 불가 (테이블 미적용)" color="var(--text-muted)" />
                    ) : (
                      <>
                        <Row label="전체" value={fmt(summary.gr_total_count)} />
                        <Row label="발송 준비" value={fmt(summary.gr_ready_count)} />
                        <Row label="실패" value={fmt(summary.gr_failed_count)} color={Number(summary.gr_failed_count ?? 0) > 3 ? "#991B1B" : undefined} />
                      </>
                    )}
                  </Section>

                  {/* 이벤트 로그 */}
                  <Section title="이벤트 로그 (7일)">
                    {summary.event_log_unavailable ? (
                      <Row label="이벤트" value="조회 불가" color="var(--text-muted)" />
                    ) : (
                      <>
                        <Row label="이벤트 수" value={fmt(summary.recent_event_count)} />
                        <Row label="최근 이벤트" value={date(summary.last_event_at)} />
                      </>
                    )}
                  </Section>

                  {/* 알림 */}
                  <Section title="알림">
                    {summary.notifications_unavailable ? (
                      <Row label="알림" value="조회 불가" color="var(--text-muted)" />
                    ) : (
                      <Row label="7일 미읽음" value={fmt(summary.unread_notifications)} />
                    )}
                  </Section>

                  {/* 고객 지원 */}
                  <Section title="고객 지원 (최근 케이스)">
                    {summary.support_unavailable ? (
                      <Row label="케이스" value="조회 불가 (테이블 미적용)" color="var(--text-muted)" />
                    ) : summary.recent_support ? (
                      <>
                        <Row label="상태" value={summary.recent_support.state} />
                        <Row label="요청자 역할" value={summary.recent_support.actor_role ?? "-"} />
                        <Row label="생성일" value={date(summary.recent_support.created_at)} />
                      </>
                    ) : (
                      <Row label="케이스" value="케이스 없음" />
                    )}
                  </Section>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", background: "var(--surface-subtle)" }}>{title}</div>
      <div style={{ padding: "4px 0" }}>{children}</div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", padding: "9px 16px", borderBottom: "1px solid var(--border-default)" }}>
      <div style={{ width: "200px", fontSize: "12px", color: "var(--text-muted)", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: "13px", color: color ?? "var(--text-body)", fontWeight: color ? 700 : 400 }}>{value}</div>
    </div>
  );
}
