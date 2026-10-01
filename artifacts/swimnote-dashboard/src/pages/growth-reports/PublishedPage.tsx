import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportItem {
  report_id: string;
  student_id: string;
  student_name: string;
  product_status: string;
  analysis_status: string | null;
  readiness_status: string;
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

// issueMonth: 화면에서 사용자가 선택하는 "발행월" (API에 그대로 전달)
// API 내부: report_period = issueMonth - 1 (실제 수업월)
export default function PublishedPage() {
  const now = new Date();
  const issueYear  = now.getFullYear();
  const issueMonth = now.getMonth() + 1;

  const [year, setYear] = useState(issueYear);
  const [month, setMonth] = useState(issueMonth);
  const [search, setSearch] = useState("");

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

  // READY_TO_SEND is pre-delivery (awaiting send) → belongs in PublishPage, not here
  const published = (data?.items ?? []).filter(
    (r) => r.product_status === "PUBLISHED"
  );

  const filtered = published.filter((r) => {
    if (!search) return true;
    return r.student_name?.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>발행 완료</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            {isLoading ? "…" : `${filtered.length}건`}
            {" · "}
            <span style={{ color: "#94A3B8" }}>
              {year}년 {month}월 리포트 · {month === 1 ? year - 1 : year}년 {month === 1 ? 12 : month - 1}월 수업 기준
            </span>
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
                {["회원명", "대상 기간", "발행일", "상태", "안내"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.report_id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                  <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>{r.student_name}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{formatPeriod(r.report_period)}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>{formatDate(r.published_at)}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: "#E0F2FE", color: "#075985" }}>
                      발행됨
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: "11px", color: "#166534", borderBottom: "1px solid #F1F5F9" }}>
                    학부모 공개 완료 · 재발송 없음
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
