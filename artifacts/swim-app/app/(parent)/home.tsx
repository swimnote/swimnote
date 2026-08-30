/**
 * 학부모 홈 — 수업일지 피드
 *
 * 구조: 단일 FlatList
 *   ListHeaderComponent
 *     A. Slim Header (수영장명 · 알림 · 설정)
 *     B. 자녀 선택 탭
 *     C. 학생 정보 한 줄 (이름 · 요일시간 | 앨범 보기 >)
 *     D. 공지 배너 (ParentPromoStrip)
 *   FlatList data = DiaryEntry[]
 *     각 일지: 날짜 · 선생님 · 본문 · 개별메모 · 사진 · 영상 · 반응
 */
import { ParentPromoStrip } from "@/components/parent/ParentPromoStrip";
import { GrowthReportFeedCard } from "@/components/parent/GrowthReportFeedCard";
import { ParentAdBanner } from "@/components/parent/ParentAdBanner";
import { AIFeatureModal, AIModalType } from "@/components/parent/AIFeatureModal";
import StoryCapturePipeline, { StoryInput } from "@/components/parent/StoryCapturePipeline";
import { StoryPhoto } from "@/components/parent/StoryPageRenderer";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
  useWindowDimensions,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import { useMode } from "@/context/ModeContext";
import { X as XT, isXMode } from "@/constants/xTheme";
import CurriculumProgressGauge, { CurriculumProgressData } from "@/components/CurriculumProgressGauge";
import { type LevelDef } from "@/components/common/LevelBadge";

const C = Colors.light;
const TEAL = C.brandStrong;
const NAVY = "#1B3A70";   // 네이비 기본색 (버튼 fill, 선택된 탭)
const IB = C.brandMist;

// ── 타입 ──────────────────────────────────────────────────────────────────
interface DiaryEntry {
  id: string;
  lesson_date: string;
  common_content: string;
  teacher_name: string;
  class_group_id?: string | null;
  class_group_name?: string | null;
  is_edited: boolean;
  created_at: string;
  student_note?: { id: string; note_content: string; is_edited: boolean } | null;
  reactions?: string[];
}

// GR6: PUBLISHED 성장리포트 Feed Item (spec §8)
interface GrowthReportFeedItem {
  type: "GROWTH_REPORT";
  id: string;                  // stable projection id: "gr_feed_<reportId>"
  growth_report_id: string;    // GR8에서 상세화면 연결용 (spec §17)
  student_id: string;
  report_period: string;       // "YYYY-MM"
  published_at: string;
  created_at: string;
  title: string;               // e.g. "7월 성장리포트"
  preview: {
    summary_text?: string;
    headline?: string;
    key_points?: string[];
  };
  share_safe: boolean;         // SNS share metadata (spec §16, GR9에서 구현)
}

type FeedItem = DiaryEntry | GrowthReportFeedItem;

interface PhotoItem {
  id: string;
  file_url: string;
  caption?: string | null;
}

interface PoolResult {
  id: string;
  name: string;
  address?: string | null;
}

// ── 유틸 ────────────────────────────────────────────────────────────────────
function formatSchedule(
  cg: { schedule_days?: string; schedule_time?: string } | null | undefined,
): string {
  if (!cg) return "";
  const days = (cg.schedule_days ?? "").trim().replace(/요일/g, "");
  const time = (cg.schedule_time ?? "").trim();
  const shortTime = time.length >= 5 ? time.slice(0, 5) : time;
  if (days && shortTime) return `${days} ${shortTime}`;
  return days || shortTime;
}

function parseLessonDate(dateStr: string) {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const wd = ["일", "월", "화", "수", "목", "금", "토"];
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: wd[d.getDay()],
  };
}

function buildPhotoUri(fileUrl: string): string {
  const base = API_BASE.replace(/\/api$/, "");
  if (fileUrl.startsWith("http")) return fileUrl;
  if (fileUrl.startsWith("/api")) return `${base}${fileUrl}`;
  return `${API_BASE}${fileUrl}`;
}

// ── Instagram Story テキスト fit 판정 ──────────────────────────────────────
// StoryPageRenderer 레이아웃 기준:
//   contentArea inner height = 434px (640-48-130-28), TEXT_LINE_H = 20px
//   사진 행 높이: 1장=220 / 2장=160 / 3~4장=2×105+4 / 5~6장=2×92+4 /
//                7~8장=2×80+4 / 9~10장=2×70+4
// V3: fontSize 14, lineHeight 22, Korean Pretendard-Medium, width≈320px → ~23자/행
const _STORY_CPL = 23;

// V3: 50~90자 한줄평 목표 → 약 4줄 (사진 수 무관)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function storyMaxLines(_photoCount: number): number {
  return 4;
}

function _storyEstimateLines(text: string): number {
  if (!text.trim()) return 0;
  return text.split("\n").reduce((acc, line) =>
    acc + Math.max(1, Math.ceil((line.length || 0.1) / _STORY_CPL)), 0);
}

function storyTextFits(text: string, photoCount: number): boolean {
  return _storyEstimateLines(text) <= storyMaxLines(photoCount);
}

// AsyncStorage 캐시 (diaryId + content hash → summary)
const _STORY_CACHE = "@sn:story_summary_";
function _storyHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
// cache hit 조건: hash 일치 AND maxLines 일치 AND maxChars 일치 AND 현재 layout에 fit
// → 넷 중 하나라도 불일치하면 miss → 재생성
async function getStorySummaryCache(
  id: string, body: string, maxLines: number, maxChars: number, photoCount: number,
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(_STORY_CACHE + id);
    if (!raw) return null;
    const c = JSON.parse(raw) as { hash: string; maxLines: number; maxChars: number; summary: string };
    if (c.hash !== _storyHash(body)) return null;           // 원문 변경
    if (c.maxLines !== maxLines) return null;               // 사진 수 변경 (CASE 9)
    if (c.maxChars !== maxChars) return null;               // 글자 수 기준 변경
    if (!storyTextFits(c.summary, photoCount)) return null; // layout 변경 (CASE 10)
    return c.summary;
  } catch { return null; }
}
async function setStorySummaryCache(
  id: string, body: string, maxLines: number, maxChars: number, summary: string,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      _STORY_CACHE + id,
      JSON.stringify({ hash: _storyHash(body), maxLines, maxChars, summary }),
    );
  } catch {}
}

