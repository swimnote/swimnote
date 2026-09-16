/**
 * SuperAdsPage.tsx — PC 슈퍼관리자 배너 관리 (통합)
 * strip(상단 프로모션) + slider(카드 배너) 통합 관리.
 * 현재 PC Super Admin 디자인 유지 (DESIGN FREEZE).
 */
import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import {
  Eye, EyeOff, Clock, Trash2, Plus, RefreshCw,
  ChevronUp, ChevronDown, Edit2,
} from "lucide-react";

// ── 타입 ────────────────────────────────────────────────────────────────────
type BannerType = "strip" | "slider";
type BannerStatus = "active" | "scheduled" | "inactive";
type LinkType = "none" | "external" | "internal";

interface Banner {
  id: string;
  banner_type: BannerType;
  title: string;
  description?: string;
  image_url?: string;
  image_key?: string;
  link_type?: LinkType;
  link_url?: string;
  link_label?: string;
  color_theme?: string;
  status: BannerStatus;
  display_start?: string;
  display_end?: string;
  display_seconds?: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface FormState {
  banner_type: BannerType;
  title: string;
  description: string;
  link_type: LinkType;
  link_url: string;
  display_start: string;
  display_end: string;
  display_seconds: string;
  sort_order: string;
  status: BannerStatus;
  image_key: string;
  image_url: string;
}

const DEFAULT_FORM: FormState = {
  banner_type: "strip",
  title: "", description: "",
  link_type: "external", link_url: "",
  display_start: "", display_end: "",
  display_seconds: "5", sort_order: "0",
  status: "inactive",
  image_key: "", image_url: "",
};

// ── 상수 ────────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<BannerStatus, { label: string; icon: React.FC<any>; color: string; bg: string }> = {
  active:    { label: "노출 중", icon: Eye,      color: "#166534", bg: "#DCFCE7" },
  scheduled: { label: "예약됨", icon: Clock,    color: "#92400E", bg: "#FEF3C7" },
  inactive:  { label: "비활성", icon: EyeOff,   color: "#6B7280", bg: "#F3F4F6" },
};

const LINK_TYPE_LABELS: Record<LinkType, string> = {
  none: "링크 없음", external: "외부 URL", internal: "앱 내부",
};

