import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useState } from "react";
import {
  Dimensions, Image, Pressable, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const { width: SW } = Dimensions.get("window");
const THUMB_SIZE = Math.floor((SW - 40 - 12) / 4);

interface PhotoItem {
  id: string;
  file_url: string;
  caption?: string;
  created_at: string;
  is_new?: boolean;
}

interface Props {
  photos: PhotoItem[];
  unreadCount: number;
  token: string | null;
  onPress: () => void;
}

function PhotoThumb({ photo, token }: { photo: PhotoItem; token: string | null }) {
  const [failed, setFailed] = useState(false);
  const uri = token
    ? `${photo.file_url}?_t=${token.slice(-6)}`
    : photo.file_url;

  if (failed) {
    return (
      <View style={[styles.thumb, { backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" }]}>
        <LucideIcon name="image" size={18} color={C.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[styles.thumb, photo.is_new && styles.thumbNew]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export function ParentRecentPhotosCard({ photos, unreadCount, token, onPress }: Props) {
  if (photos.length === 0) return null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
    >
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#FEF3C7" }]}>
          <LucideIcon name="image" size={16} color="#EA580C" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>최근 사진</Text>
        {unreadCount > 0 && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeTxt}>새 사진 {unreadCount}장</Text>
          </View>
        )}
        <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
      </View>
      <View style={styles.thumbRow}>
        {photos.slice(0, 4).map(p => (
          <PhotoThumb key={p.id} photo={p} token={token} />
        ))}
      </View>
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
  newBadge: {
    backgroundColor: "#EA580C", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  newBadgeTxt: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },
  thumbRow: { flexDirection: "row", gap: 4 },
  thumb: {
    width: THUMB_SIZE, height: THUMB_SIZE,
    borderRadius: 10, backgroundColor: "#E2E8F0",
  },
  thumbNew: { borderWidth: 2, borderColor: "#EA580C" },
});
