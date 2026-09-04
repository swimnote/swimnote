/**
 * SuperBilling — SA0-B: 구독·결제 현황
 * - 탭: 전체 / X MODE / 결제실패·이상 / 해지예정 / 만료 / Sync문제
 * - normalized_status + anomaly 배지
 * - 행 클릭 → /super/pools/:id
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";

interface BillingItem {
  pool_id: string;
  pool_name: string;
  raw_status: string;
  raw_tier: string | null;
  raw_plan_name: string | null;
  raw_source: string | null;
  normalized_basic_status: string;
  subscription_start_at: string | null;
  subscription_end_at: string | null;
  member_limit: number | null;
  x_paid_entitlement: boolean;
  x_manual_entitlement: boolean;
  x_force_disabled: boolean;
  xmode_config_status: string;
  normalized_x_status: string;
  x_slot_status: string | null;
  x_slot_tier: string | null;
  x_slot_expires_at: string | null;
  x_last_sync_at: string | null;
  anomalies: Record<string, boolean>;
  has_anomaly: boolean;
  admin_name: string | null;
  admin_email: string | null;
  updated_at: string | null;
}

interface BillingResponse {
  items: BillingItem[];
  total: number;
}

type TabKey = "all" | "x" | "billing_issue" | "cancelled" | "expired" | "sync_issue";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all",          label: "전체" },
  { key: "x",            label: "X MODE" },
  { key: "billing_issue",label: "결제이상" },
  { key: "cancelled",    label: "해지예정" },
  { key: "expired",      label: "만료" },
  { key: "sync_issue",   label: "Sync문제" },
];

function statusBadge(s: string) {
  const cfg: Record<string, string> = {
    ACTIVE:              "bg-green-100 text-green-700",
    CANCELLED_BUT_ACTIVE:"bg-amber-100 text-amber-700",
    EXPIRED:             "bg-red-100 text-red-700",
    BILLING_ISSUE:       "bg-red-100 text-red-700",
    SYNC_PENDING:        "bg-purple-100 text-purple-700",
    NOT_X:               "bg-gray-100 text-gray-500",
    UNKNOWN:             "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cfg[s] ?? cfg.UNKNOWN}`}>{s}</span>
  );
}

function AnomalyBadges({ a }: { a: Record<string, boolean> }) {
  const labels: Record<string, string> = {
    expired_but_x:    "만료+X",
    billing_issue:    "결제실패",
    x_active_no_slot: "슬롯없음",
    sync_stale:       "Sync지연",
  };
  const active = Object.entries(a).filter(([, v]) => v);
  if (!active.length) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {active.map(([key]) => (
        <span key={key} className="px-1 py-0.5 bg-red-50 text-red-600 text-[9px] font-bold rounded border border-red-200">
          {labels[key] ?? key}
        </span>
      ))}
    </div>
  );
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

export default function SuperBilling() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<TabKey>("all");
  const [data, setData] = useState<BillingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    api.get<BillingResponse>("/super/billing/list?limit=500")
      .then((r) => setData(r.items ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = data.filter(item => {
    if (tab === "all")          return true;
    if (tab === "x")            return item.x_paid_entitlement || item.x_manual_entitlement;
    if (tab === "billing_issue")return item.normalized_basic_status === "BILLING_ISSUE" || (item.anomalies.billing_issue);
    if (tab === "cancelled")    return item.normalized_basic_status === "CANCELLED_BUT_ACTIVE"
                                    || item.normalized_x_status    === "CANCELLED_BUT_ACTIVE";
    if (tab === "expired")      return item.normalized_basic_status === "EXPIRED"
                                    || item.normalized_x_status    === "EXPIRED";
    if (tab === "sync_issue")   return item.anomalies.sync_stale || item.anomalies.x_active_no_slot;
    return true;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-[20px] font-bold text-[#111]">구독 / 결제</h1>
        <p className="text-[12px] text-[#999] mt-0.5">운영 중 수영장의 구독 및 결제 현황</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#e5e5e5] mb-5 flex-wrap">
        {TABS.map((t) => {
          const cnt = t.key === "all" ? data.length : data.filter(item => {
            if (t.key === "x")            return item.x_paid_entitlement || item.x_manual_entitlement;
            if (t.key === "billing_issue")return item.normalized_basic_status === "BILLING_ISSUE" || item.anomalies.billing_issue;
            if (t.key === "cancelled")    return item.normalized_basic_status === "CANCELLED_BUT_ACTIVE" || item.normalized_x_status === "CANCELLED_BUT_ACTIVE";
            if (t.key === "expired")      return item.normalized_basic_status === "EXPIRED" || item.normalized_x_status === "EXPIRED";
            if (t.key === "sync_issue")   return item.anomalies.sync_stale || item.anomalies.x_active_no_slot;
            return false;
          }).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
                tab === t.key
                  ? "border-[#002F5F] text-[#002F5F]"
                  : "border-transparent text-[#888] hover:text-[#444]"
              }`}
            >
              {t.label}
              {cnt > 0 && tab !== t.key && (
                <span className={`ml-1.5 px-1.5 py-0.5 text-[10px] rounded-full font-bold ${
                  t.key === "billing_issue" || t.key === "expired" ? "bg-red-100 text-red-700" : "bg-[#f0f0f0] text-[#666]"
                }`}>{cnt}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <p className="text-[13px] text-[#bbb] animate-pulse py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-[13px] text-red-500 py-10 text-center">데이터 로드 실패</p>
      ) : (
        <>
          <div className="text-[11px] text-[#bbb] mb-3">{filtered.length}건</div>
          <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                  <th className="text-left px-4 py-3 text-[11px] text-[#888] font-semibold">수영장</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">Basic 상태</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">X 상태</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">플랜</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">종료일</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">이상</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[12px] text-[#bbb]">해당 항목 없음</td>
                  </tr>
                ) : filtered.map((item) => (
                  <tr
                    key={item.pool_id}
                    className="border-b border-[#f5f5f5] last:border-0 hover:bg-[#fafafa] cursor-pointer transition-colors"
                    onClick={() => navigate(`/super/pools/${item.pool_id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#111]">{item.pool_name}</div>
                      <div className="text-[#bbb]">{item.admin_name ?? "—"}</div>
                    </td>
                    <td className="px-3 py-3">{statusBadge(item.normalized_basic_status)}</td>
                    <td className="px-3 py-3">
                      {(item.x_paid_entitlement || item.x_manual_entitlement)
                        ? statusBadge(item.normalized_x_status)
                        : <span className="text-[#ddd]">—</span>
                      }
                    </td>
                    <td className="px-3 py-3 text-[#666]">
                      {item.raw_plan_name ?? item.raw_tier ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-[#888]">{fmtDate(item.subscription_end_at)}</td>
                    <td className="px-3 py-3">
                      {item.has_anomaly
                        ? <AnomalyBadges a={item.anomalies} />
                        : <span className="text-[#ddd]">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
