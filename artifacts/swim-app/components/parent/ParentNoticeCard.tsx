import { LucideIcon } from "@/components/common/LucideIcon";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface NoticeItem {
  id: string;
  title: string;
  created_at: string;
  is_read: boolean;
  is_pinned?: boolean;
  notice_type?: string;
}

interface Props {
  notices: NoticeItem[];
  unreadCount: number;
  onPress: () => void;
  onViewAll: () => void;
}

function fmt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function ParentNoticeCard({ notices, unreadCount, onPress, onViewAll }: Props) {
  if (notices.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#FEF9C3" }]}>
          <LucideIcon name="bell" size={16} color="#D97706" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>공지사항</Text>
        {unreadCount > 0 && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeTxt}>새 {unreadCount}건</Text>
          </View>
        )}
        <Pressable onPress={onViewAll}>
          <Text style={[styles.more, { color: C.tint }]}>전체보기</Text>
        </Pressable>
      </View>
      {notices.map((n, i) => (
        <Pressable
          key={n.id}
          style={({ pressed }) => [styles.row, i > 0 && styles.rowBorder, { opacity: pressed ? 0.7 : 1 }]}
          onPress={onPress}
        >
          {!n.is_read && <View style={styles.unreadDot} />}
          <Text style={[styles.noticeTitle, { color: n.is_read ? C.textSecondary : C.text }]} numberOfLines={1}>
            {n.is_pinned ? "📌 " : ""}{n.title}
          </Text>
          <Text style={[styles.date, { color: C.textMuted }]}>{fmt(n.created_at)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: C.card,
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBg: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
  newBadge: {
    backgroundColor: "#D97706", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  newBadgeTxt: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },
  more: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  rowBorder: { borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.tint },
  noticeTitle: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular" },
  date: { fontSize: 11, fontFamily: "Pretendard-Regular" },
});
