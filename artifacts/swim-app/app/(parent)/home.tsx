/**
 * 학부모 홈 — Stack 기반, 탭바 없음
 *
 * 구조:
 *   A. 헤더 (수영장이름 · 알림/쪽지 아이콘)
 *   B. 자녀 탭 (1명: 탭 없이 표시 / 2명+: 가로 탭)
 *   C. 정보바 (자녀이름 · 반이름 · 수업시간)
 *   D. 3×2 아이콘 그리드
 *   E. 최신소식 피드
 */
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, BackHandler, Dimensions, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const { width: SW } = Dimensions.get("window");
const ICON_COL = 3;
const ICON_W = Math.floor((SW - 40 - 16) / ICON_COL);

// ─── 타입 ──────────────────────────────────────────────────────────────────
interface UnreadCounts { unread_notices: number; unread_messages: number; }
interface NewsItem {
  kind: "notice" | "diary";
  id: string;
  title?: string;
  content?: string;
  notice_type?: string;
  is_read?: boolean;
  author_name?: string;
  lesson_date?: string;
  common_content?: string;
  teacher_name?: string;
  student_note?: string | null;
  created_at: string;
}

// ─── 날짜 포맷 ────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

// ─── 수업일정 텍스트 ──────────────────────────────────────────────────────
function getScheduleText(classGroup: any) {
  if (!classGroup?.schedule_days || !classGroup?.schedule_time) return null;
  const days = classGroup.schedule_days.replace(/,/g, "·");
  return `${days} ${classGroup.schedule_time}`;
}

// ─── 아이콘 셀 ────────────────────────────────────────────────────────────
function IconCell({
  icon, label, badge, color, bg, onPress,
}: {
  icon: any; label: string; badge?: number | null;
  color: string; bg: string; onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.iconCell, { opacity: pressed ? 0.75 : 1, width: ICON_W }]}
      onPress={onPress}
    >
      <View style={s.iconWrap}>
        <View style={[s.iconBg, { backgroundColor: bg }]}>
          <Feather name={icon} size={26} color={color} />
        </View>
        {badge !== null && badge !== undefined && badge > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeTxt}>{badge > 99 ? "99+" : String(badge)}</Text>
          </View>
        )}
      </View>
      <Text style={[s.iconLabel, { color: C.text }]}>{label}</Text>
    </Pressable>
  );
}

