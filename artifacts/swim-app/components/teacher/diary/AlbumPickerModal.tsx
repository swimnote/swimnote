import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Dimensions, FlatList, Modal,
  Pressable, StyleSheet, Text, View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { CheckCircle2, X } from "lucide-react-native";
import { AlbumPhotoInfo, API_BASE } from "./types";

const SCREEN_W = Dimensions.get("window").width;
const ITEM_SIZE = Math.floor((SCREEN_W - 4 * 4) / 3);
const BASE_ORIGIN = API_BASE.replace(/\/api$/, "");

interface Props {
  visible: boolean;
  token: string;
  initialSelected?: string[];
  onConfirm: (ids: string[], photos: AlbumPhotoInfo[]) => void;
  onClose: () => void;
}

export default function AlbumPickerModal({ visible, token, initialSelected = [], onConfirm, onClose }: Props) {
  const [photos,   setPhotos]   = useState<AlbumPhotoInfo[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  useEffect(() => {
    if (!visible) return;
    setSelected(new Set(initialSelected));
    setLoading(true);
    fetch(`${API_BASE}/photos/picker`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setPhotos(Array.isArray(data.photos) ? data.photos : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); }
      else if (next.size < 20) { next.add(id); }
      return next;
    });
  }, []);

  const handleConfirm = () => {
    onConfirm([...selected], photos.filter(p => selected.has(p.id)));
  };

  const renderItem = ({ item }: { item: AlbumPhotoInfo }) => {
    const isSelected = selected.has(item.id);
    const imageUri = `${BASE_ORIGIN}${item.file_url}`;
    return (
      <Pressable onPress={() => toggle(item.id)} style={[s.item, isSelected && s.itemSelected]}>
        <ExpoImage
          source={{ uri: imageUri, headers: { Authorization: `Bearer ${token}` } }}
          style={s.image}
          contentFit="cover"
        />
        {isSelected && (
          <View style={s.checkOverlay}>
            <CheckCircle2 size={22} color="#fff" fill="#2EC4B6" />
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <Pressable onPress={onClose} style={s.closeBtn} hitSlop={10}>
            <X size={20} color="#374151" />
          </Pressable>
          <Text style={s.title}>앨범에서 선택</Text>
          <Text style={s.countText}>{selected.size}/20</Text>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color="#2EC4B6" />
        ) : photos.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>업로드된 앨범 사진이 없습니다.</Text>
            <Text style={s.emptySubText}>반 사진 추가 버튼으로 먼저 사진을 업로드해 주세요.</Text>
          </View>
        ) : (
          <FlatList
            data={photos}
            keyExtractor={p => p.id}
            numColumns={3}
            renderItem={renderItem}
            contentContainerStyle={s.grid}
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={s.footer}>
          <Pressable style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>취소</Text>
          </Pressable>
          <Pressable
            style={[s.confirmBtn, selected.size === 0 && s.confirmDisabled]}
            onPress={handleConfirm}
            disabled={selected.size === 0}
          >
            <Text style={s.confirmText}>
              {selected.size === 0 ? "사진을 선택해주세요" : `선택 완료 (${selected.size}장)`}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: "#fff" },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  closeBtn:       { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  title:          { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  countText:      { width: 44, textAlign: "right", fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  grid:           { padding: 2 },
  item:           { width: ITEM_SIZE, height: ITEM_SIZE, margin: 2, borderRadius: 4, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  itemSelected:   { borderColor: "#2EC4B6" },
  image:          { width: "100%", height: "100%", backgroundColor: "#F1F5F9" },
  checkOverlay:   { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(46,196,182,0.18)", alignItems: "flex-end", justifyContent: "flex-start", padding: 4 },
  empty:          { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32 },
  emptyText:      { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#374151", textAlign: "center" },
  emptySubText:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 20 },
  footer:         { flexDirection: "row", gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  cancelBtn:      { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center", justifyContent: "center" },
  cancelText:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  confirmBtn:     { flex: 2, height: 50, borderRadius: 14, backgroundColor: "#2EC4B6", alignItems: "center", justifyContent: "center" },
  confirmDisabled:{ opacity: 0.45 },
  confirmText:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
