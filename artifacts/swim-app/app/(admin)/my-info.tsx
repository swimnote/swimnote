import { ChevronRight, Key, Lock, PenLine, Trash2, User } from "lucide-react-native";
import { WithdrawalModal } from "@/components/common/WithdrawalModal";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS } from "@/constants/auth";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface Profile {
  id: string; name: string; email: string; phone: string;
}

export default function AdminMyInfoScreen() {
  const { token, adminUser, updateAdminProfile, logout, pool } = useAuth();
  const isPaidPlan = adminUser?.role === "pool_admin" && !!pool?.subscription_tier && pool.subscription_tier !== "free";
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState("");

  const [pwVisible, setPwVisible] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/auth/me");
      if (res.ok) setProfile(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function saveProfile() {
    setEditSaving(true); setEditMsg("");
    try {
      const res = await apiRequest(token, "/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, phone: editPhone }),
      });
      if (res.ok) {
        const d = await res.json();
        setProfile(d);
        updateAdminProfile({ name: editName, phone: editPhone });
        setEditMsg("저장되었습니다.");
        setTimeout(() => { setEditMsg(""); setEditVisible(false); }, 1000);
      } else {
        const d = await res.json(); setEditMsg(d.error || "저장 실패");
      }
    } finally { setEditSaving(false); }
  }

  async function deleteAccount(immediate: boolean) {
    setDeleteLoading(true);
    try {
      const res = await apiRequest(token, "/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ immediate }),
      });
      if (res.ok) {
        setDeleteConfirm(false);
        await logout();
      }
    } catch { } finally { setDeleteLoading(false); }
  }

  async function submitPasswordChange() {
    if (!pwCurrent || !pwNew || !pwConfirm) { setPwMsg("모든 항목을 입력해주세요."); return; }
    if (pwNew !== pwConfirm) { setPwMsg("새 비밀번호가 일치하지 않습니다."); return; }
    if (pwNew.length < 6) { setPwMsg("새 비밀번호는 6자 이상이어야 합니다."); return; }
    setPwSaving(true); setPwMsg("");
    try {
      const res = await apiRequest(token, "/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
      });
      const d = await res.json();
      if (res.ok) {
        setPwMsg("비밀번호가 변경되었습니다.");
        setTimeout(() => { setPwVisible(false); setPwCurrent(""); setPwNew(""); setPwConfirm(""); setPwMsg(""); }, 1500);
      } else { setPwMsg(d.message || "변경에 실패했습니다."); }
    } finally { setPwSaving(false); }
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="내 정보" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="내 정보" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
      >
        {/* ── 프로필 카드 ── */}
        <View style={[s.card, { padding: 18 }]}>
          <View style={s.cardRow}>
            <View style={[s.avatar, { backgroundColor: themeColor + "20" }]}>
              <Text style={[s.avatarText, { color: themeColor }]}>{profile?.name?.[0] || "A"}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.profileName}>{profile?.name || "-"}</Text>
              <Text style={[s.profileSub, { color: C.textSecondary }]}>{ROLE_CONFIGS[adminUser?.role ?? ""]?.title || "관리자"}</Text>
              <Text style={[s.profileSub, { color: C.textSecondary }]}>{profile?.phone || "-"}</Text>
              {profile?.email ? <Text style={[s.profileSub, { color: "#64748B" }]}>{profile.email}</Text> : null}
            </View>
            <Pressable style={[s.editBtn, { borderColor: themeColor }]} onPress={() => {
              setEditName(profile?.name || ""); setEditPhone(profile?.phone || ""); setEditMsg(""); setEditVisible(true);
            }}>
              <PenLine size={14} color={themeColor} />
              <Text style={[s.editBtnText, { color: themeColor }]}>편집</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 계정 정보 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <User size={15} color={themeColor} />
            <Text style={s.cardTitle}>계정 정보</Text>
          </View>
          <View style={{ padding: 16, gap: 10 }}>
            {[
              { label: "이름", value: profile?.name || "-" },
              { label: "연락처", value: profile?.phone || "-" },
              { label: "이메일", value: profile?.email || "-" },
              { label: "역할", value: ROLE_CONFIGS[adminUser?.role ?? ""]?.title || "관리자" },
            ].map(({ label, value }) => (
              <View key={label} style={s.infoRow}>
                <Text style={[s.infoLabel, { color: C.textSecondary }]}>{label}</Text>
                <Text style={[s.infoValue, { color: C.text }]}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── 보안 설정 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Lock size={15} color={themeColor} />
            <Text style={s.cardTitle}>보안 설정</Text>
          </View>
          <Pressable
            style={({ pressed }) => [s.secItem, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => { setPwCurrent(""); setPwNew(""); setPwConfirm(""); setPwMsg(""); setPwVisible(true); }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Key size={14} color={C.textSecondary} />
              <Text style={[s.secItemLabel, { color: C.text }]}>비밀번호 변경</Text>
            </View>
            <ChevronRight size={16} color={C.textMuted} />
          </Pressable>
        </View>

        {/* ── 계정 탈퇴 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Trash2 size={15} color="#D96C6C" />
            <Text style={[s.cardTitle, { color: "#D96C6C" }]}>계정 탈퇴</Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}>
            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 }}>
              탈퇴 시 계정 및 모든 개인정보가 영구적으로 삭제되며 복구할 수 없습니다.
            </Text>
            <Pressable
              style={({ pressed }) => [s.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => setDeleteConfirm(true)}
            >
              <Text style={s.deleteBtnText}>계정 탈퇴하기</Text>
            </Pressable>
          </View>
        </View>

      </ScrollView>

      {/* ═══ 정보 편집 모달 ═══ */}
      <Modal visible={editVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.overlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>내 정보 수정</Text>
              <Pressable onPress={() => setEditVisible(false)} hitSlop={8}>
                <X size={22} color={C.text} />
              </Pressable>
            </View>
            <Text style={s.inputLabel}>이름</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editName} onChangeText={setEditName} placeholder="이름" placeholderTextColor={C.textMuted} />
            <Text style={s.inputLabel}>연락처</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editPhone} onChangeText={setEditPhone} placeholder="010-0000-0000" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
            {editMsg ? (
              <View style={[s.msgBox, { backgroundColor: editMsg.includes("저장") ? "#E6FFFA" : "#F9DEDA" }]}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: editMsg.includes("저장") ? "#2EC4B6" : "#D96C6C" }}>{editMsg}</Text>
              </View>
            ) : null}
            <Pressable style={[s.confirmBtn, { backgroundColor: C.button, opacity: editSaving ? 0.7 : 1, marginTop: 16 }]} onPress={saveProfile} disabled={editSaving}>
              {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>저장</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ═══ 비밀번호 변경 모달 ═══ */}
      <Modal visible={pwVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.overlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>비밀번호 변경</Text>
              <Pressable onPress={() => setPwVisible(false)} hitSlop={8}><X size={22} color={C.text} /></Pressable>
            </View>
            <Text style={s.inputLabel}>현재 비밀번호</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={pwCurrent} onChangeText={setPwCurrent} placeholder="현재 비밀번호" placeholderTextColor={C.textMuted} secureTextEntry />
            <Text style={s.inputLabel}>새 비밀번호</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={pwNew} onChangeText={setPwNew} placeholder="6자 이상" placeholderTextColor={C.textMuted} secureTextEntry />
            <Text style={s.inputLabel}>새 비밀번호 확인</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={pwConfirm} onChangeText={setPwConfirm} placeholder="새 비밀번호 재입력" placeholderTextColor={C.textMuted} secureTextEntry />
            {pwMsg ? (
              <View style={[s.msgBox, { backgroundColor: pwMsg.includes("변경") ? "#E6FFFA" : "#F9DEDA" }]}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: pwMsg.includes("변경") ? "#2EC4B6" : "#D96C6C" }}>{pwMsg}</Text>
              </View>
            ) : null}
            <Pressable style={[s.confirmBtn, { backgroundColor: C.button, opacity: pwSaving ? 0.7 : 1, marginTop: 16 }]} onPress={submitPasswordChange} disabled={pwSaving}>
              {pwSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>변경 완료</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      <WithdrawalModal
        visible={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={deleteAccount}
        loading={deleteLoading}
        isPaidPlan={isPaidPlan}
      />

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },
  card: { backgroundColor: C.card, borderRadius: 16, shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, paddingBottom: 4 },
  cardTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  avatar: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontFamily: "Pretendard-Regular" },
  profileName: { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.text },
  profileSub: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  editBtnText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  infoValue: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  secItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  secItemLabel: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  deleteBtn: { borderWidth: 1.5, borderColor: "#D96C6C", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  deleteBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 6 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.text },
  inputLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 6 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Pretendard-Regular", marginTop: 4 },
  msgBox: { padding: 10, borderRadius: 10, marginTop: 4 },
  confirmBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmBtnText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" },
});
