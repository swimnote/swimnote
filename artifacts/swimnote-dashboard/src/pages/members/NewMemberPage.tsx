import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api-client";
import { AlertCircle, ChevronLeft } from "lucide-react";

type ClassGroup = {
  id: string;
  name: string;
};

type CreateStudentBody = {
  name: string;
  phone?: string;
  birth_year?: number;
  birth_date?: string;
  parent_name?: string;
  parent_phone?: string;
  class_group_id?: string;
  memo?: string;
  registration_path: "admin_created";
};

export default function NewMemberPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    birth_year: "",
    parent_name: "",
    parent_phone: "",
    class_group_id: "",
    memo: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { data: classGroups = [] } = useQuery<ClassGroup[]>({
    queryKey: ["class-groups"],
    queryFn: () => api.get<ClassGroup[]>("/class-groups"),
    staleTime: 120_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateStudentBody) => api.post("/students", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      setSuccess(true);
    },
    onError: (e: ApiError) => {
      setError(e.message ?? "등록 중 오류가 발생했습니다.");
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("이름은 필수 항목입니다.");
      return;
    }
    const body: CreateStudentBody = {
      name: form.name.trim(),
      registration_path: "admin_created",
      phone: form.phone.trim() || undefined,
      birth_year: form.birth_year ? Number(form.birth_year) : undefined,
      parent_name: form.parent_name.trim() || undefined,
      parent_phone: form.parent_phone.trim() || undefined,
      class_group_id: form.class_group_id || undefined,
      memo: form.memo.trim() || undefined,
    };
    createMutation.mutate(body);
  }

  if (success) {
    return (
      <div style={{ padding: "48px 32px", maxWidth: "480px", textAlign: "center" }}>
        <div style={{
          width: "56px", height: "56px", borderRadius: "50%",
          background: "#DCFCE7", display: "flex", alignItems: "center",
          justifyContent: "center", margin: "0 auto 16px", fontSize: "24px",
        }}>
          ✓
        </div>
        <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>
          회원이 등록되었습니다
        </h2>
        <p style={{ fontSize: "14px", color: "#6B7280", margin: "0 0 24px" }}>
          회원 목록에서 바로 확인할 수 있습니다.
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
          <button
            onClick={() => {
              setForm({ name: "", phone: "", birth_year: "", parent_name: "", parent_phone: "", class_group_id: "", memo: "" });
              setSuccess(false);
              setError(null);
            }}
            style={{ padding: "9px 18px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: "14px" }}
          >
            추가 등록
          </button>
          <button
            onClick={() => navigate("/admin/members")}
            style={{ padding: "9px 18px", borderRadius: "8px", border: "none", background: "var(--x-primary, #1E6FD9)", color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 600 }}
          >
            회원 목록
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: "560px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
        <button
          onClick={() => navigate("/admin/members")}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6B7280", display: "flex", padding: "4px" }}
        >
          <ChevronLeft size={20} />
        </button>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: 0 }}>
          회원 등록
        </h1>
      </div>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          background: "#FEF2F2", color: "#DC2626",
          padding: "12px 16px", borderRadius: "10px",
          fontSize: "14px", marginBottom: "16px",
        }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: "12px",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          <FormField label="이름 *">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="홍길동"
              required
              style={inputStyle}
            />
          </FormField>

          <FormField label="전화번호">
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="010-0000-0000"
              type="tel"
              style={inputStyle}
            />
          </FormField>

          <FormField label="생년">
            <input
              value={form.birth_year}
              onChange={(e) => setForm((f) => ({ ...f, birth_year: e.target.value }))}
              placeholder="예: 2010"
              type="number"
              min={1950}
              max={new Date().getFullYear()}
              style={inputStyle}
            />
          </FormField>

          <div style={{ height: "1px", background: "#F3F4F6" }} />

          <FormField label="보호자명">
            <input
              value={form.parent_name}
              onChange={(e) => setForm((f) => ({ ...f, parent_name: e.target.value }))}
              placeholder="홍부모"
              style={inputStyle}
            />
          </FormField>

          <FormField label="보호자 연락처">
            <input
              value={form.parent_phone}
              onChange={(e) => setForm((f) => ({ ...f, parent_phone: e.target.value }))}
              placeholder="010-0000-0000"
              type="tel"
              style={inputStyle}
            />
          </FormField>

          <div style={{ height: "1px", background: "#F3F4F6" }} />

          <FormField label="수강 반">
            <select
              value={form.class_group_id}
              onChange={(e) => setForm((f) => ({ ...f, class_group_id: e.target.value }))}
              style={{ ...inputStyle, background: "#fff", cursor: "pointer" }}
            >
              <option value="">반 선택 (선택사항)</option>
              {classGroups.map((cg) => (
                <option key={cg.id} value={cg.id}>{cg.name}</option>
              ))}
            </select>
          </FormField>

          <FormField label="메모">
            <textarea
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              placeholder="특이사항, 알레르기 등"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </FormField>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <button
            type="button"
            onClick={() => navigate("/admin/members")}
            style={{ flex: 1, padding: "11px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontSize: "14px" }}
          >
            취소
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            style={{
              flex: 2, padding: "11px", borderRadius: "8px", border: "none",
              background: createMutation.isPending ? "#9CA3AF" : "var(--x-primary, #1E6FD9)",
              color: "#fff",
              cursor: createMutation.isPending ? "not-allowed" : "pointer",
              fontSize: "14px", fontWeight: 600,
            }}
          >
            {createMutation.isPending ? "등록 중…" : "회원 등록"}
          </button>
        </div>
      </form>
    </div>
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

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: "13px",
          fontWeight: 500,
          color: "#374151",
          marginBottom: "6px",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
