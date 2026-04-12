import { LucideIcon } from "@/components/common/LucideIcon";
import { ImageIcon } from "lucide-react-native";
import React, { useState } from "react";
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const { width: SW } = Dimensions.get("window");
const THUMB_SIZE = Math.floor((SW - 40 - 14 - 8) / 2);

interface PhotoItem {
  id: string;
  file_url: string;
  caption?: string | null;
  created_at: string;
  is_new?: boolean;
}

interface Props {
  photos: PhotoItem[];
  unreadCount: number;
  token: string | null;
  onPress: () => void;
}

function PhotoThumb({ photo, token, totalCount, idx }: { photo: PhotoItem; token: string | null; totalCount: number; idx: number }) {
  const [failed, setFailed] = useState(false);
  const uri = token ? `${photo.file_url}?_t=${token.slice(-6)}` : photo.file_url;
  const isLast = idx === 1 && totalCount > 2;
  const extra = totalCount - 2;

  if (failed) {
    return (
      <View style={[styles.thumb, { alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9" }]}>
        <ImageIcon size={22} color={C.textMuted} />
      </View>
    );
  }

  return (
    <View style={styles.thumbWrap}>
      <Image
        source={{ uri }}
        style={[styles.thumb, photo.is_new && styles.thumbNew]}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
      {isLast && extra > 0 && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTxt}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

export function ParentRecentPhotosCard({ photos, unreadCount, token, onPress }: Props) {
  const show = photos.slice(0, 2);
  const hasNew = photos.some(p => p.is_new);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.92 : 1 }]}
      onPress={onPress}
    >
      {/* 헤더 */}
      <View style={styles.header}>
        <View style={[styles.iconBg, { backgroundColor: "#FEF3C7" }]}>
          <ImageIcon size={16} color="#EA580C" />
        </View>
        <Text style={[styles.title, { color: C.text }]}>최근 사진</Text>
        {hasNew && unreadCount > 0 && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeTxt}>새 사진 {unreadCount}장</Text>
          </View>
        )}
        <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
      </View>

      {/* 본문 */}
      {show.length > 0 ? (
        <View style={styles.thumbRow}>
          {show.map((p, i) => (
            <PhotoThumb
              key={p.id}
              photo={p}
              token={token}
              totalCount={photos.length}
              idx={i}
            />
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <ImageIcon size={22} color={C.textMuted} />
          <Text style={[styles.emptyTxt, { color: C.textMuted }]}>아직 등록된 사진이 없습니다</Text>
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
  newBadge: {
    backgroundColor: "#EA580C", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  newBadgeTxt: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#fff" },
  thumbRow: { flexDirection: "row", gap: 8 },
  thumbWrap: { position: "relative" },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
  },
  thumbNew: { borderWidth: 2, borderColor: "#EA580C" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.42)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayTxt: { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#fff" },
  empty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  emptyTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
});
