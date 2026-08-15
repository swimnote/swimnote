/**
 * MemberStatusChangeModal — 공통 상태 변경 팝업
 * 관리자 + 선생님 양쪽에서 재사용
 *
 * 선생님 모드: 정상/미배정/연기/퇴원 (아카이브·영구삭제 제외)
 * 연기/퇴원 선택 시 → 즉시 이동 / 다음 달 이동 2단계 선택
 * 정상(active) 복귀 선택 시 → 복귀일 달력 선택 단계
 */
import React, { useState } from "react";
import { LucideIcon } from "@/components/common/LucideIcon";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

type ActionStatus = "active" | "unassigned" | "suspended" | "withdrawn";
type Step = "select" | "timing" | "datepick";

interface Props {
  visible: boolean;
  studentId: string;
  studentName: string;
  currentStatus: string;
  pendingStatusChange?: string | null;
  pendingEffectiveMode?: string | null;
  onClose: () => void;
  onChanged: (result: { status: ActionStatus; mode: "immediate" | "next_month" }) => void;
}

const OPTIONS = [
  { key: "active" as ActionStatus,    label: "정상",  sub: "active 상태로 복귀 (복귀일 선택)",      color: "#2EC4B6", bg: "#E6FFFA", emoji: "✅", hasTiming: false },
  { key: "unassigned" as ActionStatus, label: "미배정", sub: "반 배정 해제, 미배정 대기 상태",      color: "#D96C6C", bg: "#F9DEDA", emoji: "📋", hasTiming: false },
  { key: "suspended" as ActionStatus,  label: "연기",  sub: "연기 처리, 이동 시점 선택 가능",       color: "#B45309", bg: "#FFF1BF", emoji: "⏸️", hasTiming: true  },
  { key: "withdrawn" as ActionStatus,  label: "퇴원",  sub: "수강 종료, 이동 시점 선택 가능",       color: "#991B1B", bg: "#FEF2F2", emoji: "🚪", hasTiming: true  },
];

