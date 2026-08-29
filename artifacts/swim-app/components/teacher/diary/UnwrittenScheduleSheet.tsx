/**
 * UnwrittenScheduleSheet
 *
 * "일지 바로쓰기" FAB → 미작성 수업 목록 바텀시트 → diary 진입
 *
 * - GET /diaries/unwritten-slots (서버 이미 존재)
 * - 최근 날짜 우선 정렬 (서버 ascending → reverse)
 * - 선택 시 diary에 lessonDate + classGroupId + className + startTime 전달
 * - Empty state / loading / error 처리
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CalendarDays, CheckCircle2, X } from "lucide-react-native";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";

const C = Colors.light;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.72;
const DISMISS_THRESHOLD = 80;

const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_DAYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

interface UnwrittenSlot {
  classGroupId: string;
  className: string;
  scheduleTime: string; // "HH:MM"
  lessonDate: string;   // "YYYY-MM-DD"
  dayOfWeek: string;    // "월"..."일"
  studentCount: number;
}

interface Props {
  visible: boolean;
  token: string | null;
  onClose: () => void;
  backTo?: string;
}

function formatSlotDate(dateStr: string): string {
  // "2026-08-13" → "8/13 (목)"
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = KO_DAYS[d.getDay()];
  return `${m}/${day} (${dow})`;
}

export function UnwrittenScheduleSheet({ visible, token, onClose, backTo = "today-schedule" }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  const [slots, setSlots] = useState<UnwrittenSlot[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  // ── animation ──────────────────────────────────────────────────────────────
  const show = useCallback(() => {
    translateY.setValue(SHEET_HEIGHT);
    dragY.setValue(0);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  }, [translateY, dragY]);

  const hide = useCallback((cb?: () => void) => {
    Animated.timing(translateY, { toValue: SHEET_HEIGHT, duration: 220, useNativeDriver: true }).start(() => cb?.());
  }, [translateY]);

  useEffect(() => {
    if (visible) { show(); load(); }
  }, [visible]);

  // ── swipe to dismiss ────────────────────────────────────────────────────────
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

  // ── fetch ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!token) return;
    setStatus("loading");
    try {
      const res = await apiRequest(token, "/diaries/unwritten-slots");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      // 서버는 오름차순 → 최근 날짜 우선으로 reverse
      const reversed: UnwrittenSlot[] = [...(data.slots ?? [])].reverse();
      setSlots(reversed);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, [token]);

  // ── select ──────────────────────────────────────────────────────────────────
  const handleSelect = useCallback((slot: UnwrittenSlot) => {
    hide(() => {
      onClose();
      router.push({
        pathname: "/(teacher)/diary" as any,
        params: {
          classGroupId: slot.classGroupId,
          className:    slot.className,
          lessonDate:   slot.lessonDate,
          startTime:    slot.scheduleTime,
          backTo,
        },
      });
    });
  }, [hide, onClose, backTo]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={() => hide(onClose)}>
      {/* backdrop */}
      <Pressable style={s.backdrop} onPress={() => hide(onClose)} />

      <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + 8, transform: [{ translateY: Animated.add(translateY, dragY) }] }]}>
        {/* drag handle */}
        <View style={s.handleWrap} {...panResponder.panHandlers}>
          <View style={s.handle} />
        </View>

        {/* header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>작성할 수업 선택</Text>
          <Pressable onPress={() => hide(onClose)} hitSlop={8}>
            <X size={20} color={C.textSecondary} />
          </Pressable>
        </View>

        <Text style={s.headerSub}>일지를 작성할 수업을 선택해주세요.</Text>

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
        ) : slots.length === 0 ? (
          <View style={s.center}>
            <CheckCircle2 size={40} color={C.textTertiary} />
            <Text style={s.emptyTitle}>작성할 수업 일지가 없습니다.</Text>
            <Text style={s.emptyText}>모든 수업 일지가 작성되었습니다.</Text>
            <Pressable onPress={() => hide(onClose)} style={s.confirmBtn}>
              <Text style={s.confirmText}>확인</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {slots.map((slot, idx) => (
              <Pressable
                key={`${slot.classGroupId}_${slot.lessonDate}_${idx}`}
                style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
                onPress={() => handleSelect(slot)}
              >
                <View style={s.rowIcon}>
                  <CalendarDays size={18} color={C.primary} />
                </View>
                <View style={s.rowBody}>
                  <Text style={s.rowDate}>{formatSlotDate(slot.lessonDate)}</Text>
                  <Text style={s.rowInfo}>
                    {slot.scheduleTime ? `${slot.scheduleTime} · ` : ""}{slot.className}
                  </Text>
                </View>
                <View style={s.rowBadge}>
                  <Text style={s.rowBadgeText}>미작성</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: C.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 2,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Pretendard-SemiBold",
    color: C.text,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.backgroundSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.background,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowDate: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: C.text,
  },
  rowInfo: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
  },
  rowBadge: {
    backgroundColor: "#FFF0F0",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  rowBadgeText: {
    fontSize: 11,
    fontFamily: "Pretendard-Medium",
    color: "#E53935",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingBottom: 40,
  },
  emptyTitle: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: C.text,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
  },
  confirmBtn: {
    marginTop: 8,
    paddingHorizontal: 32,
    paddingVertical: 10,
    backgroundColor: C.primary,
    borderRadius: 10,
  },
  confirmText: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.backgroundSoft,
  },
  retryText: {
    fontSize: 13,
    fontFamily: "Pretendard-Medium",
    color: C.primary,
  },
});
