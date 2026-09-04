/**
 * SuperPartner — Partner Analytics
 * CS-PA0: AI Usage + Adoption + Evidence 탭 실 데이터 연결.
 * 광고 개요/Creative 기존 유지.
 * 데이터 없는 metric = null 표시 (절대 fake 0 금지).
 */
import { useState, useEffect, useCallback } from "react";
import AnalyticsDashboard from "@/pages/super/AnalyticsDashboard";
import AdCreativeManager from "@/pages/super/AdCreativeManager";
import { api } from "@/lib/api";

type PartnerTab = "overview" | "ad-creatives" | "adoption" | "usage" | "evidence";

const TABS: { id: PartnerTab; label: string }[] = [
  { id: "overview",     label: "광고 개요" },
  { id: "ad-creatives", label: "Creative 관리" },
  { id: "adoption",     label: "Adoption" },
  { id: "usage",        label: "AI Usage" },
  { id: "evidence",     label: "Evidence" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface AiMetrics {
  period: { from: string; to: string };
  totals: {
    total_requests: number;
    success_count: number;
    error_count: number;
    success_rate: number | null;
    active_pools: number;
    active_actors: number;
    total_tokens: number | null;
    total_cost_usd: number | null;
    avg_latency_ms: number | null;
    p50_latency_ms: number | null;
    p95_latency_ms: number | null;
  };
  by_feature: FeatureRow[];
  by_model: ModelRow[];
}

interface FeatureRow {
  feature: string; label: string;
  requests: number; success_count: number; error_count: number;
  success_rate: number | null;
  active_pools: number; active_actors: number;
  total_tokens: number | null;
  total_cost_usd: number | null;
  avg_latency_ms: number | null;
}

interface ModelRow {
  model: string; requests: number;
  total_tokens: number | null; total_cost_usd: number | null; avg_latency_ms: number | null;
}

interface PartnerMetrics {
  period: { from: string; to: string; days: number };
  total_pools: number | null; x_pools: number | null;
  active_ai_pools: number | null; active_ai_actors: number | null;
  ai_requests: number; ai_success: number; ai_errors: number;
  success_rate: number | null; error_rate: number | null;
  total_tokens: number | null; estimated_cost_usd: number | null;
  avg_latency_ms: number | null; p50_latency_ms: number | null; p95_latency_ms: number | null;
  ai_pool_adoption_pct: number | null;
  result_adoption: null; support_resolution: null;
}

interface Snapshot {
  id: string; period_start: string; period_end: string;
  label: string | null; metrics_json: Record<string, any>;
  created_at: string; created_by: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null, digits = 0, suffix = "") {
  if (v == null) return <span className="text-[#bbb]">—</span>;
  return <>{v.toLocaleString(undefined, { maximumFractionDigits: digits })}{suffix}</>;
}

function KpiCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg px-4 py-3">
      <p className="text-[10px] text-[#aaa] font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-[20px] font-bold text-[#111]">{value}</p>
      {sub && <p className="text-[10px] text-[#bbb] mt-0.5">{sub}</p>}
    </div>
  );
}

