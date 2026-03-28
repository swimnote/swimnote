import React from "react";
import { Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

const COLORS: Record<string, string> = {
  present: "#2EC4B6", absent: "#D96C6C", late: "#D97706", excused: "#7C3AED",
};
const LABELS: Record<string, string> = {
  present: "출", absent: "결", late: "지", excused: "공",
};

interface AttendanceMiniProps {
  records: { date: string; status: string }[];
}

export function AttendanceMini({ records }: AttendanceMiniProps) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {records.slice(0, 30).map((r, i) => {
        const c = COLORS[r.status] || "#D1D5DB";
        const l = LABELS[r.status] || "?";
        const dt = new Date(r.date);
        return (
          <View key={i} style={{ alignItems: "center", gap: 2 }}>
            <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: c + "20", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: c }}>{l}</Text>
            </View>
            <Text style={{ fontSize: 9, fontFamily: "Pretendard-Regular", color: C.textMuted }}>{dt.getMonth() + 1}/{dt.getDate()}</Text>
          </View>
        );
      })}
      {records.length === 0 && (
        <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>출결 기록이 없습니다</Text>
      )}
    </View>
  );
}
