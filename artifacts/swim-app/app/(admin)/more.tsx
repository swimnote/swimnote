/**
 * 더보기 탭 — 프로필 + 활동 로그 (최소화 버전)
 * 대부분의 메뉴는 홈 대시보드 5대 카테고리 팝업으로 이동됨
 */
import { Activity, ChevronRight, Info, Repeat, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ROLE_CONFIGS } from "@/constants/auth";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;
const TABS = ["설정 메뉴", "활동 로그"] as const;
type Tab = typeof TABS[number];

interface ActivityLog {
  id: string; target_name: string; action_type: string; target_type: string;
  before_value: string | null; after_value: string | null;
  actor_name: string; actor_role: string; note: string | null; created_at: string;
}

const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  update:  { label: "정보 수정",  icon: "edit-2",      color: "#2EC4B6" },
  create:  { label: "신규 등록",  icon: "plus-circle", color: "#2EC4B6" },
  delete:  { label: "삭제",       icon: "trash-2",     color: "#D96C6C" },
  restore: { label: "복구",       icon: "rotate-ccw",  color: "#7C3AED" },
  assign:  { label: "반 배정",    icon: "link",        color: "#D97706" },
};

const TYPE_LABEL: Record<string, string> = {
  status: "상태", info: "기본정보", class: "반", diary: "일지",
  attendance: "출결", parent: "학부모",
};

// 바로가기 (대시보드에 없는 보조 메뉴만)
const N = "#0F172A"; const N_BG = "#E6FAF8";

const SHORTCUTS = [
  { label: "공지함",           icon: "bell"       as const, color: N, bg: N_BG, route: "/(admin)/notices"                     },
  { label: "휴무일 관리",      icon: "x-square"   as const, color: N, bg: N_BG, route: "/(admin)/holidays"                    },
  { label: "데이터 관리",      icon: "hard-drive" as const, color: N, bg: N_BG, route: "/(admin)/data-management"             },
  { label: "초대 안내 기록",   icon: "send"       as const, color: N, bg: N_BG, route: "/(admin)/invite-records"              },
  { label: "푸시 알림 설정",   icon: "bell"       as const, color: N, bg: N_BG, route: "/(admin)/push-notification-settings"  },
  { label: "푸시 발송 설정",   icon: "send"       as const, color: N, bg: N_BG, route: "/(admin)/push-message-settings"       },
];

const MISC = [
  { label: "내 정보",         icon: "user"       as const, color: N, bg: N_BG, route: "/(admin)/my-info" },
  { label: "Google OTP 설정", icon: "smartphone" as const, color: N, bg: N_BG, route: "/totp-setup" },
  { label: "모드 변경",       icon: "grid"       as const, color: N, bg: N_BG, route: "/(admin)/mode" },
];

