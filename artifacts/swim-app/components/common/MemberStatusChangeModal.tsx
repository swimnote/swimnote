/**
 * MemberStatusChangeModal — 공통 상태 변경 팝업
 * 관리자 + 선생님 양쪽에서 재사용
 *
 * 선생님 모드: 정상/미배정/연기/퇴원 (아카이브·영구삭제 제외)
 * 연기/퇴원 선택 시 → 즉시 이동 / 다음 달 이동 2단계 선택
 */
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

type ActionStatus = "active" | "unassigned" | "suspended" | "withdrawn";

interface Props {
  visible: boolean;
  studentId: string;
  studentName: string;
  currentStatus: string;
  pendingStatusChange?: string | null;
  pendingEffectiveMode?: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const OPTIONS = [
  { key: "active" as ActionStatus,    label: "정상",  sub: "active 상태로 복귀 (반 배정 유지)",    color: "#1F8F86", bg: "#DDF2EF", emoji: "✅", hasTiming: false },
  { key: "unassigned" as ActionStatus, label: "미배정", sub: "반 배정 해제, 미배정 대기 상태",      color: "#D96C6C", bg: "#F9DEDA", emoji: "📋", hasTiming: false },
  { key: "suspended" as ActionStatus,  label: "연기",  sub: "휴원 처리, 이동 시점 선택 가능",       color: "#B45309", bg: "#FFF1BF", emoji: "⏸️", hasTiming: true  },
  { key: "withdrawn" as ActionStatus,  label: "퇴원",  sub: "수강 종료, 이동 시점 선택 가능",       color: "#991B1B", bg: "#FEF2F2", emoji: "🚪", hasTiming: true  },
];

export function MemberStatusChangeModal({
  visible, studentId, studentName, currentStatus,
  pendingStatusChange, pendingEffectiveMode,
  onClose, onChanged,
}: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<"select" | "timing">("select");
  const [pickedStatus, setPickedStatus] = useState<ActionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setStep("select");
    setPickedStatus(null);
    setError(null);
    onClose();
  }

  function handleOptionPress(opt: typeof OPTIONS[number]) {
    setError(null);
    if (opt.hasTiming) {
      setPickedStatus(opt.key);
      setStep("timing");
    } else {
      doChange(opt.key, "immediate");
    }
  }

