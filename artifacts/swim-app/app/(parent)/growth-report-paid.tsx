/**
 * (parent)/growth-report-paid.tsx
 *
 * 학부모 리포트 허브 — PAID 정밀 성장리포트 관리 화면.
 *
 * FREE monthly report (매월 5일 자동 발급) 와 완전히 분리.
 * FREE generate API 호출 금지 / 결제 연동 금지 / AI 호출 금지.
 *
 * ① 우리아이 분석정보 보충하기  — 더미
 * ② 학생 기본정보 입력           — height/weight 입력 UI (migration 대기, save 비활성)
 * ③ 정밀 성장리포트 발급하기     — 준비중 안내
 * ④ 발급 내용 확인하기           — 더미
 * ⑤ 발급한 리포트 다시보기       — 빈 상태
 * ⑥ 정보 수정·보충하기           — 더미
 * ⑦ 리포트에 문제가 있어요       — 더미
 *
 * route: /(parent)/growth-report-paid
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { useParent } from "@/context/ParentContext";
import { apiRequest } from "@/context/AuthContext";
import { useSession } from "@/context/auth/SessionContext";

const C = Colors.light;

// ── 만 나이 계산 ────────────────────────────────────────────────────────────
function calcKoreanAge(birthDateStr: string | null | undefined): string | null {
  if (!birthDateStr) return null;
  // birth_date는 "YYYY-MM-DD" 또는 "YYYY.MM.DD" 또는 "YYYYMMDD" 형식
  const clean = birthDateStr.replace(/[.\s-]/g, "");
  if (clean.length < 8) return null;
  const year = parseInt(clean.slice(0, 4), 10);
  const month = parseInt(clean.slice(4, 6), 10);
  const day = parseInt(clean.slice(6, 8), 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  const today = new Date();
  let age = today.getFullYear() - year;
  const hadBirthday =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!hadBirthday) age -= 1;
  return age >= 0 ? String(age) : null;
}

// ── 메뉴 카드 컴포넌트 ───────────────────────────────────────────────────────
function HubCard({
  icon,
  label,
  desc,
  onPress,
  primary = false,
}: {
  icon: string;
  label: string;
  desc: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.card,
        primary && s.cardPrimary,
        { opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[s.cardIcon, primary && s.cardIconPrimary]}>
        <LucideIcon
          name={icon as any}
          size={20}
          color={primary ? "#fff" : C.brandStrong}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.cardLabel, primary && { color: "#fff" }]}>{label}</Text>
        <Text style={[s.cardDesc, primary && { color: "rgba(255,255,255,0.8)" }]}>
          {desc}
        </Text>
      </View>
      <LucideIcon
        name="chevron-right"
        size={16}
        color={primary ? "rgba(255,255,255,0.7)" : C.textMuted}
      />
    </Pressable>
  );
}

// ── 섹션 구분선 ──────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={s.sectionLabel}>{label}</Text>
  );
}

// ── 학생 기본정보 입력 모달 ──────────────────────────────────────────────────
function StudentInfoModal({
  visible,
  onClose,
  studentName,
  birthDate,
}: {
  visible: boolean;
  onClose: () => void;
  studentName: string;
  birthDate: string | null | undefined;
}) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const calculatedAge = useMemo(() => calcKoreanAge(birthDate), [birthDate]);

  function validateHeight(v: string) {
    const n = parseFloat(v);
    return v === "" || (!isNaN(n) && n > 0 && n < 300);
  }
  function validateWeight(v: string) {
    const n = parseFloat(v);
    return v === "" || (!isNaN(n) && n > 0 && n < 300);
  }

  function handleSave() {
    // ⚠️ MIGRATION PENDING: students 테이블에 height/weight 컬럼 없음.
    // 저장 기능은 DB migration 완료 후 구현 예정.
    Alert.alert(
      "준비 중",
      "기본정보 저장 기능은 곧 제공될 예정입니다.\n(서버 업데이트 준비 중)",
      [{ text: "확인" }]
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[si.root, { backgroundColor: C.background }]}>
          {/* 헤더 */}
          <View style={si.header}>
            <Text style={[si.title, { color: C.text }]}>학생 기본정보</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <LucideIcon name="x" size={22} color={C.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={si.body}>
            {/* 학생명 */}
            <Text style={[si.studentName, { color: C.textSecondary }]}>
              {studentName}
            </Text>

            {/* 안내 */}
            <View style={[si.infoBox, { backgroundColor: C.brandMist, borderColor: C.brandSoft }]}>
              <LucideIcon name="info" size={14} color={C.brandStrong} />
              <Text style={[si.infoText, { color: C.brandStrong }]}>
                입력한 정보는 성장 분석에만 활용됩니다.
              </Text>
            </View>

            {/* 나이 (생년월일 기반 자동 계산) */}
            <View style={si.fieldGroup}>
              <Text style={[si.fieldLabel, { color: C.text }]}>나이 (만 나이)</Text>
              <View style={[si.fieldReadOnly, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[si.fieldReadOnlyText, { color: calculatedAge ? C.text : C.textMuted }]}>
                  {calculatedAge ? `만 ${calculatedAge}세` : "생년월일 정보 없음"}
                </Text>
                {birthDate ? (
                  <Text style={[si.fieldHint, { color: C.textMuted }]}>
                    {birthDate} 기준 자동 계산
                  </Text>
                ) : (
                  <Text style={[si.fieldHint, { color: C.textMuted }]}>
                    수영장에서 생년월일을 등록하면 자동 표시됩니다
                  </Text>
                )}
              </View>
            </View>

            {/* 키 */}
            <View style={si.fieldGroup}>
              <Text style={[si.fieldLabel, { color: C.text }]}>키</Text>
              <View style={[si.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                <TextInput
                  style={[si.input, { color: C.text }]}
                  value={height}
                  onChangeText={(v) => {
                    if (validateHeight(v)) setHeight(v);
                  }}
                  placeholder="예: 140"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                  maxLength={5}
                />
                <Text style={[si.unit, { color: C.textSecondary }]}>cm</Text>
              </View>
            </View>

            {/* 몸무게 */}
            <View style={si.fieldGroup}>
              <Text style={[si.fieldLabel, { color: C.text }]}>몸무게</Text>
              <View style={[si.inputRow, { borderColor: C.border, backgroundColor: C.card }]}>
                <TextInput
                  style={[si.input, { color: C.text }]}
                  value={weight}
                  onChangeText={(v) => {
                    if (validateWeight(v)) setWeight(v);
                  }}
                  placeholder="예: 38.5"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                  maxLength={5}
                />
                <Text style={[si.unit, { color: C.textSecondary }]}>kg</Text>
              </View>
            </View>

            {/* 저장 예정 배지 */}
            <View style={[si.pendingBadge, { backgroundColor: "#FFF7E6", borderColor: "#FDE68A" }]}>
              <LucideIcon name="clock" size={13} color="#D97706" />
              <Text style={[si.pendingText, { color: "#92400E" }]}>
                저장 기능은 업데이트 예정입니다
              </Text>
            </View>

            {/* 저장 버튼 */}
            <Pressable
              style={({ pressed }) => [
                si.saveBtn,
                { backgroundColor: C.brandStrong, opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={handleSave}
            >
              <Text style={si.saveBtnText}>저장하기</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── 메인 화면 ────────────────────────────────────────────────────────────────
export default function GrowthReportPaidScreen() {
  const insets = useSafeAreaInsets();
  const { selectedStudent } = useParent();
  const { token } = useSession();

  const [studentInfoVisible, setStudentInfoVisible] = useState(false);

  const studentName = selectedStudent?.name ?? "아이";
  const birthDate = (selectedStudent as any)?.birth_date ?? null;

  function showComingSoon(feature: string) {
    Alert.alert("준비 중", `${feature} 기능은 곧 제공될 예정입니다.`, [
      { text: "확인" },
    ]);
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View
        style={[
          s.header,
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={s.backBtn}
        >
          <LucideIcon name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: C.text }]}>학부모 리포트</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 무료 정기 리포트 안내 */}
        <View style={[s.infoCard, { backgroundColor: C.brandMist, borderColor: C.brandSoft }]}>
          <LucideIcon name="calendar-check" size={16} color={C.brandStrong} />
          <Text style={[s.infoText, { color: C.brandStrong }]}>
            정기 성장리포트는 정상 재원 회원에게{"\n"}매월 5일 자동으로 제공됩니다.
          </Text>
        </View>

        {/* 정밀 리포트 소개 */}
        <View style={[s.descCard, { backgroundColor: C.card }]}>
          <Text style={[s.descTitle, { color: C.text }]}>더 자세한 분석이 필요할 때</Text>
          <Text style={[s.descBody, { color: C.textSecondary }]}>
            정밀 성장리포트를 이용할 수 있습니다.{"\n"}수업 기록과 누적 성장정보를 바탕으로{"\n"}아이의 성장 과정을 더 깊게 분석합니다.
          </Text>
        </View>

        {/* ── PRIMARY CTA ── */}
        <SectionLabel label="리포트 발급" />
        <HubCard
          primary
          icon="file-bar-chart"
          label="정밀 성장리포트 발급하기"
          desc="수업 기록과 누적 성장정보를 바탕으로 분석합니다"
          onPress={() => showComingSoon("정밀 성장리포트 발급")}
        />

        {/* ── 준비 정보 ── */}
        <SectionLabel label="분석 준비" />
        <HubCard
          icon="message-square-more"
          label="우리아이 분석정보 보충하기"
          desc="평소 모습과 최근 변화에 대한 정보를 추가할 수 있어요"
          onPress={() => showComingSoon("분석정보 보충")}
        />
        <HubCard
          icon="user-circle"
          label="학생 기본정보 입력"
          desc="성장 분석에 참고할 키·몸무게 정보를 입력할 수 있어요"
          onPress={() => setStudentInfoVisible(true)}
        />
        <HubCard
          icon="clipboard-check"
          label="발급 내용 확인하기"
          desc="분석에 사용할 정보를 발급 전 확인합니다"
          onPress={() => showComingSoon("발급 내용 확인")}
        />

        {/* ── 내역 및 관리 ── */}
        <SectionLabel label="내역 및 관리" />
        <HubCard
          icon="archive"
          label="발급한 리포트 다시보기"
          desc="이전에 발급한 정밀 성장리포트를 확인합니다"
          onPress={() => showComingSoon("발급 내역")}
        />
        <HubCard
          icon="pencil"
          label="정보 수정·보충하기"
          desc="입력한 분석정보를 수정하거나 새로운 내용을 추가합니다"
          onPress={() => showComingSoon("정보 수정")}
        />

        {/* ── 지원 ── */}
        <SectionLabel label="지원" />
        <HubCard
          icon="alert-circle"
          label="리포트에 문제가 있어요"
          desc="발급 실패, 내용 누락, 결제 또는 파일 문제를 해결합니다"
          onPress={() => showComingSoon("리포트 문제 접수")}
        />

        {/* 가격 안내 (미래 상품) */}
        <View style={[s.priceNote, { borderColor: C.border }]}>
          <Text style={[s.priceNoteText, { color: C.textMuted }]}>
            정밀 성장리포트 · 1회 29,000원 (준비 중)
          </Text>
        </View>
      </ScrollView>

      {/* 학생 기본정보 모달 */}
      <StudentInfoModal
        visible={studentInfoVisible}
        onClose={() => setStudentInfoVisible(false)}
        studentName={studentName}
        birthDate={birthDate}
      />
    </View>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 36, alignItems: "flex-start" },
  headerTitle: { fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  scroll: { paddingHorizontal: 16, paddingTop: 8, gap: 0 },

  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },

  descCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    gap: 6,
  },
  descTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  descBody: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 21 },

  sectionLabel: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: Colors.light.textMuted,
    marginTop: 16,
    marginBottom: 6,
    letterSpacing: 0.3,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  cardPrimary: {
    backgroundColor: Colors.light.brandStrong,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.light.brandMist,
    alignItems: "center",
    justifyContent: "center",
  },
  cardIconPrimary: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  cardLabel: {
    fontSize: 14,
    fontFamily: "Pretendard-SemiBold",
    color: Colors.light.text,
  },
  cardDesc: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
    color: Colors.light.textMuted,
    lineHeight: 18,
  },

  priceNote: {
    marginTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    alignItems: "center",
  },
  priceNoteText: { fontSize: 12, fontFamily: "Pretendard-Regular" },
});

const si = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  title: { fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 0 },

  studentName: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    marginBottom: 12,
  },

  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 20,
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular" },

  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-SemiBold", marginBottom: 8 },

  fieldReadOnly: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  fieldReadOnlyText: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  fieldHint: { fontSize: 11, fontFamily: "Pretendard-Regular" },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
    paddingVertical: 12,
  },
  unit: { fontSize: 14, fontFamily: "Pretendard-Regular", marginLeft: 4 },

  pendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: "flex-start",
    marginTop: 4,
    marginBottom: 20,
  },
  pendingText: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
});
