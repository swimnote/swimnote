/**
 * (super)/ads.tsx — 광고 관리
 * 슈퍼관리자 전용. 학부모 화면에는 광고 슬롯 노출하지 않음.
 * 등록/수정/상태 변경/삭제. 상태: scheduled | active | inactive
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAdsStore, type Ad, type AdStatus } from "@/store/adsStore";
import { useAuth } from "@/context/AuthContext";

const P = "#7C3AED";

const STATUS_CFG: Record<AdStatus, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
  active:    { label: "노출 중",   color: "#1F8F86", bg: "#DDF2EF", icon: "eye" },
  scheduled: { label: "예약됨",   color: "#D97706", bg: "#FFF1BF", icon: "clock" },
  inactive:  { label: "비활성",   color: "#6F6B68", bg: "#F6F3F1", icon: "eye-off" },
};

const TARGET_LABELS: Record<string, string> = {
  all: "전체", parent: "학부모", teacher: "선생님", admin: "관리자",
};

type Filter = "all" | AdStatus;

function AdCard({ ad, onEdit, onStatusChange, onDelete }: {
  ad: Ad;
  onEdit: (ad: Ad) => void;
  onStatusChange: (id: string, s: AdStatus) => void;
  onDelete: (id: string) => void;
}) {
  const cfg = STATUS_CFG[ad.status];
  return (
    <View style={ac.card}>
      <View style={ac.top}>
        <View style={[ac.statusDot, { backgroundColor: cfg.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={ac.title} numberOfLines={1}>{ad.title}</Text>
          <Text style={ac.target}>대상: {TARGET_LABELS[ad.target] ?? ad.target}</Text>
        </View>
        <View style={[ac.badge, { backgroundColor: cfg.bg }]}>
          <Feather name={cfg.icon} size={11} color={cfg.color} />
          <Text style={[ac.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      {ad.description ? <Text style={ac.desc} numberOfLines={2}>{ad.description}</Text> : null}
      <View style={ac.dateRow}>
        <Feather name="calendar" size={11} color="#9A948F" />
        <Text style={ac.dateTxt}>
          {new Date(ad.displayStart).toLocaleDateString("ko-KR")} ~ {new Date(ad.displayEnd).toLocaleDateString("ko-KR")}
        </Text>
      </View>
      <View style={ac.actions}>
        {ad.status !== "active" && (
          <Pressable style={[ac.btn, { backgroundColor: "#DDF2EF" }]} onPress={() => onStatusChange(ad.id, "active")}>
            <Text style={[ac.btnTxt, { color: "#1F8F86" }]}>활성화</Text>
          </Pressable>
        )}
        {ad.status !== "inactive" && (
          <Pressable style={[ac.btn, { backgroundColor: "#F6F3F1" }]} onPress={() => onStatusChange(ad.id, "inactive")}>
            <Text style={[ac.btnTxt, { color: "#6F6B68" }]}>비활성</Text>
          </Pressable>
        )}
        <Pressable style={[ac.btn, { backgroundColor: "#EEDDF5" }]} onPress={() => onEdit(ad)}>
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
  card:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E9E2DD" },
  top:        { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  statusDot:  { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  title:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  target:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F", marginTop: 1 },
  badge:      { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  badgeTxt:   { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  desc:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68", marginBottom: 6, lineHeight: 18 },
  dateRow:    { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 10 },
  dateTxt:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  actions:    { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  btn:        { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  btnTxt:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

interface FormState {
  title: string; description: string; linkUrl: string;
  displayStart: string; displayEnd: string;
  status: AdStatus; target: Ad["target"];
}

const BLANK_FORM: FormState = {
  title: "", description: "", linkUrl: "",
  displayStart: new Date().toISOString().slice(0, 10),
  displayEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  status: "scheduled", target: "all",
};

export default function AdsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";

  const ads         = useAdsStore(s => s.ads);
  const createAd    = useAdsStore(s => s.createAd);
  const updateAd    = useAdsStore(s => s.updateAd);
  const setStatus   = useAdsStore(s => s.setStatus);
  const deleteAd    = useAdsStore(s => s.deleteAd);

  const [filter, setFilter] = useState<Filter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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
      title: ad.title, description: ad.description, linkUrl: ad.linkUrl,
      displayStart: ad.displayStart.slice(0, 10),
      displayEnd: ad.displayEnd.slice(0, 10),
      status: ad.status, target: ad.target,
    });
    setShowModal(true);
  }

  function handleSave() {
    if (!form.title.trim()) return;
    const startIso = new Date(form.displayStart).toISOString();
    const endIso   = new Date(form.displayEnd).toISOString();
    if (editId) {
      updateAd(editId, { ...form, displayStart: startIso, displayEnd: endIso, imageUrl: "" }, actorName);
    } else {
      createAd({ ...form, displayStart: startIso, displayEnd: endIso, imageUrl: "", createdBy: actorName }, actorName);
    }
    setShowModal(false);
  }

  function handleDelete(id: string) {
    deleteAd(id);
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
      <SubScreenHeader title="광고 관리" homePath="/(super)/dashboard" />

      {/* 안내 배너 */}
      <View style={s.noticeBanner}>
        <Feather name="info" size={12} color="#D97706" />
        <Text style={s.noticeTxt}>현재 학부모 화면에는 광고가 노출되지 않습니다. 관리 기능만 운영 중입니다.</Text>
      </View>

      {/* 요약 */}
      <View style={s.summaryRow}>
        <View style={[s.summaryCard, { borderColor: "#DDF2EF" }]}>
          <Text style={[s.sumNum, { color: "#1F8F86" }]}>{counts.active}</Text>
          <Text style={s.sumLabel}>노출 중</Text>
        </View>
        <View style={[s.summaryCard, { borderColor: "#FFF1BF" }]}>
          <Text style={[s.sumNum, { color: "#D97706" }]}>{counts.scheduled}</Text>
          <Text style={s.sumLabel}>예약됨</Text>
        </View>
        <View style={[s.summaryCard, { borderColor: "#F6F3F1" }]}>
          <Text style={[s.sumNum, { color: "#6F6B68" }]}>{counts.inactive}</Text>
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
          <Feather name="plus" size={16} color="#fff" />
          <Text style={s.addTxt}>등록</Text>
        </Pressable>
      </View>

      {/* 목록 */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 10 }}>
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Feather name="image" size={36} color="#D1D5DB" />
            <Text style={s.emptyTxt}>이 상태의 광고가 없습니다</Text>
          </View>
        ) : (
          filtered.map(ad => (
            <AdCard key={ad.id} ad={ad}
              onEdit={openEdit}
              onStatusChange={(id, status) => setStatus(id, status, actorName)}
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
                <Feather name="x" size={20} color="#6F6B68" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={m.label}>제목 *</Text>
              <TextInput style={m.input} value={form.title} onChangeText={v => setForm(f => ({ ...f, title: v }))} placeholder="광고 제목" />
              <Text style={m.label}>설명</Text>
              <TextInput style={[m.input, { height: 80, textAlignVertical: "top" }]} value={form.description}
                onChangeText={v => setForm(f => ({ ...f, description: v }))} placeholder="광고 내용 설명" multiline />
              <Text style={m.label}>링크 URL</Text>
              <TextInput style={m.input} value={form.linkUrl} onChangeText={v => setForm(f => ({ ...f, linkUrl: v }))} placeholder="https://..." />
              <Text style={m.label}>노출 시작일 (YYYY-MM-DD)</Text>
              <TextInput style={m.input} value={form.displayStart} onChangeText={v => setForm(f => ({ ...f, displayStart: v }))} placeholder="2024-01-01" />
              <Text style={m.label}>노출 종료일 (YYYY-MM-DD)</Text>
              <TextInput style={m.input} value={form.displayEnd} onChangeText={v => setForm(f => ({ ...f, displayEnd: v }))} placeholder="2024-12-31" />
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
            </ScrollView>
            <View style={m.footer}>
              <Pressable style={m.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={[m.saveBtn, !form.title.trim() && { opacity: 0.4 }]}
                onPress={handleSave} disabled={!form.title.trim()}>
                <Text style={m.saveTxt}>{editId ? "저장" : "등록"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 삭제 확인 */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade">
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: 220 }]}>
            <Text style={[m.title, { marginBottom: 12 }]}>광고 삭제</Text>
            <Text style={{ fontSize: 14, color: "#1F1F1F", marginBottom: 20 }}>이 광고를 삭제하시겠습니까? 복구되지 않습니다.</Text>
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
  safe:           { flex: 1, backgroundColor: "#FBF8F6" },
  noticeBanner:   { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#FFF1BF",
                    padding: 10, paddingHorizontal: 16 },
  noticeTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#D97706", flex: 1 },
  summaryRow:     { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff",
                    borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  summaryCard:    { flex: 1, borderRadius: 10, padding: 10, borderWidth: 1, alignItems: "center" },
  sumNum:         { fontSize: 20, fontFamily: "Inter_700Bold" },
  sumLabel:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  filterRow:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F6F3F1" },
  filterBtnActive:{ backgroundColor: P },
  filterTxt:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  filterTxtActive:{ color: "#fff" },
  addBtn:         { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: P,
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  addTxt:         { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  empty:          { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTxt:       { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9A948F" },
});

const m = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "85%" },
  header:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  label:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#1F1F1F", marginBottom: 4, marginTop: 10 },
  input:      { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 10, fontSize: 14,
                fontFamily: "Inter_400Regular", color: "#1F1F1F", backgroundColor: "#FBF8F6" },
  segRow:     { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  segBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F6F3F1" },
  segActive:  { backgroundColor: P },
  segTxt:     { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6F6B68" },
  segActiveTxt: { color: "#fff" },
  footer:     { flexDirection: "row", gap: 8, marginTop: 20 },
  cancelBtn:  { flex: 1, padding: 13, borderRadius: 10, backgroundColor: "#F6F3F1", alignItems: "center" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  saveBtn:    { flex: 2, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  saveTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
