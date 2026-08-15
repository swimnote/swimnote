/**
 * GrowthEventDetail — WP9 / WP13
 *
 * Growth Event 상세 모달.
 *
 * WP13 추가:
 *   - canReview=true + status=PENDING_REVIEW 이면 [승인] [제외] 버튼 표시
 *   - API 직접 호출 → 성공 시 로컬 상태 업데이트 + onReviewSuccess 콜백
 *   - 실패 시 원래 상태 유지 + 에러 메시지
 *   - parent에는 canReview 전달 금지 (화면 레이어에서 제어)
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const C                = Colors.light;
// X 전용 토큰 — A1 Theme Polish (Steel Blue)
const MINT             = "#355C7D";   // xAccent
const MINT_LIGHT       = "#E9EEF3";   // xAccentLight
const NAVY             = "#23415C";   // xAccentStrong
const GREEN            = "#10B981";
const RED              = "#EF4444";

interface Props {
  visible:          boolean;
  eventId:          string | null;
  studentId:        string | null;
  onClose:          () => void;
  /** teacher/admin 화면만 true 전달. parent 금지. */
  canReview?:       boolean;
  /** 승인/거절 성공 시 부모 화면에 알림 (목록 refresh용) */
  onReviewSuccess?: (eventId: string, newStatus: string) => void;
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

export function GrowthEventDetail({
  visible,
  eventId,
  studentId,
  onClose,
  canReview   = false,
  onReviewSuccess,
}: Props) {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [event,       setEvent]       = useState<GrowthEvent | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("loading");
  const [reviewing,   setReviewing]   = useState<"accept" | "reject" | null>(null);

  // 모달이 닫힐 때 review 상태 초기화
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!visible || !eventId || !studentId || !token) return;
    cancelledRef.current = false;

    setDetailState("loading");
    setEvent(null);
    setReviewing(null);

    apiRequest(token, `/x-growth/students/${studentId}/events/${eventId}`, { _noCache: true })
      .then(async res => {
        if (cancelledRef.current) return;
        if (!res.ok) throw new Error(`http_${res.status}`);
        const data = await res.json();
        if (cancelledRef.current) return;
        setEvent(data.event as GrowthEvent);
        setDetailState("success");
      })
      .catch(() => {
        if (!cancelledRef.current) setDetailState("error");
      });

    return () => { cancelledRef.current = true; };
  }, [visible, eventId, studentId, token]);

  // WP13: review API 호출
  async function handleReview(action: "accept" | "reject") {
    if (!token || !event || !studentId || reviewing) return;
    setReviewing(action);
    try {
      const res = await apiRequest(
        token,
        `/x-growth/students/${studentId}/events/${event.event_id}/review`,
        {
          method: "PATCH",
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = body?.error ?? `http_${res.status}`;
        if (code === "invalid_transition") {
          Alert.alert("변경 불가", "이미 검토가 완료된 이벤트입니다.");
        } else if (code === "event_invalidated") {
          Alert.alert("처리 불가", "무효화된 이벤트입니다.");
        } else {
          Alert.alert("오류", "처리 중 오류가 발생했습니다. 다시 시도해 주세요.");
        }
        return;
      }
      const data = await res.json();
      const newStatus: string = data.new_status ?? (action === "accept" ? "TEACHER_ACCEPTED" : "TEACHER_REJECTED");
      // 로컬 상태 업데이트
      setEvent(prev => prev ? { ...prev, status: newStatus } : prev);
      onReviewSuccess?.(event.event_id, newStatus);
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setReviewing(null);
    }
  }

  const statusLabel = event ? (STATUS_LABELS[event.status] ?? event.status) : "";
  const statusColor = event ? (STATUS_COLORS[event.status] ?? { bg: "#F1F5F9", text: "#64748B" }) : { bg: "#F1F5F9", text: "#64748B" };
  const sourceLabel = event ? (SOURCE_LABELS[event.source] ?? event.source) : "";
  const isPending   = event?.status === "PENDING_REVIEW";
  const showBtns    = canReview && isPending;

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
        {detailState === "loading" && (
          <View style={s.center}>
            <ActivityIndicator size="large" color={MINT} />
          </View>
        )}

        {detailState === "error" && (
          <View style={s.center}>
            <LucideIcon name="alert-circle" size={36} color="#EF4444" />
            <Text style={s.errorTxt}>데이터를 불러오지 못했습니다.</Text>
          </View>
        )}

        {detailState === "success" && event && (
          <>
            <ScrollView
              contentContainerStyle={[s.scroll, { paddingBottom: showBtns ? 16 : insets.bottom + 32 }]}
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

            {/* WP13: PENDING_REVIEW 검토 버튼 (하단 고정) */}
            {showBtns && (
              <View style={[s.reviewFooter, { paddingBottom: insets.bottom + 12 }]}>
                {reviewing ? (
                  <View style={s.reviewLoadingRow}>
                    <ActivityIndicator color={MINT} />
                    <Text style={s.reviewLoadingTxt}>처리 중...</Text>
                  </View>
                ) : (
                  <View style={s.reviewBtnRow}>
                    <Pressable
                      style={[s.reviewBtn, s.rejectBtn]}
                      onPress={() => handleReview("reject")}
                    >
                      <LucideIcon name="x" size={16} color="#fff" />
                      <Text style={s.reviewBtnTxt}>제외</Text>
                    </Pressable>
                    <Pressable
                      style={[s.reviewBtn, s.acceptBtn]}
                      onPress={() => handleReview("accept")}
                    >
                      <LucideIcon name="check" size={16} color="#fff" />
                      <Text style={s.reviewBtnTxt}>승인</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </>
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
  // WP13 review footer
  reviewFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  reviewBtnRow: {
    flexDirection: "row",
    gap: 10,
  },
  reviewBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingVertical: 13,
  },
  acceptBtn: { backgroundColor: GREEN },
  rejectBtn: { backgroundColor: RED },
  reviewBtnTxt: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: "#fff",
  },
  reviewLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
  },
  reviewLoadingTxt: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
  },
});
