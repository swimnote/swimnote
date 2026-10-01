import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportItem {
  id: string;
  student_name: string;
  product_status: string;
  report_period: string;
  teacher_reviewed_at: string | null;
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
  requested?: number;
  published?: number;
  already?: number;
  skipped?: number;
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
  count, onConfirm, onCancel, loading, error, result,
}: {
  count: number;
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
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "12px" }}>발행 완료</div>
            <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.8 }}>
              발행 성공: <strong>{result.published ?? 0}건</strong><br />
              이미 발행됨: {result.already ?? 0}건<br />
              건너뜀: {result.skipped ?? 0}건
            </div>
            <div style={{ marginTop: "20px", textAlign: "right" }}>
              <button onClick={onCancel} style={{ padding: "8px 20px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>확인</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>일괄 발행</div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "20px", lineHeight: 1.6 }}>
              승인된 성장리포트 <strong>{count}건</strong>을 발행합니다.<br />
              발행 후에는 학부모 앱에 즉시 공개됩니다.
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
                {loading ? "발행 중…" : "발행"}
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
  const [publishError, setPublishError] = useState("");
  const [publishResult, setPublishResult] = useState<BulkSendResult | null>(null);

  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<ReportListResponse>({
    queryKey: ["growth-reports-list", year, month],
    queryFn: () => api.get(`/admin/growth-reports/monthly-list?year=${year}&month=${month}&limit=200`),
  });

  // APPROVED + READY_TO_SEND are both sendable
  // READY_TO_SEND = pre-delivery state (awaiting send), not yet published to user
  const approved = (data?.items ?? []).filter(
    (r) => r.product_status === "APPROVED" || r.product_status === "READY_TO_SEND"
  );

  const bulkSendMut = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<BulkSendResult>("/admin/growth-reports/bulk-send", { report_ids: ids }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["growth-reports-list"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setSelected(new Set());
      setPublishResult(result);
      setPublishError("");
    },
    onError: (e) => setPublishError(errMsg(e)),
  });

  const allSelected = approved.length > 0 && selected.size === approved.length;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(approved.map((r) => r.id)));
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
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>발행 관리</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            {isLoading ? "…" : `승인됨 ${approved.length}건`}
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
              onClick={() => { setPublishError(""); setPublishResult(null); setShowConfirm(true); }}
              style={{ padding: "7px 14px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
            >
              선택 리포트 발행 ({selected.size}건)
            </button>
          )}
        </div>
      </div>

      {isError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>성장리포트를 불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : approved.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>발행할 승인 리포트가 없습니다.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={{ padding: "10px 14px", borderBottom: "1px solid #E2E8F0", width: "36px" }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: "pointer" }} />
                </th>
                {["회원명", "대상 기간", "승인일", "상태"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {approved.map((r, i) => {
                const isSelected = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    onClick={() => toggleOne(r.id)}
                    style={{ background: isSelected ? "#EEF4FB" : i % 2 === 0 ? "#fff" : "#FAFAFA", cursor: "pointer" }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F0F7FF"; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "#fff" : "#FAFAFA"; }}
                  >
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(r.id)} onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>{r.student_name}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{formatPeriod(r.report_period)}</td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>{formatDate(r.teacher_reviewed_at)}</td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: "#DCFCE7", color: "#166534" }}>승인</span>
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
          count={selected.size}
          onConfirm={() => bulkSendMut.mutate(Array.from(selected))}
          onCancel={() => { setShowConfirm(false); setPublishResult(null); setPublishError(""); }}
          loading={bulkSendMut.isPending}
          error={publishError}
          result={publishResult}
        />
      )}
    </div>
  );
}
