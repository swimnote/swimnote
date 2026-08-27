/**
 * AI 학생리포트 발급현황 허브 — PHASE 0/1 Shell
 * PHASE 2에서 KPI / 학생 INDEX / 상태 필터 구현 예정
 *
 * DATA SOURCE (PHASE 2):
 *   growth_reports WHERE swimming_pool_id = pool
 *   product_status enum: NOT_OPEN/OPEN/PREANALYZING/QUESTION_AVAILABLE/
 *     READY_FOR_ANALYSIS/ANALYZING/REVIEW_REQUIRED/APPROVED/PUBLISHED/PARTIAL/FAILED
 *   KPI: 발행완료 | 검토대기 | 분석중 | 실패  (NOT_OPEN 제외)
 *   학생 eligibility(V1 금지): 별도 로직 없음 → PHASE 3+ 구현
 */

import React from "react";
import { SafeAreaView, ScrollView, Text, View, StyleSheet } from "react-native";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import Colors from "@/constants/colors";

const C = Colors.light;

export default function ReportHubScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader title="AI 학생리포트" homePath="/(admin)/dashboard" />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.placeholder}>
          <Text style={s.placeholderTitle}>AI 학생리포트 발급현황</Text>
          <Text style={s.placeholderSub}>PHASE 2에서 구현 예정</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:             { flex: 1, backgroundColor: C.background },
  body:             { padding: 20, flexGrow: 1 },
  placeholder:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 80 },
  placeholderTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  placeholderSub:   { fontSize: 13, color: C.textMuted },
});
