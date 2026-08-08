import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Dimensions, FlatList, Modal,
  Pressable, StyleSheet, Text, View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlbumPhotoInfo, AlbumVideoInfo } from "./types";
import { API_BASE } from "@/context/AuthContext";

const SCREEN_W = Dimensions.get("window").width;
const ITEM_SIZE = Math.floor((SCREEN_W - 4 * 4) / 3);

type FilterTab = "all" | "photo" | "video";

interface PickResult {
  photos: AlbumPhotoInfo[];
  videos: AlbumVideoInfo[];
}

interface Props {
  visible: boolean;
  token: string;
  initialSelected?: string[];
  onConfirm: (result: PickResult) => void;
  onClose: () => void;
}

export default function AlbumPickerModal({ visible, token, initialSelected = [], onConfirm, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const [photos,        setPhotos]        = useState<AlbumPhotoInfo[]>([]);
  const [videos,        setVideos]        = useState<AlbumVideoInfo[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [tab,           setTab]           = useState<FilterTab>("all");
  const [selPhotos,     setSelPhotos]     = useState<Set<string>>(new Set());
  const [selVideos,     setSelVideos]     = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setTab("all");
    setSelPhotos(new Set(initialSelected));
    setSelVideos(new Set());
    setLoading(true);

    Promise.all([
      fetch(`${API_BASE}/photos/picker`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(d => Array.isArray(d.photos) ? d.photos : []).catch(() => []),
      fetch(`${API_BASE}/videos/picker`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(d => Array.isArray(d.videos) ? d.videos : []).catch(() => []),
    ]).then(([p, v]) => {
      setPhotos(p);
      setVideos(v);
    }).finally(() => setLoading(false));
  }, [visible]);

  const togglePhoto = useCallback((id: string) => {
    setSelPhotos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size + selVideos.size < 20) next.add(id);
      return next;
    });
  }, [selVideos.size]);

  const toggleVideo = useCallback((id: string) => {
    setSelVideos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (selPhotos.size + next.size < 20) next.add(id);
      return next;
    });
  }, [selPhotos.size]);

  const handleConfirm = () => {
    onConfirm({
      photos: photos.filter(p => selPhotos.has(p.id)),
      videos: videos.filter(v => selVideos.has(v.id)),
    });
  };

  const totalSelected = selPhotos.size + selVideos.size;

  const renderPhoto = ({ item }: { item: AlbumPhotoInfo }) => {
    const isSel = selPhotos.has(item.id);
    const uri = item.presigned_url ?? ((item.file_url?.startsWith("http")) ? item.file_url : "");
    return (
      <Pressable
        onPress={() => { togglePhoto(item.id); }}
        style={[s.item, isSel && s.itemSelected]}
      >
        {uri ? (
          <ExpoImage source={{ uri }} style={s.image} contentFit="cover" />
        ) : (
          <View style={[s.image, { backgroundColor: "#F1F5F9" }]} />
        )}
        {isSel && (
          <View style={s.checkOverlay}>
            <LucideIcon name="check-circle" size={22} color="#fff" fill="#2EC4B6" />
          </View>
        )}
      </Pressable>
    );
  };

  const renderVideo = ({ item }: { item: AlbumVideoInfo }) => {
    const isSel = selVideos.has(item.id);
    const thumbUri = item.thumbnail_presigned_url ?? null;
    return (
      <Pressable onPress={() => toggleVideo(item.id)} style={[s.item, isSel && s.itemSelected]}>
        {thumbUri ? (
          <ExpoImage source={{ uri: thumbUri }} style={s.image} contentFit="cover" />
        ) : (
          <View style={[s.image, { backgroundColor: "#1E293B", alignItems: "center", justifyContent: "center" }]}>
            <LucideIcon name="play" size={20} color="#94A3B8" fill="#94A3B8" />
          </View>
        )}
        <View style={s.videoPlayBadge}>
          <LucideIcon name="play" size={11} color="#fff" fill="#fff" />
        </View>
        {isSel && (
          <View style={s.checkOverlay}>
            <LucideIcon name="check-circle" size={22} color="#fff" fill="#2EC4B6" />
          </View>
        )}
      </Pressable>
    );
  };

  const filteredPhotos = tab === "video" ? [] : photos;
  const filteredVideos = tab === "photo" ? [] : videos;

  type MediaItem =
    | { _type: "photo"; item: AlbumPhotoInfo }
    | { _type: "video"; item: AlbumVideoInfo };

  const combined: MediaItem[] = [
    ...filteredPhotos.map(p => ({ _type: "photo" as const, item: p })),
    ...filteredVideos.map(v => ({ _type: "video" as const, item: v })),
  ].sort((a, b) => {
    const ta = (a.item as any).created_at ?? "";
    const tb = (b.item as any).created_at ?? "";
    return tb.localeCompare(ta);
  });

  const isEmpty = combined.length === 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={[s.header, { paddingTop: insets.top + 14 }]}>
          <Pressable onPress={onClose} style={s.closeBtn} hitSlop={10}>
            <LucideIcon name="x" size={20} color="#374151" />
          </Pressable>
          <Text style={s.title}>앨범에서 선택</Text>
          <Text style={s.countText}>{totalSelected}/20</Text>
        </View>

        <View style={s.filterRow}>
          {(["all", "photo", "video"] as FilterTab[]).map(t => (
            <Pressable
              key={t}
              style={[s.filterBtn, tab === t && s.filterBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[s.filterBtnText, tab === t && s.filterBtnTextActive]}>
                {t === "all" ? "전체" : t === "photo" ? "사진" : "영상"}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color="#2EC4B6" />
        ) : isEmpty ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>
              {tab === "video" ? "업로드된 앨범 영상이 없습니다." : "업로드된 앨범 사진이 없습니다."}
            </Text>
            <Text style={s.emptySubText}>사진/영상 탭에서 먼저 업로드해 주세요.</Text>
          </View>
        ) : (
          <FlatList
            data={combined}
            keyExtractor={it => `${it._type}-${it.item.id}`}
            numColumns={3}
            renderItem={({ item: row }) =>
              row._type === "photo"
                ? renderPhoto({ item: row.item as AlbumPhotoInfo })
                : renderVideo({ item: row.item as AlbumVideoInfo })
            }
            contentContainerStyle={s.grid}
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <Pressable style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>취소</Text>
          </Pressable>
          <Pressable
            style={[s.confirmBtn, totalSelected === 0 && s.confirmDisabled]}
            onPress={handleConfirm}
            disabled={totalSelected === 0}
          >
            <Text style={s.confirmText}>
              {totalSelected === 0
                ? "사진/영상을 선택해주세요"
                : `선택 완료 (${selPhotos.size > 0 ? `사진 ${selPhotos.size}` : ""}${selPhotos.size > 0 && selVideos.size > 0 ? " · " : ""}${selVideos.size > 0 ? `영상 ${selVideos.size}` : ""})`}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container:          { flex: 1, backgroundColor: "#fff" },
  header:             { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  closeBtn:           { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  title:              { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  countText:          { width: 44, textAlign: "right", fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  filterRow:          { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  filterBtn:          { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F8FAFC" },
  filterBtnActive:    { borderColor: "#2EC4B6", backgroundColor: "#E6FFFA" },
  filterBtnText:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  filterBtnTextActive:{ color: "#2EC4B6" },
  grid:               { padding: 2 },
  item:               { width: ITEM_SIZE, height: ITEM_SIZE, margin: 2, borderRadius: 4, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  itemSelected:       { borderColor: "#2EC4B6" },
  image:              { width: "100%", height: "100%" },
  checkOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(46,196,182,0.18)", alignItems: "flex-end", justifyContent: "flex-start", padding: 4 },
  videoPlayBadge:     { position: "absolute", bottom: 5, left: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  empty:              { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32 },
  emptyText:          { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#374151", textAlign: "center" },
  emptySubText:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 20 },
  footer:             { flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtn:          { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  cancelText:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  confirmBtn:         { flex: 2, height: 50, borderRadius: 14, backgroundColor: "#2EC4B6", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  confirmDisabled:    { opacity: 0.45 },
  confirmText:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#fff", textAlign: "center" },
});
