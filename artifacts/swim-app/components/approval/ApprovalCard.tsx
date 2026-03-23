/**
 * ApprovalCard — 승인/거절/대기 카드 공통 컴포넌트
 *
 * 학부모 승인 · 선생님 승인 · 수영장 승인 모두 이 컴포넌트로 통일.
 * 버튼 구조: [보기] 항상 표시 + [승인] 대기 상태에만 표시
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { STATUS_COLORS, StatusKey } from "@/components/common/constants";

const C = Colors.light;

export interface ApprovalCardMeta {
  id: string;
  name: string;
  sub1?: string;
  sub2?: string;
  requestedAt?: string;
  statusKey: StatusKey;
  accentColor?: string;
  avatarIcon?: React.ComponentProps<typeof Feather>["name"];
  avatarInitial?: string;
  rejectionReason?: string;
  /** 승인 버튼 노출 여부 (대기 상태일 때 true) */
  showActions?: boolean;
  processing?: boolean;
}

interface ApprovalCardProps {
  meta: ApprovalCardMeta;
  extra?: React.ReactNode;
  onApprove?: () => void;
  /** 보기 팝업 열기 */
  onView?: () => void;
}

export function ApprovalCard({ meta, extra, onApprove, onView }: ApprovalCardProps) {
  const cfg = STATUS_COLORS[meta.statusKey] ?? STATUS_COLORS.pending;
  const accent = meta.accentColor ?? cfg.color;
  const hasActions = meta.showActions || !!onView;

  return (
    <View style={[s.card, { backgroundColor: C.card, borderLeftColor: accent }]}>
      {/* 상단: 아바타 + 이름 + 상태 배지 */}
      <View style={s.top}>
        <View style={[s.avatar, { backgroundColor: cfg.bg }]}>
          {meta.avatarInitial ? (
            <Text style={[s.avatarText, { color: cfg.color }]}>{meta.avatarInitial}</Text>
          ) : (
            <Feather name={meta.avatarIcon ?? "user"} size={18} color={cfg.color} />
          )}
        </View>

        <View style={s.info}>
          <Text style={s.name} numberOfLines={1}>{meta.name}</Text>
          {meta.sub1 ? <Text style={s.sub} numberOfLines={1}>{meta.sub1}</Text> : null}
          {meta.sub2 ? <Text style={s.sub2} numberOfLines={1}>{meta.sub2}</Text> : null}
          {meta.requestedAt ? (
            <Text style={s.date}>
              {new Date(meta.requestedAt).toLocaleDateString("ko-KR")} 요청
            </Text>
          ) : null}
        </View>

        <View style={[s.badge, { backgroundColor: cfg.bg }]}>
          <Feather name={cfg.icon} size={11} color={cfg.color} />
          <Text style={[s.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>

      {/* 추가 정보 */}
      {extra ? <View style={[s.extra, { borderTopColor: C.border }]}>{extra}</View> : null}

      {/* 거절/비활성 사유 */}
      {meta.rejectionReason ? (
        <View style={[s.rejectNote, { backgroundColor: "#F9DEDA", borderTopColor: C.border }]}>
          <Feather name="alert-circle" size={12} color={C.error} />
          <Text style={[s.rejectNoteText, { color: C.error }]} numberOfLines={2}>
            거절 사유: {meta.rejectionReason}
          </Text>
        </View>
      ) : null}

      {/* 버튼 영역: [보기] 항상 + [승인] 대기 상태 */}
      {hasActions ? (
        <View style={[s.actions, { borderTopColor: C.border }]}>
          {onView ? (
            <Pressable
              style={({ pressed }) => [s.viewBtn, { borderColor: C.border, opacity: pressed ? 0.75 : 1 }]}
              onPress={onView}
              disabled={meta.processing}
            >
              <Feather name="eye" size={14} color={C.textSecondary} />
              <Text style={[s.viewText, { color: C.textSecondary }]}>보기</Text>
            </Pressable>
          ) : null}

          {meta.showActions && onApprove ? (
            <Pressable
              style={({ pressed }) => [s.approveBtn, { backgroundColor: C.success, opacity: pressed ? 0.8 : 1 }]}
              onPress={onApprove}
              disabled={meta.processing}
            >
              {meta.processing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="check" size={14} color="#fff" />
                  <Text style={s.approveText}>승인</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 14,
    backgroundColor: "#fff",
    borderLeftWidth: 4,
    overflow: "hidden",
  },
  top: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    minHeight: 80,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  sub:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6F6B68" },
  sub2: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9A948F" },
  date: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9A948F" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    flexShrink: 0,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  extra: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rejectNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rejectNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  actions: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    height: 68,
    alignItems: "center",
  },
  viewBtn: {
    flex: 1, height: 44, flexDirection: "row",
    borderWidth: 1.5, borderRadius: 10,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  viewText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  approveBtn: {
    flex: 1, height: 44, flexDirection: "row",
    borderRadius: 10,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  approveText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
