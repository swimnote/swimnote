import { ArrowLeft } from "lucide-react-native";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

const TERMS = [
  {
    title: "1. 서비스 정의",
    body: "스윔노트는 수영장 운영자, 강사, 학부모를 연결하여 회원관리, 수업관리, 출결, 일지, 보강, 공지 기능을 제공하는 수영장 운영 관리 플랫폼입니다.",
  },
  {
    title: "2. 계정 및 이용",
    body: "계정 유형은 수영장 관리자, 선생님, 학부모로 구분됩니다.\n학부모는 관리자 승인 후 이용 가능합니다.\n계정 정보는 정확하게 입력해야 하며 허위 정보 입력 시 이용이 제한될 수 있습니다.",
  },
  {
    title: "3. 서비스 제공 범위",
    body: "회원 관리, 출결 관리, 수업 일지, 보강 관리, 공지 및 메시지, 수업 관련 데이터 관리 기능을 제공합니다.",
  },
  {
    title: "4. 데이터 관리 및 책임",
    body: "모든 데이터는 수영장 단위로 관리됩니다.\n학생 정보 및 수업 데이터의 관리 책임은 수영장 관리자에게 있습니다.\n플랫폼은 데이터 저장 및 처리 역할을 수행합니다.",
  },
  {
    title: "5. 데이터 삭제 정책",
    body: "사진 및 영상 데이터는 장기 보관되지 않으며 일정 기간 내 삭제될 수 있습니다.\n관리자가 삭제한 데이터는 복구되지 않습니다.",
  },
  {
    title: "6. 회원 탈퇴 및 데이터 처리",
    body: "회원 탈퇴 시 회원 정보는 탈퇴일로부터 3개월간 보관됩니다.\n3개월 이내 재가입 시 기존 데이터 복구가 가능합니다.\n3개월 경과 시 데이터는 완전히 삭제되며 복구할 수 없습니다.",
  },
  {
    title: "7. 서비스 이용 제한",
    body: "비정상적인 시스템 사용, 계정 도용, 서비스 운영 방해 행위 시 이용이 제한될 수 있습니다.",
  },
  {
    title: "8. 서비스 변경",
    body: "서비스 기능은 운영 정책에 따라 사전 고지 없이 변경될 수 있습니다.",
  },
  {
    title: "9. 면책",
    body: "수업 내용 및 교육 품질에 대한 책임은 각 수영장에 있습니다.\n플랫폼은 기술 제공 역할을 수행합니다.",
  },
];

export default function TermsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>이용약관</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      >
        <Text style={[styles.effectiveDate, { color: C.textMuted }]}>
          시행일: 2025년 1월 1일
        </Text>

        {TERMS.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: C.text }]}>{section.title}</Text>
            <Text style={[styles.sectionBody, { color: C.textSecondary }]}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn:       { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle:   { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  content:       { paddingHorizontal: 20, paddingTop: 12, gap: 20 },
  effectiveDate: { fontSize: 12, fontFamily: "Pretendard-Regular", marginBottom: 4 },
  section:       { gap: 6 },
  sectionTitle:  { fontSize: 14, fontFamily: "Pretendard-SemiBold", lineHeight: 20 },
  sectionBody:   { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22 },
});
