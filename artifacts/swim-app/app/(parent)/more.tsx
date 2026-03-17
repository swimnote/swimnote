import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

function MenuItem({ icon, label, sub, onPress, danger = false }: {
  icon: any; label: string; sub?: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.menuItem, { backgroundColor: C.card, opacity: pressed ? 0.8 : 1 }]}
      onPress={onPress}
    >
      <View style={[s.menuIcon, { backgroundColor: danger ? "#FEE2E2" : C.tintLight }]}>
        <Feather name={icon} size={20} color={danger ? C.absent : C.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.menuLabel, { color: danger ? C.absent : C.text }]}>{label}</Text>
        {sub ? <Text style={[s.menuSub, { color: C.textMuted }]}>{sub}</Text> : null}
      </View>
      {!danger && <Feather name="chevron-right" size={18} color={C.textMuted} />}
    </Pressable>
  );
}

export default function ParentMoreScreen() {
  const insets = useSafeAreaInsets();
  const { parentAccount, logout } = useAuth();
  const { selectedStudent, students } = useParent();

  async function handleFullLogout() {
    await logout();
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[s.headerTitle, { color: C.text }]}>더보기</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 8 }}
      >
        {/* 프로필 카드 */}
        {parentAccount && (
          <View style={[s.profileCard, { backgroundColor: C.tint }]}>
            <View style={s.profileAvatar}>
              <Text style={s.profileAvatarTxt}>{parentAccount.name?.[0] ?? "P"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.profileName}>{parentAccount.name}님</Text>
              <Text style={s.profilePool}>{parentAccount.pool_name || "수영장"}</Text>
            </View>
            <Pressable style={s.settingsBtn}>
              <Feather name="settings" size={20} color="rgba(255,255,255,0.8)" />
            </Pressable>
          </View>
        )}

        {/* 자녀 정보 */}
        {students.length > 0 && (
          <View style={[s.childrenCard, { backgroundColor: C.card }]}>
            <Text style={[s.childrenTitle, { color: C.textMuted }]}>등록된 자녀</Text>
            {students.map(st => (
              <View key={st.id} style={[s.childRow, { borderTopColor: C.border }]}>
                <View style={[s.childAvatar, { backgroundColor: C.tintLight }]}>
                  <Text style={[s.childAvatarTxt, { color: C.tint }]}>{st.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.childName, { color: C.text }]}>{st.name}</Text>
                  {st.class_group?.name ? (
                    <Text style={[s.childClass, { color: C.textMuted }]}>{st.class_group.name}</Text>
                  ) : null}
                </View>
                {selectedStudent?.id === st.id && (
                  <View style={[s.selectedBadge, { backgroundColor: C.tintLight }]}>
                    <Feather name="check" size={12} color={C.tint} />
                    <Text style={[s.selectedTxt, { color: C.tint }]}>선택됨</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        <Text style={[s.sectionLabel, { color: C.textMuted }]}>자녀 정보</Text>
        <MenuItem
          icon="award"
          label="레벨"
          sub={selectedStudent ? `${selectedStudent.name}의 레벨 기록` : "자녀를 선택해주세요"}
          onPress={() => router.push("/(parent)/level" as any)}
        />
        <MenuItem
          icon="calendar"
          label="출결"
          sub={selectedStudent ? `${selectedStudent.name}의 출결 기록` : "자녀를 선택해주세요"}
          onPress={() => router.push("/(parent)/attendance-history" as any)}
        />

        <Text style={[s.sectionLabel, { color: C.textMuted }]}>수영장 소식</Text>
        <MenuItem
          icon="bell"
          label="공지사항"
          sub="수영장·반 공지 확인"
          onPress={() => router.push("/(parent)/notices" as any)}
        />

        <Text style={[s.sectionLabel, { color: C.textMuted }]}>계정</Text>
        <MenuItem icon="log-out" label="로그아웃" danger onPress={handleFullLogout} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  profileCard: {
    borderRadius: 20, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8,
  },
  profileAvatar: {
    width: 54, height: 54, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  profileAvatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  profilePool: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  settingsBtn: { padding: 6 },

  childrenCard: { borderRadius: 16, padding: 14, marginBottom: 4 },
  childrenTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 },
  childRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, borderTopWidth: 1 },
  childAvatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  childAvatarTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },
  childName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  childClass: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  selectedBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  selectedTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 8 },
  menuItem: {
    flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, gap: 12,
    shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1,
  },
  menuIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  menuSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
