import { useState, useEffect, useCallback } from "react";
import {
  Plus, ChevronDown, ChevronRight, Edit2, Trash2,
  CheckCircle, Archive, FileText, Zap,
} from "lucide-react";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TemplateSet {
  id: string;
  version_name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
  template_count: number;
}
interface Template {
  id: string;
  category: string;
  level: string | null;
  title: string | null;
  template_text: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const PRIMARY = "#002F5F";
const statusLabel: Record<string, string> = { DRAFT: "초안", ACTIVE: "활성", ARCHIVED: "보관됨" };
const statusCls: Record<string, string> = {
  DRAFT:    "bg-yellow-50 text-yellow-700 border-yellow-200",
  ACTIVE:   "bg-green-50 text-green-700 border-green-200",
  ARCHIVED: "bg-gray-100 text-gray-500 border-gray-200",
};
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// ─── Modals ──────────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, onConfirm, onCancel, danger }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold mb-2">{title}</h2>
        <p className="text-[13px] text-[#666] whitespace-pre-line mb-6 leading-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
          <button onClick={onConfirm} className={`flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold ${danger ? "bg-red-500 hover:bg-red-600" : ""}`}
            style={!danger ? { background: PRIMARY } : {}}>확인</button>
        </div>
      </div>
    </div>
  );
}

