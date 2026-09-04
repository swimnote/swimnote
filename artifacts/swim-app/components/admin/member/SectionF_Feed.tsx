/**
 * Section F — 피드 / 일지 / 사진 shortcut
 * 최근 일지 preview + [일지 보기] [출결/사진 보기] 버튼
 * 전체 데이터 로딩 금지 (WP-M3 제약)
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
  onGoDiary: () => void;
  onGoAttendance: () => void;
}

export function SectionF_Feed({ data, themeColor, onGoDiary, onGoAttendance }: Props) {
  const recentDiaries = data.recent_diaries || [];

  return (
    <MemberSectionCard title="일지 / 출결 기록">
      {/* 최근 일지 미리보기 */}
      {recentDiaries.length > 0 ? (
        <View style={{ gap: 8 }}>
          {recentDiaries.slice(0, 2).map(d => (
            <View key={d.id} style={{ backgroundColor: C.backgroundSoft, borderRadius: 10, padding: 10, gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor }}>{d.lesson_date}</Text>
                <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted }}>{d.teacher_name}</Text>
              </View>
              {d.common_content ? (
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 17 }} numberOfLines={2}>
                  {d.common_content}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>등록된 일지가 없습니다</Text>
      )}

      {/* 바로가기 버튼 */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        <Pressable
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: themeColor + "60", backgroundColor: themeColor + "0A" }}
          onPress={onGoDiary}
        >
          <LucideIcon name="book-open" size={14} color={themeColor} />
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: themeColor }}>일지 보기</Text>
        </Pressable>
        <Pressable
          style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.backgroundSoft }}
          onPress={onGoAttendance}
        >
          <LucideIcon name="calendar-check" size={14} color={C.textSecondary} />
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>출결 보기</Text>
        </Pressable>
      </View>
    </MemberSectionCard>
  );
}
