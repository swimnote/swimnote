/**
 * onboarding-teacher.tsx — 선생님 온보딩
 * 슬라이드 1: 환영
 * 슬라이드 2: 오늘 스케줄 탭 사용법
 * 슬라이드 3: 내 스케줄 (달력) 탭 사용법
 * 슬라이드 4: 정산 방식 완전 이해
 * 슬라이드 5: 보강 처리 방법
 * 슬라이드 6: 시작하기
 */
import { ArrowRight, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign, Clock, GraduationCap, ListChecks, RotateCcw, Sun } from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Dimensions, FlatList, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";

const { width: W } = Dimensions.get("window");

const MINT   = "#2EC4B6";
const NAVY   = "#0F172A";
const ORANGE = "#F97316";
const BLUE   = "#2563EB";
const GREEN  = "#2E9B6F";
const PURPLE = "#7C3AED";

const SLIDES = ["welcome", "today", "calendar", "settlement", "makeup", "done"];

export default function OnboardingTeacherScreen() {
  const { adminUser } = useAuth();
  const flatRef = useRef<FlatList>(null);
  const [page, setPage] = useState(0);
  const name = adminUser?.name ?? "선생님";

  async function goNext() {
    if (page < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: page + 1, animated: true });
      setPage(page + 1);
    } else {
      await finish();
    }
  }

  async function finish() {
    if (adminUser?.id) {
      await AsyncStorage.setItem(`@swimnote:onboarded_${adminUser.id}_teacher`, "1").catch(() => {});
    }
    router.replace("/(teacher)/today-schedule" as any);
  }

  const renderSlide = ({ item }: { item: string }) => {
    if (item === "welcome")    return <SlideWelcome name={name} />;
    if (item === "today")      return <SlideToday />;
    if (item === "calendar")   return <SlideCalendar />;
    if (item === "settlement") return <SlideSettlement />;
    if (item === "makeup")     return <SlideMakeup />;
    if (item === "done")       return <SlideDone name={name} onStart={finish} />;
    return null;
  };

  const isLast = page === SLIDES.length - 1;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.progressRow}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[s.dot, i === page && s.dotActive, i < page && s.dotDone]} />
        ))}
      </View>

      <FlatList
        ref={flatRef}
        data={SLIDES}
        keyExtractor={v => v}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        renderItem={renderSlide}
        getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
        style={{ flex: 1 }}
      />

      {!isLast && (
        <View style={s.footer}>
          <Pressable style={s.skipBtn} onPress={finish}>
            <Text style={s.skipTxt}>건너뛰기</Text>
          </Pressable>
          <Pressable style={s.nextBtn} onPress={goNext}>
            <Text style={s.nextTxt}>다음</Text>
            <ArrowRight size={16} color="#fff" />
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ── 슬라이드 1: 환영 ─────────────────────────────────────────────── */
function SlideWelcome({ name }: { name: string }) {
  return (
    <View style={[sw.root, { width: W }]}>
      <View style={sw.iconWrap}>
        <GraduationCap size={64} color={GREEN} />
      </View>
      <Text style={sw.badge}>선생님 모드</Text>
      <Text style={sw.title}>{name},{"\n"}스윔노트에 오신 것을{"\n"}환영합니다!</Text>
      <Text style={sw.sub}>
        수업 일정 확인, 출결 기록, 수업 일지 작성,{"\n"}
        월 정산까지 간편하게 처리할 수 있어요.
      </Text>
      <View style={sw.tagRow}>
        {["오늘 스케줄", "달력 스케줄", "수업일지", "보강 관리", "월 정산"].map(t => (
          <View key={t} style={sw.tag}><Text style={sw.tagTxt}>{t}</Text></View>
        ))}
      </View>
    </View>
  );
}

/* ── 슬라이드 2: 오늘 스케줄 ──────────────────────────────────────── */
function SlideToday() {
  return (
    <ScrollView style={{ width: W }} contentContainerStyle={st.root} showsVerticalScrollIndicator={false}>
      <View style={st.header}>
        <Sun size={28} color={ORANGE} />
        <Text style={st.title}>오늘 스케줄 탭</Text>
      </View>
      <Text style={st.sub}>매일 사용하는 핵심 탭입니다</Text>

      <View style={st.mockCard}>
        <Text style={st.mockDate}>🗓 오늘 · 화요일</Text>
        <View style={st.classRow}>
          <View style={[st.classDot, { backgroundColor: MINT }]} />
          <View style={{ flex: 1 }}>
            <Text style={st.className}>초급반 A · 09:00–10:00</Text>
            <Text style={st.classMeta}>학생 8명 · 출석 미완료</Text>
          </View>
          <View style={st.attendBtn}><Text style={st.attendBtnTxt}>출석 체크</Text></View>
        </View>
        <View style={st.classRow}>
          <View style={[st.classDot, { backgroundColor: BLUE }]} />
          <View style={{ flex: 1 }}>
            <Text style={st.className}>중급반 B · 11:00–12:00</Text>
            <Text style={st.classMeta}>학생 6명 · 출석 완료 ✓</Text>
          </View>
          <View style={[st.attendBtn, { backgroundColor: "#E6FAF8" }]}>
            <Text style={[st.attendBtnTxt, { color: MINT }]}>완료</Text>
          </View>
        </View>
      </View>

      <View style={st.guideBox}>
        <Text style={st.guideTitle}>📋 이 탭에서 할 수 있는 것</Text>
        {[
          { icon: "✅", text: "수업별 학생 출석·결석·지각 체크" },
          { icon: "📝", text: "결석 사유 입력 (보강 자동 생성)" },
          { icon: "📖", text: "수업 종료 후 일지 바로 작성" },
          { icon: "💬", text: "수업 메모 (오늘 특이사항 기록)" },
        ].map(g => (
          <View key={g.text} style={st.guideRow}>
            <Text style={st.guideIcon}>{g.icon}</Text>
            <Text style={st.guideText}>{g.text}</Text>
          </View>
        ))}
      </View>

      <View style={st.tipBox}>
        <Text style={st.tipTxt}>
          💡 수업 카드를 탭하면 학생 목록이 펼쳐집니다.{"\n"}
          출석 버튼을 눌러 개별 출결을 처리하세요.
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── 슬라이드 3: 달력 스케줄 ──────────────────────────────────────── */
function SlideCalendar() {
  return (
    <ScrollView style={{ width: W }} contentContainerStyle={scal.root} showsVerticalScrollIndicator={false}>
      <View style={scal.header}>
        <CalendarDays size={28} color={BLUE} />
        <Text style={scal.title}>내 스케줄 탭 (달력)</Text>
      </View>
      <Text style={scal.sub}>주간·월간으로 내 수업 전체를 확인</Text>

      {/* 달력 mock */}
      <View style={scal.calMock}>
        <View style={scal.calHeader}>
          {["일", "월", "화", "수", "목", "금", "토"].map(d => (
            <Text key={d} style={scal.calDay}>{d}</Text>
          ))}
        </View>
        <View style={scal.calRow}>
          {[1, 2, 3, 4, 5, 6, 7].map(d => (
            <View key={d} style={scal.calCell}>
              <Text style={scal.calNum}>{d}</Text>
              {[2, 4, 6].includes(d) && (
                <View style={scal.calDot} />
              )}
            </View>
          ))}
        </View>
      </View>

      <View style={scal.guideBox}>
        <Text style={scal.guideTitle}>📆 달력 스케줄 탭 활용법</Text>
        {[
          { icon: "🗓", text: "월간 뷰로 이번 달 전체 수업 한눈에 확인" },
          { icon: "📌", text: "날짜 탭 → 해당 날의 수업 상세 정보" },
          { icon: "👥", text: "수업별 배정 학생·정원·보강 현황 확인" },
          { icon: "🔄", text: "보강 수업 별도 표시 (점 색상으로 구분)" },
        ].map(g => (
          <View key={g.text} style={scal.guideRow}>
            <Text style={scal.guideIcon}>{g.icon}</Text>
            <Text style={scal.guideText}>{g.text}</Text>
          </View>
        ))}
      </View>

      <View style={scal.tipBox}>
        <Text style={scal.tipTxt}>
          💡 <Text style={{ fontFamily: "Pretendard-Regular", color: "#1E40AF" }}>오늘 스케줄 탭</Text>은 당일 운영용,{"\n"}
          <Text style={{ fontFamily: "Pretendard-Regular", color: "#1E40AF" }}>내 스케줄 탭</Text>은 주간·월간 확인용으로{"\n"}
          두 탭을 함께 사용하세요.
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── 슬라이드 4: 정산 방식 ────────────────────────────────────────── */
function SlideSettlement() {
  return (
    <ScrollView style={{ width: W }} contentContainerStyle={sse.root} showsVerticalScrollIndicator={false}>
      <View style={sse.header}>
        <CircleDollarSign size={28} color={GREEN} />
        <Text style={sse.title}>월 정산 방식 이해</Text>
      </View>
      <Text style={sse.sub}>정산은 어떻게 계산되고 제출하나요?</Text>

      {/* 계산 공식 */}
      <View style={sse.formulaBox}>
        <Text style={sse.formulaTitle}>💰 정산 계산 공식</Text>
        <View style={sse.formula}>
          <View style={[sse.fItem, { backgroundColor: "#EFF4FF" }]}>
            <Text style={[sse.fNum, { color: BLUE }]}>정규 수업</Text>
            <Text style={sse.fDesc}>횟수 × 단가</Text>
          </View>
          <Text style={sse.fPlus}>+</Text>
          <View style={[sse.fItem, { backgroundColor: "#DFF3EC" }]}>
            <Text style={[sse.fNum, { color: GREEN }]}>보강 수업</Text>
            <Text style={sse.fDesc}>횟수 별도 합산</Text>
          </View>
          <Text style={sse.fPlus}>+</Text>
          <View style={[sse.fItem, { backgroundColor: "#FFF3E0" }]}>
            <Text style={[sse.fNum, { color: ORANGE }]}>체험·임시</Text>
            <Text style={sse.fDesc}>횟수 별도 합산</Text>
          </View>
        </View>
      </View>

      {/* 정산 흐름 */}
      <View style={sse.flowBox}>
        <Text style={sse.flowTitle}>📋 정산 제출 순서</Text>
        {[
          { step: "1", color: BLUE, bg: "#EFF4FF", title: "이번 달 수업 종료", desc: "자동으로 수업 횟수가 집계됩니다" },
          { step: "2", color: MINT, bg: "#E6FAF8", title: "정산 탭에서 확인", desc: "학생별 수업 횟수와 금액을 검토하세요" },
          { step: "3", color: GREEN, bg: "#DFF3EC", title: "기타 수기 항목 추가", desc: "수업 외 수당, 특이사항 직접 입력 가능" },
          { step: "4", color: PURPLE, bg: "#EEDDF5", title: "정산 저장 · 제출", desc: "저장 후 '제출완료'로 상태 변경하면 관리자에게 전달" },
          { step: "5", color: ORANGE, bg: "#FFF3E0", title: "관리자 확인", desc: "관리자가 확인 처리하면 정산 완료" },
        ].map((item, i) => (
          <View key={item.step}>
            <View style={sse.flowRow}>
              <View style={[sse.flowNum, { backgroundColor: item.bg }]}>
                <Text style={[sse.flowNumTxt, { color: item.color }]}>{item.step}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sse.flowTitle2}>{item.title}</Text>
                <Text style={sse.flowDesc}>{item.desc}</Text>
              </View>
            </View>
            {i < 4 && <View style={sse.connector} />}
          </View>
        ))}
      </View>

      <View style={sse.statusBox}>
        <Text style={sse.statusTitle}>정산 상태 의미</Text>
        <View style={sse.statusRow}>
          {[
            { label: "미정산", color: "#64748B", bg: "#F8FAFC" },
            { label: "저장됨", color: MINT, bg: "#E6FAF8" },
            { label: "제출완료", color: MINT, bg: "#E6FAF8" },
            { label: "관리자확인", color: PURPLE, bg: "#EEDDF5" },
          ].map(st => (
            <View key={st.label} style={[sse.statusBadge, { backgroundColor: st.bg }]}>
              <Text style={[sse.statusTxt, { color: st.color }]}>{st.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

/* ── 슬라이드 5: 보강 처리 ────────────────────────────────────────── */
function SlideMakeup() {
  return (
    <ScrollView style={{ width: W }} contentContainerStyle={sm.root} showsVerticalScrollIndicator={false}>
      <View style={sm.header}>
        <RotateCcw size={28} color={PURPLE} />
        <Text style={sm.title}>보강 처리 방법</Text>
      </View>
      <Text style={sm.sub}>결석하면 보강이 자동으로 생성됩니다</Text>

      <View style={sm.flowBox}>
        <Text style={sm.sectionTitle}>보강 생성 → 처리 흐름</Text>
        {[
          { icon: "❌", title: "결석 처리", desc: "오늘 스케줄에서 학생 결석 처리 시 자동으로 보강 1회 생성" },
          { icon: "📋", title: "보강 목록 확인", desc: "보강 탭에서 생성된 보강 목록 확인 (유효기간 표시)" },
          { icon: "✅", title: "보강 배정", desc: "보강 일자와 수업을 선택해 배정 → 학부모에게 알림 발송" },
          { icon: "🎓", title: "보강 수업 진행", desc: "배정된 날 수업 시 보강 학생으로 표시됨" },
          { icon: "💰", title: "정산 자동 합산", desc: "보강 수업 횟수는 당월 정산에 별도 집계됨" },
        ].map((item, i) => (
          <View key={item.title}>
            <View style={sm.flowRow}>
              <Text style={sm.flowIcon}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={sm.flowTitle}>{item.title}</Text>
                <Text style={sm.flowDesc}>{item.desc}</Text>
              </View>
            </View>
            {i < 4 && <View style={sm.connector} />}
          </View>
        ))}
      </View>

      <View style={sm.tipBox}>
        <Text style={sm.tipTitle}>⚠️ 보강 관련 주의사항</Text>
        <Text style={sm.tipDesc}>
          • 보강 유효기간은 관리자가 설정 (기본 1개월){"\n"}
          • 유효기간 내 처리되지 않으면 자동 소멸{"\n"}
          • 보강 횟수 제한은 관리자 설정에 따름{"\n"}
          • 체험 수업과 임시이동 수업은 별도로 표시됨
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── 슬라이드 6: 시작하기 ─────────────────────────────────────────── */
function SlideDone({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <View style={[sd.root, { width: W }]}>
      <View style={sd.iconWrap}>
        <CheckCircle2 size={72} color={GREEN} />
      </View>
      <Text style={sd.title}>준비 완료!</Text>
      <Text style={sd.sub}>
        {name}, 이제 스윔노트로{"\n"}
        수업을 더 편하게 진행해보세요.
      </Text>
      <View style={sd.summaryBox}>
        <Text style={sd.summaryTitle}>탭별 역할 요약</Text>
        {[
          { tab: "오늘 스케줄", desc: "당일 출결 체크 · 일지 작성" },
          { tab: "내 스케줄", desc: "주간·월간 수업 달력" },
          { tab: "학생 목록", desc: "내 수업 학생 관리" },
          { tab: "보강", desc: "보강 생성·배정·처리" },
          { tab: "정산", desc: "월 수업 횟수 확인 및 제출" },
        ].map(r => (
          <View key={r.tab} style={sd.summaryRow}>
            <ChevronRight size={14} color={GREEN} />
            <Text style={sd.summaryTxt}>
              <Text style={{ color: GREEN }}>{r.tab}</Text> — {r.desc}
            </Text>
          </View>
        ))}
      </View>
      <Pressable style={sd.btn} onPress={onStart}>
        <Text style={sd.btnTxt}>오늘 스케줄로 시작하기</Text>
        <ArrowRight size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#FAFAFA" },
  progressRow:{ flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 14 },
  dot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: "#E5E7EB" },
  dotActive:  { width: 20, backgroundColor: GREEN },
  dotDone:    { backgroundColor: GREEN, opacity: 0.4 },
  footer:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderColor: "#F0F0F0" },
  skipBtn:    { paddingHorizontal: 16, paddingVertical: 12 },
  skipTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  nextBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: GREEN,
                paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  nextTxt:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});

const sw = StyleSheet.create({
  root:    { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  iconWrap:{ width: 100, height: 100, borderRadius: 28, backgroundColor: "#DFF3EC",
             alignItems: "center", justifyContent: "center", marginBottom: 8 },
  badge:   { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: "#DFF3EC" },
  title:   { fontSize: 26, fontFamily: "Pretendard-Regular", color: NAVY, textAlign: "center", lineHeight: 36 },
  sub:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 24 },
  tagRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 },
  tag:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F3F4F6",
             borderWidth: 1, borderColor: "#E5E7EB" },
  tagTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#374151" },
});

const st = StyleSheet.create({
  root:        { padding: 20, gap: 12, paddingBottom: 80 },
  header:      { flexDirection: "row", alignItems: "center", gap: 10 },
  title:       { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -6 },
  mockCard:    { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12,
                 borderWidth: 1, borderColor: "#E5E7EB" },
  mockDate:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  classRow:    { flexDirection: "row", alignItems: "center", gap: 10 },
  classDot:    { width: 10, height: 10, borderRadius: 5 },
  className:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY },
  classMeta:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  attendBtn:   { backgroundColor: MINT, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  attendBtnTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },
  guideBox:    { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 10,
                 borderWidth: 1, borderColor: "#E5E7EB" },
  guideTitle:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 4 },
  guideRow:    { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  guideIcon:   { fontSize: 16, width: 24 },
  guideText:   { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151", lineHeight: 20 },
  tipBox:      { backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14,
                 borderWidth: 1, borderColor: "#FDE68A" },
  tipTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 20 },
});

const scal = StyleSheet.create({
  root:      { padding: 20, gap: 12, paddingBottom: 80 },
  header:    { flexDirection: "row", alignItems: "center", gap: 10 },
  title:     { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -6 },
  calMock:   { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  calHeader: { flexDirection: "row", justifyContent: "space-around", marginBottom: 8 },
  calDay:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#9CA3AF", width: 30, textAlign: "center" },
  calRow:    { flexDirection: "row", justifyContent: "space-around" },
  calCell:   { alignItems: "center", width: 30, gap: 4 },
  calNum:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY },
  calDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: BLUE },
  guideBox:  { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 10,
               borderWidth: 1, borderColor: "#E5E7EB" },
  guideTitle:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 4 },
  guideRow:  { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  guideIcon: { fontSize: 16, width: 24 },
  guideText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151", lineHeight: 20 },
  tipBox:    { backgroundColor: "#EFF4FF", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#BAD3FF" },
  tipTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#1E40AF", lineHeight: 20 },
});

const sse = StyleSheet.create({
  root:        { padding: 20, gap: 12, paddingBottom: 80 },
  header:      { flexDirection: "row", alignItems: "center", gap: 10 },
  title:       { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -6 },
  formulaBox:  { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  formulaTitle:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 12 },
  formula:     { flexDirection: "row", alignItems: "center", gap: 6 },
  fItem:       { flex: 1, borderRadius: 10, padding: 10, alignItems: "center", gap: 4 },
  fNum:        { fontSize: 12, fontFamily: "Pretendard-Regular" },
  fDesc:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center" },
  fPlus:       { fontSize: 16, color: "#9CA3AF", fontFamily: "Pretendard-Regular" },
  flowBox:     { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  flowTitle:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 10 },
  flowRow:     { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  flowNum:     { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  flowNumTxt:  { fontSize: 15, fontFamily: "Pretendard-Regular" },
  flowTitle2:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 2 },
  flowDesc:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  connector:   { width: 2, height: 10, backgroundColor: "#E5E7EB", marginLeft: 15, marginVertical: 2 },
  statusBox:   { backgroundColor: "#F8FAFC", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  statusTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 10 },
  statusRow:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  statusTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
});

const sm = StyleSheet.create({
  root:      { padding: 20, gap: 12, paddingBottom: 80 },
  header:    { flexDirection: "row", alignItems: "center", gap: 10 },
  title:     { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -6 },
  flowBox:   { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 4, borderWidth: 1, borderColor: "#E5E7EB" },
  sectionTitle:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 8 },
  flowRow:   { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  flowIcon:  { fontSize: 20, width: 32, textAlign: "center" },
  flowTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 2 },
  flowDesc:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 18 },
  connector: { width: 2, height: 10, backgroundColor: "#E5E7EB", marginLeft: 15, marginVertical: 2 },
  tipBox:    { backgroundColor: "#FFF5F5", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#FECACA" },
  tipTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#B91C1C", marginBottom: 8 },
  tipDesc:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7F1D1D", lineHeight: 22 },
});

const sd = StyleSheet.create({
  root:        { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  iconWrap:    { width: 110, height: 110, borderRadius: 30, backgroundColor: "#DFF3EC",
                 alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title:       { fontSize: 28, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:         { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 26 },
  summaryBox:  { backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 10, width: "100%",
                 borderWidth: 1, borderColor: "#E5E7EB" },
  summaryTitle:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 4 },
  summaryRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151" },
  btn:         { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: GREEN,
                 paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, marginTop: 8 },
  btnTxt:      { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
});
