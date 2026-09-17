/**
 * RevenuePage — /admin/revenue (Dashboard V2)
 *
 * PC 정산 현황: Table 중심 운영/확인 화면
 *   - 월 선택 + Pool Summary KPI
 *   - 선생님 Table (reflected_amount / status / has_changed)
 *   - Teacher Row 클릭 → 우측 Detail Drawer
 *   - Drawer: 선생님 Summary + 학생 Table + 확인 버튼
 *
 * 계산 없음 — 서버 반환값 표시만.
 * API: GET /settlement/admin-overview, GET /settlement/admin-teacher-detail, POST /settlement/finalize
 */
import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

/* ─── 타입 ──────────────────────────────────────────────────────────── */
interface TeacherRow {
  teacher_id: string;
  teacher_name: string;
  status: "draft" | "submitted" | "confirmed" | null;
  status_label: string;
  has_changed: boolean;
  student_count: number;
  regular_slot_count: number;
  makeup_count: number;
  auto_amount: number;
  adjustment_total: number;
  reflected_amount: number;
  updated_at: string | null;
}
interface PoolSummary {
  student_count: number;
  priced_student_count: number;
  unpriced_student_count: number;
  pool_auto_total: number;
  pool_adjustment_total: number;
  pool_reflected_total: number;
}
interface Overview {
  month: string;
  pool_id: string;
  teachers: TeacherRow[];
  pool_summary: PoolSummary;
  unpriced_students: any[];
}
interface StudentDetail {
  student_id: string;
  student_name: string;
  weekly_count: number;
  pricing_status: string;
  monthly_fee: number | null;
  regular_slot_count: number;
  total_regular_slots: number;
  allocation_ratio: number;
  allocated_auto_amount: number;
  adjustment_amount: number;
  final_amount: number;
  student_auto_amount?: number;
  sessions_per_month?: number;
  billable_count?: number;
}
interface TeacherDetail {
  teacher_id: string;
  status: string | null;
  auto_amount: number;
  students: StudentDetail[];
}

