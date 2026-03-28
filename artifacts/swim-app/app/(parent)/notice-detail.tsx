import { CircleAlert, Pin, User } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth, API_BASE } from "@/context/AuthContext";

interface Notice {
  id: string; title: string; content: string;
  author_name: string; is_pinned: boolean; is_read?: boolean;
  created_at: string; notice_type?: string;
  student_name?: string | null; image_urls?: string[];
}

const C = Colors.light;

export default function NoticeDetailScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await apiRequest(token, "/parent/notices");
        if (res.ok) {
          const list: Notice[] = await res.json();
          const found = list.find(n => n.id === id) || null;
          setNotice(found);
          if (found && !found.is_read) {
            await apiRequest(token, `/parent/notices/${id}/read`, { method: "POST" });
          }
        }
      } finally { setLoading(false); }
    })();
  }, [id]);

  const images: string[] = Array.isArray(notice?.image_urls) ? notice!.image_urls : [];

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title="공지 상세" showHome={false} homePath="/(parent)/notices" />

      {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} /> : !notice ? (
        <View style={styles.empty}>
          <CircleAlert size={40} color={C.textMuted} />
          <Text style={[styles.emptyText, { color: C.textMuted }]}>공지를 불러올 수 없습니다</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 16 }}>
          {notice.is_pinned && (
            <View style={[styles.pinnedTag, { backgroundColor: C.tintLight }]}>
              <Pin size={13} color={C.tint} />
              <Text style={[styles.pinnedText, { color: C.tint }]}>고정 공지</Text>
            </View>
          )}
          {notice.student_name && (
            <View style={[styles.individualTag, { backgroundColor: C.tint + "18" }]}>
              <User size={13} color={C.tint} />
              <Text style={[styles.individualText, { color: C.tint }]}>{notice.student_name} 학생 개별 공지</Text>
            </View>
          )}
          <Text style={[styles.title, { color: C.text }]}>{notice.title}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: C.textMuted }]}>{notice.author_name}</Text>
            <Text style={[styles.meta, { color: C.textMuted }]}>{new Date(notice.created_at).toLocaleDateString("ko-KR")}</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: C.border }]} />
          <Text style={[styles.content, { color: C.text }]}>{notice.content}</Text>
          {images.length > 0 && (
            <View style={styles.imageGrid}>
              {images.map((key, i) => (
                <Image
                  key={i}
                  source={{ uri: `${API_BASE}/uploads/${encodeURIComponent(key)}` }}
                  style={styles.fullImage}
                  resizeMode="cover"
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  pinnedTag: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  pinnedText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  individualTag: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  individualText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  title: { fontSize: 20, fontFamily: "Pretendard-Regular", lineHeight: 28 },
  metaRow: { flexDirection: "row", justifyContent: "space-between" },
  meta: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  divider: { height: 1 },
  content: { fontSize: 15, fontFamily: "Pretendard-Regular", lineHeight: 26 },
  imageGrid: { gap: 10 },
  fullImage: { width: "100%", height: 220, borderRadius: 14 },
  empty: { alignItems: "center", gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