function fmt(d?: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

function imagePreviewUrl(key?: string, url?: string): string {
  if (key) return `/api/uploads/${key}`;
  return url ?? "";
}

// ── Strip 미리보기 ──────────────────────────────────────────────────────────
function StripPreview({ form }: { form: FormState }) {
  const imgUrl = imagePreviewUrl(form.image_key, form.image_url);
  return (
    <div style={{
      background: imgUrl ? "#000" : "#EEF9FB",
      borderRadius: "10px", height: "72px", overflow: "hidden",
      position: "relative", display: "flex", alignItems: "center",
      justifyContent: "center", border: "1px solid #CBD5E1",
    }}>
      {imgUrl && (
        <img src={imgUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      )}
      {imgUrl && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.32)" }} />
      )}
      <div style={{ position: "relative", textAlign: "center", padding: "0 16px" }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: imgUrl ? "#fff" : "#163842", lineHeight: "1.4" }}>
          {form.title || "제목 없음"}
        </div>
        {form.description && (
          <div style={{ fontSize: "11px", color: imgUrl ? "rgba(255,255,255,0.85)" : "#1683A3", marginTop: "2px" }}>
            {form.description}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card 미리보기 ───────────────────────────────────────────────────────────
function CardPreview({ form }: { form: FormState }) {
  const imgUrl = imagePreviewUrl(form.image_key, form.image_url);
  return (
    <div style={{
      background: "#F8F9FA", borderRadius: "10px", overflow: "hidden",
      border: "1px solid #E8E8E8", height: "120px",
    }}>
      {imgUrl && (
        <img src={imgUrl} alt="" style={{ width: "100%", height: form.title ? "70px" : "120px", objectFit: "cover", display: "block" }} />
      )}
      {form.title && (
        <div style={{ padding: "8px 12px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#1B3A70" }}>{form.title}</div>
          {form.description && <div style={{ fontSize: "11px", color: "#6B7280", marginTop: "2px" }}>{form.description}</div>}
        </div>
      )}
    </div>
  );
}

// ── 배너 행 ─────────────────────────────────────────────────────────────────
function BannerRow({ banner, onEdit, onStatus, onDelete, onMoveUp, onMoveDown, canUp, canDown }: {
  banner: Banner;
  onEdit: (b: Banner) => void;
  onStatus: (id: string, s: BannerStatus) => void;
  onDelete: (id: string) => void;
  onMoveUp: (b: Banner) => void;
  onMoveDown: (b: Banner) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  const cfg = STATUS_CFG[banner.status];
  const StatusIcon = cfg.icon;
  const imgUrl = imagePreviewUrl(banner.image_key, banner.image_url);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "60px 1fr 80px 110px 90px 60px 80px",
      alignItems: "center", gap: "12px",
      padding: "10px 16px", borderBottom: "1px solid var(--border-default)",
    }}>
      {/* 썸네일 */}
      <div style={{ width: "56px", height: "36px", borderRadius: "6px", overflow: "hidden", background: "#F3F4F6", flexShrink: 0 }}>
        {imgUrl
          ? <img src={imgUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: "#9CA3AF" }}>없음</div>
        }
      </div>

      {/* 제목/메타 */}
      <div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong)", marginBottom: "2px" }}>{banner.title}</div>
        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          {banner.link_type !== "none" && banner.link_url ? `🔗 ${banner.link_url.slice(0, 30)}` : "링크 없음"}
        </div>
      </div>

      {/* 노출 기간 */}
      <div style={{ fontSize: "11px", color: "var(--text-muted)", textAlign: "center" }}>
        <div>{fmt(banner.display_start)}</div>
        <div>~ {fmt(banner.display_end)}</div>
      </div>

      {/* 상태 */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "8px", background: cfg.bg, width: "fit-content" }}>
        <StatusIcon size={11} color={cfg.color} />
        <span style={{ fontSize: "11px", color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
      </div>

      {/* 슬라이드 시간 */}
      <div style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center" }}>
        {banner.display_seconds ?? 5}초
      </div>

      {/* 순서 */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "center" }}>
        <button
          onClick={() => onMoveUp(banner)}
          disabled={!canUp}
          style={{ border: "none", background: "none", cursor: canUp ? "pointer" : "default", opacity: canUp ? 1 : 0.3, padding: "2px" }}
        >
          <ChevronUp size={14} color="var(--text-muted)" />
        </button>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", minWidth: "16px", textAlign: "center" }}>{banner.sort_order}</span>
        <button
          onClick={() => onMoveDown(banner)}
          disabled={!canDown}
          style={{ border: "none", background: "none", cursor: canDown ? "pointer" : "default", opacity: canDown ? 1 : 0.3, padding: "2px" }}
        >
          <ChevronDown size={14} color="var(--text-muted)" />
        </button>
      </div>

      {/* 액션 */}
      <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
        {banner.status !== "active" && (
          <button onClick={() => onStatus(banner.id, "active")}
            style={{ padding: "3px 8px", fontSize: "11px", border: "1px solid #16A34A", borderRadius: "6px", cursor: "pointer", background: "#DCFCE7", color: "#166534" }}>
            활성
          </button>
        )}
        {banner.status === "active" && (
          <button onClick={() => onStatus(banner.id, "inactive")}
            style={{ padding: "3px 8px", fontSize: "11px", border: "1px solid #D1D5DB", borderRadius: "6px", cursor: "pointer", background: "#F3F4F6", color: "#6B7280" }}>
            비활성
          </button>
        )}
        <button onClick={() => onEdit(banner)}
          style={{ padding: "3px 6px", fontSize: "11px", border: "1px solid var(--border-default)", borderRadius: "6px", cursor: "pointer", background: "#fff" }}>
          <Edit2 size={12} />
        </button>
        <button onClick={() => onDelete(banner.id)}
          style={{ padding: "3px 6px", fontSize: "11px", border: "1px solid #FECACA", borderRadius: "6px", cursor: "pointer", background: "#FEE2E2" }}>
          <Trash2 size={12} color="#DC2626" />
        </button>
      </div>
    </div>
  );
}

