import Colors from "@/constants/colors";
const C = Colors.light;
/**
 * onboarding-admin.tsx — 수영장 관리자 온보딩
 * 슬라이드 1: 환영
 * 슬라이드 2: 핵심 기능 소개
 * 슬라이드 3: 필수 설정 체크리스트 (수영장정보·레벨·단가·일지문구·선생님초대)
 * 슬라이드 4: 회원·수업 관리 흐름
 * 슬라이드 5: 시작하기
 */
import { LucideIcon } from "@/components/common/LucideIcon";
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
const NAVY_BG   = "#0F2742";  // fill/button/progress
const NAVY_TEXT = C.textPrimary;  // text/icon
const ORANGE = "#F97316";
const BLUE   = "#2563EB";
const GREEN  = "#2E9B6F";

/* ─── 체크리스트 항목 ───────────────────────────────────────────── */
const CHECKLIST = [
  {
    id: "pool_info",
    icon: "building-2",
    color: BLUE,
    bg: "#EFF4FF",
    title: "수영장 기본 정보",
    desc: "수영장명, 주소, 전화번호, 원장 이름",
    path: "/(admin)/pool-settings",
    required: true,
  },
  {
    id: "pricing",
    icon: "circle-dollar-sign",
    color: GREEN,
    bg: "#DFF3EC",
    title: "수업 단가 설정",
    desc: "월 수강료, 횟수별 요금 테이블",
    path: "/(admin)/pool-settings",
    required: true,
  },
  {
    id: "classes",
    icon: "graduation-cap",
    color: MINT,
    bg: "#E6FAF8",
    title: "레벨 · 수업 등록",
    desc: "수업 종류(초급·중급·상급)와 시간표",
    path: "/(admin)/classes",
    required: true,
  },
  {
    id: "diary",
    icon: "book-open",
    color: ORANGE,
    bg: "#FFF3E0",
    title: "일지 문구 템플릿",
    desc: "선생님이 쓸 수업일지 기본 문구 설정",
    path: "/(admin)/settings",
    required: false,
  },
  {
    id: "teacher",
    icon: "user-plus",
    color: "#7C3AED",
    bg: "#EEDDF5",
    title: "선생님 초대",
    desc: "초대코드 발급 후 선생님이 가입",
    path: "/(admin)/teachers",
    required: false,
  },
];

/* ─── 슬라이드 데이터 ───────────────────────────────────────────── */
const SLIDES = ["welcome", "features", "checklist", "flow", "done"];

