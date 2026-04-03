/**
 * 학부모 자녀 연결 화면
 * - 연결된 자녀 목록 (클릭 → 자녀 프로필)
 * - 자동 연결 안내 (전화번호 기반, 수동 신청 없음)
 */
import { ChevronRight, Info, UserX } from "lucide-react-native";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  RefreshControl, ScrollView, StyleSheet, Text, View, Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const CHILD_COLORS = [C.tint, "#2EC4B6", "#7C3AED", "#D97706", "#0EA5E9"];

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
function parseScheduleText(days: string, time: string): string {
  let parts: string[] = [];
  if (days.includes(",")) parts = days.split(",").map(d => d.trim()).filter(Boolean);
  else parts = days.split("").filter(d => DAY_ORDER.includes(d));
  parts.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return parts.map(d => `${d} ${time}`).join("  ");
}

export default function ChildrenScreen() {
  const insets = useSafeAreaInsets();
  const { students, refresh } = useParent();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="자녀 연결" />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 14, paddingTop: 8 }}
      >
        {/* 연결된 자녀 */}
        <Text style={[s.sectionTitle, { color: C.text }]}>연결된 자녀</Text>

        {students.length === 0 ? (
          <View style={[s.emptyBox, { backgroundColor: C.card }]}>
            <UserX size={36} color={C.textMuted} />
            <Text style={[s.emptyTxt, { color: C.textSecondary }]}>아직 연결된 자녀가 없습니다</Text>
          </View>
        ) : (
          students.map((st, i) => {
            const color = CHILD_COLORS[i % CHILD_COLORS.length];
            return (
              <Pressable
                key={st.id}
                style={({ pressed }) => [s.childCard, { backgroundColor: C.card, opacity: pressed ? 0.9 : 1 }]}
                onPress={() => router.push({ pathname: "/(parent)/child-profile" as any, params: { id: st.id, backTo: "children" } })}
              >
                <View style={[s.childAvatar, { backgroundColor: color + "22" }]}>
                  <Text style={[s.childAvatarTxt, { color }]}>{st.name[0]}</Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[s.childName, { color: C.text }]}>{st.name}</Text>
                  {st.class_group?.name
                    ? <Text style={[s.childClass, { color: C.textSecondary }]}>
                        {st.class_group.name}
                        {st.class_group.schedule_days && st.class_group.schedule_time
                          ? ` · ${parseScheduleText(st.class_group.schedule_days, st.class_group.schedule_time)}`
                          : ""}
                      </Text>
                    : <Text style={[s.childClass, { color: C.textMuted }]}>반 배정 전</Text>
                  }
                </View>
                <ChevronRight size={18} color={C.textMuted} />
              </Pressable>
            );
          })
        )}

        {/* 자동 연결 안내 */}
        <View style={[s.infoCard, { backgroundColor: C.tintLight ?? "#EFF6FF" }]}>
          <Info size={18} color={C.tint} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[s.infoTitle, { color: C.tint }]}>자동 연결 안내</Text>
            <Text style={[s.infoDesc, { color: C.textSecondary }]}>
              수영장 관리자가 등록한 학생 정보의 학부모 전화번호와 가입 시 입력한 전화번호가 일치하면 자동으로 연결됩니다.{"\n\n"}연결이 되지 않는다면 수영장에 전화번호 등록을 요청해 주세요.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  sectionTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", marginTop: 4 },

  emptyBox: { borderRadius: 16, padding: 28, alignItems: "center", gap: 8 },
  emptyTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  childCard: {
    borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  childAvatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  childAvatarTxt: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  childName: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  childClass: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  infoCard: { borderRadius: 16, padding: 16, flexDirection: "row", gap: 10, marginTop: 4 },
  infoTitle: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  infoDesc: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
});
