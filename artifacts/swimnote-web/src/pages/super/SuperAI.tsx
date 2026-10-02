/**
 * SuperAI — SA0-B: AI 운영
 * - 탭: Global Templates / Growth Review Stats / AI 사용현황 / AI 오류
 * - AI 사용현황 + 오류: /super/ai-traces 재활용 (기존 엔드포인트)
 */
import { useEffect, useRef, useState } from "react";
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
  analysis_status?: string;
  monthly_final_disposition?: string;
  first_pass_outcome?: string;
  first_pass_error_code?: string;
  first_pass_error_category?: string;
  preparation_error?: string;
  recovery_epoch?: number;
  first_pass_engine_requests?: number;
  recovery_engine_requests?: number;
  lookup_requests?: number;
  recovery_allowed?: boolean;
  analysis_uncertain_at?: string | null;
  unknown_reissue_allowed?: boolean;
  unknown_reissue_next_approval_allowed?: boolean;
  unknown_reissue_hold_reason?: string | null;
  unknown_reissue_operation?: UnknownReissueResult | null;
}
interface UnknownReissueResult {
  report_id: string;
  recovery_operation_id?: string;
  new_request_id?: string;
  recovery_generation?: number;
  state: string;
  error_code?: string;
  detail?: string;
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
  const [category, setCategory] = useState(() =>
    new URLSearchParams(window.location.search).get("category") ?? "");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<MonthlyDiagnostics | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [revision, setRevision] = useState(0);
  const [selectedUnknownIds, setSelectedUnknownIds] = useState<string[]>([]);
  const [unknownResults, setUnknownResults] = useState<Record<string, UnknownReissueResult>>({});
  const [unknownRetryNeeded, setUnknownRetryNeeded] = useState(false);
  const busyRef = useRef(false);

  function clearUnknownSelection() {
    setSelectedUnknownIds([]);
    setUnknownResults({});
    setUnknownRetryNeeded(false);
  }

  function isUnknownRow(row: MonthlyException) {
    if (row.unknown_reissue_hold_reason?.toUpperCase() === "NOT_UNKNOWN") return false;
    return row.first_pass_error_category === "UNKNOWN" || row.first_pass_outcome === "UNKNOWN" ||
      row.analysis_uncertain_at != null || row.unknown_reissue_operation != null;
  }

  function isResolvedUnknown(row: MonthlyException) {
    const terminal = new Set(["GENERATED", "COMPLETE", "SUCCESS", "INSUFFICIENT_EVIDENCE",
      "EXCLUDED", "PUBLISHED", "READY_TO_SEND", "APPROVED",
      "COMPLETE_WITH_QUESTIONS_AVAILABLE", "COMPLETE_WITH_PARENT_EVIDENCE"]);
    // A current uncertain report can retain an older COMPLETE analysis status.
    // Only the server's existing reissue eligibility may override that residual
    // field; actual terminal report/disposition/operation results still block.
    const serverEligibleUnknown = row.analysis_uncertain_at != null &&
      (row.unknown_reissue_allowed === true || row.unknown_reissue_next_approval_allowed === true);
    return [row.product_status, serverEligibleUnknown ? undefined : row.analysis_status, row.first_pass_outcome,
      row.monthly_final_disposition,
      unknownResults[row.report_id ?? ""]?.state, row.unknown_reissue_operation?.state]
      .some(value => terminal.has(String(value ?? "").toUpperCase()));
  }

