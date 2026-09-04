/**
 * Section C — 수영 교육 정보 (레벨)
 * SoT: students.current_level_order (WP-M2 current_level_name/color)
 * 레벨 변경: bottom sheet modal (기존 MemberLevelTab 로직 재사용)
 */
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import type { LevelDef } from "@/components/common/LevelBadge";
import { MemberSectionCard } from "./MemberSectionCard";
import type { DetailData, LevelInfo } from "./memberDetailTypes";

const C = Colors.light;

interface Props {
  data: DetailData;
  themeColor: string;
  levelInfo: LevelInfo | null;
  levelChanging: boolean;
  showLevelPicker: boolean;
  onOpenLevelPicker: () => void;
  onCloseLevelPicker: () => void;
  onLevelChange: (order: number) => void;
}

export function SectionC_Level({
  data, themeColor,
  levelInfo, levelChanging,
  showLevelPicker, onOpenLevelPicker, onCloseLevelPicker, onLevelChange,
}: Props) {
  // WP-M2 expanded fields
  const levelName  = (data as any).current_level_name  || levelInfo?.current_level?.level_name  || "미설정";
  const levelColor = (data as any).current_level_color || levelInfo?.current_level?.badge_color || themeColor;
  const levelOrder = (data as any).current_level_order ?? levelInfo?.current_level_order;

  const allLevels  = levelInfo?.all_levels || [];

  return (
    <>
      <MemberSectionCard
        title="수영 교육 정보"
        actionLabel="레벨 변경"
        actionIcon="layers"
        actionColor={themeColor}
        onAction={onOpenLevelPicker}
      >
        {levelChanging ? (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <ActivityIndicator color={themeColor} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {/* 현재 레벨 배지 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ backgroundColor: levelColor + "22", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 }}>
                <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: levelColor }}>
                  {levelName}
                </Text>
              </View>
              {levelOrder != null && (
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
                  레벨 {levelOrder}
                </Text>
              )}
            </View>

            {/* 레벨 설명 */}
            {levelInfo?.current_level?.level_description ? (
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 }}>
                {levelInfo.current_level.level_description}
              </Text>
            ) : null}

            {/* 학습 포인트 */}
            {levelInfo?.current_level?.learning_content ? (
              <View style={{ backgroundColor: themeColor + "10", borderRadius: 10, padding: 10 }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor, marginBottom: 4 }}>학습 포인트</Text>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 18 }}>
                  {levelInfo.current_level.learning_content}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </MemberSectionCard>

      {/* 레벨 선택 모달 */}
      {showLevelPicker && allLevels.length > 0 && (
        <View style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", zIndex: 999,
        }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "80%" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <Text style={{ fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text }}>레벨 선택</Text>
              <Pressable onPress={onCloseLevelPicker}>
                <LucideIcon name="x" size={22} color={C.textMuted} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ gap: 8, paddingBottom: 20 }}>
                {allLevels.filter((l: LevelDef) => l.is_active).map((l: LevelDef) => (
                  <Pressable
                    key={l.level_order}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 12,
                      padding: 14, borderRadius: 12,
                      backgroundColor: l.level_order === levelOrder ? themeColor + "15" : C.backgroundSoft,
                      borderWidth: l.level_order === levelOrder ? 1.5 : 0,
                      borderColor: themeColor,
                    }}
                    onPress={() => onLevelChange(l.level_order)}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: (l.badge_color || themeColor) + "30", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: l.badge_color || themeColor }}>{l.level_order}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text }}>{l.level_name}</Text>
                      {l.level_description ? (
                        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }} numberOfLines={1}>{l.level_description}</Text>
                      ) : null}
                    </View>
                    {l.level_order === levelOrder && (
                      <LucideIcon name="check-circle" size={16} color={themeColor} />
                    )}
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </>
  );
}