const WEEK_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MemberStatusChangeModal({
  visible, studentId, studentName, currentStatus,
  pendingStatusChange, pendingEffectiveMode,
  onClose, onChanged,
}: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<Step>("select");
  const [pickedStatus, setPickedStatus] = useState<ActionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 복귀일 달력 상태
  const todayDate = new Date();
  const [calYear, setCalYear]     = useState(todayDate.getFullYear());
  const [calMonth, setCalMonth]   = useState(todayDate.getMonth());
  const [calSelected, setCalSelected] = useState(toYMD(todayDate));

  function handleClose() {
    setStep("select");
    setPickedStatus(null);
    setError(null);
    onClose();
  }

  function handleOptionPress(opt: typeof OPTIONS[number]) {
    setError(null);
    if (opt.key === "active") {
      // 복귀일 달력 선택 단계
      const today = new Date();
      setCalYear(today.getFullYear());
      setCalMonth(today.getMonth());
      setCalSelected(toYMD(today));
      setPickedStatus("active");
      setStep("datepick");
    } else if (opt.hasTiming) {
      setPickedStatus(opt.key);
      setStep("timing");
    } else {
      doChange(opt.key, "immediate");
    }
  }

  async function doChange(status: ActionStatus, mode: "immediate" | "next_month", resumeDate?: string) {
    setError(null);
    setStep("select");
    setPickedStatus(null);
    onClose();
    try {
      const body: Record<string, string> = { new_status: status, effective_mode: mode };
      if (resumeDate) body.resume_date = resumeDate;
      const res = await apiRequest(token, `/students/${studentId}/change-status`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onChanged({ status, mode });
      }
    } catch { /* 실패 시 부모가 다음 갱신 시 자동 복구 */ }
  }

  // 달력 빌더
  function buildCalCells() {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: Array<number | null> = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextLabel = `${next.getFullYear()}년 ${next.getMonth() + 1}월`;
  const pickedLabel = pickedStatus === "suspended" ? "연기" : "퇴원";
  const todayStr = toYMD(todayDate);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
      <Pressable style={m.overlay} onPress={handleClose} />
      <View style={m.sheet}>
        {step === "select" && (
          <>
            <Text style={m.title}>상태 변경</Text>
            <Text style={m.sub}>{studentName}님의 상태를 선택하세요</Text>

            <View style={{ flexDirection: "row", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {currentStatus === "active" && (
                <View style={[m.badge, { backgroundColor: "#E6FFFA" }]}>
                  <Text style={[m.badgeText, { color: "#2EC4B6" }]}>현재: 정상</Text>
                </View>
              )}
              {currentStatus === "suspended" && (
                <View style={[m.badge, { backgroundColor: "#FFF1BF" }]}>
                  <Text style={[m.badgeText, { color: "#B45309" }]}>현재: 연기</Text>
                </View>
              )}
              {currentStatus === "withdrawn" && (
                <View style={[m.badge, { backgroundColor: "#FFFFFF" }]}>
                  <Text style={[m.badgeText, { color: "#64748B" }]}>현재: 퇴원</Text>
                </View>
              )}
              {pendingStatusChange === "suspended" && pendingEffectiveMode === "next_month" && (
                <View style={[m.badge, { backgroundColor: "#FFFBEB" }]}>
                  <Text style={[m.badgeText, { color: "#B45309" }]}>연기예정</Text>
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
                <LucideIcon name="alert-circle" size={14} color="#D96C6C" />
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
                  {opt.key === "active"
                    ? <LucideIcon name="calendar" size={14} color={opt.color} />
                    : opt.hasTiming
                      ? <LucideIcon name="clock" size={14} color={opt.color} />
                      : <LucideIcon name="zap" size={14} color={opt.color} />
                  }
                </Pressable>
              ))}
            </View>

            <Pressable onPress={handleClose} style={m.cancelBtn}>
              <Text style={m.cancelText}>취소</Text>
            </Pressable>
          </>
        )}

        {step === "timing" && (
          <>
            <Text style={m.title}>이동 시점 선택</Text>
            <Text style={m.sub}>{studentName}님의 {pickedLabel} 처리 시점을 선택하세요.</Text>

            {error && (
              <View style={m.errorBox}>
                <LucideIcon name="alert-circle" size={14} color="#D96C6C" />
                <Text style={m.errorText}>{error}</Text>
              </View>
            )}

            <View style={{ gap: 10, marginTop: 8 }}>
              <Pressable
                onPress={() => doChange(pickedStatus!, "immediate")}
                style={[m.option, { backgroundColor: "#FEF2F2", borderColor: "#991B1B40" }]}>
                <View style={[m.optIcon, { backgroundColor: "#F9DEDA" }]}>
                  <LucideIcon name="zap" size={20} color="#991B1B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[m.optLabel, { color: "#991B1B" }]}>즉시 이동</Text>
                  <Text style={m.optSub}>지금 바로 {pickedLabel} 처리, 반 배정 즉시 해제</Text>
                </View>
              </Pressable>

              <Pressable
                onPress={() => doChange(pickedStatus!, "next_month")}
                style={[m.option, { backgroundColor: "#DFF3EC", borderColor: "#16A34A40" }]}>
                <View style={[m.optIcon, { backgroundColor: "#DCFCE7" }]}>
                  <LucideIcon name="calendar" size={20} color="#16A34A" />
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

        {step === "datepick" && (
          <>
            <Text style={m.title}>복귀일 선택</Text>
            <Text style={m.sub}>{studentName}님의 첫 수업일을 선택하세요</Text>

            {/* 연월 네비게이션 */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Pressable hitSlop={8} onPress={() => {
                if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
                else setCalMonth(prev => prev - 1);
              }}>
                <LucideIcon name="chevron-left" size={20} color={C.text} />
              </Pressable>
              <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text }}>
                {calYear}년 {calMonth + 1}월
              </Text>
              <Pressable hitSlop={8} onPress={() => {
                if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
                else setCalMonth(prev => prev + 1);
              }}>
                <LucideIcon name="chevron-right" size={20} color={C.text} />
              </Pressable>
            </View>

            {/* 요일 헤더 */}
            <View style={{ flexDirection: "row", marginBottom: 2 }}>
              {WEEK_DAYS.map((w, i) => (
                <Text key={w} style={{ flex: 1, textAlign: "center", fontSize: 11,
                  fontFamily: "Pretendard-Regular",
                  color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#888" }}>
                  {w}
                </Text>
              ))}
            </View>

            {/* 날짜 그리드 */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>
              {buildCalCells().map((day, idx) => {
                if (!day) return <View key={`e-${idx}`} style={{ width: `${100/7}%`, aspectRatio: 1 }} />;
                const d = new Date(calYear, calMonth, day);
                const ds = toYMD(d);
                const isSel = ds === calSelected;
                const isToday = ds === todayStr;
                const dow = idx % 7;
                return (
                  <Pressable key={ds} onPress={() => setCalSelected(ds)}
                    style={{ width: `${100/7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center",
                      ...(isSel ? { backgroundColor: C.tint, borderRadius: 20 } : {}) }}>
                    {isToday && !isSel && (
                      <View style={{ position: "absolute", bottom: 3, width: 4, height: 4,
                        borderRadius: 2, backgroundColor: C.tint }} />
                    )}
                    <Text style={{ fontSize: 13, fontFamily: isSel ? "Pretendard-SemiBold" : "Pretendard-Regular",
                      color: isSel ? "#fff" : dow === 0 ? "#EF4444" : dow === 6 ? "#3B82F6" : "#222" }}>
                      {day}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted,
              textAlign: "center", marginBottom: 12 }}>
              선택: {calSelected}
            </Text>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={[m.actionBtn, { backgroundColor: "#F3F4F6", flex: 1 }]}
                onPress={() => { setStep("select"); setPickedStatus(null); }}>
                <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>뒤로</Text>
              </Pressable>
              <Pressable style={[m.actionBtn, { backgroundColor: C.tint, flex: 1 }]}
                onPress={() => doChange("active", "immediate", calSelected)}>
                <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" }}>복귀 확인</Text>
              </Pressable>
            </View>
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
  title:      { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center", marginBottom: 4 },
  sub:        { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center", marginBottom: 16 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  errorBox:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9DEDA", borderRadius: 10, padding: 10, marginBottom: 12 },
  errorText:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#D96C6C", flex: 1 },
  option:     { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 14, padding: 14, borderWidth: 1.5 },
  optIcon:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  optLabel:   { fontSize: 15, fontFamily: "Pretendard-Regular" },
  optSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 1 },
  cancelBtn:  { alignItems: "center", marginTop: 16 },
  cancelText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  actionBtn:  { paddingVertical: 13, borderRadius: 12, alignItems: "center" },
});
