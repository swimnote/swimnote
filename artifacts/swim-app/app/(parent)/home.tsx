/**
 * 학부모 홈 — 스타벅스식 콘텐츠 중심 UX
 *
 * 구조:
 *   A. 상단 헤더 (수영장명 · 알림 · 설정)
 *   B. 자녀 탭 (2명+)
 *   C. 자녀 히어로 카드
 *   D. 빠른 바로가기 그리드 (상태 배지 포함)
 *   E. 오늘 확인할 것 카드
 *   F. 최근 수업일지 카드
 *   G. 최근 사진 카드
 *   H. 최근 공지 카드
 *   I. 성장 카드
 *   J. 출석 카드
 */
import { Bell, Settings } from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, BackHandler, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

import { ParentChildHeroCard } from "@/components/parent/ParentChildHeroCard";
import { ParentQuickActionGrid } from "@/components/parent/ParentQuickActionGrid";
import { ParentTodoCard } from "@/components/parent/ParentTodoCard";
import { ParentLatestDiaryCard } from "@/components/parent/ParentLatestDiaryCard";
import { ParentRecentPhotosCard } from "@/components/parent/ParentRecentPhotosCard";
import { ParentNoticeCard } from "@/components/parent/ParentNoticeCard";
import { ParentGrowthCard } from "@/components/parent/ParentGrowthCard";
import { ParentAttendanceCard } from "@/components/parent/ParentAttendanceCard";
import { ParentHomeSkeleton } from "@/components/common/SkeletonBox";

const C = Colors.light;

interface HomeSummary {
  unread_counts: { notices: number; diaries: number; photos: number; messages: number };
  latest_diaries: any[];
  latest_photos: any[];
  latest_notices: any[];
  attendance: { attended: number; total: number; latest_status: string | null };
  growth: { current_level: any; prev_level: any; achieved_date?: string; note?: string; teacher_name?: string } | null;
  today_schedule: string | null;
}

const EMPTY_SUMMARY: HomeSummary = {
  unread_counts: { notices: 0, diaries: 0, photos: 0, messages: 0 },
  latest_diaries: [], latest_photos: [], latest_notices: [],
  attendance: { attended: 0, total: 0, latest_status: null },
  growth: null, today_schedule: null,
};

const IB = "#E6FAF8";

