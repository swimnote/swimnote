/**
 * (super)/policy.tsx — 정책·컴플라이언스
 * operatorsStore (미동의 필터) + 로컬 버전 상태 — API 호출 없음
 */
import { ChevronRight, CircleAlert, CircleCheck, CirclePlus, FileText, GitBranch, Plus } from "lucide-react-native";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import Colors from "@/constants/colors";
const C = Colors.light;

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
  refund_policy:    "1. 결제 안내\n현재 앱 내 결제 기능은 제공되지 않습니다.\n향후 인앱결제 방식으로 제공될 예정입니다.\n\n2. 환불 기준\n환불은 환불 요청일 기준으로 일할 계산하여 처리됩니다.\n예: 30일 이용권 중 10일 사용 → 20일 기준 환불\n\n3. 환불 제한 조건\n서비스 이용 내역 확인이 불가능한 경우\n비정상 사용 기록이 있는 경우\n\n4. 결제 플랫폼 기준\n앱스토어 결제는 애플 정책을 따릅니다.\n구글 플레이 결제는 구글 정책을 따릅니다.",
  privacy_policy:   "1. 수집 항목: 이름, 연락처, 사진, 수영 기록\n2. 수집 목적: 수영 강습 관리 및 서비스 제공\n3. 보유 기간: 서비스 탈퇴 후 30일\n4. 제3자 제공: 원칙적 거부, 법적 요구 시 예외",
  terms_of_service: "1. 서비스 정의\n스윔노트는 수영장 운영자, 강사, 학부모를 연결하여 회원관리, 수업관리, 출결, 일지, 보강, 공지 기능을 제공하는 수영장 운영 관리 플랫폼입니다.\n\n2. 계정 및 이용\n계정 유형은 수영장 관리자, 선생님, 학부모로 구분됩니다.\n학부모는 관리자 승인 후 이용 가능합니다.\n계정 정보는 정확하게 입력해야 하며 허위 정보 입력 시 이용이 제한될 수 있습니다.\n\n3. 서비스 제공 범위\n회원 관리, 출결 관리, 수업 일지, 보강 관리, 공지 및 메시지, 수업 관련 데이터 관리 기능을 제공합니다.\n\n4. 데이터 관리 및 책임\n모든 데이터는 수영장 단위로 관리됩니다.\n학생 정보 및 수업 데이터의 관리 책임은 수영장 관리자에게 있습니다.\n\n5. 데이터 삭제 정책\n사진 및 영상 데이터는 장기 보관되지 않으며 일정 기간 내 삭제될 수 있습니다.\n관리자가 삭제한 데이터는 복구되지 않습니다.\n\n6. 회원 탈퇴 및 데이터 처리\n탈퇴일로부터 3개월간 보관 후 완전 삭제됩니다.\n3개월 이내 재가입 시 기존 데이터 복구가 가능합니다.\n\n7. 서비스 이용 제한\n비정상적인 시스템 사용, 계정 도용, 서비스 운영 방해 행위 시 이용이 제한될 수 있습니다.\n\n8. 서비스 변경\n서비스 기능은 운영 정책에 따라 사전 고지 없이 변경될 수 있습니다.\n\n9. 면책\n수업 내용 및 교육 품질에 대한 책임은 각 수영장에 있습니다.",
};

