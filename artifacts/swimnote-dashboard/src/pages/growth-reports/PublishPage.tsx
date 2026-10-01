import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportItem {
  report_id: string;
  student_id: string;
  student_name: string;
  product_status: string;
  analysis_status: string | null;
  readiness_status: string;
  report_period: string;
  admin_reviewed_at: string | null;
  created_at: string;
}

interface ReportListResponse {
  year: number;
  month: number;
  total: number;
  items: ReportItem[];
}

interface BulkSendResult {
  ok: boolean;
  requested_count: number;
  published_count: number;
  already_published_count: number;
  skipped_count: number;
  push_attempted_count?: number;
  push_failed_count?: number;
}

interface SingleSendResult {
  ok: boolean;
  already_published: boolean;
}

function isGuardValidSendable(report: ReportItem): boolean {
  return report.readiness_status === "ANALYSIS_READY" &&
    ["READY_TO_SEND", "APPROVED"].includes(report.product_status);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPeriod(p: string | null): string {
  if (!p) return "—";
  const m = p.match(/^(\d{4})-(\d{2})/);
  if (!m) return p;
  return `${m[1]}년 ${parseInt(m[2])}월`;
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s.includes("T") ? s : s + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  } catch { return "—"; }
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return (e as ApiError).message;
  return "오류가 발생했습니다.";
}

function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const now = new Date();
  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      <select value={year} onChange={(e) => onChange(parseInt(e.target.value), month)}
        style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}>
        {years.map((y) => <option key={y} value={y}>{y}년</option>)}
      </select>
      <select value={month} onChange={(e) => onChange(year, parseInt(e.target.value))}
        style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
      </select>
    </div>
  );
}