  useEffect(() => {
    let active = true;
    const load = () => {
      const query = new URLSearchParams({ report_period: period, limit: "50", offset: String(page * 50) });
      if (pool) query.set("pool_id", pool);
      if (category) query.set("category", category);
      api.get<MonthlyDiagnostics>(`/super/growth-reports/monthly-automation?${query}`)
        .then(result => {
          if (active) {
            setData(result); setError("");
            const rows = result.exceptions?.rows ?? [];
            const rowsById = new Map(rows.filter(row => row.report_id).map(row => [row.report_id!, row]));
            setSelectedUnknownIds(current => current.filter(id => {
              const row = rowsById.get(id);
              return !row || (!isResolvedUnknown(row) && (row.unknown_reissue_allowed !== false ||
                row.unknown_reissue_next_approval_allowed === true || unknownRetryNeeded ||
                row.unknown_reissue_operation?.state.toUpperCase() === "PROCESSING"));
            }));
            setUnknownResults(current => {
              const next = { ...current };
              for (const row of rows) {
                if (row.report_id && row.unknown_reissue_operation) {
                  next[row.report_id] = { ...row.unknown_reissue_operation, report_id: row.report_id };
                }
              }
              return next;
            });
          }
        })
        .catch(() => { if (active) { setData(null); setError("월간 실행 정보를 불러오지 못했습니다."); } });
    };
    setData(null); load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [period, pool, category, page, revision, unknownRetryNeeded]);

  async function operate(action: "recover" | "resume", poolId?: string) {
    if (!reason.trim() || busyRef.current) return;
    if (!window.confirm(action === "resume" ? "원인 수정 후 제한된 probe로 재개하시겠습니까?"
      : "이 수영장의 허용된 실패만 recovery 승인하시겠습니까? 정상 결과와 UNKNOWN은 제외됩니다.")) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await api.post(action === "resume" ? "/super/growth-reports/monthly-automation/resume"
        : "/super/growth-reports/batch-recovery", action === "resume"
        ? { report_period: period, reason: reason.trim() }
        : { pool_id: poolId, report_month: period, reason: reason.trim() });
      setReason(""); setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "작업이 허용되지 않았습니다."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function approveUnknownReissue(nextGeneration = false) {
    const reportIds = [...selectedUnknownIds];
    if (!reportIds.length || !reason.trim() || busyRef.current) return;
    const rowsById = new Map((data?.exceptions.rows ?? []).filter(row => row.report_id)
      .map(row => [row.report_id!, row]));
    const expectedOperationIds: Record<string, string> = {};
    if (nextGeneration) {
      if (reportIds.length !== 1) return;
      for (const id of reportIds) {
        const row = rowsById.get(id);
        const operationId = row?.unknown_reissue_operation?.recovery_operation_id;
        if (!row || row.unknown_reissue_next_approval_allowed !== true || !operationId || isResolvedUnknown(row)) return;
        expectedOperationIds[id] = operationId;
      }
    }
    const confirmed = window.confirm(
      nextGeneration
        ? `${period} 월 UNKNOWN ${reportIds.length}건에 대해 추가 재분석을 승인하시겠습니까? ` +
          "새로운 유료 분석 시도가 발생합니다. 가장 최근 UNKNOWN 귀결에 대한 별도 승인이며, 반드시 대상과 비용 가능성을 확인하세요."
        : `${period} 월 UNKNOWN ${reportIds.length}건을 재분석 승인하시겠습니까? ` +
          "재분석은 유료 신규 시도를 발생시킬 수 있습니다. 승인 후에도 결과 확인이 필요합니다."
      + `\n대상 report: ${reportIds.join(", ")}\n승인 사유: ${reason.trim()}`
    );
    if (!confirmed) return;
    busyRef.current = true; setBusy(true); setError(""); setUnknownRetryNeeded(false);
    try {
      const body = {
        report_ids: reportIds, confirmed: true, reason: reason.trim(),
        ...(nextGeneration ? { next_generation: true, expected_operation_ids: expectedOperationIds } : {}),
      };
      const response = await api.post<{ results: UnknownReissueResult[] }>(
        "/super/growth-reports/unknown-reissue", body,
      );
      const results = Array.isArray(response?.results) ? response.results : [];
      setUnknownResults(current => {
        const next = { ...current };
        for (const result of results) next[result.report_id] = result;
        return next;
      });
      const resolvedIds = new Set(results.filter(result =>
        /GENERATED|COMPLETE|SUCCESS|INSUFFICIENT_EVIDENCE|EXCLUDED/.test(result.state.toUpperCase())
      ).map(result => result.report_id));
      if (resolvedIds.size) setSelectedUnknownIds(current => current.filter(id => !resolvedIds.has(id)));
      setUnknownRetryNeeded(results.some(result => result.state.toUpperCase() === "PROCESSING"));
      setRevision(n => n + 1);
    } catch (e) {
      setUnknownRetryNeeded(true);
      setError(e instanceof Error ? e.message : "재분석 승인 결과를 확인하지 못했습니다. 같은 대상을 다시 확인하세요.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      <label className="text-xs">분석월 (발급월의 전월)
        <input aria-label="분석월" type="month" value={period}
          onChange={e => { clearUnknownSelection(); setPeriod(e.target.value); setPage(0); }} className="block border rounded p-2" /></label>
      <input aria-label="수영장 ID" placeholder="수영장 ID" value={pool}
        onChange={e => { clearUnknownSelection(); setPool(e.target.value); setPage(0); }} className="border rounded p-2 text-xs" />
      <select aria-label="오류 분류" value={category} onChange={e => { clearUnknownSelection(); setCategory(e.target.value); setPage(0); }}
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
    {(() => {
      const unknownRows = (data?.exceptions.rows ?? []).filter(isUnknownRow);
      const unknownRowsById = new Map(unknownRows.filter(row => row.report_id).map(row => [row.report_id!, row]));
      const selectableIds = new Set(unknownRows.filter(row => row.report_id &&
        (row.unknown_reissue_allowed === true || row.unknown_reissue_next_approval_allowed === true) &&
        !isResolvedUnknown(row)).map(row => row.report_id!));
      const nextApprovalAllowed = selectedUnknownIds.length === 1 && selectedUnknownIds.every(id => {
        const row = unknownRowsById.get(id);
        return row?.unknown_reissue_next_approval_allowed === true &&
          Boolean(row.unknown_reissue_operation?.recovery_operation_id) && !isResolvedUnknown(row);
      });
      const replayPending = unknownRetryNeeded || selectedUnknownIds.some(id =>
        Boolean(unknownResults[id]?.recovery_operation_id ||
          unknownRowsById.get(id)?.unknown_reissue_operation?.recovery_operation_id));
      const selectedCount = selectedUnknownIds.filter(id => selectableIds.has(id) ||
        !unknownRowsById.has(id) ||
        (replayPending && !isResolvedUnknown(unknownRowsById.get(id)!))).length;
      return <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <strong className="text-sm">UNKNOWN 재분석 승인</strong>
          <span aria-live="polite" className="text-xs">선택 {selectedCount}건</span>
          <button type="button" disabled={busy || !selectedCount || !reason.trim()}
            onClick={() => approveUnknownReissue()} className="rounded bg-[#002F5F] text-white px-3 py-2 text-sm font-semibold disabled:opacity-40">
            {busy ? "재분석 승인 처리 중..." : replayPending ? "동일 승인 상태 확인 / 재시도" : "재분석 승인"}
          </button>
          <button type="button" disabled={busy || !nextApprovalAllowed || !reason.trim()}
            onClick={() => approveUnknownReissue(true)}
            className="border rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
            추가 재분석 승인
          </button>
        </div>
        <p className="text-xs text-amber-900">
          아래 UNKNOWN 행을 선택하고 승인 사유를 입력한 뒤 재분석을 승인하세요. 파일럿은 1건만 선택할 수 있습니다.
          재분석은 유료 신규 시도를 발생시킬 수 있습니다. 기존 operation은 동일 승인으로 상태 확인 / 재시도하며,
          새 회차는 별도 추가 승인 1건으로만 요청합니다. 페이지 진입이나 선택만으로 실행하지 않습니다.
        </p>
        {Object.values(unknownResults).length > 0 && <ul className="space-y-1 text-xs" aria-label="UNKNOWN 재분석 결과">
          {Object.values(unknownResults).map(result => <li key={result.report_id} role="status">
            {result.report_id}: {result.state}
            {result.recovery_operation_id && ` / Operation ${result.recovery_operation_id}`}
            {result.new_request_id && ` / Request ${result.new_request_id}`}
            {result.recovery_generation != null && ` / 회차 ${result.recovery_generation}`}
            {result.error_code && ` / ${result.error_code}`}
            {result.detail && ` / ${result.detail}`}
          </li>)}
        </ul>}
      </section>;
    })()}
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-xs"><thead><tr>
        {["선택", "수영장 / report", "현재 상태", "오류", "recovery 회차", "first / recovery / lookup", "운영"].map(x =>
          <th key={x} className="p-2 text-left">{x}</th>)}
      </tr></thead><tbody>{(data?.exceptions.rows ?? []).map((row, i) =>
        <tr key={`${row.swimming_pool_id}:${row.report_id ?? i}`} className="border-t">
          <td className="p-2">
            {isUnknownRow(row) && row.report_id ? <input type="checkbox"
              aria-label={`UNKNOWN ${row.report_id} 선택`}
              checked={selectedUnknownIds.includes(row.report_id)}
              disabled={busy || (row.unknown_reissue_allowed !== true &&
                row.unknown_reissue_next_approval_allowed !== true) || isResolvedUnknown(row)}
              onChange={e => setSelectedUnknownIds(current => e.target.checked
                ? [...new Set([...current, row.report_id!])] : current.filter(id => id !== row.report_id))}
            /> : "—"}
          </td>
          <td className="p-2">{row.swimming_pool_id}<br />{row.report_id ?? "준비 단계"}</td>
          <td className="p-2">{isUnknownRow(row) && !isResolvedUnknown(row)
            ? <><strong>UNKNOWN</strong><div className="text-gray-500">
                Lifecycle: {row.product_status ?? "—"}
              </div></>
            : row.product_status ?? row.first_pass_outcome ?? "PREPARATION"}</td>
          <td className="p-2">{row.first_pass_error_category}<br />{row.first_pass_error_code ?? row.preparation_error}</td>
          <td className="p-2">{row.recovery_epoch ?? 0}</td>
          <td className="p-2">{row.first_pass_engine_requests ?? 0} / {row.recovery_engine_requests ?? 0} / {row.lookup_requests ?? 0}</td>
          <td className="p-2">
            {row.report_id && isUnknownRow(row) && !isResolvedUnknown(row) &&
              (row.unknown_reissue_allowed === true || row.unknown_reissue_next_approval_allowed === true)
              ? <div className="space-y-1"><div>재분석 승인 가능</div><button type="button" disabled={busy}
                  onClick={() => setSelectedUnknownIds([row.report_id!])}
                  className="rounded border border-[#002F5F] px-2 py-1 text-[#002F5F] font-semibold disabled:opacity-40">
                  {selectedUnknownIds.includes(row.report_id!) ? "재분석 승인 대상 선택됨" : "재분석 승인 대상 선택"}
                </button></div>
              : row.recovery_allowed
              ? <button disabled={busy || !reason.trim()} onClick={() => operate("recover", row.swimming_pool_id)}
                className="border rounded p-1 disabled:opacity-40">허용된 실패 recovery</button>
              : <span>HOLD / 재분석 불가</span>}
            {row.unknown_reissue_hold_reason && <div className="mt-1 text-amber-800">UNKNOWN HOLD: {row.unknown_reissue_hold_reason}</div>}
            {row.report_id && (unknownResults[row.report_id] ?? row.unknown_reissue_operation) &&
              <div className="mt-1" role="status">
                UNKNOWN 재분석: {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.state}
                {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.recovery_operation_id &&
                  <><br />Operation: {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.recovery_operation_id}</>}
                {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.new_request_id &&
                  <><br />Request: {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.new_request_id}</>}
                {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.recovery_generation != null &&
                  <><br />회차: {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.recovery_generation}</>}
                {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.error_code &&
                  <><br />오류: {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.error_code}</>}
                {(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.detail &&
                  <><br />{(unknownResults[row.report_id] ?? row.unknown_reissue_operation)?.detail}</>}
              </div>}
          </td>
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
  const [tab, setTab] = useState<TabKey>(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    return ["templates", "growth_stats", "usage", "errors", "ai_cost", "monthly"].includes(value ?? "")
      ? value as TabKey : "monthly";
  });

  const TABS: { key: TabKey; label: string }[] = [
    { key: "monthly",      label: "월간 성장리포트 / UNKNOWN 재분석" },
    { key: "templates",    label: "Global Templates" },
    { key: "growth_stats", label: "Growth Review Stats" },
    { key: "usage",        label: "AI 사용현황" },
    { key: "errors",       label: "AI 오류" },
    { key: "ai_cost",      label: "AI 비용" },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-[20px] font-bold text-[#111]">AI 운영</h1>
        <p className="text-[12px] text-[#999] mt-0.5">월간 성장리포트 UNKNOWN 승인, 글로벌 템플릿, Growth 통계, AI 호출 추적</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#e5e5e5] mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              const url = new URL(window.location.href);
              url.searchParams.set("tab", t.key);
              window.history.replaceState(window.history.state, "", url);
            }}
            aria-pressed={tab === t.key}
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
