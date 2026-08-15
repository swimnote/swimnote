/**
 * (admin)/x-growth.tsx — SWIMNOTE X 성장판 (pool_admin) WP9 / WP13
 *
 * XModeGuard 보호 유지.
 * 구조:
 *   1. 학생 선택 (수평 chip ScrollView)
 *   2. status / source 필터 chip
 *   3. Growth Event 목록 (FlatList + 무한스크롤 + pull-to-refresh)
 *   4. Event 탭 → GrowthEventDetail 모달
 *
 * WP13: pool_admin 승인/거절 지원. GrowthEventCard/Detail에 review props 전달.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import { XModeGuard } from "@/components/common/XModeGuard";
import { EmptyState } from "@/components/common/EmptyState";
import { GrowthEventCard } from "@/components/x/GrowthEventCard";
import { GrowthEventDetail } from "@/components/x/GrowthEventDetail";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useGrowthEvents, type GrowthEvent } from "@/hooks/useGrowthEvents";
import Colors from "@/constants/colors";

const C    = Colors.light;
// X 전용 토큰 — A1 Theme Polish (Steel Blue)
const MINT      = "#355C7D";   // xAccent
const NAVY      = "#23415C";   // xAccentStrong
const MINT_LIGHT = "#E9EEF3";  // xAccentLight

// ── 로컬 타입 ────────────────────────────────────────────────────────────────

interface Student { id: string; name: string; class_group_id: string | null; }

// ── 필터 옵션 ────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { label: "전체",     value: null },
  { label: "검토 대기", value: "PENDING_REVIEW" },
  { label: "승인",     value: "TEACHER_ACCEPTED" },
  { label: "제외",     value: "TEACHER_REJECTED" },
  { label: "자동 승인", value: "AUTO_ACCEPTED" },
  { label: "폐기",     value: "DISCARDED" },
];

const SOURCE_FILTER_OPTIONS = [
  { label: "전체",      value: null },
  { label: "AI 일지",  value: "teacher_ai" },
  { label: "수동",      value: "teacher_manual" },
];

// ── 메인 화면 ────────────────────────────────────────────────────────────────

export default function AdminXGrowthScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  // 학생 목록
  const [students,      setStudents]      = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedStu,   setSelectedStu]   = useState<Student | null>(null);

  // 필터
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);

  // detail 모달
  const [detailEventId, setDetailEventId] = useState<string | null>(null);

  // WP13: review 처리 중인 eventId
  const [reviewingEventId, setReviewingEventId] = useState<string | null>(null);

  // Growth Event hook
  const {
    events, loadState, hasMore, refreshing, errorCode,
    loadMore, refresh,
  } = useGrowthEvents({
    token,
    studentId:    selectedStu?.id ?? null,
    filterStatus,
    filterSource,
  });

  // 학생 목록 로드
  useEffect(() => {
    if (!token) return;
    setStudentsLoading(true);
    apiRequest(token, "/students")
      .then(res => res.ok ? res.json() : [])
      .then((data: Student[]) => setStudents(Array.isArray(data) ? data : []))
      .catch(() => setStudents([]))
      .finally(() => setStudentsLoading(false));
  }, [token]);

  // 학생 변경 시 필터 초기화
  const handleSelectStudent = useCallback((stu: Student) => {
    setSelectedStu(s => s?.id === stu.id ? s : stu);
    setFilterStatus(null);
    setFilterSource(null);
  }, []);

  const handleEventPress = useCallback((ev: GrowthEvent) => {
    setDetailEventId(ev.event_id);
  }, []);

  // WP13: card 버튼 → PATCH API → 성공 시 목록 refresh
  const handleReview = useCallback(async (eventId: string, action: "accept" | "reject") => {
    if (!token || !selectedStu || reviewingEventId) return;
    setReviewingEventId(eventId);
    try {
      const res = await apiRequest(
        token,
        `/x-growth/students/${selectedStu.id}/events/${eventId}/review`,
        { method: "PATCH", body: JSON.stringify({ action }) },
      );
      if (res.ok) refresh();
    } catch {
      // 실패: 원래 상태 유지 (Detail 모달이 alert 처리)
    } finally {
      setReviewingEventId(null);
    }
  }, [token, selectedStu, reviewingEventId, refresh]);

  // WP13: Detail 모달 review 성공 콜백
  const handleReviewSuccess = useCallback(() => refresh(), [refresh]);

  const renderFooter = () => {
    if (!hasMore || loadState !== "success") return null;
    return <ActivityIndicator color={MINT} style={{ marginVertical: 16 }} />;
  };

  const renderEmpty = () => {
    if (loadState === "loading") {
      return <ActivityIndicator color={MINT} style={{ marginTop: 48 }} />;
    }
    if (loadState === "error") {
      // error ≠ empty (TC-C)
      return (
        <View style={s.errorWrap}>
          <LucideIcon name="alert-circle" size={36} color="#EF4444" />
          <Text style={s.errorTxt}>성장 데이터를 불러오지 못했습니다.</Text>
          <Text style={s.errorCode}>{errorCode ?? ""}</Text>
          <Pressable style={s.retryBtn} onPress={refresh}>
            <Text style={s.retryTxt}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }
    if (loadState === "success") {
      return (
        <EmptyState
          icon="trending-up"
          title="아직 기록된 성장 데이터가 없습니다"
          subtitle="X 모드 AI 일지 작성 시 성장 이벤트가 자동으로 기록돼요."
        />
      );
    }
    return null;
  };

  return (
    <XModeGuard allowedKind="admin" allowedRole="pool_admin">
      <View style={{ flex: 1, backgroundColor: C.background }}>

        {/* 헤더 */}
        <View style={[s.header, { paddingTop: insets.top + 14 }]}>
          <Pressable hitSlop={12} onPress={() => router.back()} style={s.backBtn}>
            <LucideIcon name="arrow-left" size={20} color={NAVY} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={s.title}>성장판</Text>
              <View style={s.xBadge}>
                <Text style={s.xBadgeTxt}>SWIMNOTE X</Text>
              </View>
            </View>
            <Text style={s.headerSub}>학생별 성장 이벤트 조회</Text>
          </View>
        </View>

        {/* 학생 선택 */}
        <View style={s.sectionWrap}>
          <Text style={s.sectionLabel}>학생 선택</Text>
          {studentsLoading ? (
            <ActivityIndicator color={MINT} style={{ marginVertical: 8 }} />
          ) : students.length === 0 ? (
            <Text style={s.noStudentTxt}>등록된 학생이 없습니다.</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 16 }}
            >
              {students.map(stu => {
                const active = selectedStu?.id === stu.id;
                return (
                  <Pressable
                    key={stu.id}
                    style={[s.stuChip, active && s.stuChipActive]}
                    onPress={() => handleSelectStudent(stu)}
                  >
                    <Text style={[s.stuChipTxt, active && s.stuChipTxtActive]}>
                      {stu.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* 필터 — 학생 선택 후에만 표시 */}
        {selectedStu && (
          <View style={s.filterBar}>
            {/* status 필터 */}
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6, paddingRight: 8 }}
            >
              {STATUS_FILTER_OPTIONS.map(opt => {
                const active = filterStatus === opt.value;
                return (
                  <Pressable
                    key={String(opt.value)}
                    style={[s.filterChip, active && s.filterChipActive]}
                    onPress={() => setFilterStatus(opt.value)}
                  >
                    <Text style={[s.filterChipTxt, active && s.filterChipTxtActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* 이벤트 목록 */}
        {!selectedStu ? (
          <View style={s.noSelWrap}>
            <LucideIcon name="user" size={40} color={C.textMuted} />
            <Text style={s.noSelTxt}>학생을 선택하면{"\n"}성장 이벤트를 확인할 수 있어요.</Text>
          </View>
        ) : (
          <FlatList<GrowthEvent>
            data={events}
            keyExtractor={item => item.event_id}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: insets.bottom + 100,
              gap: 10,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={MINT}
              />
            }
            ListEmptyComponent={renderEmpty}
            ListFooterComponent={renderFooter}
            onEndReached={() => { if (hasMore && loadState === "success") loadMore(); }}
            onEndReachedThreshold={0.3}
            renderItem={({ item }) => (
              <GrowthEventCard
                event={item}
                onPress={handleEventPress}
                showReviewButtons
                onReview={handleReview}
                reviewingId={reviewingEventId}
              />
            )}
          />
        )}

        {/* 상세 모달 — WP13: canReview=true (pool_admin) */}
        <GrowthEventDetail
          visible={detailEventId !== null}
          eventId={detailEventId}
          studentId={selectedStu?.id ?? null}
          onClose={() => setDetailEventId(null)}
          canReview
          onReviewSuccess={handleReviewSuccess}
        />
      </View>
    </XModeGuard>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.backgroundSoft,
    alignItems: "center", justifyContent: "center",
  },
  title:     { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: NAVY },
  headerSub: { fontSize: 12, fontFamily: "Pretendard-Regular",  color: C.textSecondary, marginTop: 1 },
  xBadge: {
    backgroundColor: MINT_LIGHT, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: MINT,
  },
  xBadgeTxt: { fontSize: 10, fontFamily: "Pretendard-SemiBold", color: NAVY },

  sectionWrap: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: C.border,
    gap: 8,
  },
  sectionLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  noStudentTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },

  stuChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, backgroundColor: C.backgroundSoft,
    borderWidth: 1, borderColor: C.border,
  },
  stuChipActive: { backgroundColor: MINT_LIGHT, borderColor: MINT },
  stuChipTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular",  color: C.textSecondary, lineHeight: 18 },
  stuChipTxtActive: { fontFamily: "Pretendard-SemiBold", color: NAVY },

  filterBar: {
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, backgroundColor: C.backgroundSoft,
    borderWidth: 1, borderColor: C.border,
  },
  filterChipActive:    { backgroundColor: MINT_LIGHT, borderColor: MINT },
  filterChipTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 17 },
  filterChipTxtActive: { fontFamily: "Pretendard-SemiBold", color: NAVY },

  noSelWrap: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 12,
  },
  noSelTxt: {
    fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted,
    textAlign: "center", lineHeight: 22,
  },

  errorWrap: {
    alignItems: "center", paddingVertical: 60, gap: 12,
  },
  errorTxt:  { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  errorCode: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  retryBtn: {
    marginTop: 4, backgroundColor: MINT,
    borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryTxt:  { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
