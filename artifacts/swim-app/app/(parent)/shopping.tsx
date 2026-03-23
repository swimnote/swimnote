import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function ShoppingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[s.title, { color: C.text }]}>쇼핑</Text>
      </View>
      <View style={s.body}>
        <View style={[s.icon, { backgroundColor: C.tintLight }]}>
          <Feather name="shopping-bag" size={48} color={C.tint} />
        </View>
        <Text style={[s.heading, { color: C.text }]}>쇼핑 준비중</Text>
        <Text style={[s.sub, { color: C.textMuted }]}>
          곧 다양한 수영용품과 혜택이{"\n"}제공될 예정입니다.
        </Text>
        <View style={[s.badge, { backgroundColor: "#FFF1BF", borderColor: "#FDE68A" }]}>
          <Feather name="clock" size={14} color="#D97706" />
          <Text style={[s.badgeTxt, { color: "#92400E" }]}>Coming Soon</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 80 },
  icon: { width: 100, height: 100, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 24, color: "#6F6B68" },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  badgeTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
