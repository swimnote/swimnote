/**
 * FullAlbumPickerModal.tsx
 *
 * 개인앨범 + 버튼 → 전체앨범에서 사진/영상 선택 → 개인앨범에 저장
 * 파일 업로드/복사 없음, R2 저장 없음, 참조(teacher_saved_photos/videos) 추가만 수행
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Dimensions, FlatList, Image, Modal,
  Pressable, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ImageIcon, Video, X } from "lucide-react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "/api");
const { width: W } = Dimensions.get("window");
const CELL = Math.floor((W - 4) / 3);

interface PhotoItem {
  id: string;
  file_url: string;
  created_at: string;
  class_name?: string;
  caption?: string;
}

interface Props {
  visible: boolean;
  mediaType: "photo" | "video";
  token: string | null;
  onClose: () => void;
  onSaved: (count: number) => void;
}

export function FullAlbumPickerModal({ visible, mediaType, token, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems]         = useState<PhotoItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [error, setError]         = useState<string | null>(null);

  const themeColor = mediaType === "photo" ? "#E4A93A" : "#7C3AED";
  const title      = mediaType === "photo" ? "전체앨범사진에서 선택" : "전체앨범영상에서 선택";

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const endpoint = mediaType === "photo"
        ? "/photos/teacher-all?scope=group"
        : "/videos/teacher-all?scope=group";
      const res = await fetch(`${API_BASE}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      const key = mediaType === "photo" ? "photos" : "videos";
      const raw: PhotoItem[] = Array.isArray(data[key]) ? data[key] : [];
      setItems(raw);
    } catch {
      setError("목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token, mediaType]);

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setError(null);
      load();
    }
  }, [visible, load]);

  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function handleSave() {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    try {
      const ids = Array.from(selected);
      const endpoint = mediaType === "photo" ? "/photos/saved" : "/videos/saved";
      const body = mediaType === "photo"
        ? { photo_ids: ids }
        : { video_ids: ids };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any)?.error ?? "저장 실패");
      }
      onSaved(ids.length);
    } catch (e: any) {
      setError(e?.message ?? "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function photoUri(url: string) {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    return `${API_BASE.replace("/api", "")}${url}`;
  }

  function fmtDate(ts: string) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    } catch { return ""; }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={[s.root, { paddingTop: insets.top }]}>
        {/* 헤더 */}
        <View style={s.header}>
          <Pressable onPress={onClose} style={s.headerClose} accessibilityRole="button">
            <X size={22} color="#374151" />
          </Pressable>
          <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
          <Pressable
            onPress={handleSave}
            disabled={selected.size === 0 || saving}
            style={[s.saveBtn, { backgroundColor: themeColor, opacity: selected.size === 0 ? 0.4 : 1 }]}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.saveBtnText}>{selected.size > 0 ? `${selected.size}개 저장` : "저장"}</Text>
            }
          </Pressable>
        </View>

        {/* 안내 배너 */}
        <View style={[s.banner, { backgroundColor: themeColor + "14" }]}>
          <Text style={[s.bannerText, { color: themeColor }]}>
            전체앨범에서 {mediaType === "photo" ? "사진" : "영상"}을 선택하면 개인앨범에 저장됩니다.
            파일 복사 없음 · 용량 소모 없음
          </Text>
        </View>

        {/* 에러 */}
        {!!error && (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* 콘텐츠 */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={themeColor} size="large" />
            <Text style={s.centerText}>불러오는 중…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={s.center}>
            {mediaType === "photo"
              ? <ImageIcon size={44} color="#D1D5DB" />
              : <Video size={44} color="#D1D5DB" />
            }
            <Text style={s.emptyTitle}>전체앨범에 {mediaType === "photo" ? "사진" : "영상"}이 없습니다</Text>
            <Text style={s.emptyText}>전체앨범 + 버튼으로 먼저 업로드하세요</Text>
          </View>
        ) : mediaType === "photo" ? (
          /* ── 사진: 3열 그리드 ── */
          <FlatList
            data={items}
            keyExtractor={item => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: 1, paddingBottom: insets.bottom + 80 }}
            columnWrapperStyle={{ gap: 1 }}
            renderItem={({ item }) => {
              const isSel = selected.has(item.id);
              const uri = photoUri(item.file_url);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={[
                    s.cell,
                    { width: CELL, height: CELL },
                    isSel && { borderWidth: 3, borderColor: themeColor },
                  ]}
                >
                  {uri ? (
                    <Image
                      source={{ uri, headers: { Authorization: `Bearer ${token ?? ""}` } }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={s.photoPlaceholder}>
                      <ImageIcon size={20} color="#D1D5DB" />
                    </View>
                  )}
                  {!!item.created_at && (
                    <View style={s.dateBadge}>
                      <Text style={s.dateBadgeText}>{fmtDate(item.created_at)}</Text>
                    </View>
                  )}
                  {isSel && (
                    <View style={[s.checkCircle, { backgroundColor: themeColor, borderColor: themeColor }]}>
                      <Check size={12} color="#fff" />
                    </View>
                  )}
                  {!isSel && <View style={s.checkCircleEmpty} />}
                </Pressable>
              );
            }}
          />
        ) : (
          /* ── 영상: 카드 리스트 ── */
          <FlatList
            data={items}
            keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 80 }}
            renderItem={({ item }) => {
              const isSel = selected.has(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  style={[
                    s.videoRow,
                    isSel && { borderWidth: 2, borderColor: themeColor },
                  ]}
                >
                  <View style={[s.videoThumb, { backgroundColor: themeColor + "1A" }]}>
                    <Video size={22} color={themeColor} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.videoLabel} numberOfLines={1}>
                      {item.caption || item.class_name || "영상"}
                    </Text>
                    <Text style={s.videoMeta}>{fmtDate(item.created_at)}</Text>
                  </View>
                  <View style={[
                    s.checkCircle,
                    isSel && { backgroundColor: themeColor, borderColor: themeColor },
                  ]}>
                    {isSel && <Check size={12} color="#fff" />}
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: "#F8FAFC" },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", gap: 8 },
  headerClose:  { padding: 6 },
  headerTitle:  { flex: 1, fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#1F2937" },
  saveBtn:      { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8 },
  saveBtnText:  { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  banner:       { marginHorizontal: 12, marginTop: 10, marginBottom: 2, padding: 10, borderRadius: 8 },
  bannerText:   { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 17 },
  errorBanner:  { margin: 12, padding: 10, backgroundColor: "#FEE2E2", borderRadius: 8 },
  errorText:    { fontSize: 13, color: "#DC2626", fontFamily: "Pretendard-Regular" },
  center:       { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  centerText:   { fontSize: 13, color: "#9CA3AF", fontFamily: "Pretendard-Regular" },
  emptyTitle:   { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#6B7280" },
  emptyText:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  cell:         { backgroundColor: "#E5E7EB", overflow: "hidden" },
  photoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  dateBadge:    { position: "absolute", bottom: 3, left: 3, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  dateBadgeText:{ fontSize: 10, color: "#fff", fontFamily: "Pretendard-Regular" },
  checkCircle:  { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(0,0,0,0.2)", alignItems: "center", justifyContent: "center" },
  checkCircleEmpty: { position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)", backgroundColor: "rgba(0,0,0,0.15)" },
  videoRow:     { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, padding: 12, gap: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  videoThumb:   { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  videoLabel:   { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#1F2937" },
  videoMeta:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
});
