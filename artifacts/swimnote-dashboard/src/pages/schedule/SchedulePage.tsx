import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api-client";

// ─── Student Detail Types ──────────────────────────────────────────────────

interface ClassStudent {
  id: string;
  name: string;
  status: string;
  has_makeup: boolean;
}

interface StudentDetail {
  id: string;
  name: string;
  status: string;
  phone?: string;
  birth_year?: number;
  birth_date?: string;
  memo?: string;
  notes?: string;
  class_name?: string;
  class_schedule_days?: string;
  class_schedule_time?: string;
  teacher_name?: string;
  parent_account_name?: string;
  created_at?: string;
}

const STUDENT_STATUS_LABEL: Record<string, string> = {
  active: "재원", suspended: "연기", withdrawn: "퇴원",
  inactive: "비활성", pending: "대기", archived: "탈퇴",
};
const STUDENT_STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  active:    { bg: "#DCFCE7", color: "#166534" },
  suspended: { bg: "#FEF9C3", color: "#854D0E" },
  withdrawn: { bg: "#FEE2E2", color: "#991B1B" },
  inactive:  { bg: "#F3F4F6", color: "#374151" },
  pending:   { bg: "#E0F2FE", color: "#0369A1" },
  archived:  { bg: "#F3F4F6", color: "#6B7280" },
};

function StudentBadge({ status }: { status: string }) {
  const label = STUDENT_STATUS_LABEL[status] ?? status;
  const { bg, color } = STUDENT_STATUS_COLOR[status] ?? { bg: "#F3F4F6", color: "#374151" };
  return (
    <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: bg, color }}>
      {label}
    </span>
  );
}

// ─── StudentInfoDrawer ────────────────────────────────────────────────────────

function StudentInfoDrawer({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const { data, isLoading, isError } = useQuery<StudentDetail>({
    queryKey: ["student-detail", studentId],
    queryFn: () => api.get(`/admin/students/${studentId}/detail`).then((r: any) => r.student ?? r),
    staleTime: 60_000,
  });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.15)", zIndex: 200 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "360px",
        background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.14)",
        zIndex: 201, display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "18px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#1E293B" }}>
            {isLoading ? "로딩 중…" : data?.name ?? "회원 정보"}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#64748B", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {isLoading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#94A3B8", fontSize: "13px" }}>로딩 중…</div>
          ) : isError || !data ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#EF4444", fontSize: "13px" }}>불러오지 못했습니다.</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B" }}>{data.name}</span>
                <StudentBadge status={data.status} />
              </div>
              <InfoRow label="연락처" value={data.phone} />
              <InfoRow label="생년" value={data.birth_year ? `${data.birth_year}년생` : data.birth_date} />
              <InfoRow label="등록일" value={data.created_at ? new Date(data.created_at).toLocaleDateString("ko-KR") : undefined} />
              {(data.class_name || data.class_schedule_days) && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>수강반</div>
                  <div style={{ padding: "10px 12px", background: "#F8FAFC", borderRadius: "6px", border: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#1E293B", marginBottom: "2px" }}>{data.class_name}</div>
                    {(data.class_schedule_days || data.class_schedule_time) && (
                      <div style={{ fontSize: "12px", color: "#64748B" }}>
                        {[data.class_schedule_days, data.class_schedule_time].filter(Boolean).join(" ")}
                      </div>
                    )}
                    {data.teacher_name && (
                      <div style={{ fontSize: "12px", color: "#64748B" }}>담당: {data.teacher_name}</div>
                    )}
                  </div>
                </div>
              )}
              <InfoRow label="보호자" value={data.parent_account_name} />
              {(data.memo || data.notes) && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "4px" }}>메모</div>
                  <div style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {data.memo || data.notes}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "#1E293B" }}>{String(value)}</div>
    </div>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string; // e.g. "월수금", "화목"
  schedule_time: string; // e.g. "15:00-15:50"
  instructor: string | null;
  teacher_user_id: string | null;
  capacity: number | null;
  student_count: number;
  level: string | null;
  color: string | null;
  is_deleted: boolean;
}

