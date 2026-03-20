/**
 * 학부모 홈 — 아이콘 중심 + 최신소식 피드형
 *
 * 구조:
 *   A. 상단 헤더 (자녀 이름 드롭다운 | 알림 | 쪽지)
 *   B. 3×2 아이콘 그리드 (공지·일지·앨범·일정·프로그램·설정)
 *   C. 최신소식 피드 (공지 + 수업일지 최대 10개)
 */
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, BackHandler, Dimensions, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import { ModalSheet } from "@/components/common/ModalSheet";
import { useTabScrollReset } from "@/hooks/useTabScrollReset";

const C = Colors.light;
const { width: SW } = Dimensions.get("window");
const ICON_COL = 3;
const ICON_W = Math.floor((SW - 40 - 16) / ICON_COL);

// ─── 타입 정의 ────────────────────────────────────────────────
interface UnreadCounts {
  unread_notices: number;
  unread_messages: number;
}
interface NewsItem {
  kind: "notice" | "diary";
  id: string;
  // notice
  title?: string;
  content?: string;
  notice_type?: string;
  is_read?: boolean;
  is_pinned?: boolean;
  author_name?: string;
  // diary
  lesson_date?: string;
  common_content?: string;
  teacher_name?: string;
  student_note?: string | null;
  created_at: string;
}

// ─── 날짜 포맷 ────────────────────────────────────────────────
function fmtDate(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}
function fmtShort(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  const mm = dt.getMonth() + 1;
  const dd = dt.getDate();
  return `${mm}/${dd}`;
}

// ─── 자녀 선택 모달 ───────────────────────────────────────────
function ChildSelectorModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { students, selectedStudent, setSelectedStudentId } = useParent();
  return (
    <ModalSheet visible={visible} onClose={onClose} title="자녀 선택">
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
    </ModalSheet>
  );
}

// ─── 아이콘 셀 ────────────────────────────────────────────────
interface IconCellProps {
  icon: any;
  label: string;
  badge?: number | "N" | null;
  color: string;
  bg: string;
  onPress: () => void;
}
function IconCell({ icon, label, badge, color, bg, onPress }: IconCellProps) {
  return (
    <Pressable
      style={({ pressed }) => [s.iconCell, { opacity: pressed ? 0.75 : 1, width: ICON_W }]}
      onPress={onPress}
    >
      <View style={s.iconWrap}>
        <View style={[s.iconBg, { backgroundColor: bg }]}>
          <Feather name={icon} size={26} color={color} />
        </View>
        {badge !== null && badge !== undefined && (
          <View style={s.badgeWrap}>
            <Text style={s.badgeTxt}>{typeof badge === "number" ? (badge > 99 ? "99+" : String(badge)) : badge}</Text>
          </View>
        )}
      </View>
      <Text style={[s.iconLabel, { color: C.text }]}>{label}</Text>
    </Pressable>
  );
}

