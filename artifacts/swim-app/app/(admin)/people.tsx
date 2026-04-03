/**
 * 인원관리 허브 화면
 * 회원관리 / 학부모관리 / 선생님관리 / 승인·미배정 로 진입하는 허브
 */
import { ChevronRight } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { addTabResetListener } from "@/utils/tabReset";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

interface Summary {
  totalMembers: number;
  activeMembers: number;
  inactiveMembers: number;
  withdrawnMembers: number;
  unassignedMembers: number;
  totalTeachers: number;
  pendingApprovals: number;
  unregisteredMembers: number;
}

const DEFAULT_SUMMARY: Summary = {
  totalMembers: 0,
  activeMembers: 0,
  inactiveMembers: 0,
  withdrawnMembers: 0,
  unassignedMembers: 0,
  totalTeachers: 0,
  pendingApprovals: 0,
  unregisteredMembers: 0,
};

export default function PeopleHubScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const scrollRef = useRef<ScrollView>(null);
  const [summary, setSummary] = useState<Summary>(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, studentsRes, unregRes] = await Promise.all([
        apiRequest(token, "/admin/dashboard-stats"),
        apiRequest(token, "/students"),
        apiRequest(token, "/admin/unregistered"),
      ]);

      const stats = statsRes.ok ? await statsRes.json() : {};
      const students: any[] = studentsRes.ok ? await studentsRes.json() : [];
      const unreg: any[] = unregRes.ok ? await unregRes.json() : [];

      const activeMembers = students.filter((s: any) => s.status === "active").length;
      const inactiveMembers = students.filter((s: any) => s.status === "inactive").length;
      const withdrawnMembers = students.filter((s: any) => s.status === "withdrawn").length;

      setSummary({
        totalMembers: students.length,
        activeMembers,
        inactiveMembers,
        withdrawnMembers,
        unassignedMembers: 0,
        totalTeachers: stats.total_teachers ?? 0,
        pendingApprovals: 0,
        unregisteredMembers: unreg.length,
      });
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    return addTabResetListener("people", () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      loadSummary();
    });
  }, [loadSummary]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadSummary();
  }, [loadSummary]);

  return (
    <View style={s.root}>
      <SubScreenHeader
        title="인원관리"
        subtitle="회원, 학부모, 선생님, 승인 상태를 관리합니다"
        rightSlot={
          summary.unregisteredMembers > 0 ? (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{summary.unregisteredMembers}</Text>
            </View>
          ) : undefined
        }
      />

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_BAR_H + 24, paddingTop: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor} />}
        showsVerticalScrollIndicator={false}
      >
        {loading && !refreshing ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={themeColor} />
        ) : (
          <>
            {/* ── 4개 허브 카드 ── */}
            <View style={s.grid}>

              {/* 회원관리 */}
              <HubCard
                icon="users"
                title="회원관리"
                color="#2EC4B6"
                bg="#E6FFFA"
                onPress={() => router.push("/(admin)/members?backTo=people" as any)}
                rows={[
                  { label: "전체", value: summary.totalMembers },
                  { label: "재원", value: summary.activeMembers },
                  { label: "연기", value: summary.inactiveMembers },
                ]}
                badge={summary.unassignedMembers > 0 ? `미배정 ${summary.unassignedMembers}` : undefined}
                badgeColor="#D96C6C"
              />

              {/* 선생님관리 */}
              <HubCard
                icon="user-check"
                title="선생님관리"
                color="#7C3AED"
                bg="#EEDDF5"
                onPress={() => router.push("/(admin)/people-teachers?backTo=people" as any)}
                rows={[
                  { label: "전체", value: summary.totalTeachers },
                ]}
              />

              {/* 미배정회원 */}
              <HubCard
                icon="user-x"
                title="미배정회원"
                color="#D97706"
                bg="#FFFBEB"
                onPress={() => router.push("/(admin)/people-pending?backTo=people" as any)}
                rows={[
                  { label: "미배정", value: summary.unregisteredMembers },
                ]}
                badge={summary.unregisteredMembers > 0 ? `반 미배정 ${summary.unregisteredMembers}명` : undefined}
                badgeColor="#D97706"
              />

            </View>

            {/* ── 빠른 작업 ── */}
            <Text style={s.sectionTitle}>빠른 작업</Text>
            <View style={s.quickGrid}>
              <QuickBtn
                icon="user-x"
                label="미배정회원 보기"
                onPress={() => router.push("/(admin)/people-pending?backTo=people" as any)}
                color={themeColor}
                badge={summary.unregisteredMembers > 0 ? summary.unregisteredMembers : undefined}
              />
              <QuickBtn
                icon="upload"
                label="회원 명단 업로드"
                onPress={() => router.push("/(admin)/bulk-register?backTo=people" as any)}
                color={themeColor}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function HubCard({
  icon, title, color, bg, onPress, rows, badge, badgeColor,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  color: string;
  bg: string;
  onPress: () => void;
  rows: { label: string; value: number }[];
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.card, { opacity: pressed ? 0.88 : 1 }]}
      onPress={onPress}
    >
      {/* 아이콘 + 타이틀 */}
      <View style={s.cardHeader}>
        <View style={[s.iconBox, { backgroundColor: bg }]}>
          <LucideIcon name={icon} size={22} color={color} />
        </View>
        <ChevronRight size={16} color={C.textMuted} />
      </View>

      <Text style={s.cardTitle}>{title}</Text>

      {/* 요약 수치 */}
      <View style={s.statsRow}>
        {rows.map((r, i) => (
          <View key={i} style={s.statItem}>
            <Text style={s.statValue}>{r.value}</Text>
            <Text style={s.statLabel}>{r.label}</Text>
          </View>
        ))}
      </View>

      {/* 배지 */}
      {badge && (
        <View style={[s.cardBadge, { backgroundColor: (badgeColor ?? "#D96C6C") + "18" }]}>
          <Text style={[s.cardBadgeTxt, { color: badgeColor ?? "#D96C6C" }]}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

function QuickBtn({
  icon, label, onPress, color, badge,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  color: string;
  badge?: number;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.quickBtn, { opacity: pressed ? 0.8 : 1 }]}
      onPress={onPress}
    >
      <View style={[s.quickIcon, { backgroundColor: color + "15" }]}>
        <LucideIcon name={icon} size={18} color={color} />
        {badge !== undefined && badge > 0 && (
          <View style={s.quickBadge}><Text style={s.quickBadgeTxt}>{badge}</Text></View>
        )}
      </View>
      <Text style={s.quickLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.background },
  badge:        { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeTxt:     { color: "#fff", fontSize: 11, fontWeight: "700" },

  grid:         { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 24 },

  card: {
    width: "47.5%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  iconBox:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle:    { fontSize: 15, fontWeight: "700", color: C.text, marginBottom: 12 },

  statsRow:     { flexDirection: "row", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  statItem:     { alignItems: "center" },
  statValue:    { fontSize: 20, fontWeight: "800", color: C.text },
  statLabel:    { fontSize: 10, color: C.textMuted, marginTop: 1 },

  cardBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", marginTop: 4 },
  cardBadgeTxt: { fontSize: 11, fontWeight: "700" },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: C.textMuted, marginBottom: 10 },

  quickGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickBtn: {
    width: "47.5%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  quickIcon:    { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickLabel:   { fontSize: 12, fontWeight: "600", color: C.text, textAlign: "center" },
  quickBadge:   { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  quickBadgeTxt:{ color: "#fff", fontSize: 9, fontWeight: "700" },
});