export default function OnboardingAdminScreen() {
  const { adminUser } = useAuth();
  const flatRef = useRef<FlatList>(null);
  const [page, setPage] = useState(0);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const name = adminUser?.name ?? "원장님";

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
      await AsyncStorage.setItem(`@swimnote:onboarded_${adminUser.id}_admin`, "1").catch(() => {});
    }
    router.replace("/(admin)/dashboard" as any);
  }

  function toggleCheck(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const renderSlide = ({ item }: { item: string }) => {
    if (item === "welcome") return <SlideWelcome name={name} />;
    if (item === "features") return <SlideFeatures />;
    if (item === "checklist") return (
      <SlideChecklist checkedIds={checkedIds} onToggle={toggleCheck} />
    );
    if (item === "flow") return <SlideFlow />;
    if (item === "done") return <SlideDone name={name} onStart={finish} />;
    return null;
  };

  const isLast = page === SLIDES.length - 1;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      {/* 진행바 */}
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

      {/* 하단 버튼 */}
      {!isLast && (
        <View style={s.footer}>
          <Pressable style={s.skipBtn} onPress={finish}>
            <Text style={s.skipTxt}>건너뛰기</Text>
          </Pressable>
          <Pressable style={s.nextBtn} onPress={goNext}>
            <Text style={s.nextTxt}>다음</Text>
            <LucideIcon name="arrow-right" size={16} color="#fff" />
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
        <LucideIcon name="layout-dashboard" size={64} color={MINT} />
      </View>
      <Text style={sw.badge}>수영장 관리자 모드</Text>
      <Text style={sw.title}>{name},{"\n"}스윔노트에 오신 것을{"\n"}환영합니다!</Text>
      <Text style={sw.sub}>
        회원 관리, 수업 운영, 출결 기록, 매출 정산까지{"\n"}
        수영장 운영에 필요한 모든 것을 한 앱에서.
      </Text>
      <View style={sw.tagRow}>
        {["회원 관리", "수업 관리", "출결", "매출·정산", "공지"].map(t => (
          <View key={t} style={sw.tag}><Text style={sw.tagTxt}>{t}</Text></View>
        ))}
      </View>
    </View>
  );
}

/* ── 슬라이드 2: 핵심 기능 ────────────────────────────────────────── */
const FEATURES = [
  { icon: "users", color: BLUE, bg: "#EFF4FF", title: "회원 · 학부모 관리", desc: "회원 등록부터 학부모 앱 연동, 탈퇴·보류까지 한 화면에서 처리합니다." },
  { icon: "clipboard-list", color: MINT, bg: "#E6FAF8", title: "수업 · 출결 관리", desc: "수업별 출결을 실시간으로 기록하고, 결석·보강 처리를 자동으로 트래킹합니다." },
  { icon: "circle-dollar-sign", color: GREEN, bg: "#DFF3EC", title: "매출 · 정산 확인", desc: "선생님별 정산 내역을 확인하고, 수업 단가 기반 매출을 자동 집계합니다." },
  { icon: "settings", color: ORANGE, bg: "#FFF3E0", title: "수영장 설정 · 운영", desc: "레벨 분류, 보강 정책, 일지 문구, 공지까지 수영장 맞춤 설정을 관리합니다." },
];

function SlideFeatures() {
  return (
    <ScrollView style={{ width: W }} contentContainerStyle={sf.root} showsVerticalScrollIndicator={false}>
      <Text style={sf.title}>이런 것들을 관리할 수 있어요</Text>
      <Text style={sf.sub}>탭별로 분리된 메뉴에서 쉽게 찾을 수 있습니다</Text>
      {FEATURES.map(f => (
        <View key={f.title} style={sf.card}>
          <View style={[sf.iconBox, { backgroundColor: f.bg }]}>
            <LucideIcon name={f.icon as any} size={24} color={f.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sf.cardTitle}>{f.title}</Text>
            <Text style={sf.cardDesc}>{f.desc}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

/* ── 슬라이드 3: 필수 설정 체크리스트 ─────────────────────────────── */
function SlideChecklist({ checkedIds, onToggle }: {
  checkedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const requiredCount = CHECKLIST.filter(c => c.required).length;
  const checkedRequired = CHECKLIST.filter(c => c.required && checkedIds.has(c.id)).length;

  return (
    <ScrollView style={{ width: W }} contentContainerStyle={sc.root} showsVerticalScrollIndicator={false}>
      <View style={sc.headerBox}>
        <Text style={sc.title}>시작 전 필수 설정 체크리스트</Text>
        <Text style={sc.sub}>
          아래 항목들을 미리 설정해두면{"\n"}
          선생님과 학부모가 바로 앱을 사용할 수 있어요.
        </Text>
        <View style={sc.progressBarWrap}>
          <View style={[sc.progressBar, { width: `${(checkedRequired / requiredCount) * 100}%` }]} />
        </View>
        <Text style={sc.progressTxt}>
          필수 항목 {checkedRequired}/{requiredCount} 완료
        </Text>
      </View>

      {CHECKLIST.map(item => {
        const checked = checkedIds.has(item.id);
        return (
          <Pressable
            key={item.id}
            style={[sc.item, checked && sc.itemChecked]}
            onPress={() => onToggle(item.id)}
          >
            <View style={[sc.itemIcon, { backgroundColor: item.bg }]}>
              <LucideIcon name={item.icon as any} size={20} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={sc.itemTitleRow}>
                <Text style={[sc.itemTitle, checked && { color: C.textMuted }]}>{item.title}</Text>
                {item.required && (
                  <View style={sc.requiredBadge}>
                    <Text style={sc.requiredTxt}>필수</Text>
                  </View>
                )}
              </View>
              <Text style={[sc.itemDesc, checked && { color: "#D1D5DB" }]}>{item.desc}</Text>
            </View>
            {checked
              ? <LucideIcon name="check-circle" size={22} color={MINT} />
              : <LucideIcon name="circle" size={22} color="#D1D5DB" />
            }
          </Pressable>
        );
      })}

      <View style={sc.hintBox}>
        <Text style={sc.hintTxt}>
          💡 온보딩 완료 후 설정 메뉴에서 언제든지 변경할 수 있어요.{"\n"}
          지금 바로 설정하거나 '건너뛰기'로 나중에 할 수도 있습니다.
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── 슬라이드 4: 회원·수업 흐름 ──────────────────────────────────── */
const FLOW_STEPS = [
  { num: "1", color: BLUE, bg: "#EFF4FF", title: "수영장 정보 입력", desc: "수영장명·주소·단가 설정" },
  { num: "2", color: MINT, bg: "#E6FAF8", title: "선생님 초대", desc: "초대코드 → 선생님 앱 가입" },
  { num: "3", color: GREEN, bg: "#DFF3EC", title: "회원 등록 & 수업 배정", desc: "학생을 수업에 연결하고 학부모 앱 연동" },
  { num: "4", color: ORANGE, bg: "#FFF3E0", title: "일일 운영", desc: "출결 체크 → 일지 작성 → 보강 관리" },
  { num: "5", color: "#7C3AED", bg: "#EEDDF5", title: "월말 정산", desc: "선생님 정산 확인 → 매출 리포트" },
];

function SlideFlow() {
  return (
    <ScrollView style={{ width: W }} contentContainerStyle={sfl.root} showsVerticalScrollIndicator={false}>
      <Text style={sfl.title}>수영장 운영 흐름</Text>
      <Text style={sfl.sub}>처음 시작할 때부터 일상 운영까지의 흐름입니다</Text>
      {FLOW_STEPS.map((step, i) => (
        <View key={step.num}>
          <View style={sfl.stepRow}>
            <View style={[sfl.numBox, { backgroundColor: step.bg }]}>
              <Text style={[sfl.num, { color: step.color }]}>{step.num}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={sfl.stepTitle}>{step.title}</Text>
              <Text style={sfl.stepDesc}>{step.desc}</Text>
            </View>
          </View>
          {i < FLOW_STEPS.length - 1 && (
            <View style={sfl.connector} />
          )}
        </View>
      ))}

      <View style={sfl.tipBox}>
        <Text style={sfl.tipTitle}>📌 운영 TIP</Text>
        <Text style={sfl.tipDesc}>
          • 레벨 분류는 수업 배정의 기준이 됩니다 — 먼저 만들어두세요{"\n"}
          • 일지 문구는 선생님이 빠르게 작성할 수 있도록 자주 쓰는 문구를 등록해두세요{"\n"}
          • 보강 정책(유효기간, 횟수 제한)은 미리 설정하면 자동으로 적용됩니다
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── 슬라이드 5: 시작하기 ─────────────────────────────────────────── */
function SlideDone({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <View style={[sd.root, { width: W }]}>
      <View style={sd.iconWrap}>
        <LucideIcon name="check-circle" size={72} color={MINT} />
      </View>
      <Text style={sd.title}>준비 완료!</Text>
      <Text style={sd.sub}>
        {name}, 이제 스윔노트로{"\n"}
        수영장을 더 스마트하게 운영해보세요.
      </Text>
      <View style={sd.summaryBox}>
        <Text style={sd.summaryTitle}>설정 메뉴 위치 안내</Text>
        <View style={sd.summaryRow}>
          <LucideIcon name="chevron-right" size={14} color={MINT} />
          <Text style={sd.summaryTxt}>하단 탭 → <Text style={{ color: MINT }}>더보기</Text> → 수영장 설정</Text>
        </View>
        <View style={sd.summaryRow}>
          <LucideIcon name="chevron-right" size={14} color={MINT} />
          <Text style={sd.summaryTxt}>선생님 초대: <Text style={{ color: MINT }}>더보기</Text> → 선생님 관리</Text>
        </View>
        <View style={sd.summaryRow}>
          <LucideIcon name="chevron-right" size={14} color={MINT} />
          <Text style={sd.summaryTxt}>레벨 설정: <Text style={{ color: MINT }}>수업 관리</Text> → 수업 목록</Text>
        </View>
        <View style={sd.summaryRow}>
          <LucideIcon name="chevron-right" size={14} color={MINT} />
          <Text style={sd.summaryTxt}>일지 문구: <Text style={{ color: MINT }}>더보기</Text> → 설정 → 일지 템플릿</Text>
        </View>
      </View>
      <Pressable style={sd.btn} onPress={onStart}>
        <Text style={sd.btnTxt}>대시보드로 시작하기</Text>
        <LucideIcon name="arrow-right" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#FAFAFA" },
  progressRow:{ flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 14 },
  dot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  dotActive:  { width: 20, backgroundColor: NAVY_BG },
  dotDone:    { backgroundColor: NAVY_BG, opacity: 0.35 },
  footer:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderColor: "#F0F0F0" },
  skipBtn:    { paddingHorizontal: 16, paddingVertical: 12 },
  skipTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  nextBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: NAVY_BG,
                paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  nextTxt:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});

const sw = StyleSheet.create({
  root:    { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  iconWrap:{ width: 100, height: 100, borderRadius: 28, backgroundColor: "#E6FAF8",
             alignItems: "center", justifyContent: "center", marginBottom: 8 },
  badge:   { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
             backgroundColor: "#E6FAF8", marginBottom: 4 },
  title:   { fontSize: 26, fontFamily: "Pretendard-Regular", color: NAVY_TEXT, textAlign: "center", lineHeight: 36 },
  sub:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 24 },
  tagRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 },
  tag:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
             backgroundColor: "#F3F4F6", borderWidth: 1, borderColor: C.border },
  tagTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textPrimary },
});

const sf = StyleSheet.create({
  root:      { padding: 24, gap: 12, paddingBottom: 80 },
  title:     { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY_TEXT },
  sub:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },
  card:      { flexDirection: "row", alignItems: "flex-start", gap: 14, backgroundColor: "#fff",
               borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  iconBox:   { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: NAVY_TEXT, marginBottom: 4 },
  cardDesc:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 19 },
});

const sc = StyleSheet.create({
  root:         { padding: 20, gap: 10, paddingBottom: 80 },
  headerBox:    { backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 8,
                  borderWidth: 1, borderColor: C.border, marginBottom: 4 },
  title:        { fontSize: 20, fontFamily: "Pretendard-Regular", color: NAVY_TEXT },
  sub:          { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },
  progressBarWrap: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: "hidden", marginTop: 4 },
  progressBar:  { height: 6, backgroundColor: NAVY_BG, borderRadius: 3 },
  progressTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: MINT },
  item:         { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff",
                  borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: C.border },
  itemChecked:  { borderColor: "#D1FAE5", backgroundColor: "#F0FDF4" },
  itemIcon:     { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  itemTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  itemTitle:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY_TEXT },
  itemDesc:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  requiredBadge:{ backgroundColor: "#FFF1BF", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  requiredTxt:  { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#92400E" },
  hintBox:      { backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: "#FDE68A", marginTop: 4 },
  hintTxt:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E", lineHeight: 20 },
});

const sfl = StyleSheet.create({
  root:      { padding: 24, gap: 4, paddingBottom: 80 },
  title:     { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY_TEXT, marginBottom: 4 },
  sub:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 12 },
  stepRow:   { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#fff",
               borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  numBox:    { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  num:       { fontSize: 18, fontFamily: "Pretendard-Regular" },
  stepTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY_TEXT, marginBottom: 2 },
  stepDesc:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  connector: { width: 2, height: 14, backgroundColor: C.border, marginLeft: 31 },
  tipBox:    { backgroundColor: "#F0F9FF", borderRadius: 14, padding: 16,
               borderWidth: 1, borderColor: "#BAE6FD", marginTop: 10 },
  tipTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0369A1", marginBottom: 8 },
  tipDesc:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0369A1", lineHeight: 22 },
});

const sd = StyleSheet.create({
  root:        { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  iconWrap:    { width: 110, height: 110, borderRadius: 30, backgroundColor: "#E6FAF8",
                 alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title:       { fontSize: 28, fontFamily: "Pretendard-Regular", color: NAVY_TEXT },
  sub:         { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.textSecondary,
                 textAlign: "center", lineHeight: 26 },
  summaryBox:  { backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 10, width: "100%",
                 borderWidth: 1, borderColor: C.border },
  summaryTitle:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY_TEXT, marginBottom: 4 },
  summaryRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  btn:         { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: NAVY_BG,
                 paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, marginTop: 8 },
  btnTxt:      { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
});
