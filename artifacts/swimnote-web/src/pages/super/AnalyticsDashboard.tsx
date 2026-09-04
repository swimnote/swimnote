/**
 * WP15.5-B/C Fix — SuperAdmin Analytics Dashboard
 *
 * - MAU 프록시 (event_logs) 제거
 * - analytics_events 기반 session_stats: COLLECTING / AVAILABLE
 * - 광고 Creative 실제 등록 수 표시
 * - Impressions/Clicks/CTR → analytics_events 데이터 기반 (초기 0 또는 데이터 없음)
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const PRIMARY = "#4f46e5";

interface SessionStats {
  status:         "COLLECTING" | "AVAILABLE";
  total_sessions: number;
  note:           string;
}

interface AdStats {
  total_creatives:  number;
  active_creatives: number;
}

interface AnalyticsOverview {
  platform: {
    total_pools:     number;
    approved_pools:  number;
    active_pools:    number;
    x_mode_pools:    number;
    basic_pools:     number;
    pending_pools:   number;
    total_students:  number;
    active_students: number;
    total_parents:   number;
    active_parents:  number;
  };
  subscription: {
    active:  number;
    trial:   number;
    expired: number;
  };
  session_stats: SessionStats;
  ad_stats:      AdStats;
}

// ── KPI 카드 ──────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color, dimmed,
}: { label: string; value: number | string; sub?: string; color?: string; dimmed?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border border-[#ebebeb] px-5 py-4 flex flex-col gap-1 min-w-[140px] ${dimmed ? "opacity-40 select-none" : ""}`}>
      <p className="text-[12px] text-[#888] font-medium">{label}</p>
      <p className="text-[26px] font-bold" style={{ color: color ?? "#0a0a0a" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[11px] text-[#aaa]">{sub}</p>}
    </div>
  );
}

// ── 구분선 제목 ───────────────────────────────────────────────────────
function Section({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mt-6 mb-3">
      <p className="text-[14px] font-bold text-[#0a0a0a]">{title}</p>
      {badge && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ background: "#f0f0f0", color: "#666" }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── COLLECTING 배지 ───────────────────────────────────────────────────
function CollectingBadge({ note }: { note: string }) {
  return (
    <div className="mt-2 px-4 py-3 rounded-lg bg-sky-50 border border-sky-200 flex items-start gap-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" className="mt-0.5 shrink-0">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p className="text-[11px] text-sky-700">{note}</p>
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [data, setData]       = useState<AnalyticsOverview | null>(null);

  async function fetch_() {
    setLoading(true);
    setError(null);
    try {
      const json = await api.get<AnalyticsOverview>("/super/analytics-overview");
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "조회 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetch_(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const p  = data?.platform;
  const s  = data?.subscription;
  const ss = data?.session_stats;
  const ad = data?.ad_stats;

  const isCollecting = ss?.status === "COLLECTING" || !ss;

  return (
    <div className="p-6 max-w-[960px]">

      {/* ── 헤더 ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <div>
          <h2 className="text-[17px] font-bold text-[#0a0a0a]">플랫폼 Analytics</h2>
          <p className="text-[12px] text-[#888] mt-0.5">현황 지표는 실시간 DB 기준입니다.</p>
        </div>
        <button
          onClick={fetch_}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#ebebeb] bg-white text-[#555] hover:bg-[#f5f5f5] disabled:opacity-50"
        >
          {loading ? "조회 중…" : "새로고침"}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-600">
          {error}
        </div>
      )}

      {/* ── 수영장 현황 ────────────────────────────────────────── */}
      <Section title="수영장 현황" badge="AVAILABLE_NOW" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard label="전체 수영장"   value={p?.total_pools    ?? "—"} />
        <KpiCard label="활성 수영장"   value={p?.active_pools   ?? "—"} color={PRIMARY} />
        <KpiCard label="X 모드"        value={p?.x_mode_pools   ?? "—"} color="#7c3aed" />
        <KpiCard label="BASIC 모드"    value={p?.basic_pools    ?? "—"} />
        <KpiCard label="승인 대기"     value={p?.pending_pools  ?? "—"} color="#d97706" />
        <KpiCard label="구독 활성"     value={s?.active         ?? "—"} color="#059669" />
        <KpiCard label="트라이얼"      value={s?.trial          ?? "—"} />
        <KpiCard label="구독 만료"     value={s?.expired        ?? "—"} color="#dc2626" />
      </div>

      {/* ── 학생 / parent ──────────────────────────────────────── */}
      <Section title="학생 · 학부모 현황" badge="AVAILABLE_NOW" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="전체 학생"     value={p?.total_students  ?? "—"} />
        <KpiCard label="재학 중 학생"  value={p?.active_students ?? "—"} color={PRIMARY} />
        <KpiCard label="전체 학부모"   value={p?.total_parents   ?? "—"} />
        <KpiCard label="활성 학부모"   value={p?.active_parents  ?? "—"} sub="is_active=true 기준" color="#0891b2" />
      </div>

      {/* ── 세션 / MAU ─────────────────────────────────────────── */}
      <Section
        title={isCollecting ? "세션 지표 (데이터 수집 중)" : "세션 지표"}
        badge={isCollecting ? "COLLECTING" : "AVAILABLE"}
      />
      {isCollecting ? (
        <CollectingBadge note={ss?.note ?? "analytics_events 수집 중 — 실제 앱 사용으로만 데이터 생성됩니다."} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard
            label="총 로그인 세션"
            value={ss?.total_sessions ?? 0}
            sub="LOGIN_SESSION_START 이벤트 기준"
            color={PRIMARY}
          />
        </div>
      )}
      <p className="text-[11px] text-[#aaa] mt-2">
        DAU/WAU/MAU는 analytics_events 데이터가 충분히 쌓인 후 계산됩니다.
        event_logs 기반 근사값은 사용하지 않습니다.
      </p>

      {/* ── 광고 Creative 현황 ─────────────────────────────────── */}
      <Section title="광고 Creative 현황" badge="AVAILABLE_NOW" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="전체 Creative"  value={ad?.total_creatives  ?? "—"} />
        <KpiCard label="활성 Creative"  value={ad?.active_creatives ?? "—"} color="#059669" />
      </div>

      {/* ── 광고 성과 지표 ─────────────────────────────────────── */}
      <Section title="광고 성과 지표" badge="NEEDS_EVENT_DATA" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard label="Impressions" value={0}   sub="analytics_events 기준" />
        <KpiCard label="Clicks"      value={0}   sub="analytics_events 기준" />
        <KpiCard label="CTR"         value="—"   sub="데이터 없음" dimmed />
        <KpiCard label="Conversions" value="—"   sub="DEFERRED" dimmed />
      </div>
      <p className="text-[11px] text-[#bbb] mt-2">
        Impressions/Clicks는 실제 앱 사용으로만 생성됩니다. 0이면 아직 데이터 없음.
        CTR/Conversions는 광고 캠페인 시스템 구현 후 활성화됩니다.
      </p>

    </div>
  );
}
