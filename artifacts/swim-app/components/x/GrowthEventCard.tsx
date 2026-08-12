/**
 * GrowthEventCard — WP9
 *
 * Growth Event 목록 카드 컴포넌트.
 *
 * - API contract 기반 필드만 표시 (가짜 데이터 생성 금지)
 * - status badge: enum → 한국어 label 변환
 * - curriculum_title: null이면 표시 안 함
 * - confidence: null이면 표시 안 함
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
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
  event:   GrowthEvent;
  onPress: (event: GrowthEvent) => void;
}

function _formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}.${m}.${day} ${h}:${min}`;
  } catch {
    return iso;
  }
}

export function GrowthEventCard({ event, onPress }: Props) {
  const statusLabel = STATUS_LABELS[event.status] ?? event.status;
  const statusColor = STATUS_COLORS[event.status] ?? { bg: "#F1F5F9", text: "#64748B" };
  const sourceLabel = SOURCE_LABELS[event.source] ?? event.source;

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
      onPress={() => onPress(event)}
    >
      {/* 상단: status badge + source + 날짜 */}
      <View style={s.topRow}>
        <View style={[s.statusBadge, { backgroundColor: statusColor.bg }]}>
          <Text style={[s.statusTxt, { color: statusColor.text }]}>
            {statusLabel}
          </Text>
        </View>

        <View style={s.sourceChip}>
          <LucideIcon name="zap" size={10} color={MINT} />
          <Text style={s.sourceTxt}>{sourceLabel}</Text>
        </View>

        <Text style={s.dateTxt}>{_formatDate(event.created_at)}</Text>
      </View>

      {/* curriculum 정보 */}
      {event.curriculum_title ? (
        <View style={s.currRow}>
          <LucideIcon name="book-open" size={13} color={MINT} />
          <Text style={s.currTxt} numberOfLines={1}>{event.curriculum_title}</Text>
        </View>
      ) : null}

      {/* confidence */}
      {event.confidence != null ? (
        <View style={s.confRow}>
          <Text style={s.confLabel}>일치도</Text>
          <Text style={s.confValue}>
            {Math.round(event.confidence * 100)}%
          </Text>
        </View>
      ) : null}

      {/* 화살표 */}
      <View style={s.arrowWrap}>
        <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  statusTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-SemiBold",
    lineHeight: 16,
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: MINT_LIGHT,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sourceTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: NAVY,
    lineHeight: 16,
  },
  dateTxt: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    marginLeft: "auto",
  },
  currRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  currTxt: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: NAVY,
    flex: 1,
    lineHeight: 18,
  },
  confRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  confLabel: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
  },
  confValue: {
    fontSize: 11,
    fontFamily: "Pretendard-SemiBold",
    color: NAVY,
  },
  arrowWrap: {
    position: "absolute",
    right: 14,
    top: "50%",
  },
});
