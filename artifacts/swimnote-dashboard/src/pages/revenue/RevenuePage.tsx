/**
 * RevenuePage — /admin/revenue
 * 정산 계산기 (GET /settlement/calculator) + 정산 현황 (GET /settlement/reports)
 *
 * pool_admin 모드: 선생님 전체 정산 현황 조회
 * settlement/calculator: 특정 선생님 + 월 기준 상세 계산
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface ReportRow {
  teacher_id: string;
  teacher_name: string;
  status: string;
  total_revenue?: number;
  submitted_at?: string;
  confirmed_at?: string;
}

interface CalcSummary {
  total_revenue: number;
  total_sessions: number;
  total_makeup_sessions: number;
  total_trial_sessions: number;
  total_temp_transfer_sessions: number;
  withdrawn_count: number;
  postpone_count: number;
}

interface CalcStudent {
  student_id?: string;
  student_name: string;
  class_type?: string;
  is_trial?: boolean;
  session_count?: number;
  revenue?: number;
}

function toYYYYMM(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const thisMonth = toYYYYMM(new Date());

export default function RevenuePage() {
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState<"reports" | "calculator">("reports");
  const [calcTeacherId, setCalcTeacherId] = useState("");

  // 선생님 전체 정산 현황
  const { data: reports, isLoading: reportsLoading, error: reportsErr } = useQuery({
    queryKey: ["settlement-reports", month],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; reports: ReportRow[] }>(`/settlement/reports?month=${month}`);
      return r.data.reports ?? [];
    },
    enabled: tab === "reports",
  });

  // 정산 계산기 (특정 선생님)
  const { data: calc, isLoading: calcLoading, refetch: refetchCalc } = useQuery({
    queryKey: ["settlement-calculator", month, calcTeacherId],
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (calcTeacherId) params.set("teacher_id", calcTeacherId);
      const r = await api.get<{ success: boolean; summary: CalcSummary; students: CalcStudent[]; month: string }>(`/settlement/calculator?${params}`);
      return r.data;
    },
    enabled: tab === "calculator" && !!month,
  });

  const tabStyle = (t: string) => ({
    padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500,
    background: tab === t ? "#111827" : "#f3f4f6", color: tab === t ? "#fff" : "#374151",
  });

  return (
    <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>매출 · 정산</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ fontSize: 13, color: "#6b7280" }}>월</label>
          <input type="month" value={month} onChange={(e: any) => setMonth(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button style={tabStyle("reports")} onClick={() => setTab("reports")}>정산 현황</button>
        <button style={tabStyle("calculator")} onClick={() => setTab("calculator")}>계산기</button>
      </div>

      {/* Reports tab */}
      {tab === "reports" && (
        <>
          {reportsLoading && <p style={{ color: "#6b7280" }}>불러오는 중…</p>}
          {reportsErr && <p style={{ color: "#dc2626" }}>정산 현황을 불러오지 못했습니다.</p>}
          {reports && (
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    {["선생님", "상태", "제출일", "확정일"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontWeight: 600, color: "#374151" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#6b7280" }}>정산 데이터가 없습니다.</td></tr>
                  )}
                  {reports.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "12px 16px", fontWeight: 500 }}>{r.teacher_name}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ padding: "2px 10px", borderRadius: 12, fontSize: 12, background: r.status === "confirmed" ? "#dcfce7" : "#fef3c7", color: r.status === "confirmed" ? "#16a34a" : "#92400e" }}>
                          {r.status === "confirmed" ? "확정" : r.status === "submitted" ? "제출됨" : r.status ?? "미제출"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", color: "#6b7280" }}>{r.submitted_at?.slice(0, 10) ?? "—"}</td>
                      <td style={{ padding: "12px 16px", color: "#6b7280" }}>{r.confirmed_at?.slice(0, 10) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Calculator tab */}
      {tab === "calculator" && (
        <>
          <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <input value={calcTeacherId} onInput={(e: any) => setCalcTeacherId(e.target.value)}
              placeholder="선생님 ID (비워두면 본인)" style={{ padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, width: 240 }} />
            <button onClick={() => refetchCalc()} style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14 }}>
              조회
            </button>
          </div>

          {calcLoading && <p style={{ color: "#6b7280" }}>계산 중…</p>}

          {calc && (
            <>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
                {[
                  ["총 매출", `${(calc.summary.total_revenue || 0).toLocaleString()}원`],
                  ["정규 수업", `${calc.summary.total_sessions}회`],
                  ["보강", `${calc.summary.total_makeup_sessions}회`],
                  ["체험", `${calc.summary.total_trial_sessions}회`],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px" }}>{label}</p>
                    <p style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Student breakdown */}
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                      {["학생", "수업 유형", "수업 횟수", "금액"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontWeight: 600, color: "#374151" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(calc.students ?? []).map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "10px 16px" }}>{s.student_name}{s.is_trial ? <span style={{ marginLeft: 6, fontSize: 11, color: "#6366f1" }}>체험</span> : null}</td>
                        <td style={{ padding: "10px 16px", color: "#6b7280" }}>{s.class_type ?? "—"}</td>
                        <td style={{ padding: "10px 16px" }}>{s.session_count ?? "—"}</td>
                        <td style={{ padding: "10px 16px" }}>{s.revenue != null ? `${s.revenue.toLocaleString()}원` : "—"}</td>
                      </tr>
                    ))}
                    {(calc.students ?? []).length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#6b7280" }}>이 달 수업 기록이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 10 }}>
                * 금액은 pool_class_pricing 단가 기준. 단가가 설정되지 않은 경우 — 로 표시됩니다.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
