/**
 * (parent)/growth-report-detail.tsx — GR7 Deep Link Foundation
 *
 * GR8 Boundary: 상세 UI는 GR8에서 구현. 이 파일은 deep link contract를 확정하고
 * Expo Router가 /(parent)/growth-report-detail?reportId=<id> 경로를 인식하게 한다.
 *
 * Deep link contract (GR7 spec §9, §12):
 *   route: /(parent)/growth-report-detail?reportId=<reportId>
 *   navigation from: Push notification tap + Notification Center tap + Feed item tap (GR8)
 *   auth: server-side ownership check in GR8 detail API (client route ≠ security boundary)
 *   X expiry: PUBLISHED report는 X 만료 후에도 조회 가능 (spec §23)
 *
 * GR8에서 이 파일을 실제 UI로 교체한다.
 */
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "react-native";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";

const C = Colors.light;

export default function GrowthReportDetailScreen() {
  const insets = useSafeAreaInsets();
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <LucideIcon name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>성장리포트</Text>
        <View style={s.backBtn} />
      </View>

      {/* GR8 placeholder — 실제 상세 UI는 GR8에서 구현 */}
      <View style={s.body}>
        <ActivityIndicator size="large" color={C.tint} />
        <Text style={s.label}>리포트를 불러오는 중...</Text>
        {/* reportId는 GR8 상세 API 호출에서 소비됨 */}
        {__DEV__ && !!reportId && (
          <Text style={s.devHint}>report_id: {reportId}</Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#fff" },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  backBtn:     { width: 40, alignItems: "flex-start" },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#111" },
  body:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  label:       { fontSize: 15, color: "#666" },
  devHint:     { fontSize: 11, color: "#aaa", fontFamily: "monospace" },
});
