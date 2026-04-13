/**
 * 학부모 홈 — 정보 우선순위 중심 UX
 *
 * 구조:
 *   A. 상단 헤더 (수영장명 · 알림 · 설정)
 *   B. 자녀 탭
 *   C. 상단 요약 카드 (이름 / 반 / 출석 / 오늘 수업)
 *   D. 새 소식 스트립 (unread_counts 합산)
 *   1. 최근 수업일지 카드
 *   2. 최근 사진 카드
 *   3. 공지사항 카드
 *   4. 현재 레벨 카드
 */
import { Bell, Plus, Settings } from "lucide-react-native";
import { ParentPromoBanner } from "@/components/parent/ParentPromoBanner";
import { ParentPromoStrip } from "@/components/parent/ParentPromoStrip";
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
import { ParentLatestDiaryCard } from "@/components/parent/ParentLatestDiaryCard";
import { ParentRecentPhotosCard } from "@/components/parent/ParentRecentPhotosCard";
import { ParentNoticeCard } from "@/components/parent/ParentNoticeCard";
import { ParentGrowthCard } from "@/components/parent/ParentGrowthCard";

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
  const { token, parentAccount, pool, parentPoolName, logout } = useAuth();
  const { students, selectedStudent, setSelectedStudentId, loading: ctxLoading, refresh } = useParent();

  const [summary, setSummary] = useState<HomeSummary>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [poolModal, setPoolModal] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmedPool, setConfirmedPool] = useState<PoolResult | null>(null);

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
      if (v2Status === null) setV2Status("no_pool");
    }
  }

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

  // 새 소식 스트립 텍스트 생성 (최대 3개)
  const newsItems = [
    unread_counts.diaries > 0 && `새 일지 ${unread_counts.diaries}건`,
    unread_counts.photos > 0 && `새 사진 ${unread_counts.photos}장`,
    unread_counts.notices > 0 && `새 공지 ${unread_counts.notices}건`,
    unread_counts.messages > 0 && `새 쪽지 ${unread_counts.messages}개`,
  ].filter(Boolean).slice(0, 3) as string[];
  const hasNews = newsItems.length > 0;

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
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: "#FFF3E0", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
              <LucideIcon name="clock" size={44} color={ORANGE} />
            </View>
            <Text style={{ fontSize: 22, fontFamily: "Pretendard-Bold", color: C.text, textAlign: "center", marginBottom: 10 }}>연결 대기 중</Text>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
              수영장에서 자녀 등록을 완료하면{"\n"}자동으로 연결됩니다.
            </Text>
          </View>

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

          <Pressable
            onPress={async () => { await logout(); router.replace("/"); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginTop: 8, paddingVertical: 10 })}
          >
            <Text style={{ fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" }}>
              로그아웃
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (noPool) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.header, { paddingTop: PT }]}>
          <Text style={[s.poolName, { color: C.textMuted }]}>SwimNote</Text>
          <View style={s.headerBtns} />
        </View>

        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 80 }}>
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

  const isBlocked = !!(selectedStudent as any)?.access_blocked;

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

      {/* ─── B. 자녀 탭 ─── */}
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
            onPress={() => router.push("/(parent)/link-child" as any)}
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

        {/* ─── 자녀 없음 빈 화면 ─── */}
        {students.length === 0 && (
          <View style={{ flex: 1, alignItems: "center", paddingTop: 60, paddingHorizontal: 32, gap: 16 }}>
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: IB, alignItems: "center", justifyContent: "center" }}>
              <LucideIcon name="user-plus" size={38} color={TEAL} />
            </View>
            <Text style={{ fontSize: 20, fontFamily: "Pretendard-SemiBold", color: C.text, textAlign: "center" }}>
              아직 연결된 자녀가 없습니다
            </Text>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
              자녀를 연결하면 수업 기록을{"\n"}확인할 수 있습니다
            </Text>
            <Pressable
              onPress={() => router.push("/(parent)/link-child" as any)}
              style={({ pressed }) => ({
                marginTop: 8, backgroundColor: pressed ? "#27B8AC" : TEAL,
                borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32,
                alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10,
              })}
            >
              <LucideIcon name="link" size={18} color="#fff" />
              <Text style={{ fontSize: 16, fontFamily: "Pretendard-SemiBold", color: "#fff" }}>자녀 연결하기</Text>
            </Pressable>
          </View>
        )}

        {/* ─── C. 상단 요약 카드 ─── */}
        {selectedStudent && (
          <ParentChildHeroCard
            student={selectedStudent}
            attended={summary.attendance.attended}
            total={summary.attendance.total}
            todaySchedule={summary.today_schedule}
            currentLevel={summary.growth?.current_level ?? null}
            onPress={() => router.push({ pathname: "/(parent)/child-profile" as any, params: { id: selectedStudent.id, backTo: "home" } })}
          />
        )}

        {/* ─── D. 새 소식 스트립 ─── */}
        {selectedStudent && hasNews && (
          <View style={s.newsStrip}>
            <LucideIcon name="bell" size={13} color={TEAL} />
            <Text style={s.newsTxt} numberOfLines={1}>
              {newsItems.join(" · ")}
            </Text>
          </View>
        )}

        {/* ─── access_blocked 제한 안내 ─── */}
        {selectedStudent && isBlocked && (
          <View style={s.blockedCard}>
            <LucideIcon name="lock" size={20} color="#D97706" />
            <View style={{ flex: 1 }}>
              <Text style={[s.blockedTitle, { color: C.text }]}>정보 열람 제한</Text>
              <Text style={[s.blockedSub, { color: C.textSecondary }]}>
                현재 일부 정보 열람이 제한되어 있습니다.{"\n"}수영장 담당자에게 문의해주세요.
              </Text>
            </View>
          </View>
        )}

        {/* ─── 메인 카드 4개 (access_blocked 아닐 때만) ─── */}
        {students.length > 0 && !isBlocked && (
          <>
            {/* 1. 최근 수업일지 */}
            <ParentLatestDiaryCard
              diaries={summary.latest_diaries}
              onPress={() => router.push("/(parent)/diary?backTo=home" as any)}
            />

            {/* 2. 최근 사진 */}
            <ParentRecentPhotosCard
              photos={summary.latest_photos}
              unreadCount={unread_counts.photos}
              token={token}
              onPress={() => router.push("/(parent)/photos?backTo=home" as any)}
            />

            {/* 3. 공지사항 */}
            <ParentNoticeCard
              notices={summary.latest_notices}
              unreadCount={unread_counts.notices}
              onPress={() => router.push("/(parent)/notices?backTo=home" as any)}
            />

            {/* 4. 현재 레벨 */}
            <ParentGrowthCard
              growth={summary.growth}
              onPress={() => router.push("/(parent)/level?backTo=home" as any)}
            />

            {/* 5. 광고 배너 — 얇은 스트립 + 큰 슬라이더 */}
            <ParentPromoStrip />
            <ParentPromoBanner />

            {summaryLoading && (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <ActivityIndicator color={C.tint} size="small" />
              </View>
            )}
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
  childTabAdd: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12,
  },
  childTabTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  newsStrip: {
    marginHorizontal: 20, marginTop: 8,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: IB,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10,
  },
  newsTxt: {
    fontSize: 13, fontFamily: "Pretendard-Regular", color: TEAL, flex: 1,
  },
  blockedCard: {
    marginHorizontal: 20, marginTop: 12,
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: "#FEF9C3", borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: "#FDE68A",
  },
  blockedTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold", marginBottom: 4 },
  blockedSub: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
});