interface Teacher {
  id: string;
  name: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
type Day = (typeof DAYS)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseStartTime(time: string): number {
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 9999;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

function classHasDay(cls: ClassGroup, day: Day): boolean {
  if (!cls.schedule_days) return false;
  return cls.schedule_days.split(",").map((d) => d.trim()).includes(day);
}

function displayTime(time: string): string {
  if (!time) return "";
  return time.replace(/\s*-\s*/, "–");
}

// ─── ClassBlock ───────────────────────────────────────────────────────────────

function ClassBlock({
  cls,
  teacherMap,
  onClick,
}: {
  cls: ClassGroup;
  teacherMap: Record<string, string>;
  onClick: () => void;
}) {
  const full = cls.capacity != null && cls.student_count >= cls.capacity;
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        background: "#F8FAFC",
        border: "1px solid #E2E8F0",
        borderLeft: "3px solid var(--x-primary, #1D4E8F)",
        borderRadius: "4px",
        padding: "6px 8px",
        textAlign: "left",
        cursor: "pointer",
        marginBottom: "4px",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#EEF4FB")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#F8FAFC")}
    >
      <div style={{ fontSize: "12px", fontWeight: 600, color: "#1E293B", marginBottom: "2px" }}>
        {cls.name}
      </div>
      <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "1px" }}>
        {displayTime(cls.schedule_time)}
      </div>
      {(cls.instructor || (cls.teacher_user_id && teacherMap[cls.teacher_user_id])) && (
        <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "1px" }}>
          {cls.instructor || teacherMap[cls.teacher_user_id!]}
        </div>
      )}
      <div
        style={{
          fontSize: "11px",
          color: full ? "#DC2626" : "#64748B",
          fontWeight: full ? 600 : 400,
        }}
      >
        {cls.student_count}
        {cls.capacity != null ? ` / ${cls.capacity}` : ""}명
      </div>
    </button>
  );
}

// ─── ClassDetailDrawer ────────────────────────────────────────────────────────

