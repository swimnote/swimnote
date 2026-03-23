/**
 * UnifiedMemberCard — 모든 화면에서 사용하는 단일 공통 회원 카드
 *
 * 두 가지 독립 상태 배지 (절대 합치지 말 것):
 *   assignment_status  : 수업 미배정 여부 → nameRow psBadge (or 우측 보조 배지)
 *   parent_conn_status : 학부모미연결 여부 → 우측 별도 배지
 * → 두 배지는 동시에 표시 가능 (미배정 + 학부모미연결)
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import {
  StudentMember,
  getPrimaryStatus,
  getEffectiveWeekly,
  getMemberPendingBadge,
  PRIMARY_STATUS_BADGE,
  WEEKLY_BADGE,
} from "@/utils/studentUtils";

const C = Colors.light;

export interface MemberCardAction {
  label: string;
  icon: string;
  color: string;
  bg: string;
  onPress: () => void;
  loading?: boolean;
}

interface UnifiedMemberCardProps {
  student: StudentMember;
  themeColor?: string;
  /** 하단에 표시할 액션 버튼 목록 */
  actions?: MemberCardAction[];
  /** 카드 전체 onPress */
  onPress?: () => void;
  /** 초대 버튼 표시 */
  showInvite?: boolean;
  onPressInvite?: () => void;
  /** 선택 모드 */
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
  /** 퇴원일 표시 */
  showWithdrawnDate?: boolean;
  /** 선생님 정보 표시 여부 (반배정 화면에서 불필요할 때 false) */
  showTeacher?: boolean;
}

