/**
 * (super)/more.tsx — 슈퍼관리자 더보기
 * 저장소 정책, 시스템 설정, 플랫폼 정보
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;
const PURPLE = "#7C3AED";

function MenuItem({ icon, label, sub, onPress }: {
  icon: any; label: string; sub?: string; onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.menuItem, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
      onPress={onPress}
    >
      <View style={[s.menuIcon, { backgroundColor: "#F3E8FF" }]}>
        <Feather name={icon} size={20} color={PURPLE} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.menuLabel, { color: C.text }]}>{label}</Text>
        {sub ? <Text style={[s.menuSub, { color: C.textMuted }]}>{sub}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={C.textMuted} />
    </Pressable>
  );
}

export default function SuperMoreScreen() {
  const insets = useSafeAreaInsets();
  const { adminUser: user } = useAuth();

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[s.headerTitle, { color: C.text }]}>더보기</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 8 }}
      >
        {user && (
          <View style={[s.profileCard, { backgroundColor: PURPLE }]}>
            <View style={s.profileAvatar}>
              <Text style={s.profileAvatarTxt}>{user.name?.[0] ?? "S"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{user.name}님</Text>
              <Text style={s.profileRole}>슈퍼관리자</Text>
            </View>
          </View>
        )}

        <Text style={[s.sectionLabel, { color: C.textMuted }]}>시스템 설정</Text>
        <MenuItem
          icon="hard-drive"
          label="저장소 정책"
          sub="수영장별 영상·사진 용량 정책 설정"
          onPress={() => router.push("/(super)/storage-policy" as any)}
        />
        <MenuItem
          icon="database"
          label="데이터 동기화"
          sub="변경분 수집 · 스냅샷 관리 · 새벽 배치 현황"
          onPress={() => router.push("/(super)/sync" as any)}
        />

        <Text style={[s.sectionLabel, { color: C.textMuted }]}>플랫폼 정보</Text>
        <MenuItem
          icon="shield"
          label="권한 및 정책"
          sub="플랫폼 운영 정책 및 이용 약관"
          onPress={() => {}}
        />
        <MenuItem
          icon="info"
          label="SwimNote 정보"
          sub="버전 및 플랫폼 정보"
          onPress={() => {}}
        />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  profileCard: { borderRadius: 20, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 },
  profileAvatar: {
    width: 54, height: 54, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  profileAvatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  profileRole: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 8 },
  menuItem: {
    flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12,
    shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1,
  },
  menuIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  menuSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
