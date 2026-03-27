import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

const SECTIONS = [
  {
    title: "1. 결제 안내",
    body: "현재 앱 내 결제 기능은 제공되지 않습니다.\n향후 인앱결제 방식으로 제공될 예정입니다.",
  },
  {
    title: "2. 환불 기준",
    body: "환불은 환불 요청일 기준으로 일할 계산하여 처리됩니다.",
    example: "예: 30일 이용권 중 10일 사용 → 20일 기준 환불",
  },
  {
    title: "3. 환불 제한 조건",
    body: "서비스 이용 내역 확인이 불가능한 경우\n비정상 사용 기록이 있는 경우",
  },
  {
    title: "4. 결제 플랫폼 기준",
    body: "앱스토어 결제는 애플 정책을 따릅니다.\n구글 플레이 결제는 구글 정책을 따릅니다.",
  },
];

export default function RefundScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>환불 및 결제 정책</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      >
        <Text style={[styles.effectiveDate, { color: C.textMuted }]}>
          시행일: 2025년 1월 1일
        </Text>

        {SECTIONS.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: C.text }]}>{section.title}</Text>
            <Text style={[styles.sectionBody, { color: C.textSecondary }]}>{section.body}</Text>
            {!!section.example && (
              <View style={[styles.exampleBox, { backgroundColor: C.tintLight }]}>
                <Text style={[styles.exampleText, { color: C.tint }]}>{section.example}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:       { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle:   { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },
  content:       { paddingHorizontal: 20, paddingTop: 12, gap: 20 },
  effectiveDate: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  section:       { gap: 6 },
  sectionTitle:  { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  sectionBody:   { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  exampleBox:    { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 4 },
  exampleText:   { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
