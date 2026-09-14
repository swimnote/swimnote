/**
 * RevenuePage — /admin/revenue
 * 정산 계산기 (GET /settlement/calculator) + 정산 현황 (GET /settlement/reports)
 *
 * 정산 현황: 전체 수영장 선생님 제출 현황 (기본)
 * 정산 계산기: 선생님 드롭다운 선택 → 해당 선생님 상세 계산
 *
 * 참고:
 *  - /settlement/calculator는 선생님 개인 단위 정산값 (수영장 전체 재무지표 아님)
 *  - 수영장 전체 재무지표 API 미존재 → "정산 현황"으로 명칭 제한, 가짜 합산 없음
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

interface Teacher {
  id: string;
  name: string;
  email?: string;
  is_activated?: boolean;
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
  regular_sessions?: number;
  makeup_sessions?: number;
  settlement_amount?: number;
}

function toYYYYMM(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const thisMonth = toYYYYMM(new Date());

function fmtKRW(n?: number) {
  if (n === undefined || n === null) return "—";
  return `${n.toLocaleString("ko-KR")}원`;
}

export default function RevenuePage() {
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState<"reports" | "calculator">("reports");
  const [calcTeacherId, setCalcTeacherId] = useState("");

  // Pool 선생님 목록 (드롭다운용)
  const { data: teachers } = useQuery({
    queryKey: ["pool-teachers"],
    queryFn: async () => {
      const r = await api.get<Teacher[]>("/admin/pool-teachers");
      return r;
    },
  });

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
  const { data: calc, isLoading: calcLoading } = useQuery({
    queryKey: ["settlement-calculator", month, calcTeacherId],
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (calcTeacherId) params.set("teacher_id", calcTeacherId);
      const r = await api.get<{ success: boolean; summary: CalcSummary; students: CalcStudent[]; month: string }>(`/settlement/calculator?${params}`);
      return r.data;
    },
    enabled: tab === "calculator" && !!calcTeacherId,
  });

  const tabStyle = (t: string) => ({
    padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500,
    background: tab === t ? "#111827" : "#f3f4f6", color: tab === t ? "#fff" : "#374151",
  });

  const kpiCard = (label: string, value: string | number) => (
    <div key={label} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "16px 20px", flex: 1, minWidth: 150 }}>
      <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 6px" }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 600, color: "#111827", margin: 0 }}>{value}</p>
    </div>
  );

  return (
    <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 4px" }}>정산 현황</h2>
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
            선생님별 정산 데이터 조회 · 전체 수영장 재무지표는 별도 지원 예정
          </p>
        </div>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14 }} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <button style={tabStyle("reports")} onClick={() => setTab("reports")}>정산 현황</button>
        <button style={tabStyle("calculator")} onClick={() => setTab("calculator")}>계산기</button>
      </div>

      {/* Reports Tab */}
      {tab === "reports" && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>선생님 전체 제출 현황 — {month}</span>
          </div>
          {reportsLoading ? (
            <p style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>로딩 중…</p>
          ) : reportsErr ? (
            <p style={{ padding: 24, color: "#dc2626", fontSize: 14 }}>데이터를 불러오지 못했습니다.</p>
          ) : !reports?.length ? (
            <p style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>이 달 정산 데이터가 없습니다.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["선생님", "상태", "매출(정산액)", "제출일", "확정일"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "10px 14px" }}>{r.teacher_name}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 500,
                        background: r.status === "confirmed" ? "#dcfce7" : r.status === "submitted" ? "#dbeafe" : "#f3f4f6",
                        color: r.status === "confirmed" ? "#16a34a" : r.status === "submitted" ? "#1d4ed8" : "#6b7280",
                      }}>{r.status}</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>{fmtKRW(r.total_revenue)}</td>
                    <td style={{ padding: "10px 14px", color: "#6b7280" }}>{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("ko-KR") : "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#6b7280" }}>{r.confirmed_at ? new Date(r.confirmed_at).toLocaleDateString("ko-KR") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Calculator Tab */}
      {tab === "calculator" && (
        <div>
          {/* Teacher dropdown */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "16px 20px", marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", marginRight: 12 }}>선생님 선택</label>
            <select
              value={calcTeacherId}
              onChange={e => setCalcTeacherId(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, minWidth: 200 }}
            >
              <option value="">— 선생님을 선택하세요 —</option>
              {(teachers ?? []).map((t: Teacher) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {!calcTeacherId && (
            <p style={{ color: "#9ca3af", fontSize: 14, textAlign: "center", padding: 40 }}>선생님을 선택하면 해당 월 정산 상세를 확인할 수 있습니다.</p>
          )}

          {calcTeacherId && calcLoading && (
            <p style={{ color: "#9ca3af", fontSize: 14, padding: 20 }}>계산 중…</p>
          )}

          {calcTeacherId && calc && (
            <>
              {/* KPI 카드 */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                {kpiCard("정산 총액", fmtKRW(calc.summary?.total_revenue))}
                {kpiCard("수업 횟수", `${calc.summary?.total_sessions ?? 0}회`)}
                {kpiCard("보강 횟수", `${calc.summary?.total_makeup_sessions ?? 0}회`)}
                {kpiCard("체험 횟수", `${calc.summary?.total_trial_sessions ?? 0}회`)}
              </div>

              {/* 학생별 정산 */}
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>학생별 정산 내역</span>
                </div>
                {!calc.students?.length ? (
                  <p style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>이 달 수업 기록이 없습니다.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        {["학생명", "수업 유형", "정규", "보강", "정산액"].map(h => (
                          <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {calc.students.map((s, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                          <td style={{ padding: "10px 14px" }}>{s.student_name}</td>
                          <td style={{ padding: "10px 14px", color: "#6b7280" }}>{s.class_type ?? "—"}</td>
                          <td style={{ padding: "10px 14px" }}>{s.regular_sessions ?? 0}회</td>
                          <td style={{ padding: "10px 14px" }}>{s.makeup_sessions ?? 0}회</td>
                          <td style={{ padding: "10px 14px", fontWeight: 600 }}>{fmtKRW(s.settlement_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