  async function doChange(status: ActionStatus, mode: "immediate" | "next_month") {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(token, `/students/${studentId}/change-status`, {
        method: "POST",
        body: JSON.stringify({ new_status: status, effective_mode: mode }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || d.message || "상태 변경에 실패했습니다.");
        setLoading(false);
        return;
      }
      setLoading(false);
      handleClose();
      onChanged();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setLoading(false);
    }
  }

  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextLabel = `${next.getFullYear()}년 ${next.getMonth() + 1}월`;
  const pickedLabel = pickedStatus === "suspended" ? "연기(휴원)" : "퇴원";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={m.overlay} onPress={handleClose} />
      <View style={m.sheet}>
        {loading ? (
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <ActivityIndicator color={C.tint} size="large" />
            <Text style={{ color: C.textSecondary, marginTop: 12, fontFamily: "Inter_400Regular" }}>처리 중...</Text>
          </View>
        ) : step === "select" ? (
          <>
            <Text style={m.title}>상태 변경</Text>
            <Text style={m.sub}>{studentName}님의 상태를 선택하세요</Text>

            {/* 현재 상태 + 예약 배지 */}
            <View style={{ flexDirection: "row", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {currentStatus === "active" && (
                <View style={[m.badge, { backgroundColor: "#DDF2EF" }]}>
                  <Text style={[m.badgeText, { color: "#1F8F86" }]}>현재: 정상</Text>
                </View>
              )}
              {currentStatus === "suspended" && (
                <View style={[m.badge, { backgroundColor: "#FFF1BF" }]}>
                  <Text style={[m.badgeText, { color: "#B45309" }]}>현재: 휴원</Text>
                </View>
              )}
              {currentStatus === "withdrawn" && (
                <View style={[m.badge, { backgroundColor: "#F6F3F1" }]}>
                  <Text style={[m.badgeText, { color: "#6F6B68" }]}>현재: 퇴원</Text>
                </View>
              )}
              {pendingStatusChange === "suspended" && pendingEffectiveMode === "next_month" && (
                <View style={[m.badge, { backgroundColor: "#FFFBEB" }]}>
                  <Text style={[m.badgeText, { color: "#B45309" }]}>휴원예정</Text>
                </View>
              )}
              {pendingStatusChange === "withdrawn" && pendingEffectiveMode === "next_month" && (
                <View style={[m.badge, { backgroundColor: "#FFF1F2" }]}>
                  <Text style={[m.badgeText, { color: "#D96C6C" }]}>퇴원예정</Text>
                </View>
              )}
            </View>

            {error && (
              <View style={m.errorBox}>
                <Feather name="alert-circle" size={14} color="#D96C6C" />
                <Text style={m.errorText}>{error}</Text>
              </View>
            )}

            <View style={{ gap: 8 }}>
              {OPTIONS.map(opt => (
                <Pressable key={opt.key} onPress={() => handleOptionPress(opt)}
                  style={[m.option, { backgroundColor: opt.bg, borderColor: opt.color + "40" }]}>
                  <View style={[m.optIcon, { backgroundColor: opt.color + "18" }]}>
                    <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[m.optLabel, { color: opt.color }]}>{opt.label}</Text>
                    <Text style={m.optSub}>{opt.sub}</Text>
                  </View>
                  {opt.hasTiming
                    ? <Feather name="clock" size={14} color={opt.color} />
                    : <Feather name="zap" size={14} color={opt.color} />
                  }
                </Pressable>
              ))}
            </View>

            <Pressable onPress={handleClose} style={m.cancelBtn}>
              <Text style={m.cancelText}>취소</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={m.title}>이동 시점 선택</Text>
            <Text style={m.sub}>{studentName}님의 {pickedLabel} 처리 시점을 선택하세요.</Text>

            {error && (
              <View style={m.errorBox}>
                <Feather name="alert-circle" size={14} color="#D96C6C" />
                <Text style={m.errorText}>{error}</Text>
              </View>
            )}

            <View style={{ gap: 10, marginTop: 8 }}>
              {/* 즉시 이동 */}
              <Pressable
                onPress={() => doChange(pickedStatus!, "immediate")}
                style={[m.option, { backgroundColor: "#FEF2F2", borderColor: "#991B1B40" }]}>
                <View style={[m.optIcon, { backgroundColor: "#F9DEDA" }]}>
                  <Feather name="zap" size={20} color="#991B1B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[m.optLabel, { color: "#991B1B" }]}>즉시 이동</Text>
                  <Text style={m.optSub}>지금 바로 {pickedLabel} 처리, 반 배정 즉시 해제</Text>
                </View>
              </Pressable>

              {/* 다음 달 이동 */}
              <Pressable
                onPress={() => doChange(pickedStatus!, "next_month")}
                style={[m.option, { backgroundColor: "#DFF3EC", borderColor: "#16A34A40" }]}>
                <View style={[m.optIcon, { backgroundColor: "#DCFCE7" }]}>
                  <Feather name="calendar" size={20} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[m.optLabel, { color: "#16A34A" }]}>다음 달부터 이동</Text>
                  <Text style={m.optSub}>{nextLabel}부터 {pickedLabel} 예약, 이번 달 수업 유지</Text>
                </View>
              </Pressable>
            </View>

            <Pressable onPress={() => { setStep("select"); setPickedStatus(null); setError(null); }} style={m.cancelBtn}>
              <Text style={m.cancelText}>뒤로</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const m = StyleSheet.create({
  overlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0,
                backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                padding: 24, paddingBottom: 40 },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text, textAlign: "center", marginBottom: 4 },
  sub:        { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center", marginBottom: 16 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  errorBox:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9DEDA", borderRadius: 10, padding: 10, marginBottom: 12 },
  errorText:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "#D96C6C", flex: 1 },
  option:     { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 14, padding: 14, borderWidth: 1.5 },
  optIcon:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  optLabel:   { fontSize: 15, fontFamily: "Inter_700Bold" },
  optSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  cancelBtn:  { alignItems: "center", marginTop: 16 },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textMuted },
});