// ── PoolSelectModal ────────────────────────────────────────────────────────
function PoolSelectModal({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (p: PoolResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [pools, setPools] = useState<PoolResult[]>([]);
  const [allPools, setAllPools] = useState<PoolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setPools([]);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/pools/public-search`)
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(data => {
        const list: PoolResult[] = Array.isArray(data)
          ? data
          : Array.isArray(data.data)
            ? data.data
            : [];
        setAllPools(list);
        setPools(list);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 300);
      });
  }, [visible]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    setPools(
      !q
        ? allPools
        : allPools.filter(
            p =>
              p.name.toLowerCase().includes(q) ||
              (p.address ?? "").toLowerCase().includes(q),
          ),
    );
  }, [query, allPools]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
        onPress={onClose}
      />
      <View
        style={{
          backgroundColor: "#fff",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: "80%",
          paddingBottom: insets.bottom + 16,
        }}
      >
        <View
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: "#E0E0E0",
            alignSelf: "center",
            marginTop: 10,
            marginBottom: 6,
          }}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingVertical: 12,
          }}
        >
          <Text style={{ fontSize: 17, fontFamily: "Pretendard-Bold", color: "#111" }}>
            수영장 선택
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <LucideIcon name="x" size={20} color="#999" />
          </Pressable>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: C.backgroundSoft,
            borderRadius: 12,
            marginHorizontal: 20,
            marginBottom: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 8,
          }}
        >
          <LucideIcon name="search" size={16} color="#999" />
          <TextInput
            ref={inputRef}
            style={{ flex: 1, fontSize: 15, color: "#111", fontFamily: "Pretendard-Regular" }}
            placeholder="수영장 이름 검색"
            placeholderTextColor="#bbb"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <LucideIcon name="x" size={14} color="#bbb" />
            </Pressable>
          )}
        </View>
        {loading ? (
          <View style={{ padding: 32, alignItems: "center" }}>
            <ActivityIndicator color={TEAL} />
          </View>
        ) : (
          <FlatList
            data={pools}
            keyExtractor={p => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text
                style={{
                  textAlign: "center",
                  color: "#999",
                  marginTop: 24,
                  fontFamily: "Pretendard-Regular",
                }}
              >
                검색 결과가 없습니다.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  gap: 12,
                  backgroundColor: pressed ? C.brandMist : "#fff",
                })}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: IB,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <LucideIcon name="building-2" size={18} color={TEAL} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 15,
                      fontFamily: "Pretendard-SemiBold",
                      color: "#111",
                    }}
                  >
                    {item.name}
                  </Text>
                  {item.address ? (
                    <Text
                      style={{
                        fontSize: 12,
                        color: "#999",
                        fontFamily: "Pretendard-Regular",
                      }}
                    >
                      {item.address}
                    </Text>
                  ) : null}
                </View>
                <LucideIcon name="chevron-right" size={16} color="#ccc" />
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

// ── 사진 2열 그리드 + 전체화면 뷰어 (저장 지원) ─────────────────────────────
function PhotosGrid({
  photos,
  token,
  diaryId,
  diaryDate,
  teacherName,
}: {
  photos: PhotoItem[];
  token: string | null;
  diaryId: string;
  diaryDate: string;
  teacherName: string;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // 중복 제거 (ID 기준)
  const uniquePhotos = useMemo(() => {
    const seen = new Set<string>();
    return photos.filter(p => {
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [photos]);

  // 뷰어 상태
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const flatRef = useRef<FlatList<PhotoItem>>(null);
  const mountedRef = useRef(true);

  // 저장 상태
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  if (!uniquePhotos.length) return null;

  const gap = 4;
  const hPad = 40;
  const imgSize = Math.floor((width - hPad - gap) / 2);

  function openViewer(index: number) {
    setCurrentIdx(index);
    setSaving(false);
    setSavingAll(false);
    setSaveProgress(0);
    setViewerOpen(true);
  }

  function closeViewer() {
    setViewerOpen(false);
    setCurrentIdx(0);
    setSaving(false);
    setSavingAll(false);
    setSaveProgress(0);
  }

  // 현재 사진 1장 저장
  async function saveCurrentPhoto() {
    if (saving || savingAll) return;
    const photo = uniquePhotos[currentIdx];
    if (!photo?.file_url) {
      Alert.alert("오류", "사진 정보를 찾을 수 없습니다.");
      return;
    }
    setSaving(true);
    const dateStr = diaryDate.replace(/-/g, "").slice(0, 8);
    const safeId = diaryId.slice(0, 8);
    const _rawUrl1 = buildPhotoUri(photo.file_url);
    const _rawSeg1 = _rawUrl1.split("?")[0].split("/").pop() ?? "";
    const _dot1 = _rawSeg1.lastIndexOf(".");
    const ext1 = (_dot1 >= 0 && _rawSeg1.slice(_dot1 + 1).length <= 5) ? _rawSeg1.slice(_dot1 + 1).toLowerCase() : "jpg";
    const localUri = `${FileSystem.documentDirectory ?? ""}swimnote_${dateStr}_${safeId}_${String(currentIdx + 1).padStart(2, "0")}.${ext1}`;
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("권한 필요", "사진 저장을 위해 사진 접근 권한이 필요합니다.\n설정에서 사진 접근 권한을 허용해 주세요.");
        return;
      }
      const url = buildPhotoUri(photo.file_url);
      const dl = await FileSystem.downloadAsync(url, localUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dl.status !== 200) throw new Error("다운로드 실패");
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      FileSystem.deleteAsync(dl.uri, { idempotent: true }).catch(() => {});
      if (!mountedRef.current) return;
      if (Platform.OS === "android") {
        ToastAndroid.show("사진이 저장되었습니다.", ToastAndroid.SHORT);
      } else {
        Alert.alert("저장 완료", "사진이 저장되었습니다.");
      }
    } catch {
      FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      if (mountedRef.current) Alert.alert("저장 실패", "사진을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  // 이 수업 사진 모두 저장 (확인창 → 순차 저장 → 결과)
  async function saveAllPhotos() {
    if (saving || savingAll || uniquePhotos.length === 0) return;
    Alert.alert(
      "이 수업 사진 모두 저장",
      `${diaryDate.replace(/-/g, ".")} 수업 사진\n총 ${uniquePhotos.length}장을 휴대폰 사진첩에 저장하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "저장",
          onPress: async () => {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== "granted") {
              Alert.alert("권한 필요", "사진 저장을 위해 사진 접근 권한이 필요합니다.\n설정에서 사진 접근 권한을 허용해 주세요.");
              return;
            }
            if (!mountedRef.current) return;
            setSavingAll(true);
            setSaveProgress(0);
            const total = uniquePhotos.length;
            const dateStr = diaryDate.replace(/-/g, "").slice(0, 8);
            const safeId = diaryId.slice(0, 8);
            let successCount = 0;
            let failedCount = 0;
            for (let i = 0; i < total; i++) {
              const photo = uniquePhotos[i];
              const _rawUrl2 = buildPhotoUri(photo.file_url);
              const _rawSeg2 = _rawUrl2.split("?")[0].split("/").pop() ?? "";
              const _dot2 = _rawSeg2.lastIndexOf(".");
              const _ext2 = (_dot2 >= 0 && _rawSeg2.slice(_dot2 + 1).length <= 5) ? _rawSeg2.slice(_dot2 + 1).toLowerCase() : "jpg";
              const localUri = `${FileSystem.documentDirectory ?? ""}swimnote_${dateStr}_${safeId}_${String(i + 1).padStart(2, "0")}.${_ext2}`;
              try {
                if (!photo?.file_url) throw new Error("URL 없음");
                const url = buildPhotoUri(photo.file_url);
                const dl = await FileSystem.downloadAsync(url, localUri, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (dl.status !== 200) throw new Error("다운로드 실패");
                await MediaLibrary.saveToLibraryAsync(dl.uri);
                FileSystem.deleteAsync(dl.uri, { idempotent: true }).catch(() => {});
                successCount++;
              } catch {
                failedCount++;
                FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
              }
              if (mountedRef.current) setSaveProgress(i + 1);
            }
            if (!mountedRef.current) return;
            setSavingAll(false);
            if (failedCount === 0) {
              Alert.alert("저장 완료", `사진 ${successCount}장이 저장되었습니다.`);
            } else if (successCount === 0) {
              Alert.alert("저장 실패", "사진을 저장하지 못했습니다. 다시 시도해 주세요.");
            } else {
              Alert.alert(
                "일부 저장 완료",
                `사진 ${total}장 중 ${successCount}장이 저장되었습니다.\n${failedCount}장은 저장하지 못했습니다.`,
              );
            }
          },
        },
      ],
    );
  }

  // FlatList 렌더 아이템
  const renderViewerItem = useCallback(
    ({ item, index }: { item: PhotoItem; index: number }) => (
      <View
        style={{ width, justifyContent: "center", alignItems: "center", flex: 1 }}
        accessibilityLabel={`사진 ${index + 1}`}
      >
        <ExpoImage
          source={{
            uri: buildPhotoUri(item.file_url),
            headers: { Authorization: `Bearer ${token}` },
          }}
          style={{ width, height: width }}
          contentFit="contain"
          cachePolicy="memory"
        />
      </View>
    ),
    [token, width],
  );

  const getViewerItemLayout = useCallback(
    (_: ArrayLike<PhotoItem> | null | undefined, index: number) => ({
      length: width,
      offset: width * index,
      index,
    }),
    [width],
  );

  return (
    <>
      {/* 2열 그리드 */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap, marginTop: 12 }}>
        {uniquePhotos.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={() => openViewer(i)}
            accessibilityLabel="사진 크게 보기"
          >
            <ExpoImage
              source={{
                uri: buildPhotoUri(p.file_url),
                headers: { Authorization: `Bearer ${token}` },
              }}
              style={{ width: imgSize, height: imgSize, borderRadius: 8 }}
              contentFit="cover"
              transition={200}
              cachePolicy="memory"
            />
          </Pressable>
        ))}
      </View>

      {/* 전체화면 뷰어 Modal */}
      {viewerOpen && (
        <Modal
          visible
          transparent={false}
          statusBarTranslucent
          animationType="fade"
          onRequestClose={closeViewer}
        >
          <View style={{ flex: 1, backgroundColor: XT.primary }}>
            {/* 상단: N/M + 닫기 */}
            <View
              style={{
                position: "absolute",
                top: insets.top + 12,
                left: 0,
                right: 0,
                zIndex: 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 20,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontFamily: "Pretendard-Regular" }}>
                {currentIdx + 1} / {uniquePhotos.length}
              </Text>
              <Pressable
                onPress={closeViewer}
                style={{ position: "absolute", right: 20 }}
                hitSlop={16}
                accessibilityLabel="사진 뷰어 닫기"
              >
                <LucideIcon name="x" size={26} color="#fff" />
              </Pressable>
            </View>

            {/* 중앙: 수평 FlatList 스와이프 */}
            <FlatList
              ref={flatRef}
              data={uniquePhotos}
              renderItem={renderViewerItem}
              getItemLayout={getViewerItemLayout}
              keyExtractor={p => p.id}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={currentIdx}
              onMomentumScrollEnd={e => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / width);
                if (mountedRef.current)
                  setCurrentIdx(Math.max(0, Math.min(idx, uniquePhotos.length - 1)));
              }}
              style={{ flex: 1 }}
              bounces={false}
              decelerationRate="fast"
            />

            {/* 날짜 · 선생님 */}
            <View style={{ alignItems: "center", paddingBottom: 8, paddingTop: 4 }}>
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Pretendard-Regular" }}>
                {diaryDate.replace(/-/g, ".")}
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 3 }}>
                {teacherName} 선생님
              </Text>
            </View>

            {/* 하단: 저장 버튼 */}
            <View
              style={{
                paddingBottom: insets.bottom + 16,
                paddingHorizontal: 16,
                paddingTop: 6,
                flexDirection: "row",
                gap: 10,
              }}
            >
              <Pressable
                onPress={saveCurrentPhoto}
                disabled={saving || savingAll}
                accessibilityLabel="현재 사진 저장"
                style={{
                  flex: 1,
                  backgroundColor: "rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  paddingVertical: 13,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.22)",
                  opacity: saving || savingAll ? 0.5 : 1,
                }}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" }}>
                  {saving ? "저장 중..." : "현재 사진 저장"}
                </Text>
              </Pressable>

              {uniquePhotos.length >= 2 && (
                <Pressable
                  onPress={saveAllPhotos}
                  disabled={saving || savingAll}
                  accessibilityLabel="이 수업 사진 모두 저장"
                  style={{
                    flex: 1.6,
                    backgroundColor: savingAll ? "#555" : NAVY,
                    borderRadius: 10,
                    paddingVertical: 13,
                    alignItems: "center",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 14, fontFamily: "Pretendard-Regular" }}>
                    {savingAll
                      ? `${saveProgress} / ${uniquePhotos.length} 저장 중...`
                      : "이 수업 사진 모두 저장"}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

// ── 개별 일지 피드 아이템 ──────────────────────────────────────────────────
// GrowthReportFeedCard는 components/parent/GrowthReportFeedCard.tsx에서 import

function DiaryFeedItem({
  entry,
  studentId,
  studentName,
}: {
  entry: DiaryEntry;
  studentId: string;
  studentName: string;
}) {
  const { token, parentAccount, parentPoolName, pool } = useAuth();
  // 수영장 이름 — Story footer에 사용 (하드코딩 금지)
  const poolName = parentPoolName || (parentAccount as any)?.pool_name || pool?.name || "";
  const [myReactions, setMyReactions] = useState<Set<string>>(
    new Set(entry.reactions ?? []),
  );
  const [photos, setPhotos] = useState<{
    common: PhotoItem[];
    individual: PhotoItem[];
  } | null>(null);
  const [videoCount, setVideoCount] = useState<number | null>(null);
  const loadedRef = useRef(false);
  // ── Instagram Story 공유 ──
  const [sharing,   setSharing]   = useState(false);
  const [preparing, setPreparing] = useState(false);
  const sharingRef         = useRef(false);
  const resolvedBodyRef    = useRef<string | null>(null);
  const enrichedPhotosRef  = useRef<StoryPhoto[] | null>(null);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    apiRequest(token, `/parent/diary/${entry.id}/reactions`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.myReactions) setMyReactions(new Set(d.myReactions));
      })
      .catch(() => {});

    apiRequest(token, `/parent/diary/${entry.id}/photos`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d) setPhotos({ common: d.common ?? [], individual: d.individual ?? [] });
        else setPhotos({ common: [], individual: [] });
      })
      .catch(() => setPhotos({ common: [], individual: [] }));

    fetch(`${API_BASE}/videos/diary/${entry.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : { videos: [] }))
      .then(d => setVideoCount((d.videos ?? []).length))
      .catch(() => setVideoCount(0));
  }, []);

  async function toggleReaction(type: "like" | "thanks") {
    const res = await apiRequest(token, `/parent/diary/${entry.id}/reactions`, {
      method: "POST",
      body: JSON.stringify({ reaction_type: type }),
    });
    if (res.ok) {
      const data = await res.json();
      setMyReactions(prev => {
        const s = new Set(prev);
        data.active ? s.add(type) : s.delete(type);
        return s;
      });
    }
  }

  function goToComments() {
    router.push({
      pathname: "/(parent)/diary-comments" as any,
      params: {
        diaryId: entry.id,
        diaryDate: entry.lesson_date,
        teacherName: entry.teacher_name,
        studentId,
        studentName,
      },
    });
  }

  const { year, month, day, weekday } = parseLessonDate(entry.lesson_date);
  const isCurrentYear = year === new Date().getFullYear();
  const allPhotos = [...(photos?.common ?? []), ...(photos?.individual ?? [])];

  // Instagram Story 공유 입력 구성
  const storyInput: StoryInput = {
    entryId:        entry.id,
    lessonDate:     entry.lesson_date,
    teacherName:    entry.teacher_name,
    classGroupName: entry.class_group_name,
    poolName,   // useAuth()에서 확보한 수영장 이름 (footer에 표시)
    bodyText: [
      entry.common_content?.trim(),
      entry.student_note?.note_content?.trim(),
    ].filter(Boolean).join("\n\n"),
    photos: allPhotos.map(p => ({ id: p.id, uri: buildPhotoUri(p.file_url) })),
  };

  async function handleInstagramShare() {
    if (sharingRef.current) return;

    // 진단 상태 (본문/summary 문자열 자체는 절대 로그 금지)
    let _stage = "A";
    let _photoCount = 0;
    let _maxLines = 0;
    let _maxChars = 0;
    let _sum1Chars = 0;
    let _sum1Est = 0;
    let _sum1Fit: boolean | null = null;
    let _sum2Chars = 0;
    let _sum2Est = 0;
    let _sum2Fit: boolean | null = null;
    let _cacheHit: boolean | null = null;
    let _req1Http = 0;
    let _req2Http = 0;
    const _diaryMask = entry.id.slice(-6); // ID 마지막 6자만

    // A: Instagram 설치 여부
    const canOpen = await Linking.canOpenURL("instagram://");
    if (!canOpen) {
      Alert.alert("Instagram 앱이 설치되어 있지 않습니다.");
      return;
    }
    sharingRef.current = true;
    resolvedBodyRef.current = null;

    // ② bodyText가 Story 텍스트 영역을 초과하면 AI 요약 호출
    _photoCount = allPhotos.length;
    const bodyText = storyInput.bodyText;

    // B: original storyTextFits
    _stage = "B";
    if (!storyTextFits(bodyText, _photoCount)) {
      setPreparing(true);
      try {
        _maxLines = storyMaxLines(_photoCount); // V3: 항상 4
        _maxChars = 90; // V3: 50~90자 한줄평 목표

        // C: cache lookup
        _stage = "C";
        const cached = await getStorySummaryCache(entry.id, bodyText, _maxLines, _maxChars, _photoCount);
        _cacheHit = cached !== null;

        if (cached) {
          resolvedBodyRef.current = cached;
        } else {
          // API 요청 헬퍼 — HTTP status를 진단 변수에 기록
          const callSummaryAPI = async (
            ml: number, mc: number, reqNum: 1 | 2,
          ): Promise<string> => {
            const r = await apiRequest(token, `/diaries/${entry.id}/story-summary`, {
              method: "POST",
              body: JSON.stringify({ max_lines: ml, max_chars: mc }),
            });
            if (reqNum === 1) _req1Http = r.status;
            else              _req2Http = r.status;
            if (!r.ok) throw new Error(`summary_api:${r.status}`);
            const d = await r.json();
            if (!d.summary) throw new Error("empty_summary");
            return d.summary as string;
          };

          // D: summary request #1 start
          _stage = "D";
          // E: summary response #1 (status captured inside callSummaryAPI)
          _stage = "E";
          let summary = await callSummaryAPI(_maxLines, _maxChars, 1);
          // F: summary #1 received
          _stage = "F";
          _sum1Chars = summary.length;
          _sum1Est = _storyEstimateLines(summary);

          // G: summary #1 client fit
          _stage = "G";
          _sum1Fit = storyTextFits(summary, _photoCount);

          if (!_sum1Fit) {
            const retryMaxLines = Math.max(3, _maxLines - 2);
            const retryMaxChars = Math.floor(_maxChars * 0.85);

            // H: summary request #2 start
            _stage = "H";
            // I: summary response #2 (status captured inside callSummaryAPI)
            _stage = "I";
            summary = await callSummaryAPI(retryMaxLines, retryMaxChars, 2);
            // J: summary #2 received
            _stage = "J";
            _sum2Chars = summary.length;
            _sum2Est = _storyEstimateLines(summary);

            // K: summary #2 client fit
            _stage = "K";
            _sum2Fit = storyTextFits(summary, _photoCount);
            if (!_sum2Fit) throw new Error("summary_too_long");

            await setStorySummaryCache(entry.id, bodyText, retryMaxLines, retryMaxChars, summary);
          } else {
            await setStorySummaryCache(entry.id, bodyText, _maxLines, _maxChars, summary);
          }

          resolvedBodyRef.current = summary;
        }
      } catch (err: unknown) {
        const errorCode = err instanceof Error ? err.message : String(err);
        // 진단 로그 — 개인정보/본문/JWT 없음
        Alert.alert(
          "[StoryShare] FAILED",
          `stage=${_stage} err=${errorCode}\n` +
          `diary=...${_diaryMask}\n` +
          `photos=${_photoCount} maxL=${_maxLines} maxC=${_maxChars}\n` +
          `cache=${_cacheHit}\n` +
          `req1=${_req1Http} s1c=${_sum1Chars} s1e=${_sum1Est} s1f=${_sum1Fit}\n` +
          `req2=${_req2Http} s2c=${_sum2Chars} s2e=${_sum2Est} s2f=${_sum2Fit}`,
        );
        sharingRef.current = false;
        setPreparing(false);
        return;
      }
      setPreparing(false);
    }

    // L: finalText fit
    _stage = "L";
    const finalText = resolvedBodyRef.current ?? bodyText;
    const finalEst  = _storyEstimateLines(finalText);
    const finalFit  = storyTextFits(finalText, _photoCount);
    if (!finalFit) {
      Alert.alert(
        "[StoryShare] FINAL_FIT_FAIL",
        `stage=${_stage} diary=...${_diaryMask}\n` +
        `photos=${_photoCount} maxL=${_maxLines} maxC=${_maxChars}\n` +
        `finalEst=${finalEst} finalFit=${finalFit}`,
      );
      sharingRef.current = false;
      return;
    }

    // N: 5~10장 Adaptive Collage용 aspectRatio 사전 조회
    //    Promise.allSettled — 한 장 실패해도 전체 공유 계속
    _stage = "N";
    if (allPhotos.length >= 5) {
      const arResults = await Promise.allSettled(
        allPhotos.slice(0, 10).map(
          p => new Promise<StoryPhoto>(resolve => {
            const uri = buildPhotoUri(p.file_url);
            Image.getSize(
              uri,
              (w, h) => resolve({ id: p.id, uri, width: w, height: h, aspectRatio: h > 0 ? w / h : 1 }),
              ()      => resolve({ id: p.id, uri, aspectRatio: 1 }),
            );
          }),
        ),
      );
      enrichedPhotosRef.current = arResults.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : { id: allPhotos[i].id, uri: buildPhotoUri(allPhotos[i].file_url), aspectRatio: 1 },
      );
    } else {
      enrichedPhotosRef.current = null;
    }

    // M: setSharing(true)
    _stage = "M";
    setSharing(true);
  }

  return (
    <View style={f.item}>
      <View style={f.meta}>
        <Text style={[f.dateText, { color: C.text }]}>
          {!isCurrentYear && `${year}년 `}
          {month}월 {day}일 {weekday}요일
        </Text>
        <Text style={[f.teacherText, { color: C.textSecondary }]}>
          {entry.teacher_name} 선생님
          {entry.class_group_name ? `  · ${entry.class_group_name}` : ""}
          {entry.is_edited ? "  · 수정됨" : ""}
        </Text>
      </View>

      {(!!entry.common_content?.trim() || !!entry.student_note?.note_content?.trim()) && (
        <Text style={[f.body, { color: C.text }]}>
          {[entry.common_content?.trim(), entry.student_note?.note_content?.trim()]
            .filter(Boolean)
            .join("\n\n")}
        </Text>
      )}

      {photos !== null && allPhotos.length > 0 && (
        <PhotosGrid
          photos={allPhotos}
          token={token}
          diaryId={entry.id}
          diaryDate={entry.lesson_date}
          teacherName={entry.teacher_name}
        />
      )}

      {videoCount != null && videoCount > 0 && (
        <Pressable
          onPress={() =>
            router.push({
              pathname: "/(parent)/diary" as any,
              params: { diary_id: entry.id, backTo: "home" },
            })
          }
          style={({ pressed }) => [f.videoBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <LucideIcon name="video" size={14} color={TEAL} />
          <Text style={[f.videoBtnTxt, { color: TEAL }]}>
            영상 {videoCount}개 보기
          </Text>
          <LucideIcon name="chevron-right" size={13} color={TEAL} />
        </Pressable>
      )}

      <View style={[f.reactions, { borderTopColor: C.border }]}>
        {/* 좋아요 — 하트 아이콘 */}
        <Pressable
          onPress={() => toggleReaction("like")}
          style={({ pressed }) => [
            f.reactionBtn,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <LucideIcon
            name="heart"
            size={20}
            color={myReactions.has("like") ? "#E8003D" : "#6B7280"}
            fill={myReactions.has("like") ? "#E8003D" : "none"}
          />
        </Pressable>

        {/* 댓글 — 아이콘만 */}
        <Pressable
          onPress={goToComments}
          style={({ pressed }) => [f.reactionBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <LucideIcon name="message-circle" size={18} color={C.textSecondary} />
        </Pressable>

        {/* Instagram AI Story — 로고 우측 하단에 AI 마크 overlap (lockup) */}
        <Pressable
          onPress={handleInstagramShare}
          disabled={sharing || preparing}
          style={({ pressed }) => [
            f.reactionBtn,
            { opacity: pressed || sharing || preparing ? 0.5 : 1 },
          ]}
        >
          {(sharing || preparing)
            ? <ActivityIndicator size="small" color="#E1306C" style={{ width: 20, height: 20 }} />
            : (
              <View style={f.igAiLockup}>
                <LucideIcon name="instagram" size={20} color="#E1306C" />
                {/* AI: 우측 하단 overlap — 로고와 하나의 마크처럼 */}
                <Text style={f.aiMark}>AI</Text>
              </View>
            )}
        </Pressable>
      </View>

      {/* Instagram Story 캡처 파이프라인 */}
      {sharing && (
        <StoryCapturePipeline
          input={{
            ...(resolvedBodyRef.current !== null
              ? { ...storyInput, bodyText: resolvedBodyRef.current }
              : storyInput),
            // 5~10장: AR 확보된 enriched photos 사용 (Adaptive Collage)
            // 4장 이하 또는 조회 실패 시 기존 storyInput.photos 그대로
            photos: enrichedPhotosRef.current ?? storyInput.photos,
          }}
          onDone={() => {
            setSharing(false);
            sharingRef.current = false;
            enrichedPhotosRef.current = null;
          }}
        />
      )}
    </View>
  );
}

// ── 메인 화면 ──────────────────────────────────────────────────────────────
export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentAccount, pool, parentPoolName, logout } = useAuth();
  const feedPoolName = parentPoolName || (parentAccount as any)?.pool_name || pool?.name || "";
  const { mode } = useMode();
  const {
    students,
    selectedStudent,
    setSelectedStudentId,
    loading: ctxLoading,
    refresh,
    unreadNotifCount,
  } = useParent();

  const [entries, setEntries] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [poolModal, setPoolModal] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmedPool, setConfirmedPool] = useState<PoolResult | null>(null);

  const [aiModalType, setAiModalType] = useState<AIModalType | null>(null);
  const [progressData, setProgressData] = useState<CurriculumProgressData | null>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const [homeLevelInfo, setHomeLevelInfo] = useState<LevelDef | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);

  // ── FREE GROWTH REPORT — 현재 월 리포트 상태 (Phase 1) ───────────────────
  type GrDisplayStatus =
    | "NOT_AVAILABLE"
    | "DATA_ACCUMULATING"
    | "GENERATING"
    | "READY"
    | "PUBLISHED"
    | "FAILED";

  const [grStatus, setGrStatus] = useState<GrDisplayStatus | null>(null);
  const [grReportId, setGrReportId] = useState<string | null>(null);
  const [grStatusLoading, setGrStatusLoading] = useState(false);
  // grStatusServerError: true = 서버/DB 오류 (NOT_AVAILABLE과 내부 상태 구분)
  const [grStatusServerError, setGrStatusServerError] = useState(false);
  const [v2Status, setV2Status] = useState<
    "no_pool" | "waiting" | "linked" | null
  >("no_pool");
  const [v2PendingChildName, setV2PendingChildName] = useState<string | null>(null);
  const [v2PoolPhone, setV2PoolPhone] = useState<string | null>(null);
  const [v2Retrying, setV2Retrying] = useState(false);

  const noPool =
    !confirmedPool && !(parentAccount as any)?.swimming_pool_id && !pool;
  const PT = insets.top + (Platform.OS === "web" ? 67 : 16);
  const isBlocked = !!(selectedStudent as any)?.access_blocked;
  const showFeed = students.length > 0 && !isBlocked && !!selectedStudent;

  // ── 일지 목록 로드 ────────────────────────────────────────────────────────
  // ── FREE GROWTH REPORT: 현재 월 리포트 상태 fetch ─────────────────────────
  async function loadReportStatus(sid: string) {
    if (!sid || !token) return;
    setGrStatusLoading(true);
    try {
      const res = await apiRequest(
        token,
        `/parent/students/${sid}/growth-report-status`,
      );
      if (res.ok) {
        const data = await res.json();
        setGrStatusServerError(false);
        setGrStatus((data.status as GrDisplayStatus) ?? null);
        setGrReportId((data.report_id as string) ?? null);
      } else if (res.status >= 500) {
        // 진짜 서버/DB 오류 — NOT_AVAILABLE과 내부 상태 구분.
        // 새 카드를 렌더링하지 않되, null(정상 미제공)과 혼동하지 않음.
        setGrStatusServerError(true);
        setGrStatus(null);
      } else {
        // 4xx (auth/403 등) — 표시하지 않음, 오류 아님
        setGrStatusServerError(false);
        setGrStatus(null);
      }
    } catch {
      // network/fetch 오류 — 서버 오류 범주로 취급
      setGrStatusServerError(true);
      setGrStatus(null);
    } finally {
      setGrStatusLoading(false);
    }
  }

  // ── LEVEL-HOME: 현재 모자레벨 fetch (no-cache, source of truth) ───────────
  async function loadHomeLevelInfo(sid: string) {
    if (!sid || !token) return;
    try {
      const res = await apiRequest(token, `/parent/students/${sid}/level-info`, { _noCache: true });
      if (res.ok) {
        const data = await res.json();
        setHomeLevelInfo((data.current_level as LevelDef) ?? null);
      } else {
        setHomeLevelInfo(null);
      }
    } catch {
      setHomeLevelInfo(null);
    }
  }

  // ── GAUGE-06: 교육과정 진행도 fetch ────────────────────────────────────────
  async function loadProgress(sid: string) {
    setProgressLoading(true);
    try {
      const res = await apiRequest(token, `/parent/students/${sid}/curriculum-progress`);
      if (res.ok) {
        const data = await res.json();
        setProgressData(data);
      } else {
        setProgressData(null);
      }
    } catch {
      setProgressData(null);
    }
    setProgressLoading(false);
  }

  async function loadEntries(sid: string) {
    let hasCached = false;
    try {
      const raw = await AsyncStorage.getItem(`@sn:parent_diary_${sid}`);
      if (raw) {
        setEntries(JSON.parse(raw));
        hasCached = true;
      }
    } catch {}
    if (!hasCached) setLoading(true);
    try {
      const res = await apiRequest(token, `/parent/students/${sid}/diary`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setEntries(list);
        AsyncStorage.setItem(
          `@sn:parent_diary_${sid}`,
          JSON.stringify(list),
        ).catch(() => {});
      }
      apiRequest(token, `/parent/students/${sid}/mark-diary-read`, {
        method: "POST",
      }).catch(() => {});
    } catch {}
    setLoading(false);
  }

  async function handlePoolSelect(selected: PoolResult) {
    setLinking(true);
    try {
      const r = await apiRequest(token, "/parent/onboard-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swimming_pool_id: selected.id }),
      });
      if (r.ok) {
        const data = await r.json();
        AsyncStorage.setItem(
          "parent_pool_name",
          data.pool_name || selected.name,
        ).catch(() => {});
        setConfirmedPool(selected);
        await refresh();
      }
    } catch {}
    setLinking(false);
  }

  async function loadV2Status() {
    try {
      const r = await apiRequest(token, "/parent/v2/status");
      if (r.ok) {
        const data = await r.json();
        setV2Status(data.status);
        setV2PendingChildName(data.pendingChildName || null);
        setV2PoolPhone(data.pool_phone || null);
        if (data.status === "linked") await refresh();
      }
    } catch {
      if (v2Status === null) setV2Status("no_pool");
    }
  }

  async function handleV2Retry() {
    setV2Retrying(true);
    try {
      const r = await apiRequest(token, "/parent/v2/retry-link", {
        method: "POST",
      });
      if (r.ok) {
        const data = await r.json();
        setV2Status(data.status);
        setV2PendingChildName(data.pendingChildName || null);
        if (data.status === "linked") await refresh();
      }
    } catch {}
    setV2Retrying(false);
  }

  async function unlinkChild(studentId: string, studentName: string) {
    Alert.alert(
      "자녀 연결 해제",
      `${studentName}의 연결을 해제할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "해제",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await apiRequest(
                token,
                `/parent/unlink-child/${studentId}`,
                { method: "DELETE" },
              );
              const d = await r.json();
              if (r.ok && d.success) {
                await refresh();
              } else {
                Alert.alert("오류", d.message || "연결 해제에 실패했습니다.");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다.");
            }
          },
        },
      ],
    );
  }

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    if (selectedStudent?.id) {
      await loadEntries(selectedStudent.id);
      loadReportStatus(selectedStudent.id).catch(() => {});
    }
    setRefreshing(false);
  }

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "web") {
        const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
        return () => sub.remove();
      }
    }, []),
  );

  useEffect(() => {
    loadV2Status();
  }, []);

  useFocusEffect(useCallback(() => { loadV2Status(); }, []));
  useFocusEffect(useCallback(() => { refresh(); }, []));

  useEffect(() => {
    if (selectedStudent?.id) {
      loadEntries(selectedStudent.id);
      loadProgress(selectedStudent.id);
      loadReportStatus(selectedStudent.id);
    } else {
      setEntries([]);
      setProgressData(null);
      setGrStatus(null);
    }
  }, [selectedStudent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (selectedStudent?.id) {
        loadEntries(selectedStudent.id);
        loadProgress(selectedStudent.id);
        loadReportStatus(selectedStudent.id);
        loadHomeLevelInfo(selectedStudent.id);
      }
    }, [selectedStudent?.id]),
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      // GR6: GROWTH_REPORT 카드 렌더링 (spec §6, §26)
      if ((item as GrowthReportFeedItem).type === "GROWTH_REPORT") {
        return (
          <GrowthReportFeedCard
            item={item as GrowthReportFeedItem}
            studentName={selectedStudent?.name ?? ""}
            poolName={feedPoolName}
            progressData={progressData}
          />
        );
      }
      return (
        <DiaryFeedItem
          entry={item as DiaryEntry}
          studentId={selectedStudent?.id ?? ""}
          studentName={selectedStudent?.name ?? ""}
        />
      );
    },
    [selectedStudent?.id, selectedStudent?.name, feedPoolName, progressData],
  );

  const keyExtractor = useCallback((item: FeedItem) => item.id, []);

  if (ctxLoading) {
    return (
      <View
        style={[
          s.root,
          {
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: C.background,
          },
        ]}
      >
        <ActivityIndicator color={C.brandStrong} size="large" />
      </View>
    );
  }

  // ── V2 waiting 화면 ────────────────────────────────────────────────────────
  if (v2Status === "waiting") {
    const ORANGE = "#F97316";
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.header, { paddingTop: PT }]}>
          <Text style={[s.poolName, { color: C.textMuted }]}>SwimNote</Text>
          <View style={s.headerBtns} />
        </View>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingBottom: 80,
          }}
        >
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                backgroundColor: "#FFF3E0",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <LucideIcon name="clock" size={44} color={ORANGE} />
            </View>
            <Text
              style={{
                fontSize: 22,
                fontFamily: "Pretendard-Bold",
                color: C.text,
                textAlign: "center",
                marginBottom: 10,
              }}
            >
              연결 대기 중
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontFamily: "Pretendard-Regular",
                color: C.textSecondary,
                textAlign: "center",
                lineHeight: 22,
              }}
            >
              수영장에서 자녀 등록을 완료하면{"\n"}자동으로 연결됩니다.
            </Text>
          </View>
          <View
            style={{
              backgroundColor: "#FFF3E0",
              borderRadius: 16,
              padding: 18,
              gap: 10,
              marginBottom: 24,
              borderWidth: 1,
              borderColor: "#FECFA2",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <LucideIcon name="user" size={16} color={ORANGE} />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: "Pretendard-SemiBold",
                  color: C.text,
                }}
              >
                등록 대기 자녀:{" "}
                <Text style={{ color: ORANGE }}>
                  {v2PendingChildName || "정보 없음"}
                </Text>
              </Text>
            </View>
            <Text
              style={{
                fontSize: 12,
                color: C.textSecondary,
                fontFamily: "Pretendard-Regular",
                lineHeight: 18,
              }}
            >
              수영장에 아이 이름·보호자 전화번호가{"\n"}정확히 등록되어 있는지
              확인해주세요.
            </Text>
            {!!v2PoolPhone && (
              <Pressable
                onPress={() =>
                  Linking.openURL(
                    `tel:${v2PoolPhone!.replace(/[^0-9]/g, "")}`,
                  )
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: pressed ? "#FECFA2" : "#fff",
                  borderRadius: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderWidth: 1,
                  borderColor: "#FECFA2",
                })}
              >
                <LucideIcon name="phone" size={15} color={ORANGE} />
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: "Pretendard-SemiBold",
                    color: ORANGE,
                  }}
                >
                  수영장 전화하기  {v2PoolPhone}
                </Text>
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={handleV2Retry}
            disabled={v2Retrying}
            style={({ pressed }) => ({
              backgroundColor: pressed ? "#1E293B" : C.primaryAction,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 10,
              marginBottom: 12,
            })}
          >
            {v2Retrying ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <LucideIcon name="refresh-cw" size={18} color="#fff" />
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: "Pretendard-Bold",
                    color: "#fff",
                  }}
                >
                  다시 확인하기
                </Text>
              </>
            )}
          </Pressable>
          <Text
            style={{
              fontSize: 12,
              color: C.textMuted,
              fontFamily: "Pretendard-Regular",
              textAlign: "center",
              lineHeight: 18,
            }}
          >
            수영장 등록 완료 후 버튼을 누르면{"\n"}즉시 연결됩니다.
          </Text>
          <Pressable
            onPress={async () => {
              await logout();
              router.replace("/");
            }}
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              marginTop: 8,
              paddingVertical: 10,
            })}
          >
            <Text
              style={{
                fontSize: 13,
                color: C.textMuted,
                fontFamily: "Pretendard-Regular",
                textAlign: "center",
              }}
            >
              로그아웃
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── 수영장 미연결 ──────────────────────────────────────────────────────────
  if (noPool) {
    return (
      <View style={[s.root, { backgroundColor: C.background }]}>
        <View style={[s.header, { paddingTop: PT }]}>
          <Text style={[s.poolName, { color: C.textMuted }]}>SwimNote</Text>
          <View style={s.headerBtns} />
        </View>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingBottom: 80,
          }}
        >
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                backgroundColor: IB,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <LucideIcon name="building-2" size={44} color={TEAL} />
            </View>
            <Text
              style={{
                fontSize: 22,
                fontFamily: "Pretendard-Bold",
                color: C.text,
                textAlign: "center",
                marginBottom: 10,
              }}
            >
              수영장을 선택해주세요
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontFamily: "Pretendard-Regular",
                color: C.textSecondary,
                textAlign: "center",
                lineHeight: 22,
              }}
            >
              수영장을 선택하면 자녀의 수업, 앨범,{"\n"}출결 정보를 바로 확인할
              수 있어요.
            </Text>
          </View>
          <Pressable
            onPress={() => setPoolModal(true)}
            disabled={linking}
            style={({ pressed }) => ({
              backgroundColor: pressed ? "#163260" : NAVY,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 10,
            })}
          >
            {linking ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <LucideIcon name="search" size={20} color="#fff" />
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: "Pretendard-Bold",
                    color: "#fff",
                  }}
                >
                  수영장 선택하기
                </Text>
              </>
            )}
          </Pressable>
          <Text
            style={{
              fontSize: 12,
              color: C.textMuted,
              fontFamily: "Pretendard-Regular",
              textAlign: "center",
              marginTop: 16,
            }}
          >
            선택 후 전화번호로 등록된 자녀가 자동 연결됩니다
          </Text>
        </ScrollView>
        <PoolSelectModal
          visible={poolModal}
          onClose={() => setPoolModal(false)}
          onSelect={handlePoolSelect}
        />
      </View>
    );
  }

  // ── ListHeaderComponent ────────────────────────────────────────────────────
  const schedule = formatSchedule((selectedStudent as any)?.class_group);
  /** §24: x_pending도 X UI */
  const isX = isXMode(mode);
  const iconColor = isX ? XT.textOnNavy : C.textSecondary;

  const ListHeader = (
    <View>
      {/* ── GAUGE-06: big duplicate Growth Report button 삭제됨 ── */}
      {/* A. Slim Header는 FlatList 외부 fixed header로 이동됨 */}

      {/* B. 자녀 선택 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 14,
          gap: 8,
          paddingBottom: 6,
        }}
        style={{ flexGrow: 0 }}
      >
        {students.map(st => {
          const isSel = selectedStudent?.id === st.id;
          return (
            <Pressable
              key={st.id}
              style={[
                s.childTab,
                isSel
                  ? { backgroundColor: NAVY, borderColor: NAVY }
                  : { backgroundColor: C.card, borderColor: C.border },
              ]}
              onPress={() => setSelectedStudentId(st.id)}
              onLongPress={() => unlinkChild(st.id, st.name)}
              delayLongPress={600}
            >
              <Text
                style={[s.childTabTxt, { color: isSel ? "#fff" : C.text }]}
              >
                {st.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[
            s.childTab,
            s.childTabAdd,
            { backgroundColor: C.card, borderColor: C.border },
          ]}
          onPress={() => router.push("/(parent)/link-child" as any)}
        >
          <LucideIcon name="plus" size={14} color={C.textMuted} />
          <Text
            style={[s.childTabTxt, { color: C.textMuted, marginLeft: 2 }]}
          >
            추가
          </Text>
        </Pressable>
      </ScrollView>

      {/* C. AI 기능 버튼 (AI 인사이트 전략 리포트 + AI 커리큘럼 검색) */}
      {/* 리포트: X/x_pending 전용 | 커리큘럼 검색: selectedStudent 있으면 항상 표시 */}
      {selectedStudent && (
        <View style={{ flexDirection: "row", paddingHorizontal: 20, gap: 10, marginTop: 12, marginBottom: 12 }}>
          {(mode === "x" || mode === "x_pending") && (
            <Pressable
              onPress={() => router.push("/(parent)/growth-report-paid" as any)}
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: 11,
                borderWidth: 1,
                borderColor: "#DDE3EE",
                backgroundColor: "#F5F7FA",
                paddingHorizontal: 10,
                paddingVertical: 12,
                alignItems: "center",
                gap: 8,
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <LucideIcon name="bar-chart-2" size={22} color={NAVY} />
              <Text style={{ fontSize: 11, fontFamily: "Pretendard-Medium", color: NAVY, textAlign: "center", lineHeight: 16 }}>
                {"AI 인사이트\n전략 리포트"}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              if (selectedStudent) {
                router.push({
                  pathname: "/(parent)/curriculum-chat" as any,
                  params: {
                    studentId:   selectedStudent.id,
                    studentName: selectedStudent.name ?? "",
                  },
                });
              }
            }}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 11,
              borderWidth: 1,
              borderColor: "#DDE3EE",
              backgroundColor: "#F5F7FA",
              paddingHorizontal: 10,
              paddingVertical: 12,
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <LucideIcon name="book-open" size={22} color={NAVY} />
            <Text style={{ fontSize: 11, fontFamily: "Pretendard-Medium", color: NAVY, textAlign: "center", lineHeight: 16 }}>
              AI 커리큘럼 검색
            </Text>
          </Pressable>
        </View>
      )}

      {/* ★ GAUGE-06: 교육과정 진행도 게이지 (X mode + selectedStudent + !isBlocked) */}
      {selectedStudent && mode === "x" && !isBlocked && (
        <CurriculumProgressGauge
          data={progressData}
          loading={progressLoading}
          currentLevel={homeLevelInfo}
        />
      )}

      {/* D. access_blocked 안내 */}
      {selectedStudent && isBlocked && (
        <View style={s.blockedCard}>
          <LucideIcon name="lock" size={20} color="#D97706" />
          <View style={{ flex: 1 }}>
            <Text style={[s.blockedTitle, { color: C.text }]}>
              정보 열람 제한
            </Text>
            <Text style={[s.blockedSub, { color: C.textSecondary }]}>
              현재 일부 정보 열람이 제한되어 있습니다.{"\n"}수영장 담당자에게
              문의해주세요.
            </Text>
          </View>
        </View>
      )}

      {/* E. 공지 배너 */}
      {selectedStudent && !isBlocked && (
        <View style={{ marginTop: 6, marginBottom: 0 }}>
          <ParentPromoStrip />
        </View>
      )}

      {/* E-2. 광고 배너 슬롯 (PARENT_HOME_BANNER) */}
      {selectedStudent && !isBlocked && (
        <ParentAdBanner token={token} />
      )}

      {/* ── FREE GROWTH REPORT: 현재 월 리포트 상태 카드 ────────────────── */}
      {/* X mode이고 selectedStudent 있고 PUBLISHED가 아닌 상태일 때만 표시  */}
      {selectedStudent && !isBlocked && isX && (
        grStatusLoading ? null : (
          grStatus === "DATA_ACCUMULATING" ? (
            <View style={{
              marginHorizontal: 16, marginTop: 10, marginBottom: 4,
              backgroundColor: "#F0F9FF", borderRadius: 14,
              padding: 14, flexDirection: "row", alignItems: "flex-start",
              gap: 10, borderWidth: 1, borderColor: "#BAE6FD",
            }}>
              <LucideIcon name="bar-chart-2" size={16} color="#0369A1" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#0369A1", marginBottom: 3 }}>
                  이번 달 성장리포트
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#334155", lineHeight: 20 }}>
                  조금 더 수업 기록이 쌓이면{"\n"}이번 달 성장리포트를 만들어드릴게요.
                </Text>
              </View>
            </View>
          ) : grStatus === "GENERATING" ? (
            <View style={{
              marginHorizontal: 16, marginTop: 10, marginBottom: 4,
              backgroundColor: "#F0F9FF", borderRadius: 14,
              padding: 14, flexDirection: "row", alignItems: "center",
              gap: 10, borderWidth: 1, borderColor: "#BAE6FD",
            }}>
              <ActivityIndicator size="small" color="#0369A1" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#0369A1", marginBottom: 2 }}>
                  이번 달 성장리포트
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#334155" }}>
                  성장리포트를 만들고 있어요.
                </Text>
              </View>
            </View>
          ) : grStatus === "READY" ? (
            <View style={{
              marginHorizontal: 16, marginTop: 10, marginBottom: 4,
              backgroundColor: "#F0FDF4", borderRadius: 14,
              padding: 14, flexDirection: "row", alignItems: "center",
              gap: 10, borderWidth: 1, borderColor: "#86EFAC",
            }}>
              <LucideIcon name="check-circle" size={16} color="#16A34A" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#16A34A", marginBottom: 2 }}>
                  이번 달 성장리포트
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#334155" }}>
                  검토가 완료되었어요. 곧 공개됩니다.
                </Text>
              </View>
            </View>
          ) : grStatus === "FAILED" ? (
            <View style={{
              marginHorizontal: 16, marginTop: 10, marginBottom: 4,
              backgroundColor: "#FEF2F2", borderRadius: 14,
              padding: 14, flexDirection: "row", alignItems: "center",
              gap: 10, borderWidth: 1, borderColor: "#FECACA",
            }}>
              <LucideIcon name="alert-circle" size={16} color="#DC2626" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#DC2626", marginBottom: 2 }}>
                  이번 달 성장리포트
                </Text>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#334155" }}>
                  이번 달 성장리포트 생성에 문제가 발생했습니다.
                </Text>
              </View>
            </View>
          ) : null
        )
      )}

      {/* F-divider. 상단 UI ↔ 일지 영역 구분선 */}
      {selectedStudent && !isBlocked && (
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginTop: 12, marginHorizontal: 0 }} />
      )}

      {/* F. 자녀 없음 */}
      {students.length === 0 && (
        <View
          style={{
            alignItems: "center",
            paddingTop: 60,
            paddingHorizontal: 32,
            gap: 16,
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: IB,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LucideIcon name="user-plus" size={38} color={NAVY} />
          </View>
          <Text
            style={{
              fontSize: 20,
              fontFamily: "Pretendard-SemiBold",
              color: C.text,
              textAlign: "center",
            }}
          >
            아직 연결된 자녀가 없습니다
          </Text>
          <Text
            style={{
              fontSize: 14,
              fontFamily: "Pretendard-Regular",
              color: C.textSecondary,
              textAlign: "center",
              lineHeight: 22,
            }}
          >
            자녀를 연결하면 수업 기록을{"\n"}확인할 수 있습니다
          </Text>
          <Pressable
            onPress={() => router.push("/(parent)/link-child" as any)}
            style={({ pressed }) => ({
              marginTop: 8,
              backgroundColor: pressed ? "#163260" : NAVY,
              borderRadius: 14,
              paddingVertical: 14,
              paddingHorizontal: 32,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 10,
            })}
          >
            <LucideIcon name="link" size={18} color="#fff" />
            <Text
              style={{
                fontSize: 16,
                fontFamily: "Pretendard-SemiBold",
                color: "#fff",
              }}
            >
              자녀 연결하기
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  // ── 빈 상태 ────────────────────────────────────────────────────────────────
  const ListEmpty =
    !loading && showFeed ? (
      <View
        style={{
          paddingTop: 40,
          paddingHorizontal: 32,
          alignItems: "center",
          gap: 10,
        }}
      >
        <LucideIcon name="book-open" size={40} color={C.textMuted} />
        <Text
          style={{
            fontSize: 15,
            fontFamily: "Pretendard-Regular",
            color: C.text,
          }}
        >
          아직 등록된 수업일지가 없습니다.
        </Text>
      </View>
    ) : null;

  // ── 피드 하단 ──────────────────────────────────────────────────────────────
  const ListFooter = loading ? (
    <View style={{ paddingVertical: 24, alignItems: "center" }}>
      <ActivityIndicator color={C.brandStrong} size="small" />
    </View>
  ) : entries.length > 0 ? (
    <View style={{ paddingVertical: 28, alignItems: "center" }}>
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Pretendard-Regular",
          color: C.textMuted,
        }}
      >
        · 모든 수업일지를 불러왔습니다 ·
      </Text>
    </View>
  ) : null;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      {/* ── FIXED TOP HEADER ──────────────────────────────────────────────── */}
      <View style={[
        s.header,
        { paddingTop: PT },
        isX
          ? { backgroundColor: XT.surfaceNavy, borderBottomWidth: 1, borderBottomColor: XT.surfaceNavyStrong }
          : { backgroundColor: C.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
      ]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
          <Text style={[s.poolName, { color: isX ? XT.textOnNavy : C.textSecondary, flex: 0, flexShrink: 1 }]} numberOfLines={1}>
            {parentPoolName ||
              (parentAccount as any)?.pool_name ||
              pool?.name ||
              "수영장"}
          </Text>
          {isX && (
            <View style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: XT.textOnNavy, letterSpacing: 0.5 }}>
                SWIMNOTE X
              </Text>
            </View>
          )}
        </View>
        <View style={s.headerBtns}>
          <Pressable
            style={[s.headerBtn, isX && { backgroundColor: "rgba(255,255,255,0.12)" }]}
            onPress={() => router.push("/(parent)/notifications" as any)}
          >
            <View style={{ position: "relative" }}>
              <LucideIcon name="inbox" size={19} color={iconColor} />
              {unreadNotifCount > 0 && (
                <View style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: "#E53E3E", borderWidth: 1.5, borderColor: isX ? XT.surfaceNavy : "#fff" }} />
              )}
            </View>
          </Pressable>
          <Pressable
            style={[s.headerBtn, isX && { backgroundColor: "rgba(255,255,255,0.12)" }]}
            onPress={() => Linking.openURL("https://swimnote.kr")}
          >
            <Image
              source={require("@/assets/images/swimnote-logo.png")}
              style={{ width: 32, height: 32, opacity: 1 }}
              resizeMode="contain"
            />
          </Pressable>
          <Pressable
            style={[s.headerBtn, isX && { backgroundColor: "rgba(255,255,255,0.12)" }]}
            onPress={() => router.push("/(parent)/photos?backTo=home" as any)}
          >
            <LucideIcon name="images" size={19} color={iconColor} />
          </Pressable>
          <Pressable
            style={[s.headerBtn, isX && { backgroundColor: "rgba(255,255,255,0.12)" }]}
            onPress={() => router.push("/(parent)/more" as any)}
          >
            <LucideIcon name="settings" size={19} color={iconColor} />
          </Pressable>
        </View>
      </View>

      {/* ── SCROLLABLE MAIN AREA (flex: 1) ──────────────────────────────── */}
      <FlatList<FeedItem>
        style={{ flex: 1, backgroundColor: isX ? "#F8F9FA" : C.background }}
        data={showFeed ? entries : []}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        ItemSeparatorComponent={() => <View style={{ height: 120 }} />}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.brandStrong}
          />
        }
        contentContainerStyle={{ paddingBottom: footerHeight || 16 }}
        maxToRenderPerBatch={8}
        windowSize={12}
        initialNumToRender={5}
        removeClippedSubviews
      />
      <PoolSelectModal
        visible={poolModal}
        onClose={() => setPoolModal(false)}
        onSelect={handlePoolSelect}
      />

      {/* ── FIXED BOTTOM FOOTER ──────────────────────────────────────────── */}
      <View
        style={[s.bottomBar, { paddingBottom: insets.bottom + 6 }]}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
      >
        <Text style={s.bottomBarTxt}>Powered by SWIMNOTE AI with OpenAI GPT</Text>
      </View>

      {/* AI 기능 안내 모달 */}
      {aiModalType !== null && (
        <AIFeatureModal
          visible={aiModalType !== null}
          type={aiModalType}
          onClose={() => setAiModalType(null)}
        />
      )}
    </View>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  poolName: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    flex: 1,
  },
  headerBtns: { flexDirection: "row", gap: 8 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  childTab: {
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  childTabAdd: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  childTabTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  studentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 6,
  },
  studentName: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    flexShrink: 1,
  },
  studentSchedule: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    flexShrink: 1,
  },
  albumBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  albumBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  blockedCard: {
    marginHorizontal: 20,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#FEF9C3",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  blockedTitle: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    marginBottom: 4,
  },
  blockedSub: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    lineHeight: 18,
  },
  bottomBar: {
    alignItems: "center",
    paddingTop: 8,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  bottomBarTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: "#AAAAAA",
  },
});

