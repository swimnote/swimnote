/**
 * help.tsx — 앱 내 도움말 / FAQ
 */
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface FaqItem { q: string; a: string; }
interface Section { icon: string; color: string; bg: string; title: string; items: FaqItem[]; }

const SECTIONS: Section[] = [
  {
    icon: "play-circle", color: "#0EA5E9", bg: "#E0F2FE",
    title: "시작하기",
    items: [
      { q: "처음 어떻게 시작하나요?", a: "관리자 계정으로 로그인 후 대시보드의 '시작 가이드'를 따라가세요. ① 학생 등록 → ② 선생님 초대 → ③ 학부모 초대 순으로 진행하면 됩니다." },
      { q: "선생님은 어떻게 초대하나요?", a: "설정 → 수업 설정 → 권한 설정에서 선생님을 초대할 수 있습니다. 초대 링크를 카카오톡으로 전송하면 선생님이 앱을 설치하고 가입합니다." },
      { q: "학부모는 어떻게 앱에 연결하나요?", a: "설정 → 운영 설정 → QR 초대 화면에서 QR 코드를 출력해 수영장에 비치하거나 링크로 공유하세요. 학부모가 스캔하면 가입 화면으로 연결됩니다." },
    ],
  },
  {
    icon: "users", color: "#2E9B6F", bg: "#DCFCE7",
    title: "학생 · 학부모 관리",
    items: [
      { q: "학생을 반에 배정하려면?", a: "스케줄러 탭에서 반을 탭하면 바텀시트가 열립니다. '반 배정' 버튼을 눌러 학생을 추가하거나, 학생 관리 화면에서 반을 선택할 수 있습니다." },
      { q: "학부모와 학생이 연결이 안 돼요.", a: "학부모가 앱 가입 시 학생의 이름/생년월일을 입력해야 연결됩니다. 회원 관리 → 해당 학생 → 상세보기에서 연결 상태를 확인하세요." },
      { q: "학생 상태는 어떻게 바꾸나요?", a: "회원 목록에서 학생 카드를 길게 누르거나, 상세보기에서 상태를 변경할 수 있습니다. 정상/미배정/연기/퇴원 상태로 관리됩니다." },
      { q: "학생을 일괄 등록하려면?", a: "회원 관리 탭의 '엑셀로 일괄 등록' 버튼을 이용하세요. 엑셀 양식을 다운로드하여 작성 후 업로드하면 됩니다." },
    ],
  },
  {
    icon: "calendar", color: "#7C3AED", bg: "#EDE9FE",
    title: "스케줄러 · 수업",
    items: [
      { q: "반을 새로 등록하려면?", a: "스케줄러 탭 우측 상단의 '반 등록' 버튼을 누르세요. 요일·시간·선생님·색상을 한 화면에서 설정할 수 있습니다." },
      { q: "1회성 특별 수업은 어떻게 만드나요?", a: "반 등록 시 '1회성 반' 토글을 켜고 특정 날짜를 입력하면 됩니다. 해당 날짜에만 수업이 표시됩니다." },
      { q: "출결은 어디서 체크하나요?", a: "스케줄러에서 수업 칸을 탭하면 학생 명단이 나옵니다. 각 학생 옆의 버튼으로 출석/결석/지각을 체크하세요." },
      { q: "보강 수업은 어떻게 관리하나요?", a: "스케줄러 상단의 '보강' 버튼을 누르면 보강 관리 화면으로 이동합니다. 결석한 학생의 보강 신청·승인을 처리할 수 있습니다." },
    ],
  },
  {
    icon: "bell", color: "#EA580C", bg: "#FEF3C7",
    title: "알림 · 공지",
    items: [
      { q: "학부모에게 공지를 보내려면?", a: "설정 → 운영 설정 → 공지사항에서 공지를 작성하면 학부모 앱에 푸시 알림이 발송됩니다." },
      { q: "푸시 알림이 오지 않아요.", a: "설정 → 수업 설정 → 알림 설정에서 알림 수신 여부를 확인하세요. 기기 설정에서 스윔노트 앱의 알림 권한도 확인해주세요." },
    ],
  },
  {
    icon: "credit-card", color: "#DB2777", bg: "#FCE7F3",
    title: "구독 · 결제",
    items: [
      { q: "현재 구독 상태는 어디서 확인하나요?", a: "설정 → 운영 설정 → 구독 관리에서 현재 플랜과 사용량을 확인할 수 있습니다." },
      { q: "학생 수 초과 시 어떻게 되나요?", a: "플랜별 학생 수 한도를 초과하면 추가 등록이 제한됩니다. 구독 관리에서 플랜을 업그레이드하거나 스윔노트 고객센터로 문의하세요." },
    ],
  },
  {
    icon: "message-circle", color: "#0369A1", bg: "#E0F2FE",
    title: "문의 · 고객센터",
    items: [
      { q: "문제가 생기면 어디에 문의하나요?", a: "설정 → 계정/기타 → 문의하기를 통해 스윔노트 고객센터에 문의하실 수 있습니다. 평일 09:00-18:00 운영합니다." },
      { q: "데이터를 백업하고 싶어요.", a: "설정 → 운영 설정 → 데이터 관리에서 데이터 현황을 확인하고 관리할 수 있습니다." },
    ],
  },
];

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen(p => !p)}>
      <View style={f.qRow}>
        <Text style={f.q}>{item.q}</Text>
        {open ? <ChevronUp size={16} color={C.textMuted} /> : <ChevronDown size={16} color={C.textMuted} />}
      </View>
      {open && <Text style={f.a}>{item.a}</Text>}
    </Pressable>
  );
}

