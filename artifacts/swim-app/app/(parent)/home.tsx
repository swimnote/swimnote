/**
 * 학부모 홈 — Stack 기반
 *
 * 구조:
 *   A. 상단 헤더 (수영장이름 · 알림 · 톱니바퀴)
 *   B. 자녀 탭 (2명+: 가로 스크롤 탭)
 *   C. 정보카드 (자녀이름 · 반 · 수업시간)
 *   D. 3×2 기능 아이콘 그리드
 *      수업일지 / 출결 / 앨범 / 공지 / 쪽지 / 수영정보
 *   E. 최신소식 피드 (공지 + 수업일지)
 */
import { Bell, ChevronRight, Link, Settings, User, UserPlus } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
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

// ─── 타입 ─────────────────────────────────────────────────────────────────
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
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
}

// ─── 수업일정 텍스트 ──────────────────────────────────────────────────────
function getScheduleText(classGroup: any) {
  if (!classGroup?.schedule_days || !classGroup?.schedule_time) return null;
  return `${classGroup.schedule_days.replace(/,/g, "·")} ${classGroup.schedule_time}`;
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
      style={({ pressed }) => [s.iconCell, { opacity: pressed ? 0.72 : 1, width: ICON_W }]}
      onPress={onPress}
    >
      <View style={s.iconWrap}>
        <View style={[s.iconBg, { backgroundColor: bg }]}>
          <LucideIcon name={icon} size={26} color={color} />
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

// ─── 뉴스 카드 ────────────────────────────────────────────────────────────
function NewsCard({ item, onPress }: { item: NewsItem; onPress: () => void }) {
  const isNotice = item.kind === "notice";
  const accentColor = isNotice ? "#2EC4B6" : "#2EC4B6";
  const accentBg    = isNotice ? "#E6FFFA" : "#DFF3EC";

  return (
    <Pressable
      style={({ pressed }) => [s.newsCard, { backgroundColor: C.card, opacity: pressed ? 0.88 : 1 }]}
      onPress={onPress}
    >
      <View style={s.newsTop}>
        <View style={[s.newsTag, { backgroundColor: accentBg }]}>
          <LucideIcon name={isNotice ? "bell" : "book-open"} size={11} color={accentColor} />
          <Text style={[s.newsTagTxt, { color: accentColor }]}>
            {isNotice
              ? (item.notice_type === "class" ? "우리반 공지" : "전체 공지")
              : "수업일지"}
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
        {isNotice ? item.title : `${item.teacher_name} 선생님 수업일지`}
      </Text>
      <Text style={[s.newsBody, { color: C.textSecondary }]} numberOfLines={2}>
        {isNotice ? item.content : item.common_content}
      </Text>

      {!isNotice && item.student_note ? (
        <View style={s.noteBox}>
          <User size={11} color="#7C3AED" />
          <Text style={[s.noteTxt, { color: "#5B21B6" }]} numberOfLines={1}>{item.student_note}</Text>
        </View>
      ) : null}

    </Pressable>
  );
}

// ─── 메인 ─────────────────────────────────────────────────────────────────
export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const { token, parentAccount } = useAuth();
  const { students, selectedStudent, setSelectedStudentId, loading: ctxLoading, refresh } = useParent();

  const [unread, setUnread] = useState<UnreadCounts>({ unread_notices: 0, unread_messages: 0 });
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 안드로이드 뒤로가기 막기 (홈에서)
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web") {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => sub.remove();
    }
  }, []));

  useEffect(() => {
    const sid = selectedStudent?.id;
    if (sid) loadAll(sid);
    else { setNews([]); setUnread({ unread_notices: 0, unread_messages: 0 }); }
  }, [selectedStudent?.id]);

  useFocusEffect(useCallback(() => {
    if (selectedStudent?.id) loadCounts(selectedStudent.id);
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
    router.push(item.kind === "notice" ? "/(parent)/notices" as any : "/(parent)/diary" as any);
  }

  // 기능 아이콘 6개: 수업일지 > 앨범 > 수영정보 > 공지 > 출결 > 쪽지
  const IB = "#E6FAF8";
  const icons = [
    { icon: "book-open", label: "수업일지", badge: null,
      color: "#7C3AED", bg: IB, path: "/(parent)/diary" },
    { icon: "image",     label: "앨범",     badge: null,
      color: "#EA580C", bg: IB, path: "/(parent)/photos" },
    { icon: "droplet",   label: "수영정보", badge: null,
      color: "#2563EB", bg: IB, path: "/(parent)/swim-info" },
    { icon: "bell",      label: "공지",     badge: unread.unread_notices,
      color: "#F59E0B", bg: IB, path: "/(parent)/notices" },
    { icon: "calendar",  label: "출결",     badge: null,
      color: "#16A34A", bg: IB, path: "/(parent)/attendance-history" },
    { icon: "mail",      label: "쪽지",     badge: unread.unread_messages,
      color: "#0369A1", bg: IB, path: "/(parent)/messages" },
  ] as const;

  const scheduleText = selectedStudent ? getScheduleText(selectedStudent.class_group) : null;

  if (ctxLoading) {
    return (
      <View style={[s.root, { justifyContent: "center", alignItems: "center", backgroundColor: C.background }]}>
        <ActivityIndicator color={C.tint} size="large" />
      </View>
    );
  }

  // ─── 자녀 미연결 상태: 정상 홈 구조 안에서 인라인 안내 ──────────────────
  if (!ctxLoading && students.length === 0) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        {/* 정상 헤더 (설정·알림 접근 가능) */}
        <View style={[s.topHeader, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.poolName, { color: C.textMuted }]}>SwimNote</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable style={[s.headerBtn, { backgroundColor: C.card }]} onPress={() => router.push("/(parent)/notifications" as any)}>
              <Bell size={19} color={C.textSecondary} />
            </Pressable>
            <Pressable style={[s.headerBtn, { backgroundColor: C.card }]} onPress={() => router.push("/(parent)/more" as any)}>
              <Settings size={19} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ flex: 1, paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* 자녀 연결 안내 카드 */}
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 24, paddingVertical: 40 }}>
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: C.tintLight, justifyContent: "center", alignItems: "center" }}>
              <Link size={38} color={C.tint} />
            </View>
            <View style={{ alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text }}>연결된 자녀가 없습니다</Text>
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
                수영장과 자녀 이름을 입력하면{"\n"}자동으로 연결됩니다.
              </Text>
            </View>
            <Pressable
              style={{ backgroundColor: C.button, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40 }}
              onPress={() => router.push("/(parent)/link-child" as any)}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" }}>자녀 연결하기</Text>
            </Pressable>

            {/* 설정으로 이동 안내 */}
            <Pressable onPress={() => router.push("/(parent)/more" as any)}>
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted }}>
                설정에서 약관 및 계정 정보를 확인할 수 있습니다
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>

      {/* ─── A. 상단 헤더 ─── */}
      <View style={[s.topHeader, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.poolName, { color: C.textMuted }]} numberOfLines={1}>
            {parentAccount?.pool_name || "수영장"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {/* 알림 */}
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/notifications" as any)}
          >
            <Bell size={19} color={C.textSecondary} />
          </Pressable>
          {/* 설정 (톱니바퀴) */}
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/more" as any)}
          >
            <Settings size={19} color={C.textSecondary} />
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
                <Text style={[s.childTabTxt, { color: isSelected ? "#fff" : C.text }]}>
                  {st.name}
                </Text>
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* ─── C. 정보카드 ─── */}
        {selectedStudent ? (
          <Pressable
            style={[s.infoCard, { backgroundColor: C.tint }]}
            onPress={() => router.push({ pathname: "/(parent)/child-profile" as any, params: { id: selectedStudent.id } })}
          >
            <View style={s.infoLeft}>
              <View style={s.infoAvatar}>
                <Text style={s.infoAvatarTxt}>{selectedStudent.name[0]}</Text>
              </View>
              <View style={{ gap: 3 }}>
                <Text style={s.infoName}>{selectedStudent.name}</Text>
                {selectedStudent.class_group?.name
                  ? <Text style={s.infoSub}>{selectedStudent.class_group.name}</Text>
                  : <Text style={[s.infoSub, { color: C.textSecondary }]}>반 배정 전</Text>}
                {scheduleText && <Text style={s.infoSchedule}>{scheduleText}</Text>}
              </View>
            </View>
            <ChevronRight size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        ) : (
          <Pressable
            style={[s.noChildCard, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/children" as any)}
          >
            <UserPlus size={22} color={C.tint} />
            <Text style={[s.noChildTxt, { color: C.text }]}>자녀를 연결해주세요</Text>
            <ChevronRight size={18} color={C.textMuted} />
          </Pressable>
        )}

        {/* ─── D. 기능 아이콘 그리드 (3×2) ─── */}
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
              <Text style={[s.sectionMore, { color: C.text }]}>공지 전체보기</Text>
            </Pressable>
          </View>

          {newsLoading ? (
            <ActivityIndicator color={C.tint} style={{ marginVertical: 28 }} />
          ) : !selectedStudent ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Text style={s.emptyEmoji}>👶</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>자녀를 먼저 연결해주세요</Text>
            </View>
          ) : news.length === 0 ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Text style={s.emptyEmoji}>📋</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>등록된 소식이 없습니다</Text>
              <Text style={[s.emptyBody, { color: C.textSecondary }]}>
                공지사항이나 수업일지가{"\n"}등록되면 여기에 표시됩니다
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  topHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 10,
  },
  poolName: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  headerBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },

  childTab: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5,
  },
  childTabTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  infoCard: {
    marginHorizontal: 20, marginTop: 6, marginBottom: 8, borderRadius: 16, padding: 13,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  infoLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  infoAvatar: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  infoAvatarTxt: { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#fff" },
  infoName: { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  infoSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.85)" },
  infoSchedule: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.7)" },

  noChildCard: {
    marginHorizontal: 20, marginVertical: 10, borderRadius: 16, padding: 18,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  noChildTxt: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular" },

  section: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  sectionMore: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconCell: { alignItems: "center", gap: 8, paddingVertical: 14 },
  iconWrap: { position: "relative" },
  iconBg: { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute", top: -5, right: -5,
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#D96C6C",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
    borderWidth: 2, borderColor: "#fff",
  },
  badgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#fff" },
  iconLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center" },

  newsCard: {
    borderRadius: 16, padding: 14, gap: 7,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  newsTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  newsTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  newsTagTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  newsDate: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  newsTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  newsBody: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 19 },
  noteBox: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EEDDF5", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  noteTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },

  emptyBox: { borderRadius: 16, padding: 32, alignItems: "center", gap: 8 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  emptyBody: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
});
