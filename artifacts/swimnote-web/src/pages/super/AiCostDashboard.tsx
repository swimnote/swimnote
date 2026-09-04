/**
 * AI01-09 — AI 비용 Dashboard
 *
 * GET /api/super/ai-cost-overview 한 번 호출 후 today/month toggle.
 * 외부 provider API 직접 호출 없음. 자동 polling 없음.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// ── Types (AI01-08 응답 형태) ────────────────────────────────────────────────

interface PeriodSummary {
  total_events:                number;
  logical_requests:            number;
  actual_calls_known:          number;
  actual_calls_unknown_events: number;
  retries:                     number;
  known_cost_usd:              number;
  unknown_cost_calls:          number;
  success_count:               number;
  failure_count:               number;
}

interface TriggerRow {
  trigger_type:       string;
  logical_requests:   number;
  actual_calls_known: number;
  known_cost_usd:     number;
  unknown_cost_calls: number;
}

interface FeatureRow {
  feature:                           string | null;
  total_events:                      number;
  logical_requests:                  number;
  actual_calls_known:                number;
  actual_calls_unknown_events:       number;
  retries:                           number;
  known_cost_usd:                    number;
  unknown_cost_calls:                number;
  success_count:                     number;
  failure_count:                     number;
  known_cost_per_logical_request_usd: number | null;
  known_cost_per_actual_call_usd:    number | null;
}

interface PsmRow {
  provider:           string;
  service:            string;
  model:              string | null;
  total_events:       number;
  logical_requests:   number;
  actual_calls_known: number;
  known_cost_usd:     number;
  unknown_cost_calls: number;
}

interface PoolRow {
  pool_id:            string;
  logical_requests:   number;
  actual_calls_known: number;
  known_cost_usd:     number;
  unknown_cost_calls: number;
}

interface PeriodData {
  period_start:              string;
  period_end:                string;
  summary:                   PeriodSummary;
  by_trigger_type:           TriggerRow[];
  by_feature:                FeatureRow[];
  by_provider_service_model: PsmRow[];
  by_pool:                   PoolRow[];
}

interface CostOverview {
  generated_at: string;
  today:        PeriodData;
  month:        PeriodData;
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.00001) return `$${n.toFixed(8)}`;
  if (n < 0.001)   return `$${n.toFixed(6)}`;
  if (n < 1)       return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, warn,
}: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-[#ebebeb] px-5 py-4 flex flex-col gap-1 min-w-[140px]">
      <p className="text-[12px] text-[#888] font-medium">{label}</p>
      <p className={`text-[22px] font-bold ${warn ? "text-amber-600" : "text-[#0a0a0a]"}`}>
        {typeof value === "number" ? fmtNum(value) : value}
      </p>
      {sub && <p className="text-[11px] text-[#aaa]">{sub}</p>}
    </div>
  );
}

function ThTd({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 text-[11px] font-semibold text-[#666] border-b border-[#f0f0f0] whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`px-3 py-2 text-[12px] text-[#333] whitespace-nowrap ${right ? "text-right" : ""}`}>
      {children}
    </td>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#ebebeb]">
      <table className="w-full bg-white">{children}</table>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[14px] font-semibold text-[#111] mb-2">{children}</h3>;
}

// ── Main component ───────────────────────────────────────────────────────────

type Period = "today" | "month";

export default function AiCostDashboard() {
  const [data, setData]       = useState<CostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [period, setPeriod]   = useState<Period>("today");

  function load() {
    setLoading(true);
    setError(false);
    api.get<CostOverview>("/super/ai-cost-overview")
      .then((r) => setData(r))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-[#aaa]">
        불러오는 중…
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="text-[13px] text-[#999]">비용 데이터를 불러오지 못했습니다.</p>
        <button
          onClick={load}
          className="px-4 py-1.5 text-[12px] border border-[#e5e5e5] rounded-lg text-[#444] hover:bg-[#f5f5f7] transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // ── Empty guard ──────────────────────────────────────────────────────────

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-[#aaa]">
        기록된 사용량이 없습니다.
      </div>
    );
  }

  const pd = data[period];
  const s  = pd.summary;

  const isEmpty = s.total_events === 0;

  return (
    <div className="space-y-6">

      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Period toggle */}
        <div className="flex gap-1 bg-[#f5f5f7] rounded-lg p-0.5">
          {(["today", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`px-4 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                period === p
                  ? "bg-white text-[#002F5F] shadow-sm font-semibold"
                  : "text-[#888] hover:text-[#444]"
              }`}
            >
              {p === "today" ? "오늘" : "이번 달"}
            </button>
          ))}
        </div>

        {/* Refresh + period info */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[#bbb]">
            {new Date(pd.period_start).toLocaleDateString("ko-KR")} –{" "}
            {new Date(pd.period_end).toLocaleTimeString("ko-KR", { timeStyle: "short" })}
          </span>
          <button
            onClick={load}
            className="px-3 py-1.5 text-[12px] border border-[#e5e5e5] rounded-lg text-[#444] hover:bg-[#f5f5f7] transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {isEmpty && (
        <div className="flex items-center justify-center py-12 text-[13px] text-[#aaa]">
          기록된 사용량이 없습니다.
        </div>
      )}

      {!isEmpty && (
        <>
          {/* ── Summary cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="논리 요청"           value={s.logical_requests} />
            <SummaryCard label="확인된 실제 호출"    value={s.actual_calls_known} />
            <SummaryCard
              label="실제 호출 미확인 기록"
              value={s.actual_calls_unknown_events}
              warn={s.actual_calls_unknown_events > 0}
            />
            <SummaryCard label="재시도"              value={s.retries} />
            <SummaryCard
              label="확인된 비용"
              value={fmtUsd(s.known_cost_usd)}
              sub="USD (계약 단가 확인된 항목만)"
            />
            <SummaryCard
              label="비용 미확인 기록"
              value={`${fmtNum(s.unknown_cost_calls)}건`}
              sub="단가 미확인 — $0 아님"
              warn={s.unknown_cost_calls > 0}
            />
            <SummaryCard label="성공"    value={s.success_count} />
            <SummaryCard label="실패"    value={s.failure_count} warn={s.failure_count > 0} />
          </div>

          {/* ── Trigger Type ──────────────────────────────────────────── */}
          {pd.by_trigger_type.length > 0 && (
            <div>
              <SectionTitle>Trigger 유형별</SectionTitle>
              <TableWrap>
                <thead>
                  <tr>
                    <ThTd>Trigger</ThTd>
                    <ThTd right>논리 요청</ThTd>
                    <ThTd right>실제 호출</ThTd>
                    <ThTd right>확인 비용</ThTd>
                    <ThTd right>비용 미확인</ThTd>
                  </tr>
                </thead>
                <tbody>
                  {pd.by_trigger_type.map((r) => (
                    <tr key={r.trigger_type} className="hover:bg-[#fafafa] border-b border-[#f8f8f8] last:border-0">
                      <Td>
                        <span className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                          r.trigger_type === "SYSTEM_MAINTENANCE"
                            ? "bg-purple-100 text-purple-700"
                            : r.trigger_type === "USER_ACTION"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-[#f0f0f0] text-[#666]"
                        }`}>
                          {r.trigger_type}
                        </span>
                      </Td>
                      <Td right>{fmtNum(r.logical_requests)}</Td>
                      <Td right>{fmtNum(r.actual_calls_known)}</Td>
                      <Td right>{fmtUsd(r.known_cost_usd)}</Td>
                      <Td right>
                        {r.unknown_cost_calls > 0
                          ? <span className="text-amber-600">{fmtNum(r.unknown_cost_calls)}건</span>
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {/* ── Feature ───────────────────────────────────────────────── */}
          {pd.by_feature.length > 0 && (
            <div>
              <SectionTitle>Feature별</SectionTitle>
              <TableWrap>
                <thead>
                  <tr>
                    <ThTd>Feature</ThTd>
                    <ThTd right>논리 요청</ThTd>
                    <ThTd right>실제 호출</ThTd>
                    <ThTd right>재시도</ThTd>
                    <ThTd right>확인 비용</ThTd>
                    <ThTd right>비용 미확인</ThTd>
                    <ThTd right>요청당 확인비용</ThTd>
                  </tr>
                </thead>
                <tbody>
                  {pd.by_feature.map((r) => (
                    <tr key={r.feature ?? "UNKNOWN"} className="hover:bg-[#fafafa] border-b border-[#f8f8f8] last:border-0">
                      <Td>
                        <span className="font-mono text-[11px]">{r.feature ?? "UNKNOWN"}</span>
                      </Td>
                      <Td right>{fmtNum(r.logical_requests)}</Td>
                      <Td right>{fmtNum(r.actual_calls_known)}</Td>
                      <Td right>{fmtNum(r.retries)}</Td>
                      <Td right>{fmtUsd(r.known_cost_usd)}</Td>
                      <Td right>
                        {r.unknown_cost_calls > 0
                          ? <span className="text-amber-600">{fmtNum(r.unknown_cost_calls)}건</span>
                          : "—"}
                      </Td>
                      <Td right>
                        {r.known_cost_per_logical_request_usd != null
                          ? fmtUsd(r.known_cost_per_logical_request_usd)
                          : <span className="text-[#bbb]">—</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {/* ── Provider / Service / Model ────────────────────────────── */}
          {pd.by_provider_service_model.length > 0 && (
            <div>
              <SectionTitle>Provider / Service / Model</SectionTitle>
              <TableWrap>
                <thead>
                  <tr>
                    <ThTd>Provider</ThTd>
                    <ThTd>Service</ThTd>
                    <ThTd>Model</ThTd>
                    <ThTd right>논리 요청</ThTd>
                    <ThTd right>실제 호출</ThTd>
                    <ThTd right>확인 비용</ThTd>
                    <ThTd right>비용 미확인</ThTd>
                  </tr>
                </thead>
                <tbody>
                  {pd.by_provider_service_model.map((r, i) => (
                    <tr key={i} className="hover:bg-[#fafafa] border-b border-[#f8f8f8] last:border-0">
                      <Td><span className="font-mono text-[11px]">{r.provider}</span></Td>
                      <Td><span className="font-mono text-[11px]">{r.service}</span></Td>
                      <Td>
                        {r.model
                          ? <span className="font-mono text-[11px]">{r.model}</span>
                          : <span className="text-[#ccc]">-</span>}
                      </Td>
                      <Td right>{fmtNum(r.logical_requests)}</Td>
                      <Td right>{fmtNum(r.actual_calls_known)}</Td>
                      <Td right>{fmtUsd(r.known_cost_usd)}</Td>
                      <Td right>
                        {r.unknown_cost_calls > 0
                          ? <span className="text-amber-600">{fmtNum(r.unknown_cost_calls)}건</span>
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {/* ── Pool ──────────────────────────────────────────────────── */}
          {pd.by_pool.length > 0 && (
            <div>
              <SectionTitle>Pool별</SectionTitle>
              <TableWrap>
                <thead>
                  <tr>
                    <ThTd>Pool ID</ThTd>
                    <ThTd right>논리 요청</ThTd>
                    <ThTd right>실제 호출</ThTd>
                    <ThTd right>확인 비용</ThTd>
                    <ThTd right>비용 미확인</ThTd>
                  </tr>
                </thead>
                <tbody>
                  {pd.by_pool.map((r) => (
                    <tr key={r.pool_id} className="hover:bg-[#fafafa] border-b border-[#f8f8f8] last:border-0">
                      <Td><span className="font-mono text-[11px]">{r.pool_id || "—"}</span></Td>
                      <Td right>{fmtNum(r.logical_requests)}</Td>
                      <Td right>{fmtNum(r.actual_calls_known)}</Td>
                      <Td right>{fmtUsd(r.known_cost_usd)}</Td>
                      <Td right>
                        {r.unknown_cost_calls > 0
                          ? <span className="text-amber-600">{fmtNum(r.unknown_cost_calls)}건</span>
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}

          {/* ── Footer ────────────────────────────────────────────────── */}
          <p className="text-[11px] text-[#bbb]">
            ※ 확인된 비용(USD)은 시스템이 단가를 확인한 이벤트만 포함합니다. 비용 미확인 기록은 $0이 아닙니다.
          </p>
        </>
      )}
    </div>
  );
}
