import { useEffect, useState } from "react";
import { Info, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Check } from "lucide-react";
import { api } from "@/lib/api";

const BADGE_COLORS = [
  { label: "청록", value: "#2EC4B6" },
  { label: "파랑", value: "#3B82F6" },
  { label: "빨강", value: "#EF4444" },
  { label: "초록", value: "#22C55E" },
  { label: "노랑", value: "#F59E0B" },
  { label: "보라", value: "#8B5CF6" },
  { label: "주황", value: "#F97316" },
  { label: "검정", value: "#1A1A1A" },
  { label: "핑크", value: "#EC4899" },
  { label: "흰색", value: "#FFFFFF" },
];

const BADGE_TYPES = [
  { key: "text", label: "문자형" },
  { key: "color", label: "색상형" },
  { key: "icon", label: "아이콘형" },
];

function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

interface LevelSetting {
  level_order: number;
  level_name: string;
  level_description: string;
  learning_content: string;
  promotion_test_rule: string;
  badge_type: string;
  badge_label: string;
  badge_color: string;
  badge_text_color: string;
  is_active: boolean;
}

const DEFAULT: LevelSetting[] = Array.from({ length: 10 }, (_, i) => ({
  level_order: i + 1,
  level_name: String(i + 1),
  level_description: "",
  learning_content: "",
  promotion_test_rule: "",
  badge_type: "text",
  badge_label: String(i + 1),
  badge_color: "#2EC4B6",
  badge_text_color: "#FFFFFF",
  is_active: true,
}));

