/**
 * SuperAI — SA0-B: AI 운영
 * - 탭: Global Templates / Growth Review Stats / AI 사용현황 / AI 오류
 * - AI 사용현황 + 오류: /super/ai-traces 재활용 (기존 엔드포인트)
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import GlobalTemplateSets from "@/pages/super/GlobalTemplateSets";
import GrowthReviewStats from "@/pages/super/GrowthReviewStats";
import AiCostDashboard from "@/pages/super/AiCostDashboard";

interface AiTrace {
  id: string;
  pool_id: string | null;
  feature: string | null;
  status: "SUCCESS" | "FAILED" | string;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  error_message: string | null;
  created_at: string;
  cost_usd?: number | null;
}

interface TracesResponse {
  traces: AiTrace[];
  total: number;
}

type TabKey = "templates" | "growth_stats" | "usage" | "errors" | "ai_cost" | "monthly";

interface MonthlyException {
  swimming_pool_id: string;
  report_id?: string;
  product_status?: string;
  first_pass_outcome?: string;
  first_pass_error_code?: string;
  first_pass_error_category?: string;
  preparation_error?: string;
  recovery_epoch?: number;
  first_pass_engine_requests?: number;
  recovery_engine_requests?: number;
  lookup_requests?: number;
  recovery_allowed?: boolean;
}
interface MonthlyDiagnostics {
  summary: Record<string, number | string | unknown> | null;
  first_pass_summary?: Record<string, unknown> | null;
  run: { paused_at: string | null; pause_reason: string | null; circuit_status: string } | null;
  exceptions: { rows: MonthlyException[]; total: number };
}

function MonthlyExceptionsTab() {
  const previous = new Date(Date.now() + 9 * 3_600_000);
  previous.setUTCDate(1); previous.setUTCMonth(previous.getUTCMonth() - 1);
  const [period, setPeriod] = useState(() =>
    new URLSearchParams(window.location.search).get("report_period") ?? previous.toISOString().slice(0, 7));
  const [pool, setPool] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<MonthlyDiagnostics | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      const query = new URLSearchParams({ report_period: period, limit: "50", offset: String(page * 50) });
      if (pool) query.set("pool_id", pool);
      if (category) query.set("category", category);
      api.get<MonthlyDiagnostics>(`/super/growth-reports/monthly-automation?${query}`)
        .then(result => { if (active) { setData(result); setError(""); } })
        .catch(() => { if (active) { setData(null); setError("월간 실행 정보를 불러오지 못했습니다."); } });
    };
    setData(null); load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [period, pool, category, page, revision]);

  async function operate(action: "recover" | "resume", poolId?: string) {
    if (!reason.trim() || busy) return;
    if (!window.confirm(action === "resume" ? "원인 수정 후 제한된 probe로 재개하시겠습니까?"
      : "이 수영장의 허용된 실패만 recovery 승인하시겠습니까? 정상 결과와 UNKNOWN은 제외됩니다.")) return;
    setBusy(true); setError("");
    try {
      await api.post(action === "resume" ? "/super/growth-reports/monthly-automation/resume"
        : "/super/growth-reports/batch-recovery", action === "resume"
        ? { report_period: period, reason: reason.trim() }
        : { pool_id: poolId, report_month: period, reason: reason.trim() });
      setReason(""); setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "작업이 허용되지 않았습니다."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      <label className="text-xs">분석월 (발급월의 전월)
        <input aria-label="분석월" type="month" value={period}
          onChange={e => { setPeriod(e.target.value); setPage(0); }} className="block border rounded p-2" /></label>
      <input aria-label="수영장 ID" placeholder="수영장 ID" value={pool}
        onChange={e => { setPool(e.target.value); setPage(0); }} className="border rounded p-2 text-xs" />
      <select aria-label="오류 분류" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}
        className="border rounded p-2 text-xs">
        <option value="">전체 오류 분류</option>
        {["PROVIDER", "API", "ENGINE", "NETWORK", "TIMEOUT", "UNKNOWN", "DATA", "IDENTITY", "MISSING", "PREPARATION", "OTHER"]
          .map(value => <option key={value}>{value}</option>)}
      </select>
      <button onClick={() => setRevision(n => n + 1)} className="border rounded px-3 text-xs">새로고침</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data && !data.run && <p className="text-sm text-gray-600">등록된 월간 자동화 run이 없습니다.
      기존 cycle을 자동 등록하거나 재분석하지 않습니다.</p>}
    {data?.summary && <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
      {[["pool_total", "대상 수영장"], ["eligible_total", "봉인 대상"], ["generated_total", "AI 정상 생성"],
        ["insufficient_evidence_total", "근거부족 정상 결과"], ["unresolved_pool_total", "미완료 수영장"],
        ["unresolved_member_total", "미완료 회원"]].map(([key, label]) =>
        <div className="border rounded p-3" key={key}>{label}<strong className="block text-lg">{String(data.summary?.[key] ?? "—")}</strong></div>)}
    </div>}
    {data?.first_pass_summary?.completed_at != null && <p className="text-xs text-gray-600">
      1차 종료 당시: 정상 생성 {String(data.first_pass_summary.generated_total ?? 0)}명 /
      근거부족 {String(data.first_pass_summary.insufficient_evidence_total ?? 0)}명 /
      미완료 {String(data.first_pass_summary.unresolved_member_total ?? 0)}명.
      위 집계와 아래 예외 목록은 현재 상태입니다.
    </p>}
    <p className="text-xs text-gray-600">Provider 실제 비용: UNKNOWN (확인 가능한 비용 근거 없음).
      아래 횟수는 APP→ENGINE 요청이며 비용이나 provider 호출 수가 아닙니다.</p>
    {data?.run && <p className="text-sm">Circuit: {data.run.circuit_status ?? "CLOSED"}
      {data.run.pause_reason && ` / ${data.run.pause_reason}`}</p>}
    <div className="flex gap-2">
      <input aria-label="원인 수정 및 승인 사유" maxLength={500} value={reason}
        onChange={e => setReason(e.target.value)} placeholder="원인 수정 및 승인 사유 (필수)"
        className="border rounded p-2 text-xs flex-1" />
      {data?.run?.paused_at && <button disabled={busy || !reason.trim()} onClick={() => operate("resume")}
        className="border rounded px-3 text-xs disabled:opacity-40">제한된 재개 승인</button>}
    </div>
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-xs"><thead><tr>
        {["수영장 / report", "현재 상태", "오류", "recovery 회차", "first / recovery / lookup", "운영"].map(x =>
          <th key={x} className="p-2 text-left">{x}</th>)}
      </tr></thead><tbody>{(data?.exceptions.rows ?? []).map((row, i) =>
        <tr key={`${row.swimming_pool_id}:${row.report_id ?? i}`} className="border-t">
          <td className="p-2">{row.swimming_pool_id}<br />{row.report_id ?? "준비 단계"}</td>
          <td className="p-2">{row.product_status ?? row.first_pass_outcome ?? "PREPARATION"}</td>
          <td className="p-2">{row.first_pass_error_category}<br />{row.first_pass_error_code ?? row.preparation_error}</td>
          <td className="p-2">{row.recovery_epoch ?? 0}</td>
          <td className="p-2">{row.first_pass_engine_requests ?? 0} / {row.recovery_engine_requests ?? 0} / {row.lookup_requests ?? 0}</td>
          <td className="p-2">{row.recovery_allowed
            ? <button disabled={busy || !reason.trim()} onClick={() => operate("recover", row.swimming_pool_id)}
              className="border rounded p-1 disabled:opacity-40">허용된 실패 recovery</button>
            : <span>HOLD / 재분석 불가</span>}</td>
        </tr>)}</tbody></table>
    </div>
    {data && data.exceptions.total === 0 && <p className="text-xs">조회 조건에 해당하는 미완료 내역이 없습니다.</p>}
    <div className="flex gap-3 text-xs items-center">
      <button disabled={page === 0} onClick={() => setPage(n => n - 1)}>이전</button>
      <span>{page + 1} / {Math.max(1, Math.ceil((data?.exceptions.total ?? 0) / 50))}</span>
      <button disabled={(page + 1) * 50 >= (data?.exceptions.total ?? 0)} onClick={() => setPage(n => n + 1)}>다음</button>
    </div>
    <p className="text-xs text-gray-500">정상 결과·근거부족 안내·정당한 제외·UNKNOWN은 recovery하지 않습니다.
      관리자 PUSH는 준비 완료 안내이며 학부모 발송은 기존 관리자 절차입니다.</p>
  </div>;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
      status === "SUCCESS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
    }`}>{status}</span>
  );
}

function UsageTab({ mode }: { mode: "usage" | "errors" }) {
  const [traces, setTraces] = useState<AiTrace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [feature, setFeature] = useState("");
  const [poolId, setPoolId] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  function load(pg = 0) {
    setLoading(true); setError(false);
    const params: string[] = [];
    if (feature) params.push(`feature=${encodeURIComponent(feature)}`);
    if (poolId)  params.push(`pool_id=${encodeURIComponent(poolId)}`);
    if (mode === "errors") params.push("status=FAILED");
    params.push(`limit=${PAGE_SIZE}`, `offset=${pg * PAGE_SIZE}`);
    api.get<TracesResponse>(`/super/ai-traces?${params.join("&")}`)
      .then((r) => { setTraces(r.traces ?? []); setTotal(r.total ?? 0); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { setPage(0); load(0); }, [feature, poolId, mode]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={feature}
          onChange={e => setFeature(e.target.value)}
          placeholder="feature 검색 (diary, growth ...)"
          className="border border-[#e5e5e5] rounded-md px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F] w-52"
        />
        <input
          value={poolId}
          onChange={e => setPoolId(e.target.value)}
          placeholder="pool_id"
          className="border border-[#e5e5e5] rounded-md px-3 py-1.5 text-[12px] outline-none focus:border-[#002F5F] w-40"
        />
        <span className="text-[12px] text-[#bbb] self-center ml-auto">{total.toLocaleString()}건</span>
      </div>

      {loading ? (
        <p className="text-[13px] text-[#bbb] animate-pulse py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-[13px] text-red-500 py-10 text-center">데이터 로드 실패</p>
      ) : (
        <>
          <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#f0f0f0] bg-[#fafafa]">
                  <th className="text-left px-4 py-3 text-[11px] text-[#888] font-semibold">시각</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">Feature</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">Status</th>
                  <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">Model</th>
                  <th className="text-right px-3 py-3 text-[11px] text-[#888] font-semibold">Tokens</th>
                  <th className="text-right px-3 py-3 text-[11px] text-[#888] font-semibold">응답</th>
                  {mode === "errors" && (
                    <th className="text-left px-3 py-3 text-[11px] text-[#888] font-semibold">오류</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {traces.length === 0 ? (
                  <tr>
                    <td colSpan={mode === "errors" ? 7 : 6} className="py-12 text-center text-[12px] text-[#bbb]">
                      {mode === "errors" ? "AI 오류 없음 ✓" : "기록 없음"}
                    </td>
                  </tr>
                ) : traces.map((t) => (
                  <tr key={t.id} className="border-b border-[#f5f5f5] last:border-0 hover:bg-[#fafafa]">
                    <td className="px-4 py-2 text-[#bbb] whitespace-nowrap">{fmtDate(t.created_at)}</td>
                    <td className="px-3 py-2 text-[#555] max-w-[120px] truncate">{t.feature ?? "—"}</td>
                    <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                    <td className="px-3 py-2 text-[#888]">{t.model ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-[#888]">
                      {t.total_tokens != null ? t.total_tokens.toLocaleString() : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      (t.latency_ms ?? 0) > 5000 ? "text-amber-600" : "text-[#888]"
                    }`}>
                      {t.latency_ms != null ? `${(t.latency_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                    {mode === "errors" && (
                      <td className="px-3 py-2 text-[#aaa] max-w-[200px] truncate" title={t.error_message ?? ""}>
                        {t.error_message ?? "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { const p = page - 1; setPage(p); load(p); }}
                disabled={page === 0}
                className="px-3 py-1.5 text-[12px] border border-[#e5e5e5] rounded hover:bg-[#f5f5f5] disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-[12px] text-[#888]">{page + 1} / {totalPages}</span>
              <button
                onClick={() => { const p = page + 1; setPage(p); load(p); }}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-[12px] border border-[#e5e5e5] rounded hover:bg-[#f5f5f5] disabled:opacity-40"
              >
                다음
              </button>
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-[#bbb]">
        ※ Partner Analytics 계측은 별도 구현 전 단계입니다.
        현재는 /super/ai-traces 엔드포인트를 재활용합니다.
      </p>
    </div>
  );
}

export default function SuperAI() {
  const [tab, setTab] = useState<TabKey>(() =>
    new URLSearchParams(window.location.search).get("tab") === "monthly" ? "monthly" : "templates");

  const TABS: { key: TabKey; label: string }[] = [
    { key: "templates",    label: "Global Templates" },
    { key: "growth_stats", label: "Growth Review Stats" },
    { key: "usage",        label: "AI 사용현황" },
    { key: "errors",       label: "AI 오류" },
    { key: "ai_cost",      label: "AI 비용" },
    { key: "monthly",      label: "월간 성장리포트 예외" },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-[20px] font-bold text-[#111]">AI 운영</h1>
        <p className="text-[12px] text-[#999] mt-0.5">글로벌 템플릿, Growth 통계, AI 호출 추적</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#e5e5e5] mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key ? "border-[#002F5F] text-[#002F5F]" : "border-transparent text-[#888] hover:text-[#444]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "templates"    && <GlobalTemplateSets />}
      {tab === "growth_stats" && <GrowthReviewStats />}
      {tab === "usage"        && <UsageTab mode="usage" />}
      {tab === "errors"       && <UsageTab mode="errors" />}
      {tab === "ai_cost"      && <AiCostDashboard />}
      {tab === "monthly"      && <MonthlyExceptionsTab />}
    </div>
  );
}
