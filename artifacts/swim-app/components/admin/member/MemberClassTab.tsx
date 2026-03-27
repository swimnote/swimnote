import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { WEEKLY_BADGE, type WeeklyCount } from "@/utils/studentUtils";
import { AttendanceMini } from "./AttendanceMini";
import { ms } from "./memberDetailStyles";
import type { ClassGroup, DetailData } from "./memberDetailTypes";

const C = Colors.light;

interface MemberClassTabProps {
  data: DetailData;
  themeColor: string;
  saving: boolean;
  groups: ClassGroup[];
  weeklyCount: WeeklyCount;
  setWeeklyCount: (v: WeeklyCount) => void;
  assignedIds: string[];
  setAssignedIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  assignedClasses: ClassGroup[];
  classChanged: boolean;
  setClassChanged: (v: boolean) => void;
  onSaveAssignment: () => void;
  onOpenPicker: () => void;
}

export function MemberClassTab({
  data, themeColor, saving, groups,
  weeklyCount, setWeeklyCount, assignedIds, setAssignedIds,
  assignedClasses, classChanged, setClassChanged,
  onSaveAssignment, onOpenPicker,
}: MemberClassTabProps) {
  return (
    <ScrollView contentContainerStyle={ms.tabContent} showsVerticalScrollIndicator={false}>
      <View style={ms.section}>
        <View style={ms.sectionHeader}>
          <Text style={ms.sectionTitle}>반 배정</Text>
          {classChanged && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#FFF1BF" }}>
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Medium", color: "#92400E" }}>변경됨</Text>
            </View>
          )}
        </View>

        <Text style={ms.fieldLabel}>주 수업 횟수</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          {([1, 2, 3] as WeeklyCount[]).map(w => {
            const b = WEEKLY_BADGE[w];
            const active = weeklyCount === w;
            return (
              <Pressable
                key={w}
                style={[ms.weekBtn, { backgroundColor: active ? b.bg : C.background, borderColor: active ? b.color : C.border }]}
                onPress={() => { setWeeklyCount(w); setClassChanged(true); }}
              >
                <Text style={[ms.weekBtnText, { color: active ? b.color : C.textSecondary }]}>{b.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={ms.fieldLabel}>배정된 반 ({assignedIds.length}/{weeklyCount})</Text>
        {assignedClasses.length === 0 ? (
          <View style={ms.warnBox}>
            <Feather name="alert-circle" size={14} color="#D96C6C" />
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#D96C6C" }}>아직 배정된 반이 없습니다</Text>
          </View>
        ) : (
          <View style={{ gap: 8, marginBottom: 8 }}>
            {assignedClasses.map(g => {
              const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
              return (
                <View key={g.id} style={[ms.classChip, { borderColor: themeColor + "40", backgroundColor: themeColor + "0D" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[ms.className, { color: C.text }]}>{g.name}</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor, marginTop: 2 }}>{days}요일 · {g.schedule_time}</Text>
                    {g.instructor && <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 }}>선생님: {g.instructor}</Text>}
                  </View>
                  <Pressable onPress={() => { setAssignedIds(p => p.filter(x => x !== g.id)); setClassChanged(true); }}>
                    <Feather name="x-circle" size={18} color={C.error} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        <Pressable style={[ms.outlineBtn, { borderColor: themeColor }]} onPress={onOpenPicker}>
          <Feather name="plus-circle" size={15} color={themeColor} />
          <Text style={[ms.outlineBtnText, { color: themeColor }]}>반 선택하기</Text>
        </Pressable>

        <Pressable
          style={[ms.saveBtn, { backgroundColor: classChanged ? themeColor : "#9CA3AF", marginTop: 12 }]}
          onPress={onSaveAssignment}
          disabled={saving || !classChanged}
        >
          {saving ? <ActivityIndicator color="#fff" size="small" /> : (
            <><Feather name="save" size={16} color="#fff" /><Text style={ms.saveBtnText}>배정 저장</Text></>
          )}
        </Pressable>
      </View>

      <View style={ms.section}>
        <Text style={ms.sectionTitle}>최근 출결 현황</Text>
        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          {[
            { label: "출석", color: "#2EC4B6", key: "present" },
            { label: "결석", color: "#D96C6C", key: "absent" },
            { label: "지각", color: "#D97706", key: "late" },
            { label: "공결", color: "#7C3AED", key: "excused" },
          ].map(({ label, color, key }) => {
            const cnt = (data.recent_attendance || []).filter(r => r.status === key).length;
            return (
              <View key={key} style={{ alignItems: "center", flex: 1, backgroundColor: color + "15", borderRadius: 10, paddingVertical: 10 }}>
                <Text style={{ fontSize: 18, fontFamily: "Pretendard-Bold", color }}>{cnt}</Text>
                <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 }}>{label}</Text>
              </View>
            );
          })}
        </View>
        <AttendanceMini records={data.recent_attendance || []} />
      </View>

      <View style={ms.section}>
        <Text style={ms.sectionTitle}>최근 수업 일지</Text>
        {(data.recent_diaries || []).length === 0 ? (
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>등록된 일지가 없습니다</Text>
        ) : (
          <View style={{ gap: 10 }}>
            {(data.recent_diaries || []).map(d => (
              <View key={d.id} style={{ backgroundColor: "#F1F5F9", borderRadius: 12, padding: 12, gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text }}>{d.lesson_date}</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted }}>{d.teacher_name}</Text>
                </View>
                {d.common_content && (
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 }} numberOfLines={2}>
                    {d.common_content}
                  </Text>
                )}
                {d.student_note && (
                  <View style={{ backgroundColor: themeColor + "15", padding: 8, borderRadius: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: themeColor }}>📝 {d.student_note}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
