import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportItem {
  id: string;
  student_id: string;
  student_name: string;
  product_status: string;
  report_period: string; // "2026-08" format
  published_at: string | null;
  teacher_reviewed_at: string | null;
  teacher_review_action: string | null;
  admin_reviewed_at: string | null;
  created_at: string;
  class_name?: string;
  teacher_name?: string;
}

interface ReportListResponse {
  year: number;
  month: number;
  total: number;
  items: ReportItem[];
}

interface ReportDetail {
  report_id: string;
  product_status: string;
  analysis_status: string;
  report_period: string;
  version_number: number;
  created_at: string;
  teacher_reviewed_at: string | null;
  teacher_review_action: string | null;
  teacher_review_reason_code: string | null;
  teacher_review_note: string | null;
  admin_reviewed_at: string | null;
  report_period_open: string | null;
  report_period_close: string | null;
  student: { id: string; name: string; class_name?: string; teacher_name?: string };
  report_content: Record<string, unknown> | null;
  sns_summary?: string | null;
  selected_metrics?: unknown[];
  positive_growth_signals?: string[];
  success_conditions?: string[];
  support_levers?: string[];
  next_growth_targets?: string[];
  next_observation_targets?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  REVIEW_REQUIRED: "검수 대기",
  ANALYZING: "분석 중",
  APPROVED: "승인",
  PUBLISHED: "발행됨",
  DISCARDED: "반려",
  FAILED: "실패",
  REGENERATING: "재생성 중",
};
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  REVIEW_REQUIRED: { bg: "#FEF9C3", text: "#92400E" },
  ANALYZING: { bg: "#DBEAFE", text: "#1E40AF" },
  APPROVED: { bg: "#DCFCE7", text: "#166534" },
  PUBLISHED: { bg: "#E0F2FE", text: "#075985" },
  DISCARDED: { bg: "#FEE2E2", text: "#991B1B" },
  FAILED: { bg: "#FEE2E2", text: "#991B1B" },
  REGENERATING: { bg: "#F3F4F6", text: "#6B7280" },
};

const REANALYSIS_REASONS = [
  { value: "WRONG_CONTEXT", label: "잘못된 맥락" },
  { value: "STUDENT_ATTRIBUTION_CONCERN", label: "학생 귀속 우려" },
  { value: "INSUFFICIENT_CONTEXT", label: "컨텍스트 부족" },
  { value: "PARENT_VISIBILITY_CONCERN", label: "학부모 공개 우려" },
  { value: "TECHNICAL_FACT_CONCERN", label: "사실 오류" },
  { value: "OTHER", label: "기타" },
];

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

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? { bg: "#F3F4F6", text: "#374151" };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: c.bg, color: c.text }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── MonthPicker ──────────────────────────────────────────────────────────────

function MonthPicker({ year, month, onChange }: { year: number; month: number; onChange: (y: number, m: number) => void }) {
  const now = new Date();
  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      <select value={year} onChange={(e) => onChange(parseInt(e.target.value), month)}
        style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}>
        {years.map((y) => <option key={y} value={y}>{y}년</option>)}
      </select>
      <select value={month} onChange={(e) => onChange(year, parseInt(e.target.value))}
        style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}>
        {months.map((m) => <option key={m} value={m}>{m}월</option>)}
      </select>
    </div>
  );
}

// ─── ReviewDrawer ─────────────────────────────────────────────────────────────