function BadgePreview({ lv, size = "md" }: { lv: LevelSetting; size?: "sm" | "md" | "lg" }) {
  const dim = { sm: "w-6 h-6 text-[10px]", md: "w-9 h-9 text-[12px]", lg: "w-11 h-11 text-[14px]" }[size];
  const label = lv.badge_type === "icon" ? "★" : (lv.badge_label || lv.level_name || String(lv.level_order));
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold border-2 flex-shrink-0`}
      style={{
        background: lv.badge_color,
        color: lv.badge_text_color,
        borderColor: lv.badge_color === "#FFFFFF" ? "#E5E5E5" : lv.badge_color,
      }}
    >
      {label}
    </div>
  );
}

export default function LevelSettings() {
  const [levels, setLevels] = useState<LevelSetting[]>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.get<any>("/admin/level-settings")
      .then(d => {
        const data: any[] = Array.isArray(d) ? d : [];
        if (data.length > 0) {
          setLevels(data.map(l => ({ ...DEFAULT[l.level_order - 1], ...l, is_active: l.is_active !== false })));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update(order: number, field: keyof LevelSetting, value: any) {
    setLevels(prev => prev.map(l => {
      if (l.level_order !== order) return l;
      const updated = { ...l, [field]: value };
      if (field === "level_name" && l.badge_type !== "icon") updated.badge_label = value;
      return updated;
    }));
    setChanged(true);
  }

  function setBadgeLabel(order: number, value: string) {
    setLevels(prev => prev.map(l => l.level_order === order ? { ...l, badge_label: value } : l));
    setChanged(true);
  }

  function setBadgeType(order: number, t: string) {
    setLevels(prev => prev.map(l => l.level_order === order ? { ...l, badge_type: t } : l));
    setChanged(true);
  }

  function setBadgeColor(order: number, c: string) {
    const dark = isDarkColor(c);
    setLevels(prev => prev.map(l =>
      l.level_order === order ? { ...l, badge_color: c, badge_text_color: dark ? "#FFFFFF" : "#1A1A1A" } : l
    ));
    setChanged(true);
  }

  function toggleActive(order: number) {
    setLevels(prev => prev.map(l => l.level_order === order ? { ...l, is_active: !l.is_active } : l));
    setChanged(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put("/admin/level-settings", { levels });
      setChanged(false);
      setToast({ text: "저장되었습니다.", ok: true });
    } catch {
      setToast({ text: "저장에 실패했습니다.", ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">레벨 설정</h1>
          <p className="text-[13px] text-[#999] mt-1">수영 레벨을 설정합니다.</p>
        </div>
        <button
          onClick={save}
          disabled={saving || !changed}
          className="px-5 py-2 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{ background: changed ? "#0369A1" : "#CBD5E1", color: "#fff" }}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl border mb-5" style={{ background: "#EEF9F8", borderColor: "#C2E8E5" }}>
        <Info size={16} color="#2EC4B6" className="flex-shrink-0 mt-0.5" />
        <p className="text-[13px] leading-5" style={{ color: "#2EC4B6" }}>
          레벨 1~10의 표시명·설명·뱃지를 자유롭게 설정할 수 있습니다.<br />
          설정하지 않은 항목은 기본값(숫자)으로 표시됩니다.
        </p>
      </div>

      <div className="space-y-2 mb-5">
        {levels.map(lv => {
          const isOpen = expanded === lv.level_order;
          const inactive = !lv.is_active;
          const hasContent = lv.level_description || lv.learning_content || lv.promotion_test_rule;

          return (
            <div
              key={lv.level_order}
              className={`rounded-2xl border transition-all ${inactive ? "border-[#DDD9D5] bg-[#F5F5F5] opacity-80" : "border-[#EBEBEB] bg-white"}`}
            >
              <button
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                onClick={() => setExpanded(prev => prev === lv.level_order ? null : lv.level_order)}
              >
                <BadgePreview lv={lv} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold text-[14px] ${inactive ? "text-[#999]" : "text-[#0A0A0A]"}`}>
                      레벨 {lv.level_order}{lv.level_name !== String(lv.level_order) ? ` · ${lv.level_name}` : ""}
                    </span>
                    {inactive && (
                      <span className="text-[10px] text-[#64748B] bg-[#F3F4F6] border border-[#D1D5DB] rounded px-1.5 py-0.5">사용 안함</span>
                    )}
                  </div>
                  <p className={`text-[12px] mt-0.5 truncate ${hasContent ? "text-[#666]" : "text-[#BBB]"}`}>
                    {hasContent ? (lv.level_description || lv.learning_content) : "내용 없음 (클릭하여 편집)"}
                  </p>
                </div>
                <button
                  className={`flex-shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${inactive ? "bg-[#F3F4F6] border-[#D1D5DB]" : "bg-[#E6FFFA] border-[#A7D9D6]"}`}
                  onClick={e => { e.stopPropagation(); toggleActive(lv.level_order); }}
                >
                  {inactive
                    ? <ToggleLeft size={18} color="#64748B" />
                    : <ToggleRight size={18} color="#2EC4B6" />
                  }
                </button>
                {isOpen
                  ? <ChevronUp size={16} color="#999" className="flex-shrink-0" />
                  : <ChevronDown size={16} color="#999" className="flex-shrink-0" />
                }
              </button>

              {isOpen && (
                <div className="px-4 pb-5 border-t border-[#F0F0F0]">
                  <div className="space-y-4 mt-4">
                    <div>
                      <label className="block text-[12px] text-[#888] mb-1.5">레벨 표시명</label>
                      <input
                        className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#2EC4B6] bg-white"
                        value={lv.level_name}
                        onChange={e => update(lv.level_order, "level_name", e.target.value)}
                        placeholder="예: 1, A, Beginner, 흰모자"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[#888] mb-1.5">레벨 설명</label>
                      <textarea
                        className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#2EC4B6] bg-white resize-none"
                        rows={2}
                        value={lv.level_description}
                        onChange={e => update(lv.level_order, "level_description", e.target.value)}
                        placeholder="이 레벨이 어떤 단계인지 간단히 설명"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[#888] mb-1.5">이 레벨에서 배우는 내용</label>
                      <textarea
                        className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#2EC4B6] bg-white resize-none"
                        rows={3}
                        value={lv.learning_content}
                        onChange={e => update(lv.level_order, "learning_content", e.target.value)}
                        placeholder="예: 자유형 킥, 배영 팔돌리기, 기초 호흡"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] text-[#888] mb-1.5">다음 레벨 승급 기준 / 테스트</label>
                      <textarea
                        className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#2EC4B6] bg-white resize-none"
                        rows={3}
                        value={lv.promotion_test_rule}
                        onChange={e => update(lv.level_order, "promotion_test_rule", e.target.value)}
                        placeholder="예: 자유형 25m 완주, 배영 15m 가능"
                      />
                    </div>

                    <div className="border-t border-[#F0F0F0] pt-4">
                      <p className="text-[14px] font-semibold text-[#0A0A0A] mb-3">뱃지 설정</p>

                      <div className="mb-4">
                        <label className="block text-[12px] text-[#888] mb-1.5">뱃지 형태</label>
                        <div className="flex gap-2">
                          {BADGE_TYPES.map(bt => (
                            <button
                              key={bt.key}
                              className="flex-1 py-2 rounded-lg border text-[13px] font-medium transition-colors"
                              style={lv.badge_type === bt.key
                                ? { background: "#2EC4B6", borderColor: "#2EC4B6", color: "#fff" }
                                : { background: "#fff", borderColor: "#E5E5E5", color: "#666" }}
                              onClick={() => setBadgeType(lv.level_order, bt.key)}
                            >
                              {bt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {lv.badge_type !== "icon" && (
                        <div className="mb-4">
                          <label className="block text-[12px] text-[#888] mb-1.5">뱃지 표시 텍스트</label>
                          <input
                            className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#2EC4B6] bg-white"
                            value={lv.badge_label}
                            onChange={e => setBadgeLabel(lv.level_order, e.target.value)}
                            placeholder="뱃지에 표시할 짧은 텍스트"
                            maxLength={6}
                          />
                        </div>
                      )}

                      <div className="mb-4">
                        <label className="block text-[12px] text-[#888] mb-2">뱃지 색상</label>
                        <div className="flex flex-wrap gap-2">
                          {BADGE_COLORS.map(col => (
                            <button
                              key={col.value}
                              className="w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all"
                              style={{
                                background: col.value,
                                borderColor: lv.badge_color === col.value ? "#333" : col.value === "#FFFFFF" ? "#E5E5E5" : col.value,
                                boxShadow: lv.badge_color === col.value ? "0 0 0 2px #fff, 0 0 0 4px #333" : "none",
                              }}
                              onClick={() => setBadgeColor(lv.level_order, col.value)}
                            >
                              {lv.badge_color === col.value && (
                                <Check size={12} color={isDarkColor(col.value) ? "#fff" : "#333"} />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[12px] text-[#888] mb-2">미리보기</label>
                        <div className="flex items-end gap-6 px-2">
                          {(["sm", "md", "lg"] as const).map((sz, i) => (
                            <div key={sz} className="flex flex-col items-center gap-1">
                              <BadgePreview lv={lv} size={sz} />
                              <span className="text-[11px] text-[#999]">{["소", "중", "대"][i]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {changed && (
        <button
          onClick={save}
          disabled={saving}
          className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60"
          style={{ background: "#0369A1" }}
        >
          {saving ? "저장 중..." : "변경사항 저장"}
        </button>
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-white text-[13px] font-semibold shadow-xl z-50 ${toast.ok ? "bg-[#059669]" : "bg-red-500"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
