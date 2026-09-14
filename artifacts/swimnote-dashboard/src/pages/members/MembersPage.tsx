import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api-client";
import {
  Search, X, ChevronLeft, ChevronRight, UserMinus,
  Edit2, RefreshCw, AlertCircle, Download, BookOpen,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type AssignedClass = {
  id: string;
  name: string;
  schedule_days?: string;
  schedule_time?: string;
  instructor?: string;
};

type Student = {
  id: string;
  name: string;
  phone?: string;
  birth_year?: number;
  birth_date?: string;
  status: string;
  memo?: string;
  notes?: string;
  parent_name?: string;
  parent_phone?: string;
  created_at?: string;
  class_group_id?: string;
  class_group_name?: string;
  assignedClasses?: AssignedClass[];
  schedule_labels?: string[];
  level?: string;
};

type ClassGroup = {
  id: string;
  name: string;
  level?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: "재원",
  suspended: "연기",
  withdrawn: "퇴원",
  inactive: "비활성",
  pending: "대기",
  archived: "탈퇴",
  unassigned: "미배정",
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active:    { bg: "#DCFCE7", color: "#166534" },
  suspended: { bg: "#FEF9C3", color: "#854D0E" },
  withdrawn: { bg: "#FEE2E2", color: "#991B1B" },
  inactive:  { bg: "#F3F4F6", color: "#374151" },
  pending:   { bg: "#E0F2FE", color: "#0369A1" },
  archived:  { bg: "#F3F4F6", color: "#6B7280" },
  unassigned:{ bg: "#FEF3C7", color: "#92400E" },
};

const PAGE_SIZE = 50;

// ── Helpers ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const { bg, color } = STATUS_COLORS[status] ?? { bg: "#F3F4F6", color: "#374151" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "12px",
        fontSize: "11px",
        fontWeight: 600,
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  );
}

// ── Member Detail Drawer ───────────────────────────────────────────────────

type DrawerProps = {
  student: Student | null;
  classGroups: ClassGroup[];
  onClose: () => void;
  onWithdraw: (id: string, name: string) => void;
  onEdit: (student: Student) => void;
  onViewDiary: (studentId: string) => void;
};

function MemberDrawer({ student, classGroups, onClose, onWithdraw, onEdit, onViewDiary }: DrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!student) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [student, onClose]);

  if (!student) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.18)",
          zIndex: 200,
        }}
      />
      {/* Drawer */}
      <div
        ref={drawerRef}
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          width: "400px",
          background: "#fff",
          borderLeft: "1px solid var(--border-default, #E5E7EB)",
          zIndex: 201,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-default, #E5E7EB)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>
              {student.name}
            </span>
            <StatusBadge status={student.status} />
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "#9CA3AF",
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          <Section title="기본 정보">
            <Row label="이름" value={student.name} />
            <Row label="생년" value={student.birth_year ? `${student.birth_year}년생` : student.birth_date} />
            <Row label="전화번호" value={student.phone} />
            <Row label="등록일" value={student.created_at ? new Date(student.created_at).toLocaleDateString("ko-KR") : undefined} />
          </Section>

          <Section title="수강 정보">
            {student.assignedClasses && student.assignedClasses.length > 0 ? (
              student.assignedClasses.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "10px 12px",
                    background: "#F8F9FA",
                    borderRadius: "8px",
                    marginBottom: "6px",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                    {c.name}
                  </div>
                  {(c.schedule_days || c.schedule_time) && (
                    <div style={{ color: "#6B7280" }}>
                      {[c.schedule_days, c.schedule_time].filter(Boolean).join(" ")}
                    </div>
                  )}
                  {c.instructor && (
                    <div style={{ color: "#6B7280" }}>담당: {c.instructor}</div>
                  )}
                </div>
              ))
            ) : (
              <p style={{ fontSize: "13px", color: "#9CA3AF", margin: 0 }}>
                {student.class_group_name ?? "배정된 반 없음"}
              </p>
            )}
          </Section>

          <Section title="보호자">
            <Row label="보호자명" value={student.parent_name} />
            <Row label="연락처" value={student.parent_phone} />
          </Section>

          {(student.memo || student.notes) && (
            <Section title="메모">
              <p
                style={{
                  fontSize: "13px",
                  color: "#374151",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                }}
              >
                {student.memo || student.notes}
              </p>
            </Section>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            borderTop: "1px solid var(--border-default, #E5E7EB)",
            padding: "14px 20px",
            display: "flex",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => onEdit(student)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "9px",
              borderRadius: "8px",
              border: "1px solid var(--border-default, #E5E7EB)",
              background: "#fff",
              fontSize: "13px",
              fontWeight: 500,
              color: "#374151",
              cursor: "pointer",
            }}
          >
            <Edit2 size={14} /> 수정
          </button>
          <button
            onClick={() => { onViewDiary(student.id); onClose(); }}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "9px",
              borderRadius: "8px",
              border: "1px solid #dbeafe",
              background: "#eff6ff",
              fontSize: "13px",
              fontWeight: 500,
              color: "#1d4ed8",
              cursor: "pointer",
            }}
          >
            <BookOpen size={14} /> 일지 보기
          </button>
          {student.status === "active" && (
            <button
              onClick={() => onWithdraw(student.id, student.name)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "9px",
                borderRadius: "8px",
                border: "1px solid #FCA5A5",
                background: "#FEF2F2",
                fontSize: "13px",
                fontWeight: 500,
                color: "#DC2626",
                cursor: "pointer",
              }}
            >
              <UserMinus size={14} /> 퇴원
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <h3
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: "#9CA3AF",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          margin: "0 0 10px",
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "5px 0",
        fontSize: "13px",
        borderBottom: "1px solid #F3F4F6",
      }}
    >
      <span style={{ color: "#6B7280" }}>{label}</span>
      <span style={{ color: "#111827", fontWeight: 500, textAlign: "right", maxWidth: "200px" }}>
        {String(value)}
      </span>
    </div>
  );
}

