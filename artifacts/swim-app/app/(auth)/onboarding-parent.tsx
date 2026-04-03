/**
 * onboarding-parent.tsx — 학부모 온보딩
 * 슬라이드 1: 환영
 * 슬라이드 2: 자녀 출석 확인
 * 슬라이드 3: 선생님 소통 · 공지
 * 슬라이드 4: 호칭 설정 → parent-onboard-nickname으로 이동
 */
import { ArrowRight, Bell, CheckCircle2, ChevronRight, Heart, MessageSquare, Users } from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Dimensions, FlatList, Pressable, StyleSheet,
  Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";

const { width: W } = Dimensions.get("window");

const MINT   = "#2EC4B6";
const NAVY   = "#0F172A";
const ORANGE = "#F97316";
const GREEN  = "#2E9B6F";

const SLIDES = ["welcome", "attendance", "communication", "nickname"];

export default function OnboardingParentScreen() {
  const { parentAccount } = useAuth();
  const flatRef = useRef<FlatList>(null);
  const [page, setPage] = useState(0);

  async function goNext() {
    if (page < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: page + 1, animated: true });
      setPage(page + 1);
    } else {
      await goNickname();
    }
  }

  async function goNickname() {
    if (parentAccount?.id) {
      await AsyncStorage.setItem(`@swimnote:onboarded_${parentAccount.id}_parent`, "1").catch(() => {});
    }
    router.replace("/(auth)/parent-onboard-nickname" as any);
  }

  async function skip() {
    if (parentAccount?.id) {
      await AsyncStorage.setItem(`@swimnote:onboarded_${parentAccount.id}_parent`, "1").catch(() => {});
    }
    router.replace("/(parent)/home" as any);
  }

  const renderSlide = ({ item }: { item: string }) => {
    if (item === "welcome")      return <SlideWelcome />;
    if (item === "attendance")   return <SlideAttendance />;
    if (item === "communication")return <SlideCommunication />;
    if (item === "nickname")     return <SlideNickname onGo={goNickname} />;
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
          <Pressable style={s.skipBtn} onPress={skip}>
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

function SlideWelcome() {
  return (
    <View style={[sw.root, { width: W }]}>
      <View style={sw.iconWrap}>
        <Heart size={64} color={ORANGE} />
      </View>
      <Text style={sw.badge}>학부모 모드</Text>
      <Text style={sw.title}>자녀의 수영 수업을{"\n"}한눈에 확인하세요</Text>
      <Text style={sw.sub}>
        출석 현황, 수업 일지, 선생님 메시지,{"\n"}
        보강 일정까지 앱 하나로 모두 확인!
      </Text>
      <View style={sw.tagRow}>
        {["출석 확인", "수업 일지", "보강 알림", "선생님 소통", "공지 확인"].map(t => (
          <View key={t} style={sw.tag}><Text style={sw.tagTxt}>{t}</Text></View>
        ))}
      </View>
    </View>
  );
}

function SlideAttendance() {
  return (
    <View style={[sa.root, { width: W }]}>
      <View style={sa.header}>
        <CheckCircle2 size={28} color={GREEN} />
        <Text style={sa.title}>자녀 출석 확인</Text>
      </View>
      <Text style={sa.sub}>실시간으로 출석 현황을 확인하세요</Text>

      <View style={sa.mockCard}>
        <Text style={sa.mockTitle}>오늘 수업</Text>
        <View style={sa.attendRow}>
          <View style={[sa.statusDot, { backgroundColor: GREEN }]} />
          <Text style={sa.attendName}>김민준</Text>
          <View style={[sa.badge, { backgroundColor: "#DFF3EC" }]}>
            <Text style={[sa.badgeTxt, { color: GREEN }]}>출석</Text>
          </View>
        </View>
        <View style={sa.attendRow}>
          <View style={[sa.statusDot, { backgroundColor: "#D96C6C" }]} />
          <Text style={sa.attendName}>김서연</Text>
          <View style={[sa.badge, { backgroundColor: "#F9DEDA" }]}>
            <Text style={[sa.badgeTxt, { color: "#D96C6C" }]}>결석</Text>
          </View>
        </View>
        <View style={[sa.makeupRow]}>
          <ArrowRight size={12} color={ORANGE} />
          <Text style={sa.makeupTxt}>서연 보강 1회 생성됨 — 보강 탭에서 확인</Text>
        </View>
      </View>

      {[
        { icon: "📅", text: "홈 화면에서 오늘 수업 출석 현황 즉시 확인" },
        { icon: "📊", text: "이번 달 출석률 및 결석 횟수 통계" },
        { icon: "🔔", text: "출석 처리 시 푸시 알림 수신 (설정 가능)" },
        { icon: "🔄", text: "보강 일정 배정 시 즉시 알림" },
      ].map(g => (
        <View key={g.text} style={sa.guideRow}>
          <Text style={sa.guideIcon}>{g.icon}</Text>
          <Text style={sa.guideText}>{g.text}</Text>
        </View>
      ))}
    </View>
  );
}

function SlideCommunication() {
  return (
    <View style={[sco.root, { width: W }]}>
      <View style={sco.header}>
        <MessageSquare size={28} color={MINT} />
        <Text style={sco.title}>선생님 소통 · 공지</Text>
      </View>
      <Text style={sco.sub}>선생님과 직접 소통할 수 있어요</Text>

      {[
        { icon: "📖", color: MINT, bg: "#E6FAF8", title: "수업 일지 확인", desc: "선생님이 작성한 수업 내용과 피드백을 확인하세요" },
        { icon: "💬", color: "#7C3AED", bg: "#EEDDF5", title: "메시지 소통", desc: "선생님에게 직접 문의하거나 메시지를 주고받을 수 있어요" },
        { icon: "📢", color: ORANGE, bg: "#FFF3E0", title: "공지 확인", desc: "수영장 공지사항을 앱에서 바로 확인하세요" },
        { icon: "🖼", color: GREEN, bg: "#DFF3EC", title: "수업 사진", desc: "선생님이 올린 수업 사진을 확인할 수 있어요" },
      ].map(f => (
        <View key={f.title} style={sco.card}>
          <View style={[sco.iconBox, { backgroundColor: f.bg }]}>
            <Text style={{ fontSize: 22 }}>{f.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={sco.cardTitle}>{f.title}</Text>
            <Text style={sco.cardDesc}>{f.desc}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function SlideNickname({ onGo }: { onGo: () => void }) {
  return (
    <View style={[sn.root, { width: W }]}>
      <View style={sn.iconWrap}>
        <Users size={64} color={MINT} />
      </View>
      <Text style={sn.title}>마지막 단계!</Text>
      <Text style={sn.sub}>
        선생님과 소통할 때 사용되는{"\n"}
        호칭을 설정해주세요.
      </Text>
      <View style={sn.previewBox}>
        <Text style={sn.previewLabel}>예시</Text>
        <Text style={sn.previewNickname}>김민준 엄마</Text>
        <Text style={sn.previewDesc}>선생님에게 이 이름으로 표시됩니다</Text>
      </View>
      <Pressable style={sn.btn} onPress={onGo}>
        <Text style={sn.btnTxt}>호칭 설정하기</Text>
        <ArrowRight size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#FAFAFA" },
  progressRow:{ flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 14 },
  dot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: "#E5E7EB" },
  dotActive:  { width: 20, backgroundColor: ORANGE },
  dotDone:    { backgroundColor: ORANGE, opacity: 0.4 },
  footer:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderColor: "#F0F0F0" },
  skipBtn:    { paddingHorizontal: 16, paddingVertical: 12 },
  skipTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#9CA3AF" },
  nextBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: ORANGE,
                paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  nextTxt:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});

const sw = StyleSheet.create({
  root:    { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  iconWrap:{ width: 100, height: 100, borderRadius: 28, backgroundColor: "#FFF3E0",
             alignItems: "center", justifyContent: "center", marginBottom: 8 },
  badge:   { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: "#FFF3E0" },
  title:   { fontSize: 26, fontFamily: "Pretendard-Regular", color: NAVY, textAlign: "center", lineHeight: 36 },
  sub:     { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#64748B", textAlign: "center", lineHeight: 24 },
  tagRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 },
  tag:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F3F4F6",
             borderWidth: 1, borderColor: "#E5E7EB" },
  tagTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#374151" },
});

const sa = StyleSheet.create({
  root:       { flex: 1, padding: 24, gap: 14 },
  header:     { flexDirection: "row", alignItems: "center", gap: 10 },
  title:      { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:        { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -8 },
  mockCard:   { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 10,
                borderWidth: 1, borderColor: "#E5E7EB" },
  mockTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
  attendRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  statusDot:  { width: 10, height: 10, borderRadius: 5 },
  attendName: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY },
  badge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  makeupRow:  { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4,
                borderTopWidth: 1, borderColor: "#F3F4F6" },
  makeupTxt:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: ORANGE },
  guideRow:   { flexDirection: "row", alignItems: "flex-start", gap: 10,
                backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  guideIcon:  { fontSize: 18, width: 26 },
  guideText:  { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151", lineHeight: 20 },
});

const sco = StyleSheet.create({
  root:      { flex: 1, padding: 24, gap: 12 },
  header:    { flexDirection: "row", alignItems: "center", gap: 10 },
  title:     { fontSize: 22, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -6 },
  card:      { flexDirection: "row", alignItems: "flex-start", gap: 14, backgroundColor: "#fff",
               borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:   { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, marginBottom: 3 },
  cardDesc:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 18 },
});

const sn = StyleSheet.create({
  root:        { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  iconWrap:    { width: 100, height: 100, borderRadius: 28, backgroundColor: "#E6FAF8",
                 alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title:       { fontSize: 26, fontFamily: "Pretendard-Regular", color: NAVY },
  sub:         { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#64748B",
                 textAlign: "center", lineHeight: 26 },
  previewBox:  { backgroundColor: "#E6FAF8", borderRadius: 20, padding: 24, alignItems: "center", gap: 6, width: "100%" },
  previewLabel:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: MINT, textTransform: "uppercase", letterSpacing: 1 },
  previewNickname: { fontSize: 28, fontFamily: "Pretendard-Regular", color: MINT },
  previewDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  btn:         { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: MINT,
                 paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, marginTop: 8 },
  btnTxt:      { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },
});
