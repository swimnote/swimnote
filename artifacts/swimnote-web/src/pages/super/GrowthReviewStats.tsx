/**
 * GrowthReviewStats.tsx — WP15 Growth Review Statistics
 *
 * READ ONLY. 운영 workflow 통계.
 * growth_events source 기준 (audit_logs 사용 금지).
 *
 * 주의: 이 통계는 검토 처리 현황이지 학생 성장 점수가 아님.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

const PRIMARY  = "#002F5F";
const SECONDARY = "#01B2F1";

interface StatsSummary {
  total_valid_events:         number;
  pending_review:             number;
  teacher_accepted:           number;
  teacher_rejected:           number;
  auto_accepted:              number;
  discarded:                  number;
  reviewed_total:             number;
  review_rate:                number;
  accepted_rate:              number;
  rejected_rate:              number;
  pending_over_24h:           number;
  pending_over_48h:           number;
  average_review_time_hours:  number | null;
}

interface PoolBreakdown {
  pool_id:      string;
  pool_name:    string | null;
  total:        number;
  pending:      number;
  accepted:     number;
  rejected:     number;
  auto_accepted: number;
  discarded:    number;
  review_rate:  number;
}

interface StatsResponse {
  summary:       StatsSummary;
  pool_breakdown: PoolBreakdown[];
  filters:       { from: string | null; to: string | null; pool_id: string | null };
}

function pct(v: number) {
  return (v * 100).toFixed(1) + "%";
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#ebebeb] p-4 flex flex-col gap-1">
      <p className="text-[11px] font-semibold text-[#aaa]">{label}</p>
      <p className="text-[22px] font-bold leading-tight" style={{ color: color ?? PRIMARY }}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-[#bbb]">{sub}</p>}
    </div>
  );
}

type LoadState = "idle" | "loading" | "success" | "error";

export default function GrowthReviewStats() {
  const [from,   setFrom]   = useState("");
  const [to,     setTo]     = useState("");
  const [poolId, setPoolId] = useState("");

  const [data,      setData]      = useState<StatsResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (from)   p.set("from",    from);
    if (to)     p.set("to",      to);
    if (poolId) p.set("pool_id", poolId);
    return `/super/growth-review-stats?${p.toString()}`;
  }, [from, to, poolId]);

  const fetchStats = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await api.get<StatsResponse>(buildQuery());
      setData(res);
      setLoadState("success");
    } catch {
      setLoadState("error");
    }
  }, [buildQuery]);

  useEffect(() => { fetchStats(); }, []); // 최초 1회

  const s = data?.summary;
  const pools = data?.pool_breakdown ?? [];

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[17px] font-bold text-[#0a0a0a]">검토 통계</h2>
          <p className="text-[12px] text-[#aaa] mt-0.5">
            성장 이벤트 검토 처리 현황입니다. 학생 성장 점수가 아닙니다.
          </p>
        </div>
        <button
          onClick={fetchStats}
          className="text-[12px] text-[#888] hover:text-[#0a0a0a] transition-colors"
        >
          새로고침
        </button>
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-2xl border border-[#ebebeb] p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">From (created_at)</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">To</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] focus:outline-none focus:border-[#01B2F1]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-[#888]">Pool ID</label>
          <input
            type="text"
            value={poolId}
            onChange={e => setPoolId(e.target.value)}
            placeholder="pool_xxx"
            className="px-3 py-2 rounded-xl border border-[#e5e5e5] text-[13px] w-[160px] focus:outline-none focus:border-[#01B2F1]"
          />
        </div>
        <button
          onClick={fetchStats}
          className="px-5 py-2 rounded-xl text-white text-[13px] font-semibold hover:opacity-85 transition-opacity"
          style={{ background: PRIMARY }}
        >
          조회
        </button>
        {(from || to || poolId) && (
          <button
            onClick={() => {
              setFrom(""); setTo(""); setPoolId("");
              setTimeout(fetchStats, 0);
            }}
            className="px-4 py-2 rounded-xl border border-[#ebebeb] text-[13px] text-[#888] hover:bg-[#f5f5f5]"
          >
            초기화
          </button>
        )}
      </div>

      {/* 로딩 */}
      {loadState === "loading" && (
        <div className="py-20 text-center text-[#aaa] text-[14px]">불러오는 중...</div>
      )}

      {/* 에러 */}
      {loadState === "error" && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-10 text-center">
          <p className="text-[14px] font-semibold text-red-600 mb-3">통계를 불러오지 못했습니다.</p>
          <button
            onClick={fetchStats}
            className="px-5 py-2 rounded-xl text-white text-[13px] font-semibold"
            style={{ background: PRIMARY }}
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 데이터 */}
      {loadState === "success" && s && (
        <>
          {/* 빈 상태 */}
          {s.total_valid_events === 0 && (
            <div className="bg-white rounded-2xl border border-[#ebebeb] py-20 text-center mb-5">
              <p className="text-[14px] text-[#aaa]">아직 성장 이벤트 데이터가 없습니다.</p>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
            <StatCard label="전체 후보"     value={s.total_valid_events.toLocaleString()} />
            <StatCard label="검토 대기"     value={s.pending_review.toLocaleString()}
              color={s.pending_review > 0 ? "#e07d00" : undefined} />
            <StatCard label="승인 (교사)"   value={s.teacher_accepted.toLocaleString()}
              color="#1a7a4a" />
            <StatCard label="제외 (교사)"   value={s.teacher_rejected.toLocaleString()}
              color="#c0392b" />
            <StatCard label="자동 수락"     value={s.auto_accepted.toLocaleString()}
              sub="AI 자동 처리" />
            <StatCard label="폐기"          value={s.discarded.toLocaleString()} />
            <StatCard label="검토율"
              value={pct(s.review_rate)}
              sub="(대기+승인+제외) 기준"
              color={SECONDARY} />
            <StatCard label="승인율 (검토)"
              value={pct(s.accepted_rate)}
              sub="검토 완료 기준" />
          </div>

          {/* 대기 시간 + 처리시간 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <StatCard
              label="24h 이상 대기"
              value={s.pending_over_24h.toLocaleString()}
              color={s.pending_over_24h > 0 ? "#e07d00" : undefined}
              sub="상태 변경 없음 (READ ONLY)"
            />
            <StatCard
              label="48h 이상 대기"
              value={s.pending_over_48h.toLocaleString()}
              color={s.pending_over_48h > 0 ? "#c0392b" : undefined}
              sub="상태 변경 없음 (READ ONLY)"
            />
            {s.average_review_time_hours !== null && (
              <StatCard
                label="평균 검토 처리시간"
                value={`${s.average_review_time_hours}h`}
                sub="reviewed_at − created_at"
              />
            )}
          </div>

          {/* 수영장별 breakdown */}
          {pools.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#ebebeb] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f0f0f0]">
                <p className="text-[14px] font-bold text-[#0a0a0a]">수영장별 현황</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-[#f8f9fb]">
                      {["수영장", "전체", "대기", "승인", "제외", "자동", "폐기", "검토율"].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-semibold text-[#888] whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pools.map((p, i) => (
                      <tr key={p.pool_id ?? i}
                        className="border-t border-[#f0f0f0] hover:bg-[#fafafa] transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#0a0a0a]">
                            {p.pool_name ?? "—"}
                          </p>
                          <p className="text-[10px] text-[#bbb] mt-0.5">{p.pool_id}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">{p.total.toLocaleString()}</td>
                        <td className="px-4 py-3"
                          style={{ color: p.pending > 0 ? "#e07d00" : undefined }}>
                          {p.pending.toLocaleString()}
                        </td>
                        <td className="px-4 py-3" style={{ color: "#1a7a4a" }}>
                          {p.accepted.toLocaleString()}
                        </td>
                        <td className="px-4 py-3" style={{ color: "#c0392b" }}>
                          {p.rejected.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-[#888]">{p.auto_accepted.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[#aaa]">{p.discarded.toLocaleString()}</td>
                        <td className="px-4 py-3 font-semibold" style={{ color: SECONDARY }}>
                          {pct(p.review_rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
