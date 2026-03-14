/**
 * ApprovalCard — 승인/거절/대기 카드 공통 컴포넌트
 *
 * 학부모 승인 · 선생님 승인 · 수영장 승인 모두 이 컴포넌트로 통일.
 * 카드 높이/간격/버튼은 항상 동일.
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
  /** 카드 고유 ID */
  id: string;
  /** 이름(표시용) */
  name: string;
  /** 부제목 라인 1 (전화번호 등) */
  sub1?: string;
  /** 부제목 라인 2 (이메일/직위 등) */
  sub2?: string;
  /** 요청 날짜 문자열 */
  requestedAt?: string;
  /** 상태 키 */
  statusKey: StatusKey;
  /** 왼쪽 테두리 색상 오버라이드 */
  accentColor?: string;
  /** 아바타 이니셜 대신 아이콘을 쓸 때 */
  avatarIcon?: React.ComponentProps<typeof Feather>["name"];
  /** 아바타 이니셜 */
  avatarInitial?: string;
  /** 거절 사유 */
  rejectionReason?: string;
  /** 승인/거절 버튼 노출 여부 */
  showActions?: boolean;
  /** 처리 중 여부 */
  processing?: boolean;
}

interface ApprovalCardProps {
  meta: ApprovalCardMeta;
  /** 카드 내부 추가 콘텐츠 (자녀 정보 등) */
  extra?: React.ReactNode;
  onApprove?: () => void;
  onReject?: () => void;
}

export function ApprovalCard({ meta, extra, onApprove, onReject }: ApprovalCardProps) {
  const cfg = STATUS_COLORS[meta.statusKey] ?? STATUS_COLORS.pending;
  const accent = meta.accentColor ?? cfg.color;

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

      {/* 추가 정보 (자녀 정보, 서류 상태 등) */}
      {extra ? <View style={[s.extra, { borderTopColor: C.border }]}>{extra}</View> : null}

      {/* 거절 사유 */}
      {meta.rejectionReason ? (
        <View style={[s.rejectNote, { backgroundColor: "#FEE2E2", borderTopColor: C.border }]}>
          <Feather name="alert-circle" size={12} color={C.error} />
          <Text style={[s.rejectNoteText, { color: C.error }]} numberOfLines={2}>
            거절 사유: {meta.rejectionReason}
          </Text>
        </View>
      ) : null}

      {/* 승인/거절 버튼 */}
      {meta.showActions ? (
        <View style={[s.actions, { borderTopColor: C.border }]}>
          <Pressable
            style={({ pressed }) => [s.rejectBtn, { borderColor: C.error, opacity: pressed ? 0.8 : 1 }]}
            onPress={onReject}
            disabled={meta.processing}
          >
            {meta.processing ? (
              <ActivityIndicator size="small" color={C.error} />
            ) : (
              <>
                <Feather name="x" size={14} color={C.error} />
                <Text style={[s.rejectText, { color: C.error }]}>거절</Text>
              </>
            )}
          </Pressable>
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
  name: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280" },
  sub2: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  date: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
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
  rejectBtn: {
    flex: 1, height: 44, flexDirection: "row",
    borderWidth: 1.5, borderRadius: 10,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  rejectText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  approveBtn: {
    flex: 1, height: 44, flexDirection: "row",
    borderRadius: 10,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  approveText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
