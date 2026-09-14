import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-client";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiaryLevel {
  id: string;
  level_name: string;
  sort_order: number;
  template_count: number;
}

interface DiaryTemplate {
  id: string;
  level_id: string | null;
  title: string | null;
  template_text: string;
  sort_order: number;
  is_active: boolean;
  category: string | null;
  level: string | null;
  scope: "global" | "teacher" | string;
  teacher_id: string | null;
}

function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return (e as ApiError).message;
  return "오류가 발생했습니다.";
}

// ─── TemplateFormDrawer ───────────────────────────────────────────────────────

function TemplateFormDrawer({
  template,
  levels,
  onClose,
}: {
  template: DiaryTemplate | null; // null = create new
  levels: DiaryLevel[];
  onClose: (saved: boolean) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(template?.title ?? "");
  const [text, setText] = useState(template?.template_text ?? "");
  const [levelId, setLevelId] = useState(template?.level_id ?? "");
  const [sortOrder, setSortOrder] = useState<string>(String(template?.sort_order ?? ""));
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const createMut = useMutation({
    mutationFn: () =>
      api.post("/diary-templates", {
        title: title.trim() || undefined,
        template_text: text.trim(),
        level_id: levelId || undefined,
        sort_order: sortOrder !== "" ? parseInt(sortOrder) : undefined,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diary-templates"] }); onClose(true); },
    onError: (e) => setFormError(errMsg(e)),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      api.patch(`/diary-templates/${template!.id}`, {
        title: title.trim() || undefined,
        template_text: text.trim() || undefined,
        level_id: levelId || undefined,
        sort_order: sortOrder !== "" ? parseInt(sortOrder) : undefined,
        is_active: isActive,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diary-templates"] }); onClose(true); },
    onError: (e) => setFormError(errMsg(e)),
  });

  const isPending = createMut.isPending || updateMut.isPending;

  // Scope protection: global templates can be edited by pool_admin, x_global cannot
  // x_global scope = super_admin only. We show a warning but this code path shouldn't
  // be reached since the page only shows scope=global templates for pool_admin.

  return (
    <>
      <div onClick={() => onClose(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 40 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "480px",
        background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
        zIndex: 50, display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B" }}>
            {template ? "템플릿 수정" : "새 템플릿 추가"}
          </div>
          <button onClick={() => onClose(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px", color: "#64748B" }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>제목 (선택)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="템플릿 제목"
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" }} />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>레벨</label>
            <select value={levelId} onChange={(e) => setLevelId(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}>
              <option value="">레벨 없음</option>
              {levels.map((lv) => <option key={lv.id} value={lv.id}>{lv.level_name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>
              내용 <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="템플릿 내용을 입력하세요."
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", minHeight: "160px", resize: "vertical", boxSizing: "border-box" }} />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>순서</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="0"
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" }} />
          </div>

          {template && (
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "#475569" }}>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              활성 상태
            </label>
          )}

          {formError && (
            <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626" }}>
              {formError}
            </div>
          )}
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid #E2E8F0", display: "flex", gap: "8px", flexShrink: 0 }}>
          <button onClick={() => onClose(false)} style={{ flex: 1, padding: "9px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>취소</button>
          <button
            onClick={() => {
              if (!text.trim()) { setFormError("내용을 입력해주세요."); return; }
              template ? updateMut.mutate() : createMut.mutate();
            }}
            disabled={isPending}
            style={{ flex: 2, padding: "9px", background: isPending ? "#93A8C4" : "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600 }}
          >
            {isPending ? "저장 중…" : template ? "저장" : "추가"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── TemplatesPage ────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const qc = useQueryClient();
  const [levelFilter, setLevelFilter] = useState("");
  const [search, setSearch] = useState("");
  const [formTarget, setFormTarget] = useState<DiaryTemplate | null | "new">(undefined as unknown as null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DiaryTemplate | null>(null);
  const [error, setError] = useState("");

  const { data: levels = [] } = useQuery<DiaryLevel[]>({
    queryKey: ["diary-template-levels"],
    queryFn: () => api.get("/diary-template-levels"),
  });

  const params = new URLSearchParams();
  if (levelFilter) params.set("level_id", levelFilter);
  params.set("include_inactive", "true");

  const { data: templates = [], isLoading, isError } = useQuery<DiaryTemplate[]>({
    queryKey: ["diary-templates", levelFilter],
    queryFn: () => api.get(`/diary-templates?${params.toString()}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/diary-templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["diary-templates"] }); qc.invalidateQueries({ queryKey: ["diary-template-levels"] }); setDeleteTarget(null); setError(""); },
    onError: (e) => { setError(errMsg(e)); setDeleteTarget(null); },
  });

  const reorderMut = useMutation({
    mutationFn: (ordered_ids: string[]) => api.post("/diary-templates/reorder", { ordered_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diary-templates"] }),
    onError: (e) => setError(errMsg(e)),
  });

  const filtered = templates.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.title ?? "").toLowerCase().includes(q) || t.template_text.toLowerCase().includes(q);
  });

  function moveTemplate(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= filtered.length) return;
    const copy = [...filtered];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    reorderMut.mutate(copy.map((t) => t.id));
  }

  function getLevelName(id: string | null): string {
    if (!id) return "—";
    return levels.find((l) => l.id === id)?.level_name ?? id;
  }

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: "6px" }}>
        <Link href="/admin/curriculum">
          <a style={{ fontSize: "13px", color: "#64748B", textDecoration: "none", cursor: "pointer" }}>← 커리큘럼 관리</a>
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1E293B", margin: 0 }}>일지 템플릿</h1>
          <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0" }}>
            선생님 일지 작성 시 제공하는 공통 템플릿 {isLoading ? "" : `(${filtered.length}개)`}
          </p>
        </div>
        <button
          onClick={() => { setFormTarget(null); setShowForm(true); }}
          style={{ padding: "7px 14px", background: "#1D4E8F", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
        >
          + 새 템플릿
        </button>
      </div>

      {/* Scope notice */}
      <div style={{ padding: "10px 14px", background: "#F0F7FF", border: "1px solid #BFDBFE", borderRadius: "6px", fontSize: "12px", color: "#1E40AF", marginBottom: "16px" }}>
        관리자 공통 템플릿(scope: global)만 표시됩니다. SWIMNOTE X 기본 템플릿(x_global)은 읽기 전용으로 운영팀에서 관리합니다.
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "13px", color: "#DC2626", marginBottom: "12px" }}>
          {error}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="제목/내용 검색…"
          style={{ padding: "6px 10px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px", width: "200px" }} />
        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}
          style={{ padding: "6px 8px", border: "1px solid #CBD5E1", borderRadius: "6px", fontSize: "13px" }}>
          <option value="">레벨 전체</option>
          {levels.map((l) => <option key={l.id} value={l.id}>{l.level_name}</option>)}
        </select>
        <Link href="/admin/curriculum/levels">
          <a style={{ padding: "6px 12px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: "6px", fontSize: "12px", color: "#475569", textDecoration: "none", cursor: "pointer", alignSelf: "center" }}>
            레벨 관리
          </a>
        </Link>
      </div>

      {isError ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#EF4444" }}>불러오지 못했습니다.</div>
      ) : isLoading ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8" }}>
          {search ? "검색 결과가 없습니다." : "등록된 일지 템플릿이 없습니다."}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["순서", "제목", "레벨", "내용 미리보기", "상태", "관리"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: "12px", fontWeight: 600, color: "#64748B", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id} style={{ background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button onClick={() => moveTemplate(i, -1)} disabled={i === 0 || reorderMut.isPending}
                        style={{ padding: "2px 6px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "4px", cursor: i === 0 ? "not-allowed" : "pointer", fontSize: "11px", color: i === 0 ? "#CBD5E1" : "#475569" }}>▲</button>
                      <button onClick={() => moveTemplate(i, 1)} disabled={i === filtered.length - 1 || reorderMut.isPending}
                        style={{ padding: "2px 6px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "4px", cursor: i === filtered.length - 1 ? "not-allowed" : "pointer", fontSize: "11px", color: i === filtered.length - 1 ? "#CBD5E1" : "#475569" }}>▼</button>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1E293B", borderBottom: "1px solid #F1F5F9" }}>
                    {t.title || <span style={{ color: "#94A3B8", fontWeight: 400 }}>제목 없음</span>}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: "12px", color: "#64748B", borderBottom: "1px solid #F1F5F9" }}>
                    {getLevelName(t.level_id)}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: "12px", color: "#64748B", borderBottom: "1px solid #F1F5F9", maxWidth: "260px" }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.template_text}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: t.is_active ? "#DCFCE7" : "#F1F5F9", color: t.is_active ? "#166534" : "#94A3B8" }}>
                      {t.is_active ? "활성" : "비활성"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => { setFormTarget(t); setShowForm(true); }}
                        style={{ padding: "4px 10px", background: "#F1F5F9", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#475569" }}>수정</button>
                      <button onClick={() => { setError(""); setDeleteTarget(t); }}
                        style={{ padding: "4px 10px", background: "#FEF2F2", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", color: "#DC2626" }}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Template form drawer */}
      {showForm && (
        <TemplateFormDrawer
          template={formTarget as DiaryTemplate | null}
          levels={levels}
          onClose={(saved) => { setShowForm(false); setFormTarget(null); if (saved) setError(""); }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60 }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            zIndex: 70, background: "#fff", borderRadius: "10px",
            boxShadow: "0 8px 40px rgba(0,0,0,0.16)", padding: "28px",
            width: "min(380px, calc(100vw - 48px))",
          }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>템플릿 삭제</div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "20px", lineHeight: 1.6 }}>
              <strong>{deleteTarget.title || "제목 없음"}</strong> 템플릿을 삭제합니다.
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteTarget(null)} style={{ padding: "8px 16px", background: "#fff", border: "1px solid #CBD5E1", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>취소</button>
              <button onClick={() => deleteMut.mutate(deleteTarget.id)} disabled={deleteMut.isPending}
                style={{ padding: "8px 16px", background: deleteMut.isPending ? "#FCA5A5" : "#DC2626", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
                {deleteMut.isPending ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
