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
  published_at: string | null;
  created_at: string;
}

interface ReportListResponse {
  year: number;
  month: number;
  total: number;
  items: ReportItem[];
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

// ─── PublishedPage ────────────────────────────────────────────────────────────

export default function PublishedPage() {
  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [year, setYear] = useState(prevYear);
  const [month, setMonth] = useState(prevMonth);
  const [search, setSearch] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<ReportItem | null>(null);
  const [resendError, setResendError] = useState("");

  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<ReportListResponse>({
    queryKey: ["growth-reports-list", year, month],
    queryFn: () => api.get(`/admin/growth-reports/monthly-list?year=${year}&month=${month}&limit=200`),
  });

  const published = (data?.items ?? []).filter(
    (r) => r.product_status === "PUBLISHED" || r.product_status === "READY_TO_SEND"
  );

  const filtered = published.filter((r) => {
    if (!search) return true;
    return r.student_name?.toLowerCase().includes(search.toLowerCase());
  });

  // Re-send (re-publish) single report
  const resendMut = useMutation({
    mutationFn: (id: string) => api.post(`/admin/growth-reports/${id}/send`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["growth-reports-list"] });
      setConfirmTarget(null);
      setResendError("");
    },
    onError: (e) => setResendError(errMsg(e)),
  });

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>발행 완료</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            {isLoading ? "…" : `${filtered.length}건`}
          </p>
        </div>
        <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} />
      </div>

      <div style={{ marginBottom: "16px" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="회원명 검색…"
          style={{ padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", width: "200px" }}
        />
      </div>

      {/* PDF 안내 */}
      <div style={{ padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: "6px", fontSize: "12px", color: "#92400E", marginBottom: "16px" }}>
        ⚠️ PDF 다운로드 엔드포인트가 서버에 없습니다. 학부모는 앱에서 PDF 저장 가능합니다.
      </div>

      {isError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>성장리포트를 불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>
          {search ? "검색 결과가 없습니다." : "발행된 성장리포트가 없습니다."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["회원명", "대상 기간", "발행일", "상태", "관리"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                  <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>{r.student_name}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{formatPeriod(r.report_period)}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>{formatDate(r.published_at)}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: "#E0F2FE", color: "#075985" }}>
                      발행됨
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        title="PDF 다운로드 미지원"
                        disabled
                        style={{ padding: "4px 10px", background: "#F1F5F9", border: "none", borderRadius: "4px", cursor: "not-allowed", fontSize: "11px", color: "#94A3B8" }}
                      >
                        PDF
                      </button>
                      <button
                        onClick={() => { setConfirmTarget(r); setResendError(""); }}
                        style={{ padding: "4px 10px", background: "#F1F5F9", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#475569" }}
                      >
                        재발행
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resend confirm */}
      {confirmTarget && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 70, background: "#fff", borderRadius: "10px",
            boxShadow: "0 8px 40px rgba(0,0,0,0.16)", padding: "28px",
            width: "min(380px, calc(100vw - 48px))",
          }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>재발행</div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "20px", lineHeight: 1.6 }}>
              {confirmTarget.student_name} 회원의 {formatPeriod(confirmTarget.report_period)} 성장리포트를 다시 발행합니다.
            </div>
            {resendError && (
              <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626", marginBottom: "12px" }}>
                {resendError}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmTarget(null)} disabled={resendMut.isPending}
                style={{ padding: "8px 16px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
                취소
              </button>
              <button
                onClick={() => resendMut.mutate(confirmTarget.id)}
                disabled={resendMut.isPending}
                style={{ padding: "8px 16px", background: resendMut.isPending ? "#93A8C4" : "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: resendMut.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600 }}
              >
                {resendMut.isPending ? "처리 중…" : "재발행"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
