/**
 * MyAlbumPickerModal.tsx
 *
 * 내 개인앨범(private/saved)에서 사진/영상을 선택하여 일지에 첨부.
 * 3가지 방법:
 *  1. 기존 저장된 항목 그리드에서 선택 → 선택 완료 → 일지 첨부
 *  2. 전체앨범에서 가져오기(FullAlbumPickerModal) → 내앨범 저장 + 자동 선택 → 일지 첨부
 *  3. 직접 업로드(갤러리 → R2 direct-upload 또는 /videos/group) → 내앨범 저장 + 자동 선택 → 일지 첨부
 *
 * Photo path: directUploadPhotos (R2), then POST /photos/saved, reload, auto-select by returned IDs.
 * Video path: unchanged FormData multipart to /videos/group (no class_id/lesson_date).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Dimensions, FlatList, Modal,
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import * as ImagePicker from "expo-image-picker";
import { getInfoAsync } from "expo-file-system/legacy";
import Colors from "@/constants/colors";
import { API_BASE } from "@/context/AuthContext";
import { compressImageIfNeeded } from "@/utils/compressImage";
import { directUploadPhotos, DirectUploadFile } from "@/utils/directUploadPhotos";
import { FullAlbumPickerModal } from "@/components/teacher/album/FullAlbumPickerModal";
import { AlbumPhotoInfo, AlbumVideoInfo } from "./types";

const C = Colors.light;
const { width: W } = Dimensions.get("window");
const CELL = Math.floor((W - 4) / 3);
const MAX_PHOTOS = 10;

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

/** Per-photo upload state used only while the upload modal is open */
interface PhotoUploadItem {
  clientId: string;
  uri: string;          // compressed URI
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploading: boolean;
  uploaded: boolean;
  progress: number;     // 0-100
  error?: string;
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

  // Per-photo upload progress items (photo path only)
  const [uploadItems, setUploadItems] = useState<PhotoUploadItem[]>([]);

  const isPhoto   = mediaType === "photo";
  const color     = isPhoto ? "#C2410C" : "#5B21B6";
  const bgColor   = isPhoto ? "#FFEDD5" : "#EDE9FE";
  const title     = isPhoto ? "내 사진앨범" : "내 영상앨범";

