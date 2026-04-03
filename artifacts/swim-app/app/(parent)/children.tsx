/**
 * 학부모 자녀 연결 화면
 * - 요청 폼 / 요청 내역 없음 (완전 제거)
 * - 화면 진입 즉시 전화번호 기반 강제 자동연결 실행
 * - 연결된 자녀 목록만 표시
 */
import { ChevronRight, Info, Phone, RefreshCw, UserX } from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const CHILD_COLORS = [C.tint, "#7C3AED", "#D97706", "#0EA5E9", "#16A34A"];

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
function parseScheduleText(days: string, time: string): string {
  let parts: string[] = [];
  if (days.includes(",")) parts = days.split(",").map(d => d.trim()).filter(Boolean);
  else parts = days.split("").filter(d => DAY_ORDER.includes(d));
  parts.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return parts.map(d => `${d} ${time}`).join("  ");
}

export default function ChildrenScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { students, refresh } = useParent();
  const [refreshing, setRefreshing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkedCount, setLinkedCount] = useState<number | null>(null);

  // 자동 연결 강제 실행
  async function runAutoLink() {
    setLinking(true);
    try {
      const res = await apiRequest(token, "/parent/auto-link-students", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setLinkedCount(data.linked ?? 0);
      }
    } catch {}
    await refresh();
    setLinking(false);
  }

  // 화면 포커스될 때마다 자동연결 실행
  useFocusEffect(useCallback(() => {
    runAutoLink();
  }, []));

  async function onRefresh() {
    setRefreshing(true);
    await runAutoLink();
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
        {/* 연결 중 인디케이터 */}
        {linking && (
          <View style={[s.linkingBanner, { backgroundColor: C.tint + "18" }]}>
            <ActivityIndicator size="small" color={C.tint} />
            <Text style={[s.linkingTxt, { color: C.tint }]}>전화번호로 자녀 연결 중...</Text>
          </View>
        )}

        {/* 새로 연결된 경우 안내 */}
        {!linking && linkedCount !== null && linkedCount > 0 && (
          <View style={[s.successBanner, { backgroundColor: "#DCFCE7" }]}>
            <Text style={[s.successTxt, { color: "#15803D" }]}>
              ✓ 자녀 {linkedCount}명이 자동으로 연결되었습니다
            </Text>
          </View>
        )}

        {/* 연결된 자녀 목록 */}
        <Text style={[s.sectionTitle, { color: C.text }]}>연결된 자녀</Text>

        {students.length === 0 ? (
          <View style={[s.emptyBox, { backgroundColor: C.card }]}>
            <UserX size={40} color={C.textMuted} />
            <Text style={[s.emptyTitle, { color: C.text }]}>연결된 자녀가 없습니다</Text>
            <Text style={[s.emptyDesc, { color: C.textSecondary }]}>
              가입 시 입력한 전화번호로{"\n"}자동 연결됩니다
            </Text>
            <Pressable
              style={[s.retryBtn, { backgroundColor: C.tint }]}
              onPress={onRefresh}
              disabled={linking}
            >
              {linking
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <RefreshCw size={15} color="#fff" />
                    <Text style={s.retryTxt}>다시 시도</Text>
                  </>
              }
            </Pressable>
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

        {/* 연결 안내 */}
        <View style={[s.infoCard, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", borderWidth: 1 }]}>
          <Info size={16} color="#16A34A" style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[s.infoTitle, { color: "#15803D" }]}>자동 연결 방식</Text>
            <Text style={[s.infoDesc, { color: "#166534" }]}>
              가입 시 입력한 전화번호가 수영장에 등록된 학생 정보와 일치하면 자동으로 연결됩니다.
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
              <Phone size={13} color="#16A34A" />
              <Text style={[s.infoDesc, { color: "#15803D" }]}>
                연결이 안 된다면 수영장에 전화번호 등록을 요청하세요
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  sectionTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold" },

  linkingBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, padding: 12,
  },
  linkingTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  successBanner: {
    borderRadius: 12, padding: 12,
  },
  successTxt: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  emptyBox: {
    borderRadius: 20, padding: 32, alignItems: "center", gap: 10,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", marginTop: 4 },
  emptyDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 11,
    borderRadius: 12,
  },
  retryTxt: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  childCard: {
    borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  childAvatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  childAvatarTxt: { fontSize: 20, fontFamily: "Pretendard-SemiBold" },
  childName: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  childClass: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  infoCard: { borderRadius: 16, padding: 14, flexDirection: "row", gap: 10, marginTop: 4 },
  infoTitle: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  infoDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 19 },
});