export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { token, parentAccount, pool } = useAuth();
  const { students, selectedStudent, setSelectedStudentId, loading: ctxLoading, refresh } = useParent();

  const [summary, setSummary] = useState<HomeSummary>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);


  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web") {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => sub.remove();
    }
  }, []));

  useEffect(() => {
    if (selectedStudent?.id) loadSummary(selectedStudent.id);
    else setSummary(EMPTY_SUMMARY);
  }, [selectedStudent?.id]);

  useFocusEffect(useCallback(() => {
    if (selectedStudent?.id) loadSummary(selectedStudent.id);
  }, [selectedStudent?.id]));

  async function loadSummary(sid: string) {
    setSummaryLoading(true);
    try {
      const r = await apiRequest(token, `/parent/students/${sid}/home-summary`);
      if (r.ok) setSummary(await r.json());
    } catch {}
    setSummaryLoading(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    if (selectedStudent?.id) await loadSummary(selectedStudent.id);
    setRefreshing(false);
  }

  const { unread_counts } = summary;

  // 빠른 바로가기 그리드 (순서: 수업일지 > 앨범 > 출결 / 공지 > 쪽지 > 수영정보)
  const quickActions = [
    {
      icon: "book-open", label: "수업일지",
      sub: unread_counts.diaries > 0 ? `새 ${unread_counts.diaries}건` : null,
      badge: unread_counts.diaries, color: "#7C3AED", bg: "#EDE9FE",
      onPress: () => router.push("/(parent)/diary?backTo=home" as any),
    },
    {
      icon: "image", label: "앨범",
      sub: unread_counts.photos > 0 ? `새 ${unread_counts.photos}장` : null,
      badge: unread_counts.photos, color: "#EA580C", bg: "#FEF3C7",
      onPress: () => router.push("/(parent)/photos?backTo=home" as any),
    },
    {
      icon: "calendar-check", label: "출결",
      sub: summary.attendance.total > 0 ? `${summary.attendance.attended}/${summary.attendance.total}회` : null,
      badge: null, color: "#2563EB", bg: "#DBEAFE",
      onPress: () => router.push("/(parent)/attendance-history?backTo=home" as any),
    },
    {
      icon: "bell", label: "공지",
      sub: unread_counts.notices > 0 ? `새 ${unread_counts.notices}건` : null,
      badge: unread_counts.notices, color: "#D97706", bg: "#FEF9C3",
      onPress: () => router.push("/(parent)/notices?backTo=home" as any),
    },
    {
      icon: "mail", label: "쪽지",
      sub: unread_counts.messages > 0 ? `읽지않음 ${unread_counts.messages}` : null,
      badge: unread_counts.messages, color: "#0369A1", bg: IB,
      onPress: () => router.push("/(parent)/messages?backTo=home" as any),
    },
    {
      icon: "droplet", label: "수영정보",
      sub: null, badge: null, color: "#2EC4B6", bg: IB,
      onPress: () => router.push("/(parent)/swim-info?backTo=home" as any),
    },
  ];

  // 오늘 확인할 것
  const todoItems = [
    unread_counts.diaries > 0 && {
      icon: "book-open", color: "#7C3AED",
      label: `수업일지 ${unread_counts.diaries}건`,
      onPress: () => router.push("/(parent)/diary?backTo=home" as any),
    },
    unread_counts.photos > 0 && {
      icon: "image", color: "#EA580C",
      label: `새 사진 ${unread_counts.photos}장`,
      onPress: () => router.push("/(parent)/photos?backTo=home" as any),
    },
    unread_counts.notices > 0 && {
      icon: "bell", color: "#D97706",
      label: `공지 ${unread_counts.notices}건`,
      onPress: () => router.push("/(parent)/notices?backTo=home" as any),
    },
    unread_counts.messages > 0 && {
      icon: "mail", color: "#0369A1",
      label: `읽지 않은 쪽지 ${unread_counts.messages}개`,
      onPress: () => router.push("/(parent)/messages?backTo=home" as any),
    },
  ].filter(Boolean) as any[];

  const PT = insets.top + (Platform.OS === "web" ? 67 : 16);

  if (ctxLoading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", backgroundColor: C.background }]}>
        <ActivityIndicator color={C.tint} size="large" />
      </View>
    );
  }


  return (
    <View style={[s.root, { backgroundColor: C.background }]}>

      {/* ─── A. 헤더 ─── */}
      <View style={[s.header, { paddingTop: PT }]}>
        <Text style={[s.poolName, { color: C.textMuted }]} numberOfLines={1}>
          {(parentAccount as any)?.pool_name || pool?.name || "수영장"}
        </Text>
        <View style={s.headerBtns}>
          <Pressable style={[s.headerBtn, { backgroundColor: C.card }]} onPress={() => router.push("/(parent)/notifications" as any)}>
            <Bell size={19} color={C.textSecondary} />
          </Pressable>
          <Pressable style={[s.headerBtn, { backgroundColor: C.card }]} onPress={() => router.push("/(parent)/more" as any)}>
            <Settings size={19} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* ─── B. 자녀 탭 (2명+) ─── */}
      {students.length > 1 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 6 }}
          style={{ flexGrow: 0 }}
        >
          {students.map(st => {
            const isSel = selectedStudent?.id === st.id;
            return (
              <Pressable
                key={st.id}
                style={[s.childTab, isSel
                  ? { backgroundColor: C.tint, borderColor: C.tint }
                  : { backgroundColor: C.card, borderColor: C.border }]}
                onPress={() => setSelectedStudentId(st.id)}
              >
                <Text style={[s.childTabTxt, { color: isSel ? "#fff" : C.text }]}>{st.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
      >
        {/* ─── C. 자녀 히어로 카드 ─── */}
        {selectedStudent && (
          <ParentChildHeroCard
            student={selectedStudent}
            unreadPhotos={unread_counts.photos}
            unreadDiaries={unread_counts.diaries}
            todaySchedule={summary.today_schedule}
            currentLevel={summary.growth?.current_level ?? null}
            onPress={() => router.push({ pathname: "/(parent)/child-profile" as any, params: { id: selectedStudent.id, backTo: "home" } })}
            onLevelPress={() => router.push("/(parent)/level?backTo=home" as any)}
          />
        )}

        {/* ─── D. 빠른 바로가기 ─── */}
        <ParentQuickActionGrid actions={quickActions} />

        {/* ─── E. 오늘 확인할 것 ─── */}
        <ParentTodoCard items={todoItems} />

        {summaryLoading ? (
          <ParentHomeSkeleton />
        ) : (
          <>
            {/* ─── F. 최근 수업일지 ─── */}
            <ParentLatestDiaryCard
              diaries={summary.latest_diaries}
              onPress={() => router.push("/(parent)/diary?backTo=home" as any)}
            />

            {/* ─── G. 최근 사진 ─── */}
            <ParentRecentPhotosCard
              photos={summary.latest_photos}
              unreadCount={unread_counts.photos}
              token={token}
              onPress={() => router.push("/(parent)/photos?backTo=home" as any)}
            />

            {/* ─── H. 최근 공지 ─── */}
            <ParentNoticeCard
              notices={summary.latest_notices}
              unreadCount={unread_counts.notices}
              onPress={() => router.push("/(parent)/notices?backTo=home" as any)}
              onViewAll={() => router.push("/(parent)/notices?backTo=home" as any)}
            />

            {/* ─── I. 성장 ─── */}
            <ParentGrowthCard
              studentId={selectedStudent?.id}
              currentLevel={summary.growth?.current_level ?? null}
              prevLevel={summary.growth?.prev_level ?? null}
              achievedDate={summary.growth?.achieved_date}
              note={summary.growth?.note}
              teacherName={summary.growth?.teacher_name}
            />

            {/* ─── J. 출석 ─── */}
            <ParentAttendanceCard
              attended={summary.attendance.attended}
              total={summary.attendance.total}
              latestStatus={summary.attendance.latest_status}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 10,
  },
  poolName: { fontSize: 14, fontFamily: "Pretendard-Regular", flex: 1 },
  headerBtns: { flexDirection: "row", gap: 8 },
  headerBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  childTab: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
  },
  childTabTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
