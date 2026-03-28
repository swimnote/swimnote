import { EyeOff, PenLine, Save } from "lucide-react-native";
import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LevelBadge } from "@/components/common/LevelBadge";
import { EditField } from "./EditField";
import { ms } from "./memberDetailStyles";
import type { LevelInfo } from "./memberDetailTypes";

const C = Colors.light;

interface MemberLevelTabProps {
  themeColor: string;
  saving: boolean;
  levelInfo: LevelInfo | null;
  levelChanging: boolean;
  showLevelPicker: boolean;
  onLevelChange: (order: number) => void;
  onOpenLevelPicker: () => void;
  onCloseLevelPicker: () => void;
  editNotes: string;
  setEditNotes: (v: string) => void;
  infoChanged: boolean;
  setInfoChanged: (v: boolean) => void;
  onSave: () => void;
}

export function MemberLevelTab({
  themeColor, saving, levelInfo, levelChanging,
  showLevelPicker, onLevelChange, onOpenLevelPicker, onCloseLevelPicker,
  editNotes, setEditNotes, infoChanged, setInfoChanged, onSave,
}: MemberLevelTabProps) {
  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      <View style={ms.section}>
        <Text style={ms.sectionTitle}>현재 레벨</Text>
        <View style={[ms.infoCard, { backgroundColor: C.card }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, padding: 16 }}>
            {levelChanging
              ? <ActivityIndicator size="large" color={themeColor} />
              : <LevelBadge level={levelInfo?.current_level ?? null} size="lg" />
            }
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>현재 레벨</Text>
              <Text style={{ fontSize: 22, fontFamily: "Pretendard-SemiBold", color: C.text, marginTop: 2 }}>
                {levelInfo?.current_level?.level_name ?? "미지정"}
              </Text>
              {levelInfo?.current_level?.is_active === false && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, backgroundColor: "#FFF7ED", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" }}>
                  <EyeOff size={12} color="#D97706" />
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Medium", color: "#D97706" }}>사용 안 함 레벨</Text>
                </View>
              )}
              {levelInfo?.current_level?.level_description && levelInfo.current_level.is_active !== false ? (
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 4 }}>
                  {levelInfo.current_level.level_description}
                </Text>
              ) : null}
            </View>
            <Pressable
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: themeColor, flexDirection: "row", alignItems: "center", gap: 5 }}
              onPress={onOpenLevelPicker}
            >
              <PenLine size={13} color={themeColor} />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Medium", color: themeColor }}>변경</Text>
            </Pressable>
          </View>

          {levelInfo?.current_level?.learning_content ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
              <View style={{ height: 1, backgroundColor: C.border, marginBottom: 12 }} />
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Medium", color: C.textSecondary, marginBottom: 6 }}>이 레벨에서 배우는 내용</Text>
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 22 }}>
                {levelInfo.current_level.learning_content}
              </Text>
            </View>
          ) : null}

          {levelInfo?.current_level?.promotion_test_rule ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
              {!levelInfo?.current_level?.learning_content && <View style={{ height: 1, backgroundColor: C.border, marginBottom: 12 }} />}
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-Medium", color: C.textSecondary, marginBottom: 6 }}>승급 기준</Text>
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 22 }}>
                {levelInfo.current_level.promotion_test_rule}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {levelInfo?.all_levels && levelInfo.all_levels.length > 0 && (
        <View style={ms.section}>
          <Text style={ms.sectionTitle}>전체 레벨 구조</Text>
          <View style={[ms.infoCard, { backgroundColor: C.card, padding: 12 }]}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {levelInfo.all_levels.filter(lv => lv.is_active !== false).map(lv => {
                const isCurrent = lv.level_order === levelInfo.current_level_order;
                return (
                  <Pressable
                    key={lv.level_order}
                    style={{
                      alignItems: "center", gap: 4, padding: 8, borderRadius: 10, borderWidth: 1.5,
                      borderColor: isCurrent ? themeColor : C.border,
                      backgroundColor: isCurrent ? themeColor + "10" : C.background,
                    }}
                    onPress={() => onLevelChange(lv.level_order)}
                  >
                    <LevelBadge level={lv} size="sm" />
                    <Text style={{ fontSize: 11, fontFamily: isCurrent ? "Pretendard-SemiBold" : "Pretendard-Regular", color: isCurrent ? themeColor : C.textSecondary }}>
                      {lv.level_name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      )}

      <View style={ms.section}>
        <Text style={ms.sectionTitle}>특이사항 / 관리자 메모</Text>
        <View style={[ms.infoCard, { backgroundColor: C.card, padding: 14, gap: 10 }]}>
          <EditField
            label=""
            value={editNotes}
            onChangeText={v => { setEditNotes(v); setInfoChanged(true); }}
            placeholder="내부 메모 (학부모에게 노출되지 않음)"
            multiline
          />
          <Pressable
            style={[ms.saveBtn, { backgroundColor: infoChanged ? themeColor : "#64748B" }]}
            onPress={onSave}
            disabled={saving || !infoChanged}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" /> : (
              <><Save size={16} color="#fff" /><Text style={ms.saveBtnText}>메모 저장</Text></>
            )}
          </Pressable>
        </View>
      </View>

      <Modal visible={showLevelPicker} transparent animationType="slide" onRequestClose={onCloseLevelPicker}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 }}
          onPress={onCloseLevelPicker}
        >
          <View
            style={{ backgroundColor: C.card, borderRadius: 20, padding: 24, width: "100%", maxHeight: 480, gap: 16 }}
            onStartShouldSetResponder={() => true}
          >
            <Text style={{ fontSize: 17, fontFamily: "Pretendard-SemiBold", color: C.text, textAlign: "center" }}>레벨 선택</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {(levelInfo?.all_levels ?? []).filter(lv => lv.is_active !== false).map(lv => {
                  const isCurrent = lv.level_order === levelInfo?.current_level_order;
                  return (
                    <Pressable
                      key={lv.level_order}
                      style={{
                        alignItems: "center", gap: 6, padding: 10, borderRadius: 12, borderWidth: 1.5,
                        borderColor: isCurrent ? themeColor : C.border,
                        backgroundColor: isCurrent ? themeColor + "10" : C.background,
                      }}
                      onPress={() => onLevelChange(lv.level_order)}
                    >
                      <LevelBadge level={lv} size="md" />
                      <Text style={{ fontSize: 12, fontFamily: isCurrent ? "Pretendard-SemiBold" : "Pretendard-Medium", color: isCurrent ? themeColor : C.text }}>
                        {lv.level_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <Pressable
              style={{ alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: C.border }}
              onPress={onCloseLevelPicker}
            >
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Medium", color: C.textSecondary }}>취소</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
