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
import { Bell, Plus, Settings } from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, BackHandler, FlatList, Keyboard,
  KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

import { ParentChildHeroCard } from "@/components/parent/ParentChildHeroCard";
import { ParentQuickActionGrid } from "@/components/parent/ParentQuickActionGrid";
import { ParentTodoCard } from "@/components/parent/ParentTodoCard";
import { ParentLatestDiaryCard } from "@/components/parent/ParentLatestDiaryCard";
import { ParentRecentPhotosCard } from "@/components/parent/ParentRecentPhotosCard";
import { ParentNoticeCard } from "@/components/parent/ParentNoticeCard";
import { ParentGrowthCard } from "@/components/parent/ParentGrowthCard";
import { ParentAttendanceCard } from "@/components/parent/ParentAttendanceCard";
import { ParentPromoBanner } from "@/components/parent/ParentPromoBanner";
import { ParentPromoStrip } from "@/components/parent/ParentPromoStrip";

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
const TEAL = "#2EC4B6";

interface PoolResult { id: string; name: string; address?: string | null; }

function PoolSelectModal({ visible, onClose, onSelect }: {
  visible: boolean; onClose: () => void; onSelect: (p: PoolResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [pools, setPools] = useState<PoolResult[]>([]);
  const [allPools, setAllPools] = useState<PoolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) { setQuery(""); setPools([]); return; }
    setLoading(true);
    fetch(`${API_BASE}/pools/public-search`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(data => {
        const list: PoolResult[] = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
        setAllPools(list); setPools(list);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setTimeout(() => inputRef.current?.focus(), 300); });
  }, [visible]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    setPools(!q ? allPools : allPools.filter(p => p.name.toLowerCase().includes(q) || (p.address ?? "").toLowerCase().includes(q)));
  }, [query, allPools]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", paddingBottom: insets.bottom + 16 }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0E0E0", alignSelf: "center", marginTop: 10, marginBottom: 6 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 }}>
          <Text style={{ fontSize: 17, fontFamily: "Pretendard-Bold", color: "#111" }}>수영장 선택</Text>
          <Pressable onPress={onClose} hitSlop={12}><LucideIcon name="x" size={20} color="#999" /></Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F4F6FA", borderRadius: 12, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
          <LucideIcon name="search" size={16} color="#999" />
          <TextInput ref={inputRef} style={{ flex: 1, fontSize: 15, color: "#111", fontFamily: "Pretendard-Regular" }}
            placeholder="수영장 이름 검색" placeholderTextColor="#bbb" value={query} onChangeText={setQuery}
            returnKeyType="search" onSubmitEditing={Keyboard.dismiss} />
          {query.length > 0 && <Pressable onPress={() => setQuery("")} hitSlop={8}><LucideIcon name="x" size={14} color="#bbb" /></Pressable>}
        </View>
        {loading ? (
          <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={TEAL} /></View>
        ) : (
          <FlatList
            data={pools}
            keyExtractor={p => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={{ textAlign: "center", color: "#999", marginTop: 24, fontFamily: "Pretendard-Regular" }}>검색 결과가 없습니다.</Text>}
            renderItem={({ item }) => (
              <Pressable onPress={() => { onSelect(item); onClose(); }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, gap: 12, backgroundColor: pressed ? "#F0FAF9" : "#fff" })}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#E6FAF8", alignItems: "center", justifyContent: "center" }}>
                  <LucideIcon name="building-2" size={18} color={TEAL} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#111" }}>{item.name}</Text>
                  {item.address ? <Text style={{ fontSize: 12, color: "#999", fontFamily: "Pretendard-Regular" }}>{item.address}</Text> : null}
                </View>
                <LucideIcon name="chevron-right" size={16} color="#ccc" />
              </Pressable>
            )}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { token, parentAccount, pool, parentPoolName } = useAuth();
  const { students, selectedStudent, setSelectedStudentId, loading: ctxLoading, refresh } = useParent();

  const [summary, setSummary] = useState<HomeSummary>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [poolModal, setPoolModal] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmedPool, setConfirmedPool] = useState<PoolResult | null>(null);

  // V2 상태 3단계 (no_pool / waiting / linked)
  const [v2Status, setV2Status] = useState<"no_pool" | "waiting" | "linked" | null>("no_pool");
  const [v2PendingChildName, setV2PendingChildName] = useState<string | null>(null);
  const [v2Retrying, setV2Retrying] = useState(false);

  const noPool = !confirmedPool && !(parentAccount as any)?.swimming_pool_id && !pool;

  async function handlePoolSelect(selected: PoolResult) {
    setLinking(true);
    try {
      const r = await apiRequest(token, "/parent/onboard-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swimming_pool_id: selected.id }),
      });
      if (r.ok) {
        const data = await r.json();
        AsyncStorage.setItem("parent_pool_name", data.pool_name || selected.name).catch(() => {});
        setConfirmedPool(selected);
        await refresh();
      }
    } catch {}
    setLinking(false);
  }

  // V2: 연결 상태 조회 (홈 진입 시 자동 실행)
  async function loadV2Status() {
    try {
      const r = await apiRequest(token, "/parent/v2/status");
      if (r.ok) {
        const data = await r.json();
        setV2Status(data.status);
        setV2PendingChildName(data.pendingChildName || null);
        if (data.status === "linked") await refresh();
      }
    } catch (e) {
      console.error("[v2-home] 상태 조회 오류:", e);
      // 실패 시 no_pool(기존 방식)로 fallback
      if (v2Status === null) setV2Status("no_pool");
    }
  }

  // V2: "다시 확인" 버튼 (명시적 재시도)
  async function handleV2Retry() {
    setV2Retrying(true);
    try {
      const r = await apiRequest(token, "/parent/v2/retry-link", { method: "POST" });
      if (r.ok) {
        const data = await r.json();
        setV2Status(data.status);
        setV2PendingChildName(data.pendingChildName || null);
        if (data.status === "linked") await refresh();
      }
    } catch {}
    setV2Retrying(false);
  }

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web") {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => sub.remove();
    }
  }, []));

  // V2 상태 로드 (마운트 + 포커스)
  useEffect(() => { loadV2Status(); }, []);
  useFocusEffect(useCallback(() => { loadV2Status(); }, []));

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

  // V2 waiting 상태 — 매칭 대기 중
  if (v2Status === "waiting") {
    const ORANGE = "#F97316";
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.header, { paddingTop: PT }]}>
          <Text style={[s.poolName, { color: C.textMuted }]}>SwimNote</Text>
          <View style={s.headerBtns} />
        </View>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 80 }}>
          {/* 대기 아이콘 */}
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "#FFF3E0", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
              <LucideIcon name="clock" size={44} color={ORANGE} />
            </View>
            <Text style={{ fontSize: 22, fontFamily: "Pretendard-Bold", color: C.text, textAlign: "center", marginBottom: 10 }}>연결 대기 중</Text>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
              수영장에서 자녀 등록을 완료하면{"\n"}자동으로 연결됩니다.
            </Text>
          </View>

          {/* 대기 정보 카드 */}
          <View style={{ backgroundColor: "#FFF3E0", borderRadius: 16, padding: 18, gap: 10, marginBottom: 24, borderWidth: 1, borderColor: "#FECFA2" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <LucideIcon name="user" size={16} color={ORANGE} />
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.text }}>
                등록 대기 자녀: <Text style={{ color: ORANGE }}>{v2PendingChildName || "정보 없음"}</Text>
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular", lineHeight: 18 }}>
              수영장 담당자에게 아이 이름과 보호자 전화번호{"\n"}등록을 확인해주세요.
            </Text>
          </View>

          {/* 다시 확인 버튼 */}
          <Pressable
            onPress={handleV2Retry}
            disabled={v2Retrying}
            style={({ pressed }) => ({
              backgroundColor: pressed ? "#EA6A00" : ORANGE,
              borderRadius: 14, paddingVertical: 16,
              alignItems: "center", flexDirection: "row",
              justifyContent: "center", gap: 10, marginBottom: 12,
            })}
          >
            {v2Retrying
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <LucideIcon name="refresh-cw" size={18} color="#fff" />
                  <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: "#fff" }}>다시 확인하기</Text>
                </>
            }
          </Pressable>
          <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 18 }}>
            수영장 등록 완료 후 버튼을 누르면{"\n"}즉시 연결됩니다.
          </Text>
        </ScrollView>
      </View>
    );
  }

  if (noPool) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        {/* 헤더 */}
        <View style={[s.header, { paddingTop: PT }]}>
          <Text style={[s.poolName, { color: C.textMuted }]}>SwimNote</Text>
          <View style={s.headerBtns} />
        </View>

        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 80 }}>
          {/* 온보딩 카드 */}
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "#E6FAF8", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
              <LucideIcon name="building-2" size={44} color={TEAL} />
            </View>
            <Text style={{ fontSize: 22, fontFamily: "Pretendard-Bold", color: C.text, textAlign: "center", marginBottom: 10 }}>수영장을 선택해주세요</Text>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
              수영장을 선택하면 자녀의 수업, 앨범,{"\n"}출결 정보를 바로 확인할 수 있어요.
            </Text>
          </View>

          <Pressable
            onPress={() => setPoolModal(true)}
            disabled={linking}
            style={({ pressed }) => ({
              backgroundColor: pressed ? "#27B8AC" : TEAL,
              borderRadius: 14, paddingVertical: 16,
              alignItems: "center", flexDirection: "row",
              justifyContent: "center", gap: 10,
            })}
          >
            {linking
              ? <ActivityIndicator color="#fff" size="small" />
              : <>
                  <LucideIcon name="search" size={20} color="#fff" />
                  <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: "#fff" }}>수영장 선택하기</Text>
                </>
            }
          </Pressable>

          <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 16 }}>
            선택 후 전화번호로 등록된 자녀가 자동 연결됩니다
          </Text>
        </ScrollView>

        <PoolSelectModal
          visible={poolModal}
          onClose={() => setPoolModal(false)}
          onSelect={handlePoolSelect}
        />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>

      {/* ─── A. 헤더 ─── */}
      <View style={[s.header, { paddingTop: PT }]}>
        <Text style={[s.poolName, { color: C.textMuted }]} numberOfLines={1}>
          {parentPoolName || (parentAccount as any)?.pool_name || pool?.name || "수영장"}
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

      {/* ─── B. 자녀 탭 + 추가 버튼 ─── */}
      {students.length > 0 && (
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
          <Pressable
            style={[s.childTab, s.childTabAdd, { backgroundColor: C.card, borderColor: C.border }]}
            onPress={() => router.push("/(parent)/add-child" as any)}
          >
            <Plus size={14} color={C.textSecondary} />
            <Text style={[s.childTabTxt, { color: C.textSecondary, marginLeft: 2 }]}>추가</Text>
          </Pressable>
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

        {/* ─── D2. 슬림 스트립 배너 ─── */}
        <View style={{ marginTop: 12 }}>
          <ParentPromoStrip />
        </View>

        {/* ─── D3. 이벤트/프로모션 슬라이더 배너 ─── */}
        <View style={{ marginTop: 10 }}>
          <ParentPromoBanner />
        </View>

        {/* ─── E. 오늘 확인할 것 ─── */}
        <ParentTodoCard items={todoItems} />

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

        {summaryLoading && (
          <View style={{ paddingVertical: 20, alignItems: "center" }}>
            <ActivityIndicator color={C.tint} size="small" />
          </View>
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
  childTabAdd: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12,
  },
  childTabTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
