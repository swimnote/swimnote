/**
 * 학부모 홈 — S7 Soft Snap 적용
 *
 * 구조: 단일 FlatList
 *   ListHeaderComponent
 *     A. Slim Header (수영장명 · 알림 · 설정)
 *     B. 자녀 선택 탭
 *     C. ParentSlimInfoPanel
 *     D. 새 소식 스트립
 *     E. access_blocked 안내
 *     F. 자녀 없음 빈 화면
 *   FlatList data items
 *     1. promo_strip  — 얇은 배너
 *     2. promo_banner — 두꺼운 배너
 *     3. photos       — 사진 업데이트
 *     4. diary        — 수업일지 Feed
 */
import { ParentPromoBanner } from "@/components/parent/ParentPromoBanner";
import { ParentPromoStrip } from "@/components/parent/ParentPromoStrip";
import { ParentSlimInfoPanel } from "@/components/parent/ParentSlimInfoPanel";
import { ParentLatestDiaryCard } from "@/components/parent/ParentLatestDiaryCard";
import { ParentRecentPhotosCard } from "@/components/parent/ParentRecentPhotosCard";
import { type LevelDef } from "@/components/common/LevelBadge";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, BackHandler, FlatList, Image, Keyboard, Linking, Modal,
  NativeScrollEvent, NativeSyntheticEvent,
  Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

// ── Soft Snap 상수 ────────────────────────────────────────────────────────
// 스냅 포인트 경계 이내일 때만 보정 (px)
const SNAP_THRESHOLD = 80;
// 빠른 플링 감지 기준 (px/ms) — 이 속도 이상이면 보정 안 함
const VELOCITY_CUTOFF = 0.5;
const IB = "#E6FAF8";
const TEAL = "#2EC4B6";

// ── FlatList 아이템 타입 ───────────────────────────────────────────────────
type FeedItem =
  | { key: "promo_strip";  type: "promo_strip" }
  | { key: "promo_banner"; type: "promo_banner" }
  | { key: "photos";       type: "photos" }
  | { key: "diary";        type: "diary" };

const FEED_ITEMS: FeedItem[] = [
  { key: "promo_strip",  type: "promo_strip" },
  { key: "promo_banner", type: "promo_banner" },
  { key: "photos",       type: "photos" },
  { key: "diary",        type: "diary" },
];

// ── HomeSummary 타입 ──────────────────────────────────────────────────────
interface HomeSummary {
  unread_counts: { notices: number; diaries: number; photos: number; messages: number };
  latest_diaries: any[];
  latest_photos: any[];
  latest_notices: any[];
  attendance: { attended: number; total: number; latest_status: string | null };
  growth: {
    current_level: any; prev_level: any;
    achieved_date?: string; note?: string; teacher_name?: string;
    badge_color?: string | null; badge_text_color?: string | null;
    level_def?: LevelDef | null;
  } | null;
  today_schedule: string | null;
}

const EMPTY_SUMMARY: HomeSummary = {
  unread_counts: { notices: 0, diaries: 0, photos: 0, messages: 0 },
  latest_diaries: [], latest_photos: [], latest_notices: [],
  attendance: { attended: 0, total: 0, latest_status: null },
  growth: null, today_schedule: null,
};

// ── PoolSelectModal ───────────────────────────────────────────────────────
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
    setPools(!q ? allPools : allPools.filter(p =>
      p.name.toLowerCase().includes(q) || (p.address ?? "").toLowerCase().includes(q)
    ));
  }, [query, allPools]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={onClose} />
      <View style={{
        backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
        maxHeight: "80%", paddingBottom: insets.bottom + 16,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#E0E0E0", alignSelf: "center", marginTop: 10, marginBottom: 6 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 }}>
          <Text style={{ fontSize: 17, fontFamily: "Pretendard-Bold", color: "#111" }}>수영장 선택</Text>
          <Pressable onPress={onClose} hitSlop={12}><LucideIcon name="x" size={20} color="#999" /></Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F4F6FA", borderRadius: 12, marginHorizontal: 20, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
          <LucideIcon name="search" size={16} color="#999" />
          <TextInput
            ref={inputRef}
            style={{ flex: 1, fontSize: 15, color: "#111", fontFamily: "Pretendard-Regular" }}
            placeholder="수영장 이름 검색" placeholderTextColor="#bbb"
            value={query} onChangeText={setQuery}
            returnKeyType="search" onSubmitEditing={Keyboard.dismiss}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <LucideIcon name="x" size={14} color="#bbb" />
            </Pressable>
          )}
        </View>
        {loading ? (
          <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={TEAL} /></View>
        ) : (
          <FlatList
            data={pools}
            keyExtractor={p => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={{ textAlign: "center", color: "#999", marginTop: 24, fontFamily: "Pretendard-Regular" }}>
                검색 결과가 없습니다.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { onSelect(item); onClose(); }}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center",
                  paddingHorizontal: 20, paddingVertical: 14, gap: 12,
                  backgroundColor: pressed ? "#F0FAF9" : "#fff",
                })}
              >
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
      </View>
    </Modal>
  );
}

