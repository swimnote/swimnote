/**
 * SuperAI — SA0-B: AI 운영
 * - 탭: Global Templates / Growth Review Stats / AI 사용현황 / AI 오류
 * - AI 사용현황 + 오류: /super/ai-traces 재활용 (기존 엔드포인트)
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import GlobalTemplateSets from "@/pages/super/GlobalTemplateSets";
import GrowthReviewStats from "@/pages/super/GrowthReviewStats";

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

type TabKey = "templates" | "growth_stats" | "usage" | "errors";

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
  const [tab, setTab] = useState<TabKey>("templates");

  const TABS: { key: TabKey; label: string }[] = [
    { key: "templates",    label: "Global Templates" },
    { key: "growth_stats", label: "Growth Review Stats" },
    { key: "usage",        label: "AI 사용현황" },
    { key: "errors",       label: "AI 오류" },
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
    </div>
  );
}
