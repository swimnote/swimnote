/**
 * TeachersPage — /admin/teachers
 * 선생님 목록·초대·상세·상태변경
 * API: /admin/teacher-invites (teacher-invites.ts)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface TeacherInvite {
  id: string;
  name: string;
  phone: string;
  position: string | null;
  invite_status: "invited" | "joinedPendingApproval" | "approved" | "rejected" | "inactive";
  invite_token: string;
  invited_by: string;
  user_id: string | null;
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  user_email: string | null;
  user_roles: string[] | null;
}

interface TeacherDetail extends TeacherInvite {
  is_activated: boolean | null;
  class_count: number;
  member_count: number;
}

const STATUS_LABEL: Record<string, string> = {
  invited: "초대됨",
  joinedPendingApproval: "승인 대기",
  approved: "활성",
  rejected: "거절됨",
  inactive: "비활성",
};
const STATUS_COLOR: Record<string, string> = {
  invited: "#6366f1",
  joinedPendingApproval: "#f59e0b",
  approved: "#16a34a",
  rejected: "#dc2626",
  inactive: "#6b7280",
};

export default function TeachersPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [selected, setSelected] = useState<TeacherDetail | null>(null);
  const [actionError, setActionError] = useState("");

  // Invite form state
  const [form, setForm] = useState({ name: "", phone: "", position: "", notes: "" });
  const [formErr, setFormErr] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["teacher-invites", statusFilter],
    queryFn: async () => {
      const q = statusFilter ? `?status=${statusFilter}` : "";
      const r = await api.get<{ success: boolean; data: TeacherInvite[] }>(`/admin/teacher-invites${q}`);
      return r.data.data;
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (body: { name: string; phone: string; position?: string; notes?: string }) =>
      api.post("/admin/teacher-invites", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-invites"] });
      setShowInviteForm(false);
      setForm({ name: "", phone: "", position: "", notes: "" });
      setFormErr("");
    },
    onError: (e: any) => setFormErr(e?.response?.data?.message || "초대 실패"),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: string; reason?: string }) =>
      api.patch(`/admin/teacher-invites/${id}`, { action, rejection_reason: reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-invites"] });
      setSelected(null);
      setActionError("");
    },
    onError: (e: any) => setActionError(e?.response?.data?.message || "처리 실패"),
  });

  async function openDetail(invite: TeacherInvite) {
    try {
      const r = await api.get<{ success: boolean; data: TeacherDetail }>(`/admin/teacher-invites/${invite.id}/detail`);
      setSelected(r.data.data);
      setActionError("");
    } catch {
      setSelected({ ...invite, is_activated: null, class_count: 0, member_count: 0 });
    }
  }

  function handleInvite(e: Event) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) { setFormErr("이름과 연락처는 필수입니다."); return; }
    inviteMutation.mutate({ name: form.name, phone: form.phone, position: form.position || undefined, notes: form.notes || undefined });
  }

  const statuses = ["", "approved", "invited", "joinedPendingApproval", "inactive", "rejected"];

  return (
    <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>선생님 관리</h2>
        <button onClick={() => setShowInviteForm(true)} style={{ background: "#111827", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 14 }}>
          + 선생님 초대
        </button>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: 16 }}>
        {statuses.map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ marginRight: 8, padding: "5px 12px", borderRadius: 20, fontSize: 13, cursor: "pointer", border: "1px solid #e5e7eb", background: statusFilter === s ? "#111827" : "#fff", color: statusFilter === s ? "#fff" : "#374151" }}>
            {s ? STATUS_LABEL[s] : "전체"}
          </button>
        ))}
      </div>

      {isLoading && <p style={{ color: "#6b7280" }}>불러오는 중…</p>}
      {error && <p style={{ color: "#dc2626" }}>데이터를 불러오지 못했습니다.</p>}

      {/* Table */}
      {data && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["이름", "연락처", "직책", "상태", "초대일", "관리"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 16px", fontWeight: 600, color: "#374151" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "#6b7280" }}>선생님이 없습니다.</td></tr>
              )}
              {data.map(t => (
                <tr key={t.id} onClick={() => openDetail(t)} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 500 }}>{t.name}</td>
                  <td style={{ padding: "12px 16px", color: "#6b7280" }}>{t.phone}</td>
                  <td style={{ padding: "12px 16px", color: "#6b7280" }}>{t.position || "—"}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "2px 10px", borderRadius: 12, fontSize: 12, background: `${STATUS_COLOR[t.invite_status]}20`, color: STATUS_COLOR[t.invite_status] }}>
                      {STATUS_LABEL[t.invite_status]}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#6b7280" }}>{t.created_at?.slice(0, 10)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <button onClick={e => { e.stopPropagation(); openDetail(t); }} style={{ fontSize: 13, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}>상세</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setShowInviteForm(false)}>
          <form onSubmit={handleInvite} onClick={(e: Event) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 10, padding: 28, width: 420, boxShadow: "0 8px 32px rgba(0,0,0,0.15)" }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 600 }}>선생님 초대</h3>
            {[
              { label: "이름 *", key: "name", placeholder: "홍길동" },
              { label: "연락처 *", key: "phone", placeholder: "01012345678" },
              { label: "직책", key: "position", placeholder: "수석 코치" },
              { label: "메모", key: "notes", placeholder: "담당 반 등 참고사항" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" }}>{f.label}</label>
                <input value={(form as any)[f.key]} onInput={(e: any) => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder} style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
              </div>
            ))}
            {formErr && <p style={{ color: "#dc2626", fontSize: 13, margin: "0 0 10px" }}>{formErr}</p>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowInviteForm(false)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 14 }}>취소</button>
              <button type="submit" disabled={inviteMutation.isPending} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "#111827", color: "#fff", cursor: "pointer", fontSize: 14 }}>
                {inviteMutation.isPending ? "처리 중…" : "초대 생성"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Detail Drawer */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 999 }} onClick={() => setSelected(null)}>
          <div onClick={(e: Event) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 420, background: "#fff", padding: 28, overflowY: "auto", boxShadow: "-4px 0 20px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{selected.name}</h3>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>×</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
              {[
                ["연락처", selected.phone],
                ["이메일", selected.user_email || "—"],
                ["직책", selected.position || "—"],
                ["상태", STATUS_LABEL[selected.invite_status]],
                ["담당 반", `${selected.class_count}개`],
                ["담당 학생", `${selected.member_count}명`],
                ["초대일", selected.created_at?.slice(0, 10)],
                ["승인일", selected.approved_at?.slice(0, 10) || "—"],
                ["메모", selected.notes || "—"],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", borderBottom: "1px solid #f3f4f6", paddingBottom: 10 }}>
                  <span style={{ width: 100, color: "#6b7280", fontSize: 13 }}>{label}</span>
                  <span style={{ fontSize: 14 }}>{value}</span>
                </div>
              ))}
            </div>

            {actionError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{actionError}</p>}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selected.invite_status === "joinedPendingApproval" && (
                <button onClick={() => { if (confirm(`${selected.name} 선생님을 승인하시겠습니까?`)) actionMutation.mutate({ id: selected.id, action: "approve" }); }}
                  disabled={actionMutation.isPending} style={{ padding: "9px 0", borderRadius: 6, border: "none", background: "#16a34a", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  승인
                </button>
              )}
              {selected.invite_status === "approved" && (
                <button onClick={() => { if (confirm(`${selected.name} 선생님을 비활성화하시겠습니까?\n현재 담당 반(${selected.class_count}개)에 영향이 있을 수 있습니다.`)) actionMutation.mutate({ id: selected.id, action: "deactivate" }); }}
                  disabled={actionMutation.isPending} style={{ padding: "9px 0", borderRadius: 6, border: "1px solid #dc2626", background: "#fff", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>
                  비활성화
                </button>
              )}
              {selected.invite_status === "inactive" && (
                <button onClick={() => { if (confirm(`${selected.name} 선생님을 다시 활성화하시겠습니까?`)) actionMutation.mutate({ id: selected.id, action: "reactivate" }); }}
                  disabled={actionMutation.isPending} style={{ padding: "9px 0", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: 14 }}>
                  재활성화
                </button>
              )}
              {(selected.invite_status === "invited" || selected.invite_status === "joinedPendingApproval") && (
                <button onClick={() => { if (confirm(`${selected.name} 초대를 취소(거절)하시겠습니까?`)) actionMutation.mutate({ id: selected.id, action: "reject" }); }}
                  disabled={actionMutation.isPending} style={{ padding: "9px 0", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: "#374151", cursor: "pointer", fontSize: 14 }}>
                  초대 취소
                </button>
              )}
            </div>

            {selected.invite_token && (
              <div style={{ marginTop: 20, padding: 14, background: "#f9fafb", borderRadius: 8 }}>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 6px" }}>초대 토큰 (선생님에게 공유)</p>
                <code style={{ fontSize: 12, wordBreak: "break-all" }}>{selected.invite_token}</code>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
