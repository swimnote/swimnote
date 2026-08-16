/**
 * x-mode-hub — SWIMNOTE X모드 정보 허브
 * X01: Settings → SWIMNOTE X모드 진입점
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useMode } from "@/context/ModeContext";
import { X as XT } from "@/constants/xTheme";
import { router } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = Colors.light;
const NAVY = XT.primary;   // Nautic Primary (xTheme single source)
const X_ACCENT = "#355C7D";
const X_LIGHT = "#EEF4FA";

type InfoItem = { icon: string; label: string; desc: string; route: string };

const INFO_ITEMS: InfoItem[] = [
  { icon: "layers",      label: "X모드 설명",              desc: "일반 SWIMNOTE와 X모드의 차이",      route: "/(admin)/x-info-overview"       },
  { icon: "cpu",         label: "AI에 대한 설명",           desc: "SWIMNOTE AI ENGINE 작동 방식",      route: "/(admin)/x-info-ai"             },
  { icon: "bar-chart-2", label: "무료 학부모 리포트 지원",   desc: "성장/수업 현황을 학부모에게 제공",   route: "/(admin)/x-info-parent-report"  },
  { icon: "pen-line",    label: "선생님 AI 일지 작성",      desc: "AI 일지 초안 작성 지원",            route: "/(admin)/x-info-diary"          },
  { icon: "search",      label: "우리 수영장 커리큘럼 검색", desc: "수영장별 교육과정 기반 AI 검색",     route: "/(admin)/x-info-curriculum"     },
];

export default function XModeHubScreen() {
  const insets = useSafeAreaInsets();
  const { adminUser } = useAuth();
  const { mode, status } = useMode();
  const isPoolAdmin = adminUser?.role === "pool_admin";

  function ModeStatusCard() {
    if (status === "loading" || status === "idle") return null;

    if (mode === "x") {
      return (
        <View style={[st.statusCard, { backgroundColor: X_LIGHT, borderColor: X_ACCENT + "30" }]}>
          <View style={[st.statusDot, { backgroundColor: X_ACCENT }]} />
          <View style={{ flex: 1 }}>
            <Text style={[st.statusTitle, { color: X_ACCENT }]}>X모드 사용 중</Text>
            <Text style={st.statusDesc}>SWIMNOTE X 기능을 정상적으로 이용하고 있습니다.</Text>
          </View>
          <LucideIcon name="check-circle" size={20} color={X_ACCENT} />
        </View>
      );
    }

    if (mode === "x_pending") {
      return (
        <View style={[st.statusCard, { backgroundColor: "#FFFBEB", borderColor: "#D97706" + "30" }]}>
          <View style={[st.statusDot, { backgroundColor: "#D97706" }]} />
          <View style={{ flex: 1 }}>
            <Text style={[st.statusTitle, { color: "#92400E" }]}>X모드 설정 진행 중</Text>
            <Text style={st.statusDesc}>커리큘럼 연결 등 설정 완료 후 X 기능이 활성화됩니다.</Text>
          </View>
        </View>
      );
    }

    // normal
    return (
      <View style={[st.statusCard, { backgroundColor: "#F8FAFC", borderColor: C.border }]}>
        <View style={[st.statusDot, { backgroundColor: C.textMuted }]} />
        <View style={{ flex: 1 }}>
          <Text style={[st.statusTitle, { color: C.textSecondary }]}>일반 SWIMNOTE 이용 중</Text>
          <Text style={st.statusDesc}>X모드를 추가하면 AI 기능을 사용할 수 있습니다.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <LucideIcon name="chevron-left" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>SWIMNOTE X모드</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 상태 카드 */}
        <ModeStatusCard />

        {/* X 안내 섹션 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>SWIMNOTE X 안내</Text>
          <View style={[s.card, { backgroundColor: C.card }]}>
            {INFO_ITEMS.map((item, idx) => (
              <Pressable
                key={item.route}
                style={({ pressed }) => [
                  s.row,
                  idx < INFO_ITEMS.length - 1 && s.rowBorder,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => router.push(item.route as any)}
              >
                <View style={s.rowIcon}>
                  <LucideIcon name={item.icon as any} size={18} color={X_ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{item.label}</Text>
                  <Text style={s.rowDesc}>{item.desc}</Text>
                </View>
                <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* 이용 신청 섹션 — pool_admin만 노출 */}
        {isPoolAdmin && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>이용 신청</Text>
            <View style={[s.card, { backgroundColor: C.card }]}>
              {(mode === null || mode === "normal") && (
                <Pressable
                  style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => router.push("/(admin)/x-subscription" as any)}
                >
                  <View style={[s.rowIcon, { backgroundColor: X_LIGHT }]}>
                    <LucideIcon name="credit-card" size={18} color={X_ACCENT} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>정기결제 신청하기</Text>
                    <Text style={s.rowDesc}>SWIMNOTE X 별도 정기결제</Text>
                  </View>
                  <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                </Pressable>
              )}

              {mode === "x_pending" && (
                <Pressable
                  style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => router.push("/(admin)/x-setup" as any)}
                >
                  <View style={[s.rowIcon, { backgroundColor: "#FFFBEB" }]}>
                    <LucideIcon name="settings" size={18} color="#D97706" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>X모드 설정 계속하기</Text>
                    <Text style={s.rowDesc}>커리큘럼 연결 등 남은 설정을 완료하세요</Text>
                  </View>
                  <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                </Pressable>
              )}

              {mode === "x" && (
                <>
                  <View style={[s.row, s.rowBorder]}>
                    <View style={[s.rowIcon, { backgroundColor: X_LIGHT }]}>
                      <LucideIcon name="check-circle" size={18} color={X_ACCENT} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.rowLabel, { color: X_ACCENT }]}>X모드 사용 중</Text>
                      <Text style={s.rowDesc}>현재 SWIMNOTE X 기능을 이용하고 있습니다.</Text>
                    </View>
                  </View>
                  <Pressable
                    style={({ pressed }) => [s.row, s.rowBorder, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => router.push("/(admin)/x-setup" as any)}
                  >
                    <View style={[s.rowIcon, { backgroundColor: X_LIGHT }]}>
                      <LucideIcon name="settings" size={18} color={X_ACCENT} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowLabel}>X모드 세팅하기</Text>
                      <Text style={s.rowDesc}>커리큘럼 설정 및 X 운영 설정 관리</Text>
                    </View>
                    <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                  {/* X02-D2: 구독 상태 확인 / Restore / 구독 관리 */}
                  <Pressable
                    style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => router.push("/(admin)/x-subscription" as any)}
                  >
                    <View style={[s.rowIcon, { backgroundColor: X_LIGHT }]}>
                      <LucideIcon name="credit-card" size={18} color={X_ACCENT} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowLabel}>X 구독 관리</Text>
                      <Text style={s.rowDesc}>구독 상태 확인 · 구독 관리 · 구매 복원</Text>
                    </View>
                    <LucideIcon name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}

        {/* SWIMNOTE 기본 플랜 구분 안내 */}
        <View style={s.noteBox}>
          <Text style={s.noteText}>
            <Text style={{ fontFamily: "Pretendard-Regular", color: C.textSecondary }}>안내: </Text>
            SWIMNOTE 기본 플랜 결제와 X모드 정기결제는 완전히 별개입니다. 각각 독립적으로 운영됩니다.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header:      { backgroundColor: C.card, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:     { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  section:     { gap: 8 },
  sectionTitle:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, paddingHorizontal: 4 },
  card:        { borderRadius: 18, overflow: "hidden", shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  row:         { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  rowBorder:   { borderBottomWidth: 1, borderBottomColor: C.border },
  rowIcon:     { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: X_LIGHT },
  rowLabel:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  rowDesc:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  noteBox:     { borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: C.border, padding: 14 },
  noteText:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },
});

const st = StyleSheet.create({
  statusCard:  { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  statusDot:   { width: 8, height: 8, borderRadius: 4 },
  statusTitle: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  statusDesc:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2, lineHeight: 18 },
});
