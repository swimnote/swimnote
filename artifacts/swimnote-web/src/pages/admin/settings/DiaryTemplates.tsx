import { useEffect, useState, useCallback } from "react";
import {
  Plus, RefreshCcw, ChevronDown, ChevronUp, Copy, Edit2, Trash2,
  ToggleLeft, ToggleRight, FileText,
} from "lucide-react";
import { api } from "@/lib/api";

interface DiaryTemplateLevel { id: string; level_name: string; template_count: number; sort_order: number; }
interface DiaryTemplate { id: string; level_id: string; title: string | null; template_text: string; is_active: boolean; sort_order: number; }

function ConfirmDialog({ title, message, onConfirm, onCancel }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold text-[#0A0A0A] mb-2">{title}</h2>
        <p className="text-[13px] text-[#666] whitespace-pre-line mb-6 leading-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666] hover:bg-[#F9F9F9]">취소</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-[14px] font-semibold hover:bg-red-600">확인</button>
        </div>
      </div>
    </div>
  );
}

function InputModal({ title, label, value, onChange, error, saving, onClose, onConfirm, maxLength }: {
  title: string; label: string; value: string; onChange: (v: string) => void;
  error: string; saving: boolean; onClose: () => void; onConfirm: () => void; maxLength?: number;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold mb-4">{title}</h2>
        <label className="block text-[12px] text-[#888] mb-1.5">{label}</label>
        <input
          className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]"
          value={value}
          onChange={e => onChange(e.target.value)}
          maxLength={maxLength}
          autoFocus
          onKeyDown={e => e.key === "Enter" && !saving && onConfirm()}
        />
        {error && <p className="text-[12px] text-red-500 mt-1.5">{error}</p>}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
          <button onClick={onConfirm} disabled={saving} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>
            {saving ? "처리 중..." : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateModal({ title, titleVal, textVal, error, saving, onTitleChange, onTextChange, onClose, onConfirm }: {
  title: string; titleVal: string; textVal: string; error: string; saving: boolean;
  onTitleChange: (v: string) => void; onTextChange: (v: string) => void;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold mb-4">{title}</h2>
        <label className="block text-[12px] text-[#888] mb-1.5">제목 (선택)</label>
        <input
          className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] mb-3"
          value={titleVal}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="템플릿 제목"
        />
        <label className="block text-[12px] text-[#888] mb-1.5">내용 *</label>
        <textarea
          className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] resize-none"
          rows={6}
          value={textVal}
          onChange={e => onTextChange(e.target.value)}
          placeholder="수업 일지 템플릿 내용을 입력하세요."
          autoFocus
        />
        {error && <p className="text-[12px] text-red-500 mt-1.5">{error}</p>}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
          <button onClick={onConfirm} disabled={saving} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiaryTemplates() {
  const [levels, setLevels] = useState<DiaryTemplateLevel[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [levelsLoading, setLevelsLoading] = useState(true);

  const [templates, setTemplates] = useState<DiaryTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  const [addLevelVisible, setAddLevelVisible] = useState(false);
  const [addLevelText, setAddLevelText] = useState("");
  const [addLevelError, setAddLevelError] = useState("");
  const [addLevelSaving, setAddLevelSaving] = useState(false);

  const [addTemplateVisible, setAddTemplateVisible] = useState(false);
  const [addTemplateTitle, setAddTemplateTitle] = useState("");
  const [addTemplateText, setAddTemplateText] = useState("");
  const [addTemplateError, setAddTemplateError] = useState("");
  const [addTemplateSaving, setAddTemplateSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<DiaryTemplate | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const [confirmDeleteLevel, setConfirmDeleteLevel] = useState<DiaryTemplateLevel | null>(null);
  const [confirmClearLevel, setConfirmClearLevel] = useState<DiaryTemplateLevel | null>(null);
  const [confirmRestoreDefault, setConfirmRestoreDefault] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<DiaryTemplate | null>(null);

  const loadLevels = useCallback(async (keepSelected?: string | null) => {
    setLevelsLoading(true);
    try {
      const data: DiaryTemplateLevel[] = await api.get("/diary-template-levels");
      setLevels(data);
      setSelectedLevelId(prev => {
        const target = keepSelected !== undefined ? keepSelected : prev;
        if (target && data.find(l => l.id === target)) return target;
        return data.length > 0 ? data[0].id : null;
      });
    } catch {}
    finally { setLevelsLoading(false); }
  }, []);

  const loadTemplates = useCallback(async (levelId: string) => {
    setTemplatesLoading(true);
    try {
      const data: DiaryTemplate[] = await api.get(`/diary-templates?level_id=${levelId}&include_inactive=true`);
      setTemplates([...data].sort((a, b) => a.sort_order - b.sort_order));
    } catch {}
    finally { setTemplatesLoading(false); }
  }, []);

  useEffect(() => { loadLevels(); }, []);
  useEffect(() => {
    if (selectedLevelId) loadTemplates(selectedLevelId);
    else setTemplates([]);
  }, [selectedLevelId]);

  async function handleAddLevel() {
    if (!addLevelText.trim()) { setAddLevelError("레벨 이름을 입력해주세요."); return; }
    setAddLevelSaving(true);
    try {
      const res: any = await api.post("/diary-template-levels", { level_name: addLevelText.trim() });
      const created: DiaryTemplateLevel = {
        id: res.id,
        level_name: addLevelText.trim(),
        template_count: 0,
        sort_order: levels.length,
      };
      setAddLevelText(""); setAddLevelError(""); setAddLevelVisible(false);
      setLevels(prev => [...prev, created]);
      setSelectedLevelId(created.id);
      setTemplates([]);
    } catch (e: any) {
      setAddLevelError(e?.data?.error || "레벨 추가에 실패했습니다.");
    } finally { setAddLevelSaving(false); }
  }

  async function handleDeleteLevel(lv: DiaryTemplateLevel) {
    try {
      await api.delete(`/diary-template-levels/${lv.id}`);
      const next = levels.filter(l => l.id !== lv.id);
      setLevels(next);
      if (selectedLevelId === lv.id) {
        setSelectedLevelId(next.length > 0 ? next[0].id : null);
        setTemplates([]);
      }
    } catch {}
  }

  async function handleClearLevel(lv: DiaryTemplateLevel) {
    try {
      await api.post(`/diary-template-levels/${lv.id}/clear`, {});
      if (selectedLevelId === lv.id) setTemplates([]);
      setLevels(prev => prev.map(l => l.id === lv.id ? { ...l, template_count: 0 } : l));
    } catch {}
  }

  async function handleAddTemplate() {
    if (!addTemplateText.trim()) { setAddTemplateError("템플릿 내용을 입력해주세요."); return; }
    if (!selectedLevelId) return;
    setAddTemplateSaving(true);
    try {
      const res: any = await api.post("/diary-templates", {
        level_id: selectedLevelId,
        title: addTemplateTitle.trim() || null,
        template_text: addTemplateText.trim(),
        sort_order: templates.length,
      });
      const created: DiaryTemplate = {
        id: res.id,
        level_id: selectedLevelId,
        title: addTemplateTitle.trim() || null,
        template_text: addTemplateText.trim(),
        is_active: true,
        sort_order: templates.length,
      };
      setAddTemplateVisible(false); setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError("");
      setTemplates(prev => [...prev, created]);
      setLevels(prev => prev.map(l => l.id === selectedLevelId ? { ...l, template_count: (l.template_count || 0) + 1 } : l));
    } catch (e: any) {
      setAddTemplateError(e?.data?.error || "추가에 실패했습니다.");
    } finally { setAddTemplateSaving(false); }
  }

  async function handleEditTemplate() {
    if (!editTarget) return;
    if (!editText.trim()) { setEditError("템플릿 내용을 입력해주세요."); return; }
    setEditSaving(true);
    try {
      await api.patch(`/diary-templates/${editTarget.id}`, { title: editTitle.trim() || null, template_text: editText.trim() });
      setTemplates(prev => prev.map(t => t.id === editTarget.id ? { ...t, title: editTitle.trim() || null, template_text: editText.trim() } : t));
      setEditTarget(null);
    } catch (e: any) {
      setEditError(e?.data?.error || "수정에 실패했습니다.");
    } finally { setEditSaving(false); }
  }

  async function handleDeleteTemplate(t: DiaryTemplate) {
    try {
      await api.delete(`/diary-templates/${t.id}`);
      setTemplates(prev => prev.filter(x => x.id !== t.id));
      setLevels(prev => prev.map(l => l.id === t.level_id ? { ...l, template_count: Math.max(0, (l.template_count || 1) - 1) } : l));
    } catch {}
  }

  async function handleCopyTemplate(t: DiaryTemplate) {
    try {
      const res: any = await api.post(`/diary-templates/${t.id}/copy`, {});
      const copied: DiaryTemplate = {
        id: res.id,
        level_id: t.level_id,
        title: t.title ? t.title + " 복사" : null,
        template_text: t.template_text,
        is_active: t.is_active,
        sort_order: templates.length,
      };
      setTemplates(prev => [...prev, copied]);
      setLevels(prev => prev.map(l => l.id === t.level_id ? { ...l, template_count: (l.template_count || 0) + 1 } : l));
    } catch {}
  }

  async function handleToggleTemplate(t: DiaryTemplate) {
    try {
      await api.patch(`/diary-templates/${t.id}`, { is_active: !t.is_active });
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x));
    } catch {}
  }

  async function handleMoveTemplate(t: DiaryTemplate, dir: "up" | "down") {
    const idx = templates.findIndex(x => x.id === t.id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === templates.length - 1) return;
    const newT = [...templates];
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    [newT[idx], newT[swapIdx]] = [newT[swapIdx], newT[idx]];
    setTemplates(newT);
    if (selectedLevelId) {
      await api.post("/diary-templates/reorder", { level_id: selectedLevelId, ordered_ids: newT.map(x => x.id) })
        .catch(async () => { if (selectedLevelId) await loadTemplates(selectedLevelId); });
    }
  }

  async function handleRestoreDefault() {
    try {
      await api.post("/diary-templates/restore-default", {});
      // 전체 레벨·템플릿 구조가 교체되므로 silent 갱신
      api.get<DiaryTemplateLevel[]>("/diary-template-levels").then(data => {
        setLevels(data);
        setSelectedLevelId(data.length > 0 ? data[0].id : null);
      }).catch(() => {});
    } catch {}
  }

  async function handleClearAll() {
    try {
      await api.post("/diary-templates/clear-all", {});
      setTemplates([]);
      setLevels(prev => prev.map(l => ({ ...l, template_count: 0 })));
    } catch {}
  }

  const selectedLevel = levels.find(l => l.id === selectedLevelId);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">일지 템플릿</h1>
          <p className="text-[13px] text-[#999] mt-1">레벨별 수업 일지 항목을 설정합니다.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmRestoreDefault(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-semibold hover:bg-[#F5F3FF] transition-colors"
            style={{ borderColor: "#DDD6FE", color: "#7C3AED" }}
          >
            <RefreshCcw size={12} /> 기본 복원
          </button>
          <button
            onClick={() => setConfirmClearAll(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-semibold hover:bg-[#FEF2F2] transition-colors"
            style={{ borderColor: "#FECACA", color: "#DC2626" }}
          >
            전체 초기화
          </button>
        </div>
      </div>

      {levelsLoading ? (
        <div className="space-y-3">
          <div className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />
          <div className="h-40 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />
        </div>
      ) : (
        <>
          {/* 레벨 선택 */}
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-semibold text-[#0A0A0A]">
                레벨 <span className="text-[#999] font-normal text-[13px]">({levels.length}/10)</span>
              </span>
            </div>

            {levels.length === 0 ? (
              <div className="py-6 text-center">
                <FileText size={28} className="mx-auto mb-2 text-[#DDD]" />
                <p className="text-[13px] text-[#999] mb-1">레벨이 없습니다.</p>
                <p className="text-[12px] text-[#BBB] mb-3">"기본 복원" 버튼으로 SwimNote 기본 템플릿을 불러오세요.</p>
                <button
                  onClick={() => { setAddLevelText("레벨 1"); setAddLevelError(""); setAddLevelVisible(true); }}
                  className="flex items-center gap-1 mx-auto text-[12px] font-semibold text-[#0369A1]"
                >
                  <Plus size={14} /> 레벨 추가
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {levels.map(lv => (
                  <div key={lv.id} className="relative group">
                    <button
                      onClick={() => setSelectedLevelId(lv.id)}
                      className="px-3 py-1.5 rounded-xl text-[13px] font-medium transition-colors"
                      style={selectedLevelId === lv.id
                        ? { background: "#0369A1", color: "#fff" }
                        : { background: "#F5F5F5", color: "#555" }}
                    >
                      {lv.level_name}
                      {lv.template_count > 0 && (
                        <span className="ml-1 text-[11px]" style={{ color: selectedLevelId === lv.id ? "rgba(255,255,255,0.7)" : "#999" }}>
                          ({lv.template_count})
                        </span>
                      )}
                    </button>
                    <div className="absolute -top-2 -right-2 hidden group-hover:flex gap-0.5 z-10">
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmClearLevel(lv); }}
                        className="w-4 h-4 rounded-full bg-[#F59E0B] text-white text-[9px] flex items-center justify-center hover:bg-[#D97706]"
                        title="비우기"
                      >–</button>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteLevel(lv); }}
                        className="w-4 h-4 rounded-full bg-[#EF4444] text-white text-[9px] flex items-center justify-center hover:bg-[#DC2626]"
                        title="삭제"
                      >×</button>
                    </div>
                  </div>
                ))}
                {levels.length < 10 && (
                  <button
                    onClick={() => { setAddLevelText(`레벨 ${levels.length + 1}`); setAddLevelError(""); setAddLevelVisible(true); }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-[13px] font-medium bg-[#F5F5F5] text-[#999] hover:bg-[#EBEBEB] transition-colors"
                  >
                    <Plus size={12} /> 추가
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 템플릿 목록 */}
          {selectedLevel && (
            <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-[#0A0A0A]">{selectedLevel.level_name}</span>
                  <span className="text-[13px] text-[#999]">({templates.length}개)</span>
                </div>
                <button
                  onClick={() => { setAddTemplateTitle(""); setAddTemplateText(""); setAddTemplateError(""); setAddTemplateVisible(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border hover:bg-[#EFF6FF] transition-colors"
                  style={{ color: "#0369A1", borderColor: "#BFDBFE" }}
                >
                  <Plus size={12} /> 추가
                </button>
              </div>

              {templatesLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-[#F9F9F9] rounded-xl animate-pulse" />)}
                </div>
              ) : templates.length === 0 ? (
                <div className="py-10 text-center">
                  <FileText size={28} className="mx-auto mb-2 text-[#DDD]" />
                  <p className="text-[13px] text-[#999]">템플릿이 없습니다.</p>
                  <p className="text-[12px] text-[#BBB]">"추가" 버튼으로 템플릿을 만들어보세요.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {templates.map((t, idx) => (
                    <div
                      key={t.id}
                      className={`border rounded-xl p-4 transition-colors ${t.is_active ? "border-[#EBEBEB] bg-white" : "border-[#E5E5E5] bg-[#F9F9F9] opacity-70"}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          {t.title && (
                            <p className="text-[13px] font-semibold text-[#0A0A0A] mb-1">{t.title}</p>
                          )}
                          <p className="text-[12px] text-[#555] leading-5 whitespace-pre-wrap line-clamp-3">{t.template_text}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => handleToggleTemplate(t)} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]" title={t.is_active ? "비활성화" : "활성화"}>
                            {t.is_active
                              ? <ToggleRight size={18} color="#2EC4B6" />
                              : <ToggleLeft size={18} color="#999" />
                            }
                          </button>
                          <button onClick={() => { setEditTarget(t); setEditTitle(t.title ?? ""); setEditText(t.template_text); setEditError(""); }} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]" title="수정">
                            <Edit2 size={14} color="#666" />
                          </button>
                          <button onClick={() => handleCopyTemplate(t)} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]" title="복사">
                            <Copy size={14} color="#666" />
                          </button>
                          <button onClick={() => setConfirmDeleteTemplate(t)} className="p-1.5 rounded-lg hover:bg-[#FEF2F2]" title="삭제">
                            <Trash2 size={14} color="#DC2626" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[#F5F5F5]">
                        <button
                          onClick={() => handleMoveTemplate(t, "up")}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-[#F5F5F5] disabled:opacity-30 transition-opacity"
                          title="위로"
                        >
                          <ChevronUp size={14} color="#999" />
                        </button>
                        <button
                          onClick={() => handleMoveTemplate(t, "down")}
                          disabled={idx === templates.length - 1}
                          className="p-1 rounded hover:bg-[#F5F5F5] disabled:opacity-30 transition-opacity"
                          title="아래로"
                        >
                          <ChevronDown size={14} color="#999" />
                        </button>
                        <span className="text-[11px] text-[#CCC] ml-1">{idx + 1} / {templates.length}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {addLevelVisible && (
        <InputModal
          title="레벨 추가"
          label="레벨 이름"
          value={addLevelText}
          onChange={setAddLevelText}
          error={addLevelError}
          saving={addLevelSaving}
          onClose={() => setAddLevelVisible(false)}
          onConfirm={handleAddLevel}
          maxLength={50}
        />
      )}

      {addTemplateVisible && (
        <TemplateModal
          title="템플릿 추가"
          titleVal={addTemplateTitle}
          textVal={addTemplateText}
          error={addTemplateError}
          saving={addTemplateSaving}
          onTitleChange={setAddTemplateTitle}
          onTextChange={setAddTemplateText}
          onClose={() => setAddTemplateVisible(false)}
          onConfirm={handleAddTemplate}
        />
      )}

      {editTarget && (
        <TemplateModal
          title="템플릿 수정"
          titleVal={editTitle}
          textVal={editText}
          error={editError}
          saving={editSaving}
          onTitleChange={setEditTitle}
          onTextChange={setEditText}
          onClose={() => setEditTarget(null)}
          onConfirm={handleEditTemplate}
        />
      )}

      {confirmDeleteLevel && (
        <ConfirmDialog
          title="레벨 삭제"
          message={`"${confirmDeleteLevel.level_name}" 레벨과 하위 템플릿 ${confirmDeleteLevel.template_count}개가 모두 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`}
          onConfirm={async () => { await handleDeleteLevel(confirmDeleteLevel); setConfirmDeleteLevel(null); }}
          onCancel={() => setConfirmDeleteLevel(null)}
        />
      )}
      {confirmClearLevel && (
        <ConfirmDialog
          title="레벨 비우기"
          message={`"${confirmClearLevel.level_name}" 레벨의 템플릿 ${confirmClearLevel.template_count}개가 모두 삭제됩니다.\n레벨 이름은 유지됩니다.`}
          onConfirm={async () => { await handleClearLevel(confirmClearLevel); setConfirmClearLevel(null); }}
          onCancel={() => setConfirmClearLevel(null)}
        />
      )}
      {confirmRestoreDefault && (
        <ConfirmDialog
          title="SwimNote 기본 템플릿 복원"
          message={"기본 템플릿으로 복원합니다.\n복원 완료까지 10~20초 정도 소요될 수 있습니다.\n\n이 작업은 되돌릴 수 없습니다."}
          onConfirm={async () => { await handleRestoreDefault(); setConfirmRestoreDefault(false); }}
          onCancel={() => setConfirmRestoreDefault(false)}
        />
      )}
      {confirmClearAll && (
        <ConfirmDialog
          title="전체 초기화"
          message={"레벨 구조는 유지되고\n모든 템플릿이 삭제됩니다.\n\n이 작업은 되돌릴 수 없습니다."}
          onConfirm={async () => { await handleClearAll(); setConfirmClearAll(false); }}
          onCancel={() => setConfirmClearAll(false)}
        />
      )}
      {confirmDeleteTemplate && (
        <ConfirmDialog
          title="템플릿 삭제"
          message={"이 템플릿을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다."}
          onConfirm={async () => { await handleDeleteTemplate(confirmDeleteTemplate); setConfirmDeleteTemplate(null); }}
          onCancel={() => setConfirmDeleteTemplate(null)}
        />
      )}
    </div>
  );
}
