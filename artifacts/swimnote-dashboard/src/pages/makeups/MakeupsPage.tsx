import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

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

// ─── Status filter options ────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "전체 상태" },
  { value: "waiting", label: "미배정" },
  { value: "assigned", label: "배정" },
  { value: "completed", label: "완료" },
  { value: "cancelled", label: "취소" },
  { value: "expired", label: "만료" },
];

// ─── MakeupsPage ──────────────────────────────────────────────────────────────

export default function MakeupsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("waiting");
  const [search, setSearch] = useState("");
  const [overrideTarget, setOverrideTarget] = useState<{ id: string; current: string } | null>(null);
  const [overrideError, setOverrideError] = useState("");

  const { data: makeups = [], isLoading, isError } = useQuery<MakeupSession[]>({
    queryKey: ["makeups", statusFilter],
    queryFn: () =>
      api.get(`/admin/makeups${statusFilter ? `?status=${statusFilter}` : ""}`),
  });

  const overrideMut = useMutation({
    mutationFn: ({ id, target_status }: { id: string; target_status: string }) =>
      api.patch(`/admin/makeups/${id}/status-override`, { target_status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["makeups"] });
      setOverrideTarget(null);
      setOverrideError("");
    },
    onError: (e: unknown) => {
      setOverrideError((e as { message?: string })?.message ?? "상태 변경 실패");
    },
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
            {filtered.length}건 · 대기↔만료 수동 전환 가능
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
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>표시할 보강이 없습니다.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["회원", "원반", "결석일", "보강 기한", "배정 반", "보강일", "상태", ""].map((h) => (
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
                  <td style={{ padding: "6px 12px", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" }}>
                    {m.status === "waiting" && (
                      <button
                        onClick={() => { setOverrideError(""); setOverrideTarget({ id: m.id, current: "waiting" }); }}
                        style={{ padding: "3px 8px", fontSize: "11px", cursor: "pointer", border: "1px solid #FECACA", borderRadius: "4px", background: "#FFF", color: "#991B1B" }}
                      >
                        만료 처리
                      </button>
                    )}
                    {m.status === "expired" && (
                      <button
                        onClick={() => { setOverrideError(""); setOverrideTarget({ id: m.id, current: "expired" }); }}
                        style={{ padding: "3px 8px", fontSize: "11px", cursor: "pointer", border: "1px solid #BBF7D0", borderRadius: "4px", background: "#FFF", color: "#166534" }}
                      >
                        대기 복원
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 상태 수동 전환 확인 다이얼로그 */}
      {overrideTarget && (
        <>
          <div onClick={() => setOverrideTarget(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 400 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", background: "#fff", borderRadius: "10px", padding: "24px", width: "320px", zIndex: 401, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>
              {overrideTarget.current === "waiting" ? "만료 처리 확인" : "대기 복원 확인"}
            </div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "16px", lineHeight: 1.6 }}>
              {overrideTarget.current === "waiting"
                ? "이 보강을 만료 처리합니다. 대기 목록에서 제외됩니다."
                : "이 보강을 대기 상태로 복원합니다. 풀 정책에 따라 새 만료일이 설정됩니다."}
            </div>
            {overrideError && (
              <div style={{ fontSize: "12px", color: "#DC2626", marginBottom: "10px" }}>{overrideError}</div>
            )}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => setOverrideTarget(null)} style={{ padding: "7px 14px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>취소</button>
              <button
                onClick={() => overrideMut.mutate({ id: overrideTarget.id, target_status: overrideTarget.current === "waiting" ? "expired" : "waiting" })}
                disabled={overrideMut.isPending}
                style={{ padding: "7px 14px", background: overrideTarget.current === "waiting" ? "#DC2626" : "#166534", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
              >
                {overrideMut.isPending ? "처리 중…" : overrideTarget.current === "waiting" ? "만료 처리" : "대기 복원"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
