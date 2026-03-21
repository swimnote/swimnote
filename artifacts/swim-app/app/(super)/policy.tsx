/**
 * (super)/policy.tsx — 정책·컴플라이언스
 * 탭: 환불정책 / 개인정보 / 이용약관 / 버전관리 / 미동의 운영자
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

const TABS = [
  { key: "refund_policy",    label: "환불 정책" },
  { key: "privacy_policy",   label: "개인정보" },
  { key: "terms_of_service", label: "이용약관" },
  { key: "versions",         label: "버전 관리" },
  { key: "unsigned",         label: "미동의 운영자" },
];

const POLICY_KEYS = ["refund_policy", "privacy_policy", "terms_of_service"];

const DEFAULT_POLICIES: Record<string, string> = {
  refund_policy:    "1. 수강 시작 전 전액 환불\n2. 1/3 경과 전 2/3 환불\n3. 1/2 경과 전 1/2 환불\n4. 1/2 경과 후 환불 불가\n5. 결석·개인 사정에 의한 취소는 환불 불가",
  privacy_policy:   "1. 수집 항목: 이름, 연락처, 사진, 수영 기록\n2. 수집 목적: 수영 강습 관리 및 서비스 제공\n3. 보유 기간: 서비스 탈퇴 후 30일\n4. 제3자 제공: 원칙적 거부, 법적 요구 시 예외",
  terms_of_service: "1. 서비스 이용 연령: 법정대리인 동의 필요 (만 14세 미만)\n2. 계정 관리 책임: 이용자 본인\n3. 금지 행위: 타인 계정 도용, 서비스 방해\n4. 서비스 중단: 불가항력·점검 시 가능",
};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export default function PolicyScreen() {
  const { token } = useAuth();
  const [tab,          setTab]          = useState("refund_policy");
  const [loading,      setLoading]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [versions,     setVersions]     = useState<any[]>([]);
  const [unsigned,     setUnsigned]     = useState<any[]>([]);
  const [unsignedKey,  setUnsignedKey]  = useState("refund_policy");
  const [versionKey,   setVersionKey]   = useState("refund_policy");
  const [versionModal, setVersionModal] = useState(false);
  const [newVer,       setNewVer]       = useState("");
  const [newVal,       setNewVal]       = useState("");
  const [saving,       setSaving]       = useState(false);

  async function loadVersions() {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/super/policy-versions/${versionKey}`);
      if (res.ok) setVersions(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }

  async function loadUnsigned() {
    setLoading(true);
    try {
      const res = await apiRequest(token, `/super/policy-consents?policy_key=${unsignedKey}`);
      if (res.ok) setUnsigned(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => {
    if (tab === "versions") loadVersions();
    if (tab === "unsigned") loadUnsigned();
  }, [tab, versionKey, unsignedKey]);

  async function handleSaveVersion() {
    if (!newVer || !newVal) return;
    setSaving(true);
    await apiRequest(token, `/super/policy-versions/${versionKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: newVer, value: newVal }),
    }).catch(() => {});
    setSaving(false); setVersionModal(false); setNewVer(""); setNewVal("");
    loadVersions();
  }

  const policyLabel = TABS.find(t => t.key === tab)?.label ?? "";

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="정책·컴플라이언스" homePath="/(super)/dashboard" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabContent}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 정책 본문 탭들 */}
      {POLICY_KEYS.includes(tab) && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={() => {}} />}>
          <View style={s.policyCard}>
            <View style={s.policyHeader}>
              <View style={s.policyIconBg}>
                <Feather name="file-text" size={16} color={P} />
              </View>
              <Text style={s.policyTitle}>{policyLabel}</Text>
              <View style={s.activeBadge}>
                <Text style={s.activeBadgeTxt}>현재 적용 중</Text>
              </View>
            </View>
            <Text style={s.policyBody} selectable>{DEFAULT_POLICIES[tab]}</Text>
          </View>

          <View style={s.actionCard}>
            <Pressable style={s.actionRow} onPress={() => { setVersionKey(tab); setTab("versions"); }}>
              <Feather name="git-branch" size={16} color={P} />
              <Text style={s.actionTxt}>버전 이력 확인</Text>
              <Feather name="chevron-right" size={15} color="#9CA3AF" />
            </Pressable>
            <View style={s.divider} />
            <Pressable style={s.actionRow} onPress={() => { setUnsignedKey(tab); setTab("unsigned"); }}>
              <Feather name="alert-circle" size={16} color="#DC2626" />
              <Text style={[s.actionTxt, { color: "#DC2626" }]}>미동의 운영자 확인</Text>
              <Feather name="chevron-right" size={15} color="#9CA3AF" />
            </Pressable>
            <View style={s.divider} />
            <Pressable style={s.actionRow} onPress={() => { setVersionKey(tab); setVersionModal(true); }}>
              <Feather name="plus-circle" size={16} color="#059669" />
              <Text style={[s.actionTxt, { color: "#059669" }]}>새 버전 저장</Text>
              <Feather name="chevron-right" size={15} color="#9CA3AF" />
            </Pressable>
          </View>
        </ScrollView>
      )}

      {/* 버전 관리 탭 */}
      {tab === "versions" && (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={s.subTabBar} contentContainerStyle={s.subTabContent}>
            {POLICY_KEYS.map(k => (
              <Pressable key={k} style={[s.subTab, versionKey === k && s.subTabActive]}
                onPress={() => setVersionKey(k)}>
                <Text style={[s.subTabTxt, versionKey === k && { color: P }]}>
                  {TABS.find(t => t.key === k)?.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {loading ? (
            <ActivityIndicator color={P} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={versions}
              keyExtractor={i => i.id}
              contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
              refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={loadVersions} />}
              ListHeaderComponent={
                <Pressable style={s.addVerBtn} onPress={() => setVersionModal(true)}>
                  <Feather name="plus" size={13} color="#fff" />
                  <Text style={s.addVerTxt}>현재 버전 저장</Text>
                </Pressable>
              }
              renderItem={({ item }) => (
                <View style={s.verRow}>
                  <View style={s.verBadge}><Text style={s.verBadgeTxt}>v{item.version}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.verPreview} numberOfLines={2}>{item.preview}</Text>
                    <Text style={s.verMeta}>{fmtDate(item.created_at)} · {item.created_by ?? "시스템"}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Feather name="git-branch" size={28} color="#D1D5DB" />
                  <Text style={s.emptyTxt}>저장된 버전이 없습니다</Text>
                </View>
              }
            />
          )}
        </View>
      )}

      {/* 미동의 운영자 탭 */}
      {tab === "unsigned" && (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={s.subTabBar} contentContainerStyle={s.subTabContent}>
            {POLICY_KEYS.map(k => (
              <Pressable key={k} style={[s.subTab, unsignedKey === k && s.subTabActive]}
                onPress={() => setUnsignedKey(k)}>
                <Text style={[s.subTabTxt, unsignedKey === k && { color: P }]}>
                  {TABS.find(t => t.key === k)?.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {loading ? (
            <ActivityIndicator color={P} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={unsigned}
              keyExtractor={i => i.id}
              contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 80 }}
              refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={loadUnsigned} />}
              ListHeaderComponent={
                unsigned.length > 0 ? (
                  <View style={s.unsignedHeader}>
                    <Feather name="alert-circle" size={14} color="#DC2626" />
                    <Text style={s.unsignedHeaderTxt}>
                      {TABS.find(t => t.key === unsignedKey)?.label} 미동의 운영자 {unsigned.length}명
                    </Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <Pressable style={s.unsignedRow}
                  onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
                  <View style={s.unsignedLeft}>
                    <View style={s.unsignedBullet} />
                    <View>
                      <Text style={s.unsignedName}>{item.name}</Text>
                      <Text style={s.unsignedSub}>{item.owner_name} · {fmtDate(item.created_at)} 가입</Text>
                    </View>
                  </View>
                  <View style={[s.unsignedBadge, { backgroundColor: item.approval_status === "approved" ? "#D1FAE5" : "#FEF3C7" }]}>
                    <Text style={[s.unsignedBadgeTxt, { color: item.approval_status === "approved" ? "#059669" : "#D97706" }]}>
                      {item.approval_status === "approved" ? "승인" : "대기"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={14} color="#9CA3AF" />
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Feather name="check-circle" size={28} color="#10B981" />
                  <Text style={s.emptyTxt}>모든 운영자가 동의했습니다</Text>
                </View>
              }
            />
          )}
        </View>
      )}

      {/* 버전 저장 모달 */}
      {versionModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setVersionModal(false)}>
          <Pressable style={m.backdrop} onPress={() => setVersionModal(false)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>새 정책 버전 저장</Text>
              <Text style={m.sub}>{TABS.find(t => t.key === versionKey)?.label}</Text>
              <View style={m.section}>
                <Text style={m.label}>버전 번호 *</Text>
                <TextInput style={m.input} value={newVer} onChangeText={setNewVer}
                  placeholder="예: 2.1.0" placeholderTextColor="#9CA3AF" />
              </View>
              <View style={m.section}>
                <Text style={m.label}>내용 *</Text>
                <TextInput style={[m.input, { minHeight: 100 }]} value={newVal}
                  onChangeText={setNewVal} multiline placeholder="정책 내용"
                  placeholderTextColor="#9CA3AF" textAlignVertical="top" />
              </View>
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setVersionModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={handleSaveVersion} disabled={saving || !newVer || !newVal}>
                  {saving ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>저장</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: "#F5F3FF" },
  tabBar:          { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:      { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  tab:             { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  tabActive:       { backgroundColor: "#EDE9FE" },
  tabTxt:          { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  tabTxtActive:    { color: P, fontFamily: "Inter_700Bold" },
  subTabBar:       { flexGrow: 0, backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  subTabContent:   { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  subTab:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  subTabActive:    { backgroundColor: "#EDE9FE" },
  subTabTxt:       { fontSize: 12, fontFamily: "Inter_500Medium", color: "#9CA3AF" },
  policyCard:      { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 12,
                     borderWidth: 1, borderColor: "#E5E7EB" },
  policyHeader:    { flexDirection: "row", alignItems: "center", gap: 10 },
  policyIconBg:    { width: 34, height: 34, borderRadius: 10, backgroundColor: "#EDE9FE",
                     alignItems: "center", justifyContent: "center" },
  policyTitle:     { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  activeBadge:     { backgroundColor: "#D1FAE5", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeBadgeTxt:  { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#059669" },
  policyBody:      { fontSize: 13, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 22 },
  actionCard:      { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  actionRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  actionTxt:       { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: "#374151" },
  divider:         { height: 1, backgroundColor: "#F3F4F6", marginHorizontal: 14 },
  addVerBtn:       { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: P,
                     borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
                     alignSelf: "flex-start", marginBottom: 10 },
  addVerTxt:       { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  verRow:          { flexDirection: "row", alignItems: "flex-start", gap: 10,
                     backgroundColor: "#fff", borderRadius: 12, padding: 14,
                     borderWidth: 1, borderColor: "#E5E7EB" },
  verBadge:        { backgroundColor: "#EDE9FE", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verBadgeTxt:     { fontSize: 11, fontFamily: "Inter_700Bold", color: P },
  verPreview:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 18 },
  verMeta:         { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 4 },
  unsignedHeader:  { flexDirection: "row", alignItems: "center", gap: 8,
                     backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12, marginBottom: 6 },
  unsignedHeaderTxt:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  unsignedRow:     { flexDirection: "row", alignItems: "center", gap: 10,
                     backgroundColor: "#fff", borderRadius: 12, padding: 14,
                     borderWidth: 1, borderColor: "#E5E7EB" },
  unsignedLeft:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  unsignedBullet:  { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#DC2626", flexShrink: 0 },
  unsignedName:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  unsignedSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  unsignedBadge:   { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  unsignedBadgeTxt:{ fontSize: 10, fontFamily: "Inter_500Medium" },
  empty:           { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt:        { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40,
               maxHeight: "80%", gap: 14 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: -8 },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
               fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