const SEED_VERSIONS: Record<string, { id: string; version: string; preview: string; created_at: string; created_by: string }[]> = {
  refund_policy: [
    { id: "rv-1", version: "1.2.0", preview: "1. 수강 시작 전 전액 환불\n2. 1/3 경과 전 2/3 환불", created_at: "2024-09-01T00:00:00.000Z", created_by: "슈퍼관리자" },
    { id: "rv-2", version: "1.1.0", preview: "환불 정책 v1.1 - 환불 조건 강화", created_at: "2024-03-15T00:00:00.000Z", created_by: "슈퍼관리자" },
  ],
  privacy_policy: [
    { id: "pv-1", version: "2.0.0", preview: "1. 수집 항목: 이름, 연락처, 사진...", created_at: "2025-01-01T00:00:00.000Z", created_by: "슈퍼관리자" },
  ],
  terms_of_service: [
    { id: "tv-1", version: "1.5.0", preview: "1. 서비스 이용 연령: 법정대리인 동의 필요...", created_at: "2024-12-01T00:00:00.000Z", created_by: "슈퍼관리자" },
  ],
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export default function PolicyScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const operators = useOperatorsStore(s => s.operators);
  const createLog = useAuditLogStore(s => s.createLog);

  const [tab,          setTab]          = useState("refund_policy");
  const [refreshing,   setRefreshing]   = useState(false);
  const [versionsByKey,setVersionsByKey]= useState(SEED_VERSIONS);
  const [unsignedKey,  setUnsignedKey]  = useState("refund_policy");
  const [versionKey,   setVersionKey]   = useState("refund_policy");
  const [versionModal, setVersionModal] = useState(false);
  const [newVer,       setNewVer]       = useState("");
  const [newVal,       setNewVal]       = useState("");

  const versions = versionsByKey[versionKey] ?? [];

  const unsignedOperators = operators.filter(op => {
    if (unsignedKey === "refund_policy")    return !op.policyRefundRead;
    if (unsignedKey === "privacy_policy")   return !op.policyPrivacyRead;
    if (unsignedKey === "terms_of_service") return !op.policyTermsAgreed;
    return false;
  });

  function handleSaveVersion() {
    if (!newVer || !newVal) return;
    const entry = {
      id:         `ver-${Date.now()}`,
      version:    newVer,
      preview:    newVal.slice(0, 80),
      created_at: new Date().toISOString(),
      created_by: actorName,
    };
    setVersionsByKey(prev => ({
      ...prev,
      [versionKey]: [entry, ...(prev[versionKey] ?? [])],
    }));
    createLog({ category: '정책', title: `정책 버전 저장: ${TABS.find(t => t.key === versionKey)?.label} v${newVer}`, detail: newVal.slice(0, 80), actorName, impact: 'medium' });
    setVersionModal(false); setNewVer(""); setNewVal("");
  }

  const policyLabel = TABS.find(t => t.key === tab)?.label ?? "";

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="정책·컴플라이언스" homePath="/(super)/more" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabContent}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {POLICY_KEYS.includes(tab) && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}>
          <View style={s.policyCard}>
            <View style={s.policyHeader}>
              <View style={s.policyIconBg}>
                <FileText size={16} color={P} />
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
              <GitBranch size={16} color={P} />
              <Text style={s.actionTxt}>버전 이력 확인</Text>
              <ChevronRight size={15} color="#64748B" />
            </Pressable>
            <View style={s.divider} />
            <Pressable style={s.actionRow} onPress={() => { setUnsignedKey(tab); setTab("unsigned"); }}>
              <CircleAlert size={16} color="#D96C6C" />
              <Text style={[s.actionTxt, { color: "#D96C6C" }]}>미동의 운영자 확인</Text>
              <ChevronRight size={15} color="#64748B" />
            </Pressable>
            <View style={s.divider} />
            <Pressable style={s.actionRow} onPress={() => { setVersionKey(tab); setVersionModal(true); }}>
              <CirclePlus size={16} color="#2EC4B6" />
              <Text style={[s.actionTxt, { color: "#2EC4B6" }]}>새 버전 저장</Text>
              <ChevronRight size={15} color="#64748B" />
            </Pressable>
          </View>
        </ScrollView>
      )}

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
          <FlatList
            data={versions}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 80 }}
            ListHeaderComponent={
              <Pressable style={s.addVerBtn} onPress={() => setVersionModal(true)}>
                <Plus size={13} color="#fff" />
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
                <GitBranch size={28} color="#D1D5DB" />
                <Text style={s.emptyTxt}>저장된 버전이 없습니다</Text>
              </View>
            }
          />
        </View>
      )}

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
          <FlatList
            data={unsignedOperators}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 80 }}
            ListHeaderComponent={
              unsignedOperators.length > 0 ? (
                <View style={s.unsignedHeader}>
                  <CircleAlert size={14} color="#D96C6C" />
                  <Text style={s.unsignedHeaderTxt}>
                    {TABS.find(t => t.key === unsignedKey)?.label} 미동의 운영자 {unsignedOperators.length}명
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable style={s.unsignedRow}
                onPress={() => router.push(`/(super)/operator-detail?id=${item.id}&backTo=policy` as any)}>
                <View style={s.unsignedLeft}>
                  <View style={s.unsignedBullet} />
                  <View>
                    <Text style={s.unsignedName}>{item.name}</Text>
                    <Text style={s.unsignedSub}>{item.representativeName} · {fmtDate(item.createdAt)} 가입</Text>
                  </View>
                </View>
                <View style={[s.unsignedBadge, { backgroundColor: item.isApproved ? "#E6FFFA" : "#FFF1BF" }]}>
                  <Text style={[s.unsignedBadgeTxt, { color: item.isApproved ? "#2EC4B6" : "#D97706" }]}>
                    {item.isApproved ? "승인" : "대기"}
                  </Text>
                </View>
                <ChevronRight size={14} color="#64748B" />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={s.empty}>
                <CircleCheck size={28} color="#2E9B6F" />
                <Text style={s.emptyTxt}>모든 운영자가 동의했습니다</Text>
              </View>
            }
          />
        </View>
      )}

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
                  placeholder="예: 2.1.0" placeholderTextColor="#64748B" />
              </View>
              <View style={m.section}>
                <Text style={m.label}>내용 *</Text>
                <TextInput style={[m.input, { minHeight: 100 }]} value={newVal}
                  onChangeText={setNewVal} multiline placeholder="정책 내용"
                  placeholderTextColor="#64748B" textAlignVertical="top" />
              </View>
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setVersionModal(false)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: !newVer || !newVal ? 0.4 : 1 }]}
                  onPress={handleSaveVersion} disabled={!newVer || !newVal}>
                  <Text style={m.saveTxt}>저장</Text>
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
  safe:            { flex: 1, backgroundColor: C.background },
  tabBar:          { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:      { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  tab:             { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  tabActive:       { backgroundColor: "#EEDDF5" },
  tabTxt:          { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  tabTxtActive:    { color: P, fontFamily: "Pretendard-Regular" },
  subTabBar:       { flexGrow: 0, backgroundColor: "#F1F5F9", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  subTabContent:   { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  subTab:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  subTabActive:    { backgroundColor: "#EEDDF5" },
  subTabTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  policyCard:      { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 12,
                     borderWidth: 1, borderColor: "#E5E7EB" },
  policyHeader:    { flexDirection: "row", alignItems: "center", gap: 10 },
  policyIconBg:    { width: 34, height: 34, borderRadius: 10, backgroundColor: "#EEDDF5",
                     alignItems: "center", justifyContent: "center" },
  policyTitle:     { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  activeBadge:     { backgroundColor: "#E6FFFA", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeBadgeTxt:  { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
  policyBody:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 22 },
  actionCard:      { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  actionRow:       { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  actionTxt:       { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  divider:         { height: 1, backgroundColor: "#FFFFFF", marginHorizontal: 14 },
  addVerBtn:       { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: P,
                     borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
                     alignSelf: "flex-start", marginBottom: 10 },
  addVerTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
  verRow:          { flexDirection: "row", alignItems: "flex-start", gap: 10,
                     backgroundColor: "#fff", borderRadius: 12, padding: 14,
                     borderWidth: 1, borderColor: "#E5E7EB" },
  verBadge:        { backgroundColor: "#EEDDF5", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verBadgeTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: P },
  verPreview:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 18 },
  verMeta:         { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 4 },
  unsignedHeader:  { flexDirection: "row", alignItems: "center", gap: 8,
                     backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12, marginBottom: 6 },
  unsignedHeaderTxt:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  unsignedRow:     { flexDirection: "row", alignItems: "center", gap: 10,
                     backgroundColor: "#fff", borderRadius: 12, padding: 14,
                     borderWidth: 1, borderColor: "#E5E7EB" },
  unsignedLeft:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  unsignedBullet:  { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#D96C6C", flexShrink: 0 },
  unsignedName:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  unsignedSub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  unsignedBadge:   { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  unsignedBadgeTxt:{ fontSize: 10, fontFamily: "Pretendard-Regular" },
  empty:           { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTxt:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40,
               maxHeight: "80%", gap: 14 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -8 },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
               fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF" },
  cancelTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
