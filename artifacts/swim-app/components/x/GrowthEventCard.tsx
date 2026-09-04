/**
 * GrowthEventCard — WP9 / WP13
 *
 * Growth Event 목록 카드 컴포넌트.
 *
 * WP13 추가:
 *   - showReviewButtons=true + status=PENDING_REVIEW 일 때 [승인] [제외] 버튼 표시
 *   - parent에는 showReviewButtons 전달 금지 (화면 레이어에서 제어)
 *   - reviewingId === event_id 이면 버튼 disabled/loading
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import {
  type GrowthEvent,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
} from "@/hooks/useGrowthEvents";

const C                = Colors.light;
// X 전용 토큰 — A1 Theme Polish (Steel Blue)
const X_ACCENT         = "#355C7D";
const X_ACCENT_LIGHT   = "#E9EEF3";
const NAVY             = "#14283D";
const GREEN            = "#10B981";
const RED              = "#EF4444";

interface Props {
  event:              GrowthEvent;
  onPress:            (event: GrowthEvent) => void;
  /** teacher/admin 화면에서만 true 전달. parent는 반드시 생략(false). */
  showReviewButtons?: boolean;
  /** 부모 화면에서 PATCH API 처리. eventId + action 전달. */
  onReview?:          (eventId: string, action: "accept" | "reject") => void;
  /** 현재 처리 중인 eventId. 이 값이 event.event_id와 같으면 버튼 disabled. */
  reviewingId?:       string | null;
}

function _formatDate(iso: string): string {
  try {
    const d   = new Date(iso);
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h   = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}.${m}.${day} ${h}:${min}`;
  } catch {
    return iso;
  }
}

export function GrowthEventCard({
  event,
  onPress,
  showReviewButtons = false,
  onReview,
  reviewingId = null,
}: Props) {
  const statusLabel = STATUS_LABELS[event.status] ?? event.status;
  const statusColor = STATUS_COLORS[event.status] ?? { bg: "#F1F5F9", text: "#64748B" };
  const sourceLabel = SOURCE_LABELS[event.source] ?? event.source;

  const isPending  = event.status === "PENDING_REVIEW";
  const isReviewing = reviewingId === event.event_id;
  const showBtns   = showReviewButtons && isPending && !!onReview;

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
          <LucideIcon name="zap" size={10} color={X_ACCENT} />
          <Text style={s.sourceTxt}>{sourceLabel}</Text>
        </View>

        <Text style={s.dateTxt}>{_formatDate(event.created_at)}</Text>
      </View>

      {/* curriculum 정보 */}
      {event.curriculum_title ? (
        <View style={s.currRow}>
          <LucideIcon name="book-open" size={13} color={X_ACCENT} />
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

      {/* WP13: PENDING_REVIEW 검토 버튼 */}
      {showBtns ? (
        <View style={s.reviewRow}>
          {isReviewing ? (
            <ActivityIndicator size="small" color={X_ACCENT} style={{ marginVertical: 4 }} />
          ) : (
            <>
              <Pressable
                style={[s.reviewBtn, s.acceptBtn]}
                disabled={isReviewing}
                onPress={(e) => { e.stopPropagation?.(); onReview!(event.event_id, "accept"); }}
              >
                <LucideIcon name="check" size={13} color="#fff" />
                <Text style={s.reviewBtnTxt}>승인</Text>
              </Pressable>
              <Pressable
                style={[s.reviewBtn, s.rejectBtn]}
                disabled={isReviewing}
                onPress={(e) => { e.stopPropagation?.(); onReview!(event.event_id, "reject"); }}
              >
                <LucideIcon name="x" size={13} color="#fff" />
                <Text style={s.reviewBtnTxt}>제외</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        /* 화살표 (review 버튼이 없을 때만) */
        <View style={s.arrowWrap}>
          <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
        </View>
      )}
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
    backgroundColor: X_ACCENT_LIGHT,
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
  // WP13 review buttons
  reviewRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  reviewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  acceptBtn: { backgroundColor: GREEN },
  rejectBtn: { backgroundColor: RED },
  reviewBtnTxt: {
    fontSize: 13,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
  arrowWrap: {
    position: "absolute",
    right: 14,
    top: "50%",
  },
});
