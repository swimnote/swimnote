/**
 * (super)/ads.tsx — 광고 관리
 * 슈퍼관리자 전용. 학부모 화면에는 광고 슬롯 노출하지 않음.
 * 등록/수정/상태 변경/삭제. 상태: scheduled | active | inactive
 */
import { Calendar, Camera, Image, Plus, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator, Alert, Image as RNImage, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { API_BASE } from "@/context/AuthContext";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAdsStore, type Ad, type AdStatus } from "@/store/adsStore";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";

const STATUS_CFG: Record<AdStatus, { label: string; color: string; bg: string; icon: string }> = {
  active:    { label: "노출 중",   color: "#2EC4B6", bg: "#E6FFFA", icon: "eye" },
  scheduled: { label: "예약됨",   color: "#D97706", bg: "#FFF1BF", icon: "clock" },
  inactive:  { label: "비활성",   color: "#64748B", bg: "#FFFFFF", icon: "eye-off" },
};

const TARGET_LABELS: Record<string, string> = {
  all: "전체", parent: "학부모", teacher: "선생님", admin: "관리자",
};

type Filter = "all" | AdStatus;

function imageUrl(key: string) {
  if (!key) return "";
  if (key.startsWith("http")) return key;
  return `${API_BASE}/uploads/${key}`;
}

const THEMES = ["teal","purple","orange","blue","green","red","pink"] as const;
const THEME_COLORS: Record<string, string> = {
  teal: "#2EC4B6", purple: "#7C3AED", orange: "#F97316",
  blue: "#2563EB", green: "#059669", red: "#DC2626", pink: "#DB2777",
};
const THEME_BG: Record<string, string> = {
  teal: "#E6FAF8", purple: "#EDE9FE", orange: "#FFF7ED",
  blue: "#DBEAFE", green: "#D1FAE5", red: "#FEE2E2", pink: "#FCE7F3",
};

