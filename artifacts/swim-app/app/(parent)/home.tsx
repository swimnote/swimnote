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
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  View,
  useWindowDimensions,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { API_BASE, apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;
const TEAL = "#2EC4B6";
const IB = "#E6FAF8";

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
            backgroundColor: "#F4F6FA",
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
                  backgroundColor: pressed ? "#F0FAF9" : "#fff",
                })}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "#E6FAF8",
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

// ── 사진 2열 그리드 + 전체화면 뷰어 ──────────────────────────────────────────
function PhotosGrid({
  photos,
  token,
}: {
  photos: PhotoItem[];
  token: string | null;
}) {
  const { width } = useWindowDimensions();
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  if (!photos.length) return null;

  const gap = 4;
  const hPad = 40;
  const imgSize = Math.floor((width - hPad - gap) / 2);

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap,
          marginTop: 12,
        }}
      >
        {photos.map((p, i) => (
          <Pressable key={p.id} onPress={() => setViewerIdx(i)}>
            <ExpoImage
              source={{
                uri: buildPhotoUri(p.file_url),
                headers: { Authorization: `Bearer ${token}` },
              }}
              style={{ width: imgSize, height: imgSize, borderRadius: 8 }}
              contentFit="cover"
              transition={200}
            />
          </Pressable>
        ))}
      </View>

      {viewerIdx !== null && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setViewerIdx(null)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.94)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <ExpoImage
              source={{
                uri: buildPhotoUri(photos[viewerIdx].file_url),
                headers: { Authorization: `Bearer ${token}` },
              }}
              style={{ width: width - 32, height: width - 32, borderRadius: 4 }}
              contentFit="contain"
            />
            <Text
              style={{
                color: "rgba(255,255,255,0.45)",
                marginTop: 14,
                fontSize: 13,
                fontFamily: "Pretendard-Regular",
              }}
            >
              {viewerIdx + 1} / {photos.length}
            </Text>

            <Pressable
              onPress={() => setViewerIdx(null)}
              style={{ position: "absolute", top: 56, right: 20 }}
              hitSlop={16}
            >
              <LucideIcon name="x" size={26} color="#fff" />
            </Pressable>

            {viewerIdx > 0 && (
              <Pressable
                onPress={() => setViewerIdx(v => (v ?? 1) - 1)}
                style={{ position: "absolute", left: 12, top: "45%" }}
                hitSlop={16}
              >
                <LucideIcon name="chevron-left" size={38} color="#fff" />
              </Pressable>
            )}

            {viewerIdx < photos.length - 1 && (
              <Pressable
                onPress={() => setViewerIdx(v => (v ?? 0) + 1)}
                style={{ position: "absolute", right: 12, top: "45%" }}
                hitSlop={16}
              >
                <LucideIcon name="chevron-right" size={38} color="#fff" />
              </Pressable>
            )}
          </View>
        </Modal>
      )}
    </>
  );
}