function ReviewDrawer({
  reportId,
  pendingList,
  currentIndex,
  onNavigate,
  onClose,
  onApproved,
}: {
  reportId: string;
  pendingList: ReportItem[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onApproved: () => void;
}) {
  const qc = useQueryClient();
  const [showDiscard, setShowDiscard] = useState(false);
  const [showReanalysis, setShowReanalysis] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [reanalysisCode, setReanalysisCode] = useState("OTHER");
  const [reanalysisNote, setReanalysisNote] = useState("");
  const [actionError, setActionError] = useState("");

  const { data: detail, isLoading, isError } = useQuery<ReportDetail>({
    queryKey: ["growth-report-detail", reportId],
    queryFn: () => api.get(`/admin/growth-reports/${reportId}`),
    enabled: !!reportId,
  });

  const approveMut = useMutation({
    mutationFn: () => api.post(`/teacher/growth-reports/${reportId}/review`, { action: "APPROVE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["growth-reports-list"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setActionError("");
      // Advance to next if available
      if (currentIndex < pendingList.length - 1) {
        onNavigate(currentIndex + 1);
      } else {
        onApproved();
      }
    },
    onError: (e) => setActionError(errMsg(e)),
  });

  const discardMut = useMutation({
    mutationFn: () => api.patch(`/admin/growth-reports/${reportId}/discard`, { reason: discardReason.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["growth-reports-list"] });
      setShowDiscard(false);
      setDiscardReason("");
      if (currentIndex < pendingList.length - 1) onNavigate(currentIndex + 1);
      else onClose();
    },
    onError: (e) => setActionError(errMsg(e)),
  });

  const reanalysisMut = useMutation({
    mutationFn: () =>
      api.post(`/teacher/growth-reports/${reportId}/review`, {
        action: "REQUEST_REANALYSIS",
        reason_code: reanalysisCode,
        note: reanalysisNote.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["growth-reports-list"] });
      setShowReanalysis(false);
      if (currentIndex < pendingList.length - 1) onNavigate(currentIndex + 1);
      else onClose();
    },
    onError: (e) => setActionError(errMsg(e)),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setShowDiscard(false);
    setShowReanalysis(false);
    setActionError("");
  }, [reportId]);

  const rc = detail?.report_content as Record<string, string | unknown> | null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "480px",
        background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        zIndex: 50, display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B" }}>성장리포트 검수</div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#64748B" }}>×</button>
          </div>
          {/* Prev/Next */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => { setActionError(""); onNavigate(currentIndex - 1); }}
              disabled={currentIndex <= 0}
              style={{
                padding: "5px 12px", borderRadius: "4px", border: "1px solid #E2E8F0",
                background: currentIndex <= 0 ? "#F8FAFC" : "#fff",
                cursor: currentIndex <= 0 ? "not-allowed" : "pointer",
                fontSize: "12px", color: currentIndex <= 0 ? "#CBD5E1" : "#475569",
              }}
            >
              ← 이전
            </button>
            <span style={{ fontSize: "12px", color: "#94A3B8" }}>
              {currentIndex + 1} / {pendingList.length}
            </span>
            <button
              onClick={() => { setActionError(""); onNavigate(currentIndex + 1); }}
              disabled={currentIndex >= pendingList.length - 1}
              style={{
                padding: "5px 12px", borderRadius: "4px", border: "1px solid #E2E8F0",
                background: currentIndex >= pendingList.length - 1 ? "#F8FAFC" : "#fff",
                cursor: currentIndex >= pendingList.length - 1 ? "not-allowed" : "pointer",
                fontSize: "12px", color: currentIndex >= pendingList.length - 1 ? "#CBD5E1" : "#475569",
              }}
            >
              다음 →
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {isLoading ? (
            <div style={{ color: "#94A3B8", fontSize: "13px" }}>로딩 중…</div>
          ) : isError ? (
            <div style={{ color: "#EF4444", fontSize: "13px" }}>불러오지 못했습니다.</div>
          ) : detail ? (
            <>
              {/* Student info */}
              <div style={{ padding: "12px", background: "#F8FAFC", borderRadius: "6px", marginBottom: "16px", border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#1E293B", marginBottom: "4px" }}>
                  {detail.student.name}
                </div>
                <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "#64748B" }}>
                  <span>반: {detail.student.class_name || "—"}</span>
                  <span>선생님: {detail.student.teacher_name || "—"}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#64748B", marginTop: "2px" }}>
                  대상 기간: {formatPeriod(detail.report_period)}
                </div>
                <div style={{ marginTop: "6px" }}>
                  <StatusBadge status={detail.product_status} />
                </div>
              </div>

              {/* Report content */}
              {rc ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {typeof rc.summary === "string" && (
                    <Section title="요약">{rc.summary}</Section>
                  )}
                  {typeof rc.overall_assessment === "string" && (
                    <Section title="전반적 평가">{rc.overall_assessment}</Section>
                  )}
                  {detail.sns_summary && (
                    <Section title="SNS 요약">{detail.sns_summary}</Section>
                  )}
                  {detail.positive_growth_signals && detail.positive_growth_signals.length > 0 && (
                    <Section title="긍정적 성장 신호">
                      <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                        {detail.positive_growth_signals.map((s, i) => <li key={i} style={{ fontSize: "13px", marginBottom: "2px" }}>{s}</li>)}
                      </ul>
                    </Section>
                  )}
                  {detail.next_growth_targets && detail.next_growth_targets.length > 0 && (
                    <Section title="다음 성장 목표">
                      <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                        {detail.next_growth_targets.map((s, i) => <li key={i} style={{ fontSize: "13px", marginBottom: "2px" }}>{s}</li>)}
                      </ul>
                    </Section>
                  )}
                  {detail.next_observation_targets && detail.next_observation_targets.length > 0 && (
                    <Section title="다음 관찰 목표">
                      <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                        {detail.next_observation_targets.map((s, i) => <li key={i} style={{ fontSize: "13px", marginBottom: "2px" }}>{s}</li>)}
                      </ul>
                    </Section>
                  )}
                  {/* Remaining string fields in report_content */}
                  {Object.entries(rc).filter(([k]) => !["summary", "overall_assessment"].includes(k)).map(([k, v]) =>
                    typeof v === "string" ? (
                      <Section key={k} title={k.replace(/_/g, " ")}>{v}</Section>
                    ) : null
                  )}
                </div>
              ) : (
                <div style={{ color: "#94A3B8", fontSize: "13px", padding: "20px", textAlign: "center" }}>
                  리포트 내용이 없습니다.
                </div>
              )}

              {/* Review metadata */}
              {detail.teacher_reviewed_at && (
                <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #F1F5F9", fontSize: "12px", color: "#94A3B8" }}>
                  검수: {formatDate(detail.teacher_reviewed_at)} · {detail.teacher_review_action || ""}
                </div>
              )}

              {/* Reanalysis form */}
              {showReanalysis && (
                <div style={{ marginTop: "16px", padding: "14px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: "6px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>재분석 요청</div>
                  <select
                    value={reanalysisCode}
                    onChange={(e) => setReanalysisCode(e.target.value)}
                    style={{ width: "100%", padding: "7px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", marginBottom: "8px" }}
                  >
                    {REANALYSIS_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <textarea
                    value={reanalysisNote}
                    onChange={(e) => setReanalysisNote(e.target.value)}
                    placeholder="메모 (선택)"
                    style={{ width: "100%", padding: "7px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", resize: "vertical", minHeight: "60px", boxSizing: "border-box", marginBottom: "8px" }}
                  />
                  <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                    <button onClick={() => setShowReanalysis(false)} style={{ padding: "6px 12px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>취소</button>
                    <button
                      onClick={() => reanalysisMut.mutate()}
                      disabled={reanalysisMut.isPending}
                      style={{ padding: "6px 12px", background: "#D97706", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
                    >
                      {reanalysisMut.isPending ? "요청 중…" : "재분석 요청"}
                    </button>
                  </div>
                </div>
              )}

              {/* Discard form */}
              {showDiscard && (
                <div style={{ marginTop: "16px", padding: "14px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px", color: "#DC2626" }}>
                    {detail.student.name} 회원의 {formatPeriod(detail.report_period)} 성장리포트를 반려합니다.
                  </div>
                  <textarea
                    value={discardReason}
                    onChange={(e) => setDiscardReason(e.target.value)}
                    placeholder="반려 사유 *"
                    style={{ width: "100%", padding: "7px 8px", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", resize: "vertical", minHeight: "60px", boxSizing: "border-box", marginBottom: "8px" }}
                  />
                  <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                    <button onClick={() => setShowDiscard(false)} style={{ padding: "6px 12px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>취소</button>
                    <button
                      onClick={() => { if (!discardReason.trim()) { setActionError("사유를 입력해주세요."); return; } discardMut.mutate(); }}
                      disabled={discardMut.isPending}
                      style={{ padding: "6px 12px", background: "#DC2626", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
                    >
                      {discardMut.isPending ? "처리 중…" : "반려"}
                    </button>
                  </div>
                </div>
              )}

              {actionError && (
                <div style={{ marginTop: "12px", padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626" }}>
                  {actionError}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer actions */}
        {detail && detail.product_status === "REVIEW_REQUIRED" && (
          <div style={{ padding: "14px 20px", borderTop: "1px solid #E2E8F0", display: "flex", gap: "8px", flexShrink: 0 }}>
            <button
              onClick={() => { setShowDiscard(!showDiscard); setShowReanalysis(false); setActionError(""); }}
              style={{ padding: "8px 14px", background: "#fff", border: "1px solid #E2E8F0", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#475569" }}
            >
              반려
            </button>
            <button
              onClick={() => { setShowReanalysis(!showReanalysis); setShowDiscard(false); setActionError(""); }}
              style={{ padding: "8px 14px", background: "#fff", border: "1px solid #FCD34D", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#92400E" }}
            >
              재분석 요청
            </button>
            <button
              onClick={() => { setActionError(""); approveMut.mutate(); }}
              disabled={approveMut.isPending}
              style={{
                flex: 1, padding: "8px 14px",
                background: approveMut.isPending ? "#93A8C4" : "#1D4E8F",
                color: "#fff", border: "none", borderRadius: "6px",
                cursor: approveMut.isPending ? "not-allowed" : "pointer",
                fontSize: "13px", fontWeight: 600,
              }}
            >
              {approveMut.isPending ? "승인 중…" : "✓ 승인"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "#94A3B8", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{title}</div>
      <div style={{ fontSize: "13px", color: "#1E293B", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

// ─── PendingPage ──────────────────────────────────────────────────────────────

export default function PendingPage() {
  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [year, setYear] = useState(prevYear);
  const [month, setMonth] = useState(prevMonth);
  const [search, setSearch] = useState("");
  const [drawerIndex, setDrawerIndex] = useState<number | null>(null);
  const [allDone, setAllDone] = useState(false);

  const { data, isLoading, isError } = useQuery<ReportListResponse>({
    queryKey: ["growth-reports-list", year, month],
    queryFn: () => api.get(`/admin/growth-reports/monthly-list?year=${year}&month=${month}&limit=200`),
  });

  // Show only REVIEW_REQUIRED reports
  const pending = (data?.items ?? []).filter((r) => r.product_status === "REVIEW_REQUIRED");

  const filtered = pending.filter((r) => {
    if (!search) return true;
    return r.student_name?.toLowerCase().includes(search.toLowerCase());
  });

  const openDrawer = useCallback((index: number) => {
    setAllDone(false);
    setDrawerIndex(index);
  }, []);

  const closeDrawer = useCallback(() => setDrawerIndex(null), []);

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>검수 대기</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            {isLoading ? "…" : `${filtered.length}건 대기 중`}
          </p>
        </div>
        <MonthPicker year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); setDrawerIndex(null); setAllDone(false); }} />
      </div>

      <div style={{ marginBottom: "16px" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="회원명 검색…"
          style={{ padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", width: "200px" }}
        />
      </div>

      {allDone && (
        <div style={{ padding: "20px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "8px", marginBottom: "16px", textAlign: "center", fontSize: "14px", color: "#166534", fontWeight: 600 }}>
          ✓ 이번 달 검수가 모두 완료되었습니다.
        </div>
      )}

      {isError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>성장리포트를 불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>
          {search ? "검색 결과가 없습니다." : "검수 대기 중인 성장리포트가 없습니다."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["회원명", "대상 기간", "반", "선생님", "생성일", "상태", "검수"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA", cursor: "pointer" }}
                  onClick={() => openDrawer(i)}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#F0F7FF")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "#fff" : "#FAFAFA")}
                >
                  <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>{r.student_name}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{formatPeriod(r.report_period)}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{(r as unknown as Record<string,string>).class_name || "—"}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>{(r as unknown as Record<string,string>).teacher_name || "—"}</td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>{formatDate(r.created_at)}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}><StatusBadge status={r.product_status} /></td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); openDrawer(i); }}
                      style={{ padding: "4px 10px", background: "#EEF4FB", border: "1px solid #BFDBFE", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#1D4E8F", fontWeight: 600 }}
                    >
                      검수
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawerIndex !== null && filtered[drawerIndex] && (
        <ReviewDrawer
          reportId={filtered[drawerIndex].id}
          pendingList={filtered}
          currentIndex={drawerIndex}
          onNavigate={(idx) => setDrawerIndex(idx)}
          onClose={closeDrawer}
          onApproved={() => { setDrawerIndex(null); setAllDone(true); }}
        />
      )}
    </div>
  );
}
