/**
 * (teacher)/my-info.tsx — 내 정보
 *
 * 섹션:
 *  1. 프로필 (이름/연락처/직급 + 편집 모달)
 *  2. 내반 통계 (요일별 회원 수)
 *  3. 회원 현황 (정상/연기/탈퇴)
 *  4. 권한 정보
 *  5. 관리자 모드 전환 (복수 역할자만)
 *  6. 선생님 권한 탈퇴 요청
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
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
  position: string | null; role: string;
}
interface DayStat { day: string; count: number; }
interface MemberStatus { active: number; suspended: number; withdrawn: number; }
interface MemberItem {
  id: string; name: string; status: string;
  class_name: string | null; updated_at: string | null; deleted_at: string | null;
}

const DAY_COLORS: Record<string, string> = {
  월: "#4EA7D8", 화: "#8B5CF6", 수: "#1F8F86",
  목: "#E4A93A", 금: "#D96C6C", 토: "#1F8F86", 일: "#6F6B68",
};

const ROLE_LABEL: Record<string, string> = {
  pool_admin: "관리자",
  teacher: "선생님",
  parent: "학부모",
};

export default function MyInfoScreen() {
  const { token, adminUser, switchRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [profile,     setProfile]     = useState<Profile | null>(null);
  const [dayStats,    setDayStats]    = useState<DayStat[]>([]);
  const [memStatus,   setMemStatus]   = useState<MemberStatus>({ active: 0, suspended: 0, withdrawn: 0 });
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const [memberView,  setMemberView]  = useState<"active"|"suspended"|"withdrawn"|null>(null);
  const [memberList,  setMemberList]  = useState<MemberItem[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editName,    setEditName]    = useState("");
  const [editPhone,   setEditPhone]   = useState("");
  const [editPos,     setEditPos]     = useState("");
  const [editSaving,  setEditSaving]  = useState(false);
  const [editMsg,     setEditMsg]     = useState("");

  const [resignVisible, setResignVisible] = useState(false);
  const [resignReason,  setResignReason]  = useState("");
  const [resignSaving,  setResignSaving]  = useState(false);
  const [resignMsg,     setResignMsg]     = useState("");

  const [switchModalVisible, setSwitchModalVisible] = useState(false);
  const [switching, setSwitching] = useState(false);
  const hasMultipleRoles = (adminUser?.roles?.length ?? 0) >= 2;

  async function handleSwitchRole(role: string) {
    setSwitching(true);
    try {
      await switchRole(role);
      setSwitchModalVisible(false);
      const cfg = ROLE_CONFIGS[role];
      if (cfg) router.replace(cfg.route as any);
    } catch (e) { console.error(e); }
    finally { setSwitching(false); }
  }

  const load = useCallback(async () => {
    try {
      const [profRes, statsRes] = await Promise.all([
        apiRequest(token, "/teacher/me"),
        apiRequest(token, "/teacher/me/stats"),
      ]);
      if (profRes.ok)  setProfile(await profRes.json());
      if (statsRes.ok) {
        const d = await statsRes.json();
        setDayStats(d.day_stats || []);
        setMemStatus(d.member_status || { active: 0, suspended: 0, withdrawn: 0 });
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function openMemberView(status: "active"|"suspended"|"withdrawn") {
    setMemberView(status);
    setMemberLoading(true);
    try {
      const res = await apiRequest(token, `/teacher/me/members?status=${status}`);
      if (res.ok) setMemberList(await res.json());
      else setMemberList([]);
    } finally { setMemberLoading(false); }
  }

  function openEdit() {
    if (!profile) return;
    setEditName(profile.name || ""); setEditPhone(profile.phone || "");
    setEditPos(profile.position || ""); setEditMsg(""); setEditVisible(true);
  }

  async function saveProfile() {
    setEditSaving(true); setEditMsg("");
    try {
      const res = await apiRequest(token, "/teacher/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, phone: editPhone, position: editPos }),
      });
      if (res.ok) {
        setProfile(prev => prev ? { ...prev, name: editName, phone: editPhone, position: editPos } : prev);
        setEditMsg("저장되었습니다.");
        setTimeout(() => { setEditMsg(""); setEditVisible(false); }, 1000);
      } else {
        const d = await res.json(); setEditMsg(d.error || "저장 실패");
      }
    } finally { setEditSaving(false); }
  }

  async function submitResign() {
    if (!resignReason.trim()) { setResignMsg("사유를 입력해주세요."); return; }
    setResignSaving(true); setResignMsg("");
    try {
      const res = await apiRequest(token, "/teacher/resign-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: resignReason }),
      });
      const d = await res.json();
      setResignMsg(d.message || (res.ok ? "요청이 접수되었습니다." : "오류가 발생했습니다."));
      if (res.ok) { setResignReason(""); setTimeout(() => { setResignMsg(""); setResignVisible(false); }, 2000); }
    } finally { setResignSaving(false); }
  }

  /* ── 회원 목록 서브뷰 ── */
  if (memberView) {
    const labels: Record<string, string> = { active: "정상회원", suspended: "연기회원", withdrawn: "탈퇴회원" };
    const colors: Record<string, string> = { active: "#1F8F86", suspended: "#E4A93A", withdrawn: "#D96C6C" };
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title={labels[memberView]} onBack={() => setMemberView(null)} homePath="/(teacher)/today-schedule" />
        {memberLoading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            data={memberList}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 60 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.emptyBox}>
                <Feather name="users" size={36} color={C.textMuted} />
                <Text style={s.emptyText}>{labels[memberView]}이 없습니다</Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={[s.memberRow, { backgroundColor: C.card }]}
                onPress={() => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id } } as any)}
              >
                <View style={[s.memberAvatar, { backgroundColor: colors[memberView] + "20" }]}>
                  <Text style={[s.memberAvatarText, { color: colors[memberView] }]}>{item.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.memberName}>{item.name}</Text>
                  {item.class_name ? <Text style={s.memberSub}>{item.class_name}</Text> : null}
                  {item.deleted_at ? <Text style={s.memberSub}>탈퇴일: {item.deleted_at?.slice(0,10)}</Text> : null}
                </View>
                <View style={[s.statusBadge, { backgroundColor: colors[memberView] + "20" }]}>
                  <Text style={[s.statusBadgeText, { color: colors[memberView] }]}>{labels[memberView]}</Text>
                </View>
                <Feather name="chevron-right" size={14} color={C.textMuted} />
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="내 정보" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const maxDay = Math.max(...dayStats.map(d => d.count), 1);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="내 정보" homePath="/(teacher)/today-schedule" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
      >

        {/* ── 프로필 카드 ── */}
        <View style={[s.card, { padding: 18 }]}>
          <View style={s.cardRow}>
            <View style={[s.avatarLg, { backgroundColor: themeColor + "20" }]}>
              <Text style={[s.avatarLgText, { color: themeColor }]}>{profile?.name?.[0] || "T"}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.profileName}>{profile?.name || "-"}</Text>
              {profile?.position ? <Text style={s.profileSub}>{profile.position}</Text> : null}
              <Text style={s.profileSub}>{profile?.phone || "-"}</Text>
              <Text style={[s.profileSub, { color: "#9A948F" }]}>{profile?.email || "-"}</Text>
            </View>
            <Pressable style={[s.editBtn, { borderColor: themeColor }]} onPress={openEdit}>
              <Feather name="edit-2" size={14} color={themeColor} />
              <Text style={[s.editBtnText, { color: themeColor }]}>편집</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 권한 정보 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="shield" size={15} color={themeColor} />
            <Text style={s.cardTitle}>권한 정보</Text>
          </View>
          <View style={{ padding: 16, gap: 8 }}>
            <View style={s.permRow}>
              <Text style={s.permLabel}>현재 역할</Text>
              <View style={[s.permBadge, { backgroundColor: themeColor + "15" }]}>
                <Text style={[s.permBadgeText, { color: themeColor }]}>선생님</Text>
              </View>
            </View>
            {adminUser?.roles && adminUser.roles.length > 1 && (
              <View style={s.permRow}>
                <Text style={s.permLabel}>보유 역할</Text>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {adminUser.roles.map((r: string) => (
                    <View key={r} style={[s.permBadge, { backgroundColor: "#F6F3F1" }]}>
                      <Text style={[s.permBadgeText, { color: C.textSecondary }]}>{ROLE_LABEL[r] ?? r}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* ── 내반 통계 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="bar-chart-2" size={15} color={themeColor} />
            <Text style={s.cardTitle}>내반 통계 (요일별 회원 수)</Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
            {dayStats.filter(() => true).map(ds => (
              <View key={ds.day} style={s.dayRow}>
                <Text style={[s.dayLabel, { color: DAY_COLORS[ds.day] || C.text }]}>{ds.day}</Text>
                <View style={s.dayBarWrap}>
                  <View style={[s.dayBar, {
                    width: `${(ds.count / maxDay) * 100}%` as any,
                    backgroundColor: (DAY_COLORS[ds.day] || themeColor) + "CC",
                    minWidth: ds.count > 0 ? 4 : 0,
                  }]} />
                </View>
                <Text style={s.dayCount}>{ds.count}명</Text>
              </View>
            ))}
            {dayStats.every(d => d.count === 0) && (
              <Text style={s.emptyText}>담당 반이 없거나 배정된 회원이 없습니다</Text>
            )}
          </View>
        </View>

        {/* ── 회원 현황 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="users" size={15} color={themeColor} />
            <Text style={s.cardTitle}>회원 현황</Text>
          </View>
          {([
            { key: "active",    label: "정상회원", count: memStatus.active,    color: "#1F8F86" },
            { key: "suspended", label: "연기회원", count: memStatus.suspended, color: "#E4A93A" },
            { key: "withdrawn", label: "탈퇴회원", count: memStatus.withdrawn, color: "#D96C6C" },
          ] as const).map((row, i) => (
            <Pressable
              key={row.key}
              style={[s.memRow, i < 2 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
              onPress={() => openMemberView(row.key)}
            >
              <View style={[s.memDot, { backgroundColor: row.color }]} />
              <Text style={s.memLabel}>{row.label}</Text>
              <Text style={[s.memCount, { color: row.color }]}>{row.count}명</Text>
              <Feather name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* ── 관리자 모드 전환 ── */}
        {hasMultipleRoles && (
          <Pressable
            style={[s.actionBtn, { backgroundColor: "#DDF2EF", borderColor: "#1F8F86" }]}
            onPress={() => setSwitchModalVisible(true)}
          >
            <Feather name="repeat" size={18} color="#1F8F86" />
            <Text style={[s.actionBtnText, { color: "#1F8F86" }]}>모드 전환 (관리자↔선생님)</Text>
            <Feather name="chevron-right" size={16} color="#1F8F86" />
          </Pressable>
        )}

        {/* ── 탈퇴 요청 ── */}
        <Pressable
          style={[s.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}
          onPress={() => { setResignReason(""); setResignMsg(""); setResignVisible(true); }}
        >
          <Feather name="user-x" size={18} color="#D96C6C" />
          <Text style={[s.actionBtnText, { color: "#D96C6C" }]}>선생님 권한 탈퇴 요청</Text>
          <Feather name="chevron-right" size={16} color="#D96C6C" />
        </Pressable>

      </ScrollView>

      {/* ═══ 정보 편집 모달 ═══ */}
      <Modal visible={editVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>내 정보 수정</Text>
              <Pressable onPress={() => setEditVisible(false)} hitSlop={8}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            <Text style={s.inputLabel}>이름</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editName} onChangeText={setEditName} placeholder="이름" placeholderTextColor={C.textMuted} />
            <Text style={s.inputLabel}>연락처</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editPhone} onChangeText={setEditPhone} placeholder="010-0000-0000" placeholderTextColor={C.textMuted} keyboardType="phone-pad" />
            <Text style={s.inputLabel}>직급 / 직책</Text>
            <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={editPos} onChangeText={setEditPos} placeholder="예: 수석강사" placeholderTextColor={C.textMuted} />
            {editMsg ? (
              <View style={[s.msgBox, { backgroundColor: editMsg.includes("저장") ? "#DDF2EF" : "#F9DEDA" }]}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: editMsg.includes("저장") ? "#1F8F86" : "#D96C6C" }}>{editMsg}</Text>
              </View>
            ) : null}
            <Pressable style={[s.confirmBtn, { backgroundColor: themeColor, opacity: editSaving ? 0.7 : 1, marginTop: 16 }]} onPress={saveProfile} disabled={editSaving}>
              {editSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>저장</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ═══ 탈퇴 요청 모달 ═══ */}
      <Modal visible={resignVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>선생님 권한 탈퇴 요청</Text>
              <Pressable onPress={() => setResignVisible(false)} hitSlop={8}><Feather name="x" size={22} color={C.text} /></Pressable>
            </View>
            <View style={[s.warnBox, { marginBottom: 14 }]}>
              <Feather name="alert-triangle" size={14} color="#92400E" />
              <Text style={s.warnText}>요청 접수 후 관리자가 확인 및 처리합니다. 즉시 탈퇴가 아닙니다.</Text>
            </View>
            <Text style={s.inputLabel}>요청 사유</Text>
            <TextInput style={[s.input, s.textArea, { borderColor: C.border, color: C.text }]} value={resignReason} onChangeText={setResignReason} placeholder="퇴직 사유 또는 권한 종료 이유를 입력해주세요..." placeholderTextColor={C.textMuted} multiline numberOfLines={4} textAlignVertical="top" />
            {resignMsg ? (
              <View style={[s.msgBox, { backgroundColor: resignMsg.includes("접수") ? "#DDF2EF" : "#F9DEDA" }]}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: resignMsg.includes("접수") ? "#1F8F86" : "#D96C6C" }}>{resignMsg}</Text>
              </View>
            ) : null}
            <Pressable style={[s.confirmBtn, { backgroundColor: "#D96C6C", opacity: resignSaving ? 0.7 : 1, marginTop: 16 }]} onPress={submitResign} disabled={resignSaving}>
              {resignSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>탈퇴 요청 제출</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ═══ 역할 전환 모달 ═══ */}
      <Modal visible={switchModalVisible} animationType="fade" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>모드 전환</Text>
              <Pressable onPress={() => setSwitchModalVisible(false)} hitSlop={8}><Feather name="x" size={22} color={C.text} /></Pressable>
            </View>
            <Text style={[s.inputLabel, { marginBottom: 12 }]}>전환할 역할을 선택하세요</Text>
            {(adminUser?.roles || []).filter((r: string) => r !== "teacher").map((role: string) => (
              <Pressable
                key={role}
                style={[s.confirmBtn, { backgroundColor: themeColor, opacity: switching ? 0.7 : 1, marginBottom: 8 }]}
                onPress={() => handleSwitchRole(role)}
                disabled={switching}
              >
                {switching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>{ROLE_LABEL[role] ?? role} 모드로 전환</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: "#F6F3F1" },
  card:             { backgroundColor: C.card, borderRadius: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardRow:          { flexDirection: "row", alignItems: "center", gap: 14 },
  cardHeader:       { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, paddingBottom: 12 },
  cardTitle:        { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  avatarLg:         { width: 54, height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarLgText:     { fontSize: 22, fontFamily: "Inter_700Bold" },
  profileName:      { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  profileSub:       { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  editBtn:          { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  editBtnText:      { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  permRow:          { flexDirection: "row", alignItems: "center", gap: 8 },
  permLabel:        { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, width: 64 },
  permBadge:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  permBadgeText:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  dayRow:           { flexDirection: "row", alignItems: "center", gap: 10 },
  dayLabel:         { width: 20, fontSize: 13, fontFamily: "Inter_700Bold" },
  dayBarWrap:       { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: "hidden" },
  dayBar:           { height: 8, borderRadius: 4 },
  dayCount:         { width: 36, fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary, textAlign: "right" },
  memRow:           { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  memDot:           { width: 10, height: 10, borderRadius: 5 },
  memLabel:         { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
  memCount:         { fontSize: 16, fontFamily: "Inter_700Bold" },
  actionBtn:        { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderRadius: 14, borderWidth: 1 },
  actionBtnText:    { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  emptyBox:         { alignItems: "center", gap: 10, paddingVertical: 40 },
  emptyText:        { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
  memberRow:        { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12 },
  memberAvatar:     { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  memberAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  memberName:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  memberSub:        { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  statusBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  modalOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox:         { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 10 },
  modalHeader:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  modalTitle:       { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  inputLabel:       { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  input:            { borderWidth: 1.5, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  textArea:         { minHeight: 90, textAlignVertical: "top" },
  msgBox:           { padding: 10, borderRadius: 10 },
  confirmBtn:       { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmBtnText:   { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  warnBox:          { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#FFF1BF", padding: 10, borderRadius: 10 },
  warnText:         { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#92400E" },
});