// ── 개별 일지 피드 아이템 ──────────────────────────────────────────────────
function DiaryFeedItem({
  entry,
  studentId,
  studentName,
}: {
  entry: DiaryEntry;
  studentId: string;
  studentName: string;
}) {
  const { token } = useAuth();
  const [myReactions, setMyReactions] = useState<Set<string>>(
    new Set(entry.reactions ?? []),
  );
  const [photos, setPhotos] = useState<{
    common: PhotoItem[];
    individual: PhotoItem[];
  } | null>(null);
  const [videoCount, setVideoCount] = useState<number | null>(null);
  const loadedRef = useRef(false);

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

  async function toggleReaction(type: "like" | "thank") {
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

  function goToMessages() {
    router.push({
      pathname: "/(parent)/messages" as any,
      params: {
        diaryId: entry.id,
        diaryDate: entry.lesson_date,
        teacherName: entry.teacher_name,
        studentName,
      },
    });
  }

  const { year, month, day, weekday } = parseLessonDate(entry.lesson_date);
  const isCurrentYear = year === new Date().getFullYear();
  const allPhotos = [...(photos?.common ?? []), ...(photos?.individual ?? [])];

  return (
    <View style={f.item}>
      <View style={[f.sep, { backgroundColor: C.border }]} />

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

      {!!entry.common_content?.trim() && (
        <Text style={[f.body, { color: C.text }]}>{entry.common_content}</Text>
      )}

      {!!entry.student_note?.note_content?.trim() && (
        <View
          style={[
            f.noteBox,
            { backgroundColor: "#EEDDF5", borderColor: "#E9D5FF" },
          ]}
        >
          <Text style={f.noteLabel}>우리 아이 메모</Text>
          <Text style={[f.body, { color: "#0F172A", marginTop: 4 }]}>
            {entry.student_note.note_content}
          </Text>
        </View>
      )}

      {photos !== null && allPhotos.length > 0 && (
        <PhotosGrid photos={allPhotos} token={token} />
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
        <Pressable
          onPress={() => toggleReaction("like")}
          style={[
            f.reactionBtn,
            myReactions.has("like") && { backgroundColor: "#E6FFFA" },
          ]}
        >
          <Text
            style={[
              f.emoji,
              myReactions.has("like") && { transform: [{ scale: 1.2 }] },
            ]}
          >
            👍
          </Text>
          <Text
            style={[
              f.reactionLabel,
              { color: myReactions.has("like") ? TEAL : C.textSecondary },
            ]}
          >
            좋아요
          </Text>
        </Pressable>
        <Pressable
          onPress={() => toggleReaction("thank")}
          style={[
            f.reactionBtn,
            myReactions.has("thank") && { backgroundColor: "#F6D8E1" },
          ]}
        >
          <Text
            style={[
              f.emoji,
              myReactions.has("thank") && { transform: [{ scale: 1.2 }] },
            ]}
          >
            🙏
          </Text>
          <Text
            style={[
              f.reactionLabel,
              { color: myReactions.has("thank") ? "#BE185D" : C.textSecondary },
            ]}
          >
            감사합니다
          </Text>
        </Pressable>
        <Pressable onPress={goToMessages} style={f.reactionBtn}>
          <LucideIcon name="mail" size={16} color={C.textSecondary} />
          <Text style={[f.reactionLabel, { color: C.textSecondary }]}>쪽지달기</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── 메인 화면 ──────────────────────────────────────────────────────────────
export default function ParentHomeScreen() {
  const insets = useSafeAreaInsets();
  const { token, parentAccount, pool, parentPoolName, logout } = useAuth();
  const {
    students,
    selectedStudent,
    setSelectedStudentId,
    loading: ctxLoading,
    refresh,
  } = useParent();

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [poolModal, setPoolModal] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmedPool, setConfirmedPool] = useState<PoolResult | null>(null);

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
    if (selectedStudent?.id) await loadEntries(selectedStudent.id);
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
    if (selectedStudent?.id) loadEntries(selectedStudent.id);
    else setEntries([]);
  }, [selectedStudent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (selectedStudent?.id) loadEntries(selectedStudent.id);
    }, [selectedStudent?.id]),
  );

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
        <ActivityIndicator color={C.tint} size="large" />
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
              backgroundColor: pressed ? "#EA6A00" : ORANGE,
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
                backgroundColor: "#E6FAF8",
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
              backgroundColor: pressed ? "#27B8AC" : TEAL,
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

  const ListHeader = (
    <View>
      {/* A. Slim Header */}
      <View style={[s.header, { paddingTop: PT }]}>
        <Text style={[s.poolName, { color: C.textMuted }]} numberOfLines={1}>
          {parentPoolName ||
            (parentAccount as any)?.pool_name ||
            pool?.name ||
            "수영장"}
        </Text>
        <View style={s.headerBtns}>
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/notifications" as any)}
          >
            <LucideIcon name="bell" size={19} color={C.textSecondary} />
          </Pressable>
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => Linking.openURL("https://swimnote.kr")}
          >
            <Image
              source={require("@/assets/images/swimnote-logo.png")}
              style={{ width: 19, height: 19 }}
              resizeMode="contain"
            />
          </Pressable>
          <Pressable
            style={[s.headerBtn, { backgroundColor: C.card }]}
            onPress={() => router.push("/(parent)/more" as any)}
          >
            <LucideIcon name="settings" size={19} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* B. 자녀 선택 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
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
                  ? { backgroundColor: C.tint, borderColor: C.tint }
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

      {/* C. 학생 정보 한 줄 */}
      {selectedStudent && (
        <View style={s.studentRow}>
          <Text
            style={[s.studentName, { color: C.text }]}
            numberOfLines={1}
          >
            {selectedStudent.name}
          </Text>
          {!!schedule && (
            <Text
              style={[s.studentSchedule, { color: C.textSecondary }]}
              numberOfLines={1}
            >
              {"  "}
              {schedule}
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() =>
              router.push("/(parent)/photos?backTo=home" as any)
            }
            style={({ pressed }) => [
              s.albumBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[s.albumBtnTxt, { color: TEAL }]}>앨범 보기</Text>
            <LucideIcon name="chevron-right" size={13} color={TEAL} />
          </Pressable>
        </View>
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
        <View style={{ marginTop: 8, marginBottom: 4 }}>
          <ParentPromoStrip />
        </View>
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
            <LucideIcon name="user-plus" size={38} color={TEAL} />
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
              backgroundColor: pressed ? "#27B8AC" : TEAL,
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
      <ActivityIndicator color={C.tint} size="small" />
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

  const renderItem = useCallback(
    ({ item }: { item: DiaryEntry }) => (
      <DiaryFeedItem
        entry={item}
        studentId={selectedStudent?.id ?? ""}
        studentName={selectedStudent?.name ?? ""}
      />
    ),
    [selectedStudent?.id, selectedStudent?.name],
  );

  const keyExtractor = useCallback((item: DiaryEntry) => item.id, []);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <FlatList<DiaryEntry>
        data={showFeed ? entries : []}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.tint}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
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
    paddingBottom: 8,
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
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
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
    backgroundColor: IB,
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
});

const f = StyleSheet.create({
  item: { paddingHorizontal: 20 },
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
  },
  reactionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
  },
  emoji: { fontSize: 16 },
  reactionLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});
