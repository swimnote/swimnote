/**
 * GrowthEventDetail — WP9
 *
 * Growth Event 상세 모달.
 *
 * - 실제 API contract 필드만 표시 (내부 ID는 표시하지 않음)
 * - WP9 scope: READ ONLY (승인/거절 버튼 없음)
 * - WP8 detail endpoint 사용 (GET .../events/:eventId)
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import {
  type GrowthEvent,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
} from "@/hooks/useGrowthEvents";

const C = Colors.light;
const MINT       = "#2EC4B6";
const MINT_LIGHT = "#E6FAF8";
const NAVY       = "#0F172A";

interface Props {
  visible:   boolean;
  eventId:   string | null;
  studentId: string | null;
  onClose:   () => void;
}

type DetailState = "loading" | "error" | "success";

function _formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function GrowthEventDetail({ visible, eventId, studentId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [event,  setEvent]  = useState<GrowthEvent | null>(null);
  const [state,  setState]  = useState<DetailState>("loading");

  useEffect(() => {
    if (!visible || !eventId || !studentId || !token) return;
    let cancelled = false;

    setState("loading");
    setEvent(null);

    apiRequest(token, `/x-growth/students/${studentId}/events/${eventId}`, { _noCache: true })
      .then(async res => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`http_${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setEvent(data.event as GrowthEvent);
        setState("success");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => { cancelled = true; };
  }, [visible, eventId, studentId, token]);

  const statusLabel = event ? (STATUS_LABELS[event.status] ?? event.status) : "";
  const statusColor = event ? (STATUS_COLORS[event.status] ?? { bg: "#F1F5F9", text: "#64748B" }) : { bg: "#F1F5F9", text: "#64748B" };
  const sourceLabel = event ? (SOURCE_LABELS[event.source] ?? event.source) : "";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.root, { paddingTop: insets.top + 16 }]}>
        {/* 헤더 */}
        <View style={s.header}>
          <Text style={s.headerTitle}>성장 이벤트 상세</Text>
          <Pressable onPress={onClose} hitSlop={12} style={s.closeBtn}>
            <LucideIcon name="x" size={20} color={NAVY} />
          </Pressable>
        </View>

        {/* 내용 */}
        {state === "loading" && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={MINT} />
          </View>
        )}

        {state === "error" && (
          <View style={s.center}>
            <LucideIcon name="alert-circle" size={36} color="#EF4444" />
            <Text style={s.errorTxt}>데이터를 불러오지 못했습니다.</Text>
          </View>
        )}

        {state === "success" && event && (
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* status + source */}
            <View style={s.badgeRow}>
              <View style={[s.statusBadge, { backgroundColor: statusColor.bg }]}>
                <Text style={[s.statusTxt, { color: statusColor.text }]}>
                  {statusLabel}
                </Text>
              </View>
              <View style={s.sourceChip}>
                <LucideIcon name="zap" size={11} color={MINT} />
                <Text style={s.sourceTxt}>{sourceLabel}</Text>
              </View>
            </View>

            {/* curriculum */}
            {event.curriculum_title ? (
              <View style={s.section}>
                <Text style={s.sectionLabel}>커리큘럼 항목</Text>
                <View style={s.infoBox}>
                  <LucideIcon name="book-open" size={15} color={MINT} />
                  <Text style={s.infoTxt}>{event.curriculum_title}</Text>
                </View>
              </View>
            ) : null}

            {/* 날짜 */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>기록 시각</Text>
              <Text style={s.sectionValue}>{_formatDate(event.created_at)}</Text>
            </View>

            {/* 일치도 */}
            {event.confidence != null ? (
              <View style={s.section}>
                <Text style={s.sectionLabel}>AI 일치도</Text>
                <Text style={s.sectionValue}>
                  {Math.round(event.confidence * 100)}%
                </Text>
              </View>
            ) : null}

            {/* 일지 연결 여부 */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>일지 연결</Text>
              <Text style={s.sectionValue}>
                {event.diary_note_id ? "연결됨" : "없음"}
              </Text>
            </View>

            {/* X 배지 */}
            <View style={s.xBadgeRow}>
              <View style={s.xBadge}>
                <Text style={s.xBadgeTxt}>SWIMNOTE X</Text>
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Pretendard-SemiBold",
    color: NAVY,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.backgroundSoft,
    alignItems: "center", justifyContent: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorTxt: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
  },
  scroll: {
    padding: 20,
    gap: 20,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusTxt: {
    fontSize: 13,
    fontFamily: "Pretendard-SemiBold",
    lineHeight: 18,
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: MINT_LIGHT,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sourceTxt: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: NAVY,
    lineHeight: 18,
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
  },
  sectionValue: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    color: NAVY,
    lineHeight: 22,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: MINT_LIGHT,
    borderRadius: 10,
    padding: 12,
  },
  infoTxt: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: NAVY,
    flex: 1,
    lineHeight: 20,
  },
  xBadgeRow: {
    alignItems: "center",
    marginTop: 12,
  },
  xBadge: {
    backgroundColor: MINT_LIGHT,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: MINT,
  },
  xBadgeTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-SemiBold",
    color: NAVY,
  },
});
