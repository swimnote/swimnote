import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const [statusFilter, setStatusFilter] = useState("waiting");
  const [search, setSearch] = useState("");

  const { data: makeups = [], isLoading, isError } = useQuery<MakeupSession[]>({
    queryKey: ["makeups", statusFilter],
    queryFn: () =>
      api.get(`/admin/makeups${statusFilter ? `?status=${statusFilter}` : ""}`),
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
            {filtered.length}건 · 읽기 전용
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
                {["회원", "원반", "결석일", "보강 기한", "배정 반", "보강일", "상태"].map((h) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
