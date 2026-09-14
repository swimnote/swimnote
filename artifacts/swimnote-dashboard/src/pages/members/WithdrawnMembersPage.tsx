import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api-client";
import { ChevronLeft, AlertCircle, RotateCcw } from "lucide-react";

type WithdrawnMember = {
  id: string;
  name: string;
  phone?: string;
  last_class_group_name?: string;
  birth_year?: number;
  withdrawn_at?: string;
  deleted_at?: string;
  archived_reason?: string;
  status: string;
  updated_at?: string;
  attendance_count?: number;
};

const STATUS_LABELS: Record<string, string> = {
  withdrawn: "퇴원",
  deleted: "탈퇴",
  archived: "아카이브",
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  withdrawn: { bg: "#FEE2E2", color: "#991B1B" },
  deleted:   { bg: "#F3F4F6", color: "#6B7280" },
  archived:  { bg: "#F3F4F6", color: "#6B7280" },
};

type ConfirmProps = {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
};

function RestoreConfirm({ name, onConfirm, onCancel, loading }: ConfirmProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

  return (
    <>
      <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 300 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        background: "#fff", borderRadius: "14px",
        width: "360px", zIndex: 301, padding: "24px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.14)",
      }}>
        <h2 style={{ margin: "0 0 10px", fontSize: "16px", fontWeight: 700, color: "#111827" }}>
          회원 복원
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#4B5563", lineHeight: 1.6 }}>
          <strong>{name}</strong> 회원을 재원 상태로 복원합니다.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={onCancel}
            style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: "14px" }}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex: 1, padding: "10px", borderRadius: "8px", border: "none",
              background: loading ? "#9CA3AF" : "var(--x-primary, #1E6FD9)",
              color: "#fff", cursor: loading ? "not-allowed" : "pointer",
              fontSize: "14px", fontWeight: 600,
            }}
          >
            {loading ? "복원 중…" : "복원"}
          </button>
        </div>
      </div>
    </>
  );
}

export default function WithdrawnMembersPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [restoreTarget, setRestoreTarget] = useState<{ id: string; name: string } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const { data: members = [], isLoading, isError, refetch } = useQuery<WithdrawnMember[]>({
    queryKey: ["withdrawn-members"],
    queryFn: () => api.get<WithdrawnMember[]>("/admin/withdrawn-members"),
    staleTime: 30_000,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/students/${id}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["withdrawn-members"] });
      qc.invalidateQueries({ queryKey: ["students"] });
      setRestoreTarget(null);
      setRestoreError(null);
    },
    onError: (e: ApiError) => {
      setRestoreError(e.message ?? "복원 중 오류가 발생했습니다.");
      setRestoreTarget(null);
    },
  });

  return (
    <div style={{ padding: "28px 32px", maxWidth: "900px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
        <button
          onClick={() => navigate("/admin/members")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6B7280", display: "flex", padding: "4px" }}
        >
          <ChevronLeft size={20} />
        </button>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: 0 }}>지난 회원</h1>
      </div>

      {restoreError && (
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          background: "#FEF2F2", color: "#DC2626",
          padding: "12px 16px", borderRadius: "10px",
          fontSize: "14px", marginBottom: "16px",
        }}>
          <AlertCircle size={16} /> {restoreError}
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: "12px", overflow: "hidden" }}>
        {isError ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#DC2626", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={24} />
            <div style={{ fontSize: "14px" }}>목록을 불러오지 못했습니다.</div>
            <button onClick={() => refetch()} style={{ marginTop: "4px", padding: "6px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: "13px" }}>
              다시 시도
            </button>
          </div>
        ) : isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#9CA3AF", fontSize: "14px" }}>
            불러오는 중…
          </div>
        ) : members.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#9CA3AF", fontSize: "14px" }}>
            지난 회원이 없습니다.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                {["이름", "이전 반", "상태", "처리일", "출석 수", "복원"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m, idx) => {
                const { bg, color } = STATUS_COLORS[m.status] ?? { bg: "#F3F4F6", color: "#374151" };
                const processedAt = m.withdrawn_at ?? m.deleted_at ?? m.updated_at;
                return (
                  <tr
                    key={m.id}
                    style={{ borderBottom: idx < members.length - 1 ? "1px solid #F3F4F6" : "none" }}
                  >
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "#111827" }}>{m.name}</td>
                    <td style={{ padding: "10px 14px", color: "#374151" }}>{m.last_class_group_name ?? "—"}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 600, background: bg, color }}>
                        {STATUS_LABELS[m.status] ?? m.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#6B7280" }}>
                      {processedAt ? new Date(processedAt).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" }) : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#374151" }}>
                      {m.attendance_count !== undefined ? `${m.attendance_count}회` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {m.status === "withdrawn" && (
                        <button
                          onClick={() => setRestoreTarget({ id: m.id, name: m.name })}
                          style={{
                            display: "flex", alignItems: "center", gap: "4px",
                            padding: "4px 10px", borderRadius: "6px",
                            border: "1px solid #BFDBFE", background: "#EFF6FF",
                            fontSize: "12px", color: "#1D4ED8", cursor: "pointer",
                            fontWeight: 500,
                          }}
                        >
                          <RotateCcw size={11} /> 복원
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {restoreTarget && (
        <RestoreConfirm
          name={restoreTarget.name}
          loading={restoreMutation.isPending}
          onConfirm={() => restoreMutation.mutate(restoreTarget.id)}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </div>
  );
}
