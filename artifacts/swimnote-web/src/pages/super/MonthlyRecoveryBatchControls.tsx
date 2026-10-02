import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface RecoveryPreview {
  report_month: string;
  pool_id: string | null;
  eligible_total: number;
  failed_total: number;
  unknown_total: number;
  next_round: number;
}

interface RecoveryBatch {
  id: string;
  report_month: string;
  pool_id: string | null;
  recovery_round: number;
  state: string;
  total: number;
  completed: number;
  success: number;
  insufficient_evidence: number;
  failed: number;
  unknown: number;
  conflict: number;
  remaining: number;
  pause_reason?: string | null;
}

interface CreateBody {
  report_month: string;
  pool_id?: string;
  reason: string;
  confirmed: true;
  approval_id: string;
}

interface PendingApproval {
  body: CreateBody;
  eligibleTotal: number;
  failedTotal: number;
  unknownTotal: number;
  nextRound: number;
  hadPriorBatch: boolean;
}

interface Props {
  reportMonth: string;
  poolId: string;
  reason: string;
  onReasonChange: (reason: string) => void;
}

const BASE = "/super/growth-reports/recovery-batches";
const TERMINAL_STATES = new Set([
  "COMPLETE", "COMPLETED", "SUCCESS", "SUCCEEDED", "FAILED", "PARTIAL",
  "CANCELLED", "CANCELED", "FINISHED",
]);

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readPreview(value: unknown, month: string, pool: string): RecoveryPreview | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const reportMonth = item.report_month;
  const poolId = item.pool_id;
  const eligibleTotal = item.eligible_total;
  const failedTotal = item.failed_total;
  const unknownTotal = item.unknown_total;
  const nextRound = item.next_round;
  if (typeof reportMonth !== "string" || reportMonth !== month ||
      !(poolId === null || typeof poolId === "string") || poolId !== (pool || null) ||
      !isCount(eligibleTotal) || !isCount(failedTotal) ||
      !isCount(unknownTotal) || !isCount(nextRound)) return null;
  return {
    report_month: reportMonth,
    pool_id: poolId,
    eligible_total: eligibleTotal,
    failed_total: failedTotal,
    unknown_total: unknownTotal,
    next_round: nextRound,
  };
}

function readBatch(value: unknown): RecoveryBatch | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = item.id;
  const reportMonth = item.report_month;
  const poolId = item.pool_id;
  const recoveryRound = item.recovery_round;
  const state = item.state;
  const total = item.total;
  const completed = item.completed;
  const success = item.success;
  const insufficientEvidence = item.insufficient_evidence;
  const failed = item.failed;
  const unknown = item.unknown;
  const conflict = item.conflict;
  const remaining = item.remaining;
  const pauseReason = item.pause_reason;
  if (typeof id !== "string" || typeof reportMonth !== "string" ||
      !(poolId === null || typeof poolId === "string") ||
      !isCount(recoveryRound) || typeof state !== "string" ||
      !isCount(total) || !isCount(completed) || !isCount(success) ||
      !isCount(insufficientEvidence) || !isCount(failed) || !isCount(unknown) ||
      !isCount(conflict) || !isCount(remaining) ||
      (pauseReason !== undefined && pauseReason !== null && typeof pauseReason !== "string")) return null;
  return {
    id, report_month: reportMonth, pool_id: poolId, recovery_round: recoveryRound,
    state, total, completed, success, insufficient_evidence: insufficientEvidence,
    failed, unknown, conflict, remaining,
    ...(pauseReason !== undefined ? { pause_reason: pauseReason } : {}),
  };
}

function isTerminal(batch: RecoveryBatch) {
  const state = batch.state.toUpperCase();
  return TERMINAL_STATES.has(state) ||
    (!new Set(["PAUSED", "RUNNING", "PROCESSING", "QUEUED", "PENDING", "CREATED", "IN_PROGRESS"])
      .has(state) && batch.remaining === 0 && batch.completed >= batch.total);
}

function queryString(month: string, pool: string) {
  const query = new URLSearchParams({ report_month: month });
  if (pool) query.set("pool_id", pool);
  return query.toString();
}