function AdCard({ ad, onEdit, onStatusChange, onDelete }: {
  ad: Ad;
  onEdit: (ad: Ad) => void;
  onStatusChange: (id: string, s: AdStatus) => void;
  onDelete: (id: string) => void;
}) {
  const cfg = STATUS_CFG[ad.status];
  const img = ad.imageKey ? imageUrl(ad.imageKey) : (ad.imageUrl || "");
  return (
    <View style={ac.card}>
      <View style={ac.top}>
        <View style={[ac.statusDot, { backgroundColor: cfg.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={ac.title} numberOfLines={1}>{ad.title}</Text>
          <Text style={ac.target}>대상: {TARGET_LABELS[ad.target] ?? ad.target}</Text>
        </View>
        <View style={[ac.badge, { backgroundColor: cfg.bg }]}>
          <LucideIcon name={cfg.icon} size={11} color={cfg.color} />
          <Text style={[ac.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      {img ? <RNImage source={{ uri: img }} style={ac.cardImg} resizeMode="cover" /> : null}
      {ad.description ? <Text style={ac.desc} numberOfLines={2}>{ad.description}</Text> : null}
      <View style={ac.dateRow}>
        <Calendar size={11} color="#64748B" />
        <Text style={ac.dateTxt}>
          {new Date(ad.displayStart).toLocaleDateString("ko-KR")} ~ {new Date(ad.displayEnd).toLocaleDateString("ko-KR")}
        </Text>
      </View>
      <View style={ac.actions}>
        {ad.status !== "active" && (
          <Pressable style={[ac.btn, { backgroundColor: "#E6FFFA" }]} onPress={() => onStatusChange(ad.id, "active")}>
            <Text style={[ac.btnTxt, { color: "#2EC4B6" }]}>활성화</Text>
          </Pressable>
        )}
        {ad.status !== "inactive" && (
          <Pressable style={[ac.btn, { backgroundColor: "#FFFFFF" }]} onPress={() => onStatusChange(ad.id, "inactive")}>
            <Text style={[ac.btnTxt, { color: "#64748B" }]}>비활성</Text>
          </Pressable>
        )}
        <Pressable style={[ac.btn, { backgroundColor: C.button }]} onPress={() => onEdit(ad)}>
          <Text style={[ac.btnTxt, { color: P }]}>수정</Text>
        </Pressable>
        <Pressable style={[ac.btn, { backgroundColor: "#F9DEDA" }]} onPress={() => onDelete(ad.id)}>
          <Text style={[ac.btnTxt, { color: "#D96C6C" }]}>삭제</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ac = StyleSheet.create({
  card:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  top:        { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  statusDot:  { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  title:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  target:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 1 },
  badge:      { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  badgeTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
  desc:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 6, lineHeight: 18 },
  dateRow:    { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  dateTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  actions:    { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btn:        { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular" },
  cardImg:    { width: "100%", height: 120, borderRadius: 8, marginBottom: 8 },
});

interface FormState {
  title: string; description: string; linkUrl: string; linkLabel: string;
  displayStart: string; displayEnd: string;
  status: AdStatus; target: Ad["target"];
  imageUri: string; imageKey: string; imageUrl: string; colorTheme: string;
}

const BLANK_FORM: FormState = {
  title: "", description: "", linkUrl: "", linkLabel: "",
  displayStart: new Date().toISOString().slice(0, 10),
  displayEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  status: "scheduled", target: "all",
  imageUri: "", imageKey: "", imageUrl: "", colorTheme: "teal",
};

export default function AdsScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const ads          = useAdsStore(s => s.ads);
  const loading      = useAdsStore(s => s.loading);
  const fetchBanners = useAdsStore(s => s.fetchBanners);
  const uploadImage  = useAdsStore(s => s.uploadImage);
  const createAd     = useAdsStore(s => s.createAd);
  const updateAd     = useAdsStore(s => s.updateAd);
  const setStatus    = useAdsStore(s => s.setStatus);
  const deleteAd     = useAdsStore(s => s.deleteAd);

  useEffect(() => { if (token) fetchBanners(token, "slider"); }, [token]);

  const [filter, setFilter] = useState<Filter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return ads;
    return ads.filter(a => a.status === filter);
  }, [ads, filter]);

  function openCreate() {
    setEditId(null);
    setForm(BLANK_FORM);
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
    if (!perm.granted) { Alert.alert("권한 필요", "사진 라이브러리 접근 권한이 필요합니다."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
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
        const up = await uploadImage(token, form.imageUri, `slider_${Date.now()}.jpg`, "image/jpeg");
        setUploading(false);
        if (up) { finalKey = up.key; finalUrl = up.url; }
      }
      const startIso = new Date(form.displayStart).toISOString();
      const endIso   = new Date(form.displayEnd).toISOString();
      const params = {
        bannerType: "slider" as const,
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
    { key: "all",       label: "전체" },
    { key: "active",    label: "노출 중" },
    { key: "scheduled", label: "예약" },
    { key: "inactive",  label: "비활성" },
  ];

  const counts = useMemo(() => ({
    active:    ads.filter(a => a.status === "active").length,
    scheduled: ads.filter(a => a.status === "scheduled").length,
    inactive:  ads.filter(a => a.status === "inactive").length,
  }), [ads]);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="광고 관리" homePath="/(super)/more" />

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
        <View style={[s.summaryCard, { borderColor: "#FFFFFF" }]}>
          <Text style={[s.sumNum, { color: "#64748B" }]}>{counts.inactive}</Text>
          <Text style={s.sumLabel}>비활성</Text>
        </View>
      </View>

      {/* 필터 + 등록 버튼 */}
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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Image size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>이 상태의 광고가 없습니다</Text>
          </View>
        ) : (
          filtered.map(ad => (
            <AdCard key={ad.id} ad={ad}
              onEdit={openEdit}
              onStatusChange={(id, status) => token && setStatus(token, id, status)}
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
              <Text style={m.title}>{editId ? "광고 수정" : "광고 등록"}</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <X size={20} color="#64748B" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* 이미지 업로드 */}
              <Text style={m.label}>배너 이미지 (선택)</Text>
              {(() => {
                const preview = form.imageUri || (form.imageKey ? imageUrl(form.imageKey) : form.imageUrl);
                return (
                  <>
                    {preview ? (
                      <RNImage source={{ uri: preview }} style={m.imgPreview} resizeMode="cover" />
                    ) : null}
                    <Pressable style={m.imgBtn} onPress={handlePickImage}>
                      <Camera size={15} color="#7C3AED" />
                      <Text style={m.imgBtnTxt}>{preview ? "이미지 변경" : "이미지 선택"}</Text>
                    </Pressable>
                    {preview ? (
                      <Pressable onPress={() => setForm(f => ({ ...f, imageUri: "", imageKey: "", imageUrl: "" }))} style={m.removeImg}>
                        <X size={11} color="#DC2626" />
                        <Text style={m.removeImgTxt}>이미지 제거</Text>
                      </Pressable>
                    ) : null}
                  </>
                );
              })()}

              <Text style={m.label}>제목 *</Text>
              <TextInput style={m.input} value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="카드 배너 제목" />
              <Text style={m.label}>설명</Text>
              <TextInput style={[m.input, { height: 80, textAlignVertical: "top" }]} value={form.description}
                onChangeText={v => setForm(f => ({ ...f, description: v }))} placeholder="카드 배너 내용 설명" multiline />
              <Text style={m.label}>링크 URL</Text>
              <TextInput style={m.input} value={form.linkUrl} onChangeText={v => setForm(f => ({ ...f, linkUrl: v }))} placeholder="https://..." />
              <Text style={m.label}>링크 라벨</Text>
              <TextInput style={m.input} value={form.linkLabel} onChangeText={v => setForm(f => ({ ...f, linkLabel: v }))} placeholder="자세히 보기" />
              <Text style={m.label}>노출 시작일 (YYYY-MM-DD)</Text>
              <TextInput style={m.input} value={form.displayStart} onChangeText={v => setForm(f => ({ ...f, displayStart: v }))} placeholder="2024-01-01" />
              <Text style={m.label}>노출 종료일 (YYYY-MM-DD)</Text>
              <TextInput style={m.input} value={form.displayEnd} onChangeText={v => setForm(f => ({ ...f, displayEnd: v }))} placeholder="2024-12-31" />
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
              <View style={m.footer}>
                <Pressable style={m.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, (saving || !form.title.trim()) && { opacity: 0.4 }]}
                  onPress={handleSave} disabled={saving || !form.title.trim()}>
                  {saving || uploading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>{editId ? "저장" : "등록"}</Text>
                  }
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 삭제 확인 */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade">
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: 220 }]}>
            <Text style={[m.title, { marginBottom: 12 }]}>광고 삭제</Text>
            <Text style={{ fontSize: 14, color: "#0F172A", marginBottom: 20 }}>이 광고를 삭제하시겠습니까? 복구되지 않습니다.</Text>
            <View style={m.footer}>
              <Pressable style={m.cancelBtn} onPress={() => setDeleteConfirm(null)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, { backgroundColor: "#D96C6C" }]} onPress={() => handleDelete(deleteConfirm!)}>
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
  safe:           { flex: 1, backgroundColor: "#F1F5F9" },
  summaryRow:     { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff",
                    borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  summaryCard:    { flex: 1, borderRadius: 10, padding: 10, borderWidth: 1, alignItems: "center" },
  sumNum:         { fontSize: 20, fontFamily: "Pretendard-Regular" },
  sumLabel:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  filterRow:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  filterBtnActive:{ backgroundColor: P },
  filterTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  filterTxtActive:{ color: "#fff" },
  addBtn:         { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: P,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addTxt:         { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty:          { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const m = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "85%" },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title:      { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  label:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 4, marginTop: 10 },
  input:      { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 10, fontSize: 14,
                fontFamily: "Pretendard-Regular", color: "#0F172A", backgroundColor: "#F1F5F9" },
  segRow:     { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  segBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  segActive:  { backgroundColor: P },
  segTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  segActiveTxt: { color: "#fff" },
  footer:       { flexDirection: "row", gap: 8, marginTop: 20, marginBottom: 12 },
  cancelBtn:    { flex: 1, padding: 13, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  saveBtn:      { flex: 2, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  saveTxt:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  imgPreview:   { width: "100%", height: 120, borderRadius: 10, marginBottom: 8 },
  imgBtn:       { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: P, borderRadius: 10,
                  padding: 10, marginBottom: 4, borderStyle: "dashed" },
  imgBtnTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: P },
  removeImg:    { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  removeImgTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#DC2626" },
  colorChip:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  colorDot:     { width: 10, height: 10, borderRadius: 5 },
  colorLabel:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
