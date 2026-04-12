import { LucideIcon } from "@/components/common/LucideIcon";
import { Pin } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface NoticeItem {
  id: string;
  title: string;
  content?: string;
  created_at: string;
  is_read: boolean;
  is_pinned?: boolean;
  notice_type?: string;
}

interface Props {
  notices: NoticeItem[];
  unreadCount: number;
  onPress: () => void;
}

function fmt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function ParentNoticeCard({ notices, unreadCount, onPress }: Props) {
  const notice = notices[0] ?? null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#FEF9C3" }]}>
          <LucideIcon name="bell" size={16} color="#D97706" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>공지사항</Text>
        {unreadCount > 0 && (
          <View style={[styles.badge, { backgroundColor: "#D97706" }]}>
            <Text style={styles.badgeTxt}>새 공지 {unreadCount}개</Text>
          </View>
        )}
        <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
      </View>

      {/* 본문 */}
      {notice ? (
        <View style={styles.body}>
          <View style={styles.metaRow}>
            {notice.is_pinned && (
              <View style={styles.pinBadge}>
                <Pin size={10} color="#B45309" />
                <Text style={styles.pinTxt}>중요</Text>
              </View>
            )}
            {!notice.is_read && (
              <View style={styles.unreadDot} />
            )}
            <Text style={[styles.date, { color: C.textMuted }]}>{fmt(notice.created_at)}</Text>
          </View>
          <Text
            style={[styles.noticeTitle, { color: notice.is_read ? C.textSecondary : C.text }]}
            numberOfLines={2}
          >
            {notice.title}
          </Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <LucideIcon name="bell" size={22} color={C.textMuted} />
          <Text style={[styles.emptyTxt, { color: C.textMuted }]}>새로운 공지가 없습니다</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: C.card,
    padding: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBg: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },
  body: { gap: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  pinBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "#FEF3C7", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  pinTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#B45309" },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.tint },
  date: { fontSize: 11, fontFamily: "Pretendard-Regular", marginLeft: "auto" },
  noticeTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  empty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  emptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