  const loadList = useCallback(async (autoSelectIds?: Set<string>) => {
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
      if (autoSelectIds && autoSelectIds.size > 0) {
        const found = raw.map(r => r.id).filter(id => autoSelectIds.has(id));
        if (found.length > 0) {
          setSelected(prev => {
            const next = new Set(prev);
            found.forEach(id => next.add(id));
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
      setUploadItems([]);
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

  // ── Shared photo compression helper ────────────────────────────────
  async function compressPhoto(asset: ImagePicker.ImagePickerAsset): Promise<{ compressedUri: string; fileName: string; mimeType: string; fileSize: number }> {
    const originalUri = asset.uri;
    const compressedUri = await compressImageIfNeeded(originalUri, asset.fileSize ?? undefined);
    // If compression produced a different file, force JPEG metadata
    const wasCompressed = compressedUri !== originalUri;
    const fileName = wasCompressed ? "photo.jpg" : (asset.fileName || "photo.jpg");
    const mimeType = wasCompressed ? "image/jpeg" : (asset.mimeType || "image/jpeg");
    // Measure actual byte size of the (possibly compressed) file
    let fileSize = asset.fileSize ?? 0;
    try {
      const info = await getInfoAsync(compressedUri);
      if (info.exists) fileSize = info.size;
    } catch {}
    return { compressedUri, fileName, mimeType, fileSize };
  }

  async function savePhotoIds(photoIds: string[]): Promise<void> {
    const response = await fetch(`${API_BASE}/photos/saved`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ photo_ids: photoIds }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "내 앨범 저장에 실패했습니다.");
    }
  }

  // ── PHOTO direct-upload via R2 ──────────────────────────────────────
  async function handleDirectUpload() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: isPhoto ? ["images"] : ["videos"],
      allowsMultipleSelection: isPhoto,
      selectionLimit: isPhoto ? MAX_PHOTOS : 1,
      quality: isPhoto ? 0.85 : 1,
    });
    if (result.canceled || !result.assets?.length) return;

    // ── VIDEO: unchanged FormData path ─────────────────────────────
    if (!isPhoto) {
      setUploading(true);
      setError(null);
      try {
        const asset = result.assets[0];
        const form = new FormData();
        form.append("video", { uri: asset.uri, name: asset.fileName || "video.mp4", type: asset.mimeType || "video/mp4" } as any);
        // No class_id / lesson_date – pool-wide saved album
        const res = await fetch(`${API_BASE}/videos/group`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token ?? ""}` },
          body: form,
        });
        const d = await res.json().catch(() => ({})) as any;
        if (!res.ok) throw new Error(d?.error ?? "업로드 실패");
        const videoId: string | undefined = d?.video?.id;
        if (videoId) {
          await fetch(`${API_BASE}/videos/saved`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" },
            body: JSON.stringify({ video_ids: [videoId] }),
          }).catch(() => {});
          const beforeIds = new Set(items.map(it => it.id));
          await loadList(undefined);
          // Auto-select newly added item
          setSelected(prev => {
            const next = new Set(prev);
            if (!beforeIds.has(videoId)) next.add(videoId);
            return next;
          });
        }
      } catch (e: any) {
        setError(e?.message ?? "업로드 중 오류가 발생했습니다.");
      } finally {
        setUploading(false);
      }
      return;
    }

    // ── PHOTO: direct-upload to R2 ─────────────────────────────────
    const assets = result.assets.slice(0, MAX_PHOTOS);
    if (result.assets.length > MAX_PHOTOS) {
      setError(`최대 ${MAX_PHOTOS}장까지 선택할 수 있습니다. 처음 ${MAX_PHOTOS}장만 업로드합니다.`);
    } else {
      setError(null);
    }

    setUploading(true);

    // Compress all assets first
    let compressedList: Array<{ asset: ImagePicker.ImagePickerAsset; compressedUri: string; fileName: string; mimeType: string; fileSize: number; clientId: string }> = [];
    try {
      for (const asset of assets) {
        const { compressedUri, fileName, mimeType, fileSize } = await compressPhoto(asset);
        const clientId = `myalbum_${Date.now().toString()}_${Math.random().toString(36).substr(2, 9)}`;
        compressedList.push({ asset, compressedUri, fileName, mimeType, fileSize, clientId });
      }
    } catch (e: any) {
      setError(e?.message ?? "압축 중 오류가 발생했습니다.");
      setUploading(false);
      return;
    }

    // Initialize per-item upload state
    const initialItems: PhotoUploadItem[] = compressedList.map(cf => ({
      clientId: cf.clientId,
      uri: cf.compressedUri,
      fileName: cf.fileName,
      mimeType: cf.mimeType,
      fileSize: cf.fileSize,
      uploading: true,
      uploaded: false,
      progress: 0,
    }));
    setUploadItems(initialItems);

    const directFiles: DirectUploadFile[] = compressedList.map(cf => ({
      clientId: cf.clientId,
      uri: cf.compressedUri,
      fileName: cf.fileName,
      mimeType: cf.mimeType,
      fileSize: cf.fileSize,
    }));

    let results: Awaited<ReturnType<typeof directUploadPhotos>> = [];
    try {
      results = await directUploadPhotos({
        token: token ?? "",
        albumType: "group",
        // No classId or lessonDate – pool-wide saved album session
        files: directFiles,
        onItemProgress: (clientId, progress) => {
          setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, progress } : it));
        },
        onItemDone: (clientId) => {
          setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, progress: 100 } : it));
        },
        onItemError: (clientId, err) => {
          setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, uploading: false, error: err } : it));
        },
      });
    } catch (e: any) {
      // Unexpected error from directUploadPhotos itself
      setError(e?.message ?? "업로드 중 오류가 발생했습니다.");
      setUploadItems(prev => prev.map(it => ({ ...it, uploading: false, error: it.error ?? "오류" })));
      setUploading(false);
      return;
    }

    // Apply final per-item states
    setUploadItems(prev => prev.map(it => {
      const r = results.find(res => res.clientId === it.clientId);
      if (!r) return it;
      if (r.error) return { ...it, uploading: false, uploaded: false, error: r.error };
      return { ...it, uploading: false, uploaded: true, progress: 100, error: undefined };
    }));

    // Collect IDs returned from finalize
    const successPhotoIds: string[] = results
      .filter(r => !r.error && r.photo?.id)
      .map(r => r.photo!.id);

    try {
      if (successPhotoIds.length > 0) {
        await savePhotoIds(successPhotoIds);
        // Reload list and auto-select by the known returned IDs
        await loadList(new Set(successPhotoIds));
      }

      const failCount = results.filter(r => !!r.error).length;
      if (failCount > 0 && successPhotoIds.length === 0) {
        setError(`업로드에 실패했습니다. 재시도 버튼으로 개별 항목을 다시 시도하세요.`);
      } else if (failCount > 0) {
        setError(`${failCount}개 업로드 실패. 재시도 버튼으로 개별 항목을 다시 시도하세요.`);
      }
    } catch (e: any) {
      setError(e?.message ?? "내 앨범 저장 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  }

  // ── Per-item retry (photo) ──────────────────────────────────────────
  async function retryPhotoItem(clientId: string) {
    const item = uploadItems.find(it => it.clientId === clientId);
    if (!item) return;

    // Reset item to uploading state
    setUploadItems(prev => prev.map(it =>
      it.clientId === clientId ? { ...it, uploading: true, uploaded: false, error: undefined, progress: 0 } : it
    ));

    let results: Awaited<ReturnType<typeof directUploadPhotos>> = [];
    try {
      results = await directUploadPhotos({
        token: token ?? "",
        albumType: "group",
        files: [{ clientId: item.clientId, uri: item.uri, fileName: item.fileName, mimeType: item.mimeType, fileSize: item.fileSize }],
        onItemProgress: (_id, progress) => {
          setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, progress } : it));
        },
        onItemError: (_id, err) => {
          setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, uploading: false, error: err } : it));
        },
      });
    } catch (e: any) {
      setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, uploading: false, error: e?.message ?? "오류" } : it));
      return;
    }

    const r = results[0];
    if (!r) {
      setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, uploading: false, error: "업로드 결과를 확인할 수 없습니다." } : it));
      return;
    }

    if (r.error) {
      setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, uploading: false, uploaded: false, error: r.error } : it));
      return;
    }

    // Success: apply state, save and select
    setUploadItems(prev => prev.map(it => it.clientId === clientId ? { ...it, uploading: false, uploaded: true, progress: 100, error: undefined } : it));

    if (r.photo?.id) {
      try {
        await savePhotoIds([r.photo.id]);
        await loadList(new Set([r.photo.id]));
      } catch (e: any) {
        setError(e?.message ?? "내 앨범 저장 중 오류가 발생했습니다.");
      }
    }
  }

  function handleFullAlbumSaved(count: number) {
    setShowFullAlbum(false);
    const beforeIds = new Set(items.map(it => it.id));
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

  // ── Per-item upload progress strip (photo only) ─────────────────────
  const hasUploadItems = isPhoto && uploadItems.length > 0;
  const anyUploading   = uploadItems.some(it => it.uploading);

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
            {uploading && !hasUploadItems
              ? <ActivityIndicator size="small" color={color} />
              : <><LucideIcon name="upload-cloud" size={15} color={color} /><Text style={[s.actionBtnText, { color }]}>직접 업로드</Text></>
            }
          </Pressable>
        </View>

        {/* 에러 배너 */}
        {!!error && (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* 업로드 중 항목 진행률 (photo only) */}
        {hasUploadItems && (
          <View style={s.uploadStrip}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.uploadStripContent}>
              {uploadItems.map(it => (
                <View key={it.clientId} style={s.uploadChip}>
                  {it.uploading ? (
                    <>
                      <ActivityIndicator size="small" color={color} />
                      <Text style={[s.uploadChipText, { color }]}>{it.progress}%</Text>
                    </>
                  ) : it.error ? (
                    <>
                      <LucideIcon name="alert-circle" size={14} color="#DC2626" />
                      <Text style={s.uploadChipError} numberOfLines={1}>실패</Text>
                      <Pressable onPress={() => retryPhotoItem(it.clientId)} hitSlop={6}>
                        <Text style={[s.uploadChipRetry, { color }]}>재시도</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <LucideIcon name="check-circle" size={14} color="#16A34A" />
                      <Text style={s.uploadChipDone}>완료</Text>
                    </>
                  )}
                </View>
              ))}
            </ScrollView>
            {anyUploading && (
              <ActivityIndicator size="small" color={color} style={{ marginRight: 8 }} />
            )}
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
  errorBanner: { backgroundColor: "#FEF2F2", padding: 10, marginHorizontal: 12, borderRadius: 8, marginBottom: 4 },
  errorText:   { color: "#DC2626", fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },
  uploadStrip: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingVertical: 6 },
  uploadStripContent: { paddingHorizontal: 12, gap: 8 },
  uploadChip:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: "#E2E8F0" },
  uploadChipText:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  uploadChipError: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#DC2626" },
  uploadChipDone:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  uploadChipRetry: { fontSize: 11, fontFamily: "Pretendard-Regular", textDecorationLine: "underline" },
  center:      { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  emptyText:   { fontSize: 15, fontFamily: "Pretendard-Medium", color: "#64748B" },
  emptyHint:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  cell:        { position: "relative", margin: 1 },
  cellEmpty:   { flex: 1, justifyContent: "center", alignItems: "center", borderRadius: 4 },
  videoIcon:   { position: "absolute", bottom: 4, right: 4, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 4, padding: 2 },
  checkOverlay:{ position: "absolute", inset: 0, borderRadius: 4, justifyContent: "center", alignItems: "center" },
  selBorder:   { position: "absolute", inset: 0, borderRadius: 4, borderWidth: 2.5 },
});
