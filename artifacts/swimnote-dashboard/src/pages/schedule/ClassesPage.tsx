import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  teacher_user_id: string | null;
  capacity: number | null;
  student_count: number;
  level: string | null;
  description: string | null;
  co_teacher_ids: string[] | null;
  is_deleted: boolean;
}

interface Teacher {
  id: string;
  name: string;
}

interface Student {
  id: string;
  name: string;
  class_group_id?: string;
  class_group_name?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_OPTIONS = ["월", "화", "수", "목", "금", "토", "일"];

function displayTime(t: string) {
  return t?.replace(/\s*-\s*/, "–") ?? "";
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return (e as ApiError).message;
  return "오류가 발생했습니다.";
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

function FilterSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px",
        fontSize: "13px", color: value ? "#1D4E8F" : "#64748B", background: "#fff",
        cursor: "pointer",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── ClassForm ────────────────────────────────────────────────────────────────

function ClassForm({
  initial,
  teachers,
  onSubmit,
  onCancel,
  loading,
  error,
}: {
  initial?: Partial<ClassGroup>;
  teachers: Teacher[];
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  loading: boolean;
  error: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [days, setDays] = useState<string[]>(
    initial?.schedule_days ? initial.schedule_days.split("") : []
  );
  const [time, setTime] = useState(initial?.schedule_time ?? "");
  const [instructor, setInstructor] = useState(initial?.instructor ?? "");
  const [teacherId, setTeacherId] = useState(initial?.teacher_user_id ?? "");
  const [capacity, setCapacity] = useState<string>(
    initial?.capacity != null ? String(initial.capacity) : ""
  );
  const [level, setLevel] = useState(initial?.level ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  function toggleDay(d: string) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  const orderedDays = DAY_OPTIONS.filter((d) => days.includes(d)).join("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderedDays) { alert("요일을 선택해주세요."); return; }
    if (!time.trim()) { alert("시간을 입력해주세요."); return; }
    onSubmit({
      name: name.trim() || undefined,
      schedule_days: orderedDays,
      schedule_time: time.trim(),
      instructor: instructor.trim() || undefined,
      teacher_user_id: teacherId || undefined,
      capacity: capacity ? parseInt(capacity) : undefined,
      level: level.trim() || undefined,
      description: description.trim() || undefined,
    });
  }

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1",
    borderRadius: "6px", fontSize: "13px", boxSizing: "border-box",
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div>
        <label style={labelStyle}>반 이름</label>
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 초급 A반" />
      </div>

      <div>
        <label style={labelStyle}>요일 <span style={{ color: "#EF4444" }}>*</span></label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              style={{
                padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "13px",
                border: days.includes(d) ? "2px solid #1D4E8F" : "1px solid #CBD5E1",
                background: days.includes(d) ? "#EEF4FB" : "#fff",
                color: days.includes(d) ? "#1D4E8F" : "#64748B",
                fontWeight: days.includes(d) ? 600 : 400,
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>시간 <span style={{ color: "#EF4444" }}>*</span></label>
        <input
          style={inputStyle}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="예: 15:00-15:50"
        />
        <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "3px" }}>형식: 15:00-15:50</div>
      </div>

      <div>
        <label style={labelStyle}>담당 선생님</label>
        <select
          value={teacherId}
          onChange={(e) => setTeacherId(e.target.value)}
          style={{ ...inputStyle, background: "#fff", cursor: "pointer" }}
        >
          <option value="">선택 안 함</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {!teacherId && (
          <div style={{ marginTop: "6px" }}>
            <label style={{ ...labelStyle, marginBottom: "2px" }}>직접 입력 (이름만)</label>
            <input
              style={inputStyle}
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
              placeholder="선생님 이름"
            />
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <div>
          <label style={labelStyle}>정원</label>
          <input
            type="number"
            min={1}
            style={inputStyle}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="예: 5"
          />
        </div>
        <div>
          <label style={labelStyle}>레벨</label>
          <input style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)} placeholder="예: 초급" />
        </div>
      </div>

      <div>
        <label style={labelStyle}>메모</label>
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: "60px" }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="반에 대한 추가 정보"
        />
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", paddingTop: "4px" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          style={{
            padding: "8px 16px", background: "#fff", border: "1px solid #CBD5E1",
            borderRadius: "6px", cursor: "pointer", fontSize: "13px",
          }}
        >
          취소
        </button>
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "8px 16px", background: loading ? "#93A8C4" : "#1D4E8F",
            color: "#fff", border: "none", borderRadius: "6px",
            cursor: loading ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600,
          }}
        >
          {loading ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

// ─── ClassDrawer ──────────────────────────────────────────────────────────────

function ClassDrawer({
  mode,
  cls,
  teachers,
  students,
  studentsLoading,
  onClose,
  onEdit,
  onDelete,
}: {
  mode: "detail" | "edit" | "create";
  cls: ClassGroup | null;
  teachers: Teacher[];
  students: Student[];
  studentsLoading: boolean;
  onClose: () => void;
  onEdit: (cls: ClassGroup) => void;
  onDelete: (cls: ClassGroup) => void;
}) {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(mode === "create");
  const [formError, setFormError] = useState("");

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/class-groups", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-groups"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onClose();
    },
    onError: (e) => setFormError(errMsg(e)),
  });

  const editMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/class-groups/${cls?.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-groups"] });
      onClose();
    },
    onError: (e) => setFormError(errMsg(e)),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setEditMode(mode === "create");
    setFormError("");
  }, [mode, cls]);

  const teacherMap: Record<string, string> = {};
  for (const t of teachers) teacherMap[t.id] = t.name;

  const classStudents = cls ? students.filter((s) => s.class_group_id === cls.id) : [];

  const isCreate = mode === "create" || (!cls && editMode);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "400px",
        background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        zIndex: 50, display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "20px", borderBottom: "1px solid #E2E8F0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B" }}>
            {isCreate ? "반 등록" : editMode ? "반 수정" : cls?.name}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {!isCreate && cls && !editMode && (
              <>
                <button
                  onClick={() => { setEditMode(true); setFormError(""); }}
                  style={{ padding: "5px 10px", background: "#F1F5F9", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}
                >
                  수정
                </button>
                <button
                  onClick={() => onDelete(cls)}
                  style={{ padding: "5px 10px", background: "#FEF2F2", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px", color: "#DC2626" }}
                >
                  삭제
                </button>
              </>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#64748B", lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {(isCreate || editMode) ? (
            <ClassForm
              initial={cls ?? undefined}
              teachers={teachers}
              onSubmit={(data) => {
                setFormError("");
                isCreate ? createMut.mutate(data) : editMut.mutate(data);
              }}
              onCancel={() => {
                if (isCreate) onClose();
                else { setEditMode(false); setFormError(""); }
              }}
              loading={createMut.isPending || editMut.isPending}
              error={formError}
            />
          ) : cls ? (
            <>
              <DetailRow label="요일" value={cls.schedule_days || "—"} />
              <DetailRow label="시간" value={displayTime(cls.schedule_time) || "—"} />
              <DetailRow
                label="담당 선생님"
                value={cls.instructor || (cls.teacher_user_id ? teacherMap[cls.teacher_user_id] : null) || "—"}
              />
              <DetailRow
                label="인원 / 정원"
                value={
                  cls.capacity != null
                    ? `${cls.student_count} / ${cls.capacity}명`
                    : `${cls.student_count}명`
                }
              />
              {cls.level && <DetailRow label="레벨" value={cls.level} />}
              {cls.description && <DetailRow label="메모" value={cls.description} />}
              <DetailRow label="상태" value={cls.is_deleted ? "비활성" : "운영 중"} />

              <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #F1F5F9" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#1E293B", marginBottom: "10px" }}>
                  배정 회원 {studentsLoading ? "" : `(${classStudents.length}명)`}
                </div>
                {studentsLoading ? (
                  <div style={{ color: "#94A3B8", fontSize: "13px" }}>로딩 중…</div>
                ) : classStudents.length === 0 ? (
                  <div style={{ color: "#94A3B8", fontSize: "13px" }}>배정된 회원이 없습니다.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {classStudents.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          padding: "6px 10px", background: "#F8FAFC",
                          borderRadius: "4px", fontSize: "13px", color: "#1E293B",
                        }}
                      >
                        {s.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "#1E293B" }}>{value}</div>
    </div>
  );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  loading,
  error,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
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
              padding: "8px 16px",
              background: loading ? "#D1D5DB" : danger ? "#DC2626" : "#1D4E8F",
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

// ─── ClassesPage ──────────────────────────────────────────────────────────────

export default function ClassesPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const [filterTeacher, setFilterTeacher] = useState("");
  const [drawerMode, setDrawerMode] = useState<"detail" | "edit" | "create" | null>(null);
  const [activeClass, setActiveClass] = useState<ClassGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClassGroup | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const { data: classes = [], isLoading: clsLoading, isError: clsError } = useQuery<ClassGroup[]>({
    queryKey: ["class-groups"],
    queryFn: () => api.get("/class-groups"),
  });

  const { data: teachers = [] } = useQuery<Teacher[]>({
    queryKey: ["teachers"],
    queryFn: () => api.get("/teachers"),
  });

  const { data: allStudents = [], isLoading: studentsLoading } = useQuery<Student[]>({
    queryKey: ["students"],
    queryFn: () => api.get("/students?pool_all=true"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/class-groups/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["class-groups"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setDeleteTarget(null);
      setDrawerMode(null);
      setActiveClass(null);
    },
    onError: (e) => setDeleteError(errMsg(e)),
  });

  const teacherMap: Record<string, string> = {};
  for (const t of teachers) teacherMap[t.id] = t.name;

  const active = classes.filter((c) => !c.is_deleted);

  const filtered = active.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      const teacher = c.instructor || (c.teacher_user_id ? teacherMap[c.teacher_user_id] : "") || "";
      if (!c.name?.toLowerCase().includes(q) && !teacher.toLowerCase().includes(q)) return false;
    }
    if (filterDay && !c.schedule_days?.includes(filterDay)) return false;
    if (filterTeacher && c.teacher_user_id !== filterTeacher) return false;
    return true;
  });

  const dayOptions = DAY_OPTIONS.map((d) => ({ value: d, label: `${d}요일` }));
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.name }));

  function openCreate() {
    setActiveClass(null);
    setDrawerMode("create");
  }

  function openDetail(cls: ClassGroup) {
    setActiveClass(cls);
    setDrawerMode("detail");
  }

  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>반 관리</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            운영 중 {active.length}개
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => navigate("/admin/schedule")}
            style={{ padding: "7px 12px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#475569" }}
          >
            ← 전체 스케줄
          </button>
          <button
            onClick={openCreate}
            style={{ padding: "7px 14px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
          >
            + 반 등록
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="반 이름 또는 선생님 검색…"
          style={{
            padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px",
            fontSize: "13px", width: "200px",
          }}
        />
        <FilterSelect value={filterDay} options={dayOptions} onChange={setFilterDay} placeholder="요일" />
        <FilterSelect value={filterTeacher} options={teacherOptions} onChange={setFilterTeacher} placeholder="선생님" />
        {(search || filterDay || filterTeacher) && (
          <button
            onClick={() => { setSearch(""); setFilterDay(""); setFilterTeacher(""); }}
            style={{ padding: "6px 10px", background: "none", border: "1px solid #E2E8F0", borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#64748B" }}
          >
            초기화
          </button>
        )}
      </div>

      {/* Table */}
      {clsError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>불러오지 못했습니다.</div>
      ) : clsLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>등록된 반이 없습니다.</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["반 이름", "요일", "시간", "담당 선생님", "인원 / 정원", "레벨", "관리"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((cls, i) => {
                const teacher = cls.instructor || (cls.teacher_user_id ? teacherMap[cls.teacher_user_id] : null);
                const full = cls.capacity != null && cls.student_count >= cls.capacity;
                return (
                  <tr
                    key={cls.id}
                    style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA", cursor: "pointer" }}
                    onClick={() => openDetail(cls)}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#F0F7FF")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "#fff" : "#FAFAFA")}
                  >
                    <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>
                      {cls.name || `${cls.schedule_days} ${cls.schedule_time}반`}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>
                      {cls.schedule_days || "—"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>
                      {displayTime(cls.schedule_time) || "—"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>
                      {teacher || "—"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ color: full ? "#DC2626" : "#475569", fontWeight: full ? 600 : 400 }}>
                        {cls.student_count}
                        {cls.capacity != null ? ` / ${cls.capacity}` : ""}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: "13px", color: "#475569", borderBottom: "1px solid #F1F5F9" }}>
                      {cls.level || "—"}
                    </td>
                    <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); openDetail(cls); }}
                        style={{ padding: "4px 10px", background: "#F1F5F9", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "12px", color: "#475569" }}
                      >
                        상세
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer */}
      {drawerMode && (
        <ClassDrawer
          mode={drawerMode}
          cls={activeClass}
          teachers={teachers}
          students={allStudents}
          studentsLoading={studentsLoading}
          onClose={() => { setDrawerMode(null); setActiveClass(null); }}
          onEdit={(cls) => { setActiveClass(cls); setDrawerMode("edit"); }}
          onDelete={(cls) => { setDeleteTarget(cls); setDeleteError(""); }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmModal
          title={`"${deleteTarget.name || deleteTarget.schedule_days + " " + deleteTarget.schedule_time + "반"}" 삭제`}
          body={`이 반을 삭제하면 배정된 회원 연결이 해제됩니다. 계속하시겠습니까?`}
          confirmLabel="반 삭제"
          danger
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          onCancel={() => { setDeleteTarget(null); setDeleteError(""); }}
          loading={deleteMut.isPending}
          error={deleteError}
        />
      )}
    </div>
  );
}
