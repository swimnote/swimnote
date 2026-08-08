import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  ref_id: string;
  ref_type: string;
  is_read: boolean;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: "book-open" | "image" | "bell" | "clipboard-list"; color: string; bg: string }> = {
  diary_upload:          { icon: "book-open",     color: "#2EC4B6", bg: "#E6FFFA" },
  photo_upload:          { icon: "image",         color: "#2EC4B6", bg: "#E6FFFA" },
  parent_request_result: { icon: "clipboard-list", color: "#3B82F6", bg: "#DBEAFE" },
};

/** null / undefined / Invalid Date 방어 */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export default function ParentNotificationsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 연속 탭으로 중복 navigation 방지
  const navigatingRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRequest(token, "/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnread(data.unread_count || 0);
      } else {
        setError("알림을 불러오지 못했습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  async function handlePress(n: Notification) {
    if (navigatingRef.current) return;

    if (!n.is_read) {
      await apiRequest(token, `/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      setUnread(prev => Math.max(0, prev - 1));
    }

    // 알림 타입별 라우팅
    if (n.ref_type === "request" || n.type === "parent_request_result") {
      navigatingRef.current = true;
      router.push({
        pathname: "/(parent)/requests" as any,
        params: { requestId: n.ref_id },
      });
      setTimeout(() => { navigatingRef.current = false; }, 1000);
    } else if (n.ref_type === "diary" || n.type === "diary_upload") {
      router.push("/(parent)/children?backTo=notifications" as any);
    } else if (n.ref_type === "student" || n.type === "photo_upload") {
      router.push("/(parent)/children?backTo=notifications" as any);
    }
  }

  async function markAllRead() {
    await apiRequest(token, "/notifications/read-all", { method: "POST" }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnread(0);
  }

  async function deleteNotif(id: string) {
    await apiRequest(token, `/notifications/${id}`, { method: "DELETE" }).catch(() => {});
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  const config = (type: string) =>
    TYPE_CONFIG[type] || { icon: "bell" as const, color: C.textSecondary, bg: C.border };

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="알림"
        subtitle={unread > 0 ? `읽지 않은 알림 ${unread}개` : undefined}
        rightSlot={
          unread > 0 ? (
            <Pressable style={[styles.readAllBtn, { borderColor: C.border }]} onPress={markAllRead}>
              <Text style={[styles.readAllText, { color: C.textSecondary }]}>모두 읽음</Text>
            </Pressable>
          ) : undefined
        }
      />

      {loading ? (
        <ActivityIndicator color="#2EC4B6" style={{ marginTop: 60 }} />
      ) : error ? (
        <View style={styles.empty}>
          <LucideIcon name="wifi-off" size={40} color={C.textMuted} />
          <Text style={[styles.emptyText, { color: C.textMuted }]}>{error}</Text>
          <Pressable
            style={[styles.readAllBtn, { borderColor: C.border, marginTop: 8 }]}
            onPress={() => { setLoading(true); fetchNotifications(); }}
          >
            <Text style={[styles.readAllText, { color: C.textSecondary }]}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchNotifications(); }}
              tintColor="#2EC4B6"
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {notifications.length === 0 && (
            <View style={styles.empty}>
              <LucideIcon name="bell-off" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>알림이 없습니다</Text>
              <Text style={[styles.emptySub, { color: C.textMuted }]}>
                수업 일지, 사진 업로드 또는{"\n"}요청 처리 결과를 알려드립니다
              </Text>
            </View>
          )}

          {notifications.map(n => {
            const cfg = config(n.type);
            return (
              <Pressable
                key={n.id}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: n.is_read ? C.card : "#DDF2EF30", shadowColor: C.shadow, opacity: pressed ? 0.9 : 1 },
                ]}
                onPress={() => handlePress(n)}
              >
                <View style={[styles.iconBox, { backgroundColor: cfg.bg }]}>
                  <LucideIcon name={cfg.icon} size={18} color={cfg.color} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={[styles.cardTitle, { color: C.text }]}>{n.title}</Text>
                  <Text style={[styles.cardBody, { color: C.textSecondary }]} numberOfLines={2}>{n.body}</Text>
                  {timeAgo(n.created_at) ? (
                    <Text style={[styles.cardTime, { color: C.textMuted }]}>{timeAgo(n.created_at)}</Text>
                  ) : null}
                </View>
                <View style={styles.cardRight}>
                  {!n.is_read && <View style={[styles.dot, { backgroundColor: "#2EC4B6" }]} />}
                  <Pressable onPress={() => deleteNotif(n.id)} hitSlop={8}>
                    <LucideIcon name="x" size={14} color={C.textMuted} />
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
  readAllBtn: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  readAllText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  empty: { alignItems: "center", gap: 10, paddingTop: 80 },
  emptyText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 20 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, padding: 14, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardContent: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  cardBody: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  cardTime: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  cardRight: { alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
