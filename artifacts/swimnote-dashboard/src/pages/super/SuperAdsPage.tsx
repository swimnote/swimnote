/**
 * SuperAdsPage.tsx — 카드 배너 관리 (슈퍼관리자)
 * 학부모 홈 슬라이더 카드 배너 등록·수정·상태 변경·삭제
 * API: GET/POST /super/banners, PATCH /super/banners/:id/status, DELETE /super/banners/:id
 * strip(가로) 배너는 제거됨 — slider 타입만 관리
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Plus, RefreshCw, Eye, EyeOff, Clock, Trash2, X } from "lucide-react";

type AdStatus = "active" | "scheduled" | "inactive";

type Banner = {
  id: string;
  banner_type: string;
  title: string;
  description?: string;
  image_url?: string;
  image_key?: string;
  link_url?: string;
  link_label?: string;
  color_theme?: string;
  target: string;
  status: AdStatus;
  display_start: string;
  display_end: string;
  sort_order: number;
  created_at: string;
};

const STATUS_CFG: Record<AdStatus, { label: string; color: string; bg: string }> = {
  active:    { label: "노출 중", color: "#166534", bg: "#DCFCE7" },
  scheduled: { label: "예약됨", color: "#92400E", bg: "#FEF9C3" },
  inactive:  { label: "비활성", color: "#6B7280", bg: "#F3F4F6" },
};

const TARGET_LABEL: Record<string, string> = {
  all: "전체", parent: "학부모", teacher: "선생님", admin: "관리자",
};

const THEMES = ["teal", "purple", "orange", "blue", "green", "red", "pink"] as const;
const THEME_COLORS: Record<string, string> = {
  teal: "#0D9488", purple: "#7C3AED", orange: "#F97316",
  blue: "#2563EB", green: "#059669", red: "#DC2626", pink: "#DB2777",
};

const fmt = (s: string) =>
  new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });

const TODAY_ISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 16);
};
const MONTH_LATER_ISO = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 16);
};

type FormState = {
  title: string;
  description: string;
  link_url: string;
  link_label: string;
  color_theme: string;
  target: string;
  display_start: string;
  display_end: string;
  sort_order: string;
};

const defaultForm = (): FormState => ({
  title: "",
  description: "",
  link_url: "",
  link_label: "",
  color_theme: "teal",
  target: "all",
  display_start: TODAY_ISO(),
  display_end: MONTH_LATER_ISO(),
  sort_order: "0",
});

export default function SuperAdsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["super", "banners", "slider"],
    queryFn: () => api.get<{ banners: Banner[] }>("/super/banners?type=slider"),
  });
  const banners: Banner[] = data?.banners ?? [];

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/super/banners", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "banners"] }); setShowForm(false); setForm(defaultForm()); },
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AdStatus }) =>
      api.patch(`/super/banners/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super", "banners"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/super/banners/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["super", "banners"] }); setDeleteConfirm(null); },
  });

  function openCreate() {
    setForm(defaultForm());
    setShowForm(true);
  }

  function handleSubmit() {
    if (!form.title.trim()) return;
    createMut.mutate({
      banner_type: "slider",
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      link_url: form.link_url.trim() || undefined,
      link_label: form.link_label.trim() || undefined,
      color_theme: form.color_theme,
      target: form.target,
      status: "inactive",
      display_start: new Date(form.display_start).toISOString(),
      display_end: new Date(form.display_end).toISOString(),
      sort_order: Number(form.sort_order) || 0,
    });
  }

  return (
    <div style={{ padding: "32px 32px 48px", maxWidth: "900px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-strong)", margin: 0 }}>카드 배너 관리</h1>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>학부모 홈 슬라이더 카드 배너 · strip(가로) 배너는 서비스 종료</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => refetch()} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>
            <RefreshCw size={13} /> 새로고침
          </button>
          <button onClick={openCreate} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", background: "var(--x-primary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
            <Plus size={14} /> 배너 등록
          </button>
        </div>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "12px", padding: "24px", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-strong)" }}>배너 등록 (slider)</div>
            <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={labelStyle}>제목 *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={inputStyle} placeholder="배너 제목" />
            </div>
            <div>
              <label style={labelStyle}>설명</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inputStyle} placeholder="짧은 설명 (선택)" />
            </div>
            <div>
              <label style={labelStyle}>링크 URL</label>
              <input value={form.link_url} onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))} style={inputStyle} placeholder="https://..." />
            </div>
            <div>
              <label style={labelStyle}>링크 라벨</label>
              <input value={form.link_label} onChange={e => setForm(f => ({ ...f, link_label: e.target.value }))} style={inputStyle} placeholder="자세히 보기" />
            </div>
            <div>
              <label style={labelStyle}>노출 시작</label>
              <input type="datetime-local" value={form.display_start} onChange={e => setForm(f => ({ ...f, display_start: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>노출 종료</label>
              <input type="datetime-local" value={form.display_end} onChange={e => setForm(f => ({ ...f, display_end: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>대상</label>
              <select value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} style={inputStyle}>
                {Object.entries(TARGET_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>정렬 순서</label>
              <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} style={inputStyle} placeholder="0" />
            </div>
          </div>
          <div style={{ marginTop: "16px" }}>
            <label style={labelStyle}>컬러 테마</label>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {THEMES.map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, color_theme: t }))}
                  style={{ width: "32px", height: "32px", borderRadius: "50%", background: THEME_COLORS[t], border: form.color_theme === t ? "3px solid #1D4E8F" : "2px solid transparent", cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <div style={{ marginTop: "20px", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 16px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>취소</button>
            <button onClick={handleSubmit} disabled={createMut.isPending || !form.title.trim()}
              style={{ padding: "8px 20px", background: "var(--x-primary)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer", opacity: createMut.isPending ? 0.6 : 1 }}>
              {createMut.isPending ? "등록 중..." : "등록"}
            </button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
      ) : banners.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>등록된 카드 배너가 없습니다.</div>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {banners.map(b => {
            const cfg = STATUS_CFG[b.status] ?? STATUS_CFG.inactive;
            return (
              <div key={b.id} style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: THEME_COLORS[b.color_theme ?? "teal"], flexShrink: 0 }} />
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>{b.title}</span>
                      <span style={{ padding: "2px 8px", background: cfg.bg, color: cfg.color, borderRadius: "10px", fontSize: "11px", fontWeight: 600 }}>{cfg.label}</span>
                    </div>
                    {b.description && <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>{b.description}</div>}
                    <div style={{ fontSize: "11px", color: "var(--text-faint)" }}>
                      대상: {TARGET_LABEL[b.target] ?? b.target} · 기간: {fmt(b.display_start)} ~ {fmt(b.display_end)} · 순서: {b.sort_order}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    {b.status !== "active" && (
                      <button onClick={() => statusMut.mutate({ id: b.id, status: "active" })} title="활성화"
                        style={iconBtn("#DCFCE7", "#166534")}>
                        <Eye size={13} />
                      </button>
                    )}
                    {b.status === "active" && (
                      <button onClick={() => statusMut.mutate({ id: b.id, status: "inactive" })} title="비활성화"
                        style={iconBtn("#F3F4F6", "#6B7280")}>
                        <EyeOff size={13} />
                      </button>
                    )}
                    {b.status !== "scheduled" && (
                      <button onClick={() => statusMut.mutate({ id: b.id, status: "scheduled" })} title="예약으로 전환"
                        style={iconBtn("#FEF9C3", "#92400E")}>
                        <Clock size={13} />
                      </button>
                    )}
                    <button onClick={() => setDeleteConfirm(b.id)} title="삭제"
                      style={iconBtn("#FEE2E2", "#991B1B")}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {deleteConfirm === b.id && (
                  <div style={{ marginTop: "12px", padding: "10px 12px", background: "#FEF2F2", borderRadius: "8px", display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "12px", color: "#991B1B", flex: 1 }}>정말 삭제하시겠습니까?</span>
                    <button onClick={() => deleteMut.mutate(b.id)} disabled={deleteMut.isPending}
                      style={{ padding: "5px 12px", background: "#991B1B", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", cursor: "pointer", fontWeight: 700 }}>삭제</button>
                    <button onClick={() => setDeleteConfirm(null)}
                      style={{ padding: "5px 10px", background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}>취소</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "6px",
};
const inputStyle: React.CSSProperties = {
  width: "100%", height: "36px", padding: "0 10px", border: "1px solid var(--border-default)", borderRadius: "8px", fontSize: "13px", background: "var(--surface-white)", boxSizing: "border-box",
};
function iconBtn(bg: string, color: string): React.CSSProperties {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", background: bg, color, border: "none", borderRadius: "6px", cursor: "pointer" };
}
