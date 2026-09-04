/**
 * Section D — 출결 / 보강 요약 (WP-M2 contract)
 * attendance_summary + makeup_summary 표시
 * [출결 상세보기] → attendance screen
 * [보강 상세보기] → makeups screen
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { MemberSectionCard } from "./MemberSectionCard";
import type { DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface Props {
  data: DetailData;
  themeColor: string;
  onGoAttendance: () => void;
  onGoMakeups: () => void;
}

export function SectionD_Summary({ data, themeColor, onGoAttendance, onGoMakeups }: Props) {
  const att = (data as any).attendance_summary as {
    present: number; absent: number; late: number;
  } | undefined;

  const mkp = (data as any).makeup_summary as {
    waiting: number; expired: number; assigned: number; completed: number;
  } | undefined;

  return (
    <MemberSectionCard title="출결 / 보강">
      {/* 출결 요약 */}
      <View>
        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 8 }}>
          이번 달 출결
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
          {[
            { label: "출석", value: att?.present ?? 0, color: C.present ?? "#22C55E" },
            { label: "결석", value: att?.absent ?? 0, color: "#D96C6C" },
            { label: "지각", value: att?.late ?? 0, color: "#D97706" },
          ].map(({ label, value, color }) => (
            <View key={label} style={{
              flex: 1, alignItems: "center", backgroundColor: color + "15",
              borderRadius: 10, paddingVertical: 10,
            }}>
              <Text style={{ fontSize: 20, fontFamily: "Pretendard-Regular", color }}>{value}</Text>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>{label}</Text>
            </View>
          ))}
        </View>
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border }}
          onPress={onGoAttendance}
        >
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>출결 상세보기</Text>
          <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
        </Pressable>
      </View>

      {/* 보강 요약 */}
      <View>
        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 8 }}>
          보강 현황
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
          {[
            { label: "대기", value: (mkp?.waiting ?? 0) + (mkp?.expired ?? 0), color: "#D97706" },
            { label: "배정", value: mkp?.assigned ?? 0, color: themeColor },
            { label: "완료", value: mkp?.completed ?? 0, color: "#16A34A" },
          ].map(({ label, value, color }) => (
            <View key={label} style={{
              flex: 1, alignItems: "center", backgroundColor: color + "15",
              borderRadius: 10, paddingVertical: 10,
            }}>
              <Text style={{ fontSize: 20, fontFamily: "Pretendard-Regular", color }}>{value}</Text>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>{label}</Text>
            </View>
          ))}
        </View>
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border }}
          onPress={onGoMakeups}
        >
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>보강 상세보기</Text>
          <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
        </Pressable>
      </View>
    </MemberSectionCard>
  );
}
