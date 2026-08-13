/**
 * WP15.5-B — SuperAdmin Analytics Dashboard
 * AVAILABLE_NOW 지표 + MAU 프록시 표시
 * 광고 슬롯은 WP15.5-C에서 구현 (현재 Skeleton placeholder)
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const PRIMARY = "#4f46e5";

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
  mau_proxy: {
    period:           { from: string; to: string };
    parent_sessions:  number;
    teacher_sessions: number;
    total_sessions:   number;
    note:             string;
  };
}

// ── 날짜 유틸 ─────────────────────────────────────────────────────────
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

// ── KPI 카드 ──────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color,
}: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#ebebeb] px-5 py-4 flex flex-col gap-1 min-w-[140px]">
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

// ── 광고 슬롯 Skeleton (WP15.5-C 대기) ───────────────────────────────
function AdSlotPlaceholder({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#d0d0d0] px-5 py-6 flex flex-col items-center gap-2 bg-[#fafafa]">
      <div className="w-8 h-8 rounded-full bg-[#ebebeb] flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M9 21V9"/>
        </svg>
      </div>
      <p className="text-[12px] font-semibold text-[#aaa]">{label}</p>
      <p className="text-[11px] text-[#bbb]">WP15.5-C에서 구현 예정</p>
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [data, setData]         = useState<AnalyticsOverview | null>(null);

  // 기간 선택 (기본: 최근 30일)
  const [from, setFrom] = useState(daysAgo(30));
  const [to,   setTo]   = useState(isoDate(new Date()));

  async function fetch_() {
    setLoading(true);
    setError(null);
    try {
      const json = await api.get<AnalyticsOverview>(
        `/super/analytics-overview?from=${from}&to=${to}`,
      );
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
  const m  = data?.mau_proxy;

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
        <KpiCard
          label="활성 학부모"
          value={p?.active_parents ?? "—"}
          sub="is_active=true 기준"
          color="#0891b2"
        />
      </div>

      {/* ── MAU 프록시 ─────────────────────────────────────────── */}
      <Section title="세션 근사값 (MAU 프록시)" badge="NEEDS_EVENT_TRACKING" />

      {/* 기간 선택 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-[#ebebeb] text-[12px] text-[#333] bg-white" />
        <span className="text-[12px] text-[#aaa]">~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-[#ebebeb] text-[12px] text-[#333] bg-white" />
        <button onClick={fetch_} disabled={loading}
          className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white disabled:opacity-50"
          style={{ background: PRIMARY }}>
          조회
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="전체 세션 (근사)"
          value={m?.total_sessions   ?? "—"}
          sub={`${from} ~ ${to}`}
          color={PRIMARY}
        />
        <KpiCard
          label="교사/관리자 세션"
          value={m?.teacher_sessions ?? "—"}
          sub="event_logs 로그인 category"
        />
        <KpiCard
          label="학부모 세션"
          value={m?.parent_sessions  ?? "—"}
          sub="event_logs 로그인 category"
        />
      </div>

      {m && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 inline-flex items-start gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="mt-0.5 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p className="text-[11px] text-amber-700">{m.note}</p>
        </div>
      )}

      {/* ── 광고 슬롯 (WP15.5-C 대기) ─────────────────────────── */}
      <Section title="광고 슬롯 (준비 중)" badge="WP15.5-C" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AdSlotPlaceholder label="PARENT_HOME_BANNER" />
        <AdSlotPlaceholder label="PARENT_FEED_INLINE" />
      </div>

      {/* ── AD 지표 (DEFERRED) ─────────────────────────────────── */}
      <Section title="광고 성과 지표" badge="DEFERRED_AD_SYSTEM" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 opacity-40 pointer-events-none select-none">
        {["Impressions","Unique Reach","Frequency","Clicks","CTR","Conversion"].map(label => (
          <KpiCard key={label} label={label} value="—" sub="광고 시스템 미구현" />
        ))}
      </div>
      <p className="text-[11px] text-[#bbb] mt-2">
        광고 캠페인 시스템(ad_campaigns / ad_impressions / ad_clicks) 구현 후 활성화됩니다.
      </p>

    </div>
  );
}
