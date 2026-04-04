/**
 * (super)/strip-banner.tsx — 가로줄 배너 관리
 * 학부모 홈 상단 가로 스트립 배너 등록/수정/상태 변경/삭제 + 이미지 업로드
 */
import { Camera, Plus, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAdsStore, type Ad, type AdStatus } from "@/store/adsStore";
import { useAuth } from "@/context/AuthContext";
import { API_BASE } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";

const STATUS_CFG: Record<AdStatus, { label: string; dot: string; badge: string }> = {
  active:    { label: "노출 중",  dot: "#22C55E", badge: "#DCFCE7" },
  scheduled: { label: "예약됨",  dot: "#D97706", badge: "#FEF9C3" },
  inactive:  { label: "비활성",  dot: "#94A3B8", badge: "#F1F5F9" },
};

const TARGET_LABELS: Record<string, string> = {
  all: "전체", parent: "학부모", teacher: "선생님", admin: "관리자",
};

const THEMES = ["teal","purple","orange","blue","green","red","pink"] as const;
const THEME_COLORS: Record<string, string> = {
  teal: "#2EC4B6", purple: "#7C3AED", orange: "#F97316",
  blue: "#2563EB", green: "#059669", red: "#DC2626", pink: "#DB2777",
};
const THEME_BG: Record<string, string> = {
  teal: "#E6FAF8", purple: "#EDE9FE", orange: "#FFF7ED",
  blue: "#DBEAFE", green: "#D1FAE5", red: "#FEE2E2", pink: "#FCE7F3",
};

type Filter = "all" | AdStatus;

function imageUrl(key: string) {
  if (!key) return "";
  if (key.startsWith("http")) return key;
  return `${API_BASE}/uploads/${key}`;
}

