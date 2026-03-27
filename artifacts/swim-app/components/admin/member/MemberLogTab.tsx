import { Activity } from "lucide-react-native";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { ms } from "./memberDetailStyles";
import type { ActivityLog } from "./memberDetailTypes";

const C = Colors.light;

const ACTION_META: Record<string, { label: string; color: string }> = {
  update:  { label: "수정",  color: "#2EC4B6" },
  create:  { label: "등록",  color: "#2EC4B6" },
  delete:  { label: "삭제",  color: "#D96C6C" },
  restore: { label: "복구",  color: "#7C3AED" },
  assign:  { label: "반배정", color: "#D97706" },
};

const TYPE_LABEL: Record<string, string> = {
  status: "상태", info: "기본정보", class: "반", diary: "일지", attendance: "출결",
};

interface MemberLogTabProps {
  logs: ActivityLog[];
}

export function MemberLogTab({ logs }: MemberLogTabProps) {
  if (logs.length === 0) {
    return (
      <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
        <View style={ms.section}>
          <View style={{ alignItems: "center", paddingVertical: 30, gap: 10 }}>
            <Activity size={36} color={C.textMuted} />
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted }}>활동 기록이 없습니다</Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>변경 이력 ({logs.length}건)</Text>
        {logs.map((log, i) => {
          const meta = ACTION_META[log.action_type] || { label: log.action_type, color: C.textSecondary };
          const typeLabel = TYPE_LABEL[log.target_type] || log.target_type;
          const dt = new Date(log.created_at);
          return (
            <View key={log.id || i} style={[ms.logRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <View style={[ms.logDot, { backgroundColor: meta.color + "20" }]}>
                  <View style={[ms.logDotInner, { backgroundColor: meta.color }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: meta.color + "15" }}>
                      <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: meta.color }}>{typeLabel} {meta.label}</Text>
                    </View>
                    <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
                      {`${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`}
                    </Text>
                  </View>
                  {(log.before_value || log.after_value) && (
                    <View style={{ marginTop: 6, gap: 3 }}>
                      {log.before_value && <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C" }}>이전: {log.before_value}</Text>}
                      {log.after_value  && <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#2EC4B6" }}>변경: {log.after_value}</Text>}
                    </View>
                  )}
                  {log.note && (
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 4, fontStyle: "italic" }}>
                      메모: {log.note}
                    </Text>
                  )}
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 4 }}>
                    {log.actor_name} ({log.actor_role === "pool_admin" ? "관리자" : "선생님"})
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