/* ─── 헬퍼 ──────────────────────────────────────────────────────────── */
function toYYYYMM(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const thisMonth = toYYYYMM(new Date());

function fmtKRW(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ko-KR") + "원";
}
function fmtKRWSigned(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (n > 0) return "+" + n.toLocaleString("ko-KR") + "원";
  return n.toLocaleString("ko-KR") + "원";
}
function weekLabel(n: number) {
  return `주${n}회`;
}

/* ─── 상태 스타일 ────────────────────────────────────────────────────── */
function statusStyle(label: string, hasChanged: boolean) {
  const display = hasChanged && label === "저장됨" ? "저장 후 변경" : label;
  let color = "#6B7280", bg = "#F3F4F6";
  if (display === "저장 후 변경") { color = "#92400E"; bg = "#FEF3C7"; }
  else if (label === "관리자 확인") { color = "#14532D"; bg = "#DCFCE7"; }
  else if (label === "저장됨") { color = "#1D4ED8"; bg = "#DBEAFE"; }
  return { display, color, bg };
}

/* ═══════════════════════════════════════════════════════════════════════
   메인 화면
═══════════════════════════════════════════════════════════════════════ */
export default function RevenuePage() {
  const [month, setMonth] = useState(thisMonth);
  const [selectedTeacher, setSelectedTeacher] = useState<TeacherRow | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const qc = useQueryClient();

  // Pool Overview
  const {
    data: overview,
    isLoading: ovLoading,
    error: ovErr,
  } = useQuery<Overview>({
    queryKey: ["settlement-admin-overview", month],
    queryFn: () => api.get<Overview>(`/settlement/admin-overview?month=${month}`),
  });

  // Teacher Detail
  const {
    data: detail,
    isLoading: detailLoading,
  } = useQuery<TeacherDetail>({
    queryKey: ["settlement-admin-teacher-detail", month, selectedTeacher?.teacher_id],
    queryFn: () => api.get<TeacherDetail>(
      `/settlement/admin-teacher-detail?teacher_id=${selectedTeacher!.teacher_id}&month=${month}`
    ),
    enabled: !!selectedTeacher,
  });

  const handleConfirm = useCallback(async () => {
    if (!selectedTeacher || !overview) return;
    if (!window.confirm(`${selectedTeacher.teacher_name} 선생님 정산(${fmtKRW(selectedTeacher.reflected_amount)})을 확인하시겠습니까?`)) return;
    setConfirmLoading(true);
    setConfirmMsg(null);
    try {
      const d = await api.post<{ success: boolean; message?: string }>("/settlement/finalize", {
        pool_id: overview.pool_id,
        month,
        teacher_id: selectedTeacher.teacher_id,
      });
      if (d.success) {
        setConfirmMsg("✓ 정산 확인 완료");
        setSelectedTeacher(null);
        qc.invalidateQueries({ queryKey: ["settlement-admin-overview", month] });
      } else {
        setConfirmMsg("⚠ " + (d.message ?? "확인 실패"));
      }
    } catch (e: any) {
      setConfirmMsg("⚠ " + (e?.message ?? "오류가 발생했습니다."));
    } finally {
      setConfirmLoading(false);
    }
  }, [selectedTeacher, overview, month, qc]);

  const ps = overview?.pool_summary;
  const unpricedCount = ps?.unpriced_student_count ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "inherit" }}>

      {/* ── 상단 헤더 ── */}
      <div style={{ padding: "20px 24px 0", borderBottom: "1px solid var(--border-default, #E5E7EB)", background: "#fff", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px", color: "var(--text-strong, #111827)" }}>
              매출 · 정산
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted, #6B7280)", margin: 0 }}>
              선생님별 반영 매출을 확인하고 정산을 승인합니다.
            </p>
          </div>
          <input
            type="month"
            value={month}
            onChange={e => { setMonth(e.target.value); setSelectedTeacher(null); }}
            style={{ padding: "7px 12px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 14, color: "#111827" }}
          />
        </div>

        {/* Summary KPI */}
        {ovLoading ? (
          <div style={{ padding: "12px 0", color: "#9CA3AF", fontSize: 13 }}>로딩 중…</div>
        ) : ovErr ? (
          <div style={{ padding: "12px 0", color: "#DC2626", fontSize: 13 }}>데이터를 불러오지 못했습니다.</div>
        ) : ps ? (
          <div style={{ display: "flex", gap: 20, paddingBottom: 16, flexWrap: "wrap" }}>
            <KpiCard label="자동 기준 매출" value={fmtKRW(ps.pool_auto_total)} />
            <KpiCard label="조정 금액" value={fmtKRWSigned(ps.pool_adjustment_total)} dimmed />
            <KpiCard label="반영 매출" value={fmtKRW(ps.pool_reflected_total)} highlight />
            <div style={{ width: 1, background: "#E5E7EB", margin: "0 4px" }} />
            <KpiCard label="전체 회원" value={`${ps.student_count}명`} />
            {unpricedCount > 0 && (
              <KpiCard label="수업료 설정 필요" value={`${unpricedCount}명`} warn />
            )}
          </div>
        ) : null}
      </div>

      {/* ── Body: Table + Drawer ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Teacher Table ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0" }}>
          {!overview?.teachers?.length && !ovLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF", fontSize: 14 }}>
              이 달 선생님 정산 데이터가 없습니다.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#F9FAFB" }}>
                <tr>
                  {[
                    "선생님", "담당 회원", "정규 수업", "완료 보강",
                    "자동 기준 매출", "조정 금액", "반영 매출", "상태", "변경",
                  ].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(overview?.teachers ?? []).map(t => {
                  const { display, color, bg } = statusStyle(t.status_label, t.has_changed);
                  const isSelected = selectedTeacher?.teacher_id === t.teacher_id;
                  return (
                    <tr
                      key={t.teacher_id}
                      onClick={() => setSelectedTeacher(t)}
                      style={{
                        borderBottom: "1px solid #F3F4F6",
                        cursor: "pointer",
                        background: isSelected ? "#EFF6FF" : "transparent",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <td style={tdStyle}><span style={{ fontWeight: 600 }}>{t.teacher_name || "—"}</span></td>
                      <td style={tdStyle}>{t.student_count}명</td>
                      <td style={tdStyle}>{t.regular_slot_count}회</td>
                      <td style={tdStyle}>{t.makeup_count}회</td>
                      <td style={tdStyle}>{fmtKRW(t.auto_amount)}</td>
                      <td style={{ ...tdStyle, color: t.adjustment_total < 0 ? "#DC2626" : undefined }}>
                        {fmtKRWSigned(t.adjustment_total)}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{fmtKRW(t.reflected_amount)}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, color, background: bg }}>
                          {display}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {t.has_changed
                          ? <span style={{ fontSize: 11, color: "#92400E", fontWeight: 600 }}>저장 후 변경</span>
                          : <span style={{ color: "#9CA3AF" }}>—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Teacher Detail Drawer ── */}
        {selectedTeacher && (
          <div style={{
            width: 420, flexShrink: 0, borderLeft: "1px solid #E5E7EB",
            display: "flex", flexDirection: "column", overflowY: "auto",
            background: "#fff",
          }}>
            {/* Drawer 헤더 */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>
                  {selectedTeacher.teacher_name || "선생님"}
                </div>
                <div style={{ marginTop: 4 }}>
                  {(() => {
                    const { display, color, bg } = statusStyle(selectedTeacher.status_label, selectedTeacher.has_changed);
                    return (
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, color, background: bg }}>
                        {display}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <button
                onClick={() => { setSelectedTeacher(null); setConfirmMsg(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#6B7280", padding: 4 }}
              >✕</button>
            </div>

            {/* Drawer body */}
            <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>

              {/* 선생님 Summary */}
              <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                <SummaryLine label="담당 회원" value={`${selectedTeacher.student_count}명`} />
                <SummaryLine label="정규 수업" value={`${selectedTeacher.regular_slot_count}회`} />
                <SummaryLine label="완료 보강" value={`${selectedTeacher.makeup_count}회`} />
                <div style={{ borderTop: "1px solid #E5E7EB", margin: "8px 0" }} />
                <SummaryLine label="자동 기준 매출" value={fmtKRW(selectedTeacher.auto_amount)} />
                <SummaryLine label="조정 금액" value={fmtKRWSigned(selectedTeacher.adjustment_total)} />
                <SummaryLine label="반영 매출" value={fmtKRW(selectedTeacher.reflected_amount)} bold />
              </div>

              {/* has_changed 경고 */}
              {selectedTeacher.has_changed && selectedTeacher.status === "submitted" && (
                <div style={{
                  display: "flex", gap: 8, alignItems: "flex-start",
                  background: "#FEF3C7", borderRadius: 8, padding: "10px 12px", marginBottom: 12,
                  fontSize: 13, color: "#78350F", lineHeight: "1.5",
                }}>
                  ⚠ 저장 후 회원/시간표 정보가 변경되었습니다.<br />
                  선생님이 정산을 다시 저장해야 합니다.
                </div>
              )}

              {/* 확인 버튼 영역 */}
              {selectedTeacher.status === "confirmed" ? (
                <div style={{ background: "#DCFCE7", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#14532D", fontWeight: 600, fontSize: 14 }}>
                  ✓ 관리자 확인 완료
                </div>
              ) : selectedTeacher.status === "submitted" && !selectedTeacher.has_changed ? (
                <button
                  onClick={handleConfirm}
                  disabled={confirmLoading}
                  style={{
                    width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
                    background: "#0F2D50", color: "#fff", fontWeight: 700, fontSize: 14,
                    cursor: confirmLoading ? "default" : "pointer", opacity: confirmLoading ? 0.7 : 1,
                    marginBottom: 12,
                  }}
                >
                  {confirmLoading ? "처리 중…" : "정산 확인"}
                </button>
              ) : selectedTeacher.status === null ? (
                <div style={{ background: "#F3F4F6", borderRadius: 8, padding: "10px 14px", marginBottom: 12, color: "#6B7280", fontSize: 13, textAlign: "center" }}>
                  선생님이 아직 정산을 저장하지 않았습니다.
                </div>
              ) : null}

              {confirmMsg && (
                <div style={{
                  padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13,
                  background: confirmMsg.startsWith("✓") ? "#DCFCE7" : "#FEF2F2",
                  color: confirmMsg.startsWith("✓") ? "#14532D" : "#991B1B",
                }}>
                  {confirmMsg}
                </div>
              )}

              {/* 학생 Table */}
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 8 }}>학생별 정산</div>
              {detailLoading ? (
                <div style={{ textAlign: "center", color: "#9CA3AF", padding: 20 }}>로딩 중…</div>
              ) : !detail?.students?.length ? (
                <div style={{ textAlign: "center", color: "#9CA3AF", padding: 20, fontSize: 13 }}>학생 정산 정보가 없습니다.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {detail.students.map((st, i) => (
                    <StudentCard key={st.student_id ?? i} st={st} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── KPI Card ──────────────────────────────────────────────────────── */
function KpiCard({ label, value, highlight, dimmed, warn }: {
  label: string; value: string; highlight?: boolean; dimmed?: boolean; warn?: boolean;
}) {
  return (
    <div style={{
      background: highlight ? "#0F2D50" : warn ? "#FEF3C7" : "#F9FAFB",
      border: `1px solid ${highlight ? "#0F2D50" : warn ? "#FCD34D" : "#E5E7EB"}`,
      borderRadius: 8, padding: "10px 16px",
    }}>
      <div style={{ fontSize: 11, color: highlight ? "#93C5FD" : warn ? "#92400E" : "#6B7280", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: highlight ? "#fff" : warn ? "#92400E" : dimmed ? "#374151" : "#111827" }}>
        {value}
      </div>
    </div>
  );
}

/* ─── Summary Line ──────────────────────────────────────────────────── */
function SummaryLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}>
      <span style={{ color: "#6B7280" }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: "#111827" }}>{value}</span>
    </div>
  );
}

/* ─── Student Card (Drawer) ─────────────────────────────────────────── */
function StudentCard({ st }: { st: StudentDetail }) {
  const [expanded, setExpanded] = useState(false);
  const isUnpriced = st.pricing_status === "unpriced";

  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: "flex", width: "100%", padding: "10px 12px", gap: 8,
          alignItems: "center", background: "none", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{st.student_name}</span>
          <span style={{ fontSize: 12, color: "#6B7280", marginLeft: 6 }}>{weekLabel(st.weekly_count)}</span>
        </div>
        {isUnpriced ? (
          <span style={{ fontSize: 12, color: "#92400E", fontWeight: 600 }}>수업료 설정 필요</span>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{fmtKRW(st.final_amount)}</span>
        )}
        <span style={{ fontSize: 12, color: "#9CA3AF" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && !isUnpriced && (
        <div style={{ borderTop: "1px solid #E5E7EB", padding: "8px 12px", background: "#F9FAFB" }}>
          {[
            ["정상 월수업료", fmtKRW(st.monthly_fee)],
            ["기준 횟수", `${st.sessions_per_month ?? "—"}회`],
            ["전체 정규수업", `${st.total_regular_slots}회`],
            ["담당 정규수업", `${st.regular_slot_count}회`],
            ["배분비율", st.allocation_ratio !== undefined ? `${Math.round(st.allocation_ratio * 100)}%` : "—"],
            ["학생 전체 기준매출", fmtKRW(st.student_auto_amount)],
            ["선생님 기준매출", fmtKRW(st.allocated_auto_amount)],
            ["조정 금액", fmtKRWSigned(st.adjustment_amount)],
            ["반영 매출", fmtKRW(st.final_amount)],
          ].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 12 }}>
              <span style={{ color: "#6B7280" }}>{l}</span>
              <span style={{ fontWeight: l === "반영 매출" ? 700 : 500, color: "#111827" }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Table styles ──────────────────────────────────────────────────── */
const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 12,
  color: "#6B7280",
  borderBottom: "1px solid #E5E7EB",
  whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "11px 14px",
  color: "#374151",
  whiteSpace: "nowrap",
};
