import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { ms } from "./memberDetailStyles";

const C = Colors.light;

const MAKEUP_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  waiting:     { label: "대기",   color: "#D97706", bg: "#FFF1BF" },
  assigned:    { label: "배정",   color: "#2EC4B6", bg: "#E6FFFA" },
  transferred: { label: "이동",   color: "#7C3AED", bg: "#EEDDF5" },
  completed:   { label: "완료",   color: "#2EC4B6", bg: "#E6FFFA" },
  cancelled:   { label: "취소",   color: "#6B7280", bg: "#F8FAFC" },
};

interface MemberMakeupTabProps {
  makeups: any[];
  themeColor: string;
}

export function MemberMakeupTab({ makeups, themeColor }: MemberMakeupTabProps) {
  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>보강 이력 ({makeups.length}건)</Text>
        {makeups.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 30 }}>
            <Feather name="rotate-ccw" size={36} color={C.textMuted} />
            <Text style={{ fontSize: 14, color: C.textMuted, marginTop: 10 }}>보강 기록이 없습니다</Text>
          </View>
        ) : makeups.map((mk: any) => {
          const st = MAKEUP_STATUS[mk.status] || { label: mk.status, color: "#6B7280", bg: "#F8FAFC" };
          return (
            <View key={mk.id} style={{ flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 }}>
              <View style={[{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" }, { backgroundColor: st.bg }]}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: st.color }}>{st.label}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: C.text }}>결석일: {mk.absence_date}</Text>
                <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                  원반: {mk.original_class_group_name || "미배정"}  담당: {mk.original_teacher_name || "미배정"}
                </Text>
                {mk.assigned_class_group_name && (
                  <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 1 }}>배정반: {mk.assigned_class_group_name}</Text>
                )}
                {mk.is_substitute && mk.substitute_teacher_name && (
                  <Text style={{ fontSize: 12, color: "#2EC4B6", marginTop: 2, fontWeight: "600" }}>대리보강: {mk.substitute_teacher_name}</Text>
                )}
                {mk.transferred_to_teacher_name && (
                  <Text style={{ fontSize: 12, color: "#7C3AED", marginTop: 1 }}>이동→ {mk.transferred_to_teacher_name}</Text>
                )}
                {mk.completed_at && (
                  <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>완료: {new Date(mk.completed_at).toLocaleDateString("ko-KR")}</Text>
                )}
              </View>
            </View>
          );
        })}
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, justifyContent: "center" }}
          onPress={() => router.push("/(admin)/makeups")}
        >
          <Feather name="external-link" size={14} color={themeColor} />
          <Text style={{ fontSize: 13, color: themeColor, fontWeight: "600" }}>보강 관리 화면으로 이동</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