// ─── 최신소식 카드 ────────────────────────────────────────────
function NewsCard({ item, onPress }: { item: NewsItem; onPress: () => void }) {
  const isNotice = item.kind === "notice";
  const accentColor = isNotice ? "#1D4ED8" : "#059669";
  const accentBg    = isNotice ? "#EFF6FF" : "#ECFDF5";

  return (
    <Pressable
      style={({ pressed }) => [s.newsCard, { backgroundColor: C.card, opacity: pressed ? 0.88 : 1 }]}
      onPress={onPress}
    >
      {/* 상단 줄: 태그 + 날짜 */}
      <View style={s.newsTop}>
        <View style={[s.newsTag, { backgroundColor: accentBg }]}>
          <Feather name={isNotice ? "bell" : "book-open"} size={11} color={accentColor} />
          <Text style={[s.newsTagTxt, { color: accentColor }]}>
            {isNotice
              ? (item.notice_type === "class" ? "우리반 공지" : "전체 공지")
              : "수업일지"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {isNotice && !item.is_read && <View style={[s.unreadDot, { backgroundColor: C.tint }]} />}
          <Text style={[s.newsDate, { color: C.textMuted }]}>
            {isNotice ? fmtDate(item.created_at) : fmtDate(item.lesson_date || item.created_at)}
          </Text>
        </View>
      </View>

      {/* 제목 / 선생님 */}
      {isNotice
        ? <Text style={[s.newsTitle, { color: C.text }]} numberOfLines={1}>{item.title}</Text>
        : <Text style={[s.newsTitle, { color: C.text }]}>{item.teacher_name} 선생님</Text>}

      {/* 본문 미리보기 */}
      <Text style={[s.newsBody, { color: C.textSecondary }]} numberOfLines={2}>
        {isNotice ? item.content : item.common_content}
      </Text>

      {/* 개별일지 강조 (수업일지만) */}
      {!isNotice && item.student_note ? (
        <View style={s.noteBox}>
          <Feather name="user" size={11} color="#7C3AED" />
          <Text style={[s.noteText, { color: "#5B21B6" }]} numberOfLines={1}>{item.student_note}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Text style={[s.moreLink, { color: C.tint }]}>자세히 →</Text>
      </View>
    </Pressable>
  );
}

// ─── 메인 화면 ────────────────────────────────────────────────
export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useTabScrollReset("home");
  const { token, parentAccount, logout } = useAuth();
  const { students, selectedStudent, loading: ctxLoading, refresh } = useParent();

  const [unread, setUnread] = useState<UnreadCounts>({ unread_notices: 0, unread_messages: 0 });
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectorVisible, setSelectorVisible] = useState(false);

  // 안드로이드 뒤로가기 막기
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "web") {
        const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
        return () => sub.remove();
      }
    }, [])
  );

  // 학생 변경 시 데이터 로드
  useEffect(() => {
    if (selectedStudent?.id && !(selectedStudent as any).access_blocked) {
      loadAll(selectedStudent.id);
    } else {
      setNews([]); setUnread({ unread_notices: 0, unread_messages: 0 });
    }
  }, [selectedStudent?.id]);

  // 화면 포커스 시 배지 갱신
  useFocusEffect(useCallback(() => {
    if (selectedStudent?.id && !(selectedStudent as any).access_blocked) {
      loadCounts(selectedStudent.id);
    }
  }, [selectedStudent?.id]));

  async function loadAll(sid: string) {
    setNewsLoading(true);
    await Promise.all([loadNews(sid), loadCounts(sid)]);
    setNewsLoading(false);
  }

  async function loadNews(sid: string) {
    try {
      const r = await apiRequest(token, `/parent/students/${sid}/news`);
      if (r.ok) setNews(await r.json());
    } catch {}
  }

  async function loadCounts(sid: string) {
    try {
      const r = await apiRequest(token, `/parent/students/${sid}/unread-counts`);
      if (r.ok) setUnread(await r.json());
    } catch {}
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    if (selectedStudent?.id) await loadAll(selectedStudent.id);
    setRefreshing(false);
  }

  function handleNewsPress(item: NewsItem) {
    if (item.kind === "notice") {
      router.push({ pathname: "/(parent)/notices" as any });
    } else {
      router.push("/(parent)/diary" as any);
    }
  }

  // 아이콘 정의
  const icons: IconCellProps[] = [
    {
      icon: "bell", label: "공지사항",
      badge: unread.unread_notices > 0 ? unread.unread_notices : null,
      color: "#1D4ED8", bg: "#EFF6FF",
      onPress: () => router.push("/(parent)/notices" as any),
    },
    {
      icon: "book-open", label: "수업일지",
      badge: null,
      color: "#059669", bg: "#ECFDF5",
      onPress: () => router.push("/(parent)/diary" as any),
    },
    {
      icon: "image", label: "앨범",
      badge: null,
      color: "#D97706", bg: "#FFF7ED",
      onPress: () => router.push("/(parent)/photos" as any),
    },
    {
      icon: "calendar", label: "수업일정표",
      badge: null,
      color: "#7C3AED", bg: "#F5F3FF",
      onPress: () => router.push("/(parent)/attendance-history" as any),
    },
    {
      icon: "award", label: "교육프로그램",
      badge: null,
      color: "#0EA5E9", bg: "#F0F9FF",
      onPress: () => router.push("/(parent)/program" as any),
    },
    {
      icon: "settings", label: "설정",
      badge: null,
      color: "#6B7280", bg: "#F3F4F6",
      onPress: () => router.push("/(parent)/more" as any),
    },
  ];

  const blocked = (selectedStudent as any)?.access_blocked;

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
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        {/* 자녀 이름 (드롭다운 트리거) */}
        <Pressable
          style={s.childSelector}
          onPress={() => students.length > 0 && setSelectorVisible(true)}
        >
          <Text style={[s.childName, { color: C.text }]} numberOfLines={1}>
            {selectedStudent ? selectedStudent.name : parentAccount?.name ?? "스윔노트"}
          </Text>
          {students.length > 1 && (
            <Feather name="chevron-down" size={18} color={C.textSecondary} />
          )}
        </Pressable>

        {/* 우측 아이콘 */}
        <View style={{ flexDirection: "row", gap: 6 }}>
          {/* 쪽지 아이콘 */}
          <Pressable
            style={[s.headerIconBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/diary" as any)}
          >
            <Feather name="message-circle" size={20} color={C.textSecondary} />
            {unread.unread_messages > 0 && (
              <View style={[s.headerBadge, { backgroundColor: "#EF4444" }]}>
                <Text style={s.headerBadgeTxt}>{unread.unread_messages}</Text>
              </View>
            )}
          </Pressable>
          {/* 알림 아이콘 (확장 예정) */}
          <Pressable
            style={[s.headerIconBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/notifications" as any)}
          >
            <Feather name="bell" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* 학생 수영장 카드 (반 정보) */}
        {selectedStudent && !blocked && selectedStudent.class_group?.name ? (
          <View style={[s.infoBar, { backgroundColor: C.tint + "12", borderColor: C.tint + "30" }]}>
            <Feather name="map-pin" size={13} color={C.tint} />
            <Text style={[s.infoBarTxt, { color: C.tint }]}>
              {parentAccount?.pool_name} · {selectedStudent.class_group.name}
            </Text>
          </View>
        ) : blocked ? (
          <View style={[s.infoBar, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
            <Feather name="lock" size={13} color="#DC2626" />
            <Text style={[s.infoBarTxt, { color: "#DC2626" }]}>수영장에서 정보를 비공개로 설정했습니다</Text>
          </View>
        ) : null}

        {/* ─── B. 3×2 아이콘 그리드 ─── */}
        <View style={s.section}>
          <View style={s.iconGrid}>
            {icons.map((ic) => (
              <IconCell key={ic.label} {...ic} />
            ))}
          </View>
        </View>

        {/* ─── C. 최신소식 피드 ─── */}
        <View style={[s.section, { marginTop: 4 }]}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: C.text }]}>최신소식</Text>
            <Pressable onPress={() => router.push("/(parent)/notices" as any)}>
              <Text style={[s.sectionMore, { color: C.tint }]}>더보기</Text>
            </Pressable>
          </View>

          {blocked ? (
            <View style={s.emptyBox}>
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>수영장에서 정보를 비공개로 설정하여 이용할 수 없습니다</Text>
            </View>
          ) : newsLoading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 24 }} />
          ) : news.length === 0 ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Text style={s.emptyEmoji}>📋</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>아직 소식이 없습니다</Text>
              <Text style={[s.emptyBody, { color: C.textSecondary }]}>
                공지사항이나 수업일지가 등록되면{"\n"}여기에서 확인할 수 있어요
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {news.map(item => (
                <NewsCard
                  key={`${item.kind}_${item.id}`}
                  item={item}
                  onPress={() => handleNewsPress(item)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <ChildSelectorModal visible={selectorVisible} onClose={() => setSelectorVisible(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  // 헤더
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12, gap: 12,
  },
  childSelector: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  childName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  headerIconBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  headerBadge: {
    position: "absolute", top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  headerBadgeTxt: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },

  // 수영장·반 인포바
  infoBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 20, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, borderWidth: 1,
  },
  infoBarTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // 섹션
  section: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sectionMore: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // 아이콘 그리드
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconCell: { alignItems: "center", gap: 8, paddingVertical: 14 },
  iconWrap: { position: "relative" },
  iconBg: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badgeWrap: {
    position: "absolute", top: -5, right: -5,
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: "#EF4444",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 2, borderColor: "#fff",
  },
  badgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  iconLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },

  // 최신소식 카드
  newsCard: {
    borderRadius: 16, padding: 14, gap: 7,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  newsTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  newsTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  newsTagTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  newsDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  newsTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  newsBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  noteBox: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F5F3FF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  noteText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  moreLink: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // 빈 상태
  emptyBox: { borderRadius: 16, padding: 32, alignItems: "center", gap: 8 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 20 },

  // 자녀 선택 모달
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14 },
  sheetAvatar: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sheetItemName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sheetItemSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