// ── Edit Modal ─────────────────────────────────────────────────────────────

type EditModalProps = {
  student: Student;
  classGroups: ClassGroup[];
  onClose: () => void;
  onSaved: () => void;
};

function EditModal({ student, classGroups, onClose, onSaved }: EditModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: student.name,
    birth_year: student.birth_year ? String(student.birth_year) : "",
    parent_name: student.parent_name ?? "",
    parent_phone: student.parent_phone ?? "",
    memo: student.memo ?? student.notes ?? "",
    class_group_id: student.class_group_id ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  const infoMutation = useMutation({
    mutationFn: () =>
      api.patch(`/admin/students/${student.id}/info`, {
        name: form.name.trim(),
        birth_year: form.birth_year ? Number(form.birth_year) : undefined,
        parent_name: form.parent_name || undefined,
        parent_phone: form.parent_phone || undefined,
        memo: form.memo || undefined,
      }),
    onError: (e: ApiError) => setError(e.message ?? "저장 중 오류가 발생했습니다."),
    onSuccess: async () => {
      // Assign class if changed
      if (form.class_group_id && form.class_group_id !== student.class_group_id) {
        await api.patch(`/students/${student.id}/assign`, {
          assigned_class_ids: [form.class_group_id],
        }).catch(() => {});
      }
      qc.invalidateQueries({ queryKey: ["students"] });
      onSaved();
    },
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 300 }}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "#fff",
          borderRadius: "14px",
          width: "440px",
          maxHeight: "90vh",
          overflowY: "auto",
          zIndex: 301,
          padding: "24px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.14)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111827" }}>
            회원 정보 수정
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF" }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "10px 12px", borderRadius: "8px", fontSize: "13px", marginBottom: "16px", display: "flex", gap: "8px", alignItems: "center" }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <Field label="이름 *">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={inputStyle}
            />
          </Field>
          <Field label="생년">
            <input
              type="number"
              placeholder="예: 2010"
              value={form.birth_year}
              onChange={(e) => setForm((f) => ({ ...f, birth_year: e.target.value }))}
              style={inputStyle}
            />
          </Field>
          <Field label="보호자명">
            <input
              value={form.parent_name}
              onChange={(e) => setForm((f) => ({ ...f, parent_name: e.target.value }))}
              style={inputStyle}
            />
          </Field>
          <Field label="보호자 연락처">
            <input
              value={form.parent_phone}
              onChange={(e) => setForm((f) => ({ ...f, parent_phone: e.target.value }))}
              style={inputStyle}
            />
          </Field>
          <Field label="반 변경">
            <select
              value={form.class_group_id}
              onChange={(e) => setForm((f) => ({ ...f, class_group_id: e.target.value }))}
              style={{ ...inputStyle, background: "#fff" }}
            >
              <option value="">반 선택 (현재 유지)</option>
              {classGroups.map((cg) => (
                <option key={cg.id} value={cg.id}>{cg.name}</option>
              ))}
            </select>
          </Field>
          <Field label="메모">
            <textarea
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: "14px" }}
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!form.name.trim()) { setError("이름은 필수입니다."); return; }
              setError(null);
              infoMutation.mutate();
            }}
            disabled={infoMutation.isPending}
            style={{
              flex: 2,
              padding: "10px",
              borderRadius: "8px",
              border: "none",
              background: infoMutation.isPending ? "#9CA3AF" : "var(--x-primary, #1E6FD9)",
              color: "#fff",
              cursor: infoMutation.isPending ? "not-allowed" : "pointer",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            {infoMutation.isPending ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid #D1D5DB",
  fontSize: "14px",
  boxSizing: "border-box",
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "#374151", marginBottom: "5px" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Confirm Dialog ─────────────────────────────────────────────────────────

type ConfirmProps = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel, loading }: ConfirmProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCancel]);

  return (
    <>
      <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 400 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        background: "#fff", borderRadius: "14px",
        width: "380px", zIndex: 401, padding: "24px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.14)",
      }}>
        <h2 style={{ margin: "0 0 10px", fontSize: "16px", fontWeight: 700, color: "#111827" }}>{title}</h2>
        <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#4B5563", lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: "14px" }}>
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex: 1, padding: "10px", borderRadius: "8px", border: "none",
              background: danger ? "#DC2626" : "var(--x-primary, #1E6FD9)",
              color: "#fff", cursor: loading ? "not-allowed" : "pointer",
              fontSize: "14px", fontWeight: 600,
            }}
          >
            {loading ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

async function downloadMembersExcel(statusFilter: string, classFilter: string) {
  const { getToken } = await import("@/lib/token");
  const API_BASE = import.meta.env.VITE_API_BASE as string;
  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (classFilter) params.set("class_id", classFilter);
  const token = getToken();
  const res = await fetch(`${API_BASE}/admin/members/export?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? body.error ?? `서버 오류 (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = cd.match(/filename="?([^"]+)"?/);
  a.download = match?.[1] ?? `SWIMNOTE_회원목록_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MembersPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [excelLoading, setExcelLoading] = useState(false);

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [classFilter, setClassFilter] = useState("");
  const [page, setPage] = useState(1);

  // UI state
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; name: string } | null>(null);

  // Fetch all students
  const { data: allStudents = [], isLoading, isError, refetch } = useQuery<Student[]>({
    queryKey: ["students"],
    queryFn: () => api.get<Student[]>("/students?pool_all=true"),
    staleTime: 30_000,
  });

  // Fetch class groups for filter + edit
  const { data: classGroups = [] } = useQuery<ClassGroup[]>({
    queryKey: ["class-groups"],
    queryFn: () => api.get<ClassGroup[]>("/class-groups"),
    staleTime: 120_000,
  });

  // Client-side filtering
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allStudents.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (classFilter && s.class_group_id !== classFilter && s.class_group_name !== classFilter) return false;
      if (q) {
        const inName = s.name.toLowerCase().includes(q);
        const inPhone = (s.phone ?? "").replace(/-/g, "").includes(q.replace(/-/g, ""));
        if (!inName && !inPhone) return false;
      }
      return true;
    });
  }, [allStudents, search, statusFilter, classFilter]);

  // Reset page when filter changes
  const searchRef = useRef(search);
  useEffect(() => {
    if (searchRef.current !== search || statusFilter || classFilter) {
      setPage(1);
    }
    searchRef.current = search;
  }, [search, statusFilter, classFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Withdraw mutation
  const withdrawMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/students/${id}/withdraw`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      setWithdrawTarget(null);
      setSelectedStudent(null);
    },
  });

  const handleWithdraw = useCallback((id: string, name: string) => {
    setWithdrawTarget({ id, name });
  }, []);

  const handleEdit = useCallback((s: Student) => {
    setEditStudent(s);
  }, []);

  // Close drawer on route change handled by React unmount
  const handleDrawerClose = useCallback(() => setSelectedStudent(null), []);

  return (
    <div style={{ padding: "28px 32px", maxWidth: "1200px" }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: 0 }}>회원</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => navigate("/admin/members/withdrawn")}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "8px 14px", borderRadius: "8px",
              border: "1px solid #E5E7EB", background: "#fff",
              fontSize: "13px", color: "#374151", cursor: "pointer",
            }}
          >
            <RefreshCw size={13} /> 지난 회원
          </button>
          <button
            disabled={excelLoading}
            onClick={async () => {
              setExcelLoading(true);
              try { await downloadMembersExcel(statusFilter, classFilter); }
              catch (e) { alert((e as Error).message ?? "Excel 다운로드에 실패했습니다."); }
              finally { setExcelLoading(false); }
            }}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "8px 14px", borderRadius: "8px",
              border: "1px solid #E5E7EB", background: excelLoading ? "#F9FAFB" : "#fff",
              fontSize: "13px", color: excelLoading ? "#9CA3AF" : "#374151",
              cursor: excelLoading ? "not-allowed" : "pointer",
            }}
          >
            <Download size={13} /> {excelLoading ? "다운로드 중…" : "Excel"}
          </button>
          <button
            onClick={() => navigate("/admin/members/new")}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "8px 14px", borderRadius: "8px",
              border: "none", background: "var(--x-primary, #1E6FD9)",
              fontSize: "13px", color: "#fff", cursor: "pointer", fontWeight: 600,
            }}
          >
            + 회원 등록
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1", minWidth: "220px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#9CA3AF" }} />
          <input
            placeholder="이름 또는 전화번호 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "8px 10px 8px 32px", borderRadius: "8px",
              border: "1px solid #D1D5DB", fontSize: "13px", boxSizing: "border-box", outline: "none",
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", display: "flex" }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "13px", background: "#fff", cursor: "pointer" }}
        >
          <option value="">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Class filter */}
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "13px", background: "#fff", cursor: "pointer" }}
        >
          <option value="">전체 반</option>
          {classGroups.map((cg) => (
            <option key={cg.id} value={cg.id}>{cg.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {isError ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#DC2626", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={24} />
            <div style={{ fontSize: "14px" }}>회원 목록을 불러오지 못했습니다.</div>
            <button onClick={() => refetch()} style={{ marginTop: "4px", padding: "6px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: "13px" }}>
              다시 시도
            </button>
          </div>
        ) : isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#9CA3AF", fontSize: "14px" }}>
            불러오는 중…
          </div>
        ) : paged.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#9CA3AF", fontSize: "14px" }}>
            {search || statusFilter || classFilter
              ? "검색 결과가 없습니다."
              : "등록된 회원이 없습니다."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #E5E7EB" }}>
                {["이름", "반", "상태", "보호자", "연락처", "등록일", "관리"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 14px",
                      textAlign: "left",
                      fontWeight: 600,
                      color: "#6B7280",
                      fontSize: "12px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((s, idx) => (
                <tr
                  key={s.id}
                  onClick={() => setSelectedStudent(s)}
                  style={{
                    borderBottom: idx < paged.length - 1 ? "1px solid #F3F4F6" : "none",
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <td style={{ padding: "10px 14px", fontWeight: 600, color: "#111827" }}>
                    {s.name}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#374151" }}>
                    {s.class_group_name ?? "—"}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <StatusBadge status={s.status} />
                  </td>
                  <td style={{ padding: "10px 14px", color: "#374151" }}>
                    {s.parent_name ?? "—"}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#374151" }}>
                    {s.phone ?? s.parent_phone ?? "—"}
                  </td>
                  <td style={{ padding: "10px 14px", color: "#6B7280" }}>
                    {s.created_at ? new Date(s.created_at).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" }) : "—"}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedStudent(s); }}
                      style={{
                        padding: "4px 10px", borderRadius: "6px",
                        border: "1px solid #E5E7EB", background: "#fff",
                        fontSize: "12px", color: "#374151", cursor: "pointer",
                      }}
                    >
                      보기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px",
              borderTop: "1px solid #F3F4F6",
              fontSize: "13px", color: "#6B7280",
            }}
          >
            <span>
              {filtered.length}명 중 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}명
            </span>
            <div style={{ display: "flex", gap: "4px" }}>
              <PaginationBtn disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={14} />
              </PaginationBtn>
              <span style={{ padding: "4px 10px", fontWeight: 600, color: "#111827" }}>
                {page} / {totalPages}
              </span>
              <PaginationBtn disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight size={14} />
              </PaginationBtn>
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <MemberDrawer
        student={selectedStudent}
        onViewDiary={(sid) => navigate(`/admin/diary?student_id=${sid}`)}
        classGroups={classGroups}
        onClose={handleDrawerClose}
        onWithdraw={handleWithdraw}
        onEdit={(s) => { handleEdit(s); setSelectedStudent(null); }}
      />

      {/* Edit Modal */}
      {editStudent && (
        <EditModal
          student={editStudent}
          classGroups={classGroups}
          onClose={() => setEditStudent(null)}
          onSaved={() => setEditStudent(null)}
        />
      )}

      {/* Withdraw Confirm */}
      {withdrawTarget && (
        <ConfirmDialog
          title="퇴원 처리"
          message={`${withdrawTarget.name} 회원을 퇴원 처리합니다.\n퇴원 후 지난 회원에서 다시 조회할 수 있습니다.`}
          confirmLabel="퇴원 처리"
          danger
          loading={withdrawMutation.isPending}
          onConfirm={() => withdrawMutation.mutate(withdrawTarget.id)}
          onCancel={() => setWithdrawTarget(null)}
        />
      )}
    </div>
  );
}

function PaginationBtn({ children, disabled, onClick }: { children: React.ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 8px", borderRadius: "6px",
        border: "1px solid #E5E7EB", background: disabled ? "#F9FAFB" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? "#D1D5DB" : "#374151",
        display: "flex", alignItems: "center",
      }}
    >
      {children}
    </button>
  );
}
