/**
 * WP15.5-C — SuperAdmin 광고 Creative 관리
 * PARENT_HOME_BANNER 슬롯 기준 Creative CRUD UI
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const PRIMARY = "#4f46e5";
const PLACEMENTS = ["PARENT_HOME_BANNER", "PARENT_FEED_INLINE", "PARENT_REPORT", "PARENT_NOTICE"] as const;
// TEXT/IMAGE/IMAGE_WITH_TEXT: 앱에서 실제 지원.
// ANIMATED/SLIDESHOW/SHORT_VIDEO: 저장은 가능하나 앱 렌더 미지원 → "준비중" 표시.
const CREATIVE_TYPES = ["TEXT", "IMAGE", "IMAGE_WITH_TEXT", "ANIMATED", "SLIDESHOW", "SHORT_VIDEO"] as const;
const SUPPORTED_CREATIVE_TYPES = new Set(["TEXT", "IMAGE", "IMAGE_WITH_TEXT"]);

// NONE/FADE: 앱에서 실제 지원. SLIDE/CAROUSEL: DB 저장만, 앱 효과 없음 → 선택 불가.
const EFFECT_TYPES = ["NONE", "FADE", "SLIDE", "CAROUSEL"] as const;
const SUPPORTED_EFFECTS = new Set(["NONE", "FADE"]);
const AGE_BANDS = ["preschool", "elementary_lower", "elementary_upper", "middle_school_plus"] as const;

interface AdCreative {
  id: string;
  placement: string;
  creative_type: string;
  headline?: string;
  body_text?: string;
  image_url?: string;
  destination_url?: string;
  effect_type: string;
  display_order: number;
  is_active: boolean;
  target_region: string[];
  target_age_band: string[];
  created_at: string;
  updated_at: string;
}

const EMPTY_FORM = {
  placement: "PARENT_HOME_BANNER" as string,
  creative_type: "IMAGE_WITH_TEXT" as string,
  headline: "",
  body_text: "",
  image_url: "",
  destination_url: "",
  effect_type: "NONE" as string,
  display_order: 0,
  target_age_band: [] as string[],
};

function ToggleBand({ band, selected, onChange }: { band: string; selected: string[]; onChange: (v: string[]) => void }) {
  const on = selected.includes(band);
  return (
    <button
      type="button"
      onClick={() => onChange(on ? selected.filter(b => b !== band) : [...selected, band])}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
        on ? "text-white border-transparent" : "bg-white border-[#d0d0d0] text-[#555]"
      }`}
      style={on ? { background: PRIMARY } : {}}
    >
      {band}
    </button>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
      active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
    }`}>
      {active ? "활성" : "비활성"}
    </span>
  );
}

export default function AdCreativeManager() {
  const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [filterPlacement, setFilterPlacement] = useState("PARENT_HOME_BANNER");

  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await api.get<{ creatives: AdCreative[] }>(
        `/super/ad-creatives?placement=${filterPlacement}`,
      );
      setCreatives(data.creatives ?? []);
    } catch (e: any) { setError(e?.message ?? "조회 실패"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [filterPlacement]); // eslint-disable-line

  function startEdit(c: AdCreative) {
    setEditId(c.id);
    setForm({
      placement: c.placement,
      creative_type: c.creative_type,
      headline: c.headline ?? "",
      body_text: c.body_text ?? "",
      image_url: c.image_url ?? "",
      destination_url: c.destination_url ?? "",
      effect_type: c.effect_type,
      display_order: c.display_order,
      target_age_band: c.target_age_band ?? [],
    });
  }

  function cancelEdit() { setEditId(null); setForm(EMPTY_FORM); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editId) {
        await api.post(`/super/ad-creatives/${editId}/update`, form);
      } else {
        await api.post<unknown>("/super/ad-creatives", form);
      }
      cancelEdit();
      await load();
    } catch (e: any) { alert(e?.message ?? "저장 실패"); }
    finally { setSubmitting(false); }
  }

  async function toggleActive(c: AdCreative) {
    try {
      await api.post(`/super/ad-creatives/${c.id}/update`, { is_active: !c.is_active });
      await load();
    } catch (e: any) { alert(e?.message ?? "변경 실패"); }
  }

  const F = form;
  const set = (k: keyof typeof EMPTY_FORM, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="p-6 max-w-[960px]">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-[17px] font-bold text-[#0a0a0a]">광고 Creative 관리</h2>
          <p className="text-[12px] text-[#888] mt-0.5">슬롯별 Creative를 생성·수정합니다.</p>
        </div>
        {/* Placement 필터 */}
        <div className="flex gap-1.5 flex-wrap">
          {PLACEMENTS.map(p => (
            <button key={p} onClick={() => setFilterPlacement(p)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
                filterPlacement === p ? "text-white border-transparent" : "bg-white border-[#d0d0d0] text-[#555]"
              }`}
              style={filterPlacement === p ? { background: PRIMARY } : {}}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-600">{error}</div>
      )}

      {/* ── Creative 목록 ─────────────────────────────────────── */}
      {loading ? (
        <p className="text-[13px] text-[#aaa] py-8 text-center">조회 중…</p>
      ) : creatives.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-[#aaa] border border-dashed border-[#d0d0d0] rounded-xl">
          이 슬롯에 등록된 Creative가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-6">
          {creatives.map(c => (
            <div key={c.id} className="bg-white rounded-xl border border-[#ebebeb] px-5 py-4">
              <div className="flex items-start gap-3 flex-wrap">
                {c.image_url && (
                  <img src={c.image_url} alt="" className="w-16 h-16 rounded-lg object-cover border border-[#ebebeb] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[12px] font-bold text-[#0a0a0a] truncate">{c.headline || "—"}</span>
                    <StatusBadge active={c.is_active} />
                    <span className="text-[10px] bg-[#f0f0f0] text-[#666] px-2 py-0.5 rounded-full">{c.creative_type}</span>
                    <span className="text-[10px] bg-[#f0f0f0] text-[#666] px-2 py-0.5 rounded-full">order: {c.display_order}</span>
                  </div>
                  {c.body_text && <p className="text-[12px] text-[#666] line-clamp-2">{c.body_text}</p>}
                  {c.destination_url && (
                    <a href={c.destination_url} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-blue-500 underline break-all">{c.destination_url}</a>
                  )}
                  {c.target_age_band.length > 0 && (
                    <p className="text-[11px] text-[#aaa] mt-1">연령: {c.target_age_band.join(", ")}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => startEdit(c)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#d0d0d0] bg-white text-[#333] hover:bg-[#f5f5f5]">
                    수정
                  </button>
                  <button onClick={() => toggleActive(c)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-medium text-white ${
                      c.is_active ? "bg-gray-400 hover:bg-gray-500" : "hover:opacity-80"
                    }`}
                    style={c.is_active ? {} : { background: PRIMARY }}>
                    {c.is_active ? "비활성화" : "활성화"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 생성/수정 폼 ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#ebebeb] p-5">
        <h3 className="text-[14px] font-bold text-[#0a0a0a] mb-4">
          {editId ? "Creative 수정" : "새 Creative 등록"}
        </h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Placement */}
          <div>
            <label className="block text-[12px] font-medium text-[#555] mb-1">Placement</label>
            <select value={F.placement} onChange={e => set("placement", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] bg-white text-[#333]">
              {PLACEMENTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Creative Type */}
          <div>
            <label className="block text-[12px] font-medium text-[#555] mb-1">Creative 타입</label>
            <select value={F.creative_type} onChange={e => set("creative_type", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] bg-white text-[#333]">
              {CREATIVE_TYPES.map(t => (
                <option key={t} value={t} disabled={!SUPPORTED_CREATIVE_TYPES.has(t)}>
                  {t}{!SUPPORTED_CREATIVE_TYPES.has(t) ? " (준비중)" : ""}
                </option>
              ))}
            </select>
            {!SUPPORTED_CREATIVE_TYPES.has(F.creative_type) && (
              <p className="text-[10px] text-amber-600 mt-1">이 타입은 아직 앱에서 렌더링을 지원하지 않습니다.</p>
            )}
          </div>

          {/* Headline */}
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#555] mb-1">헤드라인</label>
            <input value={F.headline} onChange={e => set("headline", e.target.value)} maxLength={60}
              placeholder="최대 60자"
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] text-[#333]" />
          </div>

          {/* Body */}
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#555] mb-1">본문</label>
            <textarea value={F.body_text} onChange={e => set("body_text", e.target.value)} rows={2} maxLength={150}
              placeholder="최대 150자"
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] text-[#333] resize-none" />
          </div>

          {/* Image URL */}
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#555] mb-1">이미지 URL</label>
            <input value={F.image_url} onChange={e => set("image_url", e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] text-[#333]" />
          </div>

          {/* Destination URL */}
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#555] mb-1">랜딩 URL</label>
            <input value={F.destination_url} onChange={e => set("destination_url", e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] text-[#333]" />
          </div>

          {/* Effect + Order */}
          <div>
            <label className="block text-[12px] font-medium text-[#555] mb-1">Effect</label>
            <select value={F.effect_type} onChange={e => set("effect_type", e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] bg-white text-[#333]">
              {EFFECT_TYPES.map(t => (
                <option key={t} value={t} disabled={!SUPPORTED_EFFECTS.has(t)}>
                  {t}{!SUPPORTED_EFFECTS.has(t) ? " (준비중)" : ""}
                </option>
              ))}
            </select>
            {!SUPPORTED_EFFECTS.has(F.effect_type) && (
              <p className="text-[10px] text-amber-600 mt-1">이 효과는 아직 앱에서 지원하지 않습니다. NONE 또는 FADE를 사용하세요.</p>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#555] mb-1">표시 순서</label>
            <input type="number" min={0} max={999} value={F.display_order}
              onChange={e => set("display_order", Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-[#d0d0d0] text-[13px] text-[#333]" />
          </div>

          {/* Age Band */}
          <div className="sm:col-span-2">
            <label className="block text-[12px] font-medium text-[#555] mb-2">연령 타겟 (미선택 = 전체)</label>
            <div className="flex gap-2 flex-wrap">
              {AGE_BANDS.map(b => (
                <ToggleBand key={b} band={b} selected={F.target_age_band}
                  onChange={v => set("target_age_band", v)} />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="sm:col-span-2 flex gap-3 justify-end pt-2">
            {editId && (
              <button type="button" onClick={cancelEdit}
                className="px-4 py-2 rounded-lg text-[13px] font-medium border border-[#d0d0d0] bg-white text-[#555] hover:bg-[#f5f5f5]">
                취소
              </button>
            )}
            <button type="submit" disabled={submitting}
              className="px-5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: PRIMARY }}>
              {submitting ? "저장 중…" : editId ? "수정 저장" : "Creative 등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
