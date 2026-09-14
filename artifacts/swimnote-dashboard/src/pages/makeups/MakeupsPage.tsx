import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MakeupSession {
  id: string;
  student_id: string;
  student_name: string;
  original_class_group_id: string | null;
  original_class_group_name: string | null;
  absence_date: string | null;
  expire_at: string | null;
  status: "waiting" | "assigned" | "completed" | "cancelled" | "expired";
  assigned_class_group_id: string | null;
  assigned_class_group_name: string | null;
  assigned_date: string | null;
  is_expired: boolean;
  swimming_pool_id?: string;
  created_at?: string;
}

interface EligibleClass {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  capacity: number | null;
  current_members: number;
  available_slots: number;
  is_eligible: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  waiting: "미배정",
  assigned: "배정",
  completed: "완료",
  cancelled: "취소",
  expired: "만료",
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  waiting: { bg: "#FEF9C3", text: "#92400E" },
  assigned: { bg: "#DBEAFE", text: "#1E40AF" },
  completed: { bg: "#DCFCE7", text: "#166534" },
  cancelled: { bg: "#F3F4F6", text: "#6B7280" },
  expired: { bg: "#FEE2E2", text: "#991B1B" },
};

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    const d = new Date(s.includes("T") ? s : s + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return `${m}월 ${day}일 (${weekday})`;
  } catch {
    return "—";
  }
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return (e as ApiError).message;
  return "오류가 발생했습니다.";
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? { bg: "#F3F4F6", text: "#374151" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: "10px",
      fontSize: "11px", fontWeight: 600, background: c.bg, color: c.text,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── AssignDrawer ─────────────────────────────────────────────────────────────

function AssignDrawer({
  makeup,
  onClose,
}: {
  makeup: MakeupSession;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selectedClass, setSelectedClass] = useState<EligibleClass | null>(null);
  const [assignDate, setAssignDate] = useState("");
  const [formError, setFormError] = useState("");

  const { data: eligibleClasses = [], isLoading: ecLoading, isError: ecError } = useQuery<EligibleClass[]>({
    queryKey: ["makeup-eligible-classes"],
    queryFn: () => api.get("/admin/makeups/eligible-classes"),
  });

  const assignMut = useMutation({
    mutationFn: (body: { class_group_id: string; assigned_date: string }) =>
      api.patch(`/admin/makeups/${makeup.id}/assign`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["makeups"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onClose();
    },
    onError: (e) => setFormError(errMsg(e)),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleAssign() {
    if (!selectedClass) { setFormError("반을 선택해주세요."); return; }
    if (!assignDate) { setFormError("보강 날짜를 입력해주세요."); return; }
    setFormError("");
    assignMut.mutate({ class_group_id: selectedClass.id, assigned_date: assignDate });
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "420px",
        background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        zIndex: 50, display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B" }}>보강 배정</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#64748B" }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {/* 대상 요약 */}
          <div style={{ padding: "12px", background: "#F8FAFC", borderRadius: "6px", marginBottom: "20px", border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#1E293B", marginBottom: "4px" }}>
              {makeup.student_name}
            </div>
            <div style={{ fontSize: "12px", color: "#64748B" }}>
              원반: {makeup.original_class_group_name || "—"}
            </div>
            <div style={{ fontSize: "12px", color: "#64748B" }}>
              결석일: {formatDate(makeup.absence_date)}
            </div>
            {makeup.expire_at && (
              <div style={{ fontSize: "12px", color: "#94A3B8" }}>
                보강 기한: {formatDate(makeup.expire_at)}
              </div>
            )}
          </div>

          {/* 반 선택 */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "8px" }}>
              보강 반 선택 <span style={{ color: "#EF4444" }}>*</span>
            </div>
            {ecLoading ? (
              <div style={{ color: "#94A3B8", fontSize: "13px" }}>반 목록 로딩 중…</div>
            ) : ecError ? (
              <div style={{ color: "#EF4444", fontSize: "13px" }}>불러오지 못했습니다.</div>
            ) : eligibleClasses.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: "13px" }}>가능한 반이 없습니다.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {eligibleClasses.map((ec) => {
                  const full = ec.available_slots <= 0;
                  const selected = selectedClass?.id === ec.id;
                  return (
                    <button
                      key={ec.id}
                      onClick={() => !full && setSelectedClass(ec)}
                      disabled={full}
                      style={{
                        padding: "10px 12px", borderRadius: "6px", cursor: full ? "not-allowed" : "pointer",
                        border: selected ? "2px solid #1D4E8F" : "1px solid #E2E8F0",
                        background: selected ? "#EEF4FB" : full ? "#F9FAFB" : "#fff",
                        textAlign: "left", opacity: full ? 0.6 : 1,
                      }}
                    >
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#1E293B", marginBottom: "2px" }}>
                        {ec.name}
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748B" }}>
                        {ec.schedule_days} / {ec.schedule_time}
                      </div>
                      <div style={{ fontSize: "12px", color: full ? "#DC2626" : "#64748B", marginTop: "2px" }}>
                        {ec.current_members}{ec.capacity != null ? ` / ${ec.capacity}` : ""}명
                        {full ? " (정원 초과)" : ec.available_slots != null ? ` · 여유 ${ec.available_slots}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 날짜 입력 */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
              보강 날짜 <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <input
              type="date"
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" }}
            />
          </div>

          {/* 최종 확인 */}
          {selectedClass && assignDate && (
            <div style={{ padding: "12px", background: "#F0F7FF", borderRadius: "6px", border: "1px solid #BFDBFE", marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#1D4E8F", marginBottom: "6px" }}>배정 확인</div>
              <div style={{ fontSize: "12px", color: "#1E40AF" }}>회원: {makeup.student_name}</div>
              <div style={{ fontSize: "12px", color: "#1E40AF" }}>반: {selectedClass.name}</div>
              <div style={{ fontSize: "12px", color: "#1E40AF" }}>날짜: {formatDate(assignDate)}</div>
            </div>
          )}

          {formError && (
            <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626", marginBottom: "12px" }}>
              {formError}
            </div>
          )}
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid #E2E8F0" }}>
          <button
            onClick={handleAssign}
            disabled={assignMut.isPending}
            style={{
              width: "100%", padding: "10px",
              background: assignMut.isPending ? "#93A8C4" : "#1D4E8F",
              color: "#fff", border: "none", borderRadius: "6px",
              cursor: assignMut.isPending ? "not-allowed" : "pointer",
              fontSize: "13px", fontWeight: 600,
            }}
          >
            {assignMut.isPending ? "배정 중…" : "보강 배정"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
  error,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
  error: string;
}) {
  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        zIndex: 70, background: "#fff", borderRadius: "10px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.16)", padding: "28px 28px 24px",
        width: "min(380px, calc(100vw - 48px))",
      }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>{title}</div>
        <div style={{ fontSize: "13px", color: "#475569", marginBottom: "20px", lineHeight: 1.6 }}>{body}</div>
        {error && (
          <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626", marginBottom: "12px" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={loading} style={{ padding: "8px 16px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "8px 16px", background: loading ? "#D1D5DB" : "#DC2626",
              color: "#fff", border: "none", borderRadius: "6px",
              cursor: loading ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600,
            }}
          >
            {loading ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── MakeupsPage ──────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "전체 상태" },
  { value: "waiting", label: "미배정" },
  { value: "assigned", label: "배정" },
  { value: "completed", label: "완료" },
  { value: "cancelled", label: "취소" },
  { value: "expired", label: "만료" },
];

export default function MakeupsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("waiting");
  const [search, setSearch] = useState("");
  const [assignTarget, setAssignTarget] = useState<MakeupSession | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MakeupSession | null>(null);
  const [cancelError, setCancelError] = useState("");

  const { data: makeups = [], isLoading, isError } = useQuery<MakeupSession[]>({
    queryKey: ["makeups", statusFilter],
    queryFn: () =>
      api.get(`/admin/makeups${statusFilter ? `?status=${statusFilter}` : ""}`),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/makeups/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["makeups"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setCancelTarget(null);
    },
    onError: (e) => setCancelError(errMsg(e)),
  });

  const filtered = makeups.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.student_name?.toLowerCase().includes(q) ||
      m.original_class_group_name?.toLowerCase().includes(q) ||
      m.assigned_class_group_name?.toLowerCase().includes(q)
    );
  });

  // Sort: waiting/assigned first (action needed), then by absence_date desc
  const sorted = [...filtered].sort((a, b) => {
    const priority = (s: string) =>
      s === "waiting" ? 0 : s === "assigned" ? 1 : s === "completed" ? 2 : 3;
    const p = priority(a.status) - priority(b.status);
    if (p !== 0) return p;
    if (a.absence_date && b.absence_date) return b.absence_date.localeCompare(a.absence_date);
    return 0;
  });

  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>보강 현황</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            {filtered.length}건
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "4px" }}>
          {STATUS_FILTER_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setStatusFilter(o.value)}
              style={{
                padding: "5px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px",
                border: statusFilter === o.value ? "2px solid #1D4E8F" : "1px solid #CBD5E1",
                background: statusFilter === o.value ? "#EEF4FB" : "#fff",
                color: statusFilter === o.value ? "#1D4E8F" : "#475569",
                fontWeight: statusFilter === o.value ? 600 : 400,
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="회원 이름 검색…"
          style={{
            padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px",
            fontSize: "13px", width: "180px",
          }}
        />
      </div>

      {/* Table */}
      {isError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>처리할 보강이 없습니다.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["회원", "원반", "결석일", "보강 기한", "배정 반", "보강일", "상태", "관리"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((m, i) => (
                <tr
                  key={m.id}
                  style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}
                >
                  <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>
                    {m.student_name || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>
                    {m.original_class_group_name || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>
                    {formatDate(m.absence_date)}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>
                    {formatDate(m.expire_at)}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>
                    {m.assigned_class_group_name || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>
                    {formatDate(m.assigned_date)}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #F1F5F9" }}>
                    <StatusBadge status={m.status} />
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {(m.status === "waiting" || m.is_expired) && (
                        <button
                          onClick={() => setAssignTarget(m)}
                          style={{ padding: "4px 8px", background: "#EEF4FB", border: "1px solid #BFDBFE", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#1D4E8F", fontWeight: 600 }}
                        >
                          배정
                        </button>
                      )}
                      {m.status === "assigned" && (
                        <>
                          <button
                            onClick={() => setAssignTarget(m)}
                            style={{ padding: "4px 8px", background: "#F1F5F9", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#475569" }}
                          >
                            변경
                          </button>
                          <button
                            onClick={() => { setCancelTarget(m); setCancelError(""); }}
                            style={{ padding: "4px 8px", background: "#FEF2F2", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#DC2626" }}
                          >
                            취소
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assign drawer */}
      {assignTarget && (
        <AssignDrawer
          makeup={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}

      {/* Cancel confirm */}
      {cancelTarget && (
        <ConfirmModal
          title="보강 배정 취소"
          body={`${cancelTarget.student_name} 회원의 ${formatDate(cancelTarget.assigned_date)} 보강 배정을 취소합니다. 취소 후에는 다시 미배정 상태로 돌아옵니다.`}
          confirmLabel="보강 취소"
          onConfirm={() => cancelMut.mutate(cancelTarget.id)}
          onCancel={() => { setCancelTarget(null); setCancelError(""); }}
          loading={cancelMut.isPending}
          error={cancelError}
        />
      )}
    </div>
  );
}