function AdCard({ ad, onEdit, onStatusChange, onDelete }: {
  ad: Ad;
  onEdit: (ad: Ad) => void;
  onStatusChange: (id: string, status: AdStatus) => void;
  onDelete: (id: string) => void;
}) {
  const cfg = STATUS_CFG[ad.status];
  const accentColor = THEME_COLORS[ad.colorTheme] ?? THEME_COLORS.teal;
  const bgColor     = THEME_BG[ad.colorTheme] ?? THEME_BG.teal;
  const img = imageUrl(ad.imageKey || ad.imageUrl);

  return (
    <View style={ac.card}>
      <View style={ac.top}>
        <View style={[ac.statusDot, { backgroundColor: cfg.dot }]} />
        <View style={{ flex: 1 }}>
          <Text style={ac.title} numberOfLines={1}>{ad.title}</Text>
          <Text style={ac.target}>{TARGET_LABELS[ad.target]} | {cfg.label}</Text>
        </View>
        <View style={[ac.badge, { backgroundColor: cfg.badge }]}>
          <View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: cfg.dot }]} />
          <Text style={[ac.badgeTxt, { color: cfg.dot }]}>{cfg.label}</Text>
        </View>
      </View>

      {img ? (
        <Image source={{ uri: img }} style={ac.previewImg} resizeMode="cover" />
      ) : (
        <View style={[ac.previewStrip, { backgroundColor: bgColor }]}>
          <View style={[ac.stripIconWrap, { backgroundColor: accentColor + "22" }]}>
            <LucideIcon name="megaphone" size={12} color={accentColor} />
          </View>
          <Text style={[ac.stripTitle, { color: accentColor }]} numberOfLines={1}>{ad.title}</Text>
          {ad.linkUrl ? <LucideIcon name="chevron-right" size={12} color={accentColor} /> : null}
        </View>
      )}

      {ad.description ? <Text style={ac.desc} numberOfLines={2}>{ad.description}</Text> : null}

      <View style={ac.dateRow}>
        <LucideIcon name="calendar" size={11} color="#94A3B8" />
        <Text style={ac.dateTxt}>
          {ad.displayStart.slice(0, 10)} ~ {ad.displayEnd.slice(0, 10)}
        </Text>
      </View>

      <View style={ac.actions}>
        {ad.status !== "active" && (
          <Pressable style={[ac.btn, { backgroundColor: "#DCFCE7" }]} onPress={() => onStatusChange(ad.id, "active")}>
            <Text style={[ac.btnTxt, { color: "#16A34A" }]}>노출 시작</Text>
          </Pressable>
        )}
        {ad.status === "active" && (
          <Pressable style={[ac.btn, { backgroundColor: "#F1F5F9" }]} onPress={() => onStatusChange(ad.id, "inactive")}>
            <Text style={[ac.btnTxt, { color: "#64748B" }]}>중지</Text>
          </Pressable>
        )}
        <Pressable style={[ac.btn, { backgroundColor: "#EDE9FE" }]} onPress={() => onEdit(ad)}>
          <Text style={[ac.btnTxt, { color: "#7C3AED" }]}>수정</Text>
        </Pressable>
        <Pressable style={[ac.btn, { backgroundColor: "#FEE2E2" }]} onPress={() => onDelete(ad.id)}>
          <Text style={[ac.btnTxt, { color: "#DC2626" }]}>삭제</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ac = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  top:         { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  statusDot:   { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  title:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  target:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 1 },
  badge:       { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  badgeTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
  previewStrip:{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, height: 36, paddingHorizontal: 10, marginBottom: 8 },
  stripIconWrap:{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  stripTitle:  { flex: 1, fontSize: 11, fontFamily: "Pretendard-SemiBold" },
  previewImg:  { width: "100%", height: 60, borderRadius: 8, marginBottom: 8 },
  desc:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 6, lineHeight: 18 },
  dateRow:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  dateTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  actions:     { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btn:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
});

interface FormState {
  title: string; description: string; linkUrl: string; linkLabel: string;
  displayStart: string; displayEnd: string;
  status: AdStatus; target: Ad["target"]; colorTheme: string;
  imageUri: string; imageKey: string; imageUrl: string;
}

const BLANK: FormState = {
  title: "", description: "", linkUrl: "", linkLabel: "",
  displayStart: new Date().toISOString().slice(0, 10),
  displayEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  status: "inactive", target: "all", colorTheme: "teal",
  imageUri: "", imageKey: "", imageUrl: "",
};

export default function StripBannerScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const stripAds     = useAdsStore(s => s.stripAds);
  const loading      = useAdsStore(s => s.loading);
  const fetchBanners = useAdsStore(s => s.fetchBanners);
  const uploadImage  = useAdsStore(s => s.uploadImage);
  const createAd     = useAdsStore(s => s.createAd);
  const updateAd     = useAdsStore(s => s.updateAd);
  const setStatus    = useAdsStore(s => s.setStatus);
  const deleteAd     = useAdsStore(s => s.deleteAd);

  useEffect(() => { if (token) fetchBanners(token, "strip"); }, [token]);

  const [filter, setFilter] = useState<Filter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return stripAds;
    return stripAds.filter(a => a.status === filter);
  }, [stripAds, filter]);

  const counts = useMemo(() => ({
    active:    stripAds.filter(a => a.status === "active").length,
    scheduled: stripAds.filter(a => a.status === "scheduled").length,
    inactive:  stripAds.filter(a => a.status === "inactive").length,
  }), [stripAds]);

  function openCreate() {
    setEditId(null);
    setForm(BLANK);
    setShowModal(true);
  }

  function openEdit(ad: Ad) {
    setEditId(ad.id);
    setForm({
      title: ad.title, description: ad.description,
      linkUrl: ad.linkUrl, linkLabel: ad.linkLabel,
      displayStart: ad.displayStart.slice(0, 10),
      displayEnd: ad.displayEnd.slice(0, 10),
      status: ad.status, target: ad.target, colorTheme: ad.colorTheme,
      imageUri: "", imageKey: ad.imageKey, imageUrl: ad.imageUrl,
    });
    setShowModal(true);
  }

  async function handlePickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진 라이브러리 접근 권한이 필요합니다.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [8, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setForm(f => ({ ...f, imageUri: asset.uri, imageKey: "", imageUrl: "" }));
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
        const fileName = `strip_${Date.now()}.jpg`;
        const uploaded = await uploadImage(token, form.imageUri, fileName, "image/jpeg");
        setUploading(false);
        if (uploaded) { finalKey = uploaded.key; finalUrl = uploaded.url; }
      }

      const startIso = new Date(form.displayStart).toISOString();
      const endIso   = new Date(form.displayEnd).toISOString();
      const params = {
        bannerType: "strip" as const,
        title: form.title, description: form.description,
        linkUrl: form.linkUrl, linkLabel: form.linkLabel,
        colorTheme: form.colorTheme, target: form.target, status: form.status,
        displayStart: startIso, displayEnd: endIso,
        imageKey: finalKey, imageUrl: finalUrl,
      };

      if (editId) {
        await updateAd(token, editId, params);
      } else {
        await createAd(token, params);
      }
      setShowModal(false);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    await deleteAd(token, id);
    setDeleteConfirm(null);
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "active", label: "노출 중" },
    { key: "scheduled", label: "예약" },
    { key: "inactive", label: "비활성" },
  ];

  const previewImg = form.imageUri
    ? form.imageUri
    : (form.imageKey ? imageUrl(form.imageKey) : (form.imageUrl || ""));
  const accentColor = THEME_COLORS[form.colorTheme] ?? THEME_COLORS.teal;
  const previewBg   = THEME_BG[form.colorTheme] ?? THEME_BG.teal;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="가로 배너 관리" homePath="/(super)/more" />

      {/* 요약 */}
      <View style={s.summaryRow}>
        <View style={[s.summaryCard, { borderColor: "#E6FFFA" }]}>
          <Text style={[s.sumNum, { color: "#2EC4B6" }]}>{counts.active}</Text>
          <Text style={s.sumLabel}>노출 중</Text>
        </View>
        <View style={[s.summaryCard, { borderColor: "#FFF1BF" }]}>
          <Text style={[s.sumNum, { color: "#D97706" }]}>{counts.scheduled}</Text>
          <Text style={s.sumLabel}>예약됨</Text>
        </View>
        <View style={[s.summaryCard, { borderColor: "#F1F5F9" }]}>
          <Text style={[s.sumNum, { color: "#64748B" }]}>{counts.inactive}</Text>
          <Text style={s.sumLabel}>비활성</Text>
        </View>
      </View>

      {/* 안내 + 필터 */}
      <View style={s.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {FILTERS.map(f => (
              <Pressable key={f.key} style={[s.filterBtn, filter === f.key && s.filterBtnActive]} onPress={() => setFilter(f.key)}>
                <Text style={[s.filterTxt, filter === f.key && s.filterTxtActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <Pressable style={s.addBtn} onPress={openCreate}>
          <Plus size={16} color="#fff" />
          <Text style={s.addTxt}>등록</Text>
        </Pressable>
      </View>

      {/* 목록 */}
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
        {loading && filtered.length === 0 ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator color={P} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <LucideIcon name="image" size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>이 상태의 배너가 없습니다</Text>
          </View>
        ) : (
          filtered.map(ad => (
            <AdCard key={ad.id} ad={ad}
              onEdit={openEdit}
              onStatusChange={(id, st) => token && setStatus(token, id, st)}
              onDelete={(id) => setDeleteConfirm(id)}
            />
          ))
        )}
      </ScrollView>

      {/* 등록/수정 모달 */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.header}>
              <Text style={m.title}>{editId ? "가로 배너 수정" : "가로 배너 등록"}</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <X size={20} color="#64748B" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* 미리보기 */}
              <Text style={m.label}>미리보기</Text>
              {previewImg ? (
                <Image source={{ uri: previewImg }} style={m.previewFull} resizeMode="cover" />
              ) : (
                <View style={[m.previewStrip, { backgroundColor: previewBg }]}>
                  <View style={[m.previewIcon, { backgroundColor: accentColor + "22" }]}>
                    <LucideIcon name="megaphone" size={13} color={accentColor} />
                  </View>
                  <Text style={[m.previewTxt, { color: accentColor }]} numberOfLines={1}>
                    {form.title || "배너 제목을 입력하세요"}
                  </Text>
                  {form.linkUrl ? <LucideIcon name="chevron-right" size={13} color={accentColor} /> : null}
                </View>
              )}

              {/* 이미지 업로드 */}
              <Text style={m.label}>배너 이미지 (선택)</Text>
              <Pressable style={m.imgBtn} onPress={handlePickImage}>
                <Camera size={16} color="#7C3AED" />
                <Text style={m.imgBtnTxt}>
                  {previewImg ? "이미지 변경하기" : "이미지 선택하기"}
                </Text>
              </Pressable>
              {previewImg ? (
                <Pressable onPress={() => setForm(f => ({ ...f, imageUri: "", imageKey: "", imageUrl: "" }))}
                  style={m.removeImg}>
                  <X size={12} color="#DC2626" />
                  <Text style={m.removeImgTxt}>이미지 제거</Text>
                </Pressable>
              ) : null}

              <Text style={m.label}>제목 *</Text>
              <TextInput style={m.input} value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="배너 제목" />

              <Text style={m.label}>설명 (선택)</Text>
              <TextInput style={[m.input, { height: 64, textAlignVertical: "top" }]}
                value={form.description} onChangeText={v => setForm(f => ({ ...f, description: v }))}
                placeholder="배너 부가 설명" multiline />

              <Text style={m.label}>링크 URL</Text>
              <TextInput style={m.input} value={form.linkUrl}
                onChangeText={v => setForm(f => ({ ...f, linkUrl: v }))} placeholder="https://..." />

              <Text style={m.label}>링크 라벨</Text>
              <TextInput style={m.input} value={form.linkLabel}
                onChangeText={v => setForm(f => ({ ...f, linkLabel: v }))} placeholder="자세히 보기" />

              <Text style={m.label}>노출 시작일 (YYYY-MM-DD)</Text>
              <TextInput style={m.input} value={form.displayStart}
                onChangeText={v => setForm(f => ({ ...f, displayStart: v }))} placeholder="2024-01-01" />

              <Text style={m.label}>노출 종료일 (YYYY-MM-DD)</Text>
              <TextInput style={m.input} value={form.displayEnd}
                onChangeText={v => setForm(f => ({ ...f, displayEnd: v }))} placeholder="2024-12-31" />

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

              <Text style={m.label}>대상</Text>
              <View style={m.segRow}>
                {(["all","parent","teacher","admin"] as const).map(t => (
                  <Pressable key={t} style={[m.segBtn, form.target === t && m.segActive]} onPress={() => setForm(f => ({ ...f, target: t }))}>
                    <Text style={[m.segTxt, form.target === t && m.segActiveTxt]}>{TARGET_LABELS[t]}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={m.label}>상태</Text>
              <View style={m.segRow}>
                {(["scheduled","active","inactive"] as const).map(st => (
                  <Pressable key={st} style={[m.segBtn, form.status === st && m.segActive]} onPress={() => setForm(f => ({ ...f, status: st }))}>
                    <Text style={[m.segTxt, form.status === st && m.segActiveTxt]}>{STATUS_CFG[st].label}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable style={[m.saveBtn, (saving || !form.title.trim()) && { opacity: 0.5 }]}
                onPress={handleSave} disabled={saving || !form.title.trim()}>
                {saving || uploading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={m.saveTxt}>{editId ? "수정 완료" : "등록하기"}</Text>
                }
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade">
        <View style={m.overlay}>
          <View style={[m.sheet, { gap: 14 }]}>
            <Text style={[m.title, { textAlign: "center" }]}>배너를 삭제할까요?</Text>
            <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center", fontFamily: "Pretendard-Regular" }}>삭제 후 복구가 불가합니다.</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[m.saveBtn, { flex: 1, backgroundColor: "#F1F5F9" }]} onPress={() => setDeleteConfirm(null)}>
                <Text style={[m.saveTxt, { color: "#64748B" }]}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, { flex: 1, backgroundColor: "#DC2626" }]} onPress={() => deleteConfirm && handleDelete(deleteConfirm)}>
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
  safe:             { flex: 1, backgroundColor: "#F1F5F9" },
  summaryRow:       { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff",
                      borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  summaryCard:      { flex: 1, borderRadius: 10, padding: 10, borderWidth: 1, alignItems: "center" },
  sumNum:           { fontSize: 20, fontFamily: "Pretendard-Regular" },
  sumLabel:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  filterRow:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  filterBtnActive:  { backgroundColor: P },
  filterTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  filterTxtActive:  { color: "#fff" },
  addBtn:           { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: P, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addTxt:           { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty:            { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTxt:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
});

const m = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "90%", gap: 12 },
  header:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  title:       { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  label:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151", marginBottom: 4, marginTop: 8 },
  input:       { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#111", marginBottom: 4 },
  segRow:      { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  segBtn:      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "#F1F5F9" },
  segActive:   { backgroundColor: P },
  segTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  segActiveTxt:{ color: "#fff" },
  colorChip:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  colorDot:    { width: 10, height: 10, borderRadius: 5 },
  colorLabel:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
  imgBtn:      { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: P, borderRadius: 10, padding: 12, marginBottom: 4, borderStyle: "dashed" },
  imgBtnTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: P },
  removeImg:   { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  removeImgTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#DC2626" },
  previewStrip:{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, height: 40, paddingHorizontal: 12, marginBottom: 8 },
  previewFull: { width: "100%", height: 56, borderRadius: 8, marginBottom: 8 },
  previewIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  previewTxt:  { flex: 1, fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  saveBtn:     { backgroundColor: P, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  saveTxt:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