function PeriodSelector({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="flex gap-1">
      {[7, 30, 90].map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
            value === d ? "bg-[#002F5F] text-white" : "border border-[#e5e5e5] text-[#888] hover:bg-[#f5f5f5]"
          }`}
        >
          {d}일
        </button>
      ))}
    </div>
  );
}

// ── Adoption Tab ──────────────────────────────────────────────────────────────

function AdoptionTab() {
  const [period, setPeriod] = useState(30);
  const [metrics, setMetrics] = useState<PartnerMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<PartnerMetrics>(`/super/partner/metrics?period=${period}`)
      .then(setMetrics).catch(() => setMetrics(null)).finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-[13px] text-[#aaa]">불러오는 중...</div>;

  const m = metrics;
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-bold text-[#111]">AI 채택율 (Adoption)</h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="전체 수영장" value={fmt(m?.total_pools ?? null)} />
        <KpiCard label="AI 활성 수영장"
          value={fmt(m?.active_ai_pools ?? null)}
          sub={m?.ai_pool_adoption_pct != null ? `채택율 ${m.ai_pool_adoption_pct}%` : undefined}
        />
        <KpiCard label="X Mode 수영장" value={fmt(m?.x_pools ?? null)} />
        <KpiCard label="AI 활성 사용자" value={fmt(m?.active_ai_actors ?? null)} />
      </div>

      <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
        <h3 className="text-[12px] font-bold text-[#888] uppercase tracking-wider mb-3">채택율 상세</h3>
        <div className="space-y-2">
          {[
            { label: "AI Pool Adoption",
              value: m?.ai_pool_adoption_pct != null ? `${m.ai_pool_adoption_pct}%` : null,
              sub: `${m?.active_ai_pools ?? "—"} / ${m?.total_pools ?? "—"} 수영장` },
            { label: "Teacher AI Adoption", value: null, sub: "CS-PA1에서 계측 예정" },
            { label: "Parent AI Adoption",  value: null, sub: "CS-PA1에서 계측 예정" },
            { label: "Result Adoption",     value: null, sub: "CS-PA1에서 계측 예정" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="flex justify-between items-center py-2 border-b border-[#f5f5f5] last:border-0">
              <div>
                <p className="text-[12px] text-[#555]">{label}</p>
                <p className="text-[10px] text-[#bbb]">{sub}</p>
              </div>
              <span className={`text-[13px] font-bold ${value ? "text-[#111]" : "text-[#ccc]"}`}>
                {value ?? "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Usage Tab ─────────────────────────────────────────────────────────────────

function UsageTab() {
  const [period, setPeriod] = useState(30);
  const [metrics, setMetrics] = useState<AiMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<AiMetrics>(`/super/ai/metrics?period=${period}`)
      .then(setMetrics).catch(() => setMetrics(null)).finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-[13px] text-[#aaa]">불러오는 중...</div>;
  const t = metrics?.totals;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-bold text-[#111]">AI Usage</h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Overall KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="AI 요청" value={fmt(t?.total_requests ?? 0)} />
        <KpiCard label="성공율"
          value={t?.success_rate != null ? `${t.success_rate}%` : <span className="text-[#bbb]">—</span>}
          sub={`성공 ${t?.success_count ?? 0} / 실패 ${t?.error_count ?? 0}`}
        />
        <KpiCard label="총 토큰" value={fmt(t?.total_tokens ?? null)} sub="source: OpenAI usage" />
        <KpiCard label="추정 비용 (USD)"
          value={t?.total_cost_usd != null ? `$${t.total_cost_usd.toFixed(4)}` : <span className="text-[#bbb]">—</span>}
          sub="estimated, not invoiced"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiCard label="평균 레이턴시" value={fmt(t?.avg_latency_ms ?? null, 0, "ms")} />
        <KpiCard label="P50 레이턴시"  value={fmt(t?.p50_latency_ms ?? null, 0, "ms")} />
        <KpiCard label="P95 레이턴시"  value={fmt(t?.p95_latency_ms ?? null, 0, "ms")} />
      </div>

      {/* Feature breakdown */}
      {(metrics?.by_feature?.length ?? 0) > 0 && (
        <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f5f5f5]">
            <h3 className="text-[12px] font-bold text-[#888] uppercase tracking-wider">기능별 사용량</h3>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#f5f5f5] text-[10px] text-[#bbb] font-semibold">
                <th className="text-left px-5 py-2">기능</th>
                <th className="text-right px-3 py-2">요청</th>
                <th className="text-right px-3 py-2">성공율</th>
                <th className="text-right px-3 py-2">수영장</th>
                <th className="text-right px-3 py-2">토큰</th>
                <th className="text-right px-5 py-2">추정비용</th>
              </tr>
            </thead>
            <tbody>
              {metrics!.by_feature.map((f) => (
                <tr key={f.feature} className="border-b border-[#f5f5f5] last:border-0 hover:bg-[#fafafa]">
                  <td className="px-5 py-2.5 font-medium text-[#333]">{f.label}</td>
                  <td className="px-3 py-2.5 text-right">{f.requests.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">
                    {f.success_rate != null
                      ? <span className={f.success_rate >= 95 ? "text-green-700" : f.success_rate >= 80 ? "text-amber-600" : "text-red-600"}>{f.success_rate}%</span>
                      : <span className="text-[#ccc]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#888]">{f.active_pools}</td>
                  <td className="px-3 py-2.5 text-right text-[#888]">
                    {f.total_tokens != null ? f.total_tokens.toLocaleString() : <span className="text-[#ccc]">—</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right text-[#888]">
                    {f.total_cost_usd != null ? `$${f.total_cost_usd.toFixed(4)}` : <span className="text-[#ccc]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Model breakdown */}
      {(metrics?.by_model?.length ?? 0) > 0 && (
        <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-[#f5f5f5]">
            <h3 className="text-[12px] font-bold text-[#888] uppercase tracking-wider">모델별 사용량</h3>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#f5f5f5] text-[10px] text-[#bbb] font-semibold">
                <th className="text-left px-5 py-2">모델</th>
                <th className="text-right px-3 py-2">요청</th>
                <th className="text-right px-3 py-2">토큰</th>
                <th className="text-right px-3 py-2">추정비용</th>
                <th className="text-right px-5 py-2">평균응답</th>
              </tr>
            </thead>
            <tbody>
              {metrics!.by_model.map((m) => (
                <tr key={m.model} className="border-b border-[#f5f5f5] last:border-0">
                  <td className="px-5 py-2.5 font-mono text-[11px] text-[#555]">{m.model}</td>
                  <td className="px-3 py-2.5 text-right">{m.requests.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-[#888]">
                    {m.total_tokens != null ? m.total_tokens.toLocaleString() : <span className="text-[#ccc]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[#888]">
                    {m.total_cost_usd != null ? `$${m.total_cost_usd.toFixed(4)}` : <span className="text-[#ccc]">—</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right text-[#888]">
                    {m.avg_latency_ms != null ? `${m.avg_latency_ms}ms` : <span className="text-[#ccc]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(metrics?.by_feature?.length ?? 0) === 0 && (
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-8 text-center">
          <p className="text-[13px] text-[#aaa]">선택 기간에 AI 요청 데이터 없음</p>
        </div>
      )}
    </div>
  );
}

// ── Evidence Tab ──────────────────────────────────────────────────────────────

function EvidenceTab() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ period_start: "", period_end: "", label: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const loadSnaps = useCallback(() => {
    setLoading(true);
    api.get<{ snapshots: Snapshot[] }>("/super/partner/snapshots")
      .then((r) => setSnapshots(r.snapshots ?? []))
      .catch(() => setSnapshots([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadSnaps(); }, [loadSnaps]);

  const createSnapshot = async () => {
    if (!form.period_start || !form.period_end) {
      setMsg("❌ 기간을 모두 입력하세요."); return;
    }
    setCreating(true);
    try {
      await api.post("/super/partner/snapshots", form);
      setMsg("✅ 스냅샷 생성 완료");
      setForm({ period_start: "", period_end: "", label: "" });
      loadSnaps();
    } catch (e: any) {
      setMsg("❌ " + (e?.data?.error ?? "생성 실패"));
    } finally {
      setCreating(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-[16px] font-bold text-[#111]">Partner Evidence</h2>
      <p className="text-[12px] text-[#888]">
        OpenAI Partner 제출용 지표를 스냅샷으로 기록합니다.
        스냅샷은 생성 후 자동 변경되지 않으며 이력이 보존됩니다.
      </p>

      {/* Create snapshot */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-5">
        <h3 className="text-[12px] font-bold text-[#888] uppercase tracking-wider mb-3">새 스냅샷 생성</h3>
        {msg && (
          <div className="mb-3 px-3 py-2 bg-[#f0f7ff] border border-[#b3d4ff] rounded text-[12px] text-[#002F5F]">
            {msg}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] text-[#888] mb-1">기간 시작</label>
            <input type="date" value={form.period_start}
              onChange={(e) => setForm((p) => ({ ...p, period_start: e.target.value }))}
              className="w-full border border-[#e5e5e5] rounded px-3 py-1.5 text-[12px]" />
          </div>
          <div>
            <label className="block text-[11px] text-[#888] mb-1">기간 종료</label>
            <input type="date" value={form.period_end}
              onChange={(e) => setForm((p) => ({ ...p, period_end: e.target.value }))}
              className="w-full border border-[#e5e5e5] rounded px-3 py-1.5 text-[12px]" />
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-[11px] text-[#888] mb-1">레이블 (선택)</label>
          <input type="text" value={form.label} placeholder="예: OpenAI Partner 2026-Q2"
            onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
            className="w-full border border-[#e5e5e5] rounded px-3 py-1.5 text-[12px]" />
        </div>
        <button onClick={createSnapshot} disabled={creating}
          className="px-4 py-2 bg-[#002F5F] text-white rounded text-[12px] font-semibold hover:bg-[#001F40] disabled:opacity-40">
          {creating ? "생성 중..." : "📸 스냅샷 생성"}
        </button>
      </div>

      {/* Snapshot list */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-[#f5f5f5]">
          <h3 className="text-[12px] font-bold text-[#888] uppercase tracking-wider">스냅샷 이력</h3>
        </div>
        {loading ? (
          <p className="p-5 text-[12px] text-[#aaa]">불러오는 중...</p>
        ) : snapshots.length === 0 ? (
          <p className="p-5 text-[12px] text-[#bbb]">스냅샷 없음</p>
        ) : (
          <div className="divide-y divide-[#f5f5f5]">
            {snapshots.map((snap) => {
              const m = snap.metrics_json ?? {};
              return (
                <div key={snap.id} className="px-5 py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[13px] font-semibold text-[#111]">
                        {snap.label ?? `${snap.period_start} ~ ${snap.period_end}`}
                      </p>
                      <p className="text-[11px] text-[#888] mt-0.5">
                        {snap.period_start} ~ {snap.period_end} · 생성: {snap.created_at?.slice(0, 10)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
                    {[
                      { label: "수영장", value: m.total_pools },
                      { label: "AI 수영장", value: m.active_ai_pools },
                      { label: "AI 요청", value: m.ai_requests },
                      { label: "토큰", value: m.total_tokens },
                      { label: "추정비용", value: m.estimated_cost_usd != null ? `$${Number(m.estimated_cost_usd).toFixed(4)}` : null },
                      { label: "평균응답", value: m.avg_latency_ms != null ? `${m.avg_latency_ms}ms` : null },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-[#f9f9f9] rounded p-2 text-center">
                        <p className="text-[9px] text-[#aaa]">{label}</p>
                        <p className="text-[12px] font-semibold text-[#333]">
                          {value != null ? String(value) : <span className="text-[#ccc]">—</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[10px] text-[#bbb]">
        ※ 스냅샷 생성 후 과거 값은 자동으로 변경되지 않습니다. 추정 비용은 실제 청구 금액이 아닙니다.
      </p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SuperPartner() {
  const [tab, setTab] = useState<PartnerTab>("overview");

  return (
    <div>
      {/* Sub-nav */}
      <div className="bg-white border-b border-[#e5e5e5] px-6 py-3 flex gap-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-full text-[12px] font-medium transition-all ${
              tab === t.id
                ? "bg-[#002F5F] text-white"
                : "text-[#555] hover:bg-[#f5f5f5]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {tab === "overview"     && <AnalyticsDashboard />}
        {tab === "ad-creatives" && <AdCreativeManager />}
        {tab === "adoption"     && <AdoptionTab />}
        {tab === "usage"        && <UsageTab />}
        {tab === "evidence"     && <EvidenceTab />}
      </div>
    </div>
  );
}
