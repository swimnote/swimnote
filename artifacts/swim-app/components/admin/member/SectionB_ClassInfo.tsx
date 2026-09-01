/**
 * Section B — 수강 정보 (반·선생님·요일·시간·주당횟수·시작일·상태)
 * 반 변경 → ClassPickerModal (onOpenPicker)
 * 주당횟수 → inline 1/2/3 버튼
 */
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { WEEKLY_BADGE, type WeeklyCount } from "@/utils/studentUtils";
import { MemberSectionCard } from "./MemberSectionCard";
import { ms } from "./memberDetailStyles";
import type { ClassGroup, DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface Props {
  data: DetailData;
  themeColor: string;
  saving: boolean;
  groups: ClassGroup[];
  weeklyCount: WeeklyCount;
  setWeeklyCount: (v: WeeklyCount) => void;
  assignedIds: string[];
  setAssignedIds: (ids: string[] | ((p: string[]) => string[])) => void;
  assignedClasses: ClassGroup[];
  classChanged: boolean;
  setClassChanged: (v: boolean) => void;
  onSaveAssignment: () => void;
  onOpenPicker: () => void;
}

export function SectionB_ClassInfo({
  data, themeColor, saving,
  weeklyCount, setWeeklyCount, assignedIds, setAssignedIds,
  assignedClasses, classChanged, setClassChanged,
  onSaveAssignment, onOpenPicker,
}: Props) {
  return (
    <MemberSectionCard title="수강 정보">
      {/* 주당 횟수 */}
      <View>
        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 8 }}>주 수업 횟수</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {([1, 2, 3] as WeeklyCount[]).map(w => {
            const b = WEEKLY_BADGE[w];
            const active = weeklyCount === w;
            return (
              <Pressable
                key={w}
                style={[ms.weekBtn, {
                  backgroundColor: active ? b.bg : C.background,
                  borderColor: active ? b.color : C.border,
                }]}
                onPress={() => { setWeeklyCount(w); setClassChanged(true); }}
              >
                <Text style={[ms.weekBtnText, { color: active ? b.color : C.textSecondary }]}>{b.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 배정된 반 목록 */}
      <View>
        <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 8 }}>
          배정된 반 ({assignedIds.length}/{weeklyCount})
        </Text>
        {assignedClasses.length === 0 ? (
          <View style={ms.warnBox}>
            <LucideIcon name="alert-circle" size={14} color="#D96C6C" />
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C" }}>배정된 반이 없습니다</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {assignedClasses.map(g => {
              const days = g.schedule_days.split(",").map((d: string) => d.trim()).join("·");
              return (
                <View key={g.id} style={[ms.classChip, { borderColor: themeColor + "40", backgroundColor: themeColor + "0D" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[ms.className, { color: C.text }]}>{g.name}</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor, marginTop: 2 }}>
                      {days}요일 · {g.schedule_time}
                    </Text>
                    {g.instructor && (
                      <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 }}>
                        선생님: {g.instructor}
                      </Text>
                    )}
                  </View>
                  <Pressable onPress={() => { setAssignedIds(p => p.filter(x => x !== g.id)); setClassChanged(true); }}>
                    <LucideIcon name="x-circle" size={18} color={C.error} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* 반 선택 + 저장 */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          style={[ms.outlineBtn, { borderColor: themeColor, flex: 1 }]}
          onPress={onOpenPicker}
        >
          <LucideIcon name="plus-circle" size={15} color={themeColor} />
          <Text style={[ms.outlineBtnText, { color: themeColor }]}>반 선택하기</Text>
        </Pressable>
        {classChanged && (
          <Pressable
            style={[ms.outlineBtn, { borderColor: "#16A34A", backgroundColor: "#F0FDF4" }]}
            onPress={onSaveAssignment}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#16A34A" />
              : <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A" }}>저장</Text>
            }
          </Pressable>
        )}
      </View>

      {/* 수강 시작일 + 회원 상태 */}
      {data.class_enrolled_at && (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingTop: 4 }}>
          <LucideIcon name="calendar" size={12} color={C.textMuted} />
          <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>
            수강 시작일: {new Date(data.class_enrolled_at).toLocaleDateString("ko-KR")}
          </Text>
        </View>
      )}
    </MemberSectionCard>
  );
}