function ConfirmModal({
  count, single, onConfirm, onCancel, loading, error, result,
}: {
  count: number;
  single: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  error: string;
  result: BulkSendResult | null;
}) {
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        zIndex: 70, background: "#fff", borderRadius: "10px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.16)", padding: "28px",
        width: "min(400px, calc(100vw - 48px))",
      }}>
        {result ? (
          <>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "12px" }}>발송 완료</div>
            <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.8 }}>
              발행 성공: <strong>{result.published_count ?? 0}건</strong><br />
              이미 발행됨: {result.already_published_count ?? 0}건<br />
              건너뜀: {result.skipped_count ?? 0}건
            </div>
            <div style={{ marginTop: "20px", textAlign: "right" }}>
              <button onClick={onCancel} style={{ padding: "8px 20px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>확인</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>
              {single ? "개별 발송" : "일괄 발송"}
            </div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "20px", lineHeight: 1.6 }}>
              관리자 선택으로 성장리포트 <strong>{count}건</strong>을 발송합니다.<br />
              발송 후에는 학부모 앱에 즉시 공개됩니다.
            </div>
            {error && (
              <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626", marginBottom: "12px" }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={onCancel} disabled={loading} style={{ padding: "8px 16px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>취소</button>
              <button onClick={onConfirm} disabled={loading}
                style={{ padding: "8px 16px", background: loading ? "#93A8C4" : "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: loading ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600 }}>
                {loading ? "발송 중…" : "확인 후 발송"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── PublishPage ──────────────────────────────────────────────────────────────

// issueMonth: 화면에서 사용자가 선택하는 "발행월" (API에 그대로 전달)
// API 내부: report_period = issueMonth - 1 (실제 수업월)
export default function PublishPage() {
  const now = new Date();
  const issueYear  = now.getFullYear();
  const issueMonth = now.getMonth() + 1;

  const [year, setYear] = useState(issueYear);
  const [month, setMonth] = useState(issueMonth);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [sendSingle, setSendSingle] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishResult, setPublishResult] = useState<BulkSendResult | null>(null);

  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<ReportListResponse>({
    queryKey: ["growth-reports-list", year, month],
    queryFn: async () => {
      const limit = 200;
      const first = await api.get<ReportListResponse>(`/admin/growth-reports/monthly-list?year=${year}&month=${month}&limit=${limit}&offset=0`);
      if (!Array.isArray(first.items) || !Number.isFinite(first.total)) throw new Error("성장리포트 목록 응답 형식이 올바르지 않습니다.");
      if (first.items.some((item) => typeof item.readiness_status !== "string")) throw new Error("월간 리포트 readiness_status 응답이 누락되었습니다.");
      const items = [...first.items];
      for (let offset = limit; offset < first.total; offset += limit) {
        const page = await api.get<ReportListResponse>(`/admin/growth-reports/monthly-list?year=${year}&month=${month}&limit=${limit}&offset=${offset}`);
        if (!Array.isArray(page.items) || page.items.some((item) => typeof item.readiness_status !== "string")) throw new Error("월간 리포트 readiness_status 응답이 누락되었습니다.");
        items.push(...page.items);
      }
      if (items.length < first.total) throw new Error("성장리포트 목록 일부를 불러오지 못했습니다.");
      return { ...first, items };
    },
  });

  // 관리자 확인 후 발송 가능한 상태이며 자동 발행하지 않는다.
  const sendable = (data?.items ?? []).filter(isGuardValidSendable);

  const bulkSendMut = useMutation({
    mutationFn: async ({ ids, single }: { ids: string[]; single: boolean }) => {
      const validIds = new Set(sendable.map((report) => report.report_id));
      if (ids.length === 0 || ids.some((id) => !validIds.has(id))) {
        throw new Error("품질 검증과 관리자 검수를 통과한 리포트만 발송할 수 있습니다.");
      }
      if (single) {
        const sent = await api.post<SingleSendResult>(`/admin/growth-reports/${ids[0]}/send`, {});
        return {
          ok: sent.ok,
          requested_count: 1,
          published_count: sent.already_published ? 0 : 1,
          already_published_count: sent.already_published ? 1 : 0,
          skipped_count: 0,
        };
      }
      return api.post<BulkSendResult>("/admin/growth-reports/bulk-send", {
        year,
        month,
        report_ids: ids,
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["growth-reports-list"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setSelected(new Set());
      setPublishResult(result);
      setPublishError("");
    },
    onError: (e) => setPublishError(errMsg(e)),
  });

  const allSelected = sendable.length > 0 && selected.size === sendable.length;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sendable.map((r) => r.report_id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>성장리포트 발송 관리</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            {isLoading ? "…" : `발송 가능 ${sendable.length}건`}
            {selected.size > 0 && ` · ${selected.size}건 선택됨`}
            {" · "}
            <span style={{ color: "#94A3B8" }}>
              {year}년 {month}월 리포트 · {month === 1 ? year - 1 : year}년 {month === 1 ? 12 : month - 1}월 수업 기준
            </span>
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); setSelected(new Set()); }} />
          {selected.size > 0 && (
            <button
              onClick={() => { setPublishError(""); setPublishResult(null); setSendSingle(false); setShowConfirm(true); }}
              style={{ padding: "7px 14px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
            >
              선택 리포트 발송 ({selected.size}건)
            </button>
          )}
        </div>
      </div>

      {isError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>성장리포트를 불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : sendable.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>발송 가능한 리포트가 없습니다.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={{ padding: "10px 14px", borderBottom: "1px solid #E2E8F0", width: "36px" }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: "pointer" }} />
                </th>
                {["회원명", "대상 기간", "관리자 확인", "품질 판정", "관리"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sendable.map((r, i) => {
                const isSelected = selected.has(r.report_id);
                return (
                  <tr
                    key={r.report_id}
                    onClick={() => toggleOne(r.report_id)}
                    style={{ background: isSelected ? "#EEF4FB" : i % 2 === 0 ? "#fff" : "#FAFAFA", cursor: "pointer" }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F0F7FF"; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "#fff" : "#FAFAFA"; }}
                  >
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(r.report_id)} onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>{r.student_name}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{formatPeriod(r.report_period)}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>{formatDate(r.admin_reviewed_at)}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: "#DCFCE7", color: "#166534" }}>
                        {r.readiness_status} · {r.product_status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(new Set([r.report_id]));
                          setSendSingle(true);
                          setPublishError("");
                          setPublishResult(null);
                          setShowConfirm(true);
                        }}
                        style={{ padding: "5px 10px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}
                      >
                        개별 발송
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showConfirm && (
        <ConfirmModal
          count={sendSingle ? 1 : selected.size}
          single={sendSingle}
          onConfirm={() => bulkSendMut.mutate({ ids: Array.from(selected), single: sendSingle })}
          onCancel={() => { setShowConfirm(false); setPublishResult(null); setPublishError(""); }}
          loading={bulkSendMut.isPending}
          error={publishError}
          result={publishResult}
        />
      )}
    </div>
  );
}
