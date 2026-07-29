/**
 * MyAlbumPickerModal.tsx
 *
 * 내 개인앨범(private/saved)에서 사진/영상을 선택하여 일지에 첨부.
 * 3가지 방법:
 *  1. 기존 저장된 항목 그리드에서 선택 → 선택 완료 → 일지 첨부
 *  2. 전체앨범에서 가져오기(FullAlbumPickerModal) → 내앨범 저장 + 자동 선택 → 일지 첨부
 *  3. 직접 업로드(갤러리 → /photos|videos/private) → 내앨범 저장 + 자동 선택 → 일지 첨부
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, FlatList, Modal,
  Pressable, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import * as ImagePicker from "expo-image-picker";
import Colors from "@/constants/colors";
import { API_BASE } from "@/context/AuthContext";
import { compressImageIfNeeded } from "@/utils/compressImage";
import { FullAlbumPickerModal } from "@/components/teacher/album/FullAlbumPickerModal";
import { AlbumPhotoInfo, AlbumVideoInfo } from "./types";

const C = Colors.light;
const { width: W } = Dimensions.get("window");
const CELL = Math.floor((W - 4) / 3);

interface RawItem {
  id: string;
  file_url: string;
  presigned_url?: string;
  thumbnail_presigned_url?: string;
  created_at: string;
  uploaded_by_name?: string;
  class_name?: string;
  caption?: string;
  status?: string;
}

interface Props {
  visible: boolean;
  mediaType: "photo" | "video";
  token: string | null;
  onClose: () => void;
  onConfirm: (photos: AlbumPhotoInfo[], videos: AlbumVideoInfo[]) => void;
}

function photoUri(url: string | undefined, tok?: string | null): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  const base = `${API_BASE.replace(/\/api$/, "")}${url}`;
  return tok ? `${base}?token=${tok}` : base;
}

export default function MyAlbumPickerModal({
  visible, mediaType, token, onClose, onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems]             = useState<RawItem[]>([]);
  const [loading, setLoading]         = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [error, setError]             = useState<string | null>(null);
  const [showFullAlbum, setShowFullAlbum] = useState(false);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const isPhoto   = mediaType === "photo";
  const color     = isPhoto ? "#C2410C" : "#5B21B6";
  const bgColor   = isPhoto ? "#FFEDD5" : "#EDE9FE";
  const title     = isPhoto ? "내 사진앨범" : "내 영상앨범";

  const loadList = useCallback(async (autoSelectNewIds?: Set<string>) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint = isPhoto
        ? "/photos/teacher-all?scope=private"
        : "/videos/teacher-all?scope=private";
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      const key  = isPhoto ? "photos" : "videos";
      const raw: RawItem[] = Array.isArray(data[key]) ? data[key] : (Array.isArray(data) ? data : []);
      setItems(raw);
      if (autoSelectNewIds && autoSelectNewIds.size > 0) {
        const newIds = raw.map(r => r.id).filter(id => autoSelectNewIds.has(id));
        if (newIds.length > 0) {
          setSelected(prev => {
            const next = new Set(prev);
            newIds.forEach(id => next.add(id));
            return next;
          });
        }
      }
    } catch {
      setError("목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token, isPhoto]);

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setError(null);
      loadList();
    }
  }, [visible, loadList]);

  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleConfirm() {
    const selItems = items.filter(it => selected.has(it.id));
    if (isPhoto) {
      const photos: AlbumPhotoInfo[] = selItems.map(it => ({
        id: it.id,
        file_url: it.file_url,
        presigned_url: it.presigned_url,
        created_at: it.created_at,
        uploaded_by_name: it.uploaded_by_name,
        class_name: it.class_name,
      }));
      onConfirm(photos, []);
    } else {
      const videos: AlbumVideoInfo[] = selItems.map(it => ({
        id: it.id,
        file_url: it.file_url,
        thumbnail_presigned_url: it.thumbnail_presigned_url,
        created_at: it.created_at,
        uploaded_by_name: it.uploaded_by_name,
        class_name: it.class_name,
        caption: it.caption,
        status: it.status,
      }));
      onConfirm([], videos);
    }
  }

  async function handleDirectUpload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isPhoto ? ["images"] : ["videos"],
      allowsMultipleSelection: isPhoto,
      quality: isPhoto ? 0.85 : 1,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    setError(null);
    const beforeIds = new Set(items.map(it => it.id));
    prevIdsRef.current = beforeIds;
    try {
      const form = new FormData();
      for (const asset of result.assets) {
        const uri = isPhoto
          ? await compressImageIfNeeded(asset.uri, asset.fileSize ?? undefined)
          : asset.uri;
        form.append(
          isPhoto ? "photos" : "video",
          { uri, name: asset.fileName || (isPhoto ? "photo.jpg" : "video.mp4"), type: asset.mimeType || (isPhoto ? "image/jpeg" : "video/mp4") } as any
        );
      }
      // class_id/student_id 없이 pool 전체 앨범(/photos/group)에 업로드 후 내 앨범에 저장
      const endpoint = isPhoto ? "/photos/group" : "/videos/group";
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((d as any)?.error ?? "업로드 실패");
      }
      // 업로드된 항목을 내 앨범(saved)에 등록
      if (isPhoto) {
        const photoIds: string[] = ((d as any).photos || []).map((p: any) => p.id).filter(Boolean);
        if (photoIds.length > 0) {
          await fetch(`${API_BASE}/photos/saved`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
            body: JSON.stringify({ photo_ids: photoIds }),
          }).catch(() => {});
        }
      } else {
        const videoId: string | undefined = (d as any).video?.id;
        if (videoId) {
          await fetch(`${API_BASE}/videos/saved`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
            body: JSON.stringify({ video_ids: [videoId] }),
          }).catch(() => {});
        }
      }
      // 목록 재로드 후 새 항목 자동 선택
      await loadList(undefined);
      // 재로드 후 새 항목 감지해서 선택
      const newRes = await fetch(`${API_BASE}/${isPhoto ? "photos" : "videos"}/teacher-all?scope=private`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      const newData = await newRes.json().catch(() => ({}));
      const key = isPhoto ? "photos" : "videos";
      const newRaw: RawItem[] = Array.isArray(newData[key]) ? newData[key] : [];
      setItems(newRaw);
      const newlyAdded = new Set(newRaw.map(r => r.id).filter(id => !beforeIds.has(id)));
      if (newlyAdded.size > 0) {
        setSelected(prev => {
          const next = new Set(prev);
          newlyAdded.forEach(id => next.add(id));
          return next;
        });
      }
    } catch (e: any) {
      setError(e?.message ?? "업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  }

  function handleFullAlbumSaved(count: number) {
    // 전체앨범에서 가져오기 완료 → 목록 재로드 + 새 항목 자동 선택
    setShowFullAlbum(false);
    const beforeIds = new Set(items.map(it => it.id));
    // 비동기로 재로드 + 새 항목 감지
    (async () => {
      try {
        const endpoint = isPhoto
          ? "/photos/teacher-all?scope=private"
          : "/videos/teacher-all?scope=private";
        const res = await fetch(`${API_BASE}${endpoint}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        const data = await res.json().catch(() => ({}));
        const key  = isPhoto ? "photos" : "videos";
        const newRaw: RawItem[] = Array.isArray(data[key]) ? data[key] : (Array.isArray(data) ? data : []);
        setItems(newRaw);
        const newlyAdded = new Set(newRaw.map(r => r.id).filter(id => !beforeIds.has(id)));
        if (newlyAdded.size > 0) {
          setSelected(prev => {
            const next = new Set(prev);
            newlyAdded.forEach(id => next.add(id));
            return next;
          });
        }
      } catch { /* 무시 */ }
    })();
  }

  const renderItem = ({ item }: { item: RawItem }) => {
    const uri = photoUri(item.presigned_url || item.thumbnail_presigned_url || item.file_url, token);
    const isSel = selected.has(item.id);
    return (
      <Pressable
        onPress={() => toggle(item.id)}
        style={[s.cell, { width: CELL, height: CELL }]}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: "100%", height: "100%", borderRadius: 4 }}
            contentFit="cover"
          />
        ) : (
          <View style={[s.cellEmpty, { backgroundColor: bgColor }]}>
            <LucideIcon name="video" size={20} color={color} />
          </View>
        )}
        {!isPhoto && (
          <View style={s.videoIcon}>
            <LucideIcon name="video" size={12} color="#fff" />
          </View>
        )}
        {isSel && (
          <View style={[s.checkOverlay, { backgroundColor: color + "CC" }]}>
            <LucideIcon name="check" size={22} color="#fff" />
          </View>
        )}
        <View style={[s.selBorder, { borderColor: isSel ? color : "transparent" }]} />
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[s.root, { paddingTop: insets.top }]}>
        {/* 헤더 */}
        <View style={s.header}>
          <Pressable onPress={onClose} style={s.headerClose} accessibilityRole="button">
            <LucideIcon name="x" size={22} color="#374151" />
          </Pressable>
          <Text style={s.headerTitle}>{title}</Text>
          <Pressable
            onPress={handleConfirm}
            disabled={selected.size === 0}
            style={[s.confirmBtn, { backgroundColor: color, opacity: selected.size === 0 ? 0.4 : 1 }]}
          >
            <Text style={s.confirmBtnText}>
              {selected.size > 0 ? `${selected.size}개 첨부` : "선택"}
            </Text>
          </Pressable>
        </View>

        {/* 액션 버튼 2개 */}
        <View style={s.actionRow}>
          <Pressable
            style={[s.actionBtn, { backgroundColor: bgColor, borderColor: color + "40" }]}
            onPress={() => setShowFullAlbum(true)}
          >
            <LucideIcon name="folder-search" size={15} color={color} />
            <Text style={[s.actionBtnText, { color }]}>전체앨범에서 가져오기</Text>
          </Pressable>
          <Pressable
            style={[s.actionBtn, { backgroundColor: bgColor, borderColor: color + "40" }]}
            onPress={handleDirectUpload}
            disabled={uploading}
          >
            {uploading
              ? <ActivityIndicator size="small" color={color} />
              : <><LucideIcon name="upload-cloud" size={15} color={color} /><Text style={[s.actionBtnText, { color }]}>직접 업로드</Text></>
            }
          </Pressable>
        </View>

        {/* 에러 */}
        {!!error && (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* 목록 */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={color} size="large" />
          </View>
        ) : items.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyText}>
              {isPhoto ? "내 사진앨범이 비어있습니다." : "내 영상앨범이 비어있습니다."}
            </Text>
            <Text style={s.emptyHint}>위 버튼으로 사진을 추가해보세요.</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={it => it.id}
            renderItem={renderItem}
            numColumns={3}
            columnWrapperStyle={{ gap: 2 }}
            contentContainerStyle={{ gap: 2, padding: 2 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* 전체앨범 피커 (내부) */}
      <FullAlbumPickerModal
        visible={showFullAlbum}
        mediaType={mediaType}
        token={token}
        onClose={() => setShowFullAlbum(false)}
        onSaved={handleFullAlbumSaved}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#fff" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  headerClose: { padding: 4 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Pretendard-SemiBold", color: "#1E293B" },
  confirmBtn:  { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  confirmBtnText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  actionRow:   { flexDirection: "row", gap: 8, padding: 12 },
  actionBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  actionBtnText: { fontSize: 13, fontFamily: "Pretendard-Medium" },
  errorBanner: { backgroundColor: "#FEF2F2", padding: 10, marginHorizontal: 12, borderRadius: 8 },
  errorText:   { color: "#DC2626", fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },
  center:      { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  emptyText:   { fontSize: 15, fontFamily: "Pretendard-Medium", color: "#64748B" },
  emptyHint:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  cell:        { position: "relative", margin: 1 },
  cellEmpty:   { flex: 1, justifyContent: "center", alignItems: "center", borderRadius: 4 },
  videoIcon:   { position: "absolute", bottom: 4, right: 4, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 4, padding: 2 },
  checkOverlay:{ position: "absolute", inset: 0, borderRadius: 4, justifyContent: "center", alignItems: "center" },
  selBorder:   { position: "absolute", inset: 0, borderRadius: 4, borderWidth: 2.5 },
});
