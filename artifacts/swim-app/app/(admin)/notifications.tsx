import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: "message-circle" | "image" | "book-open" | "bell"; color: string; bg: string }> = {
  photo_comment:  { icon: "message-circle", color: C.tint, bg: C.tintLight },
  diary_comment:  { icon: "message-circle", color: "#7C3AED", bg: "#F3E8FF" },
  diary_upload:   { icon: "book-open", color: "#2EC4B6", bg: "#E6FFFA" },
  photo_upload:   { icon: "image", color: C.warning, bg: "#FFF1BF" },
};

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export default function AdminNotificationsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnread(data.unread_count || 0);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  async function markRead(id: string) {
    await apiRequest(token, `/notifications/${id}/read`, { method: "POST" });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnread(prev => Math.max(0, prev - 1));
  }

  async function markAllRead() {
    await apiRequest(token, "/notifications/read-all", { method: "POST" });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnread(0);
  }

  async function deleteNotif(id: string) {
    await apiRequest(token, `/notifications/${id}`, { method: "DELETE" });
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  const config = (type: string) => TYPE_CONFIG[type] || { icon: "bell" as const, color: C.textSecondary, bg: C.border };

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="알림"
        subtitle={unread > 0 ? `읽지 않은 알림 ${unread}개` : undefined}
        onBack={undefined}
        rightSlot={
          unread > 0 ? (
            <Pressable style={[styles.readAllBtn, { borderColor: C.border }]} onPress={markAllRead}>
              <Text style={[styles.readAllText, { color: C.textSecondary }]}>모두 읽음</Text>
            </Pressable>
          ) : undefined
        }
      />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotifications(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {notifications.length === 0 && (
            <View style={styles.empty}>
              <Feather name="bell-off" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>알림이 없습니다</Text>
            </View>
          )}

          {notifications.map(n => {
            const cfg = config(n.type);
            return (
              <Pressable
                key={n.id}
                style={[styles.card, { backgroundColor: n.is_read ? C.card : C.tintLight + "60", shadowColor: C.shadow }]}
                onPress={() => !n.is_read && markRead(n.id)}
              >
                <View style={[styles.iconBox, { backgroundColor: cfg.bg }]}>
                  <Feather name={cfg.icon} size={18} color={cfg.color} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={[styles.cardTitle, { color: C.text }]}>{n.title}</Text>
                  <Text style={[styles.cardBody, { color: C.textSecondary }]} numberOfLines={2}>{n.body}</Text>
                  <Text style={[styles.cardTime, { color: C.textMuted }]}>{timeAgo(n.created_at)}</Text>
                </View>
                <View style={styles.cardRight}>
                  {!n.is_read && <View style={[styles.dot, { backgroundColor: C.tint }]} />}
                  <Pressable onPress={() => deleteNotif(n.id)} hitSlop={8}>
                    <Feather name="x" size={14} color={C.textMuted} />
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 24, fontFamily: "Pretendard-Bold" },
  sub: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 2 },
  readAllBtn: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  readAllText: { fontSize: 13, fontFamily: "Pretendard-Medium" },
  empty: { alignItems: "center", gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 16, fontFamily: "Pretendard-Medium" },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardContent: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  cardBody: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  cardTime: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  cardRight: { alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