export default function MonthlyRecoveryBatchControls({ reportMonth, poolId, reason, onReasonChange }: Props) {
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [batches, setBatches] = useState<RecoveryBatch[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [replayed, setReplayed] = useState(false);
  const busyRef = useRef(false);
  const scopeRef = useRef(`${reportMonth}:${poolId.trim()}`);
  scopeRef.current = `${reportMonth}:${poolId.trim()}`;

  const load = useCallback(async (active: () => boolean) => {
    const query = queryString(reportMonth, poolId.trim());
    const [previewResult, batchesResult] = await Promise.allSettled([
      api.get<unknown>(`${BASE}/preview?${query}`),
      api.get<unknown>(`${BASE}?${query}`),
    ]);
    if (!active()) return;
    const errors: string[] = [];
    if (previewResult.status === "fulfilled") {
      const parsed = readPreview(previewResult.value, reportMonth, poolId.trim());
      if (parsed) setPreview(parsed);
      else errors.push("월간 recovery 미리보기 응답 형식이 올바르지 않습니다.");
    } else errors.push(previewResult.reason instanceof Error
      ? previewResult.reason.message : "월간 recovery 미리보기를 불러오지 못했습니다.");
    if (batchesResult.status === "fulfilled") {
      const value = batchesResult.value as { batches?: unknown } | null;
      if (value && Array.isArray(value.batches)) {
        const parsed = value.batches.map(readBatch);
        if (parsed.every((batch): batch is RecoveryBatch => batch !== null)) setBatches(parsed);
        else errors.push("월간 recovery batch 목록 응답 형식이 올바르지 않습니다.");
      } else errors.push("월간 recovery batch 목록 응답 형식이 올바르지 않습니다.");
    } else errors.push(batchesResult.reason instanceof Error
      ? batchesResult.reason.message : "월간 recovery batch 목록을 불러오지 못했습니다.");
    setLoadError(errors.join(" "));
  }, [reportMonth, poolId]);

  useEffect(() => {
    let alive = true;
    const active = () => alive;
    const initialLoad = window.setTimeout(() => { void load(active); }, 0);
    const timer = window.setInterval(() => { void load(active); }, 10_000);
    return () => { alive = false; window.clearTimeout(initialLoad); window.clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    setSelected(false);
    setPreview(null);
    setBatches(null);
    setLoadError("");
    setMutationError("");
    setReplayed(false);
  }, [reportMonth, poolId]);

  const activeBatch = batches?.find(batch =>
    !isTerminal(batch) && batch.pool_id === (poolId.trim() || null));
  const hasActiveBatch = Boolean(activeBatch);
  const createDisabledReason = busy ? "Recovery batch 생성 중입니다."
    : pending ? ""
    : loadError ? loadError
    : !preview || !batches ? "서버 eligibility 및 저장된 batch 상태를 확인하는 중입니다."
    : hasActiveBatch ? `현재 범위에 진행 중인 Recovery batch가 있습니다 (${activeBatch!.state}).${activeBatch!.pause_reason ? ` 서버 사유: ${activeBatch!.pause_reason}` : ""}`
    : preview.eligible_total <= 0 ? "서버가 허용한 미완료 recovery 대상이 없습니다."
    : !selected ? "미완료 전체 대상을 선택해 주세요."
    : !reason.trim() ? "승인 사유를 입력하면 전체 재시도를 실행할 수 있습니다."
    : "";
  const canCreate = createDisabledReason === "";

  async function createBatch() {
    if (busyRef.current || !canCreate || (!pending && !preview)) return;
    const approval: PendingApproval = pending ?? {
      body: {
        report_month: reportMonth,
        ...(poolId.trim() ? { pool_id: poolId.trim() } : {}),
        reason: reason.trim(),
        confirmed: true,
        approval_id: crypto.randomUUID(),
      },
      eligibleTotal: preview!.eligible_total,
      failedTotal: preview!.failed_total,
      unknownTotal: preview!.unknown_total,
      nextRound: preview!.next_round,
      hadPriorBatch: (batches?.length ?? 0) > 0,
    };
    const body = approval.body;
    const confirmed = window.confirm(
      `${body.report_month} 미완료 ${approval.eligibleTotal}건을 Recovery Round ${approval.nextRound}로 일괄 재시도 승인하시겠습니까?\n` +
      `${body.pool_id || "전체 수영장"} 범위의 eligible 대상 ${approval.eligibleTotal}건입니다.\n` +
      (approval.hadPriorBatch ? "기존 batch와 별개의 다음 회차를 명시적으로 승인합니다.\n" : "") +
      `실패 ${approval.failedTotal}건 / UNKNOWN ${approval.unknownTotal}건 포함 여부는 서버 eligibility 기준입니다.\n` +
      "대상 전체에 유료 분석 시도가 발생할 수 있으며 비용은 달라질 수 있습니다. 비용 가능성을 확인하고 승인하세요.\n" +
      `승인 사유: ${body.reason}`
    );
    if (!confirmed) return;
    busyRef.current = true;
    setBusy(true);
    setMutationError("");
    setPending(approval);
    try {
      const response = await api.post<{ batch?: unknown; replayed?: unknown }>(BASE, body);
      const batch = readBatch(response?.batch);
      if (!batch || typeof response?.replayed !== "boolean") {
        throw new Error("recovery batch 생성 응답 형식이 올바르지 않습니다. 동일 승인으로 다시 확인하세요.");
      }
      setPending(null);
      setSelected(false);
      setReplayed(response.replayed);
      await load(() => true);
      if (scopeRef.current === `${body.report_month}:${body.pool_id ?? ""}`) {
        setBatches(current => [batch, ...(current ?? []).filter(item => item.id !== batch.id)]);
      }
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "recovery batch 결과를 확인하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function resumeBatch(batch: RecoveryBatch) {
    if (busyRef.current || !reason.trim()) return;
    const confirmation = window.confirm(
      `${reportMonth} 월 recovery batch ${batch.id} (회차 ${batch.recovery_round})을 재개하시겠습니까?\n` +
      `일시중지 사유: ${batch.pause_reason ?? "—"}\n재개 사유: ${reason.trim()}`
    );
    if (!confirmation) return;
    busyRef.current = true;
    setBusy(true);
    setMutationError("");
    try {
      const response = await api.post<{ batch?: unknown }>(`${BASE}/${encodeURIComponent(batch.id)}/resume`, {
        reason: reason.trim(), confirmed: true,
      });
      const updated = readBatch(response?.batch);
      if (!updated) throw new Error("recovery batch 재개 응답 형식이 올바르지 않습니다.");
      await load(() => true);
      setBatches(current => (current ?? []).map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "recovery batch 재개 결과를 확인하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const latest = batches?.[0];
  const awaitingRetry = pending !== null;

  return <section className="space-y-3 rounded border border-blue-200 bg-blue-50/50 p-4" aria-label="월간 전체 recovery batch">
    <div>
      <h3 className="text-sm font-semibold text-[#002F5F]">월간 전체 recovery batch</h3>
      <p className="mt-1 text-xs text-gray-600">
        페이지 목록과 무관하게 서버가 계산한 전체 eligible cohort를 대상으로 합니다. 선택이나 화면 진입만으로 실행되지 않습니다.
        대상별 요청을 기다리지 않고 batch 진행 상태를 주기적으로 조회합니다.
      </p>
    </div>
    {loadError && loadError !== createDisabledReason && <p aria-live="polite" className="text-xs text-red-700">{loadError}</p>}
    {!preview && !loadError && <p className="text-xs text-gray-500">전체 cohort 미리보기를 불러오는 중...</p>}
    {preview && <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
      <div className="rounded border bg-white p-2">월 / 범위<strong className="mt-1 block">{preview.report_month} / {preview.pool_id ?? "전체 수영장"}</strong></div>
      <div className="rounded border bg-white p-2">Eligible 전체<strong className="mt-1 block">{preview.eligible_total.toLocaleString()}건</strong></div>
      <div className="rounded border bg-white p-2">실패 / UNKNOWN<strong className="mt-1 block">{preview.failed_total.toLocaleString()} / {preview.unknown_total.toLocaleString()}건</strong></div>
      <div className="rounded border bg-white p-2">다음 회차<strong className="mt-1 block">{preview.next_round}</strong></div>
    </div>}
    <label className="block space-y-1 text-xs font-medium text-[#002F5F]">
      <span>원인 수정 및 일괄 재시도 승인 사유</span>
      <input aria-label="원인 수정 및 일괄 재시도 승인 사유" maxLength={500} value={reason}
        onChange={event => onReasonChange(event.target.value)}
        placeholder="원인 수정 내용과 일괄 재시도 승인 사유를 직접 입력해 주세요 (필수)"
        className="block w-full rounded border bg-white p-2 font-normal text-gray-900" />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!preview || !preview.eligible_total || Boolean(loadError) || busy}
        onClick={() => setSelected(true)} className="rounded border bg-white px-3 py-2 text-xs disabled:opacity-40">
        미완료 전체 선택
      </button>
      <button type="button" disabled={!selected || busy} onClick={() => setSelected(false)}
        className="rounded border bg-white px-3 py-2 text-xs disabled:opacity-40">
        전체 선택 해제
      </button>
      <span aria-live="polite" className="self-center text-xs">서버 cohort 선택: {selected ? preview?.eligible_total.toLocaleString() ?? "—" : 0}건</span>
      <button type="button" disabled={!canCreate} aria-describedby={createDisabledReason ? "monthly-recovery-disabled-reason" : undefined}
        onClick={() => void createBatch()}
        className="rounded bg-[#002F5F] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {busy ? "승인 처리 중..." : awaitingRetry ? "동일 승인 재시도" : "전체 재시도 승인"}
      </button>
    </div>
    {createDisabledReason && <p id="monthly-recovery-disabled-reason" aria-live="polite"
      className={`text-xs ${loadError && createDisabledReason === loadError ? "text-red-700" : "text-blue-900"}`}>
      {createDisabledReason}
    </p>}
    {selected && <p className="text-xs text-blue-900">현재 선택은 미리보기의 전체 eligible cohort입니다. 실제 대상 수는 서버에서 승인 시 다시 판정합니다.</p>}
    {latest && batches?.length && !hasActiveBatch && <p className="text-xs text-blue-900">
      저장된 회차가 종료되었습니다. 다음 회차({preview?.next_round ?? "—"})는 전체 선택 후 별도 승인해야 시작됩니다.
    </p>}
    {replayed && <p role="status" className="text-xs text-blue-800">기존 승인 요청 결과를 재생했습니다.</p>}
    {mutationError && <p role="alert" className="text-xs text-red-700">{mutationError}</p>}
    {!batches && !loadError && <p className="text-xs text-gray-500">저장된 batch 상태를 불러오는 중...</p>}
    {batches && batches.length === 0 && <p className="text-xs text-gray-600">저장된 recovery batch가 없습니다.</p>}
    {batches && batches.length > 0 && <div className="space-y-2">
      <h4 className="text-xs font-semibold">저장된 batch 진행 상태</h4>
      {batches.map(batch => <article key={batch.id} className="rounded border bg-white p-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong>{batch.report_month} / {batch.pool_id ?? "전체 수영장"} / 회차 {batch.recovery_round}</strong>
          <span className="rounded bg-gray-100 px-2 py-0.5 font-semibold">{batch.state}</span>
          <span className="break-all text-gray-500">Batch {batch.id}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-gray-700 sm:grid-cols-4">
          <span>전체 {batch.total}</span><span>완료 {batch.completed}</span>
          <span>성공 {batch.success}</span><span>근거부족 {batch.insufficient_evidence}</span>
          <span>실패 {batch.failed}</span><span>UNKNOWN {batch.unknown}</span>
          <span>충돌 {batch.conflict}</span><span>잔여 {batch.remaining}</span>
        </div>
        {batch.state.toUpperCase() === "PAUSED" && <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-amber-800">PAUSED — 원인 확인 및 사유 입력 후 명시적으로 재개</span>
          {batch.pause_reason && <span>일시중지 사유: {batch.pause_reason}</span>}
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void resumeBatch(batch)}
            className="rounded border px-2 py-1 font-semibold disabled:opacity-40">이 batch 재개 승인</button>
        </div>}
      </article>)}
    </div>}
  </section>;
}