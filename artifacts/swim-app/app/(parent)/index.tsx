import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, BackHandler, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

interface FeedItem {
  type: "diary" | "photo";
  id: string;
  date: string;
  teacher_name: string | null;
  content: string | null;
  student_note?: string | null;
  created_at: string;
  album_type?: string;
}

interface StudentLevel {
  level: string;
}

function fmtDate(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function QuickMenu({ studentId }: { studentId: string }) {
  const items = [
    { icon: "book-open" as const, label: "수업피드백", tab: "diary" },
    { icon: "image" as const, label: "앨범", tab: "photos" },
    { icon: "calendar" as const, label: "출결", tab: "attendance-history" },
    { icon: "award" as const, label: "레벨", tab: "level" },
    { icon: "bell" as const, label: "공지", tab: "notices" },
  ];
  return (
    <View style={s.quickGrid}>
      {items.map(item => (
        <Pressable
          key={item.tab}
          style={({ pressed }) => [s.quickItem, { opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.push(`/(parent)/${item.tab}` as any)}
        >
          <View style={[s.quickIcon, { backgroundColor: C.tintLight }]}>
            <Feather name={item.icon} size={22} color={C.tint} />
          </View>
          <Text style={[s.quickLabel, { color: C.text }]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const [expanded, setExpanded] = useState(false);
  const preview = item.content ? (item.content.length > 60 ? item.content.slice(0, 60) + "…" : item.content) : null;
  const needExpand = (item.content?.length ?? 0) > 60;

  return (
    <View style={[s.feedCard, { backgroundColor: C.card }]}>
      <View style={s.feedTop}>
        <View style={[s.feedTypeBadge, { backgroundColor: item.type === "diary" ? "#EFF6FF" : "#FFF7ED" }]}>
          <Feather name={item.type === "diary" ? "book" : "image"} size={12} color={item.type === "diary" ? "#2563EB" : "#D97706"} />
          <Text style={[s.feedTypeTxt, { color: item.type === "diary" ? "#2563EB" : "#D97706" }]}>
            {item.type === "diary" ? "수업피드백" : item.album_type === "private" ? "개인앨범" : "전체앨범"}
          </Text>
        </View>
        <Text style={[s.feedDate, { color: C.textMuted }]}>{fmtDate(item.date)}</Text>
      </View>

      {item.teacher_name ? (
        <Text style={[s.feedTeacher, { color: C.text }]}>{item.teacher_name} 선생님</Text>
      ) : null}

      {item.content ? (
        <Pressable onPress={needExpand ? () => setExpanded(e => !e) : undefined}>
          <Text style={[s.feedContent, { color: C.textSecondary }]}>
            {expanded ? item.content : preview}
          </Text>
          {needExpand && (
            <Text style={[s.feedMore, { color: C.tint }]}>{expanded ? "접기" : "더보기"}</Text>
          )}
        </Pressable>
      ) : null}

      {item.student_note ? (
        <View style={[s.noteBox, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
          <Feather name="user" size={11} color="#7C3AED" />
          <Text style={[s.noteText, { color: "#5B21B6" }]}>{item.student_note}</Text>
        </View>
      ) : null}

      <Pressable
        style={s.feedDetailBtn}
        onPress={() => item.type === "diary"
          ? router.push("/(parent)/diary" as any)
          : router.push("/(parent)/photos" as any)
        }
      >
        <Text style={[s.feedDetailTxt, { color: C.tint }]}>자세히 보기</Text>
        <Feather name="chevron-right" size={14} color={C.tint} />
      </Pressable>
    </View>
  );
}

function ChildSelectorModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { students, selectedStudent, setSelectedStudentId } = useParent();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.modalOverlay} onPress={onClose}>
        <Pressable style={[s.selectorSheet, { backgroundColor: C.card }]} onPress={() => {}}>
          <View style={s.sheetHandle} />
          <Text style={[s.sheetTitle, { color: C.text }]}>자녀 선택</Text>
          {students.map(student => (
            <Pressable
              key={student.id}
              style={[s.sheetItem, selectedStudent?.id === student.id && { backgroundColor: C.tintLight }]}
              onPress={() => { setSelectedStudentId(student.id); onClose(); }}
            >
              <View style={[s.sheetAvatar, { backgroundColor: C.tintLight }]}>
                <Text style={[s.sheetAvatarText, { color: C.tint }]}>{student.name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.sheetItemName, { color: C.text }]}>{student.name}</Text>
                {student.class_group?.name ? (
                  <Text style={[s.sheetItemSub, { color: C.textMuted }]}>{student.class_group.name}</Text>
                ) : null}
              </View>
              {selectedStudent?.id === student.id && (
                <Feather name="check" size={18} color={C.tint} />
              )}
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={[s.sheetClose, { backgroundColor: C.border }]}>
            <Text style={[s.sheetCloseTxt, { color: C.textSecondary }]}>닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentAccount, logout } = useAuth();
  const { students, selectedStudent, loading: ctxLoading, refresh } = useParent();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectorVisible, setSelectorVisible] = useState(false);
  const [currentLevel, setCurrentLevel] = useState<string | null>(null);

  async function handleFullLogout() {
    await logout();
    if (Platform.OS === "web") {
      try { sessionStorage.clear(); } catch { }
      (window as any).location.replace("/");
    } else {
      router.replace("/");
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "web") {
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
          handleFullLogout();
          return true;
        });
        return () => sub.remove();
      }
    }, [])
  );

  useEffect(() => {
    if (selectedStudent?.id) {
      loadFeed(selectedStudent.id);
      loadLevel(selectedStudent.id);
    }
  }, [selectedStudent?.id]);

  async function loadFeed(studentId: string) {
    setFeedLoading(true);
    try {
      const res = await apiRequest(token, `/parent/students/${studentId}/feed`);
      if (res.ok) setFeed(await res.json());
    } catch { }
    finally { setFeedLoading(false); }
  }

  async function loadLevel(studentId: string) {
    try {
      const res = await apiRequest(token, `/parent/students/${studentId}/levels`);
      if (res.ok) {
        const data: StudentLevel[] = await res.json();
        if (data.length > 0) setCurrentLevel(data[0].level);
        else setCurrentLevel(null);
      }
    } catch { }
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    if (selectedStudent?.id) {
      await Promise.all([
        loadFeed(selectedStudent.id),
        loadLevel(selectedStudent.id),
      ]);
    }
    setRefreshing(false);
  }

  if (ctxLoading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.tint} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      {/* 상단 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.poolName, { color: C.text }]}>{parentAccount?.pool_name || "스윔노트"}</Text>
          <Text style={[s.greeting, { color: C.textSecondary }]}>{parentAccount?.name}님, 안녕하세요</Text>
        </View>
        <Pressable onPress={handleFullLogout} style={[s.logoutBtn, { backgroundColor: C.card }]}>
          <Feather name="log-out" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* 자녀 선택 카드 */}
        {selectedStudent ? (
          <Pressable
            style={[s.childCard, { backgroundColor: C.tint }]}
            onPress={() => students.length > 1 && setSelectorVisible(true)}
          >
            <View style={s.childCardAvatar}>
              <Text style={s.childCardAvatarText}>{selectedStudent.name[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={s.childCardName}>{selectedStudent.name}</Text>
                {currentLevel ? (
                  <View style={s.levelBadge}>
                    <Feather name="award" size={11} color="rgba(255,255,255,0.9)" />
                    <Text style={s.levelTxt}>{currentLevel}</Text>
                  </View>
                ) : null}
              </View>
              {selectedStudent.class_group?.name ? (
                <Text style={s.childCardSub}>{selectedStudent.class_group.name} · {selectedStudent.class_group.instructor || selectedStudent.class_group.schedule_days + " " + selectedStudent.class_group.schedule_time}</Text>
              ) : null}
            </View>
            {students.length > 1 && (
              <View style={s.switchRow}>
                <Feather name="repeat" size={15} color="rgba(255,255,255,0.85)" />
                <Text style={s.switchTxt}>전환</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={[s.childCard, { backgroundColor: C.card }]}>
            <Feather name="user-x" size={24} color={C.textMuted} />
            <Text style={[s.childCardName, { color: C.text }]}>연결된 자녀가 없습니다</Text>
          </View>
        )}

        {/* 바로가기 메뉴 */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: C.text }]}>바로가기</Text>
          {selectedStudent ? (
            <QuickMenu studentId={selectedStudent.id} />
          ) : (
            <Text style={[s.emptyHint, { color: C.textMuted }]}>자녀 연결 후 이용 가능합니다</Text>
          )}
        </View>

        {/* 최근 업데이트 피드 */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: C.text }]}>최근 업데이트</Text>
          {feedLoading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 20 }} />
          ) : feed.length === 0 ? (
            <View style={[s.emptyFeed, { backgroundColor: C.card }]}>
              <Text style={s.emptyFeedEmoji}>📋</Text>
              <Text style={[s.emptyFeedTitle, { color: C.text }]}>아직 업데이트가 없습니다</Text>
              <Text style={[s.emptyFeedSub, { color: C.textSecondary }]}>선생님이 수업 일지나 사진을 올리면{"\n"}여기에서 확인할 수 있어요</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {feed.slice(0, 3).map(item => <FeedCard key={`${item.type}_${item.id}`} item={item} />)}
            </View>
          )}
        </View>

        {/* 광고 영역 */}
        <View style={[s.adSection, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={[s.adBanner, { backgroundColor: "#F0F9FF" }]}>
            <Feather name="star" size={18} color="#0EA5E9" />
            <View style={{ flex: 1 }}>
              <Text style={[s.adTitle, { color: "#0C4A6E" }]}>수영 레슨 특별 프로그램</Text>
              <Text style={[s.adSub, { color: "#0369A1" }]}>여름 집중반 등록 시 10% 할인</Text>
            </View>
            <Pressable style={[s.adBtn, { backgroundColor: "#0EA5E9" }]}>
              <Text style={s.adBtnTxt}>자세히</Text>
            </Pressable>
          </View>
          <View style={[s.adBanner, { backgroundColor: "#F5F3FF" }]}>
            <Feather name="gift" size={18} color="#7C3AED" />
            <View style={{ flex: 1 }}>
              <Text style={[s.adTitle, { color: "#3B0764" }]}>친구 추천 이벤트</Text>
              <Text style={[s.adSub, { color: "#6D28D9" }]}>추천 시 양쪽 1개월 무료</Text>
            </View>
            <Pressable style={[s.adBtn, { backgroundColor: "#7C3AED" }]}>
              <Text style={s.adBtnTxt}>참여</Text>
            </Pressable>
          </View>
          <Text style={[s.adDisclaimer, { color: C.textMuted }]}>광고</Text>
        </View>
      </ScrollView>

      <ChildSelectorModal visible={selectorVisible} onClose={() => setSelectorVisible(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, gap: 12,
  },
  poolName: { fontSize: 20, fontFamily: "Inter_700Bold" },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  childCard: {
    marginHorizontal: 20, marginBottom: 8, borderRadius: 20, padding: 16,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  childCardAvatar: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  childCardAvatarText: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  childCardName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  childCardSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  switchTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.9)" },
  levelBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  levelTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.95)" },

  section: { paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyHint: { fontSize: 14, fontFamily: "Inter_400Regular" },

  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickItem: { width: "18%", alignItems: "center", gap: 6, minWidth: 60 },
  quickIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  quickLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },

  feedCard: {
    borderRadius: 16, padding: 14, gap: 8,
    shadowColor: "#0000001A", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2,
  },
  feedTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  feedTypeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  feedTypeTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  feedDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  feedTeacher: { fontSize: 14, fontFamily: "Inter_700Bold" },
  feedContent: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  feedMore: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  noteBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, borderRadius: 10, borderWidth: 1, padding: 8 },
  noteText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, flex: 1 },
  feedDetailBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end" },
  feedDetailTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },

  emptyFeed: { borderRadius: 16, padding: 32, alignItems: "center", gap: 8 },
  emptyFeedEmoji: { fontSize: 48 },
  emptyFeedTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyFeedSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  adSection: { margin: 20, marginTop: 12, borderRadius: 20, borderWidth: 1, padding: 16, gap: 10 },
  adBanner: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  adTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  adSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  adBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  adBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  adDisclaimer: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "right" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  selectorSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14 },
  sheetAvatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetItemName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sheetItemSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  sheetClose: { padding: 14, borderRadius: 14, alignItems: "center", marginTop: 4 },
  sheetCloseTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
