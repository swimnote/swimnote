/**
 * SessionSelectorSheet — 일지 작성 중 수업 회차 변경 selector
 *
 * - GET /diaries/unwritten-slots?includeWritten=true (미작성+기작성 전체)
 * - 선택 시 onSelect(session) 콜백 → 외부에서 session 전환 처리
 * - 기작성 회차는 "작성됨" 배지, 미작성은 "미작성" 배지
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CalendarDays, X } from "lucide-react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.75;
const DISMISS_THRESHOLD = 80;

const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

export interface DiarySession {
  classGroupId: string;
  className: string;
  scheduleTime: string; // "HH:MM"
  lessonDate: string;   // "YYYY-MM-DD"
  dayOfWeek: string;
  studentCount: number;
  hasDiary: boolean;
}

interface Props {
  visible: boolean;
  token: string | null;
  onClose: () => void;
  onSelect: (session: DiarySession) => void;
  currentClassGroupId?: string;
  currentLessonDate?: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()} (${KO_DAYS[d.getDay()]})`;
}

export function SessionSelectorSheet({
  visible, token, onClose, onSelect,
  currentClassGroupId, currentLessonDate,
}: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  const [sessions, setSessions] = useState<DiarySession[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const show = useCallback(() => {
    translateY.setValue(SHEET_HEIGHT);
    dragY.setValue(0);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }, [translateY, dragY]);

  const hide = useCallback((cb?: () => void) => {
    Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 220, useNativeDriver: true }).start(() => cb?.());
  }, [translateY]);

  const load = useCallback(async () => {
    if (!token) return;
    setStatus("loading");
    try {
      const res = await apiRequest(token, "/diaries/unwritten-slots?includeWritten=true");
      if (!res.ok) {
        console.warn("[diary-selector-fetch] { path: \"/diaries/unwritten-slots?includeWritten=true\", authorization_present: true, status:", res.status, "}");
        throw new Error("fetch failed");
      }
      const data = await res.json();
      // 최근 날짜 우선
      const all: DiarySession[] = [...(data.slots ?? [])].reverse();
      setSessions(all);
      setStatus("idle");
    } catch (e: any) {
      console.warn("[diary-selector-fetch] { path: \"/diaries/unwritten-slots?includeWritten=true\", authorization_present: true, error_name:", e?.name, ", error_message:", String(e?.message ?? "").slice(0, 100), "}");
      setStatus("error");
    }
  }, [token]);

  useEffect(() => {
    if (visible) { show(); load(); }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_THRESHOLD) { hide(onClose); }
        else { Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(); }
      },
    })
  ).current;

  const handleSelect = useCallback((session: DiarySession) => {
    hide(() => {
      onClose();
      onSelect(session);
    });
  }, [hide, onClose, onSelect]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={() => hide(onClose)}>
      <Pressable style={s.backdrop} onPress={() => hide(onClose)} />
      <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + 8, transform: [{ translateY: Animated.add(translateY, dragY) }] }]}>
        {/* drag handle */}
        <View style={s.handleWrap} {...panResponder.panHandlers}>
          <View style={s.handle} />
        </View>

        {/* header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>수업 변경</Text>
          <Pressable onPress={() => hide(onClose)} hitSlop={8}>
            <X size={20} color={C.textSecondary} />
          </Pressable>
        </View>
        <Text style={s.headerSub}>변경할 수업 회차를 선택해주세요.</Text>

        {/* body */}
        {status === "loading" ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : status === "error" ? (
          <View style={s.center}>
            <Text style={s.emptyText}>목록을 불러오지 못했습니다.</Text>
            <Pressable onPress={load} style={s.retryBtn}>
              <Text style={s.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        ) : sessions.length === 0 ? (
          <View style={s.center}>
            <Text style={s.emptyText}>전환 가능한 수업 회차가 없습니다.</Text>
          </View>
        ) : (
          <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {sessions.map((session, idx) => {
              const isCurrent = session.classGroupId === currentClassGroupId && session.lessonDate === currentLessonDate;
              return (
                <Pressable
                  key={`${session.classGroupId}_${session.lessonDate}_${idx}`}
                  style={({ pressed }) => [s.row, isCurrent && s.rowCurrent, pressed && { opacity: 0.7 }]}
                  onPress={() => handleSelect(session)}
                >
                  <View style={s.rowIcon}>
                    <CalendarDays size={18} color={isCurrent ? C.primary : C.textSecondary} />
                  </View>
                  <View style={s.rowBody}>
                    <Text style={[s.rowDate, isCurrent && { color: C.primary }]}>{formatDate(session.lessonDate)}</Text>
                    <Text style={s.rowInfo}>
                      {session.scheduleTime ? `${session.scheduleTime} · ` : ""}{session.className}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <View style={[s.rowBadge, s.rowBadgeCurrent]}>
                      <Text style={[s.rowBadgeText, { color: C.primary }]}>현재</Text>
                    </View>
                  ) : session.hasDiary ? (
                    <View style={[s.rowBadge, s.rowBadgeDone]}>
                      <Text style={[s.rowBadgeText, { color: "#16A34A" }]}>작성됨</Text>
                    </View>
                  ) : (
                    <View style={[s.rowBadge, s.rowBadgePending]}>
                      <Text style={[s.rowBadgeText, { color: "#DC2626" }]}>미작성</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:        { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet:           { position: "absolute", bottom: 0, left: 0, right: 0, height: SHEET_HEIGHT, backgroundColor: C.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  handleWrap:      { alignItems: "center", paddingVertical: 10 },
  handle:          { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },
  header:          { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 4 },
  headerTitle:     { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  headerSub:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, paddingHorizontal: 20, marginBottom: 12 },
  center:          { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  retryBtn:        { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, backgroundColor: C.brandSoft },
  retryText:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.primary },
  list:            { flex: 1 },
  row:             { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border, gap: 12 },
  rowCurrent:      { backgroundColor: C.brandSoft },
  rowIcon:         { width: 32, height: 32, borderRadius: 8, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  rowBody:         { flex: 1, gap: 2 },
  rowDate:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  rowInfo:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  rowBadge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  rowBadgePending: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  rowBadgeDone:    { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  rowBadgeCurrent: { backgroundColor: C.brandSoft, borderColor: C.brandStrong },
  rowBadgeText:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
});