// ── 메인 화면 ─────────────────────────────────────────────────────────────
export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<FeedItem>>(null);

  // Soft Snap — 스냅 포인트 및 스크롤 세션 추적
  const snapPointsRef     = useRef<number[]>([0]);
  const lastScrollYRef    = useRef(0);
  const lastScrollTimeRef = useRef(Date.now());
  // 세션 단위 속도 — onScrollBeginDrag에서 초기화, onScroll에서 누적 최댓값 기록
  const maxVelocityRef    = useRef(0);
  // onScrollEndDrag 시점에 maxVelocityRef 기준으로 확정한 플링 여부
  const isFastFlingRef    = useRef(false);
  // scrollToOffset 호출 후 유발되는 재진입 방지
  const isSnappingRef     = useRef(false);

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
  const [v2PoolPhone, setV2PoolPhone] = useState<string | null>(null);
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
        setV2PoolPhone(data.pool_phone || null);
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

  async function unlinkChild(studentId: string, studentName: string) {
    Alert.alert("자녀 연결 해제", `${studentName}의 연결을 해제할까요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "해제", style: "destructive",
        onPress: async () => {
          try {
            const r = await apiRequest(token, `/parent/unlink-child/${studentId}`, { method: "DELETE" });
            const d = await r.json();
            if (r.ok && d.success) {
              await refresh();
            } else {
              Alert.alert("오류", d.message || "연결 해제에 실패했습니다.");
            }
          } catch {
            Alert.alert("오류", "네트워크 오류가 발생했습니다.");
          }
        },
      },
    ]);
  }

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web") {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => sub.remove();
    }
  }, []));

  useEffect(() => { loadV2Status(); }, []);
  useFocusEffect(useCallback(() => { loadV2Status(); }, []));
  useFocusEffect(useCallback(() => { refresh(); }, []));

  useEffect(() => {
    if (selectedStudent?.id) loadSummary(selectedStudent.id);
    else setSummary(EMPTY_SUMMARY);
  }, [selectedStudent?.id]);

  useFocusEffect(useCallback(() => {
    if (selectedStudent?.id) loadSummary(selectedStudent.id);
  }, [selectedStudent?.id]));

  async function loadSummary(sid: string) {
    let hasCached = false;
    try {
      const raw = await AsyncStorage.getItem(`@sn:home_summary_${sid}`);
      if (raw) { setSummary(JSON.parse(raw)); hasCached = true; }
    } catch {}
    if (!hasCached) setSummaryLoading(true);
    try {
      const [summaryRes, levelRes] = await Promise.all([
        apiRequest(token, `/parent/students/${sid}/home-summary`),
        apiRequest(token, `/parent/students/${sid}/level-info`),
      ]);
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        if (levelRes.ok) {
          try {
            const ld = await levelRes.json();
            if (ld.current_level) {
              const levelDefObj: LevelDef = ld.current_level;
              const bColor = levelDefObj.badge_color ?? null;
              const bTextColor = levelDefObj.badge_text_color ?? null;
              if (!data.growth && ld.current_level_order != null) {
                data.growth = {
                  current_level: levelDefObj.level_name ?? `레벨 ${ld.current_level_order}`,
                  prev_level: null,
                  badge_color: bColor,
                  badge_text_color: bTextColor,
                  level_def: levelDefObj,
                };
              } else if (data.growth) {
                data.growth.badge_color = bColor;
                data.growth.badge_text_color = bTextColor;
                data.growth.level_def = levelDefObj;
              }
            }
          } catch {}
        }
        setSummary(data);
        AsyncStorage.setItem(`@sn:home_summary_${sid}`, JSON.stringify(data)).catch(() => {});
      }
    } catch {}
    setSummaryLoading(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    if (selectedStudent?.id) await loadSummary(selectedStudent.id);
    setRefreshing(false);
  }

  // ── Soft Snap 핸들러 ────────────────────────────────────────────────────

  // 1) 드래그 시작 — 세션 초기화
  const handleScrollBeginDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      lastScrollYRef.current    = e.nativeEvent.contentOffset.y;
      lastScrollTimeRef.current = Date.now();
      maxVelocityRef.current    = 0;
      isFastFlingRef.current    = false;
      isSnappingRef.current     = false;
    },
    [],
  );

  // 2) onScroll: 세션 내 최대 절댓값 속도를 누적 (px/ms)
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y   = e.nativeEvent.contentOffset.y;
    const now = Date.now();
    const dt  = now - lastScrollTimeRef.current;
    if (dt > 0) {
      const v = Math.abs(y - lastScrollYRef.current) / dt;
      if (v > maxVelocityRef.current) maxVelocityRef.current = v;
    }
    lastScrollYRef.current    = y;
    lastScrollTimeRef.current = now;
  }, []);

  // 3) 드래그 손 뗌 — 세션 최대 속도로 플링 여부 확정
  const handleScrollEndDrag = useCallback(() => {
    isFastFlingRef.current = maxVelocityRef.current > VELOCITY_CUTOFF;
  }, []);

  // 4) 관성 스크롤 정지 — 세션 플래그로 보정 여부 결정
  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // isSnappingRef: scrollToOffset 호출로 인한 재진입 방지
      if (isSnappingRef.current) {
        isSnappingRef.current = false;
        return;
      }

      // 이번 세션이 빠른 플링 → 보정 안 함
      if (isFastFlingRef.current) {
        isFastFlingRef.current = false;
        return;
      }
      isFastFlingRef.current = false;

      const y      = e.nativeEvent.contentOffset.y;
      const points = snapPointsRef.current;

      // headerHeight가 아직 측정되지 않았으면 [0] 만 사용
      const validPoints = points.filter((p, i) => i === 0 || p > 0);

      let closest = validPoints[0];
      let minDist = Math.abs(y - closest);
      for (const point of validPoints) {
        const dist = Math.abs(y - point);
        if (dist < minDist) { minDist = dist; closest = point; }
      }

      // SNAP_THRESHOLD 이내이고 이미 정확히 있지 않을 때만 보정
      if (minDist > 0 && minDist <= SNAP_THRESHOLD) {
        isSnappingRef.current = true;
        flatListRef.current?.scrollToOffset({ offset: closest, animated: true });
      }
    },
    [],
  );

  const { unread_counts } = summary;

  const newsItems = [
    unread_counts.diaries > 0 && `새 일지 ${unread_counts.diaries}건`,
    unread_counts.photos > 0 && `새 사진 ${unread_counts.photos}장`,
    unread_counts.notices > 0 && `새 공지 ${unread_counts.notices}건`,
    unread_counts.messages > 0 && `새 쪽지 ${unread_counts.messages}개`,
  ].filter(Boolean).slice(0, 3) as string[];
  const hasNews = newsItems.length > 0;

  const PT = insets.top + (Platform.OS === "web" ? 67 : 16);
  const isBlocked = !!(selectedStudent as any)?.access_blocked;
  const showFeed = students.length > 0 && !isBlocked && !!selectedStudent;

  if (ctxLoading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", backgroundColor: C.background }]}>
        <ActivityIndicator color={C.tint} size="large" />
      </View>
    );
  }

  // ── V2 waiting 상태 ────────────────────────────────────────────────────
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
              수영장에 아이 이름·보호자 전화번호가{"\n"}정확히 등록되어 있는지 확인해주세요.
            </Text>
            {!!v2PoolPhone && (
              <Pressable
                onPress={() => Linking.openURL(`tel:${v2PoolPhone!.replace(/[^0-9]/g, "")}`)}
                style={({ pressed }) => ({
                  flexDirection: "row", alignItems: "center", gap: 8,
                  backgroundColor: pressed ? "#FECFA2" : "#fff",
                  borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
                  borderWidth: 1, borderColor: "#FECFA2",
                })}
              >
                <LucideIcon name="phone" size={15} color={ORANGE} />
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: ORANGE }}>
                  수영장 전화하기  {v2PoolPhone}
                </Text>
              </Pressable>
            )}
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

  // ── 수영장 미연결 ──────────────────────────────────────────────────────
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

  // ── ListHeaderComponent ───────────────────────────────────────────────
  const ListHeader = (
    <View onLayout={e => {
      const h = e.nativeEvent.layout.height;
      // headerHeight가 0이거나 이전 측정값과 같으면 갱신 생략
      if (h <= 0) return;
      const prev = snapPointsRef.current;
      if (prev.length === 2 && prev[1] === h) return;
      // 스냅 포인트: [맨 위(0), 피드 시작(헤더 전체 높이)] — 중복 방지
      snapPointsRef.current = [0, h];
    }}>
      {/* A. Slim Header */}
      <View style={[s.header, { paddingTop: PT }]}>
        <Text style={[s.poolName, { color: C.textMuted }]} numberOfLines={1}>
          {parentPoolName || (parentAccount as any)?.pool_name || pool?.name || "수영장"}
        </Text>
        <View style={s.headerBtns}>
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/notifications" as any)}
          >
            <LucideIcon name="bell" size={19} color={C.textSecondary} />
          </Pressable>
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => Linking.openURL("https://swimnote.kr")}
          >
            <Image
              source={require("@/assets/images/swimnote-logo.png")}
              style={{ width: 19, height: 19 }}
              resizeMode="contain"
            />
          </Pressable>
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/more" as any)}
          >
            <LucideIcon name="settings" size={19} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* B. 자녀 선택 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 6 }}
        style={{ flexGrow: 0 }}
      >
        {students.map(st => {
          const isSel = selectedStudent?.id === st.id;
          return (
            <Pressable
              key={st.id}
              style={[
                s.childTab,
                isSel
                  ? { backgroundColor: C.tint, borderColor: C.tint }
                  : { backgroundColor: C.card, borderColor: C.border },
              ]}
              onPress={() => setSelectedStudentId(st.id)}
              onLongPress={() => unlinkChild(st.id, st.name)}
              delayLongPress={600}
            >
              <Text style={[s.childTabTxt, { color: isSel ? "#fff" : C.text }]}>{st.name}</Text>
              {isSel && (
                <LucideIcon name="user-minus" size={12} color="rgba(255,255,255,0.7)" style={{ marginLeft: 4 }} />
              )}
            </Pressable>
          );
        })}
        <Pressable
          style={[s.childTab, s.childTabAdd, { backgroundColor: C.card, borderColor: C.border }]}
          onPress={() => router.push("/(parent)/link-child" as any)}
        >
          <LucideIcon name="plus" size={14} color={C.textMuted} />
          <Text style={[s.childTabTxt, { color: C.textMuted, marginLeft: 2 }]}>추가</Text>
        </Pressable>
      </ScrollView>

      {/* C. ParentSlimInfoPanel */}
      {selectedStudent && (
        <ParentSlimInfoPanel
          student={selectedStudent}
          attended={summary.attendance.attended}
          total={summary.attendance.total}
          todaySchedule={summary.today_schedule}
          currentLevel={summary.growth?.current_level ?? null}
          levelDef={summary.growth?.level_def ?? null}
          onPress={() =>
            router.push({
              pathname: "/(parent)/child-profile" as any,
              params: { id: selectedStudent.id, backTo: "home" },
            })
          }
        />
      )}

      {/* D. 새 소식 스트립 */}
      {selectedStudent && hasNews && (
        <View style={s.newsStrip}>
          <LucideIcon name="bell" size={13} color={TEAL} />
          <Text style={s.newsTxt} numberOfLines={1}>{newsItems.join(" · ")}</Text>
        </View>
      )}

      {/* E. access_blocked 안내 */}
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

      {/* F. 자녀 없음 빈 화면 */}
      {students.length === 0 && (
        <View style={{ alignItems: "center", paddingTop: 60, paddingHorizontal: 32, gap: 16 }}>
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
    </View>
  );

  // ── renderItem ────────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: FeedItem }) => {
    switch (item.type) {
      case "promo_strip":
        return (
          <View style={{ marginTop: 8 }}>
            <ParentPromoStrip />
          </View>
        );
      case "promo_banner":
        return <ParentPromoBanner />;
      case "photos":
        return (
          <ParentRecentPhotosCard
            photos={summary.latest_photos.map(p => ({
              ...p,
              file_url: p.file_url?.startsWith("/") ? `${API_BASE}${p.file_url}` : p.file_url,
            }))}
            unreadCount={unread_counts.photos}
            token={token}
            onPress={() => router.push("/(parent)/photos?backTo=home" as any)}
          />
        );
      case "diary":
        return (
          <ParentLatestDiaryCard
            diaries={summary.latest_diaries}
            onPress={() => {
              const d = summary.latest_diaries?.[0];
              if (d?.id) {
                router.push({
                  pathname: "/(parent)/diary",
                  params: { diary_id: d.id, backTo: "home" },
                } as any);
              } else {
                router.push("/(parent)/diary?backTo=home" as any);
              }
            }}
          />
        );
      default:
        return null;
    }
  };

  // ── ListFooterComponent ───────────────────────────────────────────────
  const ListFooter = summaryLoading ? (
    <View style={{ paddingVertical: 20, alignItems: "center" }}>
      <ActivityIndicator color={C.tint} size="small" />
    </View>
  ) : null;

  // ── 메인 렌더 ──────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <FlatList<FeedItem>
        ref={flatListRef}
        data={showFeed ? FEED_ITEMS : []}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScroll={handleScroll}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
      />
      <PoolSelectModal
        visible={poolModal}
        onClose={() => setPoolModal(false)}
        onSelect={handlePoolSelect}
      />
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
