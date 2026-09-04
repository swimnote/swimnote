import Colors from "@/constants/colors";
const C = Colors.light;
/**
 * (super)/global-menu.tsx — 슈퍼관리자 전체 메뉴
 *
 * Dashboard header의 메뉴 버튼 → 이 화면으로 push.
 * 기존 모든 Super Admin 기능을 9개 섹션(A~I)으로 그룹화.
 * 기존 route/API/로직 변경 없음. 진입 경로만 재편.
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";

const P = "#7C3AED";
const MINT = C.brandStrong;
const BG = "#F8F8FC";

type SectionItem = {
  icon: string;
  label: string;
  sub?: string;
  onPress: () => void;
  badge?: string | null;
  badgeColor?: string;
};

function go(path: string, backTo = "global-menu") {
  return () => router.push(`${path}?backTo=${backTo}` as any);
}

function MenuItem({ icon, label, sub, onPress, badge, badgeColor }: SectionItem) {
  return (
    <Pressable
      style={({ pressed }) => [s.item, { opacity: pressed ? 0.75 : 1 }]}
      onPress={onPress}
    >
      <View style={s.itemIcon}>
        <LucideIcon name={icon as any} size={17} color={P} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.itemLabel}>{label}</Text>
        {!!sub && <Text style={s.itemSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {!!badge && (
        <View style={[s.badge, { backgroundColor: badgeColor ?? "#D96C6C" }]}>
          <Text style={s.badgeTxt}>{badge}</Text>
        </View>
      )}
      <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
    </Pressable>
  );
}

function Section({ title, items }: { title: string; items: SectionItem[] }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.sectionCard}>
        {items.map((item, i) => (
          <View key={i}>
            {i > 0 && <View style={s.divider} />}
            <MenuItem {...item} />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function GlobalMenuScreen() {
  const { token } = useAuth();
  const [unreadInquiries, setUnreadInquiries] = useState(0);
  const [slaOverdue, setSlaOverdue] = useState(0);
  const [storageRisk, setStorageRisk] = useState(0);

  const fetchBadges = useCallback(async () => {
    if (!token) return;
    try {
      const [inquiryRes, riskRes] = await Promise.all([
        apiRequest(token, "/inquiries/unread-count"),
        apiRequest(token, "/super/risk-summary"),
      ]);
      const [inquiryData, riskData] = await Promise.all([
        inquiryRes.json(),
        riskRes.json(),
      ]);
      setUnreadInquiries(inquiryData.count ?? 0);
      setSlaOverdue(Number(riskData.sla_overdue ?? 0));
      setStorageRisk(Number(riskData.storage_risk ?? 0));
    } catch (_) {}
  }, [token]);

  useEffect(() => { fetchBadges(); }, [fetchBadges]);

  const SECTIONS: { title: string; items: SectionItem[] }[] = [
    {
      title: "A. 수영장 운영",
      items: [
        { icon: "layout-list",  label: "수영장 관리",     sub: "목록·상태·상세·강제조치",       onPress: go("/(super)/pools") },
        { icon: "user-check",   label: "승인 관리",       sub: "가입 승인 대기 목록",           onPress: go("/(super)/pools", "global-menu") },
        { icon: "zap",          label: "X MODE 관리",     sub: "운영처별 X 사용권·상태 확인",   onPress: go("/(super)/pools") },
        { icon: "credit-card",  label: "구독 현황",       sub: "전체 구독 목록·상태·만료",      onPress: go("/(super)/subscriptions") },
        { icon: "tag",          label: "구독 상품 관리",  sub: "플랜 가격·혜택 수정",           onPress: go("/(super)/subscription-products") },
      ],
    },
    {
      title: "B. 매출·결제",
      items: [
        { icon: "trending-up",  label: "매출 분석",  sub: "월간 매출·플랜별 수익",    onPress: go("/(super)/revenue-analytics") },
        { icon: "bar-chart-2",  label: "결제 분석",  sub: "결제 성공률·실패·환불",    onPress: go("/(super)/billing-analytics") },
        { icon: "dollar-sign",  label: "비용 분석",  sub: "인프라·운영비용·마진",     onPress: go("/(super)/cost-analytics") },
      ],
    },
    {
      title: "C. 고객·문의",
      items: [
        { icon: "inbox",           label: "일반 문의",  sub: "고객 문의 수신·답변",          onPress: go("/(super)/inquiries"),
          badge: unreadInquiries > 0 ? `미답변 ${unreadInquiries}` : null },
        { icon: "headphones",      label: "고객센터",   sub: "문의·복구·보안·SLA 관리",      onPress: go("/(super)/support-group"),
          badge: slaOverdue > 0 ? `SLA 초과 ${slaOverdue}` : null },
        { icon: "message-circle",  label: "문의함",     sub: "일반 지원·필터 조회",           onPress: go("/(super)/support-general") },
      ],
    },
    {
      title: "D. 콘텐츠",
      items: [
        { icon: "bell",           label: "공지사항 관리",  sub: "전체·관리자·선생님·학부모 공지",  onPress: go("/(super)/notices") },
        { icon: "layout",         label: "카드 배너 관리", sub: "학부모 홈 슬라이더 카드 배너",    onPress: go("/(super)/ads") },
        { icon: "minus-square",   label: "가로 배너 관리", sub: "학부모 홈 상단 슬림 배너",        onPress: go("/(super)/strip-banner") },
        { icon: "map-pin",        label: "수영장 공지",    sub: "운영처별 범위 공지 등록",          onPress: go("/(super)/pool-notices") },
      ],
    },
    {
      title: "E. 감사·리스크",
      items: [
        { icon: "activity",       label: "운영 로그·감사",   sub: "카테고리별 100개 감사 로그",  onPress: go("/(super)/op-logs") },
        { icon: "alert-triangle", label: "장애·리스크 센터", sub: "리스크 수준·이벤트·장애 관리", onPress: go("/(super)/risk-center") },
        { icon: "shield",         label: "보안 이벤트 로그", sub: "계정·역할·2FA·세션 관리",     onPress: go("/(super)/security") },
        { icon: "eye",            label: "민감 작업 로그",   sub: "감사·리스크 그룹 전체 조회",   onPress: go("/(super)/audit-group") },
      ],
    },
    {
      title: "F. 데이터·보호",
      items: [
        { icon: "zap-off",      label: "데이터 킬스위치",    sub: "삭제 예약·유예·4단계 안전장치", onPress: go("/(super)/kill-switch") },
        { icon: "save",         label: "백업/복구/스냅샷",   sub: "스냅샷 목록·복구·배치잡",       onPress: go("/(super)/backup") },
        { icon: "toggle-left",  label: "기능 플래그",        sub: "ON/OFF·운영자별 예외·롤백",     onPress: go("/(super)/feature-flags") },
        { icon: "lock",         label: "읽기전용 제어",      sub: "플랫폼 전체·운영자별 전환",     onPress: go("/(super)/readonly-control") },
        { icon: "database",     label: "DB 이원화 모니터링", sub: "슈퍼·운영 DB 용량·이벤트",     onPress: go("/(super)/db-status") },
        { icon: "refresh-cw",   label: "데이터 동기화",      sub: "싱크 상태·증분·전체 스냅샷",   onPress: go("/(super)/sync") },
        { icon: "shield",       label: "보호·통제 허브",     sub: "킬스위치·백업·플래그·읽기전용",  onPress: go("/(super)/protect-group"),
          badge: storageRisk > 0 ? `저장 위험 ${storageRisk}` : null, badgeColor: "#D97706" },
      ],
    },
    {
      title: "G. 시스템",
      items: [
        { icon: "server",  label: "시스템 상태",   sub: "서비스 건강·지연·업타임·메모리",      onPress: go("/(super)/system-status") },
        { icon: "clock",   label: "스케줄러 상태", sub: "백그라운드 잡 마지막 실행·지연 감지", onPress: go("/(super)/system-status") },
      ],
    },
    {
      title: "H. 정책·지원",
      items: [
        { icon: "file-text",   label: "정책·컴플라이언스", sub: "약관·개인정보·환불·동의상태", onPress: go("/(super)/policy") },
        { icon: "life-buoy",   label: "지원 센터",         sub: "티켓·복구·SLA·고객지원",     onPress: go("/(super)/support"),
          badge: slaOverdue > 0 ? `SLA 초과 ${slaOverdue}` : null },
      ],
    },
    {
      title: "I. 설정",
      items: [
        { icon: "shield-check", label: "보안·설정",        sub: "계정·2FA·외부서비스·세션",       onPress: go("/(super)/security-settings") },
        { icon: "smartphone",   label: "Google OTP",       sub: "2단계 인증 설정",                 onPress: () => router.push("/totp-setup?backTo=global-menu" as any) },
        { icon: "users",        label: "계정 관리",         sub: "플랫폼 관리자 계정·역할",         onPress: go("/(super)/users") },
        { icon: "hard-drive",   label: "저장공간 관리",    sub: "사용량·급증·차단·임시허용",       onPress: go("/(super)/storage") },
        { icon: "sliders",      label: "저장공간 정책",    sub: "자동삭제·차단·급증 임계값",       onPress: go("/(super)/storage-policy") },
      ],
    },
  ];

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* ── 헤더 ── */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <LucideIcon name="x" size={20} color={C.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle}>전체 메뉴</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: BG }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, paddingTop: 8 }}
      >
        {SECTIONS.map((sec) => (
          <Section key={sec.title} title={sec.title} items={sec.items} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#FFFFFF" },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
                  borderBottomWidth: 1, borderBottomColor: C.backgroundSoft },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: C.backgroundSoft,
                  alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.textPrimary, fontWeight: "600" as const },

  section:      { marginBottom: 20 },
  sectionTitle: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted,
                  textTransform: "uppercase" as const, letterSpacing: 0.5,
                  marginBottom: 6, paddingLeft: 2 },
  sectionCard:  { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1,
                  borderColor: C.border, overflow: "hidden" },

  item:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  itemIcon:     { width: 32, height: 32, borderRadius: 8, backgroundColor: "#F5F3FF",
                  alignItems: "center", justifyContent: "center" },
  itemLabel:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textPrimary },
  itemSub:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 1 },
  divider:      { height: 1, backgroundColor: C.backgroundSoft, marginLeft: 58 },

  badge:        { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginRight: 4 },
  badgeTxt:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#fff" },
});