export default function MoreScreen() {
  const { token, adminUser, switchRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("more");

  const [tab, setTab] = useState<Tab>("설정 메뉴");
  const [switchModalVisible, setSwitchModalVisible] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);

  const hasMultipleRoles = (adminUser?.roles?.length ?? 0) >= 2;

  /* ─ 활동 로그 ─ */
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsPage, setLogsPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const loadLogs = useCallback(async (page = 0) => {
    if (logsLoading) return;
    setLogsLoading(true);
    try {
      const res = await apiRequest(token, `/admin/activity-logs?limit=30&offset=${page * 30}`);
      if (res.ok) {
        const data: ActivityLog[] = await res.json();
        if (page === 0) setLogs(data);
        else setLogs(prev => [...prev, ...data]);
        setHasMore(data.length === 30);
        setLogsPage(page);
      }
    } catch (e) { console.error(e); }
    finally { setLogsLoading(false); setRefreshing(false); }
  }, [token, logsLoading]);

  useEffect(() => {
    if (tab === "활동 로그") loadLogs(0);
  }, [tab]);

  useEffect(() => {
    if (!token) return;
    apiRequest(token, "/auth/totp/status")
      .then(r => r.json())
      .then((d: any) => setTotpEnabled(d.totp_enabled ?? false))
      .catch(() => setTotpEnabled(false));
  }, [token]);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="더보기" />

      {/* 탭바 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t}
            style={[s.tabItem, tab === t && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
            onPress={() => setTab(t)}
          >
            <Text style={[s.tabText, { color: tab === t ? themeColor : C.textSecondary }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "설정 메뉴" ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 프로필 카드 */}
          <View style={[s.profileCard, { backgroundColor: C.card }]}>
            <View style={[s.profileAvatar, { backgroundColor: themeColor + "20" }]}>
              <Text style={[s.profileInitial, { color: themeColor }]}>{adminUser?.name?.[0] || "A"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{adminUser?.name || "관리자"}</Text>
              <Text style={s.profileRole}>수영장 관리자</Text>
            </View>
            {hasMultipleRoles && (
              <Pressable
                style={[s.switchBtn, { borderColor: themeColor }]}
                onPress={() => setSwitchModalVisible(true)}
              >
                <Repeat size={14} color={themeColor} />
                <Text style={[s.switchBtnText, { color: themeColor }]}>역할 전환</Text>
              </Pressable>
            )}
          </View>

          {/* OTP 보안 배너 */}
          {totpEnabled !== null && (
            <Pressable
              style={[
                s.otpBanner,
                { backgroundColor: totpEnabled ? "#F0FDF4" : "#FEF9EC", borderColor: totpEnabled ? "#BBF7D0" : "#FDE68A" },
              ]}
              onPress={() => router.push("/totp-setup" as any)}
            >
              <View style={[s.otpBannerIcon, { backgroundColor: totpEnabled ? "#DCFCE7" : "#FEF3C7" }]}>
                <LucideIcon name={totpEnabled ? "shield" : "smartphone"} size={18} color={totpEnabled ? "#16A34A" : "#D97706"} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.otpBannerTitle, { color: totpEnabled ? "#15803D" : "#92400E" }]}>
                  {totpEnabled ? "Google OTP 활성화됨" : "Google OTP 미등록"}
                </Text>
                <Text style={[s.otpBannerSub, { color: totpEnabled ? "#16A34A" : "#B45309" }]}>
                  {totpEnabled ? "2단계 인증이 설정되어 있습니다" : "탭하여 2단계 인증을 등록하세요"}
                </Text>
              </View>
              <ChevronRight size={16} color={totpEnabled ? "#16A34A" : "#D97706"} />
            </Pressable>
          )}

          {/* 안내 배너 */}
          <View style={s.infoBanner}>
            <Info size={14} color="#2EC4B6" />
            <Text style={s.infoBannerText}>
              메뉴 대부분은 홈 화면 아이콘(운영 관리·데이터 관리·수업 설정·운영 설정)에서 바로 접근할 수 있습니다.
            </Text>
          </View>

          {/* 바로가기 */}
          <View>
            <Text style={s.groupTitle}>바로가기</Text>
            <View style={[s.groupCard, { backgroundColor: C.card }]}>
              {SHORTCUTS.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={({ pressed }) => [
                    s.menuRow,
                    idx < SHORTCUTS.length - 1 && s.menuRowBorder,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => router.push(item.route as any)}
                >
                  <View style={[s.menuIcon, { backgroundColor: item.bg }]}>
                    <LucideIcon name={item.icon} size={18} color={item.color} />
                  </View>
                  <Text style={s.menuLabel}>{item.label}</Text>
                  <ChevronRight size={16} color={C.textMuted} style={{ marginLeft: "auto" }} />
                </Pressable>
              ))}
            </View>
          </View>

          {/* 기타 */}
          <View>
            <Text style={s.groupTitle}>기타</Text>
            <View style={[s.groupCard, { backgroundColor: C.card }]}>
              {MISC.map((item, idx) => (
                <Pressable
                  key={item.label}
                  style={({ pressed }) => [
                    s.menuRow,
                    idx < MISC.length - 1 && s.menuRowBorder,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  onPress={() => router.push(item.route as any)}
                >
                  <View style={[s.menuIcon, { backgroundColor: item.bg }]}>
                    <LucideIcon name={item.icon} size={18} color={item.color} />
                  </View>
                  <Text style={s.menuLabel}>{item.label}</Text>
                  <ChevronRight size={16} color={C.textMuted} style={{ marginLeft: "auto" }} />
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      ) : (
        /* 활동 로그 탭 */
        <FlatList
          data={logs}
          keyExtractor={(l, i) => l.id || String(i)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadLogs(0); }}
              tintColor={themeColor}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 16, gap: 8 }}
          ListEmptyComponent={
            logsLoading ? (
              <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
            ) : (
              <View style={s.empty}>
                <Activity size={40} color={C.textMuted} />
                <Text style={s.emptyText}>활동 기록이 없습니다</Text>
              </View>
            )
          }
          onEndReached={() => { if (hasMore && !logsLoading) loadLogs(logsPage + 1); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            logsLoading && logs.length > 0 ? <ActivityIndicator color={themeColor} style={{ marginVertical: 16 }} /> : null
          }
          renderItem={({ item: log }) => {
            const meta = ACTION_META[log.action_type] || { label: log.action_type, icon: "activity", color: C.textSecondary };
            const typeLabel = TYPE_LABEL[log.target_type] || log.target_type;
            const dt = new Date(log.created_at);
            const dateStr = dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
            const timeStr = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
            return (
              <View style={[s.logCard, { backgroundColor: C.card }]}>
                <View style={s.logHeader}>
                  <View style={[s.logIcon, { backgroundColor: meta.color + "15" }]}>
                    <LucideIcon name={meta.icon as any} size={16} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.logName}>{log.target_name}</Text>
                    <Text style={[s.logAction, { color: meta.color }]}>{typeLabel} {meta.label}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.logDate}>{dateStr}</Text>
                    <Text style={s.logTime}>{timeStr}</Text>
                  </View>
                </View>
                {(log.before_value || log.after_value) && (
                  <View style={s.logChange}>
                    {log.before_value && (
                      <View style={s.logValueRow}>
                        <Text style={s.logValueLabel}>변경 전</Text>
                        <Text style={[s.logValue, { color: "#D96C6C" }]}>{log.before_value}</Text>
                      </View>
                    )}
                    {log.after_value && (
                      <View style={s.logValueRow}>
                        <Text style={s.logValueLabel}>변경 후</Text>
                        <Text style={[s.logValue, { color: "#2EC4B6" }]}>{log.after_value}</Text>
                      </View>
                    )}
                  </View>
                )}
                {log.note && <Text style={s.logNote}>메모: {log.note}</Text>}
                <View style={s.logFooter}>
                  <User size={11} color={C.textMuted} />
                  <Text style={s.logActor}>{log.actor_name}</Text>
                  <Text style={s.logActorRole}>({log.actor_role === "pool_admin" ? "관리자" : "선생님"})</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* 역할 전환 모달 */}
      <Modal visible={switchModalVisible} transparent animationType="fade" onRequestClose={() => setSwitchModalVisible(false)}>
        <Pressable style={sm.overlay} onPress={() => setSwitchModalVisible(false)}>
          <Pressable style={sm.sheet} onPress={e => e.stopPropagation()}>
            <Text style={sm.title}>역할 전환</Text>
            <Text style={sm.sub}>전환할 역할을 선택하세요</Text>
            {(adminUser?.roles ?? []).map(role => {
              const cfg = ROLE_CONFIGS[role];
              if (!cfg) return null;
              const isActive = adminUser?.role === role;
              return (
                <Pressable
                  key={role}
                  style={[sm.roleRow, { borderColor: isActive ? cfg.color : C.border, backgroundColor: isActive ? cfg.color + "0A" : "#fff" }]}
                  onPress={() => !isActive && handleSwitchRole(role)}
                  disabled={isActive || switching}
                >
                  <View style={[sm.roleIcon, { backgroundColor: cfg.bgColor }]}>
                    <LucideIcon name={cfg.icon as any} size={20} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[sm.roleLabel, { color: isActive ? cfg.color : C.text }]}>{cfg.title}</Text>
                    <Text style={sm.roleSub}>{cfg.subtitle}</Text>
                  </View>
                  {isActive
                    ? <View style={[sm.activeBadge, { backgroundColor: cfg.color + "20" }]}>
                        <Text style={[sm.activeBadgeText, { color: cfg.color }]}>현재</Text>
                      </View>
                    : switching
                      ? <ActivityIndicator color={cfg.color} size="small" />
                      : <ChevronRight size={16} color={C.textMuted} />
                  }
                </Pressable>
              );
            })}
            <Pressable style={sm.closeBtn} onPress={() => setSwitchModalVisible(false)}>
              <Text style={sm.closeBtnText}>닫기</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const sm = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 },
  sheet:           { backgroundColor: "#fff", borderRadius: 24, padding: 24, width: "100%", gap: 12 },
  title:           { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:             { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 4 },
  roleRow:         { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  roleIcon:        { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel:       { fontSize: 15, fontFamily: "Pretendard-Regular" },
  roleSub:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  activeBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  activeBadgeText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  closeBtn:        { marginTop: 4, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  closeBtnText:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const s = StyleSheet.create({
  tabBar:   { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tabItem:  { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabText:  { fontSize: 14, fontFamily: "Pretendard-Regular" },

  profileCard:    { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  profileAvatar:  { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  profileInitial: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  profileName:    { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  profileRole:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  switchBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  switchBtnText:  { fontSize: 12, fontFamily: "Pretendard-Regular" },

  infoBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#E6FFFA", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E6FAF8" },
  infoBannerText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#2EC4B6", lineHeight: 18 },

  groupTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 8, paddingHorizontal: 4 },
  groupCard:  { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  menuRow:    { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  menuIcon:   { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },

  empty:      { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#64748B" },

  logCard:       { borderRadius: 16, padding: 14, gap: 8, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  logHeader:     { flexDirection: "row", alignItems: "center", gap: 10 },
  logIcon:       { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  logName:       { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  logAction:     { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },
  logDate:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  logTime:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  logChange:     { backgroundColor: "#F1F5F9", borderRadius: 10, padding: 10, gap: 4 },
  logValueRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  logValueLabel: { width: 50, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  logValue:      { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular" },
  logNote:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", fontStyle: "italic" },
  logFooter:     { flexDirection: "row", alignItems: "center", gap: 4 },
  logActor:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  logActorRole:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  otpBanner:     { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1.5, padding: 14 },
  otpBannerIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  otpBannerTitle:{ fontSize: 13, fontFamily: "Pretendard-Regular" },
  otpBannerSub:  { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
});
