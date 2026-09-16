/**
 * (super)/ads.tsx — 배너 관리 (통합)
 * strip(상단 프로모션) + slider(카드 배너) 통합 관리.
 * 슈퍼관리자 전용.
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { compressImageIfNeeded } from "../../utils/compressImage";
import {
  ActivityIndicator, Alert, Image as RNImage, Modal,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { API_BASE } from "@/context/AuthContext";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAdsStore, type Ad, type AdStatus, type BannerType, type LinkType } from "@/store/adsStore";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";

const STATUS_CFG: Record<AdStatus, { label: string; color: string; bg: string; icon: string }> = {
  active:    { label: "노출 중",  color: C.brandStrong, bg: C.brandSoft, icon: "eye" },
  scheduled: { label: "예약됨",  color: "#D97706", bg: "#FFF1BF", icon: "clock" },
  inactive:  { label: "비활성",  color: C.textSecondary, bg: "#FFFFFF", icon: "eye-off" },
};

const TARGET_LABELS: Record<string, string> = {
  all: "전체", parent: "학부모", teacher: "선생님", admin: "관리자",
};

const LINK_TYPE_LABELS: Record<LinkType, string> = {
  none: "링크 없음", external: "외부 URL", internal: "앱 내부",
};

const THEMES = ["teal","purple","orange","blue","green","red","pink"] as const;
const THEME_COLORS: Record<string, string> = {
  teal: C.brandStrong, purple: "#7C3AED", orange: "#F97316",
  blue: "#2563EB", green: "#059669", red: "#DC2626", pink: "#DB2777",
};
const THEME_BG: Record<string, string> = {
  teal: C.brandSoft, purple: "#EDE9FE", orange: "#FFF7ED",
  blue: "#DBEAFE", green: "#D1FAE5", red: "#FEE2E2", pink: "#FCE7F3",
};

type BannerTab = "strip" | "slider";
type StatusFilter = "all" | AdStatus;

function imageUrl(key: string) {
  if (!key) return "";
  if (key.startsWith("http")) return key;
  return `${API_BASE}/uploads/${key}`;
}

// ── 배너 카드 ──────────────────────────────────────────────────────────────
function AdCard({ ad, onEdit, onStatusChange, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }: {
  ad: Ad;
  onEdit: (ad: Ad) => void;
  onStatusChange: (id: string, s: AdStatus) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const cfg = STATUS_CFG[ad.status];
  const img = ad.imageKey ? imageUrl(ad.imageKey) : (ad.imageUrl || "");
  const typeLabel = ad.bannerType === "strip" ? "상단" : "카드";

  return (
    <View style={ac.card}>
      <View style={ac.top}>
        <View style={[ac.statusDot, { backgroundColor: cfg.color }]} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={ac.title} numberOfLines={1}>{ad.title}</Text>
            <View style={[ac.typePill, { backgroundColor: ad.bannerType === "strip" ? "#DBEAFE" : "#EDE9FE" }]}>
              <Text style={[ac.typeTxt, { color: ad.bannerType === "strip" ? "#1E40AF" : "#5B21B6" }]}>{typeLabel}</Text>
            </View>
          </View>
          <Text style={ac.meta}>순서 {ad.sortOrder} · {ad.displaySeconds}초</Text>
        </View>
        <View style={[ac.badge, { backgroundColor: cfg.bg }]}>
          <LucideIcon name={cfg.icon} size={11} color={cfg.color} />
          <Text style={[ac.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      {img ? <RNImage source={{ uri: img }} style={ac.cardImg} resizeMode="cover" /> : null}
      {ad.description ? <Text style={ac.desc} numberOfLines={2}>{ad.description}</Text> : null}
      {ad.linkUrl ? (
        <Text style={ac.linkTxt} numberOfLines={1}>{LINK_TYPE_LABELS[ad.linkType] ?? ad.linkType} · {ad.linkUrl}</Text>
      ) : null}
      <View style={ac.actions}>
        {/* 순서 변경 */}
        <Pressable style={[ac.iconBtn, !canMoveUp && { opacity: 0.3 }]}
          onPress={() => canMoveUp && onMoveUp(ad.id)} disabled={!canMoveUp}>
          <LucideIcon name="chevron-up" size={14} color={C.textSecondary} />
        </Pressable>
        <Pressable style={[ac.iconBtn, !canMoveDown && { opacity: 0.3 }]}
          onPress={() => canMoveDown && onMoveDown(ad.id)} disabled={!canMoveDown}>
          <LucideIcon name="chevron-down" size={14} color={C.textSecondary} />
        </Pressable>
        {ad.status !== "active" && (
          <Pressable style={[ac.btn, { backgroundColor: C.brandSoft }]} onPress={() => onStatusChange(ad.id, "active")}>
            <Text style={[ac.btnTxt, { color: C.brandStrong }]}>활성화</Text>
          </Pressable>
        )}
        {ad.status !== "inactive" && (
          <Pressable style={[ac.btn, { backgroundColor: "#FFFFFF" }]} onPress={() => onStatusChange(ad.id, "inactive")}>
            <Text style={[ac.btnTxt, { color: C.textSecondary }]}>비활성</Text>
          </Pressable>
        )}
        <Pressable style={[ac.btn, { backgroundColor: "#FFFFFF" }]} onPress={() => onEdit(ad)}>
          <Text style={[ac.btnTxt, { color: C.textPrimary }]}>수정</Text>
        </Pressable>
        <Pressable style={[ac.btn, { backgroundColor: "#FEE2E2" }]} onPress={() => onDelete(ad.id)}>
          <Text style={[ac.btnTxt, { color: "#DC2626" }]}>삭제</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ac = StyleSheet.create({
  card:      { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: C.border },
  top:       { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  title:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary, flex: 1 },
  meta:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },
  typePill:  { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  typeTxt:   { fontSize: 10, fontFamily: "Pretendard-Regular" },
  badge:     { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  badgeTxt:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  desc:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  linkTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  actions:   { flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" },
  iconBtn:   { padding: 6, borderRadius: 8, backgroundColor: "#F3F4F6" },
  btn:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardImg:   { width: "100%", height: 100, borderRadius: 8 },
});

// ── 폼 상태 ────────────────────────────────────────────────────────────────
interface FormState {
  bannerType: BannerType;
  title: string; description: string;
  linkType: LinkType; linkUrl: string; linkLabel: string;
  displayStart: string; displayEnd: string;
  displaySeconds: string;
  status: AdStatus; target: Ad["target"];
  imageUri: string; imageKey: string; imageUrl: string;
  colorTheme: string; sortOrder: string;
}

function blankForm(bannerType: BannerType = "slider"): FormState {
  return {
    bannerType,
    title: "", description: "",
    linkType: "external", linkUrl: "", linkLabel: "",
    displayStart: "", displayEnd: "",
    displaySeconds: "5",
    status: "scheduled", target: "all",
    imageUri: "", imageKey: "", imageUrl: "",
    colorTheme: "teal", sortOrder: "0",
  };
}

// ── 메인 ──────────────────────────────────────────────────────────────────
export default function AdsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const ads        = useAdsStore(s => s.ads);
  const stripAds   = useAdsStore(s => s.stripAds);
  const loading    = useAdsStore(s => s.loading);
  const fetchAll   = useAdsStore(s => s.fetchAllBanners);
  const uploadImg  = useAdsStore(s => s.uploadImage);
  const createAd   = useAdsStore(s => s.createAd);
  const updateAd   = useAdsStore(s => s.updateAd);
  const setStatus  = useAdsStore(s => s.setStatus);
  const reorderAd  = useAdsStore(s => s.reorderAd);
  const deleteAd   = useAdsStore(s => s.deleteAd);

  const [tab, setTab] = useState<BannerTab>("strip");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm("strip"));
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (token) fetchAll(token); }, [token]);

  const current = tab === "strip" ? stripAds : ads;
  const filtered = useMemo(() => {
    if (statusFilter === "all") return current;
    return current.filter(a => a.status === statusFilter);
  }, [current, statusFilter]);

  function openCreate() {
    setEditId(null);
    setForm(blankForm(tab));
    setShowModal(true);
  }

  function openEdit(ad: Ad) {
    setEditId(ad.id);
    setForm({
      bannerType: ad.bannerType,
      title: ad.title, description: ad.description,
      linkType: ad.linkType, linkUrl: ad.linkUrl, linkLabel: ad.linkLabel,
      displayStart: ad.displayStart ? ad.displayStart.slice(0, 10) : "",
      displayEnd:   ad.displayEnd   ? ad.displayEnd.slice(0, 10)   : "",
      displaySeconds: String(ad.displaySeconds ?? 5),
      status: ad.status, target: ad.target,
      imageUri: "", imageKey: ad.imageKey, imageUrl: ad.imageUrl,
      colorTheme: ad.colorTheme,
      sortOrder: String(ad.sortOrder ?? 0),
    });
    setShowModal(true);
  }

  async function handlePickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "사진 라이브러리 접근 권한이 필요합니다."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsEditing: true, aspect: [4, 3], quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const uri = await compressImageIfNeeded(asset.uri, asset.fileSize ?? undefined);
      setForm(f => ({ ...f, imageUri: uri, imageKey: "", imageUrl: "" }));
    }
  }

  async function handleSave() {
    if (!form.title.trim() || !token) return;
    setSaving(true);
    try {
      let finalKey = form.imageKey;
      let finalUrl = form.imageUrl;
      if (form.imageUri) {
        setUploading(true);
        const up = await uploadImg(token, form.imageUri, `banner_${Date.now()}.jpg`, "image/jpeg");
        setUploading(false);
        if (up) { finalKey = up.key; finalUrl = up.url; }
      }
      const params = {
        bannerType:    form.bannerType,
        title:         form.title.trim(),
        description:   form.description.trim() || undefined,
        imageKey:      finalKey, imageUrl:      finalUrl,
        linkType:      form.linkType,
        linkUrl:       form.linkUrl.trim() || undefined,
        linkLabel:     form.linkLabel.trim() || undefined,
        displayStart:  form.displayStart ? new Date(form.displayStart).toISOString() : null,
        displayEnd:    form.displayEnd   ? new Date(form.displayEnd).toISOString()   : null,
        displaySeconds: Math.max(3, Math.min(30, parseInt(form.displaySeconds) || 5)),
        colorTheme:    form.colorTheme,
        target:        form.target,
        status:        form.status,
        sortOrder:     parseInt(form.sortOrder) || 0,
      };
      if (editId) await updateAd(token, editId, params);
      else         await createAd(token, params);
      setShowModal(false);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  function handleMoveUp(id: string) {
    if (!token) return;
    const list = tab === "strip" ? stripAds : ads;
    const idx = list.findIndex(a => a.id === id);
    if (idx <= 0) return;
    reorderAd(token, id, list[idx].sortOrder - 1);
    reorderAd(token, list[idx - 1].id, list[idx - 1].sortOrder + 1);
  }

  function handleMoveDown(id: string) {
    if (!token) return;
    const list = tab === "strip" ? stripAds : ads;
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0 || idx >= list.length - 1) return;
    reorderAd(token, id, list[idx].sortOrder + 1);
    reorderAd(token, list[idx + 1].id, list[idx + 1].sortOrder - 1);
  }

  const FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "active", label: "노출 중" },
    { key: "scheduled", label: "예약" },
    { key: "inactive", label: "비활성" },
  ];

  const imgPreview = form.imageUri || (form.imageKey ? imageUrl(form.imageKey) : form.imageUrl);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="배너 관리" homePath="/(super)/dashboard" />

      {/* 배너 유형 탭 */}
      <View style={s.tabs}>
        {(["strip","slider"] as const).map(t => (
          <Pressable key={t} style={[s.tab, tab === t && s.tabActive]}
            onPress={() => { setTab(t); setStatusFilter("all"); }}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
              {t === "strip" ? "상단 프로모션" : "카드 배너"}
            </Text>
            <View style={[s.tabBadge, { backgroundColor: tab === t ? "#fff4" : "#0001" }]}>
              <Text style={[s.tabBadgeTxt, tab === t && { color: "#fff" }]}>
                {t === "strip" ? stripAds.length : ads.length}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* 상태 필터 + 등록 버튼 */}
      <View style={s.filterRow}>
        <KeyboardAwareScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {FILTERS.map(f => (
              <Pressable key={f.key} style={[s.filterBtn, statusFilter === f.key && s.filterBtnActive]}
                onPress={() => setStatusFilter(f.key)}>
                <Text style={[s.filterTxt, statusFilter === f.key && s.filterTxtActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </KeyboardAwareScrollView>
        <Pressable style={s.addBtn} onPress={openCreate}>
          <LucideIcon name="plus" size={16} color="#fff" />
          <Text style={s.addTxt}>등록</Text>
        </Pressable>
      </View>

      {/* 목록 */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={P} />
        </View>
      ) : (
        <KeyboardAwareScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}
        >
          {filtered.length === 0 ? (
            <View style={s.empty}>
              <LucideIcon name="image" size={36} color="#D1D5DB" />
              <Text style={s.emptyTxt}>등록된 배너가 없습니다</Text>
            </View>
          ) : (
            filtered.map((ad, i) => (
              <AdCard
                key={ad.id} ad={ad}
                onEdit={openEdit}
                onStatusChange={(id, st) => token && setStatus(token, id, st)}
                onDelete={(id) => setDeleteConfirm(id)}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                canMoveUp={i > 0}
                canMoveDown={i < filtered.length - 1}
              />
            ))
          )}
        </KeyboardAwareScrollView>
      )}

      {/* 등록/수정 모달 */}
      <Modal visible={showModal} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowModal(false)}>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.header}>
              <Text style={m.title}>{editId ? "배너 수정" : "배너 등록"}</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <LucideIcon name="x" size={20} color={C.textSecondary} />
              </Pressable>
            </View>
            <KeyboardAwareScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* 배너 유형 */}
              {!editId && (
                <>
                  <Text style={m.label}>배너 위치</Text>
                  <View style={m.segRow}>
                    {(["strip","slider"] as const).map(t => (
                      <Pressable key={t} style={[m.segBtn, form.bannerType === t && m.segActive]}
                        onPress={() => setForm(f => ({ ...f, bannerType: t }))}>
                        <Text style={[m.segTxt, form.bannerType === t && m.segActiveTxt]}>
                          {t === "strip" ? "상단 프로모션" : "카드 배너"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {/* 이미지 */}
              <Text style={m.label}>배너 이미지 (선택)</Text>
              {imgPreview ? (
                <RNImage source={{ uri: imgPreview }} style={m.imgPreview} resizeMode="cover" />
              ) : null}
              <Pressable style={m.imgBtn} onPress={handlePickImage}>
                <LucideIcon name="camera" size={15} color={P} />
                <Text style={m.imgBtnTxt}>{imgPreview ? "이미지 변경" : "이미지 선택"}</Text>
              </Pressable>
              {imgPreview ? (
                <Pressable onPress={() => setForm(f => ({ ...f, imageUri: "", imageKey: "", imageUrl: "" }))} style={m.removeImg}>
                  <LucideIcon name="x" size={11} color="#DC2626" />
                  <Text style={m.removeImgTxt}>이미지 제거</Text>
                </Pressable>
              ) : null}

              {/* 제목 */}
              <Text style={m.label}>제목 *</Text>
              <TextInput style={m.input} value={form.title}
                onChangeText={v => setForm(f => ({ ...f, title: v }))}
                placeholder="배너 제목" maxLength={60} />

              {/* 설명 */}
              <Text style={m.label}>설명 (선택)</Text>
              <TextInput style={[m.input, { height: 72, textAlignVertical: "top" }]}
                value={form.description} multiline
                onChangeText={v => setForm(f => ({ ...f, description: v }))}
                placeholder="배너 내용 설명" />

              {/* 링크 유형 */}
              <Text style={m.label}>링크 유형</Text>
              <View style={m.segRow}>
                {(["none","external","internal"] as const).map(lt => (
                  <Pressable key={lt} style={[m.segBtn, form.linkType === lt && m.segActive]}
                    onPress={() => setForm(f => ({ ...f, linkType: lt }))}>
                    <Text style={[m.segTxt, form.linkType === lt && m.segActiveTxt]}>{LINK_TYPE_LABELS[lt]}</Text>
                  </Pressable>
                ))}
              </View>
              {form.linkType !== "none" && (
                <>
                  <Text style={m.label}>{form.linkType === "external" ? "링크 URL (https://)" : "앱 내부 경로"}</Text>
                  <TextInput style={m.input} value={form.linkUrl}
                    onChangeText={v => setForm(f => ({ ...f, linkUrl: v }))}
                    placeholder={form.linkType === "external" ? "https://..." : "/(parent)/notices"}
                    autoCapitalize="none" keyboardType="url" />
                </>
              )}

              {/* 날짜 */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={m.label}>노출 시작일 (빈칸=제한 없음)</Text>
                  <TextInput style={m.input} value={form.displayStart}
                    onChangeText={v => setForm(f => ({ ...f, displayStart: v }))}
                    placeholder="2026-09-01" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={m.label}>노출 종료일 (빈칸=제한 없음)</Text>
                  <TextInput style={m.input} value={form.displayEnd}
                    onChangeText={v => setForm(f => ({ ...f, displayEnd: v }))}
                    placeholder="2026-12-31" />
                </View>
              </View>

              {/* 노출 시간(초) */}
              <Text style={m.label}>슬라이드 노출 시간 (초, 3~30)</Text>
              <TextInput style={m.input} value={form.displaySeconds} keyboardType="number-pad"
                onChangeText={v => setForm(f => ({ ...f, displaySeconds: v }))}
                placeholder="5" />

              {/* 순서 */}
              <Text style={m.label}>노출 순서 (작을수록 먼저)</Text>
              <TextInput style={m.input} value={form.sortOrder} keyboardType="number-pad"
                onChangeText={v => setForm(f => ({ ...f, sortOrder: v }))}
                placeholder="0" />

              {/* 색상 (slider에만) */}
              {form.bannerType === "slider" && (
                <>
                  <Text style={m.label}>색상 테마</Text>
                  <View style={m.segRow}>
                    {THEMES.map(th => (
                      <Pressable key={th} onPress={() => setForm(f => ({ ...f, colorTheme: th }))}
                        style={[m.colorChip, { backgroundColor: THEME_BG[th], borderWidth: form.colorTheme === th ? 2 : 0, borderColor: THEME_COLORS[th] }]}>
                        <View style={[m.colorDot, { backgroundColor: THEME_COLORS[th] }]} />
                        <Text style={[m.colorLabel, { color: THEME_COLORS[th] }]}>{th}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {/* 상태 */}
              <Text style={m.label}>상태</Text>
              <View style={m.segRow}>
                {(["scheduled","active","inactive"] as const).map(st => (
                  <Pressable key={st} style={[m.segBtn, form.status === st && m.segActive]}
                    onPress={() => setForm(f => ({ ...f, status: st }))}>
                    <Text style={[m.segTxt, form.status === st && m.segActiveTxt]}>{STATUS_CFG[st].label}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={m.footer}>
                <Pressable style={m.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable
                  style={[m.saveBtn, (saving || !form.title.trim()) && { opacity: 0.4 }]}
                  onPress={handleSave} disabled={saving || !form.title.trim()}>
                  {saving || uploading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>{editId ? "저장" : "등록"}</Text>}
                </Pressable>
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      {/* 삭제 확인 */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setDeleteConfirm(null)}>
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: 220 }]}>
            <Text style={[m.title, { marginBottom: 12 }]}>배너 삭제</Text>
            <Text style={{ fontSize: 14, color: C.textPrimary, marginBottom: 20 }}>
              이 배너를 삭제하시겠습니까? 복구되지 않습니다.
            </Text>
            <View style={m.footer}>
              <Pressable style={m.cancelBtn} onPress={() => setDeleteConfirm(null)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, { backgroundColor: "#DC2626" }]}
                onPress={() => { if (token && deleteConfirm) deleteAd(token, deleteConfirm); setDeleteConfirm(null); }}>
                <Text style={m.saveTxt}>삭제</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.backgroundSoft },
  tabs:         { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  tab:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 6, paddingVertical: 12 },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: P },
  tabTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  tabTxtActive: { color: P, fontFamily: "Pretendard-Regular" },
  tabBadge:     { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  tabBadgeTxt:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  filterRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  filterBtnActive: { backgroundColor: P },
  filterTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  filterTxtActive: { color: "#fff" },
  addBtn:       { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: P,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty:        { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});

const m = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "88%" },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title:      { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  label:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textPrimary, marginBottom: 4, marginTop: 12 },
  input:      { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 10, fontSize: 14,
                fontFamily: "Pretendard-Regular", color: C.textPrimary, backgroundColor: C.backgroundSoft },
  segRow:     { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  segBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  segActive:  { backgroundColor: P },
  segTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  segActiveTxt: { color: "#fff" },
  footer:     { flexDirection: "row", gap: 8, marginTop: 20, marginBottom: 12 },
  cancelBtn:  { flex: 1, padding: 13, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  saveBtn:    { flex: 2, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  saveTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  imgPreview: { width: "100%", height: 120, borderRadius: 10, marginBottom: 8 },
  imgBtn:     { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: P,
                borderRadius: 10, padding: 10, marginBottom: 4, borderStyle: "dashed" },
  imgBtnTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: P },
  removeImg:  { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  removeImgTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#DC2626" },
  colorChip:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  colorDot:   { width: 10, height: 10, borderRadius: 5 },
  colorLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
