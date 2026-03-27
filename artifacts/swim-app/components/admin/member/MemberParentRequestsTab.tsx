import { Inbox } from "lucide-react-native";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { ms } from "./memberDetailStyles";

const C = Colors.light;

const REQ_TYPE: Record<string, string> = {
  absence:    "결석 요청",
  makeup:     "보강 요청",
  counseling: "상담 요청",
  inquiry:    "문의",
};

interface MemberParentRequestsTabProps {
  parentRequests: any[];
}

export function MemberParentRequestsTab({ parentRequests }: MemberParentRequestsTabProps) {
  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>학부모 요청 ({parentRequests.length}건)</Text>
        {parentRequests.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 30 }}>
            <Inbox size={36} color={C.textMuted} />
            <Text style={{ fontSize: 14, color: C.textMuted, marginTop: 10 }}>요청 기록이 없습니다</Text>
          </View>
        ) : parentRequests.map((req: any, i: number) => (
          <View key={req.id || i} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: C.text }}>{REQ_TYPE[req.type] || req.type || "요청"}</Text>
              <Text style={{ fontSize: 11, color: C.textMuted }}>{new Date(req.created_at).toLocaleDateString("ko-KR")}</Text>
            </View>
            {req.content && (
              <Text style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>{req.content}</Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
              <View style={[{ borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }, { backgroundColor: req.status === "pending" ? "#FFF1BF" : "#E6FFFA" }]}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: req.status === "pending" ? "#D97706" : "#2EC4B6" }}>
                  {req.status === "pending" ? "처리 대기" : "처리 완료"}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