function TemplateModal({ initial, onClose, onConfirm, saving, error }: {
  initial?: Partial<Template>; onClose: () => void;
  onConfirm: (data: Partial<Template>) => void; saving: boolean; error: string;
}) {
  const [form, setForm] = useState({
    category: initial?.category ?? "",
    level: initial?.level ?? "",
    title: initial?.title ?? "",
    template_text: initial?.template_text ?? "",
    sort_order: initial?.sort_order ?? 0,
    is_active: initial?.is_active ?? true,
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold mb-4">{initial?.id ? "템플릿 수정" : "템플릿 추가"}</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#888] mb-1">카테고리 *</label>
              <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]"
                value={form.category} onChange={e => set("category", e.target.value)} placeholder="예: 자유형" />
            </div>
            <div>
              <label className="block text-[11px] text-[#888] mb-1">레벨</label>
              <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]"
                value={form.level} onChange={e => set("level", e.target.value)} placeholder="예: 초급" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-[#888] mb-1">제목</label>
            <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]"
              value={form.title} onChange={e => set("title", e.target.value)} placeholder="(선택)" />
          </div>
          <div>
            <label className="block text-[11px] text-[#888] mb-1">내용 *</label>
            <textarea className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1] resize-none"
              rows={4} value={form.template_text} onChange={e => set("template_text", e.target.value)} placeholder="템플릿 내용을 입력하세요" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[#888] mb-1">정렬순서</label>
              <input type="number" className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]"
                value={form.sort_order} onChange={e => set("sort_order", Number(e.target.value))} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)}
                  className="w-4 h-4 rounded accent-[#0369A1]" />
                <span className="text-[13px] text-[#555]">활성</span>
              </label>
            </div>
          </div>
        </div>
        {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
          <button onClick={() => onConfirm(form)} disabled={saving} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60"
            style={{ background: PRIMARY }}>{saving ? "저장 중..." : "저장"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Template List (set detail inner) ────────────────────────────────────────
function TemplateList({ setId, setStatus }: { setId: string; setStatus: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"create" | Template | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Template[]>(`/super/global-template-sets/${setId}/templates`);
      setTemplates(data);
    } catch { setTemplates([]); } finally { setLoading(false); }
  }, [setId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form: Partial<Template>) => {
    setSaving(true); setErr("");
    try {
      if (modal === "create") {
        await api.post(`/super/global-template-sets/${setId}/templates`, form);
      } else if (typeof modal === "object" && modal) {
        await api.patch(`/super/global-template-sets/${setId}/templates/${(modal as Template).id}`, form);
      }
      setModal(null);
      load();
    } catch (e: any) {
      setErr(e?.data?.message ?? "저장 실패");
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/super/global-template-sets/${setId}/templates/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
    } catch { /* ignore */ }
  };

  const canEdit = setStatus !== "ARCHIVED";

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-[#555]">템플릿 목록 ({templates.length}개)</span>
        {canEdit && (
          <button onClick={() => { setErr(""); setModal("create"); }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white text-[12px] font-semibold"
            style={{ background: PRIMARY }}>
            <Plus size={13} /> 추가
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-[13px] text-[#aaa] py-4 text-center">로딩 중...</p>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 bg-[#F9FAFB] rounded-xl border border-dashed border-[#E5E5E5]">
          <FileText size={28} className="mx-auto text-[#CCC] mb-2" />
          <p className="text-[13px] text-[#aaa]">템플릿이 없습니다</p>
          {canEdit && <button onClick={() => { setErr(""); setModal("create"); }}
            className="mt-3 text-[12px] text-[#0369A1] underline underline-offset-2">첫 템플릿 추가</button>}
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className={`flex items-start justify-between p-3 rounded-xl border ${t.is_active ? "border-[#E5E5E5] bg-white" : "border-[#F0F0F0] bg-[#FAFAFA]"}`}>
              <div className="flex-1 min-w-0 mr-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#0369A1]">{t.category}</span>
                  {t.level && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#666]">{t.level}</span>}
                  {!t.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">비활성</span>}
                </div>
                {t.title && <p className="text-[13px] font-semibold text-[#0A0A0A] mt-1.5 truncate">{t.title}</p>}
                <p className="text-[12px] text-[#666] mt-1 line-clamp-2 leading-4">{t.template_text}</p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => { setErr(""); setModal(t); }} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#888]"><Edit2 size={13} /></button>
                  <button onClick={() => setDeleteTarget(t)} className="p-1.5 rounded-lg hover:bg-red-50 text-[#888] hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal !== null && (
        <TemplateModal
          initial={modal === "create" ? undefined : (modal as Template)}
          onClose={() => setModal(null)}
          onConfirm={handleSave}
          saving={saving}
          error={err}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="템플릿 삭제"
          message={`"${deleteTarget.title ?? deleteTarget.category}" 템플릿을 삭제합니다.\n이 작업은 되돌릴 수 없습니다.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          danger
        />
      )}
    </div>
  );
}

// ─── Set Row (expandable) ─────────────────────────────────────────────────────
function SetRow({ s, onActivate, onArchive, activating, archiving }: {
  s: TemplateSet;
  onActivate: (id: string) => void;
  onArchive: (id: string) => void;
  activating: string | null;
  archiving: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ChevronIcon = open ? ChevronDown : ChevronRight;

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[#FAFAFA] transition-colors" onClick={() => setOpen(v => !v)}>
        <ChevronIcon size={14} className="text-[#AAA] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-[#0A0A0A] truncate">{s.version_name}</span>
            {s.status === "ACTIVE" && <Zap size={13} className="text-green-600" />}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusCls[s.status]}`}>
              {statusLabel[s.status]}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-[11px] text-[#AAA]">생성: {fmtDate(s.created_at)}</span>
            {s.activated_at && <span className="text-[11px] text-[#AAA]">활성화: {fmtDate(s.activated_at)}</span>}
            {s.archived_at  && <span className="text-[11px] text-[#AAA]">보관: {fmtDate(s.archived_at)}</span>}
            <span className="text-[11px] text-[#888]">템플릿 {s.template_count}개</span>
          </div>
        </div>
        {/* Lifecycle actions */}
        <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {s.status === "DRAFT" && (
            <button
              onClick={() => onActivate(s.id)}
              disabled={activating === s.id}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-85"
              style={{ background: "#16a34a" }}
            >
              <CheckCircle size={12} />
              {activating === s.id ? "처리 중..." : "활성화"}
            </button>
          )}
          {s.status === "ACTIVE" && (
            <button
              onClick={() => onArchive(s.id)}
              disabled={archiving === s.id}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[#E5E5E5] text-[#666] hover:bg-[#F5F5F5] disabled:opacity-50"
            >
              <Archive size={12} />
              {archiving === s.id ? "처리 중..." : "보관"}
            </button>
          )}
        </div>
      </div>

      {/* Expanded template list */}
      {open && (
        <div className="border-t border-[#F0F0F0] p-4">
          <TemplateList setId={s.id} setStatus={s.status} />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function GlobalTemplateSets() {
  const [sets, setSets] = useState<TemplateSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createErr, setCreateErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [archiving,  setArchiving]  = useState<string | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<TemplateSet | null>(null);
  const [confirmArchive,  setConfirmArchive]  = useState<TemplateSet | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<TemplateSet[]>("/super/global-template-sets");
      setSets(data);
    } catch { setSets([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const handleCreate = async () => {
    if (!newName.trim()) { setCreateErr("이름을 입력하세요."); return; }
    setCreating(true); setCreateErr("");
    try {
      await api.post("/super/global-template-sets", { version_name: newName.trim() });
      setNewName(""); setShowCreate(false);
      load();
      showToast("새 DRAFT 세트가 생성되었습니다.");
    } catch (e: any) {
      setCreateErr(e?.data?.message ?? "생성 실패");
    } finally { setCreating(false); }
  };

  const doActivate = async () => {
    if (!confirmActivate) return;
    const id = confirmActivate.id;
    setConfirmActivate(null);
    setActivating(id);
    try {
      const res = await api.patch<any>(`/super/global-template-sets/${id}/activate`, {});
      load();
      showToast(`활성화 완료 (ACTIVE count=${res?.active_count_verified ?? "?"}).`);
    } catch (e: any) {
      showToast(`활성화 실패: ${e?.data?.message ?? "오류"}`);
    } finally { setActivating(null); }
  };

  const doArchive = async () => {
    if (!confirmArchive) return;
    const id = confirmArchive.id;
    setConfirmArchive(null);
    setArchiving(id);
    try {
      await api.patch(`/super/global-template-sets/${id}/archive`, {});
      load();
      showToast("보관 처리 완료.");
    } catch (e: any) {
      showToast(`보관 실패: ${e?.data?.message ?? "오류"}`);
    } finally { setArchiving(null); }
  };

  const activeCount = sets.filter(s => s.status === "ACTIVE").length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[18px] font-bold text-[#0A0A0A]">글로벌 템플릿 세트</h2>
          <p className="text-[12px] text-[#AAA] mt-0.5">SWIMNOTE X 전국 공통 수업 템플릿 관리 (super_admin 전용)</p>
        </div>
        <button
          onClick={() => { setCreateErr(""); setShowCreate(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold shadow-sm"
          style={{ background: PRIMARY }}
        >
          <Plus size={15} /> 새 세트 생성
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "전체",   value: sets.length,                                  color: "#0A0A0A" },
          { label: "활성",   value: activeCount,                                   color: "#16a34a" },
          { label: "초안",   value: sets.filter(s => s.status === "DRAFT").length, color: "#d97706" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-[#EBEBEB] p-4 text-center">
            <p className="text-[11px] text-[#AAA] mb-1">{s.label}</p>
            <p className="text-[24px] font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ACTIVE warning */}
      {activeCount > 1 && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700 font-semibold">
          ⚠️ ACTIVE 세트가 {activeCount}개입니다. 즉시 확인이 필요합니다.
        </div>
      )}

      {/* Create panel */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 mb-4">
          <h3 className="text-[14px] font-bold mb-3">새 DRAFT 세트 생성</h3>
          <label className="block text-[11px] text-[#888] mb-1">세트 이름 (버전명) *</label>
          <input
            className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] mb-2"
            placeholder="예: v2024-09-autumn"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !creating && handleCreate()}
            autoFocus
          />
          {createErr && <p className="text-[12px] text-red-500 mb-2">{createErr}</p>}
          <div className="flex gap-3">
            <button onClick={() => { setShowCreate(false); setNewName(""); setCreateErr(""); }}
              className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
            <button onClick={handleCreate} disabled={creating}
              className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60"
              style={{ background: PRIMARY }}>{creating ? "생성 중..." : "DRAFT 생성"}</button>
          </div>
        </div>
      )}

      {/* Set list */}
      {loading ? (
        <p className="text-center text-[13px] text-[#AAA] py-12">로딩 중...</p>
      ) : sets.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#E5E5E5]">
          <FileText size={36} className="mx-auto text-[#DDD] mb-3" />
          <p className="text-[14px] text-[#AAA]">글로벌 템플릿 세트가 없습니다</p>
          <button onClick={() => { setCreateErr(""); setShowCreate(true); }}
            className="mt-4 text-[13px] font-semibold underline underline-offset-2" style={{ color: PRIMARY }}>
            첫 세트 생성하기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sets.map(s => (
            <SetRow
              key={s.id}
              s={s}
              onActivate={id => setConfirmActivate(sets.find(x => x.id === id) ?? null)}
              onArchive={id  => setConfirmArchive(sets.find(x => x.id === id)  ?? null)}
              activating={activating}
              archiving={archiving}
            />
          ))}
        </div>
      )}

      {/* Confirm modals */}
      {confirmActivate && (
        <ConfirmModal
          title="세트 활성화"
          message={`"${confirmActivate.version_name}" 세트를 ACTIVE로 전환합니다.\n기존 ACTIVE 세트가 있으면 자동으로 ARCHIVED 처리됩니다.`}
          onConfirm={doActivate}
          onCancel={() => setConfirmActivate(null)}
        />
      )}
      {confirmArchive && (
        <ConfirmModal
          title="세트 보관"
          message={`"${confirmArchive.version_name}" 세트를 ARCHIVED로 전환합니다.\nX 모드 템플릿 검색에서 제외됩니다.`}
          onConfirm={doArchive}
          onCancel={() => setConfirmArchive(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-[#0A0A0A] text-white text-[13px] font-medium shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
