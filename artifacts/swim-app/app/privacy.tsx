import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

const SECTIONS = [
  {
    title: "1. 수집 항목",
    body: "이름, 전화번호, 자녀 정보, 수업 기록",
    note: "※ 사진 및 영상은 장기 저장하지 않습니다.",
  },
  {
    title: "2. 이용 목적",
    body: "수업 관리, 출결 확인, 학부모 안내, 서비스 운영",
  },
  {
    title: "3. 보관 기간",
    body: "회원 정보: 탈퇴 후 3개월 보관 후 삭제\n사진 및 영상: 장기 보관하지 않으며 시스템 정책에 따라 삭제",
  },
  {
    title: "4. 제3자 제공",
    body: "원칙적으로 외부 제공하지 않습니다.\n법적 요청이 있는 경우에만 제공될 수 있습니다.",
  },
  {
    title: "5. 보안",
    body: "인증 기반 접근 제어\n역할 기반 데이터 접근 제한",
  },
];

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>개인정보 처리방침</Text>
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
            {!!section.note && (
              <Text style={[styles.sectionNote, { color: C.textMuted }]}>{section.note}</Text>
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
  sectionNote:   { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, fontStyle: "italic" },
});