const f = StyleSheet.create({
  item: { paddingHorizontal: 20, backgroundColor: "#FFFFFF" },
  sep: { height: 1, marginTop: 20, marginBottom: 16 },
  meta: { gap: 3, marginBottom: 12 },
  dateText: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
  },
  teacherText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
  },
  body: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    lineHeight: 24,
  },
  noteBox: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    marginTop: 12,
  },
  noteLabel: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: "#7C3AED",
  },
  videoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: IB,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  videoBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  reactions: {
    flexDirection: "row",
    borderTopWidth: 1,
    marginTop: 16,
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 0,
    justifyContent: "space-around",
  },
  reactionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 4,
  },
  reactionBtnActive: {},
  // Instagram AI lockup — 로고(20px) + AI 마크 overlap 컨테이너
  // width/height에 여유를 두어 AI badge가 잘리지 않도록
  igAiLockup: {
    width:           28,
    height:          26,
    alignItems:      "center",
    justifyContent:  "center",
  },
  // AI 마크 — Instagram 로고 우측 하단에 살짝 overlap
  // wrapper 기준 absolute → 로고와 하나의 마크처럼 인식
  aiMark: {
    position:      "absolute",
    right:         0,
    bottom:        -3,
    fontSize:      8,
    fontFamily:    "Pretendard-Bold",
    color:         NAVY,
    letterSpacing: 0.2,
    lineHeight:    10,
  },
});