export function UnifiedMemberCard({
  student,
  themeColor = C.tint,
  actions,
  onPress,
  showInvite,
  onPressInvite,
  selectionMode,
  isSelected,
  onToggle,
  showWithdrawnDate,
  showTeacher = true,
}: UnifiedMemberCardProps) {
  const ps       = getPrimaryStatus(student);
  const wc       = getEffectiveWeekly(student);
  const psBadge  = PRIMARY_STATUS_BADGE[ps];
  const wcBadge  = WEEKLY_BADGE[wc];
  const pending  = getMemberPendingBadge(student);

  // ── 두 독립 상태 (절대 합치지 말 것) ──────────────────────────
  // assignment_status: 수업 미배정 여부 (suspended/withdrawn 포함, 모든 상태에서 독립 계산)
  const _ids = Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : [];
  const _wc  = typeof student.weekly_count === "number" && student.weekly_count > 0 ? student.weekly_count : 1;
  const isClassUnassigned = !(_ids.length > 0 && _ids.length >= _wc);
  // parent_connection_status: 학부모 앱 미연결 여부 (assignment_status와 완전 독립)
  const isUnlinked = !student.parent_user_id;
  // psBadge가 이미 "미배정"을 표시하는 경우 우측 보조 배지 중복 방지
  const showRightUnassigned = isClassUnassigned && ps !== "unassigned";

  const instructors = (student.assignedClasses || [])
    .map(c => c.instructor)
    .filter((v): v is string => !!v);
  const instructorLabel = [...new Set(instructors)].join(", ");

  const classNames =
    (student.assignedClasses || []).map(c => c.name).join(", ") ||
    student.class_group_name ||
    null;

  const handlePress = () => {
    if (selectionMode) onToggle?.();
    else onPress?.();
  };

  return (
    <Pressable
      style={[s.card, { backgroundColor: C.card }, isSelected && { borderWidth: 2, borderColor: themeColor }]}
      onPress={handlePress}
    >
      {/* ── 상단 영역 ── */}
      <View style={s.top}>
        {selectionMode && (
          <Pressable onPress={onToggle} style={s.checkWrap}>
            <View style={[s.checkbox, isSelected && { backgroundColor: themeColor, borderColor: themeColor }]}>
              {isSelected && <Feather name="check" size={12} color="#fff" />}
            </View>
          </Pressable>
        )}

        {/* 아바타 */}
        <View style={[s.avatar, { backgroundColor: psBadge.bg }]}>
          <Text style={[s.avatarText, { color: psBadge.color }]}>{student.name[0]}</Text>
        </View>

        {/* 중앙 텍스트 */}
        <View style={{ flex: 1, gap: 2 }}>
          {/* 이름 줄: 이름 + 대표상태 + 주횟수 + 예약배지 */}
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>{student.name}</Text>

            {/* 대표 상태 배지 */}
            <View style={[s.badge, { backgroundColor: psBadge.bg }]}>
              <Text style={[s.badgeTxt, { color: psBadge.color }]}>{psBadge.label}</Text>
            </View>

            {/* 주횟수 배지 (휴원·퇴원 제외 모든 회원) */}
            {ps !== "suspended" && ps !== "withdrawn" && (
              <View style={[s.badge, { backgroundColor: wcBadge.bg }]}>
                <Text style={[s.badgeTxt, { color: wcBadge.color }]}>{wcBadge.label}</Text>
              </View>
            )}

            {/* 예약 배지 (다음달 이동 예약 시) */}
            {pending && (
              <View style={[s.badge, { backgroundColor: pending.bg, borderWidth: 1, borderColor: pending.color + "40" }]}>
                <Feather name="clock" size={9} color={pending.color} />
                <Text style={[s.badgeTxt, { color: pending.color }]}>{pending.label}</Text>
              </View>
            )}
          </View>

          {/* 배정 반 */}
          {classNames ? (
            <Text style={s.classTxt} numberOfLines={1}>{classNames}</Text>
          ) : (
            <Text style={[s.classTxt, { color: C.textMuted }]}>수업 미배정</Text>
          )}

          {/* 선생님 */}
          {showTeacher && instructorLabel ? (
            <Text style={s.subTxt}>선생님: {instructorLabel}</Text>
          ) : null}

          {/* 보호자 */}
          {(student.parent_name || student.parent_phone) ? (
            <Text style={s.subTxt} numberOfLines={1}>
              보호자: {student.parent_name || ""}
              {student.parent_phone ? ` · ${student.parent_phone}` : ""}
            </Text>
          ) : null}

          {/* 퇴원일 */}
          {showWithdrawnDate && student.withdrawn_at && (
            <Text style={[s.subTxt, { color: "#D96C6C" }]}>
              퇴원 {String(student.withdrawn_at).slice(0, 10)}
            </Text>
          )}
        </View>

        {/* 우측: 미배정 보조 배지 (suspended/withdrawn이면서 미배정) + 학부모미연결 배지 (완전 독립) */}
        <View style={s.right}>
          {showRightUnassigned && (
            <View style={[s.badge, { backgroundColor: "#FEE2E2", gap: 3 }]}>
              <Feather name="alert-circle" size={9} color="#DC2626" />
              <Text style={[s.badgeTxt, { color: "#DC2626" }]}>미배정</Text>
            </View>
          )}
          {isUnlinked && (
            <View style={[s.badge, { backgroundColor: "#FFF1BF", gap: 3 }]}>
              <Feather name="user-x" size={9} color="#EA580C" />
              <Text style={[s.badgeTxt, { color: "#EA580C" }]}>학부모미연결</Text>
            </View>
          )}
          {showInvite && !student.parent_user_id && (
            <Pressable style={[s.iconBtn, { backgroundColor: themeColor + "15" }]} onPress={onPressInvite}>
              <Feather name="mail" size={13} color={themeColor} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── 하단 액션 버튼들 (선택 모드 아닐 때만) ── */}
      {!selectionMode && (actions || onPress) && (
        <View style={s.bottom}>
          {actions?.map((act, i) => (
            <Pressable
              key={i}
              style={[s.actionBtn, { backgroundColor: act.bg }]}
              onPress={act.onPress}
              disabled={act.loading}
            >
              {act.loading ? (
                <ActivityIndicator size={12} color={act.color} />
              ) : (
                <Feather name={act.icon as any} size={12} color={act.color} />
              )}
              <Text style={[s.actionTxt, { color: act.color }]}>{act.label}</Text>
            </Pressable>
          ))}
          {/* 상세 보기 버튼 */}
          {onPress && (
            <Pressable
              style={[s.actionBtn, { backgroundColor: themeColor + "12", marginLeft: "auto" }]}
              onPress={onPress}
            >
              <Feather name="eye" size={12} color={themeColor} />
              <Text style={[s.actionTxt, { color: themeColor }]}>상세</Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

/** @alias UnifiedMemberCard (하위 호환) */
export const MemberCard = UnifiedMemberCard;

const s = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 13,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  top:        { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkWrap:  { paddingTop: 2 },
  checkbox:   { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  avatar:     { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  nameRow:    { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, marginBottom: 1 },
  name:       { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  badge:      { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  classTxt:   { fontSize: 13, fontFamily: "Inter_400Regular", color: C.text },
  subTxt:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  right:      { alignItems: "flex-end", gap: 6 },
  iconBtn:    { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bottom:     { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  actionBtn:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionTxt:  { fontSize: 12, fontFamily: "Inter_500Medium" },
});