export default function HelpScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="도움말" />

      <ScrollView contentContainerStyle={[s.container, { paddingBottom: insets.bottom + 40 }]}>

        {/* 상단 배너 */}
        <View style={s.banner}>
          <LucideIcon name="life-buoy" size={28} color="#0EA5E9" />
          <View style={{ flex: 1 }}>
            <Text style={s.bannerTitle}>스윔노트 도움말</Text>
            <Text style={s.bannerSub}>자주 묻는 질문과 사용 방법을 확인하세요</Text>
          </View>
        </View>

        {/* FAQ 섹션들 */}
        {SECTIONS.map(sec => (
          <View key={sec.title} style={s.section}>
            <View style={s.secHeader}>
              <View style={[s.secIcon, { backgroundColor: sec.bg }]}>
                <LucideIcon name={sec.icon as any} size={16} color={sec.color} />
              </View>
              <Text style={s.secTitle}>{sec.title}</Text>
            </View>
            <View style={s.secCard}>
              {sec.items.map((item, i) => (
                <View key={i}>
                  {i > 0 && <View style={f.divider} />}
                  <FaqRow item={item} />
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* 문의 카드 */}
        <View style={s.contactCard}>
          <LucideIcon name="headphones" size={20} color="#7C3AED" />
          <View style={{ flex: 1 }}>
            <Text style={s.contactTitle}>해결이 안 됐나요?</Text>
            <Text style={s.contactSub}>설정 → 문의하기에서 직접 문의해 주세요</Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, gap: 16 },

  banner: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#EFF6FF", borderRadius: 16, padding: 16 },
  bannerTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  bannerSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },

  section: { gap: 8 },
  secHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
  secIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  secTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  secCard: { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden", paddingHorizontal: 16, shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },

  contactCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#F5F0FF", borderRadius: 16, padding: 16 },
  contactTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  contactSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
});

const f = StyleSheet.create({
  qRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, gap: 10 },
  q: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1, lineHeight: 21 },
  a: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#475569", lineHeight: 21, paddingBottom: 14, paddingRight: 24 },
  divider: { height: 1, backgroundColor: C.border },
});