function ClassDetailDrawer({
  cls,
  teacherMap,
  onClose,
  onNavigate,
}: {
  cls: ClassGroup | null;
  teacherMap: Record<string, string>;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!cls) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cls, onClose]);

  // 반 선택 시 학생 목록 로드
  const { data: classDetail, isLoading: studentsLoading } = useQuery<{
    class_group: unknown;
    students: ClassStudent[];
  }>({
    queryKey: ["class-group-detail", cls?.id],
    queryFn: () => api.get(`/admin/class-groups/${cls!.id}/detail`),
    enabled: !!cls,
    staleTime: 60_000,
  });

  if (!cls) return null;

  const teacherName = cls.instructor || (cls.teacher_user_id ? teacherMap[cls.teacher_user_id] : null);
  const full = cls.capacity != null && cls.student_count >= cls.capacity;
  const students = classDetail?.students ?? [];

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40,
        }}
      />
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "340px",
          background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
          zIndex: 50, display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ padding: "20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B" }}>{cls.name}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#64748B", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "20px", flex: 1, overflowY: "auto" }}>
          <Row label="요일" value={cls.schedule_days || "—"} />
          <Row label="시간" value={displayTime(cls.schedule_time) || "—"} />
          <Row label="담당 선생님" value={teacherName || "—"} />
          <Row label="현재 인원 / 정원" value={
            cls.capacity != null
              ? <span style={{ color: full ? "#DC2626" : "#1E293B", fontWeight: full ? 600 : 400 }}>{cls.student_count} / {cls.capacity}명</span>
              : `${cls.student_count}명`
          } />
          {cls.level && <Row label="레벨" value={cls.level} />}
          <Row label="상태" value={cls.is_deleted ? "비활성" : "운영 중"} />

          {/* 학생 명단 */}
          <div style={{ marginTop: "4px" }}>
            <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              수강 회원 명단
            </div>
            {studentsLoading ? (
              <div style={{ fontSize: "13px", color: "#94A3B8" }}>로딩 중…</div>
            ) : students.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#94A3B8" }}>등록된 회원이 없습니다.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {students.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStudentId(s.id)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 10px", borderRadius: "6px",
                      border: "1px solid #E2E8F0", background: "#F8FAFC",
                      cursor: "pointer", textAlign: "left", transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#EEF4FB")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#F8FAFC")}
                  >
                    <span style={{ fontSize: "13px", fontWeight: 500, color: "#1E293B" }}>{s.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {s.has_makeup && (
                        <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "8px", background: "#FEF9C3", color: "#92400E", fontWeight: 600 }}>
                          보강
                        </span>
                      )}
                      <StudentBadge status={s.status} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: "16px 20px", borderTop: "1px solid #E2E8F0" }}>
          <button
            onClick={() => onNavigate(cls.id)}
            style={{
              width: "100%", padding: "10px", background: "var(--x-primary, #1D4E8F)",
              color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer",
              fontSize: "13px", fontWeight: 600,
            }}
          >
            반 관리에서 보기
          </button>
        </div>
      </div>

      {/* 회원 정보 드로어 (학생 이름 클릭 시) */}
      {selectedStudentId && (
        <StudentInfoDrawer
          studentId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "#1E293B" }}>{value}</div>
    </div>
  );
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "6px 10px", background: "#fff", border: "1px solid #CBD5E1",
          borderRadius: "6px", cursor: "pointer", fontSize: "13px",
          color: value ? "#1D4E8F" : "#64748B", display: "flex", alignItems: "center", gap: "4px",
        }}
      >
        {value ? `${label}: ${selected?.label}` : label}
        <span style={{ fontSize: "10px" }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
            background: "#fff", border: "1px solid #E2E8F0", borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)", minWidth: "160px",
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={{
                display: "block", width: "100%", padding: "8px 12px",
                background: o.value === value ? "#EEF4FB" : "none",
                border: "none", cursor: "pointer", fontSize: "13px",
                color: o.value === value ? "#1D4E8F" : "#1E293B",
                textAlign: "left",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SchedulePage ─────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [, navigate] = useLocation();
  const [filterTeacher, setFilterTeacher] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [selected, setSelected] = useState<ClassGroup | null>(null);

  const { data: classes = [], isLoading: clsLoading, isError: clsError } = useQuery<ClassGroup[]>({
    queryKey: ["class-groups"],
    queryFn: () => api.get("/class-groups"),
  });

  const { data: teachers = [] } = useQuery<Teacher[]>({
    queryKey: ["teachers"],
    queryFn: () => api.get("/teachers"),
  });

  const teacherMap: Record<string, string> = {};
  for (const t of teachers) teacherMap[t.id] = t.name;

  // Active classes only
  const active = classes.filter((c) => !c.is_deleted);

  // Filter
  const filtered = active.filter((c) => {
    if (filterTeacher && c.teacher_user_id !== filterTeacher) return false;
    if (filterClass && c.id !== filterClass) return false;
    return true;
  });

  // Determine which days are actually in use
  const usedDays = DAYS.filter((d) => filtered.some((c) => classHasDay(c, d)));
  const displayDays = usedDays.length > 0 ? usedDays : DAYS.slice(0, 6);

  // Group by day then sort by start time
  const byDay: Record<string, ClassGroup[]> = {};
  for (const d of displayDays) {
    byDay[d] = filtered.filter((c) => classHasDay(c, d)).sort(
      (a, b) => parseStartTime(a.schedule_time) - parseStartTime(b.schedule_time)
    );
  }

  const teacherOptions = [
    { value: "", label: "전체 선생님" },
    ...teachers.map((t) => ({ value: t.id, label: t.name })),
  ];
  const classOptions = [
    { value: "", label: "전체 반" },
    ...active.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>전체 스케줄</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            {filtered.length}개 수업
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <FilterDropdown
            label="선생님"
            value={filterTeacher}
            options={teacherOptions}
            onChange={setFilterTeacher}
          />
          <FilterDropdown
            label="반"
            value={filterClass}
            options={classOptions}
            onChange={setFilterClass}
          />
          {(filterTeacher || filterClass) && (
            <button
              onClick={() => { setFilterTeacher(""); setFilterClass(""); }}
              style={{
                padding: "6px 10px", background: "none", border: "1px solid #E2E8F0",
                borderRadius: "6px", cursor: "pointer", fontSize: "13px", color: "#64748B",
              }}
            >
              전체
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {clsError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>불러오지 못했습니다.</div>
      ) : clsLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>해당 조건의 수업이 없습니다.</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${displayDays.length}, minmax(140px, 1fr))`,
            gap: "8px",
            overflowX: "auto",
          }}
        >
          {displayDays.map((day) => (
            <div key={day}>
              <div
                style={{
                  fontSize: "12px", fontWeight: 700, color: "#475569",
                  textAlign: "center", padding: "6px",
                  background: "#F1F5F9", borderRadius: "4px", marginBottom: "6px",
                  letterSpacing: "0.5px",
                }}
              >
                {day}요일
              </div>
              {byDay[day].length === 0 ? (
                <div style={{ fontSize: "12px", color: "#CBD5E1", textAlign: "center", padding: "12px 0" }}>—</div>
              ) : (
                byDay[day].map((cls) => (
                  <ClassBlock
                    key={cls.id}
                    cls={cls}
                    teacherMap={teacherMap}
                    onClick={() => setSelected(cls)}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      )}

      <ClassDetailDrawer
        cls={selected}
        teacherMap={teacherMap}
        onClose={() => setSelected(null)}
        onNavigate={(id) => {
          setSelected(null);
          navigate(`/admin/schedule/classes?highlight=${id}`);
        }}
      />
    </div>
  );
}