// ── 메인 ────────────────────────────────────────────────────────────────────
export default function SuperAdsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<BannerType>("strip");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...DEFAULT_FORM });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [imgUploading, setImgUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refetch } = useQuery<{ banners: Banner[] }>({
    queryKey: ["super-banners"],
    queryFn: () => api.get("/super/banners"),
  });

  const allBanners = data?.banners ?? [];
  const stripBanners = allBanners.filter(b => b.banner_type === "strip").sort((a, b) => a.sort_order - b.sort_order);
  const sliderBanners = allBanners.filter(b => b.banner_type === "slider").sort((a, b) => a.sort_order - b.sort_order);
  const currentList = tab === "strip" ? stripBanners : sliderBanners;

  const saveMut = useMutation({
    mutationFn: (payload: any) =>
      editId
        ? api.put(`/super/banners/${editId}`, payload)
        : api.post("/super/banners", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-banners"] });
      setSaveMsg("저장되었습니다.");
      setTimeout(() => setSaveMsg(""), 2000);
      setShowForm(false);
    },
    onError: (e: any) => setSaveMsg(`오류: ${(e as any).message ?? "서버 오류"}`),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BannerStatus }) =>
      api.patch(`/super/banners/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super-banners"] }),
  });

  const orderMut = useMutation({
    mutationFn: ({ id, sort_order }: { id: string; sort_order: number }) =>
      api.patch(`/super/banners/${id}/order`, { sort_order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["super-banners"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/super/banners/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-banners"] });
      setDeleteId(null);
    },
  });

  function openCreate() {
    setEditId(null);
    setForm({ ...DEFAULT_FORM, banner_type: tab });
    setSaveMsg("");
    setShowForm(true);
  }

  function openEdit(b: Banner) {
    setEditId(b.id);
    setForm({
      banner_type: b.banner_type,
      title: b.title,
      description: b.description ?? "",
      link_type: b.link_type ?? "external",
      link_url: b.link_url ?? "",
      display_start: b.display_start ? b.display_start.slice(0, 16) : "",
      display_end:   b.display_end   ? b.display_end.slice(0, 16)   : "",
      display_seconds: String(b.display_seconds ?? 5),
      sort_order: String(b.sort_order),
      status: b.status,
      image_key: b.image_key ?? "",
      image_url: b.image_url ?? "",
    });
    setSaveMsg("");
    setShowForm(true);
  }

  function handleSave() {
    if (!form.title.trim()) return;
    const payload: any = {
      banner_type:     form.banner_type,
      title:           form.title.trim(),
      description:     form.description.trim() || null,
      link_type:       form.link_type,
      link_url:        form.link_url.trim() || null,
      status:          form.status,
      display_start:   form.display_start ? new Date(form.display_start).toISOString() : null,
      display_end:     form.display_end   ? new Date(form.display_end).toISOString()   : null,
      display_seconds: Math.max(3, Math.min(30, parseInt(form.display_seconds) || 5)),
      sort_order:      parseInt(form.sort_order) || 0,
      image_key:       form.image_key || null,
      image_url:       form.image_url || null,
    };
    saveMut.mutate(payload);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) { alert("jpg/png/webp 파일만 가능합니다."); return; }
    setImgUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const json = await api.postForm<{ key: string; url: string }>("/super/banner-upload", fd);
      if (json.key) {
        setForm(f => ({ ...f, image_key: json.key, image_url: "" }));
      }
    } catch {
      alert("이미지 업로드 중 오류가 발생했습니다.");
    } finally {
      setImgUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleMoveUp(b: Banner) {
    const list = tab === "strip" ? stripBanners : sliderBanners;
    const idx = list.findIndex(x => x.id === b.id);
    if (idx <= 0) return;
    orderMut.mutate({ id: b.id, sort_order: list[idx].sort_order - 1 });
    orderMut.mutate({ id: list[idx - 1].id, sort_order: list[idx - 1].sort_order + 1 });
  }

  function handleMoveDown(b: Banner) {
    const list = tab === "strip" ? stripBanners : sliderBanners;
    const idx = list.findIndex(x => x.id === b.id);
    if (idx < 0 || idx >= list.length - 1) return;
    orderMut.mutate({ id: b.id, sort_order: list[idx].sort_order + 1 });
    orderMut.mutate({ id: list[idx + 1].id, sort_order: list[idx + 1].sort_order - 1 });
  }

  const imgPreview = form.image_key ? `/api/uploads/${form.image_key}` : form.image_url;

  return (
    <div style={{ padding: "24px", maxWidth: "1100px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--text-strong)" }}>배너 관리</h2>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-muted)" }}>
            학부모 홈 상단 프로모션 및 카드 배너를 관리합니다.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => refetch()}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "7px 12px", border: "1px solid var(--border-default)", borderRadius: "8px", background: "#fff", cursor: "pointer", fontSize: "12px" }}>
            <RefreshCw size={13} /> 새로고침
          </button>
          <button onClick={openCreate}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "7px 14px", border: "none", borderRadius: "8px", background: "#7C3AED", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
            <Plus size={14} /> 새 배너
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-default)", marginBottom: "16px" }}>
        {(["strip","slider"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: "10px 20px", border: "none", background: "none", cursor: "pointer",
              fontSize: "13px", fontWeight: tab === t ? 700 : 400,
              color: tab === t ? "#7C3AED" : "var(--text-muted)",
              borderBottom: tab === t ? "2px solid #7C3AED" : "2px solid transparent",
              marginBottom: "-1px",
            }}>
            {t === "strip" ? "상단 프로모션" : "카드 배너"}
            <span style={{
              marginLeft: "6px", padding: "1px 7px", borderRadius: "10px",
              background: tab === t ? "#EDE9FE" : "#F3F4F6",
              color: tab === t ? "#7C3AED" : "#6B7280", fontSize: "11px",
            }}>
              {t === "strip" ? stripBanners.length : sliderBanners.length}
            </span>
          </button>
        ))}
      </div>

      {/* 배너 안내 */}
      <div style={{ marginBottom: "12px", padding: "10px 14px", background: tab === "strip" ? "#DBEAFE" : "#EDE9FE", borderRadius: "8px", fontSize: "12px", color: tab === "strip" ? "#1E40AF" : "#5B21B6" }}>
        {tab === "strip"
          ? "상단 프로모션: 학부모 홈 상단 가로 배너. 여러 개 등록 시 각 display_seconds 시간대로 자동 순환."
          : "카드 배너: 학부모 홈 카드형 광고 슬롯. 여러 개 등록 시 스와이프 가능한 슬라이더로 표시."}
      </div>

      {/* 목록 */}
      <div style={{ background: "var(--surface-white)", border: "1px solid var(--border-default)", borderRadius: "10px", overflow: "hidden" }}>
        {/* 컬럼 헤더 */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr 80px 110px 90px 60px 80px",
          gap: "12px", padding: "8px 16px",
          background: "var(--surface-subtle)", borderBottom: "1px solid var(--border-default)",
          fontSize: "11px", fontWeight: 600, color: "var(--text-muted)",
        }}>
          <span>썸네일</span><span>제목</span><span style={{ textAlign: "center" }}>노출 기간</span>
          <span>상태</span><span style={{ textAlign: "center" }}>노출 시간</span>
          <span style={{ textAlign: "center" }}>순서</span><span style={{ textAlign: "right" }}>액션</span>
        </div>

        {isLoading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>불러오는 중...</div>
        ) : currentList.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
            등록된 배너가 없습니다. "새 배너" 버튼으로 추가하세요.
          </div>
        ) : (
          currentList.map((b, i) => (
            <BannerRow
              key={b.id} banner={b}
              onEdit={openEdit}
              onStatus={(id, s) => statusMut.mutate({ id, status: s })}
              onDelete={id => setDeleteId(id)}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              canUp={i > 0}
              canDown={i < currentList.length - 1}
            />
          ))
        )}
      </div>

      {/* 등록/수정 사이드 패널 */}
      {showForm && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "480px",
          background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
          zIndex: 1000, display: "flex", flexDirection: "column", overflowY: "auto",
        }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-strong)" }}>
              {editId ? "배너 수정" : "새 배너 등록"}
            </div>
            <button onClick={() => setShowForm(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: "18px", color: "var(--text-muted)" }}>✕</button>
          </div>

          <div style={{ padding: "20px 24px", flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>

            {/* 배너 유형 (신규만) */}
            {!editId && (
              <div>
                <Label>배너 위치</Label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["strip","slider"] as const).map(t => (
                    <ChipBtn key={t} active={form.banner_type === t} onClick={() => setForm(f => ({ ...f, banner_type: t }))}>
                      {t === "strip" ? "상단 프로모션" : "카드 배너"}
                    </ChipBtn>
                  ))}
                </div>
              </div>
            )}

            {/* 미리보기 */}
            <div>
              <Label>미리보기</Label>
              {form.banner_type === "strip"
                ? <StripPreview form={form} />
                : <CardPreview form={form} />}
            </div>

            {/* 이미지 */}
            <div>
              <Label>배너 이미지 (선택 · jpg/png/webp)</Label>
              {imgPreview && (
                <div style={{ marginBottom: "8px", position: "relative" }}>
                  <img src={imgPreview} alt="" style={{ width: "100%", height: "100px", objectFit: "cover", borderRadius: "8px" }} />
                  <button onClick={() => setForm(f => ({ ...f, image_key: "", image_url: "" }))}
                    style={{ position: "absolute", top: "6px", right: "6px", border: "none", borderRadius: "50%", width: "22px", height: "22px", background: "rgba(0,0,0,0.5)", color: "#fff", cursor: "pointer", fontSize: "12px" }}>
                    ✕
                  </button>
                </div>
              )}
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={handleFileChange} />
              <button onClick={() => fileRef.current?.click()} disabled={imgUploading}
                style={{ width: "100%", padding: "8px", border: "1.5px dashed #7C3AED", borderRadius: "8px", background: "none", cursor: "pointer", color: "#7C3AED", fontSize: "12px" }}>
                {imgUploading ? "업로드 중..." : imgPreview ? "이미지 변경" : "이미지 선택"}
              </button>
            </div>

            {/* 제목 */}
            <div>
              <Label>제목 *</Label>
              <input style={inputStyle} value={form.title} placeholder="배너 제목 (최대 60자)"
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} maxLength={60} />
            </div>

            {/* 설명 */}
            <div>
              <Label>설명 (선택)</Label>
              <textarea style={{ ...inputStyle, height: "60px", resize: "vertical" }} value={form.description}
                placeholder="배너 설명" onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            {/* 링크 유형 */}
            <div>
              <Label>링크 유형</Label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {(["none","external","internal"] as const).map(lt => (
                  <ChipBtn key={lt} active={form.link_type === lt} onClick={() => setForm(f => ({ ...f, link_type: lt }))}>
                    {LINK_TYPE_LABELS[lt]}
                  </ChipBtn>
                ))}
              </div>
            </div>
            {form.link_type !== "none" && (
              <div>
                <Label>{form.link_type === "external" ? "외부 URL (https://)" : "앱 내부 경로"}</Label>
                <input style={inputStyle} value={form.link_url}
                  placeholder={form.link_type === "external" ? "https://..." : "/(parent)/notices"}
                  onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))} />
              </div>
            )}

            {/* 노출 기간 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <Label>노출 시작일시 (빈칸=제한 없음)</Label>
                <input type="datetime-local" style={inputStyle} value={form.display_start}
                  onChange={e => setForm(f => ({ ...f, display_start: e.target.value }))} />
              </div>
              <div>
                <Label>노출 종료일시 (빈칸=제한 없음)</Label>
                <input type="datetime-local" style={inputStyle} value={form.display_end}
                  onChange={e => setForm(f => ({ ...f, display_end: e.target.value }))} />
              </div>
            </div>

            {/* 슬라이드 노출 시간 + 순서 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <Label>슬라이드 노출 시간 (초, 3~30)</Label>
                <input type="number" min={3} max={30} style={inputStyle} value={form.display_seconds}
                  onChange={e => setForm(f => ({ ...f, display_seconds: e.target.value }))} />
              </div>
              <div>
                <Label>노출 순서 (작을수록 먼저)</Label>
                <input type="number" style={inputStyle} value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
              </div>
            </div>

            {/* 상태 */}
            <div>
              <Label>상태</Label>
              <div style={{ display: "flex", gap: "8px" }}>
                {(["inactive","scheduled","active"] as const).map(st => (
                  <ChipBtn key={st} active={form.status === st} onClick={() => setForm(f => ({ ...f, status: st }))}>
                    {STATUS_CFG[st].label}
                  </ChipBtn>
                ))}
              </div>
            </div>
          </div>

          {/* 저장 버튼 */}
          <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-default)", display: "flex", gap: "8px", alignItems: "center" }}>
            {saveMsg && (
              <span style={{ flex: 1, fontSize: "12px", color: saveMsg.startsWith("오류") ? "#991B1B" : "#166534" }}>{saveMsg}</span>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowForm(false)}
              style={{ padding: "8px 16px", border: "1px solid var(--border-default)", borderRadius: "8px", background: "#fff", cursor: "pointer", fontSize: "13px" }}>
              취소
            </button>
            <button onClick={handleSave} disabled={saveMut.isPending || !form.title.trim()}
              style={{ padding: "8px 20px", border: "none", borderRadius: "8px", background: "#7C3AED", color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 600, opacity: (saveMut.isPending || !form.title.trim()) ? 0.5 : 1 }}>
              {saveMut.isPending ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      )}

      {/* 삭제 확인 */}
      {deleteId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "12px", padding: "24px", maxWidth: "360px", width: "90%" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "10px" }}>배너 삭제</div>
            <div style={{ fontSize: "13px", color: "var(--text-body)", marginBottom: "20px" }}>
              이 배너를 삭제하시겠습니까? 복구되지 않습니다.
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteId(null)}
                style={{ padding: "8px 16px", border: "1px solid var(--border-default)", borderRadius: "8px", background: "#fff", cursor: "pointer" }}>
                취소
              </button>
              <button onClick={() => deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}
                style={{ padding: "8px 16px", border: "none", borderRadius: "8px", background: "#DC2626", color: "#fff", cursor: "pointer" }}>
                {deleteMut.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 헬퍼 컴포넌트 ───────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "5px" }}>
      {children}
    </div>
  );
}

function ChipBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: "20px", fontSize: "12px", cursor: "pointer",
      border: active ? "1.5px solid #7C3AED" : "1px solid var(--border-default)",
      background: active ? "#EDE9FE" : "#fff",
      color: active ? "#7C3AED" : "var(--text-body)",
      fontWeight: active ? 600 : 400,
    }}>
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", height: "34px", padding: "0 10px",
  border: "1px solid var(--border-default)", borderRadius: "8px",
  fontSize: "13px", boxSizing: "border-box", background: "#FAFAFA",
};
