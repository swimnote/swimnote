/**
 * (teacher)/settings.tsx — 관리설정 탭
 *
 * 섹션:
 *  1. 내 정보 (이름/연락처/직급 + 편집 모달)
 *  2. 내반 통계 (요일별 회원 수)
 *  3. 회원 현황 (정상/연기/탈퇴 인원 → 클릭 시 목록 서브뷰)
 *  4. 용량 관리 (사진/영상 총 사용량)
 *  5. 관리자 모드 전환 (조건부)
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
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";

const C = Colors.light;

interface Profile {
  id: string; name: string; email: string; phone: string;
  position: string | null; role: string;
}
interface DayStat { day: string; count: number; }
interface MemberStatus { active: number; suspended: number; withdrawn: number; }
interface MediaUsage {
  photo_bytes: number; photo_count: number;
  video_bytes: number; video_count: number;
  total_bytes: number; month_bytes: number;
}
interface MemberItem {
  id: string; name: string; status: string;
  class_name: string | null; updated_at: string | null; deleted_at: string | null;
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const DAY_COLORS: Record<string, string> = {
  월: "#3B82F6", 화: "#8B5CF6", 수: "#059669",
  목: "#F59E0B", 금: "#EF4444", 토: "#1A5CFF", 일: "#6B7280",
};

export default function TeacherSettingsScreen() {
  const { token, user, logout } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  /* ─ 데이터 ─ */
  const [profile,     setProfile]     = useState<Profile | null>(null);
  const [dayStats,    setDayStats]    = useState<DayStat[]>([]);
  const [memStatus,   setMemStatus]   = useState<MemberStatus>({ active: 0, suspended: 0, withdrawn: 0 });
  const [mediaUsage,  setMediaUsage]  = useState<MediaUsage | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  /* ─ 서브뷰: 회원 목록 ─ */
  const [memberView,  setMemberView]  = useState<"active"|"suspended"|"withdrawn"|null>(null);
  const [memberList,  setMemberList]  = useState<MemberItem[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  /* ─ 편집 모달 ─ */
  const [editVisible, setEditVisible] = useState(false);
  const [editName,    setEditName]    = useState("");
  const [editPhone,   setEditPhone]   = useState("");
  const [editPos,     setEditPos]     = useState("");
  const [editSaving,  setEditSaving]  = useState(false);
  const [editMsg,     setEditMsg]     = useState("");

  /* ─ 탈퇴요청 모달 ─ */
  const [resignVisible, setResignVisible] = useState(false);
  const [resignReason,  setResignReason]  = useState("");
  const [resignSaving,  setResignSaving]  = useState(false);
  const [resignMsg,     setResignMsg]     = useState("");

  /* ════════ 로드 ════════ */
  const load = useCallback(async () => {
    try {
      const [profRes, statsRes, mediaRes] = await Promise.all([
        apiRequest(token, "/teacher/me"),
        apiRequest(token, "/teacher/me/stats"),
        apiRequest(token, "/teacher/me/media-usage"),
      ]);
      if (profRes.ok)  setProfile(await profRes.json());
      if (statsRes.ok) {
        const d = await statsRes.json();
        setDayStats(d.day_stats || []);
        setMemStatus(d.member_status || { active: 0, suspended: 0, withdrawn: 0 });
      }
      if (mediaRes.ok) setMediaUsage(await mediaRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  /* ════════ 회원 목록 로드 ════════ */
  async function openMemberView(status: "active"|"suspended"|"withdrawn") {
    setMemberView(status);
    setMemberLoading(true);
    try {
      const res = await apiRequest(token, `/teacher/me/members?status=${status}`);
      if (res.ok) setMemberList(await res.json());
      else setMemberList([]);
    } finally { setMemberLoading(false); }
  }

  /* ════════ 편집 저장 ════════ */
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

  /* ════════ 탈퇴 요청 ════════ */
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

  /* ════════ 회원 목록 서브뷰 ════════ */
  if (memberView) {
    const labels: Record<string, string> = { active: "정상회원", suspended: "연기회원", withdrawn: "탈퇴회원" };
    const colors: Record<string, string> = { active: "#059669", suspended: "#F59E0B", withdrawn: "#DC2626" };
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setMemberView(null)}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <Text style={[s.subTitle, { color: colors[memberView] }]}>{labels[memberView]}</Text>
        </View>
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
              <View style={[s.memberRow, { backgroundColor: C.card }]}>
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
              </View>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  /* ════════ 메인 화면 ════════ */
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const isAdmin = user?.role === "pool_admin" || (profile?.role === "pool_admin");
  const maxDay = Math.max(...dayStats.map(d => d.count), 1);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <PoolHeader />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >

        {/* ── 내 정보 카드 ── */}
        <View style={[s.card, { padding: 18 }]}>
          <View style={s.cardRow}>
            <View style={[s.avatarLg, { backgroundColor: themeColor + "20" }]}>
              <Text style={[s.avatarLgText, { color: themeColor }]}>{profile?.name?.[0] || "T"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{profile?.name || "-"}</Text>
              {profile?.position ? <Text style={s.profileSub}>{profile.position}</Text> : null}
              <Text style={s.profileSub}>{profile?.phone || "-"}</Text>
              <Text style={[s.profileSub, { color: "#9CA3AF" }]}>{profile?.email || "-"}</Text>
            </View>
            <Pressable
              style={[s.editBtn, { borderColor: themeColor }]}
              onPress={openEdit}
            >
              <Feather name="edit-2" size={14} color={themeColor} />
              <Text style={[s.editBtnText, { color: themeColor }]}>편집</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 내반 통계 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="bar-chart-2" size={16} color={themeColor} />
            <Text style={s.cardTitle}>내반 통계 (요일별 회원 수)</Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
            {dayStats.filter(d => d.count > 0 || true).map(ds => (
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
            <Feather name="users" size={16} color={themeColor} />
            <Text style={s.cardTitle}>회원 현황</Text>
          </View>
          {([
            { key: "active",    label: "정상회원", count: memStatus.active,    color: "#059669" },
            { key: "suspended", label: "연기회원", count: memStatus.suspended, color: "#F59E0B" },
            { key: "withdrawn", label: "탈퇴회원", count: memStatus.withdrawn, color: "#DC2626" },
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

        {/* ── 용량 관리 ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="hard-drive" size={16} color={themeColor} />
            <Text style={s.cardTitle}>용량 관리</Text>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
            <View style={s.usageRow}>
              <View style={[s.usageIcon, { backgroundColor: "#FEF3C7" }]}>
                <Feather name="image" size={16} color="#F59E0B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.usageLabel}>사진</Text>
                <Text style={s.usageSub}>{mediaUsage?.photo_count || 0}개</Text>
              </View>
              <Text style={s.usageBytes}>{fmtBytes(mediaUsage?.photo_bytes || 0)}</Text>
            </View>
            <View style={s.usageRow}>
              <View style={[s.usageIcon, { backgroundColor: "#EDE9FE" }]}>
                <Feather name="video" size={16} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.usageLabel}>영상</Text>
                <Text style={s.usageSub}>{mediaUsage?.video_count || 0}개</Text>
              </View>
              <Text style={s.usageBytes}>{fmtBytes(mediaUsage?.video_bytes || 0)}</Text>
            </View>
            <View style={[s.usageTotal, { borderColor: themeColor + "30", backgroundColor: themeColor + "08" }]}>
              <Text style={[s.usageTotalLabel, { color: themeColor }]}>총 사용량</Text>
              <Text style={[s.usageTotalBytes, { color: themeColor }]}>{fmtBytes(mediaUsage?.total_bytes || 0)}</Text>
            </View>
            <Text style={s.usageMonthText}>이번 달 업로드: {fmtBytes(mediaUsage?.month_bytes || 0)}</Text>
          </View>
        </View>

        {/* ── 관리자 모드 전환 ── */}
        {isAdmin && (
          <Pressable
            style={[s.actionBtn, { backgroundColor: "#EFF6FF", borderColor: "#3B82F6" }]}
            onPress={() => router.replace("/org-role-select")}
          >
            <Feather name="grid" size={18} color="#3B82F6" />
            <Text style={[s.actionBtnText, { color: "#3B82F6" }]}>관리자 모드로 전환</Text>
            <Feather name="chevron-right" size={16} color="#3B82F6" />
          </Pressable>
        )}

        {/* ── 로그아웃 ── */}
        <Pressable
          style={[s.actionBtn, { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB" }]}
          onPress={async () => { await logout(); router.replace("/"); }}
        >
          <Feather name="log-out" size={18} color="#6B7280" />
          <Text style={[s.actionBtnText, { color: "#6B7280" }]}>로그아웃</Text>
          <Feather name="chevron-right" size={16} color="#9CA3AF" />
        </Pressable>

        {/* ── 탈퇴 요청 ── */}
        <Pressable
          style={[s.actionBtn, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}
          onPress={() => { setResignReason(""); setResignMsg(""); setResignVisible(true); }}
        >
          <Feather name="user-x" size={18} color="#EF4444" />
          <Text style={[s.actionBtnText, { color: "#EF4444" }]}>선생님 권한 탈퇴 요청</Text>
          <Feather name="chevron-right" size={16} color="#EF4444" />
        </Pressable>

      </ScrollView>

      {/* ════════ 정보 편집 모달 ════════ */}
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
            <TextInput
              style={[s.input, { borderColor: C.border, color: C.text }]}
              value={editName} onChangeText={setEditName}
              placeholder="이름" placeholderTextColor={C.textMuted}
            />
            <Text style={s.inputLabel}>연락처</Text>
            <TextInput
              style={[s.input, { borderColor: C.border, color: C.text }]}
              value={editPhone} onChangeText={setEditPhone}
              placeholder="010-0000-0000" placeholderTextColor={C.textMuted}
              keyboardType="phone-pad"
            />
            <Text style={s.inputLabel}>직급 / 직책</Text>
            <TextInput
              style={[s.input, { borderColor: C.border, color: C.text }]}
              value={editPos} onChangeText={setEditPos}
              placeholder="예: 수석강사" placeholderTextColor={C.textMuted}
            />

            {editMsg ? (
              <View style={[s.msgBox, { backgroundColor: editMsg.includes("저장") ? "#D1FAE5" : "#FEE2E2" }]}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: editMsg.includes("저장") ? "#059669" : "#DC2626" }}>{editMsg}</Text>
              </View>
            ) : null}

            <Pressable
              style={[s.confirmBtn, { backgroundColor: themeColor, opacity: editSaving ? 0.7 : 1, marginTop: 16 }]}
              onPress={saveProfile} disabled={editSaving}
            >
              {editSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.confirmBtnText}>저장</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ════════ 탈퇴 요청 모달 ════════ */}
      <Modal visible={resignVisible} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>선생님 권한 탈퇴 요청</Text>
              <Pressable onPress={() => setResignVisible(false)} hitSlop={8}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>

            <View style={[s.warnBox, { marginBottom: 14 }]}>
              <Feather name="alert-triangle" size={14} color="#92400E" />
              <Text style={s.warnText}>
                요청 접수 후 관리자가 확인 및 처리합니다. 즉시 탈퇴가 아닙니다.
              </Text>
            </View>

            <Text style={s.inputLabel}>요청 사유</Text>
            <TextInput
              style={[s.input, s.textArea, { borderColor: C.border, color: C.text }]}
              value={resignReason} onChangeText={setResignReason}
              placeholder="퇴직 사유 또는 권한 종료 이유를 입력해주세요..."
              placeholderTextColor={C.textMuted}
              multiline numberOfLines={4} textAlignVertical="top"
            />

            {resignMsg ? (
              <View style={[s.msgBox, { backgroundColor: resignMsg.includes("접수") ? "#D1FAE5" : "#FEE2E2" }]}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: resignMsg.includes("접수") ? "#059669" : "#DC2626" }}>{resignMsg}</Text>
              </View>
            ) : null}

            <Pressable
              style={[s.confirmBtn, { backgroundColor: "#EF4444", opacity: resignSaving ? 0.7 : 1, marginTop: 16 }]}
              onPress={submitResign} disabled={resignSaving}
            >
              {resignSaving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.confirmBtnText}>탈퇴 요청 제출</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F3F4F6" },

  card:       { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  cardTitle:  { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  cardRow:    { flexDirection: "row", alignItems: "center", gap: 14 },

  avatarLg:     { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarLgText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  profileName:  { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  profileSub:   { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  editBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  editBtnText:  { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  dayRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  dayLabel:     { width: 20, fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center" },
  dayBarWrap:   { flex: 1, height: 12, backgroundColor: "#F3F4F6", borderRadius: 6, overflow: "hidden" },
  dayBar:       { height: 12, borderRadius: 6 },
  dayCount:     { width: 36, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151", textAlign: "right" },

  memRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 15 },
  memDot:       { width: 10, height: 10, borderRadius: 5 },
  memLabel:     { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: "#111827" },
  memCount:     { fontSize: 15, fontFamily: "Inter_700Bold", marginRight: 4 },

  usageRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  usageIcon:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  usageLabel:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  usageSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  usageBytes:   { fontSize: 14, fontFamily: "Inter_700Bold", color: "#374151" },
  usageTotal:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderRadius: 12, borderWidth: 1 },
  usageTotalLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  usageTotalBytes: { fontSize: 16, fontFamily: "Inter_700Bold" },
  usageMonthText:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", textAlign: "center" },

  actionBtn:    { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16, borderWidth: 1.5 },
  actionBtnText:{ flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },

  subHeader:  { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  backBtn:    { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  subTitle:   { fontSize: 18, fontFamily: "Inter_700Bold" },

  memberRow:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  memberAvatar:   { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  memberAvatarText:{ fontSize: 15, fontFamily: "Inter_700Bold" },
  memberName:     { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#111827" },
  memberSub:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  statusBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },

  emptyBox:   { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  modalOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalBox:    { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  modalTitle:  { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },

  inputLabel:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280", marginBottom: 6, marginTop: 10 },
  input:       { borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular" },
  textArea:    { minHeight: 100, textAlignVertical: "top" },
  msgBox:      { padding: 10, borderRadius: 10, alignItems: "center", marginTop: 8 },

  warnBox:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7", padding: 10, borderRadius: 10 },
  warnText:    { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#92400E" },

  confirmBtn:  { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  confirmBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
});