// ─── 최신소식 카드 ────────────────────────────────────────────────────────
function NewsCard({ item, onPress }: { item: NewsItem; onPress: () => void }) {
  const isNotice = item.kind === "notice";
  const accentColor = isNotice ? "#1D4ED8" : "#059669";
  const accentBg    = isNotice ? "#EFF6FF" : "#ECFDF5";
  return (
    <Pressable
      style={({ pressed }) => [s.newsCard, { backgroundColor: C.card, opacity: pressed ? 0.88 : 1 }]}
      onPress={onPress}
    >
      <View style={s.newsTop}>
        <View style={[s.newsTag, { backgroundColor: accentBg }]}>
          <Feather name={isNotice ? "bell" : "book-open"} size={11} color={accentColor} />
          <Text style={[s.newsTagTxt, { color: accentColor }]}>
            {isNotice ? (item.notice_type === "class" ? "우리반 공지" : "전체 공지") : "수업일지"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {isNotice && !item.is_read && <View style={[s.unreadDot, { backgroundColor: C.tint }]} />}
          <Text style={[s.newsDate, { color: C.textMuted }]}>
            {fmtDate(isNotice ? item.created_at : (item.lesson_date || item.created_at))}
          </Text>
        </View>
      </View>
      <Text style={[s.newsTitle, { color: C.text }]} numberOfLines={1}>
        {isNotice ? item.title : `${item.teacher_name} 선생님`}
      </Text>
      <Text style={[s.newsBody, { color: C.textSecondary }]} numberOfLines={2}>
        {isNotice ? item.content : item.common_content}
      </Text>
      {!isNotice && item.student_note ? (
        <View style={s.noteBox}>
          <Feather name="user" size={11} color="#7C3AED" />
          <Text style={[s.noteTxt, { color: "#5B21B6" }]} numberOfLines={1}>{item.student_note}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Text style={[s.moreLink, { color: C.tint }]}>자세히 →</Text>
      </View>
    </Pressable>
  );
}

// ─── 메인 ─────────────────────────────────────────────────────────────────
export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { token, parentAccount, logout } = useAuth();
  const { students, selectedStudent, setSelectedStudentId, loading: ctxLoading, refresh } = useParent();

  const [unread, setUnread] = useState<UnreadCounts>({ unread_notices: 0, unread_messages: 0 });
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 안드로이드 뒤로가기 — 홈에서는 막기
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web") {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => sub.remove();
    }
  }, []));

  // 학생 변경 시 데이터 로드
  useEffect(() => {
    const sid = selectedStudent?.id;
    const blocked = (selectedStudent as any)?.access_blocked;
    if (sid && !blocked) loadAll(sid);
    else { setNews([]); setUnread({ unread_notices: 0, unread_messages: 0 }); }
  }, [selectedStudent?.id]);

  // 포커스 복귀 시 배지 갱신
  useFocusEffect(useCallback(() => {
    if (selectedStudent?.id && !(selectedStudent as any)?.access_blocked) {
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
      router.push("/(parent)/notices" as any);
    } else {
      router.push("/(parent)/diary" as any);
    }
  }

  // 아이콘 그리드 정의
  const icons = [
    { icon: "bell",     label: "공지사항",   badge: unread.unread_notices, color: "#1D4ED8", bg: "#EFF6FF", path: "/(parent)/notices" },
    { icon: "book-open",label: "수업일지",   badge: null,                  color: "#059669", bg: "#ECFDF5", path: "/(parent)/diary" },
    { icon: "image",    label: "앨범",       badge: null,                  color: "#D97706", bg: "#FFF7ED", path: "/(parent)/photos" },
    { icon: "calendar", label: "수업일정표", badge: null,                  color: "#7C3AED", bg: "#F5F3FF", path: "/(parent)/attendance-history" },
    { icon: "award",    label: "교육프로그램",badge: null,                 color: "#0EA5E9", bg: "#F0F9FF", path: "/(parent)/program" },
    { icon: "settings", label: "설정",       badge: null,                  color: "#6B7280", bg: "#F3F4F6", path: "/(parent)/more" },
  ] as const;

  const blocked = (selectedStudent as any)?.access_blocked;
  const scheduleText = selectedStudent ? getScheduleText(selectedStudent.class_group) : null;

  if (ctxLoading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", backgroundColor: C.background }]}>
        <ActivityIndicator color={C.tint} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      {/* ─── A. 최상단 헤더 ─── */}
      <View style={[s.topHeader, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.poolName, { color: C.textMuted }]} numberOfLines={1}>
            {parentAccount?.pool_name || "수영장"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {/* 쪽지 */}
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/messages" as any)}
          >
            <Feather name="mail" size={20} color={C.textSecondary} />
            {unread.unread_messages > 0 && (
              <View style={[s.headerBadge, { backgroundColor: "#EF4444" }]}>
                <Text style={s.headerBadgeTxt}>{unread.unread_messages}</Text>
              </View>
            )}
          </Pressable>
          {/* 알림 */}
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/notifications" as any)}
          >
            <Feather name="bell" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* ─── B. 자녀 탭 (2명+) ─── */}
      {students.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 6 }}
          style={{ flexGrow: 0 }}
        >
          {students.map(st => {
            const isSelected = selectedStudent?.id === st.id;
            const stBlocked = (st as any).access_blocked;
            return (
              <Pressable
                key={st.id}
                style={[
                  s.childTab,
                  isSelected
                    ? { backgroundColor: C.tint, borderColor: C.tint }
                    : { backgroundColor: C.card, borderColor: C.border },
                ]}
                onPress={() => setSelectedStudentId(st.id)}
              >
                <Text style={[
                  s.childTabTxt,
                  { color: isSelected ? "#fff" : C.text },
                ]}>
                  {st.name}
                </Text>
                {stBlocked && <Feather name="lock" size={10} color={isSelected ? "rgba(255,255,255,0.7)" : C.textMuted} />}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.tint} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* ─── C. 정보바 (자녀 이름 · 반 · 시간) ─── */}
        {selectedStudent ? (
          <View style={[s.infoCard, { backgroundColor: C.tint }]}>
            <View style={s.infoLeft}>
              <View style={[s.infoAvatar]}>
                <Text style={s.infoAvatarTxt}>{selectedStudent.name[0]}</Text>
              </View>
              <View style={{ gap: 2 }}>
                <Text style={s.infoName}>{selectedStudent.name}</Text>
                {blocked ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Feather name="lock" size={12} color="rgba(255,255,255,0.75)" />
                    <Text style={s.infoSub}>비공개 처리됨</Text>
                  </View>
                ) : (
                  <>
                    {selectedStudent.class_group?.name ? (
                      <Text style={s.infoSub}>{selectedStudent.class_group.name}</Text>
                    ) : <Text style={s.infoSub}>반 배정 전</Text>}
                    {scheduleText && (
                      <Text style={s.infoSchedule}>{scheduleText}</Text>
                    )}
                  </>
                )}
              </View>
            </View>
            <Pressable
              style={s.infoEditBtn}
              onPress={() => router.push({ pathname: "/(parent)/child-profile" as any, params: { id: selectedStudent.id } })}
            >
              <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[s.noChildCard, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/children" as any)}
          >
            <Feather name="user-plus" size={22} color={C.tint} />
            <Text style={[s.noChildTxt, { color: C.text }]}>자녀를 연결해주세요</Text>
            <Feather name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>
        )}

        {/* ─── D. 3×2 아이콘 그리드 ─── */}
        <View style={s.section}>
          <View style={s.iconGrid}>
            {icons.map(ic => (
              <IconCell
                key={ic.label}
                icon={ic.icon}
                label={ic.label}
                badge={ic.badge ?? null}
                color={ic.color}
                bg={ic.bg}
                onPress={() => router.push(ic.path as any)}
              />
            ))}
          </View>
        </View>

        {/* ─── E. 최신소식 피드 ─── */}
        <View style={[s.section, { marginTop: 4 }]}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: C.text }]}>최신소식</Text>
            <Pressable onPress={() => router.push("/(parent)/notices" as any)}>
              <Text style={[s.sectionMore, { color: C.tint }]}>더보기</Text>
            </Pressable>
          </View>

          {blocked ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Text style={[s.emptyTxt, { color: C.textMuted }]}>수영장에서 정보를 비공개로 설정했습니다</Text>
            </View>
          ) : newsLoading ? (
            <ActivityIndicator color={C.tint} style={{ marginVertical: 24 }} />
          ) : !selectedStudent ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Text style={s.emptyEmoji}>👶</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>자녀를 먼저 연결해주세요</Text>
            </View>
          ) : news.length === 0 ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Text style={s.emptyEmoji}>📋</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>아직 소식이 없습니다</Text>
              <Text style={[s.emptyBody, { color: C.textSecondary }]}>공지사항이나 수업일지가{"\n"}등록되면 여기서 확인할 수 있어요</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {news.map(item => (
                <NewsCard key={`${item.kind}_${item.id}`} item={item} onPress={() => handleNewsPress(item)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  // 헤더
  topHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 10,
  },
  poolName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  headerBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  headerBadge: {
    position: "absolute", top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  headerBadgeTxt: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },

  // 자녀 탭
  childTab: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
  },
  childTabTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // 정보 카드
  infoCard: {
    marginHorizontal: 20, marginVertical: 10, borderRadius: 20, padding: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  infoLeft: { flexDirection: "row", alignItems: "center", gap: 14 },
  infoAvatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  infoAvatarTxt: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  infoName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  infoSub: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.85)" },
  infoSchedule: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  infoEditBtn: { padding: 6 },

  noChildCard: {
    marginHorizontal: 20, marginVertical: 10, borderRadius: 16, padding: 18,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  noChildTxt: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },

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
  badge: {
    position: "absolute", top: -5, right: -5,
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#EF4444",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
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
  noteTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  moreLink: { fontSize: 12, fontFamily: "Inter_500Medium" },

  // 빈 상태
  emptyBox: { borderRadius: 16, padding: 32, alignItems: "center", gap: 8 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
