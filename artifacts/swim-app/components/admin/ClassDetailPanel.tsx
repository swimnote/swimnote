/**
 * ClassDetailPanel — 공통 반 현황판 컴포넌트
 * 관리자 수업탭 / 선생님관리 일간 / 월간 세 흐름에서 재사용
 */
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export interface ClassDetail {
  class_group: {
    id: string; name: string; schedule_days: string; schedule_time: string;
    capacity: number | null; teacher_id: string | null; teacher_name: string | null;
  };
  students: Array<{ id: string; name: string; status: string; has_makeup: boolean }>;
  attendance: Array<{ student_id: string; student_name: string; status: string; has_makeup: boolean }>;
  diary: { id: string; common_content: string; teacher_name: string; created_at: string; is_edited: boolean } | null;
}

type DashTab = "students" | "attendance" | "diary" | "absent";

interface Props {
  detail: ClassDetail | null;
  loading: boolean;
  date: string;
  onBack: () => void;
  bottomInset?: number;
}

export default function ClassDetailPanel({ detail, loading, date, onBack, bottomInset = 120 }: Props) {
  const [tab, setTab] = useState<DashTab>("students");
  const cg = detail?.class_group;
  const students = detail?.students ?? [];
  const attendance = detail?.attendance ?? [];
  const diary = detail?.diary;
  const present = attendance.filter(a => a.status === "present").length;
  const absent = attendance.filter(a => a.status === "absent").length;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 뒤로가기 */}
      <Pressable onPress={onBack} style={[p.backRow, { borderBottomColor: C.border }]}>
        <Feather name="chevron-left" size={20} color={C.tint} />
        <Text style={[p.backText, { color: C.tint }]}>반 목록으로</Text>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: bottomInset }} showsVerticalScrollIndicator={false}>
          {/* 반 요약 카드 */}
          <View style={[p.summaryCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={[p.className, { color: C.text }]}>{cg?.name ?? "—"}</Text>
                <Text style={[p.subInfo, { color: C.textSecondary }]}>
                  {cg?.teacher_name ?? "선생님 미지정"} · {cg?.schedule_time}
                </Text>
                <Text style={[p.subInfo, { color: C.textMuted }]}>{cg?.schedule_days}</Text>
              </View>
              <View style={[p.badge, { backgroundColor: diary ? "#E6FFFA" : "#FFF1BF" }]}>
                <Text style={[p.badgeText, { color: diary ? "#2EC4B6" : "#D97706" }]}>
                  {diary ? "일지 완료" : "일지 미작성"}
                </Text>
              </View>
            </View>
            <View style={[p.statRow, { borderTopColor: C.border }]}>
              {[
                { val: students.length, label: "총 학생", color: C.text },
                { val: present, label: "출석", color: "#2EC4B6" },
                { val: absent, label: "결석", color: "#D96C6C" },
                { val: students.filter(s => s.has_makeup).length, label: "보강", color: C.tint },
              ].map((st, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <View style={[p.divider, { backgroundColor: C.border }]} />}
                  <View style={p.statItem}>
                    <Text style={[p.statVal, { color: st.color }]}>{st.val}</Text>
                    <Text style={[p.statLabel, { color: C.textMuted }]}>{st.label}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </View>

          {/* 내부 탭 */}
          <View style={[p.tabBar, { borderBottomColor: C.border }]}>
            {(["students", "attendance", "diary", "absent"] as DashTab[]).map((key, i) => {
              const labels = ["학생", "출결", "일지", "결석"];
              return (
                <Pressable key={key} style={[p.tabItem, tab === key && { borderBottomColor: C.tint, borderBottomWidth: 2.5 }]} onPress={() => setTab(key)}>
                  <Text style={[p.tabLabel, { color: tab === key ? C.tint : C.textSecondary }]}>{labels[i]}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
            {/* 학생 탭 */}
            {tab === "students" && (
              students.length === 0
                ? <Text style={[p.empty, { color: C.textMuted }]}>등록된 학생이 없습니다</Text>
                : students.map(s => (
                  <View key={s.id} style={[p.listRow, { backgroundColor: C.card }]}>
                    <View style={[p.avatar, { backgroundColor: C.tintLight }]}>
                      <Feather name="user" size={15} color={C.tint} />
                    </View>
                    <Text style={[p.listName, { color: C.text }]}>{s.name}</Text>
                    {s.has_makeup && <StatusBadge label="보강" bg="#EEDDF5" color="#7C3AED" />}
                    <StatusBadge
                      label={s.status === "active" ? "정상" : s.status}
                      bg={s.status === "active" ? "#E6FFFA" : "#FFF1BF"}
                      color={s.status === "active" ? "#2EC4B6" : "#D97706"}
                    />
                  </View>
                ))
            )}

            {/* 출결 탭 */}
            {tab === "attendance" && (
              attendance.length === 0
                ? <Text style={[p.empty, { color: C.textMuted }]}>출결 기록이 없습니다</Text>
                : attendance.map(a => (
                  <View key={a.student_id} style={[p.listRow, { backgroundColor: C.card }]}>
                    <View style={[p.avatar, { backgroundColor: a.status === "present" ? "#E6FFFA" : "#F9DEDA" }]}>
                      <Feather name={a.status === "present" ? "check" : "x"} size={13} color={a.status === "present" ? "#2EC4B6" : "#D96C6C"} />
                    </View>
                    <Text style={[p.listName, { color: C.text }]}>{a.student_name}</Text>
                    {a.has_makeup && <StatusBadge label="보강" bg="#EEDDF5" color="#7C3AED" />}
                    <StatusBadge
                      label={a.status === "present" ? "출석" : a.status === "absent" ? "결석" : a.status}
                      bg={a.status === "present" ? "#E6FFFA" : a.status === "absent" ? "#F9DEDA" : "#F8FAFC"}
                      color={a.status === "present" ? "#2EC4B6" : a.status === "absent" ? "#D96C6C" : C.textSecondary}
                    />
                  </View>
                ))
            )}

            {/* 일지 탭 */}
            {tab === "diary" && (
              diary ? (
                <View style={[p.diaryCard, { backgroundColor: C.card, borderLeftColor: C.tint }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={[p.diaryTeacher, { color: C.tint }]}>{diary.teacher_name}</Text>
                    <Text style={[p.diaryTime, { color: C.textMuted }]}>
                      {new Date(diary.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Text style={[p.diaryContent, { color: C.text }]}>{diary.common_content || "(내용 없음)"}</Text>
                  {diary.is_edited && <Text style={[p.diaryTime, { color: C.textMuted, marginTop: 6 }]}>수정됨</Text>}
                </View>
              ) : (
                <View style={[p.diaryEmpty, { borderColor: C.border }]}>
                  <Feather name="edit-3" size={32} color={C.textMuted} />
                  <Text style={[p.empty, { color: C.textMuted }]}>아직 일지가 작성되지 않았습니다</Text>
                  <Text style={[{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" }]}>{date} 기준</Text>
                </View>
              )
            )}

            {/* 결석 탭 */}
            {tab === "absent" && (() => {
              const absentList = attendance.filter(a => a.status === "absent");
              return absentList.length === 0
                ? <Text style={[p.empty, { color: C.textMuted }]}>결석자가 없습니다</Text>
                : absentList.map(a => (
                  <View key={a.student_id} style={[p.listRow, { backgroundColor: C.card }]}>
                    <View style={[p.avatar, { backgroundColor: "#F9DEDA" }]}>
                      <Feather name="x" size={13} color="#D96C6C" />
                    </View>
                    <Text style={[p.listName, { color: C.text }]}>{a.student_name}</Text>
                    {a.has_makeup && <StatusBadge label="보강" bg="#EEDDF5" color="#7C3AED" />}
                    <StatusBadge label="결석" bg="#F9DEDA" color="#D96C6C" />
                  </View>
                ));
            })()}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function StatusBadge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <View style={[p.statusPill, { backgroundColor: bg }]}>
      <Text style={[p.statusText, { color }]}>{label}</Text>
    </View>
  );
}

const p = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  summaryCard: { margin: 20, borderRadius: 16, padding: 16, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  className: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subInfo: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statRow: { flexDirection: "row", borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  statItem: { flex: 1, alignItems: "center", gap: 3 },
  statVal: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  divider: { width: 1, marginVertical: 4 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  tabLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  listName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  diaryCard: { borderRadius: 12, padding: 16, borderLeftWidth: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  diaryTeacher: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  diaryTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  diaryContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  diaryEmpty: { borderWidth: 1.5, borderStyle: "dashed", borderRadius: 16, padding: 40, alignItems: "center", gap: 10 },
  empty: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 20 },
  shadow: {},
});
